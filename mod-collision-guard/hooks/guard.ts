// mod-collision-guard / hooks/guard.ts, by v-amorim
// Holds the pure logic that records edits per session and finds conflicts between sessions.
import text from './text'
import { fill } from './theme'

// `$` never crosses an import, so the register file hands in plain functions.
// prompt: the recording session's prompt count when it edited, shown on the card as #N.
export type Edit = { path: string; session: string; at: number; prompt?: number }

// The newest clash plus how many other sessions also edited the file inside the window.
export type Clash = Edit & { more: number }

export type Io = {
  read: (path: string) => Promise<unknown>
  write: (path: string, text: string) => Promise<void>
  list: (path: string) => Promise<{ name: string; kind: string; mtimeMs?: number }[]>
}

export const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']

// Edit, Write and MultiEdit name `file_path`; NotebookEdit names `notebook_path`.
export const pathOf = (input: Record<string, unknown>) => {
  const raw = input.file_path ?? input.notebook_path
  return typeof raw === 'string' && raw ? raw : ''
}

// One spelling per file: forward slashes, git-bash `/c/` as `c:/`, and case folded on a Windows drive path.
export const normalize = (path: string) => {
  const flat = path.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/([A-Za-z])\//, '$1:/')
  return /^[A-Za-z]:/.test(flat) ? flat.toLowerCase() : flat
}

const fileOf = (dir: string, session: string) => `${dir}/${session.replace(/[^A-Za-z0-9_-]/g, '_')}.json`

// A corrupt or half-written file reads as empty instead of failing the edit.
export function parseEdits(text: unknown): Edit[] {
  try {
    const data = JSON.parse(String(text))
    if (!Array.isArray(data)) return []
    return data.filter((item): item is Edit => item && typeof item.path === 'string' && typeof item.session === 'string' && typeof item.at === 'number')
  } catch {
    return []
  }
}

// Each session writes only its own file, so concurrent sessions never overwrite one another; one writer at a time inside a session.
let queue: Promise<unknown> = Promise.resolve()
const serial = <T>(task: () => Promise<T>) => {
  const run = queue.then(task, task)
  queue = run.catch(() => undefined)
  return run
}

export const recordEdit = (io: Io, dir: string, session: string, path: string, now: number, windowMs: number, prompt?: number) =>
  serial(async () => {
    const file = fileOf(dir, session)
    const own = parseEdits(await io.read(file).catch(() => ''))
    const kept = own.filter(edit => now - edit.at <= windowMs && edit.path !== normalize(path))
    kept.push({ path: normalize(path), session, at: now, ...(prompt === undefined ? {} : { prompt }) })
    await io.write(file, JSON.stringify(kept))
  })

export const clearOwn = (io: Io, dir: string, session: string) => serial(() => io.write(fileOf(dir, session), '[]'))

// The newest edit of this file by another session inside the window, with the count of the other sessions that also edited it, or undefined.
export async function findConflict(io: Io, dir: string, session: string, path: string, now: number, windowMs: number) {
  const mine = fileOf(dir, session).slice(dir.length + 1)
  const target = normalize(path)
  const entries = await io.list(dir).catch(() => [])
  let newest: Edit | undefined
  const sessions = new Set<string>()
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json') || entry.name === mine) continue
    // Ended sessions leave their files behind; one not written inside the window holds no live edit, so it is never read.
    if (entry.mtimeMs && now - entry.mtimeMs > windowMs) continue
    for (const edit of parseEdits(await io.read(`${dir}/${entry.name}`).catch(() => ''))) {
      if (edit.session === session || normalize(edit.path) !== target || now - edit.at > windowMs) continue
      sessions.add(edit.session)
      if (!newest || edit.at > newest.at) newest = edit
    }
  }
  return newest ? { ...newest, more: sessions.size - 1 } : undefined
}

export function agoText(ms: number) {
  const minutes = Math.floor(ms / 60000)
  if (minutes < 1) return text.agoLessThanMinute
  if (minutes < 60) return fill(text.agoMinutes, { minutes })
  return fill(text.agoHoursMinutes, { hours: Math.floor(minutes / 60), minutes: minutes % 60 })
}

// Claude reads the reason in one line, so a long one is cut here.
export const REASON_MAX = 300

// What the person typed as one quoted line: flat, no control characters, cut, and its quotes escaped.
export const cleanReason = (raw: string) => {
  const flat = raw.replace(/\s+/g, ' ').replace(/\p{Cc}/gu, '').trim()
  const cut = [...flat].length > REASON_MAX ? `${[...flat].slice(0, REASON_MAX).join('').trimEnd()}...` : flat
  return cut.replace(/"/g, '\\"')
}

// vscode://file/<absolute path>, with the path in forward slashes and `?` and `#` escaped.
export const vscodeHref = (path: string) => {
  const flat = path.replace(/\\/g, '/').replace(/^\/([A-Za-z])\//, '$1:/')
  return `vscode://file${flat.startsWith('/') ? '' : '/'}${encodeURI(flat).replace(/[?#]/g, mark => encodeURIComponent(mark))}`
}

// A long path cut in the middle, keeping the first folder and the name.
export function shortPath(path: string, max: number) {
  if ([...path].length <= max) return path
  const parts = path.replace(/\\/g, '/').split('/')
  const name = parts[parts.length - 1]!
  const kept = `${parts.slice(0, parts[0] === '' ? 2 : 1).join('/')}/…/${name}`
  return [...kept].length <= max ? kept : `…${[...name].slice(-(max - 1)).join('')}`
}

// A path as { folder, name } for the link label: relative to the session folder when inside it, else absolute; forward slashes, folder keeps its trailing slash.
export function splitPath(path: string, root: string | undefined, max: number) {
  const flat = path.replace(/\\/g, '/')
  const base = (root ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
  // Windows drive paths compare without case, since the drive letter and folders vary in how they are typed.
  const isDrive = /^[A-Za-z]:(\/|$)/.test(flat) && /^[A-Za-z]:(\/|$)/.test(base)
  const isInside = base !== '' && (isDrive ? flat.toLowerCase().startsWith(`${base.toLowerCase()}/`) : flat.startsWith(`${base}/`))
  const label = shortPath(isInside ? flat.slice(base.length + 1) : flat, max)
  const cut = label.lastIndexOf('/')
  return { folder: label.slice(0, cut + 1), name: label.slice(cut + 1) }
}

export const shortId =(session: string) => session.slice(0, 8)

// The last /rename title in a session's transcript text, or undefined.
export function titleOf(transcript: string) {
  let found: string | undefined
  for (const match of transcript.matchAll(/"type":"custom-title","customTitle":"((?:[^"\\]|\\.)*)"/g)) {
    try {
      found = JSON.parse(`"${match[1]}"`) as string
    } catch {
      // A half-written row keeps the title found before it.
    }
  }
  return found?.trim() || undefined
}

const two = (n: number) => String(n).padStart(2, '0')

export const clockText = (at: number) => {
  const date = new Date(at)
  return `${two(date.getHours())}:${two(date.getMinutes())}`
}

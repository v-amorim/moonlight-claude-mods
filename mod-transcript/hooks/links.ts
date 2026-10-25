// mod-transcript / hooks/links.ts, by v-amorim
// Paths and web links in a reply: which text is one, where a path resolves, and the VS Code address that opens it.
import type { RenderElement } from 'claude-code'

// What the inline drawing needs to make a link: the engine's Link element, and the VS Code address of a path known to exist.
export type Links = { Link: (props: any) => RenderElement; open: (token: string) => string | undefined }

export type Found = { at: number; text: string; web: boolean }

const POSITION = /^(.*?)(?::(\d+)(?::(\d+))?)?$/
const URL = String.raw`https?:\/\/[^\s<>\x60]+`
const BARE = String.raw`(?<![\w@/\\.:~-])(?:[A-Za-z]:[\\/]|~[\\/]|\.{1,2}[\\/]|\/)?[\w@+-][\w@+.-]*(?:[\\/][\w@+.-]+)*(?::\d+(?::\d+)?)?`
const SCAN = new RegExp(`${URL}|${BARE}`, 'g')
const EXTENSION = /\.[A-Za-z][A-Za-z0-9]{0,7}$/

export function splitToken(token: string) {
  const found = POSITION.exec(token)!
  return { path: found[1]!, line: found[2], col: found[3] }
}

// A token worth asking the disk about: it has a folder separator or a file extension, and no spaces, flags or version numbers.
export function isPathLike(token: string) {
  const { path } = splitToken(token)
  if (!path || /[\s<>|*?"]|:\/\//.test(path) || path.startsWith('-') || !/[A-Za-z0-9]/.test(path) || /^\d+(\.\d+)+$/.test(path)) return false
  return /[\\/]/.test(path) || EXTENSION.test(path)
}

export const isWebUrl = (target: string) => /^https?:\/\/\S+$/i.test(target)

// Each bare URL, and each bare token `isPath` accepts, in order; a sentence's closing dot or bracket is no part of it.
export function scan(text: string, isPath: (token: string) => boolean): Found[] {
  const out: Found[] = []
  for (const found of text.matchAll(SCAN)) {
    const web = /^https?:/i.test(found[0])
    const token = web ? found[0].replace(/[.,;:!?)\]'"]+$/, '') : found[0].replace(/\.+$/, '')
    if (web ? isWebUrl(token) : isPath(token)) out.push({ at: found.index!, text: token, web })
  }
  return out
}

const normalize = (path: string) => {
  const out: string[] = []
  for (const part of path.split('/')) {
    if (part === '..') {
      if (out.length > 1) out.pop()
    } else if (part !== '.' && (part !== '' || out.length === 0)) out.push(part)
  }
  return out.join('/')
}

const vscodeAddress = (absolute: string, line?: string, col?: string) =>
  `vscode://file${absolute.startsWith('/') ? '' : '/'}${encodeURI(absolute).replace(/[?#]/g, mark => encodeURIComponent(mark))}${line ? `:${line}${col ? `:${col}` : ''}` : ''}`

// A false answer is asked again after this long, since Claude may write the file it names a moment later.
const MISSING_MS = 3000
const MAX_TOKENS = 40

// Every path-like token of a reply, code spans first, outside fenced code.
export function pathTokens(text: string): string[] {
  const body = text.replace(/```[\s\S]*?(```|$)/g, ' ')
  const tokens = new Set<string>()
  for (const found of body.matchAll(/`([^`\n]+)`/g)) if (isPathLike(found[1]!)) tokens.add(found[1]!)
  for (const found of scan(body.replace(/`[^`\n]*`/g, ' '), isPathLike)) if (!found.web) tokens.add(found.text)
  return [...tokens].slice(0, MAX_TOKENS)
}

// What the session's disk said about each path a reply names, asked once and never on the render's way.
export class PathLinks {
  cwd = ''
  home = ''
  private known = new Map<string, { isFound: boolean; at: number }>()

  clear() {
    this.known.clear()
  }

  absolute(path: string): string | null {
    const slash = path.replace(/\\/g, '/')
    if (/^[A-Za-z]:\//.test(slash) || slash.startsWith('/')) return normalize(slash)
    if (slash.startsWith('~/')) return this.home ? normalize(`${this.home}/${slash.slice(2)}`) : null
    return this.cwd ? normalize(`${this.cwd}/${slash}`) : null
  }

  // vscode://file/<absolute path>:<line>:<col>, once the path is known to exist.
  href(token: string): string | undefined {
    const { path, line, col } = splitToken(token)
    const absolute = this.absolute(path)
    if (!absolute || this.known.get(absolute)?.isFound !== true) return undefined
    return vscodeAddress(absolute, line, col)
  }

  // The address of a file a tool just touched, which needs no stat to be known.
  address(path: string, line?: number): string | undefined {
    const absolute = this.absolute(path)
    return absolute ? vscodeAddress(absolute, line === undefined ? undefined : String(line)) : undefined
  }

  // Asks `exists` about each token not asked yet; `found` runs once when any of them turns out to exist.
  async watch(tokens: string[], exists: (absolute: string) => Promise<boolean>, found: () => void) {
    const now = Date.now()
    const asks = new Set<string>()
    for (const token of tokens) {
      const absolute = this.absolute(splitToken(token).path)
      const known = absolute ? this.known.get(absolute) : undefined
      if (absolute && (!known || (!known.isFound && now - known.at > MISSING_MS))) asks.add(absolute)
    }
    const answers = await Promise.all([...asks].map(async absolute => ({ absolute, isFound: await exists(absolute).catch(() => false) })))
    for (const { absolute, isFound } of answers) this.known.set(absolute, { isFound, at: now })
    if (answers.some(answer => answer.isFound)) found()
  }
}

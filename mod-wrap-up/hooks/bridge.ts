// hooks/bridge.ts, by v-amorim: a poll hands the lines a command hook appended to <mods-data>/<mod>/bridge/<session>.jsonl to this mod.
import type { EngineInterface } from 'claude-code'

export type BridgeRecord = Record<string, unknown>
export type BridgeHandler = (record: BridgeRecord) => void | Promise<void>

const POLL_MS = 250

// One handler per event; registering again replaces it, so a mod that registers on every session.start holds one.
const handlers = new Map<string, BridgeHandler>()
// Characters of each session's file already delivered.
const cursors = new Map<string, number>()
let isStarted = false
let isTicking = false
let folder = ''

export function bridgeOn(event: string, handler: BridgeHandler) {
  handlers.set(event, handler)
}

export async function folderOf($: EngineInterface, mod: string) {
  const set = ((await $.env.get('CLAUDE_CONFIG_DIR')) ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
  if (set) return `${set}/mods-data/${mod}/bridge`
  // The command hooks write under $HOME, so it comes before USERPROFILE; a Git Bash `/c/Users/x` becomes `C:/Users/x`, which $.fs can open.
  const raw = ((await $.env.get('HOME')) || (await $.env.get('USERPROFILE')) || '').replace(/\\/g, '/').replace(/\/+$/, '')
  const home = raw.replace(/^\/([A-Za-z])(?=\/[^/])/, (_, drive: string) => `${drive.toUpperCase()}:`)
  return home ? `${home}/.claude/mods-data/${mod}/bridge` : ''
}

async function deliver(record: BridgeRecord) {
  try {
    await handlers.get(String(record.hook_event_name ?? ''))?.(record)
  } catch {
    // A handler's failure never stops the poll.
  }
}

// The complete lines this session's file gained since the last read, and whether this is the first read since the module started.
async function readNew($: EngineInterface, session: string) {
  if (!folder || !session) return { lines: [] as string[], isFirst: false }
  const text = String(await $.fs.read(`${folder}/${session}.jsonl`).catch(() => ''))
  const isFirst = !cursors.has(session)
  let cursor = cursors.get(session) ?? 0
  // A file shorter than what was read was deleted or emptied, so it starts over.
  if (text.length < cursor) cursor = 0
  const end = text.lastIndexOf('\n') + 1
  cursors.set(session, Math.max(end, cursor))
  return { lines: end > cursor ? text.slice(cursor, end).split('\n').filter(Boolean) : [], isFirst }
}

async function poll($: EngineInterface, session: string) {
  const { lines, isFirst } = await readNew($, session)
  const records: BridgeRecord[] = []
  for (const line of lines) {
    try {
      const parsed: unknown = JSON.parse(line)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) records.push(parsed as BridgeRecord)
    } catch {
      // A corrupt line is skipped.
    }
  }
  for (const record of isFirst ? lastOfEach(records) : records) await deliver(record)
}

// After a reload the file holds rows delivered before it, so only the last of each event is state worth replaying.
export function lastOfEach(records: BridgeRecord[]) {
  const last = new Map(records.map(record => [String(record.hook_event_name ?? ''), record]))
  return records.filter(record => last.get(String(record.hook_event_name ?? '')) === record)
}

async function tick($: EngineInterface) {
  if (isTicking) return
  isTicking = true
  try {
    // Asked every tick, so a /clear or a resume reads the new session's file.
    await poll($, String(await $.session.id()))
  } catch {
    // The next tick tries again.
  } finally {
    isTicking = false
  }
}

// Starts the poll once; `mod` names the mod's folder under mods-data.
export async function startBridge($: EngineInterface, mod: string) {
  if (isStarted) return
  isStarted = true
  try {
    folder = await folderOf($, mod)
    if (!folder) return
    $.clock.every(POLL_MS, () => void tick($))
    await tick($)
  } catch {
    // Without the bridge the mod keeps to what it finds on its own.
  }
}

// A session ended: what its file still holds is delivered; the SessionEnd command hook deletes the file.
export async function endBridge($: EngineInterface, session: string) {
  if (!folder || !session) return
  try {
    await poll($, session)
  } catch {
    // The next read of the file delivers it.
  }
}

// mod-prompts / hooks/prompts.ts, by v-amorim
// What the sidebar keeps of a transcript row; tool results and replies are most of the bytes and are dropped here.
export type Row = {
  uuid: string
  parent?: string
  isSidechain: boolean
  // The prompt's text when the row is one, else undefined.
  prompt?: string
  // A prompt typed while a turn ran, which the file keeps as a queued command.
  isQueued?: boolean
  // A subagent's report: a row that opens a turn of its own, which is no prompt.
  isReport?: boolean
  at?: string
  // What the row adds to its turn: tool calls a reply makes, lines a tool result changed, the turn's length.
  tools?: number
  added?: number
  removed?: number
  durationMs?: number
}

export type Prompt = { id: string; text: string; at?: string; tools: number; added: number; removed: number; durationMs?: number; isQueued?: boolean }

// Lines a successful edit or new file changed; a failed tool result changed nothing, so it counts nothing.
function changedLines(row: any) {
  const content = row.message?.content
  if (Array.isArray(content) && content.some((block: any) => block?.type === 'tool_result' && block.is_error === true)) return {}
  const result = row.toolUseResult
  let added = 0
  let removed = 0
  for (const hunk of Array.isArray(result?.structuredPatch) ? result.structuredPatch : []) {
    for (const line of Array.isArray(hunk?.lines) ? hunk.lines : []) {
      if (typeof line !== 'string') continue
      if (line.startsWith('+')) added++
      else if (line.startsWith('-')) removed++
    }
  }
  // A new file has no patch, only its content.
  if (result?.type === 'create' && added === 0 && typeof result.content === 'string') added = result.content.split('\n').length
  return added || removed ? { added, removed } : {}
}

// Rows Claude Code wraps around commands, hooks and notices; none is a prompt.
const WRAPPER = /^<(command-|local-command-|bash-|system-reminder|task-notification|user-prompt-submit-hook)/
const INTERRUPTED = /^\[Request interrupted by user/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const promptText = (text: string) => {
  const trimmed = text.trim()
  return trimmed && !WRAPPER.test(trimmed) && !INTERRUPTED.test(trimmed) && !trimmed.startsWith('/') ? trimmed : undefined
}

// A skill command the user typed, shown as typed; a local command (/clear, /config) carries no promptId, so it stays out.
const COMMAND = /^<command-message>[\s\S]*?<\/command-message>\s*<command-name>\s*(\/[^<\s]+)\s*<\/command-name>\s*(?:<command-args>([\s\S]*?)<\/command-args>)?/
export const commandPrompt = (row: any, text: string) => {
  if (typeof row?.promptId !== 'string' || !row.promptId) return undefined
  const match = COMMAND.exec(text.trim())
  return match ? `${match[1]} ${(match[2] ?? '').trim()}`.trim() : undefined
}

// A message's text: the string itself, or its text blocks joined.
const textOf = (content: unknown) =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.filter((block: any) => block?.type === 'text' && typeof block.text === 'string').map((block: any) => block.text).join('\n')
      : ''

export function parseRow(line: string): Row | undefined {
  let row: any
  try {
    row = JSON.parse(line)
  } catch {
    return undefined
  }
  if (typeof row?.uuid !== 'string') return undefined
  const base = {
    uuid: row.uuid,
    parent: row.parentUuid ?? row.logicalParentUuid ?? undefined,
    isSidechain: row.isSidechain === true,
    at: typeof row.timestamp === 'string' ? row.timestamp : undefined,
  }
  // A prompt typed while a turn ran is a queued_command attachment (content blocks when it has an image); a meta one is a note the harness queued.
  if (row.type === 'attachment' && row.attachment?.type === 'queued_command') {
    if (row.attachment.isMeta === true) return base
    return { ...base, prompt: promptText(textOf(row.attachment.prompt)), isQueued: true }
  }
  if (row.type === 'system' && row.subtype === 'turn_duration' && typeof row.durationMs === 'number') return { ...base, durationMs: row.durationMs }
  if (row.type === 'user' && row.isMeta === true && row.origin?.kind === 'peer') return { ...base, isReport: true }
  if (row.type === 'assistant' && Array.isArray(row.message?.content)) {
    const tools = row.message.content.filter((block: any) => block?.type === 'tool_use').length
    return tools ? { ...base, tools } : base
  }
  if (row.type !== 'user' || row.isMeta || row.isCompactSummary || row.message?.role !== 'user') return base
  const { content } = row.message
  if (Array.isArray(content) && content.some((block: any) => block?.type === 'tool_result')) return { ...base, ...changedLines(row) }
  const typed = textOf(content)
  return { ...base, prompt: commandPrompt(row, typed) ?? promptText(typed) }
}

// The prompts on the live branch, oldest first; a report or an abandoned prompt opens a turn that lists nothing, as turns.ts does.
export function promptsOf(rows: Row[]): Prompt[] {
  const main = rows.filter(row => !row.isSidechain)
  const byId = new Map(main.map(row => [row.uuid, row]))
  // Each row's previous row in file order, the way past a parent Claude Code never wrote.
  const before = new Map(main.map((row, n) => [row.uuid, main[n - 1]]))
  const live = new Set<string>()
  let row = main[main.length - 1]
  while (row && !live.has(row.uuid)) {
    live.add(row.uuid)
    row = row.parent ? (byId.get(row.parent) ?? before.get(row.uuid)) : undefined
  }
  const prompts: Prompt[] = []
  // The prompt the rows after it belong to, in file order; undefined after a report or an abandoned prompt.
  let turn: Prompt | undefined
  for (const candidate of rows) {
    if (candidate.isSidechain) continue
    if (candidate.isReport) {
      turn = undefined
      continue
    }
    if (candidate.prompt) {
      turn = live.has(candidate.uuid) ? { id: candidate.uuid, text: candidate.prompt, at: candidate.at, tools: 0, added: 0, removed: 0, isQueued: candidate.isQueued === true } : undefined
      if (turn) prompts.push(turn)
      continue
    }
    if (!turn) continue
    turn.tools += candidate.tools ?? 0
    turn.added += candidate.added ?? 0
    turn.removed += candidate.removed ?? 0
    if (candidate.durationMs !== undefined) turn.durationMs = (turn.durationMs ?? 0) + candidate.durationMs
  }
  return prompts
}

// Parses a growing transcript a feed at a time; a torn last line waits for the next feed.
export class TranscriptRows {
  rows: Row[] = []
  private parsed = 0

  feed(text: string) {
    const end = text.lastIndexOf('\n') + 1
    if (end < this.parsed) {
      this.rows = []
      this.parsed = 0
    }
    const lines = text.slice(this.parsed, end).split('\n').filter(line => line.trim())
    this.parsed = end
    for (const line of lines) {
      const row = parseRow(line)
      if (row) this.rows.push(row)
    }
    return lines.length
  }

  // Feeds text that follows what was fed, for a read that took only the new bytes; returns the unfinished last line.
  append(text: string) {
    const end = text.lastIndexOf('\n') + 1
    for (const line of text.slice(0, end).split('\n')) {
      const row = line.trim() ? parseRow(line) : undefined
      if (row) this.rows.push(row)
    }
    return text.slice(end)
  }
}

// A message drawn as several rows gets ids that keep its uuid's first four groups, so rows match on those.
export const rowKey = (id: string) => (UUID.test(id) ? id.slice(0, 24) : id)

// The id a jump scrolls to: the row as Claude Code last drew it, else the message's own uuid.
export const targetOf = (drawn: Map<string, string>, id: string) => drawn.get(rowKey(id)) ?? id

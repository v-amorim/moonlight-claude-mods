// mod-transcript / hooks/turns.ts, by v-amorim
// Groups transcript rows into turns and builds tool labels, timings and turn lines.
import text from './text'
import { fill, MARK } from './theme'

// One prompt and everything Claude drew after it, up to the next prompt.
export type Turn = {
  prompt: string
  // Drawn row ids that belong to the turn: row keys of messages, tool_use ids of tool rows.
  ids: Set<string>
  // Row key of the turn's last text block, which stays visible when the turn folds.
  reply?: string
  // Row keys of the text that ended each response: a notification answered in the same turn adds a response, so an earlier one also stays visible.
  answers: Set<string>
  tools: ToolCall[]
  durationMs?: number
  // When the prompt was sent, in epoch ms.
  at?: number
  // A turn guessed from the session's messages: the prompt's and the text blocks' text, for matching rows that carry no id yet.
  promptText?: string
  texts?: string[]
  // The reply's markdown, as the copy pill hands it over.
  replyText?: string
  // A subagent report opens a turn of its own, yet is not a prompt the person sent, so it takes no number.
  isReport?: boolean
  // A prompt sent while a turn ran: Claude Code draws it under another id than the file's, so its row is matched by this text.
  queuedText?: string
  // A prompt drawn before its row was written, maybe more than once while queued: its row and later draws are matched by this text.
  liveText?: string
  // A skill or prompt command opens the turn: the line Claude Code shows for it, `/execute args`. Claude Code draws that row itself, which no mod can reach, so the turn has no head and its rows stay as they are.
  command?: string
}

type MessageRow = { role: 'user' | 'assistant'; text: string; toolUses: readonly { tool_use_id: string; tool: string; input: any; result?: unknown; isError?: true }[]; toolResults?: readonly unknown[] }

// Times in epoch ms; thought is the thinking just before the call, empty when it kept no text.
export type ToolCall = { id: string; name: string; input: any; added: number; removed: number; startedAt?: number; endedAt?: number; thought?: string; preview?: Preview; file?: unknown; asked?: unknown }

// An AskUserQuestion result's answers and notes, which an opened call draws as its table.
const askedRecord = (name: string, output: any) => (name === 'AskUserQuestion' && typeof output === 'object' && output?.answers ? { answers: output.answers, annotations: output.annotations } : undefined)

const FILE_RESULT_TOOLS = new Set(['Read', 'Write', 'Edit', 'MultiEdit'])

// Only the fields the file card reads from a file tool's result record; undefined for a failed call or any other tool.
export function fileRecord(name: string, output: any, isFailed: boolean): unknown {
  if (isFailed || !FILE_RESULT_TOOLS.has(name) || typeof output !== 'object' || output === null) return undefined
  if (name === 'Read') {
    const { file } = output
    return typeof file === 'object' && file !== null ? { type: output.type, file: { filePath: file.filePath, content: file.content, startLine: file.startLine } } : undefined
  }
  return { filePath: output.filePath, staged: output.staged, type: output.type, content: output.type === 'create' ? output.content : undefined, structuredPatch: output.structuredPatch }
}

// What an opened call shows under its line: a diff's lines, or the start of what the call gave back, and how many lines were left out.
export type PreviewLine = { text: string; kind: 'add' | 'del' | 'same' | 'out' }
export type Preview = { lines: PreviewLine[]; more: number; rest: PreviewLine[] }

// The thinking since the last result or text, carried block by block: thinking adds its text, text ends it.
const thoughtAfter = (pending: string | undefined, block: any) => {
  if (block?.type === 'thinking') return [pending, typeof block.thinking === 'string' ? block.thinking.trim() : ''].filter(Boolean).join('\n\n')
  if (block?.type === 'redacted_thinking') return pending ?? ''
  if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) return undefined
  return pending
}

// Claude Code draws a prompt once under this id as it is sent, then again under its own uuid; only the second is a turn.
const PLACEHOLDER = 'placeholder'

const WRAPPER = /^<(command-|local-command-|bash-|system-reminder|task-notification|user-prompt-submit-hook)/
const INTERRUPTED = /^\[Request interrupted by user/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// A message drawn as several rows gets ids that keep its uuid's first four groups, so rows match on those.
export const rowKey = (id: string) => (UUID.test(id) ? id.slice(0, 24) : id)

export const isPrompt = (text: string) => {
  const trimmed = text.trim()
  return Boolean(trimmed) && !WRAPPER.test(trimmed) && !INTERRUPTED.test(trimmed) && !trimmed.startsWith('/')
}

const COMMAND = /^<command-message>[^]*?<command-name>(\/[^<]+)<\/command-name>(?:\s*<command-args>([^]*?)<\/command-args>)?/

// A skill or prompt command as its row stores it, in the words the person typed: `/execute fix it`.
export const commandOf = (said: string) => {
  const found = COMMAND.exec(said.trim())
  return found ? `${found[1]} ${found[2] ?? ''}`.trim() : undefined
}

const timeOf = (row: any) => {
  const at = Date.parse(String(row?.timestamp ?? ''))
  return Number.isNaN(at) ? undefined : at
}

const userText = (content: unknown) =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.filter((block: any) => block?.type === 'text' && typeof block.text === 'string').map((block: any) => block.text).join('\n')
      : ''

// A failed call changed nothing, so it counts nothing, even a Write whose content never reached the file.
export function diffStat(name: string, input: any, output: any, isFailed = false): { added: number; removed: number } {
  if (isFailed) return { added: 0, removed: 0 }
  const patch = Array.isArray(output?.structuredPatch) ? output.structuredPatch : []
  let added = 0
  let removed = 0
  for (const hunk of patch) {
    for (const line of Array.isArray(hunk?.lines) ? hunk.lines : []) {
      if (typeof line !== 'string') continue
      if (line.startsWith('+')) added++
      else if (line.startsWith('-')) removed++
    }
  }
  // A new file has no patch, only its content.
  if (name === 'Write' && patch.length === 0 && typeof input?.content === 'string') added = input.content.split('\n').length
  return { added, removed }
}

const PREVIEW_LINES = 8

const capped = (lines: PreviewLine[]): Preview => ({ lines: lines.slice(0, PREVIEW_LINES), more: Math.max(0, lines.length - PREVIEW_LINES), rest: lines.slice(PREVIEW_LINES) })

export const resultText = (content: unknown) =>
  typeof content === 'string' ? content : Array.isArray(content) ? content.filter((part: any) => part?.type === 'text').map((part: any) => String(part.text ?? '')).join('\n') : ''

const joinText = (parts: unknown[]) => parts.filter((part): part is string => typeof part === 'string' && part.trim() !== '').join('\n')

// A tool with none of the usual fields (ListAgents, SendMessage, ToolSearch, an MCP tool) still shows its text fields.
const outputText = (output: any) => {
  if (Array.isArray(output)) return resultText(output)
  const usual = joinText([output?.stdout, output?.stderr, output?.file?.content, typeof output?.content === 'string' ? output.content : '', Array.isArray(output?.filenames) ? output.filenames.join('\n') : ''])
  if (usual || !output || typeof output !== 'object') return usual
  return joinText(Object.values(output).map(value => (Array.isArray(value) ? joinText(value) : value)))
}

const ESC = String.fromCharCode(27)
const BELL = String.fromCharCode(7)
// Color codes (CSI) and title or link codes (OSC) a shell prints.
const ESCAPES = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]|${ESC}\\][^${BELL}${ESC}]*(?:${BELL}|${ESC}\\\\)`, 'g')

// The engine refuses a row whose text holds a control character, so a preview keeps tabs and drops the rest.
const printable = (line: string) => [...line.replace(ESCAPES, '')].filter(char => char === '\t' || (char >= ' ' && char !== String.fromCharCode(127))).join('')

// An edit shows its patch, a new file its content as added lines; any other call the start of its result.
export function previewOf(name: string, input: any, output: any, result: string): Preview {
  const preview = draftPreview(name, input, output, result)
  const clean = (lines: PreviewLine[]) => lines.map(line => ({ ...line, text: printable(line.text) }))
  return { ...preview, lines: clean(preview.lines), rest: clean(preview.rest) }
}

function draftPreview(name: string, input: any, output: any, result: string): Preview {
  const patch = Array.isArray(output?.structuredPatch) ? output.structuredPatch : []
  const diff: PreviewLine[] = patch.flatMap((hunk: any) =>
    (Array.isArray(hunk?.lines) ? hunk.lines : []).filter((line: unknown) => typeof line === 'string').map((line: string) => ({
      text: line.slice(1),
      kind: line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : 'same',
    })),
  )
  if (diff.length) return capped(diff)
  if (name === 'Write' && typeof input?.content === 'string') return capped(input.content.split('\n').map((line: string) => ({ text: line, kind: 'add' as const })))
  // A background agent's own result is only its launch: the report comes later as a message.
  const body = (output?.isAsync === true ? text.previewBackground : result || outputText(output)).replace(/\s+$/, '')
  return capped(body ? body.split('\n').map(line => ({ text: line, kind: 'out' as const })) : [])
}

// Reads the transcript a line at a time, in file order, so a re-read feeds only the new lines.
export class TurnLog {
  turns: Turn[] = []
  private byId = new Map<string, Turn>()
  private parents = new Map<string, string | undefined>()
  // Each row's previous row in file order, the way past a parent Claude Code never wrote.
  private before = new Map<string, string | undefined>()
  private last: string | undefined
  private numbers: Map<Turn, number> | undefined
  private calls = new Map<string, ToolCall>()
  private foreign = new Set<string>()
  private thinking: string | undefined

  feed(line: string) {
    let row: any
    try {
      row = JSON.parse(line)
    } catch {
      return
    }
    if (typeof row?.uuid !== 'string' || row.isSidechain === true) return
    this.parents.set(row.uuid, row.parentUuid ?? row.logicalParentUuid ?? undefined)
    this.before.set(row.uuid, this.last)
    this.last = row.uuid
    this.numbers = undefined
    const content = row.message?.content
    const current = this.turns[this.turns.length - 1]

    // A subagent's report is a meta row, yet Claude answers it in a turn of its own.
    if (row.type === 'user' && row.isMeta && row.origin?.kind === 'peer') {
      this.start(row.uuid, timeOf(row), true)
      return
    }
    if (row.type === 'user' && !row.isMeta && !row.isCompactSummary && !(Array.isArray(content) && content.some((block: any) => block?.type === 'tool_result'))) {
      const said = userText(content)
      // A local command (/clear) stores no promptId; a skill command does, and Claude answers it in a turn.
      const command = typeof row.promptId === 'string' ? commandOf(said) : undefined
      if (command) this.adoptOrStart(row.uuid, command, timeOf(row)).command = command
      else if (isPrompt(said)) this.adoptOrStart(row.uuid, said, timeOf(row))
      return
    }
    // A meta queued command is a report delivered mid-turn, which stays in the running turn. A prompt with an image holds content blocks, not a string.
    if (row.type === 'attachment' && row.attachment?.type === 'queued_command') {
      const said = userText(row.attachment.prompt)
      if (!row.attachment.isMeta && isPrompt(said)) this.adoptOrStart(row.uuid, said, timeOf(row)).queuedText = said.trim()
      return
    }
    if (!current) return

    if (row.type === 'assistant' && Array.isArray(content)) {
      this.add(current, rowKey(row.uuid))
      const said = content.filter((block: any) => block?.type === 'text' && typeof block.text === 'string' && block.text.trim()).map((block: any) => block.text.trim())
      if (said.length) {
        current.reply = rowKey(row.uuid)
        current.replyText = said.join('\n\n')
      }
      for (const block of content) {
        this.thinking = thoughtAfter(this.thinking, block)
        if (block?.type === 'tool_use' && typeof block.id === 'string') {
          const call: ToolCall = { id: block.id, name: String(block.name), input: block.input, added: 0, removed: 0, startedAt: timeOf(row), thought: this.thinking }
          current.tools.push(call)
          this.calls.set(block.id, call)
          this.add(current, block.id)
        }
      }
      return
    }
    if (row.type === 'user' && Array.isArray(content)) {
      this.add(current, rowKey(row.uuid))
      this.thinking = undefined
      for (const block of content) {
        const call = block?.type === 'tool_result' ? this.calls.get(block.tool_use_id) : undefined
        if (call) Object.assign(call, diffStat(call.name, call.input, row.toolUseResult, block.is_error === true), { endedAt: timeOf(row), preview: previewOf(call.name, call.input, row.toolUseResult, resultText(block.content)), file: fileRecord(call.name, row.toolUseResult, block.is_error === true), asked: askedRecord(call.name, row.toolUseResult) })
      }
      return
    }
    if (row.type === 'system') {
      this.add(current, rowKey(row.uuid))
      if (row.subtype === 'turn_duration' && typeof row.durationMs === 'number') {
        current.durationMs = row.durationMs
        if (current.reply) current.answers.add(current.reply)
      }
    }
  }

  // A turn started by a skill or prompt command, before the transcript holds its row; the row's text is adopted when it lands.
  claimCommand(command: string, at = Date.now()) {
    if (this.turns[this.turns.length - 1]?.liveText === command) return
    this.start(`command-${this.turns.length}`, at)
    const turn = this.turns[this.turns.length - 1]!
    turn.command = command
    turn.liveText = command
  }

  // A row drawn after the transcript was read: a new prompt opens a turn, any other row joins the latest one.
  claim(requestId: string, kind: 'prompt' | 'reply' | 'row', at = Date.now(), isReport = false, text = '') {
    if (this.turnOf(requestId) || this.turnAt(requestId)) return
    if (kind === 'prompt') {
      if (requestId === PLACEHOLDER) return
      const queued = text.trim() ? this.turns.find(turn => turn.queuedText === text.trim()) : undefined
      if (queued) {
        this.drawnAs.set(rowKey(requestId), queued)
        queued.queuedText = undefined
        return
      }
      const drawn = text.trim() && !isReport ? this.turns.find(turn => turn.liveText === text.trim()) : undefined
      if (drawn) {
        this.drawnAs.set(rowKey(requestId), drawn)
        return
      }
      this.start(requestId, at, isReport)
      if (text.trim() && !isReport) this.turns[this.turns.length - 1]!.liveText = text.trim()
      return
    }
    const current = this.turns[this.turns.length - 1]
    if (!current) return
    this.add(current, rowKey(requestId))
    if (kind === 'reply') current.reply = rowKey(requestId)
  }

  // A tool row drawn after the transcript was read: the call joins the latest turn, and ends once its row stops running.
  claimCall(id: string, name: string, input: any, isRunning: boolean, output: any, isFailed = false, at = Date.now()) {
    if (this.foreign.has(id)) return
    let call = this.calls.get(id)
    if (!call) {
      const current = this.turns[this.turns.length - 1]
      if (!current) return
      // A call first seen finished has no start this mod saw, so it shows no time rather than a false one.
      call = { id, name, input, added: 0, removed: 0, startedAt: isRunning ? at : undefined }
      current.tools.push(call)
      this.calls.set(id, call)
      this.add(current, id)
    }
    // A row first draws while its input still streams in, so a later, fuller input replaces the first.
    if (input && Object.keys(input).length >= Object.keys(call.input ?? {}).length) call.input = input
    if (isRunning) return
    // A background agent's launch result names its task, for a row drawn before its input streamed in.
    if ((name === 'Agent' || name === 'Task') && !call.input?.description && typeof output?.description === 'string') call.input = { ...call.input, description: output.description }
    if (call.endedAt === undefined) call.endedAt = at
    // A group's copy of the output may lack the patch its own row carries, so any later count fills in.
    const stat = diffStat(name, call.input, output, isFailed)
    if (stat.added || stat.removed || isFailed) Object.assign(call, stat)
    if (!call.preview?.lines.length) call.preview = previewOf(name, call.input, output, '')
    call.file ??= fileRecord(name, output, isFailed)
    call.asked ??= askedRecord(name, output)
  }

  // Calls claimed as they drew have no thought yet; the session's own messages, read once a turn ends, carry the thinking before each.
  learnThoughts(messages: readonly { role: string; content: readonly any[] }[]) {
    let pending: string | undefined
    for (const message of messages) {
      if (message.role !== 'assistant') {
        pending = undefined
        continue
      }
      for (const block of message.content) {
        pending = thoughtAfter(pending, block)
        const call = block?.type === 'tool_use' ? this.calls.get(block.id) : undefined
        if (call && call.thought === undefined) call.thought = pending
      }
    }
  }

  // The turn a drawn row belongs to.
  turnOf(requestId: string) {
    // A folded group of calls is drawn under its first message's uuid, prefixed.
    const id = requestId.replace(/^collapsed-/, '')
    return this.byId.get(id) ?? this.byId.get(rowKey(id))
  }

  callOf(toolUseId: string) {
    return this.calls.get(toolUseId)
  }

  // A background agent's rows draw in the main view too, sometimes before its call names the agent, so a claim already made is undone.
  dropForeign(toolUseId: string) {
    this.foreign.add(toolUseId)
    const call = this.calls.get(toolUseId)
    const turn = this.byId.get(toolUseId)
    if (!call || !turn) return
    turn.tools = turn.tools.filter(item => item !== call)
    turn.ids.delete(toolUseId)
    this.byId.delete(toolUseId)
    this.calls.delete(toolUseId)
  }

  // Counts only the live branch (the parent chain from the last row), so /rewind's abandoned prompts drop out.
  numberOf(turn: Turn) {
    if (!this.numbers) {
      const live = new Set<string>()
      for (let id = this.last; id !== undefined && !live.has(id); id = this.parentOf(id)) live.add(id)
      this.numbers = new Map()
      let n = 0
      for (const each of this.turns) if (!each.isReport && (!this.parents.has(each.prompt) || live.has(each.prompt))) this.numbers.set(each, ++n)
    }
    return this.numbers.get(turn)
  }

  private parentOf(id: string) {
    const parent = this.parents.get(id)
    return parent !== undefined && !this.parents.has(parent) ? this.before.get(id) : parent
  }

  // The turn a prompt row opens, by its own id or, for a queued prompt, by the id its row was drawn under.
  turnAt(requestId: string) {
    const key = rowKey(requestId)
    return this.drawnAs.get(key) ?? this.turns.find(turn => rowKey(turn.prompt) === key)
  }

  private drawnAs = new Map<string, Turn>()

  // The turns from the session's messages, which the engine holds before the transcript is read; rows join them as they draw.
  static fromMessages(messages: readonly MessageRow[]) {
    const log = new TurnLog()
    messages.forEach((message, n) => {
      if (message.role === 'user') {
        if (!message.toolResults?.length && isPrompt(message.text)) {
          log.start(`guess-${n}`, undefined)
          log.turns[log.turns.length - 1]!.promptText = message.text.trim()
        }
        return
      }
      const current = log.turns[log.turns.length - 1]
      if (!current) return
      if (message.text.trim()) {
        current.texts = [...(current.texts ?? []), message.text.trim()]
        current.replyText = message.text.trim()
      }
      for (const use of message.toolUses) {
        const call: ToolCall = { id: use.tool_use_id, name: use.tool, input: use.input, ...diffStat(use.tool, use.input, use.result, use.isError === true) }
        current.tools.push(call)
        log.calls.set(call.id, call)
        log.add(current, call.id)
      }
    })
    return log
  }

  // Rows draw in transcript order, so a match is looked for from the last matched turn on; duplicates ("ok") then land right.
  private cursor = 0

  // A prompt or text row drawn before the transcript was read joins the guessed turn whose text it carries.
  adopt(requestId: string, kind: 'prompt' | 'text', rowText: string) {
    if (this.turnOf(requestId) || this.turnAt(requestId) || (kind === 'prompt' && requestId === PLACEHOLDER)) return
    const textOf = rowText.trim()
    const order = [...this.turns.keys()]
    for (const n of [...order.slice(this.cursor), ...order.slice(0, this.cursor)]) {
      const turn = this.turns[n]!
      const isMatch = kind === 'prompt' ? turn.promptText === textOf : turn.texts?.some(block => block === textOf || block.includes(textOf))
      if (!isMatch) continue
      this.cursor = n
      if (kind === 'prompt') turn.prompt = requestId
      else {
        this.add(turn, rowKey(requestId))
        if (turn.texts?.[turn.texts.length - 1]?.includes(textOf)) turn.reply = rowKey(requestId)
      }
      return
    }
  }

  // A tool row found by its id moves the cursor too, so the rows after it match from its turn on.
  follow(requestId: string) {
    const turn = this.turnOf(requestId)
    if (turn) this.cursor = this.turns.indexOf(turn)
  }

  // A row with no text or id to match (a turn's duration, a group of thinking) joins the turn of the row drawn before it.
  adoptNear(requestId: string) {
    if (this.turnOf(requestId) || this.turnAt(requestId)) return
    const turn = this.turns[this.cursor]
    if (turn) this.add(turn, rowKey(requestId.replace(/^collapsed-/, '')))
  }

  // A prompt row whose words a live draw already opened a turn for takes that turn over; the draw's id still finds it.
  private adoptOrStart(uuid: string, said: string, at: number | undefined) {
    const drawn = this.turns.find(turn => turn.liveText === said.trim())
    if (!drawn) {
      this.start(uuid, at)
      return this.turns[this.turns.length - 1]!
    }
    this.drawnAs.set(rowKey(drawn.prompt), drawn)
    drawn.prompt = uuid
    drawn.liveText = undefined
    this.numbers = undefined
    return drawn
  }

  private start(uuid: string, at: number | undefined, isReport = false) {
    const turn: Turn = { prompt: uuid, ids: new Set(), answers: new Set(), tools: [], at, ...(isReport ? { isReport } : {}) }
    this.numbers = undefined
    this.turns.push(turn)
    this.thinking = undefined
  }

  private add(turn: Turn, id: string) {
    turn.ids.add(id)
    this.byId.set(id, turn)
  }
}

const tail = (path: string) => String(path ?? '').replace(/\\/g, '/').split('/').filter(Boolean).slice(-2).join('/')

// The one line a folded tool row shows: `Edit(hooks/register.tsx) +3 -1`, `Skill(tidy)`, `Agent(Research docs)`.
export function toolLabel(name: string, input: any, added: number, removed: number) {
  const stat = added || removed ? ` +${added} \u2212${removed}` : ''
  // An input not known yet shows the bare name, never empty parentheses.
  const call = (label: string, detail: unknown) => (detail ? `${label}(${detail})` : label)
  if (name === 'Edit' || name === 'MultiEdit' || name === 'Write' || name === 'NotebookEdit') return `${call(name, tail(input?.file_path ?? input?.notebook_path))}${stat}`
  if (name === 'Skill') return call('Skill', input?.skill)
  if (name === 'Agent' || name === 'Task') return call('Agent', input?.description ?? input?.subagent_type)
  if (name === 'Bash') return call('Bash', String(input?.command ?? '').split('\n')[0])
  if (name === 'Read') return call('Read', tail(input?.file_path))
  if (name === 'Grep' || name === 'Glob') return call(name, [input?.pattern, tail(input?.path)].filter(Boolean).join(` ${MARK.sep} `))
  return call(name, mainArg(input))
}

// The argument that says what a call works on: a path, URL, query or pattern first, else the first text argument.
const MAIN_ARGS = ['file_path', 'path', 'url', 'query', 'pattern', 'command', 'name', 'prompt', 'description', 'text']

function mainArg(input: any): string {
  if (!input || typeof input !== 'object') return ''
  const named = MAIN_ARGS.map(key => input[key]).find(value => typeof value === 'string' && value.trim())
  const value = named ?? Object.values(input).find(each => typeof each === 'string' && each.trim())
  return typeof value === 'string' ? value.split('\n')[0]!.trim() : ''
}

const clock = (ms: number) => {
  const seconds = Math.round(ms / 1000)
  return seconds < 60 ? fill(text.durationSeconds, { s: seconds }) : fill(text.durationMinutes, { m: Math.floor(seconds / 60), s: seconds % 60 })
}

const two = (n: number) => String(n).padStart(2, '0')

// Local wall-clock time, `14:32`, for a prompt and a tool call alike.
export const timeOfDay = (at: number) => {
  const date = new Date(at)
  return `${two(date.getHours())}:${two(date.getMinutes())}`
}

// How long a call took: `0.4s` under a second, then `41s`, `6m 12s`, `1h 3m`.
export const elapsed = (ms: number) => {
  if (ms < 1000) return fill(text.durationSeconds, { s: (Math.max(0, ms) / 1000).toFixed(1) })
  const seconds = Math.round(ms / 1000)
  if (seconds < 3600) return clock(ms)
  return fill(text.durationHours, { h: Math.floor(seconds / 3600), m: Math.floor((seconds % 3600) / 60) })
}

// A call's start and duration for its line, or nothing while either end is unknown.
export const callTime = (call: ToolCall | undefined) =>
  call?.startedAt === undefined || call.endedAt === undefined ? '' : `${timeOfDay(call.startedAt)} · ${elapsed(call.endedAt - call.startedAt)}`

// The head's words: tool count, then each file changed, skill and agent once; counts and the time draw as pills beside it.
export function turnLine(turn: Turn) {
  const named = turn.tools.filter(call => ['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Skill', 'Agent', 'Task'].includes(call.name))
  return [fill(turn.tools.length === 1 ? text.toolCountOne : text.toolCountMany, { n: turn.tools.length }), ...new Set(named.map(call => toolLabel(call.name, call.input, 0, 0)))].join(' · ')
}

export type Kind = 'read' | 'search' | 'edit' | 'shell' | 'web' | 'agent' | 'tool'

const KIND_OF: Record<string, Kind> = {
  Read: 'read',
  Grep: 'search',
  Glob: 'search',
  Edit: 'edit',
  MultiEdit: 'edit',
  Write: 'edit',
  NotebookEdit: 'edit',
  Bash: 'shell',
  PowerShell: 'shell',
  WebFetch: 'web',
  WebSearch: 'web',
  Agent: 'agent',
  Task: 'agent',
}

const KIND_LABEL = (kind: Kind, n: number) => fill(n === 1 ? text.kind[kind].one : text.kind[kind].many, { n })

// A finished turn's calls, one group per kind in order of first use, with the group's line counts.
export function turnKinds(turn: Turn) {
  const groups = new Map<Kind, ToolCall[]>()
  for (const call of turn.tools) {
    const kind = KIND_OF[call.name] ?? 'tool'
    groups.set(kind, [...(groups.get(kind) ?? []), call])
  }
  return [...groups].map(([kind, calls]) => ({
    kind,
    label: KIND_LABEL(kind, calls.length),
    calls,
    added: calls.reduce((sum, call) => sum + call.added, 0),
    removed: calls.reduce((sum, call) => sum + call.removed, 0),
  }))
}

// What Claude thought across a turn, once per thinking: calls asked in parallel share one.
export const turnThoughts = (turn: Turn) => [...new Set(turn.tools.filter(call => call.thought !== undefined).map(call => call.thought!))]

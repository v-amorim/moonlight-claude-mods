// mod-progress / hooks/progress.ts, by v-amorim
// The data side of the mod: gates files, loop figures, rows. No `$` in here, so tests call it directly.
import marks from './marks'
import style from './style'
import text from './text'
import { fill } from './theme'

// 'pending' is a checked box whose EVIDENCE is missing or still `pending`.
export type GateState = 'met' | 'open' | 'pending' | 'abandoned'
// `file` names the gates/<file>.md a gate came from, none for GATES.md; the stamps are first read and last state change.
export type Gate = { id: string; text: string; state: GateState; file?: string; firstSeenAt?: number; changedAt?: number }
export type Task = { id: string; subject: string; status: string }
// A workflow script's agent: no list entry names it, so its run, place, name and task are kept from its spawn.
export type WorkflowAgent = { runId: string; index: number; name: string; description: string }
// A background shell or monitor an agent started: it ends by TaskStop, its notification, or a Stop that no longer lists it.
export type BgKind = 'shell' | 'monitor'
// `output` is the file the host writes the task's output to, when its result or notification names one.
export type BgTask = { id: string; kind: BgKind; command: string; startedAt: number; endedAt?: number; end?: 'done' | 'failed'; output?: string }
export type Loop = { bg?: BgTask[]; model?: string; effort?: string; tokens: number; context: number; spawnedAt?: number; endedAt?: number; isFailed?: true; gatesStem?: string; tasks?: Task[]; step?: string; workflow?: WorkflowAgent }
export type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

// The main turn's last stop on an API error (StopFailure): its error kind, when it happened, and the reset of a full usage window.
export type Stop = { error: string; at: number; resetsAt?: string }

// Kept in $.store under the session id, so a reload keeps it and another session starts clean.
export type Snap = {
  sid: string
  busy: boolean
  startedAt?: number
  main: Loop
  agents: Record<string, Loop>
  tasks: Task[]
  gates: Record<string, Gate[]>
  expanded: string
  // The pane's view of the loops; a missing value is the cards.
  view?: 'cards' | 'timeline'
  // The cards whose background tasks are folded to their count; the rest show them.
  folded?: string[]
  stop?: Stop
}

export const MAIN_GATES = 'GATES'

export const emptySnap = (sid: string): Snap => ({ sid, busy: false, main: { tokens: 0, context: 0 }, agents: {}, tasks: [], gates: {}, expanded: '' })

const GATE_RE = /^- \[( |x|X)\] (.*)$/
const ATTR_RE = /^\s+(CHECK|EXPECT|EVIDENCE):\s?(.*)$/
const ABANDON_RE = /^ABANDON:\s*(\S+)\s*(.*)$/

// A box is met only when checked and its EVIDENCE is no longer pending; ABANDON lines give a gate up.
export function parseGates(source: string): Gate[] {
  const found: { id: string; text: string; checked: boolean; evidence: string | null }[] = []
  const abandoned = new Set<string>()
  let current: (typeof found)[number] | null = null
  source.split(/\r?\n/).forEach((line, at) => {
    const gate = GATE_RE.exec(line)
    if (gate) {
      const body = gate[2]!.trim()
      const id = /^(\S+?):/.exec(body)?.[1] ?? `line${at + 1}`
      current = { id, text: body.replace(/^\S+?:\s*/, ''), checked: gate[1]!.toLowerCase() === 'x', evidence: null }
      found.push(current)
      return
    }
    const attr = current ? ATTR_RE.exec(line) : null
    if (attr) {
      if (attr[1] === 'EVIDENCE') current!.evidence = attr[2]!.trim()
      return
    }
    const gone = ABANDON_RE.exec(line)
    if (gone) abandoned.add(gone[1]!.replace(/:$/, ''))
    if (/^#|^- /.test(line)) current = null
  })
  return found.map(each => ({
    id: each.id,
    text: each.text,
    state: abandoned.has(each.id) ? 'abandoned' : !each.checked ? 'open' : each.evidence && !/^pending$/i.test(each.evidence) ? 'met' : 'pending',
  }))
}

// Carries each gate's stamps over a re-read, matching on file and id; a gate whose state changed gets a new changedAt.
export function mergeStamps(before: Gate[] | undefined, after: Gate[], now: number): Gate[] {
  return after.map(gate => {
    const was = before?.find(each => each.id === gate.id && each.file === gate.file)
    return { ...gate, firstSeenAt: was?.firstSeenAt ?? now, changedAt: was && was.state === gate.state ? (was.changedAt ?? now) : now }
  })
}

export type GateGroup = { state: GateState; gates: Gate[] }

// Open, waiting, met, then dropped; a group with no gates is left out.
export const groupGates = (gates: Gate[]): GateGroup[] =>
  (['open', 'pending', 'met', 'abandoned'] as const).map(state => ({ state, gates: gates.filter(gate => gate.state === state) })).filter(group => group.gates.length > 0)

// The strip fills from the left like a bar: met, waiting, open, then dropped, each in file order.
export const stripOrder = (gates: Gate[]) => (['met', 'pending', 'open', 'abandoned'] as const).flatMap(state => gates.filter(gate => gate.state === state))

export const waitingCount =(rows: Row[]) => [...new Set(rows.flatMap(row => row.gates))].filter(gate => gate.state === 'pending').length

// Past `room` each state gets its share of cells, at least one, so an unfinished strip never draws all full.
export function stripCells(gates: Gate[], room: number): GateState[] {
  const ordered = stripOrder(gates).map(gate => gate.state)
  if (ordered.length <= room) return ordered
  if (room <= 0) return []
  const states = (['met', 'pending', 'open', 'abandoned'] as const).map(state => ({ state, count: ordered.filter(each => each === state).length })).filter(each => each.count > 0)
  const shares = states.map(each => ({ ...each, cells: Math.floor((each.count * room) / ordered.length), rest: ((each.count * room) / ordered.length) % 1 }))
  for (const each of [...shares].sort((a, b) => b.rest - a.rest).slice(0, room - shares.reduce((sum, each) => sum + each.cells, 0))) each.cells++
  for (const each of shares.filter(share => share.cells === 0)) {
    const donor = shares.reduce((most, share) => (share.cells > most.cells ? share : most))
    if (donor.cells > 1) donor.cells--, each.cells++
  }
  return shares.flatMap(each => Array.from({ length: each.cells }, () => each.state))
}

// `value` cut to `room` columns, ending in … when it was longer.
export const cutText = (value: string, room: number) => (value.length <= room ? value : room <= 1 ? '…'.slice(0, Math.max(0, room)) : `${value.slice(0, room - 1)}…`)

export const isGatesPath = (path: string) => /(^|\/)(GATES\.md|gates\/[^/]+\.md)$/i.test(path.replace(/\\/g, '/'))

export const stemOf = (file: string) => file.replace(/\.md$/i, '')

// The first gates file a brief names, as gates/<stem>.md.
export const gatesStemIn = (prompt: string) => prompt.replace(/\\/g, '/').match(/gates\/([^/\s`'")]+)\.md/i)?.[1]

// An agent's gates file: the one its brief names, else gates/<name>.md, else the description's first word ("leaf-1.1.1: ...").
export const gatesOf = (snap: { gates: Record<string, Gate[]> }, info: { name?: string; description: string }, stem?: string) =>
  (stem ? snap.gates[stem] : undefined) ?? (info.name ? snap.gates[info.name] : undefined) ?? snap.gates[info.description.trim().split(/\s+/)[0]?.replace(/:$/, '') ?? '']

export function applyStep(snap: Snap, agentId: string | undefined, model: string, effort: unknown, usage: Usage | null | undefined) {
  const loop = agentId ? (snap.agents[agentId] ??= { tokens: 0, context: 0 }) : snap.main
  loop.model = model
  if (typeof effort === 'string') loop.effort = effort
  else delete loop.effort
  if (usage) {
    loop.tokens += usage.output_tokens
    loop.context = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
  }
}

// The main session's tasks sit on the snap, an agent's on its loop.
export function applyTask(owner: { tasks?: Task[] }, tool: string, input: Record<string, unknown>, createdId?: string) {
  const tasks = (owner.tasks ??= [])
  if (tool === 'TaskCreate' && createdId) tasks.push({ id: createdId, subject: String(input.subject ?? ''), status: 'pending' })
  if (tool !== 'TaskUpdate') return
  const task = tasks.find(each => each.id === String(input.taskId))
  if (!task) return
  if (input.status === 'deleted') owner.tasks = tasks.filter(each => each !== task)
  else {
    if (typeof input.status === 'string') task.status = input.status
    if (typeof input.subject === 'string') task.subject = input.subject
  }
}

const baseName = (path: string) => path.replace(/\\/g, '/').split('/').pop() ?? ''
const hostOf = (url: string) => /^https?:\/\/([^/?#]+)/i.exec(url)?.[1] ?? url

// A call with no file, pattern or command to name shows the tool's own name.
export function stepOf(tool: string, input: Record<string, unknown>) {
  const slot = (key: string) => (typeof input[key] === 'string' ? (input[key] as string).replace(/\s+/g, ' ').trim() : '')
  const named = (template: string, value: string) => (value ? fill(template, { what: value }) : tool)
  switch (tool) {
    case 'Read':
      return named(text.stepRead, baseName(slot('file_path')))
    case 'Edit':
    case 'MultiEdit':
      return named(text.stepEdit, baseName(slot('file_path')))
    case 'Write':
      return named(text.stepWrite, baseName(slot('file_path')))
    case 'Grep':
    case 'Glob':
      return named(text.stepSearch, slot('pattern'))
    case 'Bash':
      return slot('description') || named(text.stepRun, slot('command').split(' ')[0] ?? '')
    case 'WebFetch':
      return named(text.stepFetch, hostOf(slot('url')))
    case 'Agent':
      return text.stepAgent
    default:
      return tool
  }
}

const BOOKKEEPING = new Set(['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TodoWrite'])

export function applyCall(snap: Snap, agentId: string | undefined, tool: string, input: Record<string, unknown>) {
  const loop = agentId ? snap.agents[agentId] : snap.main
  // Task bookkeeping says nothing about the work, so the step before it stays.
  if (loop && !BOOKKEEPING.has(tool)) loop.step = stepOf(tool, input)
}

const FAMILIES = ['opus', 'sonnet', 'haiku']
const HUES = style.colors.models as Record<string, string>

// The family and version read from a model id, the family alone from an alias, the raw id from anything else.
export function modelInfo(model: string | undefined) {
  if (!model) return { name: '', family: 'inherit', hue: HUES.inherit! }
  const family = FAMILIES.find(each => model.toLowerCase().includes(each))
  if (!family) return { name: model.replace(/^claude-/, ''), family: 'inherit', hue: HUES.inherit! }
  const label = family[0]!.toUpperCase() + family.slice(1)
  const version = new RegExp(`${family}-(\\d+)(?:[-.](\\d{1,2}))?(?!\\d)`, 'i').exec(model)
  return { name: version ? `${label} ${version[1]}${version[2] ? `.${version[2]}` : ''}` : label, family, hue: HUES[family]! }
}

// A request never exceeds its window, so context past the default proves the 1M window; a 1M main session gives its agents 1M too.
export function windowFor(model: string | undefined, mainModel: string | undefined, mainWindow: number | undefined, context = 0) {
  if (model?.includes('[1m]') || context > marks.windows.default) return marks.windows.oneMillion
  if (mainWindow && model === mainModel) return mainWindow
  return (mainWindow ?? 0) >= marks.windows.oneMillion ? marks.windows.oneMillion : marks.windows.default
}

export const gaugeColor = (percent: number) => {
  const at = marks.gaugeFrom.reduce((found, from, index) => (percent >= from ? index : found), 0)
  return style.colors.usage[at]!
}

export function formatTokens(count: number) {
  if (count < 1000) return String(count)
  if (count < 100000) return `${(count / 1000).toFixed(1)}k`
  if (count < 1000000) return `${Math.round(count / 1000)}k`
  return `${(count / 1000000).toFixed(1)}M`
}

export function formatElapsed(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`
}

// Finished tasks stay on their card, but only this many per owner.
const KEEP_ENDED = 12

const bgOwner = (snap: Snap, agentId: string | undefined) => (agentId ? snap.agents[agentId] : snap.main)

const ID_KEYS = ['backgroundTaskId', 'background_task_id', 'shellId', 'shell_id', 'taskId', 'task_id', 'id']

// The id a background start answers with, from its structured result or its text ("... running in background with ID: b3k9x").
export function bgIdOf(result: unknown): string | undefined {
  const found = (value: unknown): string | undefined => {
    if (!value || typeof value !== 'object') return undefined
    for (const key of ID_KEYS) {
      const id = (value as Record<string, unknown>)[key]
      if (typeof id === 'string' && id) return id
    }
    return undefined
  }
  const record = result as { result?: unknown; text?: unknown } | undefined
  const direct = found(record?.result) ?? found(record)
  if (direct) return direct
  const body = [typeof record?.text === 'string' ? record.text : '', typeof record?.result === 'string' ? record.result : '', JSON.stringify(record?.result ?? '')].join('\n')
  return /\bID:?\s+([A-Za-z0-9_-]+)/.exec(body)?.[1] ?? /task[_ -]?id\W+([A-Za-z0-9_-]+)/i.exec(body)?.[1]
}

// A background Bash call, or a Monitor, starts a task; its tool name and input say which and what it runs.
// A foreground Bash the host moved to the background (ctrl+b, or its timeout) answers with a task id too: `isMoved`.
export function bgStartOf(tool: string, input: Record<string, unknown>, isMoved = false): { kind: BgKind; command: string } | undefined {
  if (tool === 'Bash' && (input.run_in_background === true || isMoved)) return { kind: 'shell', command: String(input.command ?? '') }
  if (tool === 'Monitor') return { kind: 'monitor', command: String(input.command ?? input.description ?? '') }
  return undefined
}

export function addBg(snap: Snap, agentId: string | undefined, id: string, start: { kind: BgKind; command: string; output?: string }, now: number) {
  const owner = agentId ? (snap.agents[agentId] ??= { tokens: 0, context: 0 }) : snap.main
  const list = (owner.bg ??= [])
  if (list.some(task => task.id === id)) return false
  list.push({ id, kind: start.kind, command: start.command, startedAt: now, ...(start.output ? { output: start.output } : {}) })
  const ended = list.filter(task => task.endedAt !== undefined)
  if (ended.length > KEEP_ENDED) owner.bg = list.filter(task => !ended.slice(0, ended.length - KEEP_ENDED).includes(task))
  return true
}

// Marks a task ended wherever it lives; true when it was running.
export function endBg(snap: Snap, id: string, end: 'done' | 'failed', now: number) {
  for (const owner of [snap.main, ...Object.values(snap.agents)]) {
    const task = owner.bg?.find(each => each.id === id)
    if (!task || task.endedAt !== undefined) continue
    task.endedAt = now
    task.end = end
    return true
  }
  return false
}

// The file a start's text names ("Output is being written to: <path>"), or a notification's <output-file>.
export const bgOutputOf = (source: string) => /<output-file>\s*(.+?)\s*<\/output-file>/.exec(source)?.[1] ?? /written to:\s*(.+?\.output)(?=\.?\s|$)/.exec(source)?.[1]

export const findBg = (snap: Snap, id: string) => [snap.main, ...Object.values(snap.agents)].flatMap(loop => loop.bg ?? []).find(task => task.id === id)

// The lines a task's output keeps, and what it holds of a line still being written.
export const TAIL_LINES = 20
// What a page holds while it is open: every line up to this many, the last ones when the output is longer.
export const HELD_LINES = 400
export type Tail = { from: number; lines: string[]; partial: string }

// Output is the program's own text: escapes and control characters never reach the screen.
export const stripControl = (value: string) =>
  value
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b[@-Z\\-_]/g, '')
    .replace(/\t/g, '  ')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')

// Adds what was written since the last read, keeping the last TAIL_LINES lines; `size` is the file's length in bytes.
export function appendTail(tail: Tail, chunk: string, size: number, keep = TAIL_LINES): Tail {
  const parts = (tail.partial + chunk.replace(/\r\n?/g, '\n')).split('\n')
  const partial = parts.pop() ?? ''
  const lines = [...tail.lines, ...parts.map(stripControl)].slice(-keep)
  return { from: size, lines, partial: stripControl(partial) }
}

// The columns a card's lines have: the pane's padding, then the card's border and padding.
export const cardWidth = (bodyColumns: number) => Math.max(1, bodyColumns - 6)

// The rows these lines take wrapped at `width`, one at least each.
export const wrappedRows = (lines: string[], width: number) => lines.reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / width)), 0)

// How many output lines the page has room for: the body less the back pill row, the command card (border, a gap above, its wrapped lines), the output card's border and gap, and the rows the footer keeps free; never under one.
export function outputRoom(bodyRows: number, bodyColumns: number, command: string, lead: string, footerRows: number) {
  const width = cardWidth(bodyColumns)
  const commandRows = wrappedRows(command.split(/\r?\n/).map((line, at) => `${at === 0 ? lead : ' '} ${line}`), width)
  return Math.max(1, bodyRows - (1 + 3 + commandRows + 3 + footerRows))
}

// What a task's page draws: the whole command, its status line figures, and where its output lives.
export function pageOf(snap: Snap, id: string, now: number) {
  const task = findBg(snap, id)
  if (!task) return undefined
  const status: Status = task.endedAt === undefined ? 'running' : task.end === 'failed' ? 'failed' : 'done'
  return { kind: task.kind, command: task.command, status, elapsed: formatClock((task.endedAt ?? now) - task.startedAt), output: task.output }
}

export const endOfStatus = (status: string | undefined): 'done' | 'failed' => (status === 'failed' || status === 'killed' || status === 'stopped' ? 'failed' : 'done')

// A Stop lists what still runs: every running task of that owner missing from it has finished.
export function resyncBg(snap: Snap, agentId: string | undefined, listed: { id: string; status: string }[], now: number) {
  let changed = false
  for (const task of bgOwner(snap, agentId)?.bg ?? []) {
    if (task.endedAt !== undefined) continue
    const still = listed.find(each => each.id === task.id)
    if (still && statusOf(still.status) === 'running') continue
    task.endedAt = now
    task.end = still ? endOfStatus(still.status) : 'done'
    changed = true
  }
  return changed
}

// A Claude Code exit or restart kills its shells and monitors, so what survives in the store is stale.
export function wipeBg(snap: Snap) {
  const owners = [snap.main, ...Object.values(snap.agents)].filter(loop => loop.bg && loop.bg.length > 0)
  owners.forEach(loop => delete loop.bg)
  return owners.length > 0
}

export const hasRunningBg = (snap: Snap) => [snap.main, ...Object.values(snap.agents)].some(loop => loop.bg?.some(task => task.endedAt === undefined))

// 4m 10s: a task's clock keeps its seconds.
export function formatClock(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
  return `${Math.floor(seconds / 3600)}h ${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}m`
}

export type AgentLite = { id: string; name?: string; description: string; type: string; status: string }
export type UsageLite = { tokens?: number; window?: number; percent?: number; startedAt?: number }
export type Status = 'running' | 'done' | 'failed'

// What a card draws for one background task; a finished one keeps its final elapsed time.
export type RowTask = { id: string; kind: BgKind; command: string; status: Status; elapsed: string }

export type Row = {
  id: string
  isMain: boolean
  name: string
  description: string
  status: Status
  model: string
  hue: string
  // The workflow run this agent belongs to; the rows of one run sit together.
  run?: string
  effort: string | undefined
  percent: number | undefined
  tokens: number
  elapsed: string
  gates: Gate[]
  hasGates: boolean
  tasks: RowTask[]
  // When the loop began and, once over, ended: the timeline's lane runs from one to the other.
  startedAt?: number
  endedAt?: number
  // The main ledger reads from gates files and none is open: every written phase is finished, which says nothing about the ones not written yet.
  isPhaseDone?: boolean
}

// Agents that share a name (two of one type) are told apart by what they do; the hover tip keeps the name.
export const laneLabels = (rows: Pick<Row, 'isMain' | 'name' | 'description'>[]) =>
  rows.map(row => (row.isMain || !row.description.trim() || rows.filter(other => other.name === row.name).length < 2 ? row.name : row.description))

export const statusOf = (status: string): Status => (status === 'completed' ? 'done' : status === 'failed' || status === 'killed' ? 'failed' : 'running')

// Marks an agent that stopped as ended at the first look that saw it stopped; true when something changed.
export function settle(snap: Snap, list: AgentLite[], now: number) {
  let changed = false
  for (const info of list) {
    const loop = (snap.agents[info.id] ??= { tokens: 0, context: 0 })
    if (statusOf(info.status) !== 'running' && loop.endedAt === undefined) {
      loop.endedAt = now
      delete loop.step
      changed = true
    }
  }
  return changed
}

export const firstLine = (text: string) => (text.split('\n')[0] ?? '').trim()

const tasksOf = (loop: Loop, now: number): RowTask[] =>
  (loop.bg ?? []).map(task => ({ id: task.id, kind: task.kind, command: firstLine(task.command), status: task.endedAt === undefined ? 'running' : task.end === 'failed' ? 'failed' : 'done', elapsed: formatClock((task.endedAt ?? now) - task.startedAt) }))

// A workflow agent ends with its own turn; true when this marked it.
export function finishAgent(snap: Snap, id: string, now: number, isFailed: boolean) {
  const loop = snap.agents[id]
  if (!loop?.workflow || loop.endedAt !== undefined) return false
  loop.endedAt = now
  if (isFailed) loop.isFailed = true
  delete loop.step
  return true
}

const taskGate = (task: Task): Gate => ({ id: `#${task.id}`, text: task.subject, state: task.status === 'completed' ? 'met' : 'open' })

// One rule for main and every agent: a gates file with entries wins over the task list.
const gatesFor = (file: Gate[] | undefined, tasks: Task[] = []) => (file && file.length > 0 ? file : tasks.map(taskGate))

// The call's phrase shows only while the loop runs, so a finished card keeps its description.
const shownDescription = (loop: Loop, status: Status, description: string) => (status === 'running' && loop.step ? loop.step : description)

// The main session first, then each agent in spawn order.
export function buildRows(snap: Snap, list: AgentLite[], usage: UsageLite | undefined, now: number, mainName: string, mainTask: string, mainModel: string | undefined): Row[] {
  const { main } = snap
  const model = main.model ?? mainModel
  // The main ledger is GATES.md plus every gates/<name>.md.
  const ledger = Object.entries(snap.gates).sort(([a], [b]) => Number(b === MAIN_GATES) - Number(a === MAIN_GATES)).flatMap(([, gates]) => gates)
  const mainGates = gatesFor(ledger, snap.tasks)
  const window = windowFor(model, model, usage?.window)
  const started = usage?.startedAt ?? snap.startedAt
  const percent = (loop: Loop, size: number) => (loop.context > 0 ? Math.min(100, Math.round((loop.context / size) * 100)) : undefined)
  const doing = snap.tasks.find(task => task.status === 'in_progress') ?? snap.tasks.find(task => task.status !== 'completed')
  const mainStatus: Status = snap.busy ? 'running' : 'done'
  const rows: Row[] = [{
    id: 'main',
    isMain: true,
    name: mainName,
    description: shownDescription(main, mainStatus, doing?.subject ?? mainTask),
    status: mainStatus,
    model: model ?? '',
    hue: modelInfo(model).hue,
    effort: main.effort,
    percent: usage?.percent ?? percent(main, window),
    tokens: main.tokens,
    elapsed: started === undefined ? '' : formatElapsed(now - started),
    gates: mainGates,
    hasGates: mainGates.length > 0,
    tasks: tasksOf(main, now),
    ...(started === undefined ? {} : { startedAt: started }),
    ...(mainStatus === 'running' ? {} : { endedAt: main.endedAt ?? now }),
    isPhaseDone: ledger.length > 0 && !ledger.some(gate => gate.state === 'open' || gate.state === 'pending'),
  }]
  const listed = new Set(list.map(info => info.id))
  const ofWorkflow = Object.entries(snap.agents)
    .filter(([id, loop]) => loop.workflow && !listed.has(id))
    .sort(([, a], [, b]) => (a.spawnedAt ?? 0) - (b.spawnedAt ?? 0) || a.workflow!.index - b.workflow!.index)
  // Only agent.spawn in this session sets spawnedAt, so a finished agent without it ran before a /clear or resume and has no figures here.
  const ours = list.filter(info => statusOf(info.status) === 'running' || snap.agents[info.id]?.spawnedAt !== undefined)
  const entries = [
    ...ours.map(info => ({ info, loop: snap.agents[info.id] ?? { tokens: 0, context: 0 }, status: statusOf(info.status) })),
    ...ofWorkflow.map(([id, loop]) => ({ info: { id, name: loop.workflow!.name, description: loop.workflow!.description, type: '', status: loop.endedAt === undefined ? 'running' : loop.isFailed ? 'failed' : 'completed' }, loop, status: (loop.endedAt === undefined ? 'running' : loop.isFailed ? 'failed' : 'done') as Status })),
  ]
  for (const { info, loop, status } of entries) {
    const gates = gatesFor(gatesOf(snap, info, loop.gatesStem), loop.tasks)
    rows.push({
      id: info.id,
      isMain: false,
      name: info.name ?? info.type,
      description: shownDescription(loop, status, info.description),
      status,
      model: loop.model ?? '',
      hue: modelInfo(loop.model).hue,
      ...(loop.workflow ? { run: loop.workflow.runId } : {}),
      effort: loop.effort,
      percent: percent(loop, windowFor(loop.model, model, usage?.window, loop.context)),
      tokens: loop.tokens,
      elapsed: loop.spawnedAt === undefined ? '' : formatElapsed((loop.endedAt ?? now) - loop.spawnedAt),
      gates,
      hasGates: gates.length > 0,
      tasks: tasksOf(loop, now),
      ...(loop.spawnedAt === undefined ? {} : { startedAt: loop.spawnedAt }),
      ...(loop.endedAt === undefined ? {} : { endedAt: loop.endedAt }),
    })
  }
  return rows
}

export const countGates = (gates: Gate[]) => ({ done: gates.filter(gate => gate.state === 'met').length, total: gates.length })

// The band pill's badge: the agents besides the main session and the background tasks of any card that are running.
export function bandSummary(rows: Row[]) {
  // The main ledger holds the gates of every file, and an agent paired with a file lists the same objects again.
  const gates = countGates([...new Set(rows.flatMap(row => row.gates))])
  const running = rows.filter(row => !row.isMain && row.status === 'running').length + rows.reduce((sum, row) => sum + row.tasks.filter(task => task.status === 'running').length, 0)
  return { count: running, ...gates }
}

export type LaneLoop = { start?: number; end?: number; isRunning: boolean }

// Each loop's cells on one clock from the earliest start to now (or the last end): a running loop reaches the right edge, a loop with no start begins at the clock's, a zero-length one still takes a cell.
export function laneCells(loops: LaneLoop[], now: number, width: number): { from: number; to: number }[] {
  const cells = Math.max(1, width)
  const starts = loops.flatMap(loop => (loop.start === undefined ? [] : [loop.start]))
  const first = starts.length > 0 ? Math.min(...starts) : now
  const endOf = (loop: LaneLoop) => (loop.isRunning ? now : (loop.end ?? loop.start ?? first))
  const last = Math.max(first + 1, ...loops.map(endOf))
  const at = (time: number) => ((time - first) / (last - first)) * cells
  return loops.map(loop => {
    const from = Math.min(cells - 1, Math.max(0, Math.floor(at(loop.start ?? first))))
    return { from, to: loop.isRunning ? cells : Math.min(cells, Math.max(from + 1, Math.round(at(endOf(loop))))) }
  })
}

export const NAME_CELLS = 16

// The timeline row's columns, which add up to the width: lead and cursor, mark, name, lane, duration, one trailing space, with a space between each.
export function timelineCols(width: number, durCells: number) {
  const name = width >= 34 ? NAME_CELLS : Math.max(6, width - 18)
  return { name, dur: durCells, lane: Math.max(1, width - (2 + 1 + 1 + name + 1 + 1 + durCells + 1)) }
}

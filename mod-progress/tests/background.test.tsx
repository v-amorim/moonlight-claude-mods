// mod-progress / tests/background.test.tsx, by v-amorim
// Tests background shells and monitors: start from a tool result, owner card, end by TaskStop, notification and Stop, clock, pill count.
import { expect, mock, test } from 'claude-code/testing'

import { addBg, appendTail, bandSummary, outputRoom, wrappedRows, bgIdOf, bgStartOf, buildRows, emptySnap, endBg, endOfStatus, formatClock, hasRunningBg, resyncBg, stripControl, type Snap } from '../hooks/progress'
import { cardFill } from '../hooks/look'
import { THEME } from '../hooks/theme'

const norm = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

const BRIDGE_FILE = '/home/u/.claude/mods-data/mod-progress/bridge/sid-1.jsonl'

type On = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[1]

const AGENT = { id: 'a1', name: 'leaf-1.1.1', description: 'Build the leaf', type: 'general-purpose', status: 'running' }
const START = 14 * 60 * 1000

const PANE = { plugin: 'mod-progress', surface: 'terminal', component: 'Pane', requestId: 'progress', props: { title: 'Progress', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } } as never

const NOTIFY = (id: string, status: string) => `<task-notification>\n<task-id>${id}</task-id>\n<status>${status}</status>\n<summary>Background command done</summary>\n</task-notification>`

// `files` holds each output file's content; `reads.stat` counts how often the mod stats one.
function stubEngine(on: On, agents: unknown[] = [], files: Record<string, string> = {}) {
  const states = new Map<string, unknown>()
  const ids = { sid: 'sid-1' }
  // How long the tool takes to answer a call, on the test's clock.
  const took = { ms: 0 }
  const reads = { stat: 0 }
  const store = new Map<string, unknown>()
  const clock = mock.clock(on, { now: START })
  on('session.id', () => ({ value: ids.sid }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }) as never)
  on('session.cwd', () => ({ value: '/w' }))
  on('session.repo', () => ({ value: null }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000, percent: 46, tokens: 92000 }, rateLimits: [] } }))
  on('agent.list', () => ({ value: agents }) as never)
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined } as never
  })
  // The bridge file the command hooks append to; a test that sets `bridge.on` before session.start gets the poll.
  const bridge = { on: false, text: '' }
  on('fs.read', (_$, e) => {
    if (norm(e.path) === BRIDGE_FILE) return { value: bridge.text }
    if (norm(e.path) in files) return { value: files[norm(e.path)]! }
    throw new Error('ENOENT')
  })
  on('fs.stat', (_$, e) => {
    if (!(norm(e.path) in files)) throw new Error('ENOENT')
    reads.stat++
    return { value: { kind: 'file', size: new TextEncoder().encode(files[norm(e.path)]!).length, mtimeMs: 0, isLink: false } } as never
  })
  on('fs.exists', () => ({ value: false }))
  on('fs.list', () => ({ value: [] }))
  on('env.get', (_$, e) => ({ value: bridge.on && (e as { name?: string }).name === 'USERPROFILE' ? '/home/u' : undefined }))
  on('store.delete', (_$, e) => {
    store.delete(e.key)
    return { value: undefined } as never
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('ui.panes', () => ({ value: [{ id: 'progress', isPlaced: true }] }) as never)
  on('session.start', () => ({ cwd: '/w' }))
  on('command.register', () => ({ value: { command: 'mod-progress' } }))
  on('state.get', (_$, e) => ({ value: { value: states.get(`${e.plugin}.${e.key}`) } }) as never)
  on('state.set', (_$, e) => {
    states.set(`${e.plugin}.${e.key}`, e.value)
    return { value: undefined } as never
  })
  let started = 0
  on('tool.call', async (_$, e) => {
    if (took.ms) await clock.advance(took.ms)
    if (e.tool === 'Monitor' || (e.tool === 'Bash' && (e.run_in_background || String(e.command).includes('moved')))) {
      const id = `bg${++started}`
      return { result: { stdout: '', stderr: '', backgroundTaskId: id }, text: `Command running in background with ID: ${id}. Output is being written to: /tmp/${id}.output. You will be notified when it completes. To check interim output, use Read on that file path.` } as never
    }
    return { result: {} } as never
  })
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  // Hands one record to the mod the way the command hook does: appended to the session's file, read by the next poll.
  const feed = async (event: string, body: object = {}) => {
    bridge.text += `${JSON.stringify({ session_id: ids.sid, hook_event_name: event, ...body })}\n`
    await clock.advance(250)
  }
  return { store, clock, states, reads, ids, took, bridge, feed }
}

const shellCall = (command: string, agentId?: string) => ({ tool: 'Bash', command, run_in_background: true, ...(agentId ? { agentId } : {}) }) as never
const stopBody = (tasks: { id: string; status: string }[], extra: object = {}) => ({ background_tasks: tasks.map(task => ({ ...task, type: 'shell', description: 'd' })), ...extra }) as never

test('a background task starts from its result: the id by key or by text, a monitor by its tool, and a foreground call starts nothing', () => {
  expect(bgIdOf({ result: { stdout: '', backgroundTaskId: 'b3k9x' } })).toBe('b3k9x')
  expect(bgIdOf({ result: { stdout: '' }, text: 'Command running in background with ID: bdw577nhi. Output is being written to: /t/bdw577nhi.output' })).toBe('bdw577nhi')
  expect(bgIdOf({ result: { stdout: 'ok' } })).toBeUndefined()
  expect(bgStartOf('Bash', { command: 'sleep 30', run_in_background: true })).toEqual({ kind: 'shell', command: 'sleep 30' })
  expect(bgStartOf('Bash', { command: 'ls' })).toBeUndefined()
  expect(bgStartOf('Monitor', { command: 'tail -f a.log', description: 'Watch' })).toEqual({ kind: 'monitor', command: 'tail -f a.log' })
  expect(bgStartOf('Read', { run_in_background: true })).toBeUndefined()
})

test('tasks end where they live, and a finished task keeps its clock at the end', () => {
  const snap = emptySnap('s')
  snap.agents.a1 = { tokens: 0, context: 0 }
  expect(addBg(snap, undefined, 'b1', { kind: 'shell', command: 'sleep 30' }, 1000)).toBe(true)
  expect(addBg(snap, undefined, 'b1', { kind: 'shell', command: 'sleep 30' }, 1000)).toBe(false)
  addBg(snap, 'a1', 'b2', { kind: 'monitor', command: 'tail -f a.log' }, 2000)
  addBg(snap, 'a1', 'b3', { kind: 'shell', command: 'npm test' }, 2000)
  expect(addBg(snap, 'late', 'b4', { kind: 'shell', command: 'x' }, 2000)).toBe(true)
  expect(snap.agents.late!.bg).toHaveLength(1)
  expect(hasRunningBg(snap)).toBe(true)

  expect(endBg(snap, 'b1', 'failed', 5000)).toBe(true)
  expect(endBg(snap, 'b1', 'done', 9000)).toBe(false)
  expect(resyncBg(snap, 'a1', [{ id: 'b2', status: 'running' }], 7000)).toBe(true)
  expect(snap.agents.a1!.bg!.map(task => [task.id, task.endedAt, task.end])).toEqual([['b2', undefined, undefined], ['b3', 7000, 'done']])
  expect(resyncBg(snap, undefined, [{ id: 'b1', status: 'failed' }], 8000)).toBe(false)
  expect(endOfStatus('killed')).toBe('failed')
  expect(endOfStatus('completed')).toBe('done')

  const rows = buildRows(snap, [{ ...AGENT }], undefined, 12000, 'main', 'x', undefined)
  expect(rows[0]!.tasks).toEqual([{ id: 'b1', kind: 'shell', command: 'sleep 30', status: 'failed', elapsed: '4s' }])
  expect(rows[1]!.tasks.map(task => [task.id, task.status, task.elapsed])).toEqual([['b2', 'running', '10s'], ['b3', 'done', '5s']])
  expect(formatClock(250000)).toBe('4m 10s')
  expect(formatClock(3 * 3600000 + 5 * 60000)).toBe('3h 05m')
})

test('the pill counts running background tasks with the agents, and finished ones drop out of the count', () => {
  const snap = emptySnap('s')
  addBg(snap, undefined, 'b1', { kind: 'shell', command: 'sleep 30' }, 0)
  addBg(snap, undefined, 'b2', { kind: 'monitor', command: 'tail' }, 0)
  const rows = () => buildRows(snap, [{ ...AGENT }], undefined, 0, 'main', 'x', undefined)
  expect(bandSummary(rows()).count).toBe(3)
  endBg(snap, 'b1', 'done', 1)
  expect(bandSummary(rows()).count).toBe(2)
})

test('a background Bash and a Monitor start tasks on the card of the loop that ran them, and the pane draws a line each with its clock', async ($, on) => {
  const { store, clock } = stubEngine(on, [AGENT])
  await $.session.start({ cwd: '/w' } as never)
  await $.tool.call(shellCall('sleep 30\necho never shown'))
  await $.tool.call({ tool: 'Monitor', command: 'tail -f logs/app.log | grep ERROR', description: 'Watch' } as never)
  await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
  await $.tool.call(shellCall('sleep 99', 'a1'))
  const saved = store.get('snap:sid-1') as Snap
  expect(saved.main.bg!.map(task => [task.id, task.kind, task.command])).toEqual([['bg1', 'shell', 'sleep 30\necho never shown'], ['bg2', 'monitor', 'tail -f logs/app.log | grep ERROR']])
  expect(saved.agents.a1!.bg!.map(task => [task.id, task.kind])).toEqual([['bg3', 'shell']])

  const pane = await $.ui.mount(PANE)
  const draw = async () => JSON.stringify(await pane.drawn({ in: 'loops' }))
  const first = await draw()
  expect(first).toContain('sleep 30')
  expect(first).not.toContain('never shown')
  expect(first).toContain('tail -f logs/app.log | grep ERROR')
  expect(first).toContain('monitor')
  expect(first.indexOf('sleep 30')).toBeLessThan(first.indexOf('leaf-1.1.1'))
  expect(first.indexOf('sleep 99')).toBeGreaterThan(first.indexOf('leaf-1.1.1'))
  expect(first).toContain('0s')

  await clock.advance(250000)
  await pane.redraw()
  expect(await draw()).toContain('4m 10s')
  await pane.unmount()
})

test('TaskStop ends the task it names as failed, and the notification marks it done or failed, whatever the pane shows', async ($, on) => {
  const { store } = stubEngine(on)
  await $.session.start({ cwd: '/w' } as never)
  for (const command of ['sleep 1', 'sleep 2', 'sleep 3', 'sleep 4']) await $.tool.call(shellCall(command))
  await $.tool.call({ tool: 'TaskStop', task_id: 'bg1' } as never)
  await $.prompt.submit({ text: NOTIFY('bg2', 'completed'), origin: { kind: 'task-notification' } } as never)
  await $.prompt.submit({ text: NOTIFY('bg3', 'killed'), origin: { kind: 'task-notification' } } as never)
  await $.prompt.submit({ text: NOTIFY('bg4', 'completed'), origin: { kind: 'composer' } } as never)
  expect((store.get('snap:sid-1') as Snap).main.bg!.map(task => [task.id, task.end])).toEqual([['bg1', 'failed'], ['bg2', 'done'], ['bg3', 'failed'], ['bg4', undefined]])
})

test('a Stop lists what still runs, so a task it leaves out has finished; a subagent stop settles only its own tasks', async ($, on) => {
  const { store, bridge, feed } = stubEngine(on, [AGENT])
  bridge.on = true
  await $.session.start({ cwd: '/w' } as never)
  await $.tool.call(shellCall('sleep 10'))
  await $.tool.call(shellCall('sleep 20'))
  await $.tool.call(shellCall('sleep 30', 'a1'))
  const state = () => {
    const snap = store.get('snap:sid-1') as Snap
    return [snap.main.bg!.map(task => task.endedAt !== undefined), snap.agents.a1!.bg!.map(task => task.endedAt !== undefined)]
  }
  await feed('Stop', stopBody([{ id: 'bg2', status: 'running' }]))
  expect(state()).toEqual([[true, false], [false]])
  await feed('SubagentStop', stopBody([], { agent_id: 'a1' }))
  expect(state()).toEqual([[true, false], [true]])
  await feed('Stop')
  expect(state()).toEqual([[true, false], [true]])
})

test('a helper agent\'s SubagentStop with an empty type and no turn ends only its own tasks, and a record naming no tasks changes nothing', async ($, on) => {
  const { store, bridge, feed } = stubEngine(on, [AGENT])
  bridge.on = true
  await $.session.start({ cwd: '/w' } as never)
  await $.tool.call(shellCall('sleep 10'))
  await $.tool.call(shellCall('sleep 30', 'a1'))
  const ended = () => {
    const snap = store.get('snap:sid-1') as Snap
    return [snap.main.bg!.map(task => task.endedAt !== undefined), snap.agents.a1!.bg!.map(task => task.endedAt !== undefined)]
  }
  await feed('SubagentStop', { agent_id: 'helper-9', agent_type: '', background_tasks: [] })
  expect(ended()).toEqual([[false], [false]])
  await feed('SubagentStop', { agent_id: 'a1', agent_type: '', background_tasks: [] })
  expect(ended()).toEqual([[false], [true]])
})

// A reload: the store and the host's state outlive the module, and the bridge's first read replays the last record of each event.
function reloaded(store: Map<string, unknown>, states: Map<string, unknown>, handled: object | null) {
  const snap = emptySnap('sid-1')
  addBg(snap, undefined, 'bg-live', { kind: 'shell', command: 'sleep 99' }, 0)
  store.set('snap:sid-1', snap)
  states.set('mod-progress.booted', true)
  if (handled) store.set('bridge-last:sid-1:Stop', { raw: JSON.stringify(handled), at: START })
}

test('a Stop replayed after a reload does not end a task that began after it', async ($, on) => {
  const { store, states, bridge } = stubEngine(on)
  bridge.on = true
  const old = { session_id: 'sid-1', hook_event_name: 'Stop', background_tasks: [] }
  reloaded(store, states, old)
  bridge.text = `${JSON.stringify(old)}\n`
  await $.session.start({ cwd: '/w' } as never)
  expect((store.get('snap:sid-1') as Snap).main.bg![0]!.endedAt).toBeUndefined()
})

test('the same Stop is handled when this module never saw it, and a new Stop after a replay is handled too', async ($, on) => {
  const { store, states, bridge, feed } = stubEngine(on)
  bridge.on = true
  const old = { session_id: 'sid-1', hook_event_name: 'Stop', background_tasks: [] }
  reloaded(store, states, null)
  bridge.text = `${JSON.stringify(old)}\n`
  await $.session.start({ cwd: '/w' } as never)
  expect((store.get('snap:sid-1') as Snap).main.bg![0]!.endedAt).toBeDefined()

  await $.tool.call(shellCall('sleep 5'))
  await feed('Stop', { background_tasks: [{ id: 'bg1', status: 'running' }] })
  expect((store.get('snap:sid-1') as Snap).main.bg!.map(task => task.endedAt !== undefined)).toEqual([true, false])
})

test('after a reload the replay is skipped, and the next Stop that comes is handled', async ($, on) => {
  const { store, states, bridge, feed } = stubEngine(on)
  bridge.on = true
  const old = { session_id: 'sid-1', hook_event_name: 'Stop', background_tasks: [] }
  reloaded(store, states, old)
  bridge.text = `${JSON.stringify(old)}\n`
  await $.session.start({ cwd: '/w' } as never)
  expect((store.get('snap:sid-1') as Snap).main.bg![0]!.endedAt).toBeUndefined()
  await feed('Stop', { background_tasks: [] })
  expect((store.get('snap:sid-1') as Snap).main.bg![0]!.endedAt).toBeDefined()
})

test('a session.end delivers a Stop the poll has not read yet, before the shells are wiped', async ($, on) => {
  const { store, bridge } = stubEngine(on)
  bridge.on = true
  await $.session.start({ cwd: '/w' } as never)
  await $.tool.call(shellCall('sleep 10'))
  bridge.text = `${JSON.stringify({ session_id: 'sid-1', hook_event_name: 'Stop', background_tasks: [] })}\n`
  await $.session.end({ reason: 'clear', sessionId: 'sid-1', resume: {} } as never)
  expect((store.get('carry-bg') as unknown[]) ?? []).toEqual([])
  expect(store.has('bridge-last:sid-1:Stop')).toBe(false)
})

test('a finished task keeps its line, and a failed one takes the alert color', async ($, on) => {
  const { store, bridge, feed } = stubEngine(on)
  bridge.on = true
  await $.session.start({ cwd: '/w' } as never)
  await $.tool.call(shellCall('sleep 1'))
  await $.tool.call(shellCall('sleep 2'))
  await $.tool.call(shellCall('sleep 3'))
  await $.tool.call({ tool: 'TaskStop', task_id: 'bg2' } as never)
  await feed('Stop', stopBody([{ id: 'bg3', status: 'running' }]))
  expect((store.get('snap:sid-1') as Snap).main.bg!.map(task => task.end)).toEqual(['done', 'failed', undefined])
  const pane = await $.ui.mount(PANE)
  const text = JSON.stringify(await pane.drawn({ in: 'loops' }))
  for (const command of ['sleep 1', 'sleep 2', 'sleep 3']) expect(text).toContain(command)
  const markColor = (command: string) => text.split(command)[0]!.split('"color":"')[text.split(command)[0]!.split('"color":"').length - 3]!.slice(0, 7)
  expect(markColor('sleep 2')).toBe(THEME.alert)
  expect(markColor('sleep 1')).toBe(THEME.good)
  expect(markColor('sleep 3')).toBe(THEME.accent)
  await pane.unmount()
})

test('a task line is cut to the room by the renderer, and a session with no tasks draws none', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: '/w' } as never)
  const pane = await $.ui.mount(PANE)
  expect(JSON.stringify(await pane.drawn({ in: 'loops' }))).not.toContain('shell')
  await $.tool.call(shellCall(`npm run dev -- ${'--flag '.repeat(40)}END`))
  await pane.redraw()
  const drawn = JSON.stringify(await pane.drawn({ in: 'loops' }))
  expect(drawn).toContain('npm run dev')
  expect(drawn).toContain('"wrap":"truncate-end"},"children":[{"type":"Text","props":{"color":"#9BA3C4"},"children":["shell "]}')
  await pane.unmount()
})

test('icons=nerd draws the Nerd spinner and done glyphs on task lines', { options: { icons: 'nerd' } }, async ($, on) => {
  const { bridge, feed } = stubEngine(on)
  bridge.on = true
  await $.session.start({ cwd: '/w' } as never)
  await $.tool.call(shellCall('sleep 1'))
  await $.tool.call(shellCall('sleep 2'))
  await feed('Stop', stopBody([{ id: 'bg2', status: 'running' }]))
  const pane = await $.ui.mount(PANE)
  const drawn = JSON.stringify(await pane.drawn({ in: 'loops' }))
  expect(drawn).toContain('⠋')
  expect(drawn).toContain(String.fromCodePoint(0xf0c8))
  await pane.unmount()
})

test('icons=safe draws plain glyphs on task lines', { options: { icons: 'safe' } }, async ($, on) => {
  const { bridge, feed } = stubEngine(on)
  bridge.on = true
  await $.session.start({ cwd: '/w' } as never)
  await $.tool.call(shellCall('sleep 1'))
  await $.tool.call(shellCall('sleep 2'))
  await feed('Stop', stopBody([{ id: 'bg2', status: 'running' }]))
  const pane = await $.ui.mount(PANE)
  const drawn = JSON.stringify(await pane.drawn({ in: 'loops' }))
  expect(drawn).toContain('⠋')
  expect(drawn).toContain('■')
  expect(drawn).not.toContain('↻')
  await pane.unmount()
})

const TASK_LINE = 2
const pointerOn = (mounted: unknown, event: object) => (mounted as { pointer: (event: object) => Promise<void> }).pointer(event)
const numbered = (n: number, from = 1) => Array.from({ length: n }, (_, at) => `line ${from + at}`).join('\n') + '\n'
const BAND = { plugin: 'mod-progress', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} } } as never

test('output text is the program\'s: escapes and control characters are stripped, and the tail keeps the last 20 lines and a half-written one', () => {
  expect(stripControl('\u001b[31mred\u001b[0m \u001b]0;title\u0007ok\u0007\u0000\ttab')).toBe('red ok  tab')
  const first = appendTail({ from: 0, lines: [], partial: '' }, numbered(25) + 'half', 99)
  expect(first.lines).toHaveLength(20)
  expect(first.lines[0]).toBe('line 6')
  expect(first.partial).toBe('half')
  const next = appendTail(first, ' done\r\nmore\r\n', 120)
  expect(next.lines.slice(-2)).toEqual(['half done', 'more'])
  expect(next.from).toBe(120)
})

test('a click on a task line opens its page with the full command, and the back pill returns to the list', async ($, on) => {
  const { states } = stubEngine(on, [], { '/tmp/bg1.output': 'built\n' })
  await $.session.start({ cwd: '/w' } as never)
  await $.tool.call(shellCall('npm run build \\\n  --coverage'))
  const pane = await $.ui.mount(PANE)
  expect(JSON.stringify(await pane.drawn({ in: 'loops' }))).toContain('npm run build')
  await pointerOn(pane, { in: 'loops', type: 'down', x: 3, y: TASK_LINE, button: 'left' })
  expect(states.get('mod-progress.task')).toBe('bg1')
  await pane.redraw()
  expect((await pane.find({ type: 'Text', text: /^shell · running/ }))?.text).toBe('shell · running · 0s')
  expect((await pane.find({ type: 'Text', text: /^\$ npm run build/ }))?.text).toBe('$ npm run build \\')
  expect((await pane.find({ type: 'Text', text: /--coverage/ }))?.text).toBe('    --coverage')
  expect((await pane.find({ type: 'Text', text: /^built$/ }))?.text).toBe('built')
  expect(await pane.find({ type: 'Text', text: /Click an agent/ })).toBeUndefined()

  await pointerOn(pane, { in: 'progress-back', type: 'down', x: 2, y: 0, button: 'left' })
  expect(states.get('mod-progress.task')).toBe('')
  await pane.redraw()
  expect(await pane.find({ type: 'Text', text: /Click an agent/ })).toBeDefined()
  await pane.unmount()
})

test('the task line\'s tip goes when its click opens the page, since the list never posts its leave', async ($, on) => {
  stubEngine(on, [], { '/tmp/bg1.output': 'built\n' })
  await $.session.start({ cwd: '/w' } as never)
  await $.tool.call(shellCall('sleep 30'))
  const pane = await $.ui.mount(PANE)
  await pointerOn(pane, { in: 'loops', type: 'move', x: 3, y: TASK_LINE, button: 'left' })
  expect(await pane.find({ type: 'Text', text: /opens this task/ })).toBeDefined()
  await pointerOn(pane, { in: 'loops', type: 'down', x: 3, y: TASK_LINE, button: 'left' })
  await pane.redraw()
  expect(await pane.find({ type: 'Text', text: /^shell · running/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /opens this task/ })).toBeUndefined()
  await pane.unmount()
})

test('a click on the card outside the task line still toggles its gates, and the task line has its own tip', async ($, on) => {
  const { states } = stubEngine(on)
  await $.session.start({ cwd: '/w' } as never)
  await $.tool.call(shellCall('sleep 30'))
  const pane = await $.ui.mount(PANE)
  await pointerOn(pane, { in: 'loops', type: 'down', x: 3, y: 0, button: 'left' })
  expect(states.get('mod-progress.task')).toBeUndefined()
  expect(JSON.stringify(await pane.drawn({ in: 'loops' }))).toContain('No gates yet. Add a GATES.md')
  await pointerOn(pane, { in: 'loops', type: 'move', x: 3, y: TASK_LINE, button: 'left' })
  expect((await pane.find({ type: 'Text', text: /opens this task/ }))?.text).toContain('opens this task\'s command and output')
  await pane.unmount()
})

test('the page shows the last 20 lines of the output file, follows new bytes every second, and strips escapes', async ($, on) => {
  const files: Record<string, string> = { '/tmp/bg1.output': numbered(30) }
  const { clock } = stubEngine(on, [], files)
  await $.session.start({ cwd: '/w' } as never)
  await $.tool.call(shellCall('sleep 30'))
  const pane = await $.ui.mount(PANE)
  await pointerOn(pane, { in: 'loops', type: 'down', x: 3, y: TASK_LINE, button: 'left' })
  await pane.redraw()
  const texts = async () => (await pane.findAll({ type: 'Text', text: /^line \d+$|^red line$|^new 32$/ })).map(node => node.text)
  const first = await texts()
  expect(first).toHaveLength(20)
  expect(first[0]).toBe('line 11')
  expect(first[19]).toBe('line 30')

  files['/tmp/bg1.output'] += '\u001b[31mred\u001b[0m\u0007 line\nnew 32\n'
  await clock.advance(1000)
  await pane.redraw()
  const next = await texts()
  expect(next).toHaveLength(20)
  expect(next.slice(-2)).toEqual(['red line', 'new 32'])
  expect(next[0]).toBe('line 13')
  await pane.unmount()
})

test('the output timer stops when the page closes and when the task ends, after one last read', async ($, on) => {
  const files: Record<string, string> = { '/tmp/bg1.output': 'one\n', '/tmp/bg2.output': 'two\n' }
  const { clock, reads } = stubEngine(on, [], files)
  await $.session.start({ cwd: '/w' } as never)
  await $.tool.call(shellCall('sleep 30'))
  await $.tool.call(shellCall('sleep 31'))
  const pane = await $.ui.mount(PANE)
  await pointerOn(pane, { in: 'loops', type: 'down', x: 3, y: TASK_LINE, button: 'left' })
  const open = reads.stat
  await clock.advance(3000)
  expect(reads.stat).toBeGreaterThan(open)

  files['/tmp/bg1.output'] += 'last\n'
  await $.prompt.submit({ text: NOTIFY('bg1', 'completed'), origin: { kind: 'task-notification' } } as never)
  await pane.redraw()
  expect((await pane.find({ type: 'Text', text: /^last$/ }))?.text).toBe('last')
  const ended = reads.stat
  await clock.advance(5000)
  expect(reads.stat).toBe(ended)

  await pointerOn(pane, { in: 'progress-back', type: 'down', x: 2, y: 0, button: 'left' })
  await pointerOn(pane, { in: 'loops', type: 'down', x: 3, y: TASK_LINE + 1, button: 'left' })
  const second = reads.stat
  await clock.advance(2000)
  expect(reads.stat).toBeGreaterThan(second)
  await pointerOn(pane, { in: 'progress-back', type: 'down', x: 2, y: 0, button: 'left' })
  const closed = reads.stat
  await clock.advance(5000)
  expect(reads.stat).toBe(closed)
  await pane.unmount()
})

test('a monitor has no output file while it runs, and takes the one its closing notice names', async ($, on) => {
  const { states } = stubEngine(on, [], { '/tmp/out/bkg.output': 'tick 1\n' })
  await $.session.start({ cwd: '/w' } as never)
  await $.tool.call({ tool: 'Monitor', command: 'tail -f logs/app.log', description: 'Watch' } as never)
  const pane = await $.ui.mount(PANE)
  await pointerOn(pane, { in: 'loops', type: 'down', x: 3, y: TASK_LINE, button: 'left' })
  expect(states.get('mod-progress.task')).toBe('bg1')
  await pane.redraw()
  expect((await pane.find({ type: 'Text', text: /^\$ tail -f/ }))?.text).toBe('$ tail -f logs/app.log')
  expect((await pane.find({ type: 'Text', text: /No output file/ }))?.text).toBe('No output file for this task')
  await $.prompt.submit({ text: NOTIFY('bg1', 'completed').replace('<status>', '<output-file>/tmp/out/bkg.output</output-file>\n<status>'), origin: { kind: 'task-notification' } } as never)
  await pane.redraw()
  expect((await pane.find({ type: 'Text', text: /^tick 1$/ }))?.text).toBe('tick 1')
  await pane.unmount()
})

test('a page whose task is gone returns to the list', async ($, on) => {
  const { states } = stubEngine(on)
  await $.session.start({ cwd: '/w' } as never)
  states.set('mod-progress.task', 'ghost')
  const pane = await $.ui.mount(PANE)
  expect(await pane.find({ type: 'Text', text: /Click an agent/ })).toBeDefined()
  await pane.unmount()
})

test('the band pill badge and the pane tab chip show one count: running agents and running tasks', async ($, on) => {
  stubEngine(on, [AGENT])
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>other mod</Text>
  })
  await $.session.start({ cwd: '/w' } as never)
  await $.tool.call(shellCall('sleep 30'))
  await $.tool.call(shellCall('sleep 31'))
  const band = await $.ui.mount(BAND)
  expect(JSON.stringify(await band.drawn({ in: 'menu-entry-progress' }))).toContain('" 3 "')
  await band.unmount()
  const pane = await $.ui.mount(PANE)
  expect(JSON.stringify(await pane.drawn({ in: 'progress-tab' }))).toContain('" 3 "')
  await pane.unmount()
})

test('a pane control\'s tip shows in the pane footer only, and the pill\'s tip in the band only', async ($, on) => {
  stubEngine(on, [AGENT])
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>other mod</Text>
  })
  await $.session.start({ cwd: '/w' } as never)
  const band = await $.ui.mount(BAND)
  const pane = await $.ui.mount(PANE)
  const gates = /shows or hides this agent/
  const pill = /every agent with its context/

  await pointerOn(pane, { in: 'loops', type: 'move', x: 3, y: 0, button: 'left' })
  await band.redraw()
  expect(await pane.find({ type: 'Text', text: gates })).toBeDefined()
  expect(await band.find({ type: 'Text', text: gates })).toBeUndefined()

  await pointerOn(band, { in: 'menu-entry-progress', type: 'enter', x: 1, y: 0, button: 'left' })
  await pane.redraw()
  expect(await band.find({ type: 'Text', text: pill })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: pill })).toBeUndefined()
  await pane.unmount()
  await band.unmount()
})

test('agent cards are flat on the section, only the card under the pointer lifts, and the view switch shows its tip in the footer', async ($, on) => {
  stubEngine(on, [AGENT])
  await $.session.start({ cwd: '/w' } as never)
  const pane = await $.ui.mount(PANE)
  const bgOf = async (line: string) => JSON.stringify(await pane.drawn({ in: 'loops' })).match(new RegExp(`"key":"${line}","height":1,"width":\\d+,"flexDirection":"row","backgroundColor":"(#\\w+)"`))?.[1]
  expect(await bgOf('line-0')).toBe(cardFill())
  await pointerOn(pane, { in: 'loops', type: 'move', x: 3, y: 0, button: 'left' })
  expect(await bgOf('line-0')).toBe(THEME.lifted)
  expect(await bgOf('line-3')).toBe(cardFill())
  await pointerOn(pane, { in: 'loops', type: 'down', x: 3, y: 3, button: 'left' })
  const drawn = JSON.stringify(await pane.drawn())
  expect(drawn).toContain(`"key":"footer-space","height":2,"flexShrink":0`)
  expect(drawn).toContain('own conversation')
  expect(drawn).toContain(`"backgroundColor":"${THEME.bg}"`)
  await pane.unmount()
})

test('a foreground Bash the host moves to the background (ctrl+b or its timeout) answers with a task id and becomes a task', async ($, on) => {
  const { store } = stubEngine(on)
  await $.session.start({ cwd: '/w' } as never)
  await $.tool.call({ tool: 'Bash', command: 'npm run moved' } as never)
  await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
  const saved = store.get('snap:sid-1') as Snap
  expect(saved.main.bg!.map(task => [task.id, task.kind, task.command, task.output])).toEqual([['bg1', 'shell', 'npm run moved', '/tmp/bg1.output']])
})

test('a task takes the time its call began, not the time its result came back', async ($, on) => {
  const { store, took } = stubEngine(on)
  took.ms = 5000
  await $.session.start({ cwd: '/w' } as never)
  await $.tool.call({ tool: 'Bash', command: 'make moved' } as never)
  expect((store.get('snap:sid-1') as Snap).main.bg![0]!.startedAt).toBe(START)
})

test('a new process starts with no tasks, a hot reload keeps them, and an exit takes them', async ($, on) => {
  const { store } = stubEngine(on)
  const stale = emptySnap('sid-1')
  addBg(stale, undefined, 'old', { kind: 'shell', command: 'sleep 99' }, 0)
  store.set('snap:sid-1', stale)
  await $.session.start({ cwd: '/w' } as never)
  expect((store.get('snap:sid-1') as Snap).main.bg ?? []).toEqual([])

  await $.tool.call(shellCall('sleep 1'))
  await $.session.start({ cwd: '/w' } as never)
  expect((store.get('snap:sid-1') as Snap).main.bg).toHaveLength(1)

  await $.session.end({ reason: 'prompt_input_exit', sessionId: 'sid-1', resume: {} } as never)
  expect((store.get('snap:sid-1') as Snap).main.bg ?? []).toEqual([])
})

test('a /clear keeps the shells it left running, on the new session, and a /resume drops them', async ($, on) => {
  const { store, ids } = stubEngine(on)
  await $.session.start({ cwd: '/w' } as never)
  await $.tool.call(shellCall('sleep 1'))
  await $.tool.call(shellCall('sleep 2'))
  await $.prompt.submit({ text: NOTIFY('bg2', 'completed'), origin: { kind: 'task-notification' } } as never)
  await $.session.end({ reason: 'clear', sessionId: 'sid-1', resume: {} } as never)
  ids.sid = 'sid-2'
  const pane = await $.ui.mount(PANE)
  const shown = JSON.stringify(await pane.drawn({ in: 'loops' }))
  expect(shown).toContain('sleep 1')
  expect(shown).not.toContain('sleep 2')
  await pane.unmount()

  await $.session.end({ reason: 'resume', sessionId: 'sid-2', resume: {} } as never)
  ids.sid = 'sid-3'
  const next = await $.ui.mount(PANE)
  expect(JSON.stringify(await next.drawn({ in: 'loops' }))).not.toContain('sleep 1')
  await next.unmount()
  expect(store.get('carry-bg') ?? null).toBeNull()
})

test('a task stopped from /tasks ends when its notification row is drawn with the status killed', async ($, on) => {
  const { store, clock } = stubEngine(on)
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>row</Text>
  })
  await $.session.start({ cwd: '/w' } as never)
  await $.tool.call(shellCall('sleep 120'))
  await $.tool.call(shellCall('sleep 121'))
  const row = (id: string, status: string) => ({ plugin: 'mod-progress', surface: 'terminal', component: 'UserMessage', requestId: `row-${id}`, props: { task: { id, status }, isExpanded: false } }) as never
  const first = await $.ui.mount(row('bg1', 'killed'))
  await first.unmount()
  const unknown = await $.ui.mount(row('nope', 'killed'))
  await unknown.unmount()
  await clock.advance(1)
  const ends = (store.get('snap:sid-1') as Snap).main.bg!.map(task => [task.id, task.end])
  expect(ends).toEqual([['bg1', 'failed'], ['bg2', undefined]])
})

test('a plugin reload (a fresh module, the host\'s state kept) keeps the tasks, and a new process (no state) wipes them', async ($, on) => {
  const { store, states } = stubEngine(on)
  const stale = emptySnap('sid-1')
  addBg(stale, undefined, 'old', { kind: 'shell', command: 'sleep 99' }, 0)
  store.set('snap:sid-1', stale)
  states.set('mod-progress.booted', true)
  await $.session.start({ cwd: '/w' } as never)
  expect((store.get('snap:sid-1') as Snap).main.bg).toHaveLength(1)
  states.delete('mod-progress.booted')
  await $.session.start({ cwd: '/w' } as never)
  expect((store.get('snap:sid-1') as Snap).main.bg ?? []).toEqual([])
  expect(states.get('mod-progress.booted')).toBe(true)
})

const paneOf = (bodyRows: number) => {
  const base = PANE as unknown as { props: { scroll: object } }
  return { ...base, props: { ...base.props, scroll: { offset: 0, bodyRows } } } as never
}

test('the page shows only the last lines that fit the pane, and every held line in a tall one', async ($, on) => {
  const { clock } = stubEngine(on, [], { '/tmp/bg1.output': numbered(30) })
  await $.session.start({ cwd: '/w' } as never)
  await $.tool.call(shellCall('sleep 30'))
  const outputs = async (pane: { pointer?: unknown; findAll: (query: object) => Promise<{ text: string }[]> }) => (await pane.findAll({ type: 'Text', text: /^line \d+$/ })).map(node => node.text)

  const short = await $.ui.mount(paneOf(14))
  await pointerOn(short, { in: 'loops', type: 'down', x: 3, y: TASK_LINE, button: 'left' })
  await clock.advance(1000)
  await (short as unknown as { redraw: () => Promise<void> }).redraw()
  const few = await outputs(short as never)
  expect(few).toEqual(['line 27', 'line 28', 'line 29', 'line 30'])
  await (short as unknown as { unmount: () => Promise<void> }).unmount()

  const tall = await $.ui.mount(paneOf(40))
  const many = await outputs(tall as never)
  expect(many).toHaveLength(20)
  expect(many[0]).toBe('line 11')
  await tall.unmount()

  const tiny = await $.ui.mount(paneOf(3))
  expect(await outputs(tiny as never)).toEqual(['line 30'])
  await tiny.unmount()
})

test('a longer command takes rows from the output, wrapped lines included', () => {
  expect(outputRoom(30, 80, 'sleep 30', '$', 2)).toBe(20)
  expect(outputRoom(30, 80, 'a\nb\nc', '$', 2)).toBe(18)
  expect(outputRoom(30, 80, 'x'.repeat(150), '$', 2)).toBe(18)
  expect(outputRoom(5, 80, 'sleep', '$', 2)).toBe(1)
})

test('the back pill\'s props and key stay the same across output ticks', async ($, on) => {
  const files: Record<string, string> = { '/tmp/bg1.output': numbered(3) }
  const { clock } = stubEngine(on, [], files)
  await $.session.start({ cwd: '/w' } as never)
  await $.tool.call(shellCall('sleep 30'))
  const pane = await $.ui.mount(PANE)
  await pointerOn(pane, { in: 'loops', type: 'down', x: 3, y: TASK_LINE, button: 'left' })
  await pane.redraw()
  const back = async () => JSON.stringify(await pane.drawn({ in: 'progress-back' }))
  const before = await back()
  const status = (await pane.find({ type: 'Text', text: /^shell · running/ }))?.text
  for (let tick = 0; tick < 3; tick++) {
    files['/tmp/bg1.output'] += `more ${tick}\n`
    await clock.advance(1000)
    await pane.redraw()
    expect(await back()).toBe(before)
  }
  expect((await pane.find({ type: 'Text', text: /^shell · running/ }))?.text).not.toBe(status)
  await pane.unmount()
})

const viewing = (agentId?: string) => ({ ...(PANE as unknown as { props: object }), props: { ...(PANE as unknown as { props: object }).props, view: agentId ? { agentId } : {} }, part: { plugin: 'mod-progress' } }) as never
const pressOn = (mounted: unknown, key: string) => (mounted as { press: (target: { key: string }) => Promise<unknown> }).press({ key })

function stubView(on: On) {
  const views: object[] = []
  on('ui.view', (_$, e) => {
    views.push({ ...e })
    return { value: {} } as never
  })
  return views
}

test('no switch pill while nothing is selected', async ($, on) => {
  stubEngine(on, [AGENT])
  stubView(on)
  await $.session.start({ cwd: '/w' } as never)
  const pane = await $.ui.mount(viewing())
  expect(await pane.find({ type: 'Button' })).toBeUndefined()
  await pane.unmount()
})

test('with a subagent card selected, the pill presses ui.view with its agent id', async ($, on) => {
  stubEngine(on, [AGENT])
  const views = stubView(on)
  await $.session.start({ cwd: '/w' } as never)
  const pane = await $.ui.mount(viewing())
  // Main head 0, pills 1, gap 2, then the agent's head 3.
  await pointerOn(pane, { in: 'loops', type: 'down', x: 3, y: 3, button: 'left' })
  await pane.redraw()
  expect((await pane.find({ type: 'Button' }))?.text).toContain('Open its transcript')
  await pressOn(pane, 'view-switch')
  expect(views).toEqual([{ agentId: 'a1' }])
  await pane.unmount()
})

test('while an agent is in view the pill reads Back to main and presses ui.view with no agent', async ($, on) => {
  stubEngine(on, [AGENT])
  const views = stubView(on)
  await $.session.start({ cwd: '/w' } as never)
  const pane = await $.ui.mount(viewing('a1'))
  expect((await pane.find({ type: 'Button' }))?.text).not.toContain('Open')
  expect((await pane.find({ type: 'Button' }))?.text).toBe(' ↗ Back to main ')
  await pressOn(pane, 'view-switch')
  expect(views).toEqual([{}])
  await pane.unmount()
})

// The drawn text in order: a hovered entry draws its label one letter per Text, so only the joined string reads whole.
const drawnIn = async (mounted: unknown, key: string) => {
  const json = JSON.stringify(await (mounted as { drawn: (target: { in: string }) => Promise<unknown> }).drawn({ in: key }))
  return [...json.matchAll(/"children":\["((?:[^"\\]|\\.)*)"\]/g)].map(match => JSON.parse(`"${match[1]}"`) as string).join('')
}
const clickIn = (mounted: unknown, key: string, x = 1, y = 0) => pointerOn(mounted, { in: key, type: 'down', x, y, button: 'left' })
const hoverIn = (mounted: unknown, key: string, x = 1, y = 0) => pointerOn(mounted, { in: key, type: 'move', x, y, button: 'left' })

test('a page with more output than rows shows "N more lines", every line after a click, then Show less', async ($, on) => {
  const { states } = stubEngine(on, [], { '/tmp/bg1.output': numbered(30) })
  await $.session.start({ cwd: '/w' } as never)
  await $.tool.call(shellCall('sleep 30'))
  const pane = await $.ui.mount(PANE)
  await clickIn(pane, 'loops', 3, TASK_LINE)
  await pane.redraw()
  const lines = async () => (await pane.findAll({ type: 'Text', text: /^line \d+$/ })).map(node => node.text)
  expect(await lines()).toHaveLength(20)
  expect(await drawnIn(pane, 'output-more')).toContain('10 more lines')
  expect(await drawnIn(pane, 'output-more')).toContain('▾')

  await hoverIn(pane, 'output-more')
  expect((await pane.find({ type: 'Text', text: /shows every line/ }))?.text).toContain('shows every line')

  await clickIn(pane, 'output-more')
  await pane.redraw()
  expect(states.get('mod-progress.output-open')).toBe('bg1')
  const open = await lines()
  expect(open).toHaveLength(30)
  expect(open[0]).toBe('line 1')
  expect(await drawnIn(pane, 'output-more')).toContain('Show less')
  expect(await drawnIn(pane, 'output-more')).toContain('▴')
  // The click swapped the control, which never posts its leave: the footer already shows the new one.
  expect((await pane.find({ type: 'Text', text: /shows the last lines only/ }))?.text).toContain('shows the last lines only')

  await clickIn(pane, 'output-more')
  await pane.redraw()
  expect(await lines()).toHaveLength(20)
  expect(await drawnIn(pane, 'output-more')).toContain('10 more lines')
  expect((await pane.find({ type: 'Text', text: /shows every line/ }))?.text).toContain('shows every line')
  await pane.unmount()
})

test('an open page keeps following new output, and a short output has no control', async ($, on) => {
  const files: Record<string, string> = { '/tmp/bg1.output': numbered(30) }
  const { clock } = stubEngine(on, [], files)
  await $.session.start({ cwd: '/w' } as never)
  await $.tool.call(shellCall('sleep 30'))
  const pane = await $.ui.mount(PANE)
  await clickIn(pane, 'loops', 3, TASK_LINE)
  await pane.redraw()
  await clickIn(pane, 'output-more')
  files['/tmp/bg1.output'] += 'line 31\nline 32\n'
  await clock.advance(1000)
  await pane.redraw()
  expect(await pane.findAll({ type: 'Text', text: /^line \d+$/ })).toHaveLength(32)
  await clickIn(pane, 'progress-back', 2)
  files['/tmp/bg1.output'] = numbered(3)
  await clickIn(pane, 'loops', 3, TASK_LINE)
  await pane.redraw()
  expect(await pane.find({ key: 'output-more' })).toBeUndefined()
  await pane.unmount()
})

const SHELLS = async ($: Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[0], on: On) => {
  const stub = stubEngine(on, [AGENT])
  await $.session.start({ cwd: '/w' } as never)
  await $.tool.call(shellCall('make main-job'))
  await $.tool.call(shellCall('npm test', 'a1'))
  await $.tool.call(shellCall('npm run lint', 'a1'))
  return stub
}
// Main head 0, pills 1, task 2, gap 3, agent head 4, pills 5, tasks 6 and 7 while open.
const MAIN_PILLS = 1
const AGENT_PILLS = 5
const TOGGLE_X = 70

test('each card folds its shells to a count and unfolds them again, and the fold survives a redraw', async ($, on) => {
  const { store } = await SHELLS($, on)
  const pane = await $.ui.mount(PANE)
  expect(await drawnIn(pane, 'loops')).toContain('npm test')
  expect(await drawnIn(pane, 'loops')).toContain('2 shells')

  await hoverIn(pane, 'loops', TOGGLE_X, AGENT_PILLS)
  expect((await pane.find({ type: 'Text', text: /hides this agent's background tasks/ }))?.text).toContain('hides this agent')
  await clickIn(pane, 'loops', TOGGLE_X, AGENT_PILLS)
  await pane.redraw()
  const folded = await drawnIn(pane, 'loops')
  expect(folded).not.toContain('npm test')
  expect(folded).toContain('2 shells')
  expect(folded).toContain('make main-job')
  expect(JSON.stringify([...store.values()])).toContain('"folded":["a1"]')
  expect((await pane.find({ type: 'Text', text: /shows this agent's background tasks/ }))?.text).toContain('shows this agent')
  // A click left of the toggle still opens the gates, not the fold.
  await clickIn(pane, 'loops', 3, AGENT_PILLS)
  await pane.redraw()
  expect(await drawnIn(pane, 'loops')).toContain('No gates yet')
  expect(await drawnIn(pane, 'loops')).not.toContain('npm test')

  await pane.redraw()
  expect(await drawnIn(pane, 'loops')).not.toContain('npm test')
  await clickIn(pane, 'loops', TOGGLE_X, AGENT_PILLS)
  await pane.redraw()
  expect(await drawnIn(pane, 'loops')).toContain('npm test')
  await pane.unmount()
})

test('Fold all and Unfold all flip every card, and the footer tip follows the swapped control without a pointer move', async ($, on) => {
  await SHELLS($, on)
  const pane = await $.ui.mount(PANE)
  expect(await drawnIn(pane, 'fold-toggle')).toContain('Fold all')
  await hoverIn(pane, 'fold-toggle')
  expect((await pane.find({ type: 'Text', text: /folds every agent/ }))?.text).toContain('folds every agent')

  await clickIn(pane, 'fold-toggle')
  await pane.redraw()
  const all = await drawnIn(pane, 'loops')
  expect(all).not.toContain('make main-job')
  expect(all).not.toContain('npm test')
  expect(await drawnIn(pane, 'fold-toggle')).toContain('Unfold all')
  expect((await pane.find({ type: 'Text', text: /shows every agent's background tasks/ }))?.text).toContain('shows every agent')
  expect(await pane.find({ type: 'Text', text: /folds every agent/ })).toBeUndefined()

  await clickIn(pane, 'fold-toggle')
  await pane.redraw()
  expect(await drawnIn(pane, 'loops')).toContain('make main-job')
  expect(await drawnIn(pane, 'loops')).toContain('npm run lint')
  expect(await drawnIn(pane, 'fold-toggle')).toContain('Fold all')
  expect((await pane.find({ type: 'Text', text: /folds every agent/ }))?.text).toContain('folds every agent')

  // Folding each card by hand flips the toggle once the last open list closes.
  await clickIn(pane, 'loops', TOGGLE_X, AGENT_PILLS)
  await pane.redraw()
  expect(await drawnIn(pane, 'fold-toggle')).toContain('Fold all')
  await clickIn(pane, 'loops', TOGGLE_X, MAIN_PILLS)
  await pane.redraw()
  expect(await drawnIn(pane, 'fold-toggle')).toContain('Unfold all')
  await pane.unmount()
})

test('no fold toggle while no card has a shell', async ($, on) => {
  stubEngine(on, [AGENT])
  await $.session.start({ cwd: '/w' } as never)
  const pane = await $.ui.mount(PANE)
  expect(await pane.find({ key: 'fold-toggle' })).toBeUndefined()
  await pane.unmount()
})

test('icons=nerd draws the Nerd arrows on the output control, the fold toggle and the card toggle', { options: { icons: 'nerd' } }, async ($, on) => {
  stubEngine(on, [AGENT], { '/tmp/bg1.output': numbered(30) })
  await $.session.start({ cwd: '/w' } as never)
  await $.tool.call(shellCall('make main-job'))
  const pane = await $.ui.mount(PANE)
  expect(await drawnIn(pane, 'fold-toggle')).toContain(String.fromCodePoint(0xf0d8))
  expect(await drawnIn(pane, 'loops')).toContain(String.fromCodePoint(0xeab4))
  await clickIn(pane, 'loops', TOGGLE_X, MAIN_PILLS)
  await pane.redraw()
  expect(await drawnIn(pane, 'fold-toggle')).toContain(String.fromCodePoint(0xf0d7))
  expect(await drawnIn(pane, 'loops')).toContain(String.fromCodePoint(0xeab6))
  await clickIn(pane, 'loops', TOGGLE_X, MAIN_PILLS)
  await clickIn(pane, 'loops', 3, TASK_LINE)
  await pane.redraw()
  expect(await drawnIn(pane, 'output-more')).toContain(String.fromCodePoint(0xf0d7))
  await clickIn(pane, 'output-more')
  await pane.redraw()
  expect(await drawnIn(pane, 'output-more')).toContain(String.fromCodePoint(0xf0d8))
  await pane.unmount()
})

test('icons=safe draws plain arrows on the output control, the fold toggle and the card toggle', { options: { icons: 'safe' } }, async ($, on) => {
  stubEngine(on, [AGENT], { '/tmp/bg1.output': numbered(30) })
  await $.session.start({ cwd: '/w' } as never)
  await $.tool.call(shellCall('make main-job'))
  const pane = await $.ui.mount(PANE)
  expect(await drawnIn(pane, 'fold-toggle')).toContain('▴')
  expect(await drawnIn(pane, 'loops')).toContain('▾ 1 shell')
  await clickIn(pane, 'loops', TOGGLE_X, MAIN_PILLS)
  await pane.redraw()
  expect(await drawnIn(pane, 'fold-toggle')).toContain('▾')
  expect(await drawnIn(pane, 'loops')).toContain('▸')
  await clickIn(pane, 'loops', TOGGLE_X, MAIN_PILLS)
  await clickIn(pane, 'loops', 3, TASK_LINE)
  await pane.redraw()
  expect(await drawnIn(pane, 'output-more')).toContain('▾')
  expect(await drawnIn(pane, 'output-more')).toContain('10 more lines')
  await clickIn(pane, 'output-more')
  await pane.redraw()
  expect(await drawnIn(pane, 'output-more')).toContain('▴')
  await pane.unmount()
})

const LONG = (tag: string) => `${tag} ${'x'.repeat(100)}`
const longLines = (n: number) => Array.from({ length: n }, (_, at) => LONG(`row${at + 1}`)).join('\n') + '\n'
const wrapsOf = async (pane: unknown) => (await (pane as { findAll: (query: unknown) => Promise<{ props: { wrap?: string } }[]> }).findAll({ type: 'Text', text: /^row\d+ x+$/ })).map(node => node.props.wrap)

test('a few short lines show no control', async ($, on) => {
  stubEngine(on, [], { '/tmp/bg1.output': numbered(3) })
  await $.session.start({ cwd: '/w' } as never)
  await $.tool.call(shellCall('sleep 30'))
  const pane = await $.ui.mount(PANE)
  await clickIn(pane, 'loops', 3, TASK_LINE)
  await pane.redraw()
  expect(await pane.findAll({ type: 'Text', text: /^line \d+$/ })).toHaveLength(3)
  expect(await pane.find({ key: 'output-more' })).toBeUndefined()
  await pane.unmount()
})

test('a few long lines show Show all, which wraps each line in full and Show less cuts them again', async ($, on) => {
  stubEngine(on, [], { '/tmp/bg1.output': longLines(3) })
  await $.session.start({ cwd: '/w' } as never)
  await $.tool.call(shellCall('sleep 30'))
  const pane = await $.ui.mount(PANE)
  await clickIn(pane, 'loops', 3, TASK_LINE)
  await pane.redraw()
  expect(await wrapsOf(pane)).toEqual(['truncate-end', 'truncate-end', 'truncate-end'])
  expect(await drawnIn(pane, 'output-more')).toContain('Show all')
  expect(await drawnIn(pane, 'output-more')).toContain('▾')
  await hoverIn(pane, 'output-more')
  expect((await pane.find({ type: 'Text', text: /shows every line/ }))?.text).toContain('shows every line')
  await clickIn(pane, 'output-more')
  await pane.redraw()
  expect(await wrapsOf(pane)).toEqual(['wrap', 'wrap', 'wrap'])
  expect(await drawnIn(pane, 'output-more')).toContain('Show less')
  expect(await drawnIn(pane, 'output-more')).toContain('▴')
  await clickIn(pane, 'output-more')
  await pane.redraw()
  expect(await wrapsOf(pane)).toEqual(['truncate-end', 'truncate-end', 'truncate-end'])
  expect(await drawnIn(pane, 'output-more')).toContain('Show all')
  await pane.unmount()
})

test('a long output of long lines keeps the line count on its control and wraps its lines when open', async ($, on) => {
  stubEngine(on, [], { '/tmp/bg1.output': longLines(30) })
  await $.session.start({ cwd: '/w' } as never)
  await $.tool.call(shellCall('sleep 30'))
  const pane = await $.ui.mount(PANE)
  await clickIn(pane, 'loops', 3, TASK_LINE)
  await pane.redraw()
  expect(await drawnIn(pane, 'output-more')).toContain('10 more lines')
  expect(await wrapsOf(pane)).toHaveLength(20)
  await clickIn(pane, 'output-more')
  await pane.redraw()
  const open = await wrapsOf(pane)
  expect(open).toHaveLength(30)
  expect(new Set(open)).toEqual(new Set(['wrap']))
  await clickIn(pane, 'output-more')
  await pane.redraw()
  expect(new Set(await wrapsOf(pane))).toEqual(new Set(['truncate-end']))
  await pane.unmount()
})

test('wrappedRows counts the rows each line takes at a width, one at least', () => {
  expect(wrappedRows(['', 'abc', 'x'.repeat(10), 'x'.repeat(11)], 5)).toBe(1 + 1 + 2 + 3)
})

for (const icons of ['nerd', 'safe'] as const) {
  test(`icons=${icons} draws the arrows of a Show all control on a few long lines`, { options: { icons } }, async ($, on) => {
    stubEngine(on, [], { '/tmp/bg1.output': longLines(2) })
    await $.session.start({ cwd: '/w' } as never)
    await $.tool.call(shellCall('sleep 30'))
    const pane = await $.ui.mount(PANE)
    await clickIn(pane, 'loops', 3, TASK_LINE)
    await pane.redraw()
    expect(await drawnIn(pane, 'output-more')).toContain(icons === 'nerd' ? String.fromCodePoint(0xf0d7) : '▾')
    expect(await drawnIn(pane, 'output-more')).toContain('Show all')
    await clickIn(pane, 'output-more')
    await pane.redraw()
    expect(await drawnIn(pane, 'output-more')).toContain(icons === 'nerd' ? String.fromCodePoint(0xf0d8) : '▴')
    await pane.unmount()
  })
}

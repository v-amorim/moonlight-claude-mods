// mod-progress / tests/progress.test.tsx, by v-amorim
// Tests gates parsing, loop rows, context figures, stop lines, workflow agents and pane drawing.
import { expect, mock, test } from 'claude-code/testing'

import { applyCall, applyStep, laneCells, timelineCols, finishAgent, applyTask, bandSummary, buildRows, emptySnap, formatElapsed, formatTokens, cutText, gatesOf, laneLabels, gatesStemIn, gaugeColor, groupGates, mergeStamps, windowFor, isGatesPath, modelInfo, parseGates, settle, stepOf, stripCells, stripOrder, type Snap } from '../hooks/progress'
import { resumeAt, stopLine, stopOf } from '../hooks/stop'
import { cardFill } from '../hooks/look'
import text from '../hooks/text'
import { THEME } from '../hooks/theme'

const GATES = [
  '# Gates: leaf',
  '',
  '- [x] G1: renders end to end',
  '      EVIDENCE: ok 12 passed',
  '',
  '- [x] G2: checked but pending',
  '      EVIDENCE: pending',
  '',
  '- [ ] G3: still open',
  '      EVIDENCE: pending',
  '',
  '- [ ] G4: given up',
  'ABANDON: G4 not possible',
].join('\n')

const neutral = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

type On = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[1]

// The host's mounted-UI type lacks pointer
const pointerOn = (mounted: unknown, event: object) => (mounted as { pointer: (event: object) => Promise<void> }).pointer(event)

const AGENT = { id: 'a1', name: 'leaf-1.1.1', description: 'Build the leaf', type: 'general-purpose', status: 'running' }

const seeded = (): Snap => {
  const snap = emptySnap('sid-1')
  snap.busy = true
  snap.startedAt = 0
  snap.main = { model: 'claude-opus-5-5', effort: 'xhigh', tokens: 312000, context: 92000 }
  snap.agents.a1 = { model: 'claude-haiku-4-5-20251001', tokens: 46800, context: 24000, spawnedAt: 1000 }
  snap.gates.GATES = parseGates(GATES)
  snap.gates['leaf-1.1.1'] = parseGates(GATES).slice(0, 2)
  return snap
}

// `files` are keyed by path under the session's gates folder; `session.id` may change mid-test.
type World = { now: number; windows: { kind: string; percentUsed: number; resetsAt?: string }[]; files: Record<string, string>; repo: string; empty: string[]; session: { id: string }; storeDown: { is: boolean }; reads: string[] }

function stubEngine(on: On, agents: unknown[] = [AGENT], opened: string[] = [], world: Partial<World> = {}) {
  const store = new Map<string, unknown>([['snap:sid-1', seeded()]])
  const clock = mock.clock(on, { now: world.now ?? 14 * 60 * 1000 })
  const windows = world.windows ?? []
  const files = world.files ?? { 'GATES.md': GATES, 'gates/leaf-1.1.1.md': GATES.split('\n').slice(0, 7).join('\n') }
  on('session.id', () => ({ value: world.session?.id ?? 'sid-1' }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }) as never)
  on('session.cwd', () => ({ value: '/w' }))
  on('session.repo', () => ({ value: null }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000, percent: 46, tokens: 92000 }, rateLimits: windows } }))
  on('agent.list', () => ({ value: agents }) as never)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  // The bridge file the command hooks append to; a test that sets `bridge.on` before session.start gets the poll.
  const bridge = { on: false, text: '' }
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    if (world.storeDown?.is) throw new Error('store unavailable')
    store.set(e.key, e.value)
    return { value: undefined } as never
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('store.delete', (_$, e) => {
    store.delete(e.key)
    return { value: undefined } as never
  })
  // With no HOME and no repo, the folder is /.claude/gates/<cwd name>/<session id>.
  const folder = `/.claude/gates/${world.repo ?? 'w'}/sid-1`
  // A test that turns the bridge on gives the mod a HOME, which moves the gates folder under it.
  const gate = (path: string) => neutral(path).replace(/^\/home\/u(?=\/\.claude\/gates)/, '')
  on('fs.read', (_$, e) => {
    if (neutral(e.path) === '/home/u/.claude/mods-data/mod-progress/bridge/sid-1.jsonl') return { value: bridge.text }
    world.reads?.push(neutral(e.path))
    const path = gate(e.path).replace(`${folder}/`, '')
    if (path in files) return { value: files[path]! }
    throw new Error('ENOENT')
  })
  on('fs.exists', (_$, e) => ({ value: gate(e.path) === folder || (gate(e.path).startsWith(`${folder}/`) && gate(e.path).replace(`${folder}/`, '') in files) || (world.empty ?? []).some(name => gate(e.path) === `/.claude/gates/${name}/sid-1`) }))
  on('fs.list', (_$, e) => ({
    value: gate(e.path) === '/.claude/gates'
      ? [...(world.empty ?? []), 'w', world.repo ?? 'w'].map(name => ({ name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false }))
      : gate(e.path) === `${folder}/gates`
        ? Object.keys(files).filter(path => path.startsWith('gates/')).map(path => ({ name: path.slice('gates/'.length), kind: 'file', size: 0, mtimeMs: 0, isLink: false }))
        : [],
  }))
  on('env.get', (_$, e) => ({ value: bridge.on && (e as { name?: string }).name === 'USERPROFILE' ? '/home/u' : undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('session.start', () => ({ cwd: '/w' }))
  on('command.register', () => ({ value: { command: 'mod-progress' } }))
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('state.set', () => ({ value: undefined } as never))
  // Hands one record to the mod the way the command hook does: appended to the session's file, read by the next poll.
  const feed = async (event: string, body: object = {}) => {
    bridge.text += `${JSON.stringify({ session_id: 'sid-1', hook_event_name: event, ...body })}\n`
    await clock.advance(250)
  }
  return { store, clock, bridge, feed }
}

const PANE = { plugin: 'mod-progress', surface: 'terminal', component: 'Pane', requestId: 'progress', props: { title: 'Progress', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } } as never
const BAND = { plugin: 'mod-progress', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} } } as never

test('gates: met needs a checked box with real evidence, ABANDON gives one up', () => {
  const gates = parseGates(GATES)
  expect(gates.map(gate => [gate.id, gate.state])).toEqual([['G1', 'met'], ['G2', 'pending'], ['G3', 'open'], ['G4', 'abandoned']])
  expect(gates[0]!.text).toBe('renders end to end')
  expect(isGatesPath('C:\\w\\gates\\leaf-1.md')).toBe(true)
  expect(isGatesPath('/w/GATES.md')).toBe(true)
  expect(isGatesPath('/w/src/gates.ts')).toBe(false)
})

test('an agent pairs with its gates file by name, or by the first word of its description', () => {
  const one = parseGates('- [ ] G1 one\n  EVIDENCE: pending\n')
  const snap = { gates: { 'leaf-1.1.1': one } }
  expect(gatesOf(snap, { name: 'leaf-1.1.1', description: 'anything' })).toBe(one)
  expect(gatesOf(snap, { description: 'leaf-1.1.1: check the cart totals' })).toBe(one)
  expect(gatesOf(snap, { description: 'leaf-1.1.1 check the cart totals' })).toBe(one)
  expect(gatesOf(snap, { description: 'Check the cart totals' })).toBeUndefined()
  const stem = gatesStemIn('Build the cart.\nGates: C:\\w\\gates\\leaf-1.1.1.md, tick each box.')
  expect(stem).toBe('leaf-1.1.1')
  expect(gatesOf(snap, { description: 'Implement config.js constant changes' }, stem)).toBe(one)
  expect(gatesStemIn('No gates here')).toBeUndefined()
})

test('a subagent window: the main one for the same model, 1M once its context passes 200k or the main session runs 1M', () => {
  expect(windowFor('opus', 'opus', 1000000)).toBe(1000000)
  expect(windowFor('sonnet', 'opus', 200000, 150000)).toBe(200000)
  expect(windowFor('sonnet', 'opus', 200000, 250000)).toBe(1000000)
  expect(windowFor('sonnet', 'opus', 1000000, 50000)).toBe(1000000)
  expect(windowFor('sonnet[1m]', 'opus', 200000)).toBe(1000000)
  expect(windowFor('opus', 'opus', 200000, 250000)).toBe(1000000)
  expect(windowFor('opus[1m]', 'opus', 200000)).toBe(1000000)
})

test('figures: model names, context colors, tokens and time', () => {
  expect(modelInfo('claude-opus-5-5').name).toBe('Opus 5.5')
  expect(modelInfo('claude-haiku-4-5-20251001').name).toBe('Haiku 4.5')
  expect(modelInfo('claude-opus-4-20250514').name).toBe('Opus 4')
  expect(modelInfo('sonnet').name).toBe('Sonnet')
  expect(modelInfo('gpt-x').family).toBe('inherit')
  expect(modelInfo('claude-opus-5-5').hue).toBe('#C3A6FF')
  expect([5, 10, 39, 59, 79, 90].map(gaugeColor)).toEqual(['#CED9FF', '#ACB9E6', '#CDBBE5', '#EA98EE', '#F883C9', '#FF6F7A'])
  expect([999, 46800, 312000, 1500000].map(formatTokens)).toEqual(['999', '46.8k', '312k', '1.5M'])
  expect([5000, 14 * 60000, 65 * 60000].map(formatElapsed)).toEqual(['5s', '14m', '1h05m'])
})

test('rows: main first, agents in order, task list stands in for missing gates, band sums every file', () => {
  const snap = emptySnap('s')
  applyStep(snap, undefined, 'claude-opus-5-5', 'high', { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 5000, cache_creation_input_tokens: 90 })
  applyStep(snap, 'a1', 'claude-haiku-4-5', undefined, { input_tokens: 1, output_tokens: 7, cache_read_input_tokens: 0, cache_creation_input_tokens: 20000 })
  applyTask(snap, 'TaskCreate', { subject: 'step A' }, '1')
  applyTask(snap, 'TaskCreate', { subject: 'step B' }, '2')
  applyTask(snap, 'TaskUpdate', { taskId: '1', status: 'completed' })
  expect(snap.main).toEqual({ model: 'claude-opus-5-5', effort: 'high', tokens: 100, context: 5100 })
  expect(snap.agents.a1).toEqual({ model: 'claude-haiku-4-5', tokens: 7, context: 20001 })

  const list = [{ ...AGENT }, { id: 'a2', description: 'two', type: 'Explore', status: 'failed' }]
  const rows = buildRows(snap, list, { window: 200000, startedAt: 0 }, 60000, 'main', 'this session', undefined)
  expect(rows.map(row => [row.name, row.status])).toEqual([['main', 'done'], ['leaf-1.1.1', 'running'], ['Explore', 'failed']])
  expect(rows[0]!.gates.map(gate => gate.state)).toEqual(['met', 'open'])
  expect(rows[0]!.description).toBe('step B')
  expect(rows[1]!.percent).toBe(10)
  expect(rows[1]!.hasGates).toBe(false)

  snap.gates.GATES = parseGates(GATES)
  snap.gates['leaf-1.1.1'] = parseGates(GATES).slice(0, 1)
  expect(buildRows(snap, list, undefined, 0, 'main', 'x', undefined)[0]!.gates).toHaveLength(5)
  expect(bandSummary(rows)).toEqual({ count: 1, done: 1, total: 2 })

  expect(settle(snap, list, 99)).toBe(true)
  expect(snap.agents.a2!.endedAt).toBe(99)
  expect(snap.agents.a1!.endedAt).toBeUndefined()
})

const MET = (id: string) => [`- [x] ${id}: done`, '      EVIDENCE: ok 1 passed', ''].join('\n')

test('the main ledger sums GATES.md and every gates file, and the band counts each gate once', () => {
  const snap = emptySnap('s')
  snap.gates.GATES = parseGates(MET('G1'))
  snap.gates['phase-b'] = parseGates(`${MET('G1')}\n${MET('G2')}`).map(gate => ({ ...gate, file: 'phase-b' }))
  snap.gates.ultimate = parseGates(MET('G1')).map(gate => ({ ...gate, file: 'ultimate' }))
  const list = [{ id: 'a1', name: 'phase-b', description: 'one', type: 'general-purpose', status: 'running' }]
  const rows = buildRows(snap, list, undefined, 0, 'main', 'x', undefined)
  const main = rows[0]!
  expect(main.gates.map(gate => `${gate.file ?? ''}/${gate.id}`)).toEqual(['/G1', 'phase-b/G1', 'phase-b/G2', 'ultimate/G1'])
  expect(rows[1]!.gates).toHaveLength(2)
  expect(bandSummary(rows)).toEqual({ count: 1, done: 4, total: 4 })
})

test('phase done: only a ledger read from gates files with no open gate says so', () => {
  const snap = emptySnap('s')
  const rowOf = () => buildRows(snap, [], undefined, 0, 'main', 'x', undefined)[0]!
  expect(rowOf().isPhaseDone).toBe(false)

  applyTask(snap, 'TaskCreate', { subject: 'step A' }, '1')
  applyTask(snap, 'TaskUpdate', { taskId: '1', status: 'completed' })
  expect(rowOf().isPhaseDone).toBe(false)

  snap.gates.GATES = parseGates(`${MET('G1')}\n- [ ] G2: later\n      EVIDENCE: pending\n`)
  expect(rowOf().isPhaseDone).toBe(false)

  snap.gates.GATES = parseGates(MET('G1'))
  expect(rowOf().isPhaseDone).toBe(true)

  snap.gates.GATES = parseGates(`${MET('G1')}\n- [ ] G2: given up\nABANDON: G2 not possible\n`)
  expect(rowOf().isPhaseDone).toBe(true)
})

test('the pane shows no phase done while a gate is open', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: '/w' } as never)
  const ui = await $.ui.mount(PANE)
  expect(JSON.stringify(await ui.drawn({ in: 'loops' }))).not.toContain('phase done')
  await ui.unmount()
})

test('the pane marks a finished ledger of gates files as phase done and names the file on each gate', async ($, on) => {
  stubEngine(on, [], [], { files: { 'gates/phase-b.md': MET('G1'), 'gates/ultimate.md': MET('G1') } })
  await $.session.start({ cwd: '/w' } as never)
  const ui = await $.ui.mount(PANE)
  const closed = JSON.stringify(await ui.drawn({ in: 'loops' }))
  expect(closed).toContain('2/2')
  expect(closed).toContain('phase done')
  await pointerOn(ui, { in: 'loops', type: 'down', x: 3, y: 0, button: 'left' })
  const open = JSON.stringify(await ui.drawn({ in: 'loops' }))
  expect(open).toContain('phase-b/G1 ultimate/G1')
  await ui.unmount()
})

test('a session that started outside the repo its checker ran in still finds its gates, under that repo\'s folder', async ($, on) => {
  stubEngine(on, [], [], { repo: 'mods', files: { 'gates/phase-b.md': MET('G1'), 'gates/ultimate.md': MET('G1') } })
  await $.session.start({ cwd: '/w' } as never)
  const ui = await $.ui.mount(PANE)
  expect(JSON.stringify(await ui.drawn({ in: 'loops' }))).toContain('2/2')
  await ui.unmount()
})

test('an empty folder a checker left for the same session in another repo does not hide the real ledger', async ($, on) => {
  stubEngine(on, [], [], { repo: 'mods', empty: ['C--Users-me--proj'] })
  await $.session.start({ cwd: '/w' } as never)
  const ui = await $.ui.mount(PANE)
  expect(JSON.stringify(await ui.drawn({ in: 'loops' }))).toContain('line-1-gates')
  await ui.unmount()
})

test('the band pill counts agents in a badge, and a click toggles the pane', async ($, on) => {
  const opened: string[] = []
  stubEngine(on, [AGENT], opened)
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>other mod</Text>
  })
  await $.session.start({ cwd: '/w' } as never)
  const band = await $.ui.mount(BAND)
  const pill = JSON.stringify(await band.drawn({ in: 'menu-entry-progress' }))
  expect(pill).toContain('Progress')
  expect(pill).toContain('" 1 "')
  await pointerOn(band, { in: 'menu-entry-progress', type: 'down', x: 1, y: 0, button: 'left' })
  expect(opened).toEqual(['progress'])
  await band.unmount()
})

test('after a /resume or /clear the pane drops the old session\'s loops and gates', async ($, on) => {
  const session = { id: 'sid-1' }
  stubEngine(on, [], [], { session })
  await $.session.start({ cwd: '/w' } as never)
  let ui = await $.ui.mount(PANE)
  expect(JSON.stringify(await ui.drawn({ in: 'loops' }))).toContain('312k')
  await ui.unmount()
  await $.session.end({ reason: 'clear', sessionId: 'sid-1', resume: {} } as never)
  session.id = 'sid-2'
  ui = await $.ui.mount(PANE)
  const fresh = JSON.stringify(await ui.drawn({ in: 'loops' }).catch(() => ''))
  expect(fresh).not.toContain('312k')
  expect(fresh).not.toContain('Haiku 4.5')
  expect(fresh).not.toContain('2/6')
  await ui.unmount()
})

test('the pane draws a card per loop and a click opens its gates', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: '/w' } as never)
  const ui = await $.ui.mount(PANE)
  const list = JSON.stringify(await ui.drawn({ in: 'loops' }))
  expect(list).toContain('main')
  expect(list).toContain('leaf-1.1.1')
  expect(list).toContain('Opus 5.5')
  expect(list).toContain('Haiku 4.5')
  expect(list).toContain('46%')
  expect(list).toContain('312k')
  // The main card sums GATES.md and gates/leaf-1.1.1.md; the agent's card shows only its own file.
  expect(list).toContain('2/6')
  expect(list).toContain('1/2')
  expect(list).not.toContain('G1')
  await pointerOn(ui, { in: 'loops', type: 'down', x: 3, y: 0, button: 'left' })
  const open = JSON.stringify(await ui.drawn({ in: 'loops' }))
  expect(open).toContain('G3 still open')
  expect(open).toContain('Waiting on evidence')
  expect(open).toContain('G4 given up')
  await pointerOn(ui, { in: 'loops', type: 'down', x: 3, y: 0, button: 'left' })
  expect(JSON.stringify(await ui.drawn({ in: 'loops' }))).not.toContain('G1')
  await ui.unmount()
})

test('the card of the agent whose transcript is in view carries the cursor', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: '/w' } as never)
  const main = await $.ui.mount(PANE)
  expect(JSON.stringify(await main.drawn({ in: 'loops' }))).not.toContain('❯')
  await main.unmount()
  const viewed = PANE as unknown as { props: object }
  const ui = await $.ui.mount({ ...viewed, props: { ...viewed.props, view: { agentId: 'a1' } } } as never)
  expect(JSON.stringify(await ui.drawn({ in: 'loops' }))).toContain('❯')
  await ui.unmount()
})

test('icons=nerd draws the Nerd gauge, spinner and agent icon', { options: { icons: 'nerd' } }, async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: '/w' } as never)
  const ui = await $.ui.mount(PANE)
  const list = JSON.stringify(await ui.drawn({ in: 'loops' }))
  for (const point of [0xf035b, 0xf0c8, 0xf096, 0xf110, 0xe0b6]) expect(list).toContain(String.fromCodePoint(point))
  expect(JSON.stringify(await ui.drawn({ in: 'progress-tab' }))).toContain(String.fromCodePoint(0xebbc))
  await ui.unmount()
})

test('mod-menu labels never leaves the band entry as its icon alone', { options: { icons: 'nerd' } }, async ($, on) => {
  stubEngine(on)
  on('state.get', (_$, e) => ({ value: { value: e.plugin === 'mod-menu' && e.key === 'labels' ? 'never' : undefined } }) as never)
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>other mod</Text>
  })
  await $.session.start({ cwd: '/w' } as never)
  const band = await $.ui.mount(BAND)
  const entry = JSON.stringify(await band.drawn({ in: 'menu-entry-progress' }))
  expect(entry).toContain(String.fromCodePoint(0xebbc))
  expect(entry).not.toContain('Progress')
  await band.unmount()
})

test('icons=safe draws only plain glyphs', { options: { icons: 'safe' } }, async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: '/w' } as never)
  const ui = await $.ui.mount(PANE)
  const list = JSON.stringify(await ui.drawn({ in: 'loops' }))
  expect(list).toContain('↻')
  expect(list).toContain('▦')
  expect(list).toContain('■')
  expect(list).toContain('□')
  expect(list).not.toContain(String.fromCodePoint(0xf035b))
  expect(list).not.toContain(String.fromCodePoint(0xe0b6))
  await ui.unmount()
})

test('a spawn, a step and a task call update the figures the pane reads', async ($, on) => {
  const { store } = stubEngine(on, [{ ...AGENT, id: 'zz' }])
  store.set('snap:sid-1', emptySnap('sid-1'))
  on('agent.spawn', () => ({ model: 'claude-haiku-4-5', agentId: 'zz' }) as never)
  on('tool.call', () => ({ result: { task: { id: '1', subject: 's' } } }) as never)
  await $.session.start({ cwd: '/w' } as never)
  await $.agent.spawn({ tool_use_id: 't', prompt: 'p', description: 'd', subagentType: 'general-purpose', provider: { plugin: 'x', tier: 'user' }, parentModel: 'm' } as never)
  await $.tool.call({ tool: 'TaskCreate', subject: 'step A', description: 'x' })
  const saved = store.get('snap:sid-1') as Snap
  expect(saved.agents.zz?.model).toBe('claude-haiku-4-5')
  expect(saved.tasks).toEqual([{ id: '1', subject: 'step A', status: 'pending' }])
})

test('each session keeps its figures under its own key, and a session no one touched for 30 days is deleted at start', async ($, on) => {
  const day = 24 * 60 * 60 * 1000
  const now = 14 * 60 * 1000 + 40 * day
  const { store } = stubEngine(on, [], [], { now })
  store.set('snap:old', { ...emptySnap('old'), savedAt: now - 31 * day })
  store.set('snap:recent', { ...emptySnap('recent'), savedAt: now - 29 * day })
  store.set('other', 'kept')
  store.set('snap', emptySnap('legacy'))
  await $.session.start({ cwd: '/w' } as never)
  expect(store.has('snap')).toBe(false)
  expect(store.has('snap:old')).toBe(false)
  expect(store.has('snap:recent')).toBe(true)
  expect((store.get('snap:sid-1') as Snap & { savedAt: number }).savedAt).toBe(now)
  expect(store.get('other')).toBe('kept')
})

test('a shell command touches the gates only when it names gates as a word, not investigate or navigate', async ($, on) => {
  const reads: string[] = []
  stubEngine(on, [], [], { reads })
  on('tool.call', () => ({ result: {} }) as never)
  await $.session.start({ cwd: '/w' } as never)
  reads.length = 0
  for (const command of ['investigate the flaky test', 'navigate to src', 'aggregate the totals']) await $.tool.call({ tool: 'Bash', command } as never)
  expect(reads).toEqual([])
  await $.tool.call({ tool: 'Bash', command: 'node gate-check.mjs' } as never)
  expect(reads.some(path => path.endsWith('GATES.md'))).toBe(true)
})

test('hovering the band pill shows its tip in the tip row, and a card shows its tip in the pane footer', async ($, on) => {
  stubEngine(on, [AGENT], [])
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>other mod</Text>
  })
  await $.session.start({ cwd: '/w' } as never)
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /running, gates|every agent with/ })).toBeUndefined()
  await pointerOn(band, { in: 'menu-entry-progress', type: 'enter', x: 1, y: 0, button: 'left' })
  expect((await band.find({ type: 'Text', text: /running, gates|every agent with/ }))?.text).toMatch(/^ (\d+ running, gates \d+\/\d+( · \d+ waiting)?|every agent with its context, tokens and gates)$/)
  expect((await band.find({ type: 'Text', text: /^Progress:$/ }))?.text).toBe('Progress:')
  await pointerOn(band, { in: 'menu-entry-progress', type: 'leave', x: 1, y: 0, button: 'left' })
  expect(await band.find({ type: 'Text', text: /running, gates|every agent with/ })).toBeUndefined()
  await band.unmount()

  const pane = await $.ui.mount(PANE)
  expect(await pane.find({ type: 'Text', text: /shows or hides/ })).toBeUndefined()
  await pointerOn(pane, { in: 'loops', type: 'move', x: 3, y: 0, button: 'left' })
  expect((await pane.find({ type: 'Text', text: /shows or hides this agent/ }))?.text).toContain("shows or hides this agent's gates")
  await pointerOn(pane, { in: 'loops', type: 'leave', x: 3, y: 0, button: 'left' })
  expect(await pane.find({ type: 'Text', text: /shows or hides this agent/ })).toBeUndefined()
  await pane.unmount()
})

// Each StopFailure kind, its stop line words and its tone (alert: act; warn: may clear).
const STOPS = [
  ['authentication_failed', 'sign-in needed', 'alert'],
  ['oauth_org_not_allowed', 'sign-in needed', 'alert'],
  ['cloud_credential_error', 'sign-in needed', 'alert'],
  ['account_on_hold', 'account on hold or needs verification', 'alert'],
  ['verification_required', 'account on hold or needs verification', 'alert'],
  ['billing_error', 'billing problem', 'alert'],
  ['invalid_request', 'request rejected', 'alert'],
  ['model_not_found', 'request rejected', 'alert'],
  ['rate_limit', 'usage limit reached', 'warn'],
  ['overloaded', 'server overloaded', 'warn'],
  ['server_error', 'other error', 'warn'],
  ['max_output_tokens', 'other error', 'warn'],
  ['unknown', 'other error', 'warn'],
] as const

test('each StopFailure kind reads as its line and tone, and a kind not named reads as other', () => {
  for (const [error, reason, tone] of STOPS) expect(stopLine({ error, at: 0 }, 0)).toEqual({ line: `Stopped 0s ago: ${reason}.`, tone })
  expect(stopLine({ error: 'a_new_kind', at: 0 }, 0)).toEqual({ line: 'Stopped 0s ago: other error.', tone: 'warn' })
  expect(stopLine(undefined, 0)).toBeNull()
})

test('a usage limit names the reset of the full window that clears last, in local time; other kinds keep no reset', () => {
  const now = new Date(2026, 9, 8, 19, 20).getTime()
  const at = (hour: number, minute: number) => new Date(2026, 9, 8, hour, minute).toISOString()
  const windows = [
    { percentUsed: 100, resetsAt: at(19, 33) },
    { percentUsed: 100, resetsAt: at(21, 5) },
    { percentUsed: 60, resetsAt: at(23, 0) },
    { percentUsed: 100, resetsAt: 'not a time' },
  ]
  const stop = stopOf('rate_limit', now - 120000, windows)
  expect(stop).toEqual({ error: 'rate_limit', at: now - 120000, resetsAt: at(21, 5) })
  expect(stopLine(stop, now)).toEqual({ line: 'Stopped 2m ago: usage limit reached. Resume after 9:05pm.', tone: 'warn' })
  expect(stopOf('overloaded', now, windows)).toEqual({ error: 'overloaded', at: now })
  expect(resumeAt(at(0, 15), now)).toBe('12:15am')
  expect(resumeAt(new Date(2026, 9, 9, 7, 33).toISOString(), now)).toMatch(/, 7:33am$/)
})

test('each StopFailure kind shows its line under the hint in its tone, and the next turn clears it', async ($, on) => {
  const { bridge, feed } = stubEngine(on)
  bridge.on = true
  await $.session.start({ cwd: '/w' } as never)
  const pane = await $.ui.mount(PANE)
  for (const [error, reason, tone] of STOPS) {
    await feed('StopFailure', { error, error_details: 'details' })
    await pane.redraw()
    const line = await pane.find({ type: 'Text', text: /Stopped 0s ago/ })
    expect(line?.text).toBe(`! Stopped 0s ago: ${reason}.`)
    expect(line?.props.color).toBe(tone === 'alert' ? THEME.alert : THEME.warn)
    await $.turn.start({ text: '', turnId: `turn-${error}` } as never)
    await pane.redraw()
    expect(await pane.find({ type: 'Text', text: /Stopped/ })).toBeUndefined()
  }
  await pane.unmount()
})

test('a usage limit shows the reset of the full window, ages with the clock, and a subagent failure leaves the line alone', async ($, on) => {
  const windows = [
    { kind: 'five_hour', percentUsed: 100, resetsAt: new Date(2026, 9, 8, 19, 33).toISOString() },
    { kind: 'seven_day', percentUsed: 40, resetsAt: new Date(2026, 9, 12, 9, 0).toISOString() },
  ]
  const { clock, bridge, feed } = stubEngine(on, [AGENT], [], { now: new Date(2026, 9, 8, 19, 20).getTime(), windows })
  bridge.on = true
  await $.session.start({ cwd: '/w' } as never)
  const pane = await $.ui.mount(PANE)
  await feed('StopFailure', { error: 'rate_limit', agent_id: 'a1' })
  await pane.redraw()
  expect(await pane.find({ type: 'Text', text: /Stopped/ })).toBeUndefined()

  await feed('StopFailure', { error: 'rate_limit' })
  await pane.redraw()
  expect((await pane.find({ type: 'Text', text: /Stopped/ }))?.text).toBe('! Stopped 0s ago: usage limit reached. Resume after 7:33pm.')

  await clock.advance(2 * 60000)
  await pane.redraw()
  expect((await pane.find({ type: 'Text', text: /Stopped/ }))?.text).toBe('! Stopped 2m ago: usage limit reached. Resume after 7:33pm.')
  await pane.unmount()
})

test('the band pill tip carries the stop line while the turn is stopped, and its age keeps up while hovered', async ($, on) => {
  const { clock, bridge, feed } = stubEngine(on)
  bridge.on = true
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>other mod</Text>
  })
  await $.session.start({ cwd: '/w' } as never)
  await feed('StopFailure', { error: 'billing_error' })
  const band = await $.ui.mount(BAND)
  await pointerOn(band, { in: 'menu-entry-progress', type: 'enter', x: 1, y: 0, button: 'left' })
  expect((await band.find({ type: 'Text', text: /Stopped 0s ago/ }))?.text).toBe(' Stopped 0s ago: billing problem.')
  await clock.advance(2 * 60000)
  await band.redraw()
  expect((await band.find({ type: 'Text', text: /Stopped 2m ago/ }))?.text).toBe(' Stopped 2m ago: billing problem.')
  await band.unmount()
})

test('icons=nerd leads the stop line with the Nerd warning glyph', { options: { icons: 'nerd' } }, async ($, on) => {
  const { bridge, feed } = stubEngine(on)
  bridge.on = true
  await $.session.start({ cwd: '/w' } as never)
  await feed('StopFailure', { error: 'overloaded' })
  const pane = await $.ui.mount(PANE)
  expect((await pane.find({ type: 'Text', text: /Stopped/ }))?.text).toBe(`${String.fromCodePoint(0xea6c)} Stopped 0s ago: server overloaded.`)
  await pane.unmount()
})

test('icons=safe leads the stop line with a plain bang', { options: { icons: 'safe' } }, async ($, on) => {
  const { bridge, feed } = stubEngine(on)
  bridge.on = true
  await $.session.start({ cwd: '/w' } as never)
  await feed('StopFailure', { error: 'overloaded' })
  const pane = await $.ui.mount(PANE)
  expect((await pane.find({ type: 'Text', text: /Stopped/ }))?.text).toBe('! Stopped 0s ago: server overloaded.')
  await pane.unmount()
})

test('a call reads as a step: the base name of its file, its search, its command, its host, or the tool name', () => {
  expect(stepOf('Read', { file_path: 'C:\\w\\src\\register.tsx' })).toBe('Reading register.tsx')
  expect(stepOf('Edit', { file_path: '/w/src/turns.ts', old_string: 'a', new_string: 'b' })).toBe('Editing turns.ts')
  expect(stepOf('MultiEdit', { file_path: '/w/src/turns.ts' })).toBe('Editing turns.ts')
  expect(stepOf('Write', { file_path: '/w/notes.md', content: '' })).toBe('Writing notes.md')
  expect(stepOf('Grep', { pattern: 'fitFor' })).toBe('Searching for fitFor')
  expect(stepOf('Glob', { pattern: '**/*.tsx' })).toBe('Searching for **/*.tsx')
  expect(stepOf('Bash', { command: 'npm test', description: 'Run the tests' })).toBe('Run the tests')
  expect(stepOf('Bash', { command: 'npm   test\n--silent' })).toBe('Running npm')
  expect(stepOf('WebFetch', { url: 'https://github.com/anthropics/claude-code', prompt: 'p' })).toBe('Fetching github.com')
  expect(stepOf('Agent', { description: 'scan', prompt: 'p' })).toBe('Asking a subagent')
  expect(stepOf('WebSearch', { query: 'q' })).toBe('WebSearch')
  expect(stepOf('Read', {})).toBe('Read')
})

test('a call sets the step of the loop it runs in, and a finished agent drops its step', () => {
  const snap = emptySnap('s')
  snap.busy = true
  snap.agents.a1 = { tokens: 0, context: 0 }
  applyCall(snap, undefined, 'Read', { file_path: '/w/a.ts' })
  applyCall(snap, 'a1', 'Grep', { pattern: 'fitFor' })
  applyCall(snap, 'ghost', 'Read', { file_path: '/w/b.ts' })
  expect(snap.main.step).toBe('Reading a.ts')
  expect(snap.agents.a1!.step).toBe('Searching for fitFor')
  expect(snap.agents.ghost).toBeUndefined()

  const list = [{ id: 'a1', description: 'Find fitFor', type: 'Explore', status: 'running' }]
  expect(buildRows(snap, list, undefined, 0, 'main', 'this session', undefined).map(row => row.description)).toEqual(['Reading a.ts', 'Searching for fitFor'])
  snap.busy = false
  expect(buildRows(snap, list, undefined, 0, 'main', 'this session', undefined).map(row => row.description)).toEqual(['this session', 'Searching for fitFor'])

  list[0]!.status = 'completed'
  expect(settle(snap, list, 5)).toBe(true)
  expect(snap.agents.a1!.step).toBeUndefined()
  expect(buildRows(snap, list, undefined, 0, 'main', 'this session', undefined)[1]!.description).toBe('Find fitFor')
})

test('task lists belong to their owner, and an agent with no gates file shows its own tasks as gates', () => {
  const snap = emptySnap('s')
  snap.agents.b2 = { tokens: 0, context: 0 }
  applyTask(snap, 'TaskCreate', { subject: 'main step' }, '1')
  applyTask(snap.agents.b2!, 'TaskCreate', { subject: 'scan files' }, '1')
  applyTask(snap.agents.b2!, 'TaskCreate', { subject: 'write summary' }, '2')
  applyTask(snap.agents.b2!, 'TaskUpdate', { taskId: '1', status: 'completed' })
  expect(snap.tasks).toEqual([{ id: '1', subject: 'main step', status: 'pending' }])
  expect(snap.agents.b2!.tasks).toEqual([
    { id: '1', subject: 'scan files', status: 'completed' },
    { id: '2', subject: 'write summary', status: 'pending' },
  ])

  const scout = [{ id: 'b2', name: 'scout', description: 'Explore the repo', type: 'Explore', status: 'running' }]
  const rows = buildRows(snap, scout, undefined, 0, 'main', 'x', undefined)
  expect(rows[0]!.gates).toEqual([{ id: '#1', text: 'main step', state: 'open' }])
  expect(rows[1]!.gates).toEqual([{ id: '#1', text: 'scan files', state: 'met' }, { id: '#2', text: 'write summary', state: 'open' }])
  expect(rows[1]!.hasGates).toBe(true)
  expect(bandSummary(rows)).toEqual({ count: 1, done: 1, total: 3 })

  snap.gates.scout = parseGates('- [ ] G1: from the file\n  EVIDENCE: pending\n')
  expect(buildRows(snap, scout, undefined, 0, 'main', 'x', undefined)[1]!.gates.map(gate => gate.id)).toEqual(['G1'])
})

test('a running card shows its latest call in place of its description, and the call clears when its loop ends', async ($, on) => {
  const list = [{ ...AGENT }]
  stubEngine(on, list)
  on('tool.call', () => ({ result: {} }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  await $.session.start({ cwd: '/w' } as never)
  const pane = await $.ui.mount(PANE)
  await $.tool.call({ tool: 'Read', file_path: '/w/src/register.tsx' } as never)
  await $.tool.call({ tool: 'Grep', pattern: 'fitFor', agentId: 'a1' } as never)
  await pane.redraw()
  const running = JSON.stringify(await pane.drawn({ in: 'loops' }))
  expect(running).toContain('Reading register.tsx')
  expect(running).toContain('Searching for fitFor')
  expect(running).not.toContain('Build the leaf')

  await $.turn.complete({ text: '' } as never)
  await pane.redraw()
  const mainEnded = JSON.stringify(await pane.drawn({ in: 'loops' }))
  expect(mainEnded).not.toContain('Reading register.tsx')
  expect(mainEnded).toContain('Searching for fitFor')

  await $.turn.start({ text: '', turnId: 'turn-2' } as never)
  await pane.redraw()
  const nextTurn = JSON.stringify(await pane.drawn({ in: 'loops' }))
  expect(nextTurn).not.toContain('Reading register.tsx')
  expect(nextTurn).toContain('this session')

  list[0]!.status = 'completed'
  await pane.redraw()
  const agentEnded = JSON.stringify(await pane.drawn({ in: 'loops' }))
  expect(agentEnded).not.toContain('Searching for fitFor')
  expect(agentEnded).toContain('Build the leaf')
  expect(agentEnded).toContain('this session')
  await pane.unmount()
})

test('a failing store never stops a turn, a stop or a session start from reaching the next hook', async ($, on) => {
  const storeDown = { is: false }
  const { bridge, feed } = stubEngine(on, [AGENT], [], { storeDown })
  bridge.on = true
  let reached = 0
  on('agent.spawn', () => ({ model: 'claude-haiku-4-5', agentId: 'zz' }) as never)
  on('turn.complete', () => {
    reached += 1
    return { text: '' } as never
  })
  await $.session.start({ cwd: '/w' } as never)
  storeDown.is = true
  expect(await $.turn.start({ text: '', turnId: 'turn-x' } as never)).toEqual({ turnId: 'turn-x' })
  await $.turn.complete({ text: '' } as never)
  expect(reached).toBe(1)
  await feed('StopFailure', { error: 'overloaded' })
  expect(await $.session.start({ cwd: '/w' } as never)).toEqual({ cwd: '/w' })
  const spawned = await $.agent.spawn({ tool_use_id: 't', prompt: 'p', description: 'd', subagentType: 'general-purpose', provider: { plugin: 'x', tier: 'user' }, parentModel: 'm' } as never)
  expect(spawned).toEqual({ model: 'claude-haiku-4-5', agentId: 'zz' })
})

test('a subagent with no gates file shows its own task list as gates, and the main list stays its own', async ($, on) => {
  const scout = { id: 'b2', name: 'scout', description: 'Explore the repo', type: 'Explore', status: 'running' }
  const { store } = stubEngine(on, [scout])
  store.set('snap:sid-1', { ...emptySnap('sid-1'), agents: { b2: { tokens: 0, context: 0 } } })
  let created = 0
  on('tool.call', (_$, e) => ({ result: { task: { id: e.tool === 'TaskCreate' ? String(++created) : undefined } } }) as never)
  await $.session.start({ cwd: '/w' } as never)
  await $.tool.call({ tool: 'TaskCreate', subject: 'scan files', description: 'x', agentId: 'b2' } as never)
  await $.tool.call({ tool: 'TaskCreate', subject: 'write summary', description: 'x', agentId: 'b2' } as never)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed', agentId: 'b2' } as never)
  await $.tool.call({ tool: 'TaskCreate', subject: 'main step', description: 'x' } as never)

  const saved = store.get('snap:sid-1') as Snap
  expect(saved.tasks.map(task => task.subject)).toEqual(['main step'])
  expect(saved.agents.b2?.tasks?.map(task => task.status)).toEqual(['completed', 'pending'])
  expect(saved.agents.b2?.step).toBeUndefined()

  const pane = await $.ui.mount(PANE)
  expect(JSON.stringify(await pane.drawn({ in: 'loops' }))).toContain('1/2')
  await pointerOn(pane, { in: 'loops', type: 'down', x: 3, y: 3, button: 'left' })
  const open = JSON.stringify(await pane.drawn({ in: 'loops' }))
  expect(open).toContain('#2 write summary')
  expect(open).toContain('    #1')
  expect(open).not.toContain('No gates yet')
  await pane.unmount()
})

const WORKFLOW = { runId: 'wf_abc123def', index: 1, name: 'finder-1', description: 'Find the callers' }

test('a workflow run\'s agents are no list entry, yet they get a row each, after the listed agents, in spawn order', () => {
  const snap = emptySnap('s')
  snap.agents.w2 = { model: 'claude-sonnet-5-5', tokens: 9, context: 4000, spawnedAt: 2000, workflow: { ...WORKFLOW, index: 2, name: 'editor-2', description: 'Edit the callers' } }
  snap.agents.w1 = { model: 'claude-haiku-4-5', tokens: 5, context: 100, spawnedAt: 1000, workflow: WORKFLOW }
  const rows = buildRows(snap, [{ ...AGENT }], { window: 200000, startedAt: 0 }, 5000, 'main', 'x', undefined)
  expect(rows.map(row => [row.name, row.status, row.run])).toEqual([['main', 'done', undefined], ['leaf-1.1.1', 'running', undefined], ['finder-1', 'running', 'wf_abc123def'], ['editor-2', 'running', 'wf_abc123def']])
  expect(rows[2]).toMatchObject({ description: 'Find the callers', model: 'claude-haiku-4-5', tokens: 5, elapsed: '4s' })
  expect(bandSummary(rows).count).toBe(3)
})

test('a workflow agent is done or failed once its turn ends, and an agent the list also names shows once', () => {
  const snap = emptySnap('s')
  snap.agents.w1 = { tokens: 1, context: 1, spawnedAt: 1000, workflow: WORKFLOW }
  snap.agents.w2 = { tokens: 1, context: 1, spawnedAt: 1000, workflow: { ...WORKFLOW, index: 2, name: 'editor-2' }, step: 'Edit(a.ts)' }
  snap.agents.a1 = { tokens: 1, context: 1, spawnedAt: 1000, workflow: { ...WORKFLOW, index: 3, name: 'same' } }
  expect(finishAgent(snap, 'w1', 4000, false)).toBe(true)
  expect(finishAgent(snap, 'w2', 5000, true)).toBe(true)
  expect(finishAgent(snap, 'w1', 9000, true)).toBe(false)
  expect(finishAgent(snap, 'nope', 9000, false)).toBe(false)
  expect(snap.agents.w2!.step).toBeUndefined()
  const rows = buildRows(snap, [{ ...AGENT }], undefined, 9000, 'main', 'x', undefined)
  expect(rows.filter(row => row.run).map(row => [row.name, row.status, row.elapsed])).toEqual([['leaf-1.1.1', 'running', '8s'], ['finder-1', 'done', '3s'], ['editor-2', 'failed', '4s']])
  expect(buildRows(snap, [{ ...AGENT, id: 'a1' }], undefined, 9000, 'main', 'x', undefined).filter(row => row.id === 'a1')).toHaveLength(1)
})

test('a gates file sent to a running agent by message becomes its gates, and a brief\'s own file is kept', async ($, on) => {
  const { store } = stubEngine(on, [])
  store.set('snap:sid-1', emptySnap('sid-1'))
  on('agent.spawn', (_$, e) => ({ model: 'claude-haiku-4-5', agentId: e.description === 'bare' ? 'a1' : 'a2' }) as never)
  on('session.send', () => ({ isDelivered: true }))
  await $.session.start({ cwd: '/w' } as never)
  const spawn = (description: string, prompt: string) => ({ tool_use_id: '', prompt, description, subagentType: 'general-purpose', provider: { plugin: 'x', tier: 'user' }, parentModel: 'm' }) as never
  await $.agent.spawn(spawn('bare', 'fix the previews'))
  await $.agent.spawn(spawn('briefed', 'your file: C:/g/gates/W.md'))
  const send = (to: string) => $.session.send({ to, text: 'Your gates file: C:\\g\\gates\\P.md, run the checker', origin: { kind: 'model' } } as never)
  await send('a1')
  await send('a2')
  const saved = store.get('snap:sid-1') as Snap
  expect(saved.agents.a1?.gatesStem).toBe('P')
  expect(saved.agents.a2?.gatesStem).toBe('W')
})

test('a workflow agent\'s spawn keeps its run, and its own turn ending or failing settles its row', async ($, on) => {
  const { store } = stubEngine(on, [])
  store.set('snap:sid-1', emptySnap('sid-1'))
  on('agent.spawn', (_$, e) => ({ model: 'claude-haiku-4-5', agentId: e.name === 'finder-1' ? 'w1' : 'w2' }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  await $.session.start({ cwd: '/w' } as never)
  const spawn = (name: string, index: number) => ({ tool_use_id: '', prompt: 'Find the callers\nmore', description: 'Find the callers', name, subagentType: 'general-purpose', provider: { plugin: 'x', tier: 'user' }, parentModel: 'm', workflow: { runId: 'wf_abc123def', agentIndex: index } }) as never
  await $.agent.spawn(spawn('finder-1', 1))
  await $.agent.spawn(spawn('editor-2', 2))
  expect((store.get('snap:sid-1') as Snap).agents.w1?.workflow).toEqual({ runId: 'wf_abc123def', index: 1, name: 'finder-1', description: 'Find the callers' })
  await $.turn.complete({ turnId: 't', agentId: 'w1', reason: 'answer' } as never)
  await $.turn.complete({ turnId: 't', agentId: 'w2', reason: 'error' } as never)
  const saved = store.get('snap:sid-1') as Snap
  expect([saved.agents.w1?.endedAt, saved.agents.w1?.isFailed]).toEqual([14 * 60 * 1000, undefined])
  expect([saved.agents.w2?.endedAt, saved.agents.w2?.isFailed]).toEqual([14 * 60 * 1000, true])
})

test('the pane groups a workflow run\'s agents under a line that counts how many are done', async ($, on) => {
  const snap = seeded()
  snap.agents.w1 = { model: 'claude-haiku-4-5', tokens: 5, context: 100, spawnedAt: 1000, endedAt: 3000, workflow: WORKFLOW }
  snap.agents.w2 = { model: 'claude-sonnet-5-5', tokens: 9, context: 400, spawnedAt: 2000, workflow: { ...WORKFLOW, index: 2, name: 'editor-2', description: 'Edit the callers' } }
  const { store } = stubEngine(on)
  store.set('snap:sid-1', snap)
  await $.session.start({ cwd: '/w' } as never)
  const ui = await $.ui.mount(PANE)
  const list = JSON.stringify(await ui.drawn({ in: 'loops' }))
  expect(list).toContain('Workflow abc123')
  expect(list).toContain('1 of 2 done')
  expect(list).toContain('finder-1')
  expect(list).toContain('editor-2')
  expect(list.indexOf('leaf-1.1.1')).toBeLessThan(list.indexOf('Workflow abc123'))
  await ui.unmount()
})

test('a subagent that fails ends its workflow row as failed and leaves the main line alone, and a second failure changes nothing', async ($, on) => {
  const { store, bridge, feed } = stubEngine(on, [])
  bridge.on = true
  store.set('snap:sid-1', emptySnap('sid-1'))
  on('agent.spawn', () => ({ model: 'claude-haiku-4-5', agentId: 'w1' }) as never)
  await $.session.start({ cwd: '/w' } as never)
  await $.agent.spawn({ tool_use_id: '', prompt: 'p', description: 'Find', name: 'finder-1', subagentType: 'general-purpose', provider: { plugin: 'x', tier: 'user' }, parentModel: 'm', workflow: { runId: 'wf_abc123def', agentIndex: 1 } } as never)
  await feed('StopFailure', { error: 'overloaded', agent_id: 'w1' })
  const saved = store.get('snap:sid-1') as Snap
  expect([saved.agents.w1?.endedAt, saved.agents.w1?.isFailed, saved.stop]).toEqual([14 * 60 * 1000 + 250, true, undefined])
  await feed('StopFailure', { error: 'overloaded', agent_id: 'w1' })
  expect((store.get('snap:sid-1') as Snap).agents.w1?.endedAt).toBe(14 * 60 * 1000 + 250)
})

test('a StopFailure replayed after a reload sets no stale banner, and a new failure after it does', async ($, on) => {
  const { store, bridge, feed } = stubEngine(on)
  bridge.on = true
  const old = { session_id: 'sid-1', hook_event_name: 'StopFailure', error: 'rate_limit' }
  store.set('bridge-last:sid-1:StopFailure', { raw: JSON.stringify(old), at: 0 })
  bridge.text = `${JSON.stringify(old)}\n`
  await $.session.start({ cwd: '/w' } as never)
  expect((store.get('snap:sid-1') as Snap).stop).toBeUndefined()
  await feed('StopFailure', { error: 'overloaded' })
  expect((store.get('snap:sid-1') as Snap).stop?.error).toBe('overloaded')
})

test('a replayed SubagentStop does not reopen a finished row, and a StopFailure never seen by this module is handled once', async ($, on) => {
  const { store, bridge, feed } = stubEngine(on, [])
  bridge.on = true
  const snap = emptySnap('sid-1')
  snap.agents.w1 = { tokens: 1, context: 1, spawnedAt: 1000, endedAt: 5000, workflow: WORKFLOW }
  store.set('snap:sid-1', snap)
  const old = { session_id: 'sid-1', hook_event_name: 'StopFailure', error: 'overloaded', agent_id: 'w1' }
  bridge.text = `${JSON.stringify(old)}\n${JSON.stringify({ session_id: 'sid-1', hook_event_name: 'SubagentStop', agent_id: 'w1', agent_type: '' })}\n`
  await $.session.start({ cwd: '/w' } as never)
  expect([(store.get('snap:sid-1') as Snap).agents.w1?.endedAt, (store.get('snap:sid-1') as Snap).agents.w1?.isFailed]).toEqual([5000, undefined])
  await feed('SubagentStop', { agent_id: 'w1', agent_type: '', background_tasks: [] })
  expect((store.get('snap:sid-1') as Snap).agents.w1?.endedAt).toBe(5000)
})

test('without any stop record, the turn ending alone clears busy, drops the step and settles an agent the list reports done', async ($, on) => {
  const { store } = stubEngine(on, [{ ...AGENT, status: 'completed' }])
  on('turn.complete', () => ({ text: '' }) as never)
  const before = seeded()
  before.main.step = 'Read(a.ts)'
  store.set('snap:sid-1', before)
  await $.session.start({ cwd: '/w' } as never)
  await $.turn.complete({ turnId: 't', reason: 'answer' } as never)
  const saved = store.get('snap:sid-1') as Snap
  expect([saved.busy, saved.main.step, saved.agents.a1?.endedAt]).toEqual([false, undefined, 14 * 60 * 1000])
})

const OPEN = (id: string) => `- [ ] ${id}: not yet\n      EVIDENCE: pending\n`
const WAITING = (id: string) => `- [x] ${id}: ticked early\n      EVIDENCE: pending\n`
const DROPPED = (id: string, what: string) => `- [ ] ${id}: ${what}\nABANDON: ${id} no\n`
const MIXED = [MET('G1'), WAITING('G2'), OPEN('G3'), DROPPED('G4', 'desktop drawing')].join('\n')
const MINUTE = 60 * 1000

test('gates state: a checked box with pending or missing evidence is pending, not met', () => {
  const state = (source: string) => parseGates(source)[0]!.state
  expect(state('- [x] G1: a\n      EVIDENCE: pending\n')).toBe('pending')
  expect(state('- [X] G1: a\n      EVIDENCE: PENDING\n')).toBe('pending')
  expect(state('- [x] G1: a\n')).toBe('pending')
  expect(state('- [x] G1: a\n      EVIDENCE: ok 3 passed\n')).toBe('met')
  expect(state('- [ ] G1: a\n      EVIDENCE: ok 3 passed\n')).toBe('open')
})

test('gates state: an ABANDON line wins over a checked box, and a pending gate is not a finished phase', () => {
  expect(parseGates('- [x] G1: a\nABANDON: G1 no\n')[0]!.state).toBe('abandoned')
  const snap = emptySnap('s')
  snap.gates.GATES = parseGates(`${MET('G1')}\n${WAITING('G2')}`)
  expect(buildRows(snap, [], undefined, 0, 'main', 'x', undefined)[0]!.isPhaseDone).toBe(false)
})

for (const icons of ['nerd', 'safe'] as const) {
  test(`gates strip: one cell per gate, met first, colored by state (${icons})`, { options: { icons } }, async ($, on) => {
    stubEngine(on, [], [], { files: { 'GATES.md': MIXED } })
    await $.session.start({ cwd: '/w' } as never)
    const ui = await $.ui.mount(PANE)
    const pill = JSON.stringify(await ui.drawn({ in: 'loops' }))
    const cells = [
      [icons === 'nerd' ? String.fromCodePoint(0xf0c8) : '■', THEME.ok],
      [icons === 'nerd' ? String.fromCodePoint(0xf0c8) : '■', THEME.warn],
      [icons === 'nerd' ? String.fromCodePoint(0xf096) : '□', THEME.muted],
      [icons === 'nerd' ? String.fromCodePoint(0xf00d) : '×', THEME.alert],
    ] as const
    const text = pill.replace(/\\"/g, '"')
    for (const [glyph, color] of cells) expect(text.includes(glyph) && text.includes(color)).toBe(true)
    const order = cells.map(([glyph, color]) => text.indexOf(`"${glyph}"`, text.indexOf(color)))
    expect(order.every(at => at >= 0)).toBe(true)
    expect(text).toContain('1/4')
    await ui.unmount()
  })
}

test('gates strip: overflow past the row scales the cells to the room, met share first, and draws no +N', async ($, on) => {
  const many = [...Array.from({ length: 32 }, (_, at) => MET(`M${at + 1}`)), ...Array.from({ length: 18 }, (_, at) => OPEN(`G${at + 1}`))].join('\n')
  stubEngine(on, [], [], { files: { 'GATES.md': many } })
  await $.session.start({ cwd: '/w' } as never)
  const ui = await $.ui.mount(PANE)
  const text = JSON.stringify(await ui.drawn({ in: 'loops' }))
  const open = (text.match(/□/g) ?? []).length - 3
  expect(open).toBeGreaterThan(0)
  expect(open).toBeLessThan(18)
  expect(text).not.toMatch(/"\+\d+"/)
  expect(text).toContain('32/50')
  await ui.unmount()
})

test('timeline view: two agents that share a name read by what they do; a unique name and main keep theirs', () => {
  const row = (name: string, description: string, isMain = false) => ({ isMain, name, description })
  expect(laneLabels([row('main', 'this session', true), row('general-purpose', 'Reply with one'), row('general-purpose', 'Sleep then reply'), row('finder', 'Find callers'), row('general-purpose', ' ')]))
    .toEqual(['main', 'Reply with one', 'Sleep then reply', 'finder', 'general-purpose'])
})

test('gates strip: stripCells keeps one cell per gate while they fit, then shares the room by state', () => {
  const gates = (met: number, waiting: number, open: number) =>
    parseGates([...Array.from({ length: met }, (_, at) => MET(`M${at}`)), ...Array.from({ length: waiting }, (_, at) => WAITING(`W${at}`)), ...Array.from({ length: open }, (_, at) => OPEN(`O${at}`))].join('\n'))
  expect(stripCells(gates(2, 1, 1), 8)).toEqual(['met', 'met', 'pending', 'open'])
  expect(stripCells(gates(32, 0, 18), 10)).toEqual([...Array(6).fill('met'), ...Array(4).fill('open')])
  const nearlyDone = stripCells(gates(98, 1, 1), 10)
  expect(nearlyDone).toHaveLength(10)
  expect(nearlyDone.filter(state => state === 'met')).toHaveLength(8)
  expect(nearlyDone).toContain('pending')
  expect(nearlyDone).toContain('open')
  expect(stripCells(gates(5, 0, 5), 0)).toEqual([])
})

test('gates strip: cells fill from the left, met then waiting, open and dropped, so a cut strip still shows what is done', () => {
  const gates = parseGates(['- [ ] G1: open', '- [x] G2: met', '      EVIDENCE: ok', '- [x] G3: waiting', '      EVIDENCE: pending', 'ABANDON: G4 gone', '- [ ] G4: dropped', '- [x] G5: met too', '      EVIDENCE: ok'].join('\n'))
  expect(stripOrder(gates).map(gate => gate.id)).toEqual(['G2', 'G5', 'G3', 'G1', 'G4'])
})

test('gates detail: an expanded card groups open, waiting, met and dropped, skipping empty groups', async ($, on) => {
  const { clock } = stubEngine(on, [], [], { files: { 'GATES.md': MIXED } })
  await $.session.start({ cwd: '/w' } as never)
  await clock.advance(12 * MINUTE)
  const ui = await $.ui.mount(PANE)
  await pointerOn(ui, { in: 'loops', type: 'down', x: 3, y: 0, button: 'left' })
  const text = JSON.stringify(await ui.drawn({ in: 'loops' }))
  const at = ['Open', 'Waiting on evidence', 'Met', 'Dropped'].map(label => text.indexOf(`${label}"`))
  expect(at.every(each => each >= 0)).toBe(true)
  expect([...at].sort((a, b) => a - b)).toEqual(at)
  expect(text).toContain('G3 not yet')
  expect(text).toContain('G2 ticked early')
  expect(text).toContain('G1')
  expect(text).toContain('G4 desktop drawing')
  expect(text).not.toContain('G1 done')
  expect(text).toContain('12m')
  await ui.unmount()
})

test('gates detail: a group with no gates is skipped and waiting time counts from the check', async ($, on) => {
  const files = { 'GATES.md': `${OPEN('G1')}\n${OPEN('G2')}` }
  const { clock } = stubEngine(on, [], [], { files })
  on('turn.complete', () => ({ text: '' }) as never)
  await $.session.start({ cwd: '/w' } as never)
  await clock.advance(5 * MINUTE)
  files['GATES.md'] = `${OPEN('G1')}\n${WAITING('G2')}`
  await $.turn.complete({ turnId: 't', reason: 'answer' } as never)
  await clock.advance(3 * MINUTE)
  const ui = await $.ui.mount(PANE)
  await pointerOn(ui, { in: 'loops', type: 'down', x: 3, y: 0, button: 'left' })
  const text = JSON.stringify(await ui.drawn({ in: 'loops' }))
  expect(text).not.toContain('Met"')
  expect(text).not.toContain('Dropped"')
  expect(text).toContain('8m')
  expect(text).toContain('3m')
  await ui.unmount()
})

test('gates detail: met and dropped fold to one line, cut with an ellipsis when long', async ($, on) => {
  const met = Array.from({ length: 40 }, (_, at) => MET(`G${at + 1}`)).join('\n')
  stubEngine(on, [], [], { files: { 'GATES.md': `${met}\n${DROPPED('G99', 'a long reason that cannot fit inside the card width at all')}` } })
  await $.session.start({ cwd: '/w' } as never)
  const ui = await $.ui.mount(PANE)
  await pointerOn(ui, { in: 'loops', type: 'down', x: 3, y: 0, button: 'left' })
  const text = JSON.stringify(await ui.drawn({ in: 'loops' }))
  expect(text).toContain('G1 G2 G3')
  expect(text).toContain('…')
  expect(text).toContain('G99 a long')
  expect(cutText('abcdef', 4)).toBe('abc…')
  expect(cutText('abc', 4)).toBe('abc')
  await ui.unmount()
})

test('gates detail: groupGates orders the groups and drops the empty ones', () => {
  const gates = parseGates(MIXED)
  expect(groupGates(gates).map(group => [group.state, group.gates.length])).toEqual([['open', 1], ['pending', 1], ['met', 1], ['abandoned', 1]])
  expect(groupGates(parseGates(MET('G1'))).map(group => group.state)).toEqual(['met'])
})

test('gates stamps: a re-read keeps first seen, and changedAt moves only when the state changes', () => {
  const first = mergeStamps(undefined, parseGates(`${OPEN('G1')}\n${OPEN('G2')}`), 100)
  expect(first.map(gate => [gate.firstSeenAt, gate.changedAt])).toEqual([[100, 100], [100, 100]])
  const second = mergeStamps(first, parseGates(`${OPEN('G1')}\n${WAITING('G2')}\n${OPEN('G3')}`), 500)
  expect(second.map(gate => [gate.id, gate.firstSeenAt, gate.changedAt])).toEqual([['G1', 100, 100], ['G2', 100, 500], ['G3', 500, 500]])
})

test('gates stamps: gates of another file with the same id keep their own, and a saved copy carries on after a reload', () => {
  const a = mergeStamps(undefined, parseGates(OPEN('G1')).map(gate => ({ ...gate, file: 'a' })), 10)
  const both = mergeStamps(a, [...parseGates(OPEN('G1')).map(gate => ({ ...gate, file: 'a' })), ...parseGates(OPEN('G1')).map(gate => ({ ...gate, file: 'b' }))], 90)
  expect(both.map(gate => [gate.file, gate.firstSeenAt])).toEqual([['a', 10], ['b', 90]])
  const reloaded = JSON.parse(JSON.stringify(both)) as typeof both
  expect(mergeStamps(reloaded, parseGates(OPEN('G1')).map(gate => ({ ...gate, file: 'a' })), 900)[0]!.firstSeenAt).toBe(10)
})

test('gates stamps: the store keeps the stamps across re-reads', async ($, on) => {
  const files = { 'GATES.md': `${OPEN('G1')}\n${OPEN('G2')}` }
  const { store, clock } = stubEngine(on, [], [], { files })
  on('turn.complete', () => ({ text: '' }) as never)
  await $.session.start({ cwd: '/w' } as never)
  const read = () => (store.get('snap:sid-1') as Snap).gates.GATES!.map(gate => [gate.id, gate.firstSeenAt, gate.changedAt])
  expect(read()).toEqual([['G1', 14 * MINUTE, 14 * MINUTE], ['G2', 14 * MINUTE, 14 * MINUTE]])
  await clock.advance(2 * MINUTE)
  files['GATES.md'] = `${OPEN('G1')}\n${MET('G2')}`
  await $.turn.complete({ turnId: 't', reason: 'answer' } as never)
  expect(read()).toEqual([['G1', 14 * MINUTE, 14 * MINUTE], ['G2', 14 * MINUTE, 16 * MINUTE]])
})

test('gates refresh: a main turn completing re-reads a file a script changed', async ($, on) => {
  const files = { 'GATES.md': OPEN('G1') }
  const { store } = stubEngine(on, [], [], { files })
  on('turn.complete', () => ({ text: '' }) as never)
  await $.session.start({ cwd: '/w' } as never)
  files['GATES.md'] = MET('G1')
  await $.turn.complete({ turnId: 't', reason: 'answer' } as never)
  expect((store.get('snap:sid-1') as Snap).gates.GATES!.map(gate => gate.state)).toEqual(['met'])
})

test('gates refresh: a Stop or SubagentStop record re-reads the files too', async ($, on) => {
  const files = { 'GATES.md': OPEN('G1') }
  const { store, bridge, feed } = stubEngine(on, [AGENT], [], { files })
  bridge.on = true
  await $.session.start({ cwd: '/w' } as never)
  const states = () => (store.get('snap:sid-1') as Snap).gates.GATES!.map(gate => gate.state)
  files['GATES.md'] = WAITING('G1')
  await feed('Stop')
  expect(states()).toEqual(['pending'])
  files['GATES.md'] = MET('G1')
  await feed('SubagentStop', { agent_id: 'a1', agent_type: '' })
  expect(states()).toEqual(['met'])
})

test('gates refresh: the Progress tip adds how many gates wait on evidence', async ($, on) => {
  stubEngine(on, [AGENT], [], { files: { 'GATES.md': MIXED } })
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>other mod</Text>
  })
  await $.session.start({ cwd: '/w' } as never)
  const band = await $.ui.mount(BAND)
  await pointerOn(band, { in: 'menu-entry-progress', type: 'enter', x: 1, y: 0, button: 'left' })
  expect((await band.find({ type: 'Text', text: /running, gates/ }))?.text).toBe(' 1 running, gates 1/4 · 1 waiting')
  await band.unmount()
})

const flat = (node: unknown): string => (typeof node === 'string' ? node : ((node as { children?: unknown[] }).children ?? []).map(flat).join(''))
const lanesOf = (tree: unknown) => ((tree as { children: unknown[] }).children ?? []).map(flat)
const paneAt = (bodyColumns: number) => ({ ...(PANE as object), props: { ...(PANE as { props: object }).props, bodyColumns } }) as never
const A2 = { id: 'a2', name: 'finder', description: 'Find callers', type: 'Explore', status: 'completed' }
const A3 = { id: 'a3', name: 'a-rather-long-agent-name-here', description: 'Break', type: 'Explore', status: 'failed' }

// The seeded session runs 14 minutes: main from 0, a1 from 1s and running, a2 from 2m to 5m, a3 from 6m to 7m.
function withLanes(on: On, options: { files?: Record<string, string> } = {}) {
  const engine = stubEngine(on, [AGENT, A2, A3], [], options.files ? { files: options.files } : {})
  const snap = engine.store.get('snap:sid-1') as Snap
  snap.agents.a2 = { tokens: 0, context: 0, spawnedAt: 2 * MINUTE, endedAt: 5 * MINUTE }
  snap.agents.a3 = { tokens: 0, context: 0, spawnedAt: 6 * MINUTE, endedAt: 7 * MINUTE, isFailed: true }
  return engine
}

test('timeline lanes: the clock starts at the earliest start and a running loop reaches the right edge', () => {
  const lanes = laneCells([{ start: 1000, isRunning: true }, { start: 2000, end: 5000, isRunning: false }, { start: 0, end: 4000, isRunning: false }], 10000, 10)
  expect(lanes).toEqual([{ from: 1, to: 10 }, { from: 2, to: 5 }, { from: 0, to: 4 }])
  expect(Math.min(...lanes.map(lane => lane.from))).toBe(0)
})

test('timeline lanes: a zero-length loop still takes one cell, even at the far edge', () => {
  expect(laneCells([{ start: 0, end: 9000, isRunning: false }, { start: 3000, end: 3000, isRunning: false }, { start: 9000, end: 9000, isRunning: false }], 9000, 20)).toEqual([{ from: 0, to: 20 }, { from: 6, to: 7 }, { from: 19, to: 20 }])
  expect(laneCells([{ start: 500, isRunning: true }], 500, 8)).toEqual([{ from: 0, to: 8 }])
})

test('timeline lanes: with nothing running the clock ends at the last end, and a loop with no start begins at the clock start', () => {
  expect(laneCells([{ start: 0, end: 5000, isRunning: false }, { end: 2500, isRunning: false }], 90000, 10)).toEqual([{ from: 0, to: 10 }, { from: 0, to: 5 }])
  expect(laneCells([], 5, 10)).toEqual([])
  expect(laneCells([{ start: 0, isRunning: true }], 100, 0)).toEqual([{ from: 0, to: 1 }])
})

test('timeline lanes: the columns add up to the pane width at 40 and 100 columns', () => {
  for (const width of [34, 94]) {
    const cols = timelineCols(width, 5)
    expect(2 + 1 + 1 + cols.name + 1 + cols.lane + 1 + cols.dur + 1).toBe(width)
  }
  expect(timelineCols(34, 5).name).toBe(16)
})

test('timeline switch: Cards is chosen at first, the choice bar offers both, and a click on Timeline swaps the view and keeps it', async ($, on) => {
  const { store } = withLanes(on)
  await $.session.start({ cwd: '/w' } as never)
  const ui = await $.ui.mount(PANE)
  const bar = JSON.stringify(await ui.drawn())
  expect(bar).toContain(`"label":"${text.viewCards}"`)
  expect(bar).toContain(`"label":"${text.viewTimeline}"`)
  expect(JSON.stringify(await ui.drawn())).toContain('"module":"hooks/loops.tsx"')
  await pointerOn(ui, { in: 'view-timeline', type: 'down', x: 1, y: 0, button: 'left' })
  expect((store.get('snap:sid-1') as Snap).view).toBe('timeline')
  expect(JSON.stringify(await ui.drawn())).toContain('"module":"hooks/timeline.tsx"')
  await ui.unmount()
  const again = await $.ui.mount(PANE)
  expect(JSON.stringify(await again.drawn())).toContain('"module":"hooks/timeline.tsx"')
  await pointerOn(again, { in: 'view-cards', type: 'down', x: 1, y: 0, button: 'left' })
  expect((store.get('snap:sid-1') as Snap).view).toBe('cards')
  expect(JSON.stringify(await again.drawn())).toContain('"module":"hooks/loops.tsx"')
  await again.unmount()
})

for (const icons of ['nerd', 'safe'] as const) {
  for (const columns of [40, 100]) {
    test(`timeline view: one row per loop in card order, each within the pane width at ${columns} columns (${icons})`, { options: { icons } }, async ($, on) => {
      withLanes(on)
      await $.session.start({ cwd: '/w' } as never)
      const ui = await $.ui.mount(paneAt(columns))
      await pointerOn(ui, { in: 'view-timeline', type: 'down', x: 1, y: 0, button: 'left' })
      const tree = await ui.drawn({ in: 'timeline' })
      const rows = lanesOf(tree)
      expect(rows).toHaveLength(4)
      expect(rows.every(row => [...row].length === columns - 6)).toBe(true)
      expect(rows.map(row => row.includes('main') || row.includes('leaf-1.1.1') || row.includes('finder') || row.includes('a-rather-long'))).toEqual([true, true, true, true])
      expect(rows[0]).toContain('main')
      expect(rows[1]).toContain('leaf-1.1.1')
      expect(rows[3]).toContain('…')
      expect(rows.every(row => row.includes('━'))).toBe(true)
      expect(rows.slice(2).every(row => row.includes('·'))).toBe(true)
      expect(rows[0]).toContain('14m')
      expect(rows[2]).toContain('3m')
      const drawn = JSON.stringify(tree)
      for (const color of [THEME.ok, THEME.accent, THEME.alert, THEME.border]) expect(drawn).toContain(color)
      expect(rows[1]).toContain(icons === 'nerd' ? String.fromCodePoint(0xf110) : '↻')
      await ui.unmount()
    })
  }
}

test('timeline view: an idle main loop ends its lane at its last turn, and a running agent reaches now', async ($, on) => {
  const { store, clock } = withLanes(on)
  on('turn.complete', () => ({ text: '' }) as never)
  const snap = store.get('snap:sid-1') as Snap
  snap.busy = false
  snap.main.endedAt = 7 * MINUTE
  await $.session.start({ cwd: '/w' } as never)
  await clock.advance(0)
  const ui = await $.ui.mount(paneAt(100))
  await pointerOn(ui, { in: 'view-timeline', type: 'down', x: 1, y: 0, button: 'left' })
  const rows = lanesOf(await ui.drawn({ in: 'timeline' }))
  const span = (row: string) => [...row].filter(char => char === '━').length
  expect(span(rows[0]!)).toBeLessThan(span(rows[1]!))
  expect(rows[1]!.indexOf('·')).toBeLessThan(rows[1]!.indexOf('━') + 1)
  await ui.unmount()
})

test('timeline click: the row under the pointer lights accent on lifted, and a click selects that loop like its card', async ($, on) => {
  const { store } = withLanes(on, { files: { 'GATES.md': MIXED, 'gates/leaf-1.1.1.md': OPEN('L1') } })
  await $.session.start({ cwd: '/w' } as never)
  const ui = await $.ui.mount(PANE)
  await pointerOn(ui, { in: 'view-timeline', type: 'down', x: 1, y: 0, button: 'left' })
  const rowOf = async (at: number) => JSON.stringify((await ui.drawn({ in: 'timeline' }) as { children: unknown[] }).children[at])
  expect(await rowOf(1)).toContain(`"backgroundColor":"${cardFill()}"`)
  await pointerOn(ui, { in: 'timeline', type: 'move', x: 5, y: 1, button: 'left' })
  const lit = await rowOf(1)
  expect(lit).toContain(`"backgroundColor":"${THEME.lifted}"`)
  expect(lit).toMatch(new RegExp(`"color":"${THEME.accent}","bold":false},"children":\\["leaf-1.1.1`))
  expect(await rowOf(0)).not.toContain(THEME.lifted)
  await pointerOn(ui, { in: 'timeline', type: 'leave', x: 5, y: 1, button: 'left' })
  expect(await rowOf(1)).not.toContain(THEME.lifted)
  await pointerOn(ui, { in: 'timeline', type: 'down', x: 5, y: 1, button: 'left' })
  expect((store.get('snap:sid-1') as Snap).expanded).toBe('a1')
  expect(JSON.stringify(await ui.drawn())).toContain(text.openTranscript)
  await pointerOn(ui, { in: 'view-cards', type: 'down', x: 1, y: 0, button: 'left' })
  expect(JSON.stringify(await ui.drawn({ in: 'loops' }))).toContain('L1 not yet')
  await ui.unmount()
})

test('timeline click: a second click on the selected lane closes the selection, as on a card', async ($, on) => {
  const { store } = withLanes(on)
  await $.session.start({ cwd: '/w' } as never)
  const ui = await $.ui.mount(PANE)
  await pointerOn(ui, { in: 'view-timeline', type: 'down', x: 1, y: 0, button: 'left' })
  await pointerOn(ui, { in: 'timeline', type: 'down', x: 5, y: 2, button: 'left' })
  expect((store.get('snap:sid-1') as Snap).expanded).toBe('a2')
  await pointerOn(ui, { in: 'timeline', type: 'down', x: 5, y: 2, button: 'left' })
  expect((store.get('snap:sid-1') as Snap).expanded).toBe('')
  await ui.unmount()
})

test('timeline tip: hovering a lane or either switch option shows its tip in the pane footer', async ($, on) => {
  withLanes(on)
  await $.session.start({ cwd: '/w' } as never)
  const ui = await $.ui.mount(PANE)
  await pointerOn(ui, { in: 'view-timeline', type: 'enter', x: 1, y: 0, button: 'left' })
  expect(await ui.find({ type: 'Text', text: new RegExp(text.tipViewTimeline) })).toBeDefined()
  await pointerOn(ui, { in: 'view-timeline', type: 'leave', x: 1, y: 0, button: 'left' })
  await pointerOn(ui, { in: 'view-cards', type: 'enter', x: 1, y: 0, button: 'left' })
  expect(await ui.find({ type: 'Text', text: new RegExp(text.tipViewCards) })).toBeDefined()
  await pointerOn(ui, { in: 'view-cards', type: 'leave', x: 1, y: 0, button: 'left' })
  await pointerOn(ui, { in: 'view-timeline', type: 'down', x: 1, y: 0, button: 'left' })
  expect(await ui.find({ type: 'Text', text: new RegExp(text.tipLane) })).toBeUndefined()
  await pointerOn(ui, { in: 'timeline', type: 'move', x: 5, y: 1, button: 'left' })
  expect(await ui.find({ type: 'Text', text: new RegExp(text.tipLane) })).toBeDefined()
  await pointerOn(ui, { in: 'timeline', type: 'leave', x: 5, y: 1, button: 'left' })
  expect(await ui.find({ type: 'Text', text: new RegExp(text.tipLane) })).toBeUndefined()
  await ui.unmount()
})

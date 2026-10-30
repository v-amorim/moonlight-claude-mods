// mod-model-effort / tests/model-effort.test.tsx, by v-amorim
// Tests the footer meter: effort saving, model switching, icon modes, settings pane and tips.
import { expect, mock, test, type TestBody } from 'claude-code/testing'
import { mix, THEME } from '../hooks/theme'

import { displayName, withEffort, withModel } from '../hooks/levels'
import Meter from '../hooks/meter'
import { bridgeStubs, feed, HOME } from './feed'

// The host's test types omit `pointer` and a drawn element's `children`.
const pointer = (ui: object, event: object) => (ui as { pointer: (event: object) => Promise<void> }).pointer(event)
const children = (element: object) => (element as { children: unknown[] }).children

const SETTINGS = { env: { KEEP: '1' }, modelSettings: { 'claude-opus-5-5': { effortLevel: 'medium', other: 1 } }, model: 'x' }

test('withEffort edits only the model effort and refuses broken JSON', () => {
  const out = JSON.parse(withEffort(JSON.stringify(SETTINGS, null, 2), 'claude-opus-5-5', 'max')!)
  expect(out.modelSettings['claude-opus-5-5']).toEqual({ effortLevel: 'max', other: 1 })
  expect(out.env).toEqual(SETTINGS.env)
  expect(out.model).toBe('x')

  const fresh = JSON.parse(withEffort('{\n  "model": "x"\n}', 'claude-sonnet-5-5', 'low')!)
  expect(fresh.modelSettings).toEqual({ 'claude-sonnet-5-5': { effortLevel: 'low' } })
  expect(withEffort('{ broken', 'm', 'low')).toBeNull()
})

test('the footer meter follows each request and a click saves that level', async ($, on) => {
  const files: Record<string, string> = { '/h/.claude/settings.json': JSON.stringify(SETTINGS, null, 2) + '\n' }
  const neutral = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
  on('env.get', (_$, e) => ({ value: e.name === 'USERPROFILE' ? '/h' : undefined }))
  on('fs.read', (_$, e) => ({ value: files[neutral(e.path)] ?? '' }))
  on('fs.write', (_$, e) => {
    files[neutral(e.path)] = e.text
    return { value: undefined }
  })
  on('store.set', () => ({ value: undefined }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  const clock = mock.clock(on)
  on('turn.step', async function* ($$, e) {
    yield { kind: 'text', index: 0, text: 'ok' }
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>auto mode</Text>
  })

  // A step streams: the hook runs only while the stream is read.
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1 } as never)
  while ((await stream.next()).done !== true);

  const ui = await $.ui.mount({ plugin: 'mod-model-effort', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} } } as never)
  expect(await ui.find({ type: 'Text', text: 'auto mode' })).toBeDefined()
  const drawn = JSON.stringify(await ui.drawn({ in: 'meter' }))
  expect(drawn).toContain('◐ ')
  expect(drawn).toContain(' Opus 5.5 ')
  expect(drawn).not.toContain('medium')
  // At rest only the current level shows.
  expect(children(await ui.drawn({ in: 'meter' })).filter(Boolean)).toHaveLength(2)

  // The pointer opens every level; hovering the fourth previews it: every glyph up to it lit, the hovered one bold, the fifth still dark.
  await pointer(ui, { in: 'meter', type: 'move', x: 1, y: 0 })
  await pointer(ui, { in: 'meter', type: 'move', x: 16, y: 0 })
  const glyphs = children(await ui.drawn({ in: 'meter' })).slice(1) as { props: { color: string; bold?: boolean } }[]
  expect(glyphs.slice(0, 4).every(glyph => glyph.props.color !== THEME.border)).toBe(true)
  expect(glyphs[4]!.props.color).toBe(THEME.border)
  expect(glyphs[3]!.props.bold).toBe(true)
  // The hovered level names itself beside the pill, as a click does.
  expect(await ui.find({ type: 'Text', text: 'xhigh' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Effort:', bold: true } as never)).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' sets effort to xhigh' })).toBeDefined()
  await pointer(ui, { in: 'meter', type: 'leave', x: 0, y: 0 })
  expect(await ui.find({ type: 'Text', text: 'Effort:' })).toBeUndefined()
  expect(children(await ui.drawn({ in: 'meter' })).filter(Boolean)).toHaveLength(2)

  // ' Opus 5.5 ' (10 cells) comes first; once open, the fifth glyph sits at x 18.
  await pointer(ui, { in: 'meter', type: 'move', x: 1, y: 0 })
  await pointer(ui, { in: 'meter', type: 'down', button: 'left', x: 18, y: 0 })
  expect(JSON.parse(files['/h/.claude/settings.json']!).modelSettings['claude-opus-5-5'].effortLevel).toBe('max')
  expect(files['/h/.claude/settings.json.mod-model-effort.bak']).toContain('"medium"')
  // The level word shows on a click, then leaves. The pointer leaves too, so the tip naming the level is gone.
  expect(await ui.find({ type: 'Text', text: 'max' })).toBeDefined()
  await pointer(ui, { in: 'meter', type: 'leave', x: 0, y: 0 })
  await clock.advance(2000)
  expect(await ui.find({ type: 'Text', text: 'max' })).toBeUndefined()
  await ui.unmount()
})

// Mounts the meter on a disk that throws for a missing file, then clicks the fifth level.
async function clickMax($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], files: Record<string, string>, env: Record<string, string>, check?: (ui: object) => Promise<void>) {
  const neutral = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
  on('env.get', (_$, e) => ({ value: env[e.name] }))
  on('fs.exists', (_$, e) => ({ value: neutral(e.path) in files }))
  on('fs.read', (_$, e) => {
    const path = neutral(e.path)
    if (!(path in files)) throw new Error(`ENOENT ${path}`)
    return { value: files[path]! }
  })
  on('fs.write', (_$, e) => {
    files[neutral(e.path)] = e.text
    return { value: undefined }
  })
  on('store.set', () => ({ value: undefined }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('turn.step', async function* ($$, e) {
    yield { kind: 'text', index: 0, text: 'ok' }
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>auto mode</Text>
  })
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1 } as never)
  while ((await stream.next()).done !== true);
  const ui = await $.ui.mount({ plugin: 'mod-model-effort', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} } } as never)
  await pointer(ui, { in: 'meter', type: 'move', x: 1, y: 0 })
  await pointer(ui, { in: 'meter', type: 'down', button: 'left', x: 18, y: 0 })
  await check?.(ui)
  await ui.unmount()
}

test('a click saves the level under CLAUDE_CONFIG_DIR when it is set, and leaves ~/.claude alone', async ($, on) => {
  const files: Record<string, string> = {
    '/cfg/settings.json': JSON.stringify(SETTINGS, null, 2) + '\n',
    '/h/.claude/settings.json': '{}\n',
  }
  await clickMax($, on, files, { USERPROFILE: '/h', CLAUDE_CONFIG_DIR: '/cfg' })
  expect(JSON.parse(files['/cfg/settings.json']!).modelSettings['claude-opus-5-5'].effortLevel).toBe('max')
  expect(files['/cfg/settings.json.mod-model-effort.bak']).toContain('"medium"')
  expect(files['/h/.claude/settings.json']).toBe('{}\n')
  expect(files['/h/.claude/settings.json.mod-model-effort.bak']).toBeUndefined()
})

test('a click on a machine with no settings.json creates it from {}', async ($, on) => {
  const files: Record<string, string> = {}
  await clickMax($, on, files, { USERPROFILE: '/h' })
  expect(JSON.parse(files['/h/.claude/settings.json']!)).toEqual({ modelSettings: { 'claude-opus-5-5': { effortLevel: 'max' } } })
  expect(files['/h/.claude/settings.json.mod-model-effort.bak']).toBeUndefined()
})

test('a second click keeps the first backup', async ($, on) => {
  const files: Record<string, string> = {
    '/h/.claude/settings.json': JSON.stringify(SETTINGS, null, 2) + '\n',
    '/h/.claude/settings.json.mod-model-effort.bak': 'FIRST',
  }
  await clickMax($, on, files, { USERPROFILE: '/h' })
  expect(JSON.parse(files['/h/.claude/settings.json']!).modelSettings['claude-opus-5-5'].effortLevel).toBe('max')
  expect(files['/h/.claude/settings.json.mod-model-effort.bak']).toBe('FIRST')
})

test('a settings.json that cannot be read toasts and writes nothing', async ($, on) => {
  const files: Record<string, string> = {}
  Object.defineProperty(files, '/h/.claude/settings.json', {
    enumerable: true,
    get: () => {
      throw new Error('EACCES')
    },
  })
  mock.clock(on)
  await clickMax($, on, files, { USERPROFILE: '/h' }, async ui => {
    expect(await (ui as { find: (q: object) => Promise<unknown> }).find({ type: 'Text', text: /is not valid JSON|not JSON|valid JSON/i })).toBeDefined()
  })
  expect(Object.keys(files)).toEqual(['/h/.claude/settings.json'])
})

test('the model menu opens when the session cannot name its model', async ($, on) => {
  on('env.get', () => ({ value: undefined }))
  on('settings.read', () => ({ value: {} }))
  on('store.get', (_$, e) => ({ value: e.key === 'models' ? ['claude-sonnet-5-5'] : undefined }))
  on('store.set', () => ({ value: undefined }))
  on('session.model', () => {
    throw new Error('no session')
  })
  mock.clock(on)
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })
  const ui = await $.ui.mount({ plugin: 'mod-model-effort', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 }, view: {} } } as never)
  await pointer(ui, { in: 'meter', type: 'down', button: 'left', x: 1, y: 0 })
  expect(await ui.find({ key: 'effort-model-all' })).toBeDefined()
  await ui.unmount()
})

test('a click on the model name lists the models used before, and a pick switches through /model', async ($, on) => {
  const ran: string[] = []
  const store: Record<string, unknown> = { models: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-newmodel-6-0'] }
  on('env.get', () => ({ value: undefined }))
  on('settings.read', () => ({ value: {} }))
  on('store.get', (_$, e) => ({ value: store[e.key] }))
  on('store.set', (_$, e) => {
    store[e.key] = e.value
    return { value: undefined }
  })
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('command.run', (_$, e) => {
    ran.push(`${e.command} ${e.args}`)
    return { text: '' }
  })
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })
  const ui = await $.ui.mount({ plugin: 'mod-model-effort', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 }, view: {} } } as never)
  expect(await ui.find({ key: 'effort-model-all' })).toBeUndefined()

  // The × closes the menu without switching.
  await pointer(ui, { in: 'meter', type: 'down', button: 'left', x: 2, y: 0 })
  await pointer(ui, { in: 'effort-model-close', type: 'down', button: 'left', x: 1, y: 0 })
  expect(await ui.find({ key: 'effort-model-all' })).toBeUndefined()
  expect(ran).toEqual([])

  // The current model leads, then the others in the order they were used; a model never seen before still shows.
  await pointer(ui, { in: 'meter', type: 'down', button: 'left', x: 2, y: 0 })
  // Each entry is a pill: the current one on surface3 with a green ✓ subpill, the others on surface2.
  const current = JSON.stringify(await ui.drawn({ in: 'effort-model-0' }))
  expect(current).toContain('" ✓ "')
  expect(current).toContain('#A2B0EA')
  expect(current).toContain('" Opus 5.5 "')
  expect(current).toContain('#252A42')
  const other = JSON.stringify(await ui.drawn({ in: 'effort-model-1' }))
  expect(other).toContain('" Sonnet 5.5 "')
  expect(other).toContain('#1C2033')
  expect(JSON.stringify(await ui.drawn({ in: 'effort-model-2' }))).toContain('Newmodel 6.0')
  const all = JSON.stringify(await ui.drawn({ in: 'effort-model-all' }))
  expect(all).toContain('" ↵ "')
  expect(all).toContain('" All models… "')
  expect(await ui.find({ key: 'effort-model-0-pill-body' })).toBeDefined()

  await pointer(ui, { in: 'effort-model-1', type: 'down', button: 'left', x: 1, y: 0 })
  expect(ran).toEqual(['model claude-sonnet-5-5'])
  expect(await ui.find({ key: 'effort-model-all' })).toBeUndefined()
  expect(JSON.stringify(await ui.drawn({ in: 'meter' }))).toContain(' Sonnet 5.5 ')
  expect(store.models).toEqual(['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-newmodel-6-0'])

  // All models opens Claude Code's own picker.
  await pointer(ui, { in: 'meter', type: 'down', button: 'left', x: 2, y: 0 })
  await pointer(ui, { in: 'effort-model-all', type: 'down', button: 'left', x: 1, y: 0 })
  expect(ran).toEqual(['model claude-sonnet-5-5', 'model '])
  await ui.unmount()
})

test('a model joins the menu only once a request with it is answered', async ($, on) => {
  const store: Record<string, unknown> = { models: ['claude-opus-5-5'] }
  on('settings.read', () => ({ value: {} }))
  on('store.get', (_$, e) => ({ value: store[e.key] }))
  on('store.set', (_$, e) => {
    store[e.key] = e.value
    return { value: undefined }
  })
  // sourcery skip: generators-should-yield
  on('turn.step', async function* ($$, e) {
    const usage = e.model === 'claude-nonexistent-9' ? null : { model: e.model }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: null, usage } as never
  })
  const step = async (model: string) => {
    const stream = $.turn.step({ turnId: 't1', index: 0, model, effort: 'medium', messageCount: 1 } as never)
    while ((await stream.next()).done !== true);
  }

  await step('claude-nonexistent-9')
  expect(store.models).toEqual(['claude-opus-5-5'])
  await step('claude-sonnet-5-5')
  expect(store.models).toEqual(['claude-sonnet-5-5', 'claude-opus-5-5'])
  // The 1M id is the same model: it moves the plain entry up instead of adding a second one.
  await step('claude-opus-5-5[1m]')
  expect(store.models).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5'])
})

test('withModel folds a [1m] id into its plain id, saved before or new', () => {
  expect(withModel(['claude-opus-5-5[1m]', 'claude-opus-5-5', 'claude-haiku-5-5'], 'claude-sonnet-5-5')).toEqual(['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'])
  expect(withModel(['claude-opus-5-5'], 'claude-opus-5-5[1M]')).toEqual(['claude-opus-5-5'])
  expect(displayName('claude-opus-5-5[1m]')).toBe('Opus 5.5')
})

test('displayName shortens a model id and drops its date', () => {
  expect(displayName('claude-opus-5-5')).toBe('Opus 5.5')
  expect(displayName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  expect(displayName('Opus 5.5')).toBe('Opus 5.5')
})

test('a clicked level rides on each request until Alt+P saves another', async ($, on) => {
  const files: Record<string, string> = { '/h/.claude/settings.json': JSON.stringify(SETTINGS, null, 2) + '\n' }
  const neutral = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
  const sent: string[] = []
  on('env.get', (_$, e) => ({ value: e.name === 'USERPROFILE' ? '/h' : undefined }))
  on('fs.read', (_$, e) => ({ value: files[neutral(e.path)] ?? '' }))
  on('fs.write', (_$, e) => {
    files[neutral(e.path)] = e.text
    return { value: undefined }
  })
  on('settings.read', () => ({ value: JSON.parse(files['/h/.claude/settings.json']!) }))
  on('store.set', () => ({ value: undefined }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  mock.clock(on)
  on('turn.step', async function* ($$, e) {
    sent.push(String(e.effort))
    yield { kind: 'text', index: 0, text: 'ok' }
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })
  const step = async (index: number) => {
    const stream = $.turn.step({ turnId: 't1', index, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1 } as never)
    while ((await stream.next()).done !== true);
  }

  await step(0)
  const ui = await $.ui.mount({ plugin: 'mod-model-effort', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} } } as never)
  await pointer(ui, { in: 'meter', type: 'move', x: 1, y: 0 })
  await pointer(ui, { in: 'meter', type: 'down', button: 'left', x: 18, y: 0 })
  await step(1)

  // Alt+P saves high; Claude Code's own level takes over again.
  const saved = JSON.parse(files['/h/.claude/settings.json']!)
  saved.modelSettings['claude-opus-5-5'].effortLevel = 'high'
  files['/h/.claude/settings.json'] = JSON.stringify(saved)
  await step(2)
  expect(sent).toEqual(['medium', 'max', 'medium'])
  await ui.unmount()
})

const BAND = { plugin: 'mod-model-effort', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} } } as never
const CAP = String.fromCodePoint(0xe0b6)

function band(on: (name: string, handler: (...args: any[]) => unknown) => void, model: () => string = () => 'claude-opus-5-5') {
  on('env.get', () => ({ value: undefined }))
  on('session.model', () => ({ value: model() }))
  on('ui.render', ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })
}

test('icons=nerd draws the pill with rounded caps', { options: { icons: 'nerd' } }, async ($, on) => {
  band(on as never)
  on('store.get', () => ({ value: undefined }))
  const ui = await $.ui.mount(BAND)
  expect(JSON.stringify(await ui.drawn({ in: 'meter' }))).toContain(CAP)
  await pointer(ui, { in: 'meter', type: 'down', button: 'left', x: 2, y: 0 })
  const current = JSON.stringify(await ui.drawn({ in: 'effort-model-0' }))
  expect(current).toContain(`"${String.fromCodePoint(0xeab2)}"`)
  expect(current).toContain(CAP)
  expect(JSON.stringify(await ui.drawn({ in: 'effort-model-all' }))).toContain(`"${String.fromCodePoint(0xf054)}"`)
  await ui.unmount()
})

test('icons=safe draws the pill without rounded caps', { options: { icons: 'safe' } }, async ($, on) => {
  band(on as never)
  const ui = await $.ui.mount(BAND)
  expect(JSON.stringify(await ui.drawn({ in: 'meter' }))).not.toContain(CAP)
  await ui.unmount()
})

test('/mod-model-effort settings opens the pane and the pane draws a setting row', { options: { icons: 'safe' } }, async ($, on) => {
  const opened: string[] = []
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('state.set', () => ({ value: undefined }) as never)
  on('config.list', () => ({ value: [{ key: 'mod-model-effort.animations', label: 'Animations', value: true, kind: 'boolean', description: 'Entries shimmer' }] as never }))
  await $.command.run({ command: 'mod-model-effort', args: 'settings' } as never)
  expect(opened).toEqual(['model-effort-settings'])

  const pane = await $.ui.mount({ plugin: 'mod-model-effort', surface: 'terminal', component: 'Pane', requestId: 'model-effort-settings', props: { scroll: { offset: 0, bodyRows: 20 }, bodyColumns: 80 } } as never)
  // The lone view is the mod name segment; the gear chip is pinned right and active.
  expect(JSON.stringify(await pane.drawn({ in: 'mod-model-effort-settings-tab-name' }))).toContain('Effort')
  expect(JSON.stringify(await pane.drawn({ in: 'mod-model-effort-settings-tab' }))).toContain(THEME.ok)
  expect(await pane.find({ key: 'settings-status' })).toBeUndefined()
  expect(JSON.stringify(await pane.find({ key: 'pane-footer' }))).toContain('Click a setting to change it')
  expect(JSON.stringify(await pane.drawn())).toContain('mod-model-effort')
  expect(JSON.stringify(await pane.find({ key: 'setting-name-0' }))).toContain('Animations')
  await pane.unmount()
})

const NARROW = { plugin: 'mod-model-effort', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 80, scroll: { offset: 0, bodyRows: 12 }, view: {} } } as never

test('a hovered control names itself in the tip row, a model menu entry and the model pill alike', { options: { icons: 'safe' } }, async ($, on) => {
  band(on as never)
  on('store.get', () => ({ value: undefined }))
  const ui = await $.ui.mount(NARROW)
  await pointer(ui, { in: 'meter', type: 'move', x: 0, y: 0 })
  expect(await ui.find({ type: 'Text', text: ' switches the model' })).toBeDefined()
  await pointer(ui, { in: 'meter', type: 'down', button: 'left', x: 0, y: 0 })
  await pointer(ui, { in: 'effort-model-all', type: 'move', x: 1, y: 0 })
  expect(await ui.find({ type: 'Text', text: ' opens the full model picker' })).toBeDefined()
  await pointer(ui, { in: 'effort-model-all', type: 'leave', x: 0, y: 0 })
  expect(await ui.find({ type: 'Text', text: ' opens the full model picker' })).toBeUndefined()
  await ui.unmount()
})

test('a band tip whose entry was redrawn while hovered clears after 5 s with no newer hover', { options: { icons: 'safe' } }, async ($, on) => {
  const clock = mock.clock(on)
  band(on as never)
  on('store.get', () => ({ value: undefined }))
  // Live, a band redraw mid-turn replaced the hovered entry, so its own quiet timer, and the leave, never came.
  const first = await $.ui.mount(NARROW)
  await pointer(first, { in: 'meter', type: 'move', x: 0, y: 0 })
  await first.unmount()
  const showsNow = async () => {
    const ui = await $.ui.mount(NARROW)
    const shown = (await ui.find({ type: 'Text', text: ' switches the model' })) !== undefined
    await ui.unmount()
    return shown
  }
  expect(await showsNow()).toBe(true)
  await clock.advance(4000)
  expect(await showsNow()).toBe(true)
  await clock.advance(1000)
  expect(await showsNow()).toBe(false)
})

test('the settings pane footer shows the tip of the hovered tab',{ options: { icons: 'safe' } }, async ($, on) => {
  on('config.list', () => ({ value: [] }))
  const pane = await $.ui.mount({ plugin: 'mod-model-effort', surface: 'terminal', component: 'Pane', requestId: 'model-effort-settings', props: { scroll: { offset: 0, bodyRows: 20 }, bodyColumns: 80 } } as never)
  await pointer(pane, { in: 'mod-model-effort-settings-tab', type: 'move', x: 1, y: 0 })
  expect(await pane.find({ type: 'Text', text: " · shows this mod's settings" })).toBeDefined()
  await pointer(pane, { in: 'mod-model-effort-settings-tab', type: 'leave', x: 0, y: 0 })
  expect(await pane.find({ type: 'Text', text: " · shows this mod's settings" })).toBeUndefined()
  await pane.unmount()
})

// What Claude Code passes its PostModelSwitch hook when /model or the picker moves to `to`, as the command hook appends it.
const switched = (to: string) => ({ from_model: 'claude-opus-5-5', to_model: to, requested_model: to, source: 'command' })

// One request on a model and level, which leaves the pill on them. It registers its own turn.step, so the other stubs go first.
async function firstRequest($: any, on: any, model: string, effort: string) {
  on('turn.step', async function* ($$: any, e: any) {
    yield { kind: 'text', index: 0, text: 'ok' }
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  const stream = $.turn.step({ turnId: 't1', index: 0, model, effort, messageCount: 1 } as never)
  while ((await stream.next()).done !== true);
}

test('a model switch through /model or the picker shows on the pill at once, at the level saved for that model', { options: { icons: 'safe' } }, async ($, on) => {
  const store: Record<string, unknown> = {}
  const clock = mock.clock(on)
  const bridge = bridgeStubs(on)
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('ui.render', ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })
  on('settings.read', () => ({ value: { modelSettings: { 'claude-opus-5-5': { effortLevel: 'medium' }, 'claude-sonnet-5-5': { effortLevel: 'low' } } } }))
  on('store.get', (_$, e) => ({ value: store[e.key] }))
  on('store.set', (_$, e) => {
    store[e.key] = e.value
    return { value: undefined }
  })
  await firstRequest($, on, 'claude-opus-5-5', 'medium')
  await $.session.start({ cwd: '/w' } as never)
  const ui = await $.ui.mount(BAND)
  expect(JSON.stringify(await ui.drawn({ in: 'meter' }))).toContain(' Opus 5.5 ')

  await feed(clock, bridge, 'PostModelSwitch', switched('claude-sonnet-5-5'))
  await ui.redraw()
  const drawn = JSON.stringify(await ui.drawn({ in: 'meter' }))
  expect(drawn).toContain(' Sonnet 5.5 ')
  expect(drawn).toContain('○ ')
  expect(drawn).not.toContain('◐ ')
  expect(store.model).toBe('claude-sonnet-5-5')
  await ui.unmount()
})

test("without PostModelSwitch, a redraw follows the session's model at the level saved for it, and ignores a name it cannot display", { options: { icons: 'safe' } }, async ($, on) => {
  const store: Record<string, unknown> = {}
  let live = 'claude-opus-5-5'
  const clock = mock.clock(on)
  band(on as never, () => live)
  on('settings.read', () => ({ value: { modelSettings: { 'claude-opus-5-5': { effortLevel: 'medium' }, 'claude-sonnet-5-5': { effortLevel: 'low' } } } }))
  on('store.get', (_$, e) => ({ value: store[e.key] }))
  on('store.set', (_$, e) => {
    store[e.key] = e.value
    return { value: undefined }
  })
  await firstRequest($, on, 'claude-opus-5-5', 'medium')
  const ui = await $.ui.mount(BAND)
  expect(JSON.stringify(await ui.drawn({ in: 'meter' }))).toContain(' Opus 5.5 ')

  live = 'sonnet'
  await ui.redraw()
  expect(JSON.stringify(await ui.drawn({ in: 'meter' }))).toContain(' Opus 5.5 ')

  live = 'claude-sonnet-5-5'
  await ui.redraw()
  const drawn = JSON.stringify(await ui.drawn({ in: 'meter' }))
  expect(drawn).toContain(' Sonnet 5.5 ')
  expect(drawn).toContain('○ ')

  await clock.advance(1)
  expect(store.model).toBe('claude-sonnet-5-5')
  await ui.unmount()
})

test('without ConfigChange, a redraw picks up a level changed in the settings, and leaves a level a request downgraded alone', { options: { icons: 'safe' } }, async ($, on) => {
  const settings = { modelSettings: { 'claude-opus-5-5': { effortLevel: 'medium' } } }
  const clock = mock.clock(on)
  band(on as never)
  on('settings.read', () => ({ value: settings }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  await firstRequest($, on, 'claude-opus-5-5', 'low')
  const ui = await $.ui.mount(BAND)
  await clock.advance(250)
  expect(JSON.stringify(await ui.drawn({ in: 'meter' }))).toContain('○ ')

  await ui.redraw()
  await clock.advance(250)
  expect(JSON.stringify(await ui.drawn({ in: 'meter' }))).toContain('○ ')

  settings.modelSettings['claude-opus-5-5'].effortLevel = 'high'
  await ui.redraw()
  await clock.advance(250)
  await ui.redraw()
  expect(JSON.stringify(await ui.drawn({ in: 'meter' }))).toContain('● ')
  await ui.unmount()
})

test('an effort saved by Alt+P or /effort shows on the pill at once; a project settings change does not', { options: { icons: 'safe' } }, async ($, on) => {
  const settings = { modelSettings: { 'claude-opus-5-5': { effortLevel: 'medium' } } }
  const clock = mock.clock(on)
  const bridge = bridgeStubs(on)
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('ui.render', ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })
  on('settings.read', () => ({ value: settings }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  let shown: string | undefined
  on('state.set', (_$: any, e: any, next: any) => {
    if (e.key === 'current') shown = e.value.effort
    return next(e)
  })
  const level = async () => shown
  await firstRequest($, on, 'claude-opus-5-5', 'medium')
  await $.session.start({ cwd: '/w' } as never)
  // Nothing draws until the end, so a render's own check of the saved level cannot stand in for the record.

  settings.modelSettings['claude-opus-5-5'].effortLevel = 'high'
  await feed(clock, bridge, 'ConfigChange', { source: 'user_settings', file_path: '/h/.claude/settings.json' })
  expect(await level()).toBe('high')

  settings.modelSettings['claude-opus-5-5'].effortLevel = 'low'
  await feed(clock, bridge, 'ConfigChange', { source: 'project_settings', file_path: '/w/.claude/settings.json' })
  expect(await level()).toBe('high')
})

test('a clicked level holds on the pill while the saved level is the one before it, and yields to any other', { options: { icons: 'safe' } }, async ($, on) => {
  const settingsPath = `${HOME}/.claude/settings.json`
  const files: Record<string, string> = { [settingsPath]: JSON.stringify({ modelSettings: { 'claude-opus-5-5': { effortLevel: 'medium' } } }) }
  const saveLevel = (effort: string) => {
    files[settingsPath] = JSON.stringify({ modelSettings: { 'claude-opus-5-5': { effortLevel: effort } } })
  }
  const clock = mock.clock(on)
  const bridge = bridgeStubs(on, files)
  on('settings.read', () => ({ value: JSON.parse(files[settingsPath]!) }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })
  await firstRequest($, on, 'claude-opus-5-5', 'medium')
  await $.session.start({ cwd: '/w' } as never)
  const ui = await $.ui.mount(BAND)
  await pointer(ui, { in: 'meter', type: 'move', x: 1, y: 0 })
  await pointer(ui, { in: 'meter', type: 'down', button: 'left', x: 18, y: 0 })
  await pointer(ui, { in: 'meter', type: 'leave', x: 0, y: 0 })
  expect(JSON.stringify(await ui.drawn({ in: 'meter' }))).toContain('◈ ')

  // Alt+P saves medium, the level before the click: the clicked max still rides on the requests.
  saveLevel('medium')
  await feed(clock, bridge, 'ConfigChange', { source: 'user_settings' })
  await ui.redraw()
  expect(JSON.stringify(await ui.drawn({ in: 'meter' }))).toContain('◈ ')

  // Alt+P saves high, another level: the pill shows it and the clicked level is dropped.
  saveLevel('high')
  await feed(clock, bridge, 'ConfigChange', { source: 'user_settings' })
  await ui.redraw()
  const drawn = JSON.stringify(await ui.drawn({ in: 'meter' }))
  expect(drawn).toContain('● ')
  expect(drawn).not.toContain('◈ ')
  await ui.unmount()
})

test('a settings read that fails leaves the model switch whole', { options: { icons: 'safe' } }, async ($, on) => {
  const clock = mock.clock(on)
  const bridge = bridgeStubs(on)
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('ui.render', ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })
  on('settings.read', () => {
    throw new Error('unreadable')
  })
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  await firstRequest($, on, 'claude-opus-5-5', 'medium')
  await $.session.start({ cwd: '/w' } as never)
  const ui = await $.ui.mount(BAND)
  await feed(clock, bridge, 'PostModelSwitch', switched('claude-sonnet-5-5'))
  await ui.redraw()
  expect(JSON.stringify(await ui.drawn({ in: 'meter' }))).toContain(' Opus 5.5 ')
  await ui.unmount()
})

test('before the first request the pill shows this session\'s model, not the last session\'s', async ($, on) => {
  const files: Record<string, string> = { '/h/.claude/settings.json': JSON.stringify(SETTINGS, null, 2) + '\n' }
  const neutral = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
  const shown: unknown[] = []
  on('env.get', (_$, e) => ({ value: e.name === 'USERPROFILE' ? '/h' : undefined }))
  on('fs.read', (_$, e) => ({ value: files[neutral(e.path)] ?? '' }))
  on('store.get', (_$, e) => ({ value: e.key === 'model' ? 'claude-opus-5-5' : undefined }))
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('settings.read', () => ({ value: { modelSettings: { 'claude-opus-5-5': { effortLevel: 'medium' }, 'claude-sonnet-5-5': { effortLevel: 'low' } } } }))
  on('session.start', () => ({ cwd: '/w' }))
  on('command.register', () => ({ value: { command: 'mod-model-effort' } }))
  on('ui.panes', () => ({ value: [] }))
  on('state.set', (_$, e) => {
    if (e.key === 'current') shown.push(e.value)
    return { value: undefined } as never
  })
  mock.clock(on)
  await $.session.start({ cwd: '/w' } as never)
  expect((shown[0] as { model?: string } | undefined)?.model).toBe('claude-sonnet-5-5')
})

test('the meter at rest runs no timer; a new effort fades its lights, then it stops', () => {
  const running = new Set<() => void>()
  const surface: any = {
    elements: { Box: (props: any) => props, Text: (props: any) => props },
    state: undefined,
    setState: (state: any) => (surface.state = state),
    every: (_ms: number, fn: () => void) => {
      running.add(fn)
      return () => running.delete(fn)
    },
    onPointer: () => {},
    post: () => {},
  }
  const tip = { glyph: '', label: '', text: '' }
  const props = (effort: string) => ({ effort, model: 'Opus', bg: THEME.surface2, tipModel: tip, tipRest: tip, tipLevels: [tip, tip, tip, tip, tip] })
  Meter(props('medium'), surface)
  expect(running.size).toBe(0)
  Meter(props('high'), surface)
  expect(running.size).toBe(1)
  for (let n = 0; n < 6; n++) [...running].forEach(fn => fn())
  expect(running.size).toBe(0)
})

const WORKING = { plugin: 'mod-model-effort', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 }, view: {} } } as never

test('with the menu hidden the pill steps aside and a toast still draws its card', { options: { icons: 'safe' } }, async ($, on) => {
  band(on as never)
  on('store.get', () => ({ value: undefined }))
  let hidden = false
  on('state.get', (_$: unknown, e: { plugin: string }) => ({ value: { value: e.plugin === 'mod-menu' ? hidden : undefined } }) as never)
  const ui = await $.ui.mount(BAND)
  // A level click before any request has no model to save for, which toasts.
  await pointer(ui, { in: 'meter', type: 'move', x: 1, y: 0 })
  await pointer(ui, { in: 'meter', type: 'down', button: 'left', x: 18, y: 0 })
  expect(await ui.find({ key: 'meter' })).toBeDefined()
  hidden = true
  await ui.redraw()
  expect(await ui.find({ key: 'meter' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /send a message first/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'base' })).toBeDefined()
  await ui.unmount()
})

test('a failed model switch draws as an alert card, its mark first', { options: { icons: 'safe' } }, async ($, on) => {
  band(on as never)
  on('store.get', () => ({ value: undefined }))
  on('command.run', () => {
    throw new Error('no')
  })
  const ui = await $.ui.mount(BAND)
  await pointer(ui, { in: 'meter', type: 'down', button: 'left', x: 2, y: 0 })
  await pointer(ui, { in: 'effort-model-all', type: 'down', button: 'left', x: 1, y: 0 })
  await ui.redraw()
  const card = JSON.stringify(await ui.drawn())
  expect(card).toContain('"children":["mod-model-effort"]')
  expect(card).toContain('could not open /model')
  expect(card).toContain(`"color":"${THEME.alert}"`)
  expect(card.indexOf('" ! "')).toBeGreaterThan(-1)
  expect(card.indexOf('" ! "')).toBeLessThan(card.indexOf('"mod-model-effort"'))
  expect(card).not.toContain('"! mod-model-effort')
  await ui.unmount()
})

test('while Claude works a model pick and All models switch nothing and say why', { options: { icons: 'safe' } }, async ($, on) => {
  const ran: string[] = []
  band(on as never)
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: e.key === 'models' ? ['claude-opus-5-5', 'claude-sonnet-5-5'] : undefined }))
  on('store.set', () => ({ value: undefined }))
  on('command.run', (_$: unknown, e: { command: string; args: string }) => {
    ran.push(`${e.command} ${e.args}`)
    return { text: '' }
  })
  const ui = await $.ui.mount(WORKING)
  await pointer(ui, { in: 'meter', type: 'down', button: 'left', x: 2, y: 0 })
  // Busy entries draw muted, never in the open entry's onSurface.
  expect(JSON.stringify(await ui.drawn({ in: 'effort-model-1' }))).not.toContain(THEME.onSurface)
  await pointer(ui, { in: 'effort-model-1', type: 'down', button: 'left', x: 1, y: 0 })
  expect(await ui.find({ type: 'Text', text: 'Claude is working, Sonnet 5.5 is available once it is idle' })).toBeDefined()
  await pointer(ui, { in: 'effort-model-all', type: 'down', button: 'left', x: 1, y: 0 })
  expect(await ui.find({ type: 'Text', text: 'Claude is working, All models… is available once it is idle' })).toBeDefined()
  expect(ran).toEqual([])
  await ui.unmount()
})

test('the model menu card has no left strip, a neutral border and an accent-tinted fill; the settings pane paints bg and keeps its footer space', { options: { icons: 'safe' } }, async ($, on) => {
  band(on as never)
  on('store.get', () => ({ value: undefined }))
  on('config.list', () => ({ value: [] }))
  const ui = await $.ui.mount(BAND)
  await pointer(ui, { in: 'meter', type: 'down', button: 'left', x: 2, y: 0 })
  expect(await ui.find({ key: 'effort-models-strip' })).toBeUndefined()
  const card = await ui.find({ key: 'effort-models' })
  expect(card?.props.borderColor).toBe(THEME.border)
  expect(card?.props.backgroundColor).toBe(mix(THEME.surface1, THEME.accent, 0.06))
  expect(await ui.find({ key: 'effort-models-edge' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Model' })).toBeDefined()
  await ui.unmount()
  const pane = await $.ui.mount({ plugin: 'mod-model-effort', surface: 'terminal', component: 'Pane', requestId: 'model-effort-settings', props: { scroll: { offset: 0, bodyRows: 20 }, bodyColumns: 80 } } as never)
  expect((await pane.find({ key: 'footer-space' }))?.props.flexShrink).toBe(0)
  expect(JSON.stringify(await pane.drawn())).toContain(`"backgroundColor":"${THEME.bg}"`)
  await pane.unmount()
})

const TIGHT = { ...(BAND as any), props: { ...(BAND as any).props, bodyColumns: 8 } } as never

test('icons=nerd cuts the meter to its level when the row is wider than the band; hovering it does not open it inline', { options: { icons: 'nerd' } }, async ($, on) => {
  band(on as never)
  on('store.get', () => ({ value: undefined }))
  on('config.list', () => ({ value: [] }))
  const wide = await $.ui.mount(BAND)
  expect(JSON.stringify(await wide.drawn({ in: 'meter' }))).toContain(' Opus 5.5 ')
  await wide.unmount()
  const ui = await $.ui.mount(TIGHT)
  expect(JSON.stringify(await ui.drawn({ in: 'meter' }))).not.toContain('Opus')
  await pointer(ui, { in: 'meter', type: 'move', x: 1, y: 0 })
  await pointer(ui, { in: 'meter', type: 'move', x: 3, y: 0 })
  // Hover posts its tip but never widens the pill: head and the one level only.
  expect(children(await ui.drawn({ in: 'meter' })).filter(Boolean)).toHaveLength(4)
  expect(await ui.find({ type: 'Text', text: ' shows the effort levels' })).toBeDefined()
  expect(await ui.find({ key: 'effort-card' })).toBeUndefined()
  await ui.unmount()
})

test('a click on the compact meter opens the effort card with every level and a ×; × closes it', { options: { icons: 'nerd' } }, async ($, on) => {
  band(on as never)
  on('store.get', () => ({ value: undefined }))
  const ui = await $.ui.mount(TIGHT)
  await pointer(ui, { in: 'meter', type: 'down', button: 'left', x: 1, y: 0 })
  expect(await ui.find({ key: 'effort-card' })).toBeDefined()
  expect(await ui.find({ key: 'effort-card-edge' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Effort' })).toBeDefined()
  const meter = JSON.stringify(await ui.drawn({ in: 'effort-card-meter' }))
  for (const glyph of ['○ ', '◐ ', '● ', '◉ ', '◈ ']) expect(meter).toContain(glyph)
  expect(meter).toContain(' Opus 5.5 ')
  expect(await ui.find({ key: 'effort-card-close' })).toBeDefined()
  expect(await ui.find({ key: 'effort-models' })).toBeUndefined()
  // The card meter's hover names its level in the tip row.
  await pointer(ui, { in: 'effort-card-meter', type: 'move', x: 1, y: 0 })
  await pointer(ui, { in: 'effort-card-meter', type: 'move', x: 13, y: 0 })
  expect(await ui.find({ type: 'Text', text: ' sets effort to medium' })).toBeDefined()
  await pointer(ui, { in: 'effort-card-close', type: 'down', button: 'left', x: 1, y: 0 })
  expect(await ui.find({ key: 'effort-card' })).toBeUndefined()
  await ui.unmount()
})

test('a level in the effort card sets it and closes the card; the model name opens the model menu in its place', { options: { icons: 'nerd' } }, async ($, on) => {
  const files: Record<string, string> = { '/h/.claude/settings.json': JSON.stringify(SETTINGS, null, 2) + '\n' }
  const neutral = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>base</Text>
  })
  on('env.get', (_$, e) => ({ value: e.name === 'USERPROFILE' ? '/h' : undefined }))
  on('fs.exists', (_$, e) => ({ value: neutral(e.path) in files }))
  on('fs.read', (_$, e) => ({ value: files[neutral(e.path)] ?? '' }))
  on('fs.write', (_$, e) => {
    files[neutral(e.path)] = e.text
    return { value: undefined }
  })
  on('settings.read', () => ({ value: JSON.parse(files['/h/.claude/settings.json']!) }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  mock.clock(on)
  await firstRequest($, on, 'claude-opus-5-5', 'medium')
  const ui = await $.ui.mount(TIGHT)
  await pointer(ui, { in: 'meter', type: 'down', button: 'left', x: 1, y: 0 })
  // Nerd: cap 1 + ' Opus 5.5 ' 10 cells, so the fifth level sits at x 20.
  await pointer(ui, { in: 'effort-card-meter', type: 'move', x: 20, y: 0 })
  await pointer(ui, { in: 'effort-card-meter', type: 'down', button: 'left', x: 20, y: 0 })
  expect(JSON.parse(files['/h/.claude/settings.json']!).modelSettings['claude-opus-5-5'].effortLevel).toBe('max')
  expect(await ui.find({ key: 'effort-card' })).toBeUndefined()

  await pointer(ui, { in: 'meter', type: 'down', button: 'left', x: 1, y: 0 })
  expect(await ui.find({ key: 'effort-card' })).toBeDefined()
  await pointer(ui, { in: 'effort-card-meter', type: 'down', button: 'left', x: 3, y: 0 })
  expect(await ui.find({ key: 'effort-card' })).toBeUndefined()
  expect(await ui.find({ key: 'effort-models' })).toBeDefined()
  await ui.unmount()
})

test('the model menu draws on one line: every model, All models…, then ×', { options: { icons: 'safe' } }, async ($, on) => {
  band(on as never)
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: e.key === 'models' ? ['claude-opus-5-5', 'claude-sonnet-5-5'] : undefined }))
  on('store.set', () => ({ value: undefined }))
  const ui = await $.ui.mount(BAND)
  await pointer(ui, { in: 'meter', type: 'down', button: 'left', x: 2, y: 0 })
  const card = await ui.find({ key: 'effort-models' })
  expect(card?.props.flexDirection).toBe('row')
  const keys = children(card as object).filter(Boolean).map(child => (child as { props: { key?: string } }).props.key)
  expect(keys).toEqual(['effort-model-0-pill', 'effort-model-1-pill', 'effort-model-all-pill', 'effort-model-close-pill'])
  expect(await ui.find({ key: 'effort-models-head' })).toBeUndefined()
  await ui.unmount()
})

test('a model menu wider than the band stacks, with the × beside the first model', { options: { icons: 'safe' } }, async ($, on) => {
  band(on as never)
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: e.key === 'models' ? ['claude-opus-5-5', 'claude-sonnet-5-5'] : undefined }))
  on('store.set', () => ({ value: undefined }))
  const ui = await $.ui.mount({ ...(BAND as any), props: { ...(BAND as any).props, bodyColumns: 30 } } as never)
  await pointer(ui, { in: 'meter', type: 'down', button: 'left', x: 2, y: 0 })
  expect((await ui.find({ key: 'effort-models' }))?.props.flexDirection).toBe('column')
  const head = children((await ui.find({ key: 'effort-models-head' })) as object).filter(Boolean).map(child => (child as { props: { key?: string } }).props.key)
  expect(head).toEqual(['effort-model-0-pill', 'effort-model-close-pill'])
  await ui.unmount()
})

test('safe mode keeps the model name however narrow', { options: { icons: 'safe' } }, async ($, on) => {
  band(on as never)
  on('store.get', () => ({ value: undefined }))
  const ui = await $.ui.mount(TIGHT)
  expect(JSON.stringify(await ui.drawn({ in: 'meter' }))).toContain(' Opus 5.5 ')
  await ui.unmount()
})

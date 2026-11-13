// mod-model-effort / tests/follow.test.tsx, by v-amorim: how the pill follows a model switch and a saved level change, fed by bridge records.
import { expect, mock, test } from 'claude-code/testing'

import { bridgeStubs, feed, HOME } from './feed'

const BAND = { plugin: 'mod-model-effort', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} } } as never

const OPUS_SWITCH = { from_model: 'claude-opus-5-5', to_model: 'claude-sonnet-5-5', requested_model: 'claude-sonnet-5-5', source: 'command' }

async function setup($: any, on: any, saved: Record<string, string>, live = 'claude-opus-5-5') {
  const store = new Map<string, unknown>()
  const settings = { modelSettings: Object.fromEntries(Object.entries(saved).map(([model, effortLevel]) => [model, { effortLevel }])) }
  const clock = mock.clock(on)
  const bridge = bridgeStubs(on, { [`${HOME}/.claude/settings.json`]: JSON.stringify(settings) })
  on('session.model', () => ({ value: live }))
  on('ui.render', ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })
  on('settings.read', () => ({ value: settings }))
  on('store.get', (_$: any, e: any) => ({ value: store.get(e.key) }))
  on('store.set', (_$: any, e: any) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('store.delete', (_$: any, e: any) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('turn.step', async function* ($$: any, e: any) {
    yield { kind: 'text', index: 0, text: 'ok' }
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: { model: e.model } }
  })
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1 } as never)
  while ((await stream.next()).done !== true);
  return { store, settings, clock, bridge }
}

test('a switch to a model with no saved level keeps the level on the pill, and the menu waits for an answer from it', { options: { icons: 'safe' } }, async ($, on) => {
  const { store, clock, bridge } = await setup($, on, { 'claude-opus-5-5': 'medium' })
  await $.session.start({ cwd: '/w' } as never)
  const ui = await $.ui.mount(BAND)
  await feed(clock, bridge, 'PostModelSwitch', OPUS_SWITCH)
  await ui.redraw()
  const drawn = JSON.stringify(await ui.drawn({ in: 'meter' }))
  expect(drawn).toContain(' Sonnet 5.5 ')
  expect(drawn).toContain('◐ ')
  expect(store.get('model')).toBe('claude-sonnet-5-5')
  expect(store.get('models')).toEqual(['claude-opus-5-5'])
  await ui.unmount()
})

test('a switch leaves the clicked level behind: the new model shows its own saved level', { options: { icons: 'safe' } }, async ($, on) => {
  const { clock, bridge } = await setup($, on, { 'claude-opus-5-5': 'medium', 'claude-sonnet-5-5': 'high' })
  await $.session.start({ cwd: '/w' } as never)
  const ui = await $.ui.mount(BAND)
  const pointer = (event: object) => (ui as unknown as { pointer: (event: object) => Promise<void> }).pointer(event)
  await pointer({ in: 'meter', type: 'move', x: 1, y: 0 })
  await pointer({ in: 'meter', type: 'down', button: 'left', x: 18, y: 0 })
  await pointer({ in: 'meter', type: 'leave', x: 0, y: 0 })
  expect(JSON.stringify(await ui.drawn({ in: 'meter' }))).toContain('◈ ')
  await feed(clock, bridge, 'PostModelSwitch', OPUS_SWITCH)
  await ui.redraw()
  const drawn = JSON.stringify(await ui.drawn({ in: 'meter' }))
  expect(drawn).toContain(' Sonnet 5.5 ')
  expect(drawn).toContain('● ')
  expect(drawn).not.toContain('◈ ')
  await ui.unmount()
})

test('a ConfigChange of another source leaves the pill alone, and a user_settings one shows the new level', { options: { icons: 'safe' } }, async ($, on) => {
  const { settings, clock, bridge } = await setup($, on, { 'claude-opus-5-5': 'medium' })
  await $.session.start({ cwd: '/w' } as never)
  const ui = await $.ui.mount(BAND)
  settings.modelSettings['claude-opus-5-5']!.effortLevel = 'high'
  await feed(clock, bridge, 'ConfigChange', { source: 'local_settings' })
  await ui.redraw()
  expect(JSON.stringify(await ui.drawn({ in: 'meter' }))).toContain('◐ ')
  await feed(clock, bridge, 'ConfigChange', { source: 'user_settings' })
  await ui.redraw()
  expect(JSON.stringify(await ui.drawn({ in: 'meter' }))).toContain('● ')
  await ui.unmount()
})

test('a PostModelSwitch replayed after a reload does not move the pill back, and a new switch after it does', { options: { icons: 'safe' } }, async ($, on) => {
  const { store, clock, bridge } = await setup($, on, { 'claude-opus-5-5': 'medium', 'claude-sonnet-5-5': 'low', 'claude-haiku-4-5': 'low' })
  const old = { session_id: 'sid-1', hook_event_name: 'PostModelSwitch', ...OPUS_SWITCH }
  store.set('bridge-last:sid-1:PostModelSwitch', { raw: JSON.stringify(old), at: 0 })
  bridge.text = `${JSON.stringify(old)}\n`
  await $.session.start({ cwd: '/w' } as never)
  const ui = await $.ui.mount(BAND)
  await ui.redraw()
  expect(JSON.stringify(await ui.drawn({ in: 'meter' }))).toContain(' Opus 5.5 ')
  await feed(clock, bridge, 'PostModelSwitch', { ...OPUS_SWITCH, to_model: 'claude-haiku-4-5' })
  await ui.redraw()
  expect(JSON.stringify(await ui.drawn({ in: 'meter' }))).toContain(' Haiku 4.5 ')
  await ui.unmount()
})

test('a PostModelSwitch this module never saw is handled once when the file already holds it', { options: { icons: 'safe' } }, async ($, on) => {
  const { store, clock, bridge } = await setup($, on, { 'claude-opus-5-5': 'medium', 'claude-sonnet-5-5': 'low' }, 'claude-sonnet-5-5')
  const record = { session_id: 'sid-1', hook_event_name: 'PostModelSwitch', ...OPUS_SWITCH }
  bridge.text = `${JSON.stringify(record)}\n`
  await $.session.start({ cwd: '/w' } as never)
  await clock.advance(250)
  const ui = await $.ui.mount(BAND)
  expect(JSON.stringify(await ui.drawn({ in: 'meter' }))).toContain(' Sonnet 5.5 ')
  expect((store.get('bridge-last:sid-1:PostModelSwitch') as { raw: string }).raw).toBe(JSON.stringify(record))
  expect(store.get('model')).toBe('claude-sonnet-5-5')
  await ui.unmount()
})

test('a record without a model, or one the settings cannot answer, leaves the pill whole', { options: { icons: 'safe' } }, async ($, on) => {
  const { clock, bridge } = await setup($, on, { 'claude-opus-5-5': 'medium' })
  await $.session.start({ cwd: '/w' } as never)
  const ui = await $.ui.mount(BAND)
  await feed(clock, bridge, 'PostModelSwitch', { source: 'command' })
  await feed(clock, bridge, 'SessionStart', {})
  await ui.redraw()
  expect(JSON.stringify(await ui.drawn({ in: 'meter' }))).toContain(' Opus 5.5 ')
  await ui.unmount()
})

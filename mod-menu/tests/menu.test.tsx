// mod-menu / tests/menu.test.tsx, by v-amorim
// Tests the command that flips the hidden flag and stores it for the next session, its usage line, and the state after a /clear.
import { expect, mock, test } from 'claude-code/testing'

import text from '../hooks/text'

type On = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[1]

const BAND = { plugin: 'mod-menu', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} } } as never

// The store and the state backed by maps; the test clears the state map the way the host does on a /clear.
function stubEngine(on: On, installed = ['mod-skill-panel.icons']) {
  on('config.list', () => ({ value: installed.map(key => ({ key })) }) as never)
  const states = new Map<string, unknown>()
  const store = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined } as never
  })
  on('state.get', (_$, e) => ({ value: { value: states.get(`${e.plugin}.${e.key}`) } }) as never)
  on('state.set', (_$, e) => {
    states.set(`${e.plugin}.${e.key}`, e.value)
    return { value: undefined } as never
  })
  on('session.start', () => ({ cwd: '/w' }))
  on('command.register', () => ({ value: { command: 'mod-menu' } }))
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>other mod</Text>
  })
  return { states, store }
}

test('/mod-menu flips hidden and stores it for the next session', async ($, on) => {
  const { store } = stubEngine(on)

  await $.command.run({ command: 'mod-menu' } as never)
  expect(store.get('hidden')).toBe(true)
  await $.command.run({ command: 'mod-menu' } as never)
  expect(store.get('hidden')).toBe(false)
})

test('with no panel mods installed the toggle says so and changes nothing', async ($, on) => {
  const { states, store } = stubEngine(on, ['mod-menu.labels', 'mod-blast-radius.icons'])

  const res = await $.command.run({ command: 'mod-menu' } as never)
  expect(JSON.stringify(res)).toContain('No panel mods installed')
  expect(JSON.stringify(res)).not.toContain('Menu hidden')
  expect(states.has('mod-menu.hidden')).toBe(false)
  expect(store.has('hidden')).toBe(false)
})

test('an unknown word prints usage and changes nothing', async ($, on) => {
  const { states, store } = stubEngine(on)

  const res = await $.command.run({ command: 'mod-menu', args: 'settings' } as never)
  expect(JSON.stringify(res)).toContain(text.usage)
  expect(states.has('mod-menu.hidden')).toBe(false)
  expect(store.has('hidden')).toBe(false)
})

test('a hidden menu stays hidden after a /clear, which empties the state and starts no session', async ($, on) => {
  const { states } = stubEngine(on)
  const clock = mock.clock(on, { now: 0 })
  await $.session.start({ cwd: '/w' } as never)
  await $.command.run({ command: 'mod-menu' } as never)
  expect(states.get('mod-menu.hidden')).toBe(true)

  states.clear()
  const band = await $.ui.mount(BAND)
  await band.drawn()
  await clock.advance(1)
  expect(states.get('mod-menu.hidden')).toBe(true)
  expect(states.get('mod-menu.labels')).toBe('auto')
  await band.unmount()
})

test('a labels setting saved in a settings pane reaches the state on the next draw, with no session start', async ($, on) => {
  const { states } = stubEngine(on)
  const clock = mock.clock(on, { now: 0 })
  states.set('mod-menu.booted', true)
  states.set('mod-menu.hidden', true)
  states.set('mod-menu.labels', 'always')

  const band = await $.ui.mount(BAND)
  await band.drawn()
  await clock.advance(1)
  expect(states.get('mod-menu.labels')).toBe('auto')
  expect(states.get('mod-menu.hidden')).toBe(true)
  await band.unmount()
})

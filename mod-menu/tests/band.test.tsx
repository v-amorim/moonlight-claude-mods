// mod-menu / tests/band.test.tsx, by v-amorim: the shared row draws the hidden entries of the other mods and drops rows while a hold is up
import { expect, mock, test } from 'claude-code/testing'

const node = (key: string, children: object[] = [], props: object = {}) => ({ type: 'Box', props: { key, ...props }, children })
const word = (value: string) => ({ type: 'Text', props: {}, children: [value] })
const entry = (id: string) => ({ type: 'Client', props: { key: `menu-beacon-entry-${id}`, module: 'hooks/entry.tsx', height: 1, props: { id, label: id, isOpen: false, bg: '#1C2033', nerd: false, tight: false } } })
const hostedRow = (id: string, tip?: object) => node('menu-rows', [node('menu-hosted', [node(`menu-beacon-${id}`, [entry(id)], { display: 'none' }), ...(tip ? [tip] : [])], { display: 'none' })])

const listOf = (rows: { plugin: string; tree: object }[]) =>
  ({ plugin: 'mod-menu', surface: 'terminal', component: 'AbovePromptList', props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {}, rows } }) as never

function stub(on: Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[1]) {
  on('state.get', () => ({ value: { value: undefined } }) as never)
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>stacked</Text>
  })
  mock.env(on, {})
  mock.clock(on)
}

test('the hidden entries of every mod draw as one row, led by the tip a mod lent', async ($, on) => {
  stub(on)
  const tip = node('menu-tip', [word(' lent tip')])
  const band = await $.ui.mount(listOf([{ plugin: 'mod-skill-panel', tree: hostedRow('skills') }, { plugin: 'mod-file-tree', tree: hostedRow('filetree', tip) }]))
  const drawn = JSON.stringify(await band.drawn())
  expect(drawn.match(/"key":"menu-row"/g)).toHaveLength(1)
  expect(drawn.indexOf('menu-pad-skills')).toBeLessThan(drawn.indexOf('menu-pad-filetree'))
  expect(drawn).toContain('lent tip')
  await band.unmount()
})

test('a leave, which posts no id, still reaches the mod that owns the entry', async ($, on) => {
  stub(on)
  const relayed: unknown[] = []
  on('state.set', (_$$, e) => {
    if (e.key === 'relay') relayed.push(e.value)
    return { value: undefined } as never
  })
  const band = await $.ui.mount(listOf([{ plugin: 'mod-heads-up', tree: hostedRow('headsup') }]))
  // The kit's types omit post, which the runner provides.
  await (band as unknown as { post: (data: object, at: { in: string }) => Promise<void> }).post({ type: 'tip', id: null }, { in: 'menu-entry-headsup' })
  expect(JSON.stringify(relayed)).toContain('"to":"mod-heads-up","data":{"type":"tip","id":null}')
  await band.unmount()
})

test('a row that marks the band exclusive is the only one handed on, and the pills still draw', async ($, on) => {
  stub(on)
  const other = node('menu-rows', [word('OTHER-ROW')])
  const hold = node('menu-rows', [node('band-exclusive', [], { display: 'none' }), word('HOLD-CARD')])
  const mixed = listOf([{ plugin: 'mod-skill-panel', tree: hostedRow('skills') }, { plugin: 'mod-next-steps', tree: other }, { plugin: 'mod-blast-radius', tree: hold }])
  const band = await $.ui.mount(mixed)
  const drawn = JSON.stringify(await band.drawn())
  expect(drawn).toContain('menu-pad-skills')
  expect(drawn).not.toContain('OTHER-ROW')
  await band.unmount()
})

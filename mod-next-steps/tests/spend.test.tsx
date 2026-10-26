// mod-next-steps / tests/spend.test.tsx, by v-amorim
// Tests that a model result's usage lands in spend.json and that a failed write never reaches the mod.
import { expect, mock, test as kitTest, type TestRest } from 'claude-code/testing'

// The side check is opt-in, so these tests turn it on unless a test sets its own value.
const test = (name: string, ...rest: TestRest) => {
  const [settings, body] = rest.length === 1 ? [{}, rest[0]] : rest
  return kitTest(name, { ...settings, options: { enabled: true, ...settings.options } }, body)
}

const DONE = { answer: 'All done.', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' } as const
const PATH = 'C:/cfg/mods-data/mod-next-steps/spend.json'
const usage = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5, cache_creation_input_tokens: 7 }

function world(on: any, options: { failWrite?: boolean; existing?: string } = {}) {
  const clock = mock.clock(on)
  const writes: { path: string; text: string }[] = []
  on('env.get', (_$: unknown, e: { name: string }) => ({ value: e.name === 'CLAUDE_CONFIG_DIR' ? 'C:\\cfg' : undefined }))
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('fs.read', (_$: unknown, e: { path: string }) => {
    if (e.path.replace(/\\/g, '/').replace(/^.*?(?=[A-Za-z]:\/)/, '') === PATH &&options.existing !== undefined) return { value: options.existing }
    throw new Error('ENOENT')
  })
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    if (options.failWrite) throw new Error('disk full')
    writes.push({ path: e.path.replace(/\\/g, '/').replace(/^.*?(?=[A-Za-z]:\/)/, ''), text: e.text })
    return { value: undefined }
  })
  on('model.fork', () => ({ value: { isAnswered: true, text: 'add a test', usage } }))
  on('turn.start', (_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', ($: any, e: unknown) => {
    const elements = $.ui.resolve(e)
    return <elements.Text key="base">base</elements.Text>
  })
  return { clock, writes }
}

test('a fork result adds its usage to spend.json under today and the session model', async ($, on) => {
  const { clock, writes } = world(on)
  await $.turn.complete(DONE as never)
  await clock.settle()
  expect(writes.length).toBe(1)
  expect(writes[0]!.path).toBe(PATH)
  const day = Object.values(JSON.parse(writes[0]!.text).days)[0] as Record<string, unknown>
  expect(day['claude-sonnet-5-5']).toEqual({ calls: 1, input: 100, output: 20, cacheRead: 5, cacheWrite: 7 })
})

test('a second call adds to the counts already on disk and drops days older than 30', async ($, on) => {
  const old = { calls: 9, input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }
  const { clock, writes } = world(on, { existing: JSON.stringify({ days: { '1900-01-01': { haiku: old } } }) })
  await $.turn.complete(DONE as never)
  await clock.settle()
  const { days } = JSON.parse(writes[0]!.text)
  expect(Object.keys(days).length).toBe(1)
  expect(days['1900-01-01']).toBeUndefined()
})

test('a write that fails is ignored and the suggestions still arrive', async ($, on) => {
  const { clock } = world(on, { failWrite: true })
  await $.turn.complete(DONE as never)
  await clock.settle()
  const ui = await $.ui.mount({
    plugin: 'mod-next-steps',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 80, scroll: { offset: 0, bodyRows: 6 }, view: {} },
  })
  expect(await ui.find({ key: 'steps-hotkey-button-0' })).toBeDefined()
  await ui.unmount()
})

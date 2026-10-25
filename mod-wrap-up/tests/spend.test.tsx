// mod-wrap-up / tests/spend.test.tsx, by v-amorim
// Tests that a model result's usage lands in spend.json and that a failed write never reaches the mod.
import { expect, mock, test } from 'claude-code/testing'

const PATH = 'C:/cfg/mods-data/mod-wrap-up/spend.json'
const SKILL = '---\nname: session-handoff\ndescription: x\n---\n\n# session-handoff\n\nWrite one message.'
const usage = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5, cache_creation_input_tokens: 7 }
const BAND = {
  plugin: 'mod-wrap-up',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 80, scroll: { offset: 0, bodyRows: 6 }, view: {} },
} as const

function world(on: any, failWrite = false) {
  const writes: { path: string; text: string }[] = []
  const filled: string[] = []
  on('env.get', (_$: unknown, e: { name: string }) => ({ value: e.name === 'CLAUDE_CONFIG_DIR' ? 'C:\\cfg' : undefined }))
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('session.messages', () => ({ value: [] }))
  on('model.fork', () => ({ value: { isAnswered: true, text: 'Goal: ship it.', usage } }))
  on('fs.read', (_$: unknown, e: { path: string }) => {
    const path = e.path.replace(/\\/g, '/').replace(/^.*?(?=[A-Za-z]:\/)/, '')
    if (path.endsWith('skills/session-handoff/SKILL.md')) return { value: SKILL }
    if (path.endsWith('/showcase.json')) return { value: JSON.stringify({ actions: [] }) }
    throw new Error('ENOENT')
  })
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    if (failWrite) throw new Error('disk full')
    writes.push({ path: e.path.replace(/\\/g, '/').replace(/^.*?(?=[A-Za-z]:\/)/, ''), text: e.text })
    return { value: undefined }
  })
  on('command.run', () => ({ text: '' }))
  on('prompt.fill', (_$: unknown, e: { text: string }) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  on('ui.render', ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text key="base">idle</Text>
  })
  on('session.end', (_$: unknown, e: { sessionId: string }) => ({ sessionId: e.sessionId }))
  const clock = mock.clock(on)
  mock.store(on)
  return { writes, filled, clock }
}

const handOff = async (band: any) => {
  const down = (x: number, key: string) => band.pointer({ type: 'down', x, y: 0, button: 'left', in: key } as never)
  await down(1, 'wrap-up-entry')
  await down(12, 'wrap-up-entry')
  await down(1, 'wrap-up-go')
}

test('a handoff fork adds its usage to spend.json under today and the session model', async ($, on) => {
  const { writes, filled } = world(on)
  const band = await $.ui.mount(BAND)
  await handOff(band)
  expect(filled).toEqual(['Goal: ship it.'])
  const mine = writes.filter(write => write.path === PATH)
  expect(mine.length).toBe(1)
  const day = Object.values(JSON.parse(mine[0].text).days)[0] as Record<string, unknown>
  expect(day['claude-sonnet-5-5']).toEqual({ calls: 1, input: 100, output: 20, cacheRead: 5, cacheWrite: 7 })
  await band.unmount()
})

test('a write that fails is ignored and the handoff still fills', async ($, on) => {
  const { filled } = world(on, true)
  const band = await $.ui.mount(BAND)
  await handOff(band)
  expect(filled).toEqual(['Goal: ship it.'])
  await band.unmount()
})

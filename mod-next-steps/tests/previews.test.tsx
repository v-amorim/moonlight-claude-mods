// mod-next-steps / tests/previews.test.tsx, by v-amorim
import { mock, test as kitTest, type TestRest } from 'claude-code/testing'

// The side check is opt-in, so these tests turn it on unless a test sets its own value.
const test = (name: string, ...rest: TestRest) => {
  const [settings, body] = rest.length === 1 ? [{}, rest[0]] : rest
  return kitTest(name, { ...settings, options: { enabled: true, ...settings.options } }, body)
}

import { capture, expectPreview, written } from './previews-kit'
import { snapshot } from './previews.snapshot'

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 56, scroll: { offset: 0, bodyRows: 6 }, view: {} },
} as const

const DONE = { answer: 'All done.', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' } as const
const REPLY = 'add a test for the empty case\nrun the full suite\ncommit the fix'
const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

async function suggestions($: any, on: any) {
  const clock = mock.clock(on)
  on('model.fork', () => ({ value: { isAnswered: true, text: REPLY, usage } }))
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', () => ({ isFilled: true }))
  on('turn.start', (_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('session.end', (_$: unknown, e: { sessionId: string }) => ({ sessionId: e.sessionId }))
  on('ui.render', ($: any, e: unknown) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="base">base</Text>
  })
  await $.turn.complete(DONE as never)
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'mod-next-steps', surface: 'terminal', ...BAND })
  const got = await capture(await ui.find({ key: 'nextsteps-rows' }), key => ui.drawn({ in: key }))
  await ui.unmount()
  return got
}

for (const mode of ['nerd', 'safe'] as const) {
  test(`enabled=true example is the real card (${mode})`, { options: { icons: mode } }, async ($, on) => {
    expectPreview(snapshot, 'enabled', 'true', mode, await suggestions($, on))
  })

  test(`enabled=false example is its written line (${mode})`, { options: { icons: mode } }, async () => {
    expectPreview(snapshot, 'enabled', 'false', mode, written([{ text: 'No suggestions, no extra request', color: 'muted' }]))
  })
}

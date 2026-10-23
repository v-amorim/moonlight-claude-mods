// mod-model-effort / tests/speed.test.tsx, by v-amorim: the last reply's speed in the pill's tip.
import { expect, mock, test } from 'claude-code/testing'

import { firstText, replySpeed } from '../hooks/speed'

const pointer = (ui: object, event: object) => (ui as { pointer: (event: object) => Promise<void> }).pointer(event)
const BAND = { plugin: 'mod-model-effort', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} } } as never
const TIP = 'last reply: first token 1.2s, 58 tok/s'

test('speed math: first token and tokens per second from the times', () => {
  expect(replySpeed(1000, 2200, 3400, 70)).toEqual({ first: 1.2, rate: 58 })
  expect(replySpeed(0, 0, 2000, 100)).toEqual({ first: 0, rate: 50 })
})

test('speed math: no first chunk, no tokens or no streaming time gives no reading', () => {
  expect(replySpeed(0, undefined, 2000, 70)).toBeNull()
  expect(replySpeed(0, 500, 2000, 0)).toBeNull()
  expect(replySpeed(0, 500, 2000, undefined)).toBeNull()
  expect(replySpeed(0, 500, 500, 70)).toBeNull()
  expect(replySpeed(0, 500, 400, 70)).toBeNull()
  expect(replySpeed(600, 500, 900, 70)).toBeNull()
  expect(replySpeed(0, 500, Number.NaN, 70)).toBeNull()
})

test('speed math: first token shows one decimal under 10 seconds and whole seconds above', () => {
  expect(firstText(1.24)).toBe('1.2s')
  expect(firstText(0)).toBe('0.0s')
  expect(firstText(9.94)).toBe('9.9s')
  expect(firstText(9.96)).toBe('10s')
  expect(firstText(12.4)).toBe('12s')
})

type Plan = { first: number; streamed: number; tokens: number | null; agentId?: string; chunks?: object[] }
const TEXT = [{ kind: 'text', index: 0, text: 'a' }, { kind: 'text', index: 0, text: 'b' }]

// The first content chunk comes `first` ms after the request starts and the stream ends `streamed` ms later.
function stubs(on: any) {
  const clock = mock.clock(on)
  const plan: { now: Plan } = { now: { first: 0, streamed: 0, tokens: null } }
  // Moving the mock clock settles the event loop, which takes real time, so a step moves it only as far as it needs.
  on('turn.step', async function* ($: any, e: any) {
    const { first, streamed, tokens, chunks = TEXT } = plan.now
    let waited = false
    for (const chunk of chunks as { kind: string }[]) {
      if (!waited && first > 0 && (chunk.kind === 'text' || chunk.kind === 'thinking')) {
        waited = true
        await clock.set(clock.now() + first)
      }
      yield chunk as never
    }
    if (streamed > 0) await clock.set(clock.now() + streamed)
    return { turnId: e.turnId, index: e.index, answer: 'ab', toolUses: [], stopReason: 'end_turn', usage: tokens === null ? null : { output_tokens: tokens, model: e.model } }
  })
  on('env.get', () => ({ value: undefined }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('ui.render', ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })
  let reading: unknown
  let index = -1
  on('state.set', (_$: any, e: any, next: any) => {
    if (e.key === 'speed') reading = e.value
    return next(e)
  })
  // Sets the plan, runs one request and returns the chunks that came out.
  const step = async ($: any, next: Plan) => {
    plan.now = next
    const seen: object[] = []
    const stream = $.turn.step({ turnId: 't1', index: (index += 1), model: 'claude-opus-5-5', effort: 'medium', messageCount: 1, agentId: next.agentId } as never)
    for (let result = await stream.next(); result.done !== true; result = await stream.next()) seen.push(result.value)
    return seen
  }
  return { step, read: () => reading }
}

test('speed stream: every chunk passes through unchanged and in order, and the reading is kept', async ($, on) => {
  const { step, read } = stubs(on)
  expect(await step($, { first: 1200, streamed: 1200, tokens: 70 })).toEqual(TEXT)
  expect(read()).toEqual({ first: 1.2, rate: 58 })
})

test('speed stream: a subagent step is left alone', async ($, on) => {
  const { step, read } = stubs(on)
  expect(await step($, { first: 1200, streamed: 1200, tokens: 70, agentId: 'agent-1' })).toEqual(TEXT)
  expect(read()).toBeUndefined()
})

test('speed stream: a step with no content chunk keeps the previous reading', async ($, on) => {
  const { step, read } = stubs(on)
  await step($, { first: 1200, streamed: 1200, tokens: 70 })
  expect(await step($, { first: 0, streamed: 0, tokens: 40, chunks: [] })).toEqual([])
  expect(read()).toEqual({ first: 1.2, rate: 58 })
})

test('speed stream: a step with no usage keeps the previous reading', async ($, on) => {
  const { step, read } = stubs(on)
  await step($, { first: 1200, streamed: 1200, tokens: 70 })
  await step($, { first: 0, streamed: 0, tokens: null })
  expect(read()).toEqual({ first: 1.2, rate: 58 })
})

test('speed stream: a step that streams in no time keeps the previous reading', async ($, on) => {
  const { step, read } = stubs(on)
  await step($, { first: 1200, streamed: 1200, tokens: 70 })
  await step($, { first: 300, streamed: 0, tokens: 40 })
  expect(read()).toEqual({ first: 1.2, rate: 58 })
})

test('speed stream: a thinking chunk counts as the first token', async ($, on) => {
  const { step, read } = stubs(on)
  const chunks = [{ kind: 'thinking', index: 1, text: 'hm' }]
  await step($, { first: 2000, streamed: 1000, tokens: 50, chunks })
  expect(read()).toEqual({ first: 2, rate: 50 })
})

test('speed tip: before any reply the tip is as it was, and after one hovering the pill shows the speed', async ($, on) => {
  const { step, read } = stubs(on)
  const ui = await $.ui.mount(BAND)
  await pointer(ui, { in: 'meter', type: 'move', x: 1, y: 0 })
  await pointer(ui, { in: 'meter', type: 'move', x: 16, y: 0 })
  expect(await ui.find({ type: 'Text', text: ' sets effort to xhigh' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'last reply' })).toBeUndefined()
  await pointer(ui, { in: 'meter', type: 'leave', x: 0, y: 0 })
  await ui.unmount()

  await step($, { first: 1200, streamed: 1200, tokens: 70 })
  const after = await $.ui.mount(BAND)
  await pointer(after, { in: 'meter', type: 'move', x: 1, y: 0 })
  await pointer(after, { in: 'meter', type: 'move', x: 16, y: 0 })
  expect(await after.find({ type: 'Text', text: ` sets effort to xhigh · ${TIP}` })).toBeDefined()
  await pointer(after, { in: 'meter', type: 'leave', x: 0, y: 0 })
  await after.unmount()
})

test('speed tip: the model tip and the general pill tip carry it too', async ($, on) => {
  const { step, read } = stubs(on)
  await step($, { first: 1200, streamed: 1200, tokens: 70 })
  const ui = await $.ui.mount(BAND)
  await pointer(ui, { in: 'meter', type: 'move', x: 1, y: 0 })
  await pointer(ui, { in: 'meter', type: 'move', x: 3, y: 0 })
  expect(await ui.find({ type: 'Text', text: ` switches the model · ${TIP}` })).toBeDefined()
  await pointer(ui, { in: 'meter', type: 'move', x: 30, y: 0 })
  expect(await ui.find({ type: 'Text', text: ` shows the effort levels · ${TIP}` })).toBeDefined()
  await ui.unmount()
})

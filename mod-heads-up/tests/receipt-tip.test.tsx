// mod-heads-up / tests/receipt-tip.test.tsx, by v-amorim
// Tests the last-turn receipt wired through the engine and shown in the band tip row on the pill.
import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const

type Setup = { costs?: (number | undefined)[]; failTool?: string }

function setup(on: any, { costs = [], failTool = '' }: Setup = {}) {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 5, 16, 52) })
  const store = new Map<string, unknown>()
  const queue = [...costs]
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: store.get(e.key) }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.delete', () => ({ value: undefined }))
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.start', () => ({ cwd: '/w' }))
  on('session.usage', () => {
    const usd = queue.shift()
    return { value: { startedAt: 0, context: {}, rateLimits: [], ...(usd === undefined ? {} : { cost: { usd } }) } }
  })
  on('ui.panes', () => ({ value: [] }))
  on('state.get', () => ({ value: { value: undefined } }))
  on('state.set', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined }))
  on('tool.call', (_$: unknown, e: { tool: string }) => (e.tool === failTool ? { ref: 1, result: 'boom', text: 'boom', isError: true } : { ref: 1, result: '', text: '' }))
  on('agent.spawn', () => ({ model: 'm', agentId: 'a1' }))
  on('turn.start', (_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', ($: any, e: unknown) => {
    const elements = $.ui.resolve(e)
    return <elements.Text key="base">base</elements.Text>
  })
  return { clock, store }
}

const band = ($: any) => $.ui.mount({ plugin: 'mod-heads-up', surface: 'terminal', ...BAND })

async function hoverPill($: any, clock: any) {
  const ui = await band($)
  await ui.pointer({ in: 'menu-entry-headsup', type: 'move', x: 1, y: 0 })
  await clock.settle()
  const tree = JSON.stringify(await ui.drawn())
  await ui.unmount()
  return tree
}

const runTurn = async ($: any, clock: any, body: () => Promise<void>) => {
  await $.turn.start({ text: 'go', turnId: 't1' })
  await body()
  await clock.advance(12_000)
  await $.turn.complete({ answer: 'done', durationMs: 12_000, isAborted: false, turnId: 't1', reason: 'answer' })
}

test('receipt tip: before any turn the pill keeps its own tip', async ($, on) => {
  const { clock } = setup(on)
  const tree = await hoverPill($, clock)
  expect(tree).toContain('notes on things you should know but might miss')
  expect(tree).not.toContain('last turn')
})

test('receipt tip: after a turn the pill tip reads the receipt, subagent calls included, with the cost added', async ($, on) => {
  const { clock } = setup(on, { costs: [1, 1.7], failTool: 'Bash' })
  await runTurn($, clock, async () => {
    await $.agent.spawn({ prompt: 'p' } as never)
    await $.agent.spawn({ prompt: 'q' } as never)
    await $.tool.call({ tool: 'Edit', file_path: '/a', old_string: 'a', new_string: 'b' } as never)
    await $.tool.call({ tool: 'Write', file_path: '/b', content: 'x' } as never)
    await $.tool.call({ tool: 'Write', file_path: '/c', content: 'x', agentId: 'a1' } as never)
    await $.tool.call({ tool: 'Bash', command: 'false' } as never)
    await $.turn.start({ text: 'sub', turnId: 't2', agentId: 'a1' })
    await $.turn.complete({ answer: 'x', durationMs: 1, isAborted: false, turnId: 't2', agentId: 'a1', reason: 'answer' })
  })
  const tree = await hoverPill($, clock)
  expect(tree).toContain('last turn 12s · 2 agents · 3 edits · 1 error · +$0.70')
  expect(tree).not.toContain('notes on things you should know')
})

test('receipt tip: with no cost ledger the tip leaves the cost out, and the receipt is saved in the store', async ($, on) => {
  const { clock, store } = setup(on)
  await runTurn($, clock, async () => {})
  expect(await hoverPill($, clock)).toContain('last turn 12s · 0 agents · 0 edits · 0 errors')
  expect(JSON.stringify([...store])).toContain('receipt:s1')
  expect(await hoverPill($, clock)).not.toContain('$')
})

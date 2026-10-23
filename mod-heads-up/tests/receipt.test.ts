// mod-heads-up / tests/receipt.test.ts, by v-amorim
// Tests the last-turn receipt's counting, cost and main-loop rules.
import { expect, test } from 'claude-code/testing'

import { countSpawn, countTool, duration, endTurn, receiptLine, receiptOf, startTurn, type Open } from '../hooks/receipt'

const finish = (open: Open | null, now: number, usd?: number) => endTurn(open, {}, now, usd).receipt

test('receipt count: a turn counts its length, subagents, edits by every edit tool, and errors', () => {
  let open = startTurn(null, {}, 1000)
  open = countSpawn(countSpawn(open))
  for (const tool of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Read', 'Bash']) open = countTool(open, tool, false)
  open = countTool(open, 'Bash', true)
  open = countTool(open, 'Edit', true)
  expect(finish(open, 13_000)).toEqual({ ms: 12_000, agents: 2, edits: 5, errors: 2 })
})

test('receipt count: a call or spawn with no turn open counts nothing', () => {
  expect(countTool(null, 'Edit', true)).toBeNull()
  expect(countSpawn(null)).toBeNull()
  expect(endTurn(null, {}, 5, 1).receipt).toBeUndefined()
})

test('receipt count: the line reads agents, edits and errors with singulars', () => {
  expect(receiptLine({ ms: 12_000, agents: 2, edits: 4, errors: 0, usd: 0.7 })).toBe('last turn 12s · 2 agents · 4 edits · 0 errors · +$0.70')
  expect(receiptLine({ ms: 4 * 60_000, agents: 1, edits: 1, errors: 1 })).toBe('last turn 4m · 1 agent · 1 edit · 1 error')
})

test('receipt count: a duration reads as seconds, minutes, or hours with padded minutes', () => {
  expect([duration(12_400), duration(4 * 60_000 + 59_000), duration(65 * 60_000), duration(3_600_000)]).toEqual(['12s', '4m', '1h05m', '1h00m'])
})

test('receipt count: a saved receipt comes back whole, and a damaged one is dropped', () => {
  const kept = { ms: 5, agents: 1, edits: 2, errors: 0, usd: 0.1 }
  expect(receiptOf(JSON.parse(JSON.stringify(kept)))).toEqual(kept)
  expect(receiptOf({ ms: 'x' })).toBeUndefined()
  expect(receiptOf(null)).toBeUndefined()
})

test('receipt cost: the cost added is the session cost after the turn less before it, rounded to cents', () => {
  const open = startTurn(null, {}, 0, 1.234)
  expect(finish(open, 1000, 1.9449)?.usd).toBe(0.71)
  expect(finish(open, 1000, 1.234)?.usd).toBe(0)
})

test('receipt cost: with no cost ledger at either end the cost part is left out, never $0.00', () => {
  const noStart = finish(startTurn(null, {}, 0), 1000, 2)
  const noEnd = finish(startTurn(null, {}, 0, 2), 1000)
  expect(noStart && 'usd' in noStart).toBe(false)
  expect(noEnd && 'usd' in noEnd).toBe(false)
  expect(receiptLine(noEnd!)).not.toContain('$')
})

test('receipt cost: a cost that fell is never shown as negative', () => {
  expect(finish(startTurn(null, {}, 0, 3), 1000, 2)?.usd).toBe(0)
})

test('receipt main: a subagent turn.start never resets the receipt and its turn.complete never closes it', () => {
  let open = startTurn(null, {}, 100)
  open = countTool(open, 'Edit', false)
  const afterStart = startTurn(open, { agentId: 'a1' }, 5000, 9)
  expect(afterStart).toBe(open)
  const ended = endTurn(open, { agentId: 'a1' }, 6000, 9)
  expect(ended.open).toBe(open)
  expect(ended.receipt).toBeUndefined()
  expect(endTurn(open, {}, 600).receipt).toEqual({ ms: 500, agents: 0, edits: 1, errors: 0 })
})

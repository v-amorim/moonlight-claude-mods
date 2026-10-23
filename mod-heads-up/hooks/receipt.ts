// mod-heads-up / hooks/receipt.ts, by v-amorim
// Counts the main turn that just ended: its length, subagents started, file edits, tool errors and the cost it added. No $ here.
import text from './text'
import { fill, MARK } from './theme'

export type Receipt = { ms: number; agents: number; edits: number; errors: number; usd?: number }
// A turn in progress: when it began, the session cost then, and its counts so far.
export type Open = { at: number; usd?: number; agents: number; edits: number; errors: number }

export const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']

const isMain = (input: { agentId?: string }) => !input.agentId

const money = (usd: unknown) => (typeof usd === 'number' && Number.isFinite(usd) ? usd : undefined)

// A subagent's turn never opens or closes the receipt; the tool calls and spawns it makes count into the main turn.
export function startTurn(open: Open | null, input: { agentId?: string }, now: number, usd?: number): Open | null {
  if (!isMain(input)) return open
  return { at: now, usd: money(usd), agents: 0, edits: 0, errors: 0 }
}

export function countSpawn(open: Open | null): Open | null {
  return open && { ...open, agents: open.agents + 1 }
}

export function countTool(open: Open | null, tool: string, isError: boolean): Open | null {
  return open && { ...open, edits: open.edits + (EDIT_TOOLS.includes(tool) ? 1 : 0), errors: open.errors + (isError ? 1 : 0) }
}

// The cost part needs the session's cost both times: a host with no ledger leaves it out.
export function endTurn(open: Open | null, input: { agentId?: string }, now: number, usd?: number): { open: Open | null; receipt?: Receipt } {
  if (!isMain(input) || !open) return { open }
  const end = money(usd)
  const added = end !== undefined && open.usd !== undefined ? Math.max(0, Math.round((end - open.usd) * 100) / 100) : undefined
  const receipt: Receipt = { ms: Math.max(0, now - open.at), agents: open.agents, edits: open.edits, errors: open.errors, ...(added === undefined ? {} : { usd: added }) }
  return { open: null, receipt }
}

export function duration(ms: number) {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return fill(text.receiptSeconds, { n: seconds })
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return fill(text.receiptMinutes, { n: minutes })
  return fill(text.receiptHours, { h: Math.floor(minutes / 60), m: String(minutes % 60).padStart(2, '0') })
}

const plural = (n: number, one: string, many: string) => fill(n === 1 ? one : many, { n })

export function receiptLine(receipt: Receipt) {
  const parts = [
    fill(text.receiptLead, { time: duration(receipt.ms) }),
    plural(receipt.agents, text.receiptAgent, text.receiptAgents),
    plural(receipt.edits, text.receiptEdit, text.receiptEdits),
    plural(receipt.errors, text.receiptError, text.receiptErrors),
  ]
  if (receipt.usd !== undefined) parts.push(fill(text.receiptCost, { usd: receipt.usd.toFixed(2) }))
  return parts.join(` ${MARK.sep} `)
}

// What the store hands back after a reload: only a well-formed receipt counts.
export function receiptOf(raw: unknown): Receipt | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined)
  const [ms, agents, edits, errors] = [count(r.ms), count(r.agents), count(r.edits), count(r.errors)]
  if (ms === undefined || agents === undefined || edits === undefined || errors === undefined) return undefined
  const usd = count(r.usd)
  return { ms, agents, edits, errors, ...(usd === undefined ? {} : { usd }) }
}

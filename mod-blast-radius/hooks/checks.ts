// mod-blast-radius / hooks/checks.ts, by v-amorim
// The session's permission checks: what is kept about each, how a secret is masked, how an ask settles, and the counts the card and Details show.
import marks from './marks'

export type Verdict = 'allowed' | 'asked' | 'denied' | 'waiting'
export type Family = 'file' | 'shell' | 'other'
export type Check = { id: string; tool: string; family: Family; summary: string; verdict: Verdict; isAgent: boolean; at: number }

const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Glob', 'Grep', 'NotebookRead'])
const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])

export const familyOf = (tool: string): Family => (FILE_TOOLS.has(tool) ? 'file' : SHELL_TOOLS.has(tool) ? 'shell' : 'other')

const HIDDEN = '****'

// Order matters: a header or a key=value hides its whole value before the key shapes look at what is left.
const MASKS: [RegExp, string][] = [
  [/\b(authorization\s*[:=]\s*)(?:(?:bearer|basic|token)\s+)?[^\s"']+/gi, `$1${HIDDEN}`],
  [/\b(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, `$1${HIDDEN}`],
  [/([A-Za-z_-]*(?:token|password|passwd|secret|api[_-]?key)\s*=\s*["']?)[^\s"'&]+/gi, `$1${HIDDEN}`],
  [/\bsk-[A-Za-z0-9_-]{8,}/g, HIDDEN],
  [/\bgh[pousr]_[A-Za-z0-9]{8,}/g, HIDDEN],
  [/\bgithub_pat_[A-Za-z0-9_]{8,}/g, HIDDEN],
  [/\bAKIA[0-9A-Z]{12,}/g, HIDDEN],
  [/\bxox[bp]-[A-Za-z0-9-]{8,}/g, HIDDEN],
]

export const mask = (value: string) => MASKS.reduce((masked, [pattern, hidden]) => masked.replace(pattern, hidden), value)

// The input fields that name what a call touches, in the order they are tried.
const TARGETS = ['command', 'file_path', 'notebook_path', 'path', 'pattern']

// The tool and the first words of its path or command, masked before the cut so a secret never survives half of itself.
export function summarize(tool: string, input: unknown) {
  const fields = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const found = TARGETS.map(key => fields[key]).find(value => typeof value === 'string' && value.trim() !== '') as string | undefined
  if (!found) return tool
  const line = mask(found).replace(/\s+/g, ' ').trim()
  return `${tool} ${line.length > marks.summaryChars ? `${line.slice(0, marks.summaryChars - 3)}...` : line}`
}

// Oldest settled checks drop first; a waiting one stays however long the list grows.
export function trim(list: Check[], limit = marks.keepChecks) {
  let extra = list.length - limit
  if (extra <= 0) return list
  return list.filter(check => (extra > 0 && check.verdict !== 'waiting' ? (extra--, false) : true))
}

export const upsert = (list: Check[], next: Check) =>
  trim(list.some(check => check.id === next.id) ? list.map(check => (check.id === next.id ? { ...next, at: check.at } : check)) : [...list, next])

// A check's own answer: allow and deny are final, an ask waits for what happens to the call.
export const verdictOfCheck = (decision: string): Verdict => (decision === 'allow' ? 'allowed' : decision === 'deny' ? 'denied' : 'waiting')

export const settle = (list: Check[], id: string, verdict: Verdict) =>
  list.map(check => (check.id === id && check.verdict === 'waiting' ? { ...check, verdict } : check))

const REFUSED = /(?:doesn|don)'?t want to proceed|permission to use .* (?:has been )?(?:denied|rejected)|tool use was rejected|interrupted by user/i

// What a tool.call answered when the person or the classifier refused it: a deny, or an error that says so.
export function isRefusal(result: unknown) {
  const answer = (result ?? {}) as { deny?: unknown; isError?: unknown; text?: unknown }
  if (typeof answer.deny === 'string') return true
  return answer.isError === true && REFUSED.test(String(answer.text ?? ''))
}

export type Counts = { total: number; allowed: number; asked: number; denied: number; waiting: number; agent: number; file: number; shell: number; other: number }

export function tally(list: Check[]): Counts {
  const counts: Counts = { total: list.length, allowed: 0, asked: 0, denied: 0, waiting: 0, agent: 0, file: 0, shell: 0, other: 0 }
  for (const check of list) {
    counts[check.verdict]++
    counts[check.family]++
    if (check.isAgent && check.verdict !== 'denied') counts.agent++
  }
  return counts
}

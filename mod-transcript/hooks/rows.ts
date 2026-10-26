// mod-transcript / hooks/rows.ts, by v-amorim
// Reads typed row fields for call statuses, questions, reports, API errors and notices.
import type { ModelApiError } from 'claude-code'

// The words a finished call shows after its name; each comes from a typed field, never from the output's text.
export type Status = 'timedOut' | 'interrupted' | 'background' | 'declined'

type Outcome = { timedOutAfterMs?: unknown; interrupted?: unknown; backgroundTaskId?: unknown; backgroundedByUser?: unknown }

export function statusesOf(call: { isInterrupted: boolean; isDeclined: boolean; output: unknown; input?: unknown }): Status[] {
  const output = (call.output ?? {}) as Outcome
  // The row's output may not carry the task id, so the call's own run_in_background counts too.
  const asked = (call.input as { run_in_background?: unknown } | undefined)?.run_in_background === true
  return [
    ...(typeof output.timedOutAfterMs === 'number' ? ['timedOut' as const] : []),
    ...(call.isInterrupted || output.interrupted === true ? ['interrupted' as const] : []),
    ...(asked || typeof output.backgroundTaskId === 'string' || output.backgroundedByUser === true ? ['background' as const] : []),
    ...(call.isDeclined ? ['declined' as const] : []),
  ]
}

export type Question = { question: string; answer: string | undefined; note: string | undefined }

const filled = (value: unknown) => (typeof value === 'string' && value.trim() ? value : undefined)

// The note is what the person typed beside a pick, kept in the result's annotations under the question's text.
export function questionsOf(input: unknown, output: unknown): Question[] {
  const questions = (input as { questions?: unknown } | undefined)?.questions
  const result = (output ?? {}) as { answers?: Record<string, unknown>; annotations?: Record<string, { notes?: unknown } | undefined> }
  if (!Array.isArray(questions)) return []
  return questions.map((each: { question?: unknown }) => {
    const question = typeof each?.question === 'string' ? each.question : ''
    return { question, answer: filled(result.answers?.[question]), note: filled(result.annotations?.[question]?.notes) }
  })
}

// Errors Claude Code retries on its own; every other kind waits for the person.
const RETRIED: ModelApiError[] = ['rate_limit', 'overloaded', 'server_error']

export const apiErrorAction = (error: ModelApiError) => (RETRIED.includes(error) ? 'retry' : 'act')

export type Report = { name?: string; status?: string; durationMs?: number; id?: string; type?: string }

// A subagent's or teammate's report: its sender's name, else its task's type, and the task's own fields.
export function reportOf(from: { name: string } | undefined, task: { id?: string; status?: string; type?: string; durationMs?: number } | undefined): Report {
  return { name: from?.name ?? task?.type ?? task?.id, status: task?.status, durationMs: task?.durationMs, id: task?.id, type: task?.type }
}

export type HexColor = { code: string; rgb: string }

const channels = (six: string) => [0, 2, 4].map(at => parseInt(six.slice(at, at + 2), 16))

// A hex color in text; a short code counts only with a letter in it, so a prompt number stays a number.
export const HEX = /(?<![\w#&])#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g
export const isHexCode = (digits: string) => digits.length > 4 || /[a-f]/i.test(digits)

// Each distinct hex color in order of first use; terminals draw no alpha, so it blends over `under`.
export function hexColors(text: string, under: string): HexColor[] {
  const found = new Map<string, HexColor>()
  for (const [code, digits] of text.matchAll(HEX)) {
    if (!isHexCode(digits!)) continue
    const full = digits!.length <= 4 ? [...digits!].map(digit => digit + digit).join('') : digits!
    const alpha = full.length === 8 ? parseInt(full.slice(6), 16) / 255 : 1
    const base = channels(under.replace('#', ''))
    const rgb = channels(full).map((value, at) => Math.round(value * alpha + base[at]! * (1 - alpha)).toString(16).padStart(2, '0')).join('')
    const key = code.toUpperCase()
    if (!found.has(key)) found.set(key, { code, rgb: `#${rgb.toUpperCase()}` })
  }
  return [...found.values()]
}

// How a background task ended and how long it ran, from its notice.
export type Notice = { status?: string; durationMs?: number }

// The task a peer report came from. The declared origin names no task, but the stored one carries it as senderTaskId.
export function senderTaskOf(origin: unknown): string | undefined {
  const id = (origin as { senderTaskId?: unknown } | undefined)?.senderTaskId
  return typeof id === 'string' && id ? id : undefined
}

export function withNotice(report: Report, notice: Notice | undefined): Report {
  return { ...report, status: notice?.status ?? report.status, durationMs: notice?.durationMs ?? report.durationMs }
}

// Whole lines of a read and the unfinished last line, which the next read completes.
export function completeLines(read: string) {
  const end = read.lastIndexOf('\n') + 1
  return { lines: read.slice(0, end).split('\n').filter(line => line.trim()), rest: read.slice(end) }
}

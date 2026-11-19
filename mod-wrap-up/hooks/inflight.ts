// mod-wrap-up / hooks/inflight.ts, by v-amorim: what the Stop command hook last saw still running, so an automatic handoff passes that work on to the session after it; pure, the reads stay in register.tsx.
export type Running = { id: string; kind: string; about: string }
export type Inflight = { tasks: Running[]; crons: Running[] }

export const NONE: Inflight = { tasks: [], crons: [] }

// A background task can run for hours, so only a record older than this is taken for stale.
export const MAX_AGE_S = 6 * 3600

export const stopFile = (folder: string, session: string) => `${folder}/${session}.stop`

const str = (value: unknown) => (typeof value === 'string' ? value : '')

const ABOUT_CHARS = 160

function runningOf(item: unknown, kind: string): Running {
  const entry = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
  const about = str(entry.description) || str(entry.prompt) || str(entry.cron)
  return { id: str(entry.id), kind: str(entry.type) || kind, about: about.replace(/\s+/g, ' ').trim().slice(0, ABOUT_CHARS) }
}

const listOf = (value: unknown, kind: string) => (Array.isArray(value) ? value.map(item => runningOf(item, kind)) : [])

// The hook writes the time in seconds on the first line and the Stop event's JSON after it; anything torn or old reads as nothing in flight.
export function readInflight(raw: string, nowMs: number): Inflight {
  const split = raw.indexOf('\n')
  if (split < 0) return NONE
  const wroteS = Number(raw.slice(0, split))
  if (!Number.isFinite(wroteS) || nowMs / 1000 - wroteS > MAX_AGE_S) return NONE
  try {
    const event = JSON.parse(raw.slice(split + 1))
    return { tasks: listOf(event?.background_tasks, 'task'), crons: listOf(event?.session_crons, 'scheduled') }
  } catch {
    return NONE
  }
}

export const hasInflight = (work: Inflight) => work.tasks.length + work.crons.length > 0

// One line per task or wake-up, so the session after the clear knows which notifications are coming and can stop one by its id.
export const inflightLines = (work: Inflight) => [...work.tasks, ...work.crons].map(item => `- ${item.kind} ${item.id || '?'}${item.about ? `: ${item.about}` : ''}`).join('\n')

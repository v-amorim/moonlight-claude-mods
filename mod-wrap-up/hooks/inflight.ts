// mod-wrap-up / hooks/inflight.ts, by v-amorim: what the Stop command hook last saw still running, so an automatic handoff never leaves work behind; pure, the reads stay in register.tsx.
export type Inflight = { tasks: number; crons: number }

export const NONE: Inflight = { tasks: 0, crons: 0 }

// A background task can run for hours, so only a record older than this is taken for stale.
export const MAX_AGE_S = 6 * 3600

export const stopFile = (folder: string, session: string) => `${folder}/${session}.stop`

const count = (value: unknown) => (Array.isArray(value) ? value.length : 0)

// The hook writes the time in seconds on the first line and the Stop event's JSON after it; anything torn or old reads as nothing in flight.
export function readInflight(raw: string, nowMs: number): Inflight {
  const split = raw.indexOf('\n')
  if (split < 0) return NONE
  const wroteS = Number(raw.slice(0, split))
  if (!Number.isFinite(wroteS) || nowMs / 1000 - wroteS > MAX_AGE_S) return NONE
  try {
    const event = JSON.parse(raw.slice(split + 1))
    return { tasks: count(event?.background_tasks), crons: count(event?.session_crons) }
  } catch {
    return NONE
  }
}

export const hasInflight = (work: Inflight) => work.tasks + work.crons > 0

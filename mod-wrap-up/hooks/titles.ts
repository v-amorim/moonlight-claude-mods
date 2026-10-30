// mod-wrap-up / hooks/titles.ts, by v-amorim: session names that share their chain's topic; pure, the reads stay in register.tsx.
import type { Names } from './handoff'
import text from './text'

const ARROW = text.link

// Names linked before the arrow became ASCII still split at their `←`.
function lastArrow(title: string) {
  return [ARROW, '←'].reduce((last, arrow) => {
    const at = title.lastIndexOf(arrow)
    return at > last.at ? { at, length: arrow.length } : last
  }, { at: -1, length: 0 })
}

// The part after the last arrow: the name a session goes by in the chain.
export function ownName(title: string) {
  const { at, length } = lastArrow(title)
  return (at < 0 ? title : title.slice(at + length)).trim()
}

// Every session of a chain is titled `topic #hop: own work`, so /resume lists the chain under one shared name, in order.
const TOPIC_SEPARATOR = ': '

// The head before the first colon, split into the topic and its hop; hop 0 when the head carries none.
function headOf(title: string) {
  const at = title.indexOf(TOPIC_SEPARATOR)
  if (at <= 0) return { topic: '', hop: 0 }
  const head = title.slice(0, at).trim()
  const numbered = /^(.*?)\s+#(\d+)$/.exec(head)
  return numbered ? { topic: numbered[1]!.trim(), hop: Number(numbered[2]) } : { topic: head, hop: 0 }
}

export const topicOf = (title: string) => headOf(title).topic

const workOf = (title: string) => {
  const own = ownName(title)
  const at = own.indexOf(TOPIC_SEPARATOR)
  return at > 0 ? own.slice(at + TOPIC_SEPARATOR.length).trim() : own
}

export const titled = (topic: string, hop: number, own: string) => (!own ? '' : topic && topic !== own ? `${topic} #${hop}${TOPIC_SEPARATOR}${own}` : own)

// A colon or a hash in a name that becomes the topic would split the next title at the wrong place.
const asTopic = (name: string) => name.replace(/[:#]/g, ' ').replace(/\s+/g, ' ').trim()

// The latest custom-title row of a transcript, which is the session's name now. A row of another session (a resume copies rows) is skipped.
export function latestTitle(transcript: string, session: string) {
  const lines = transcript.split('\n')
  for (let at = lines.length - 1; at >= 0; at--) {
    if (!lines[at]!.includes('"custom-title"')) continue
    try {
      const row = JSON.parse(lines[at]!)
      if (row?.type === 'custom-title' && typeof row.customTitle === 'string' && (!row.sessionId || !session || row.sessionId === session)) return row.customTitle.trim()
    } catch {
      // A half-written row is skipped.
    }
  }
  return ''
}

export const KEEP_APPLIED = 40

// What the handoff does to the two names. A title the mod did not set was written by the person, so it stays.
export type NamePlan = { old: string; next: string; oldOwn: string; nextOwn: string; topic: string; oldHop: number; nextHop: number }

// The current title's topic and hop win, so a `/rename topic: work` steers the chain; with no hop in it, place (the old session's 1-based spot in its ledger) is the hop.
function chainParts(current: string, applied: readonly string[], names: Names, place: number) {
  const head = headOf(current)
  return { isPersons: current !== '' && !applied.includes(current), topic: head.topic || names.topic, hop: head.hop || Math.max(1, place), currentOwn: head.topic ? workOf(current) : ownName(current) }
}


export function planNames(current: string, applied: readonly string[], names: Names, place = 1): NamePlan {
  const { isPersons, topic, hop, currentOwn } = chainParts(current, applied, names, place)
  const oldOwn = isPersons || !names.this ? currentOwn : names.this
  const old = isPersons || !names.this ? '' : titled(topic, hop, names.this)
  const nextTopic = topic || asTopic(oldOwn)
  return { old, next: titled(nextTopic, hop + 1, names.next), oldOwn, nextOwn: names.next, topic: nextTopic, oldHop: hop, nextHop: hop + 1 }
}

// The fresh session of a clear the person ran: the old session can no longer be renamed, so only the new one is.
export function lateNext(current: string, applied: readonly string[], names: Names, place = 1): NamePlan {
  const { topic, hop, currentOwn } = chainParts(current, applied, names, place)
  const nextTopic = topic || asTopic(currentOwn)
  return { old: '', next: titled(nextTopic, hop + 1, names.next), oldOwn: currentOwn, nextOwn: names.next, topic: nextTopic, oldHop: hop, nextHop: hop + 1 }
}

export const remember = (applied: readonly string[], titles: readonly string[]) => [...applied, ...titles.filter(Boolean)].slice(-KEEP_APPLIED)

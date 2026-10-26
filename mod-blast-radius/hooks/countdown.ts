// mod-blast-radius / hooks/countdown.ts, by v-amorim: the idle countdown on the hold card's top edge
import text from './text'
import { fill, THEME } from './theme'

export type Countdown = { time: string; color: string }

// Whole minutes rounded up while a minute or more is left, then whole seconds; warn at 2 min or less, alert in the last minute.
export function countdownOf(leftMs: number): Countdown {
  const seconds = Math.max(0, Math.ceil(leftMs / 1000))
  const time = seconds >= 60 ? fill(text.card.idleMin, { n: Math.ceil(seconds / 60) }) : fill(text.card.idleSec, { n: seconds })
  return { time, color: seconds < 60 ? THEME.alert : seconds <= 120 ? THEME.warn : THEME.onSurface }
}

// What the edge shows in `room` cells: the whole sentence, the sentence without its clause, or nothing.
export function countdownParts(leftMs: number, room: number): { lead: string; time: string; color: string; tail: string } | null {
  const { time, color } = countdownOf(leftMs)
  const [lead = '', after = ''] = text.card.idle.split('{time}')
  for (const tail of [`${after}${text.card.idleKeeps}`, after]) {
    // One blank on each side of the words.
    if ([...lead, ...time, ...tail].length + 2 <= room) return { lead, time, color, tail }
  }
  return null
}

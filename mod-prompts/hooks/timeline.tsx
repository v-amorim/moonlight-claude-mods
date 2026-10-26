// mod-prompts / hooks/timeline.tsx, by v-amorim
// Draws the timeline rail of prompt stops with dots, times and click handling.
import type { ClientModule, ClientSurface } from 'claude-code'

import { HOVER_STEPS, HOVER_TICK_MS, postTip, stepToward } from './entry'
import { cardFill } from './look'
import { mix, THEME } from './theme'

// time is the clock time the prompt was sent, empty when the transcript has none; index is its place in the whole list; label and tip fill the pane footer.
export type Stop = { index: number; time: string; text: string; label: string; tip: string }

export type TimelineProps = { stops: Stop[]; selected: number; glyph: string; dot: string; openDot: string; still: boolean }

export type TimelineMessage = { type: 'select'; index: number }

// Cells before the dot: the clock time and a space, or the same width blank.
export const GUTTER = 6

// The rows a run of stops takes: one each and no rail line between, so only the open prompt spreads over two rows.
export const timelineRows = (count: number) => count

// at: the stop under the pointer; fading: the stop it just left, and level: how much of its light is left.
type State = { at: number; fading: number; level: number }

const fades = new WeakMap<object, () => void>()

// A stop the pointer left dims over HOVER_STEPS ticks instead of switching off.
const startFade = (surface: ClientSurface<State>) => {
  if (fades.has(surface)) return
  const stop = surface.every(HOVER_TICK_MS, () => {
    const { state } = surface
    if (!state || state.fading < 0) return
    const level = stepToward(state.level, false)
    surface.setState(level === 0 ? { ...state, fading: -1, level: 0 } : { ...state, level })
    if (level === 0) {
      stop()
      fades.delete(surface)
    }
  })
  fades.set(surface, stop)
}

// Prompts as stops: time, a dot, the text. A click opens one; the stop under the pointer lifts and turns accent.
const Timeline: ClientModule<TimelineProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const { stops, selected, glyph, dot, openDot, still } = props
  const state = surface.state ?? { at: -1, fading: -1, level: 0 }
  const hovered = state.at
  const at = (y: number) => stops[y]

  surface.onPointer(event => {
    const stop = event.type === 'leave' ? undefined : at(event.y)
    const index = stop?.index ?? -1
    const isClick = event.type === 'down' && event.button === 'left' && index >= 0
    if (index !== hovered) {
      const isDimming = hovered >= 0 && !still
      surface.setState({ at: index, fading: isDimming ? hovered : -1, level: isDimming ? HOVER_STEPS : 0 })
      if (isDimming) startFade(surface)
      if (!isClick) postTip(surface, 'stop', stop ? { glyph, label: stop.label, text: stop.tip } : null)
    }
    if (isClick) surface.post({ type: 'select', index } satisfies TimelineMessage)
  })

  return (
    <Box flexDirection="column">
      {stops.map(stop => {
        const isOpen = stop.index === selected
        const lit = stop.index === hovered ? HOVER_STEPS : stop.index === state.fading ? state.level : 0
        const on = mix(isOpen ? THEME.surface3 : cardFill(), THEME.lifted, lit / HOVER_STEPS)
        const ink = isOpen ? mix(THEME.ok, THEME.accent, lit / HOVER_STEPS) : mix(THEME.muted, THEME.accent, lit / HOVER_STEPS)
        return (
          <Box key={`stop-${stop.index}`} flexDirection="row" backgroundColor={on}>
            <Text color={THEME.muted}>{(stop.time || '').padEnd(GUTTER)}</Text>
            {/* The open prompt sits on surface-3 in ok and bold, the rest muted, the dot too; the pointer lifts any of them. */}
            <Text color={ink}>{isOpen ? openDot : dot}</Text>
            <Text color={ink} bold={isOpen}>{` ${stop.text}`}</Text>
          </Box>
        )
      })}
    </Box>
  )
}

export default Timeline

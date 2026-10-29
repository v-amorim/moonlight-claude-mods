// mod-heads-up / hooks/timeline.tsx, by v-amorim
// One Client per timeline row: the pointer lights the whole row, lifted and accent, and the light fades out.
import type { ClientModule, ClientSurface } from 'claude-code'

import { HOVER_STEPS, HOVER_TICK_MS, hoverMix, postTip, stepToward, type EntryMessage, type Tip } from './entry'
import { cardFill } from './look'
import { THEME } from './theme'

// time, mark and summary are drawn as given (the caller pads them so the row has one fixed width); markColor and the summary tone follow the note's state.
export type RowProps = { id: string; time: string; mark: string; summary: string; isSelected: boolean; isUnread: boolean; still?: boolean; tip: Tip }

type State = { isOver: boolean; level: number }

// The fade-out runs on its own ticker, started by the leave event and stopped at 0 or when the pointer returns.
const fades = new WeakMap<object, () => void>()

const startFade = (surface: ClientSurface<State>) => {
  if (fades.has(surface)) return
  const stop = surface.every(HOVER_TICK_MS, () => {
    const { state } = surface
    if (!state) return
    const level = stepToward(state.level, state.isOver)
    if (level !== state.level) surface.setState({ ...state, level })
    if (state.isOver || level === 0) {
      stop()
      fades.delete(surface)
    }
  })
  fades.set(surface, stop)
}

const Row: ClientModule<RowProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  if (!surface.state) surface.setState({ isOver: false, level: 0 })
  const level = surface.state?.level ?? 0

  surface.onPointer(event => {
    const base = surface.state ?? { isOver: false, level: 0 }
    const isOver = event.type !== 'leave'
    if (isOver !== base.isOver) postTip(surface, props.id, isOver ? props.tip : null)
    if (!isOver && !props.still) startFade(surface)
    surface.setState({ isOver, level: isOver ? HOVER_STEPS : props.still ? 0 : base.level })
    if (event.type === 'down' && event.button === 'left') surface.post({ type: 'menu-entry', id: props.id } satisfies EntryMessage)
  })

  // Selected is accent and bold, an unread note onSurface, a read one muted: the mark says the same, so no state rides on one cue.
  const rest = props.isSelected ? THEME.accent : props.isUnread ? THEME.onSurface : THEME.muted
  const bg = hoverMix(cardFill(), THEME.surface2, level)
  const tone = (from: string) => hoverMix(from, THEME.accent, level)
  const markRest = props.isSelected || props.isUnread ? THEME.accent : THEME.muted

  return (
    <Box flexDirection="row" backgroundColor={bg}>
      <Text color={tone(THEME.muted)} backgroundColor={bg}>{props.time}</Text>
      <Text color={tone(markRest)} backgroundColor={bg}>{props.mark}</Text>
      <Text color={tone(rest)} bold={props.isSelected} backgroundColor={bg}>{props.summary}</Text>
    </Box>
  )
}

export default Row

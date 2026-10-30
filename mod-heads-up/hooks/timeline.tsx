// mod-heads-up / hooks/timeline.tsx, by v-amorim
// One Client per timeline row: the pointer lights the whole row, lifted and accent, and the light fades out.
import type { ClientModule, ClientSurface } from 'claude-code'

import { HOVER_STEPS, HOVER_TICK_MS, hoverMix, postTip, stepToward, type EntryMessage, type Tip } from './entry'
import { cardFill } from './look'
import { THEME } from './theme'

// time, mark and summary are drawn as given (the caller pads them so the row has one fixed width); markColor and the summary tone follow the note's state.
// scope: the outer row Box the engine lights, since the jump chip over the row can eat the Client's leave event.
export type RowProps = { id: string; time: string; mark: string; summary: string; isSelected: boolean; isUnread: boolean; still?: boolean; tip: Tip; scope?: string }

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
  const level = props.scope ? 0 : (surface.state?.level ?? 0)

  surface.onPointer(event => {
    const base = surface.state ?? { isOver: false, level: 0 }
    const isOver = event.type !== 'leave'
    if (isOver !== base.isOver) postTip(surface, props.id, isOver ? props.tip : null)
    if (!isOver && !props.still) startFade(surface)
    surface.setState({ isOver, level: isOver ? HOVER_STEPS : props.still ? 0 : base.level })
    if (event.type === 'down' && event.button === 'left') surface.post({ type: 'menu-entry', id: props.id } satisfies EntryMessage)
  })

  // The selected row sits on surface-3 in primary-70 and bold; every other row's text is muted, and the mark says whether it is unread.
  const rest = props.isSelected ? THEME.ok : THEME.muted
  const bg = props.isSelected ? hoverMix(THEME.surface3, THEME.lifted, level) : hoverMix(cardFill(), THEME.surface2, level)
  const tone = (from: string) => hoverMix(from, THEME.accent, level)
  const markRest = props.isSelected || props.isUnread ? THEME.accent : THEME.muted

  const litBg = props.isSelected ? THEME.lifted : THEME.surface2
  const lit = props.scope ? { hover: { scope: props.scope, color: THEME.accent, backgroundColor: litBg } } : {}
  return (
    <Box flexDirection="row" backgroundColor={bg} {...(props.scope ? { hover: { scope: props.scope, backgroundColor: litBg } } : {})}>
      <Text color={tone(THEME.muted)} backgroundColor={bg} {...lit}>{props.time}</Text>
      <Text color={tone(markRest)} backgroundColor={bg} {...lit}>{props.mark}</Text>
      <Text color={tone(rest)} bold={props.isSelected} backgroundColor={bg} {...lit}>{props.summary}</Text>
    </Box>
  )
}

export default Row

// mod-transcript / hooks/fold.tsx, by v-amorim
// Draws the fold pill whose mark lights under the pointer and folds on click.
import type { ClientModule } from 'claude-code'

import type { BarMessage, BarProps } from './bar'
import { HOVER_STEPS, HOVER_TICK_MS, hoverMix, postTip, stepToward } from './entry'
import text from './text'
import { CAPS, THEME } from './theme'

// color: the mark's color at rest; glyphs: the marks of an open and a closed line, from the look.
export type FoldProps = BarProps & { color: string; isOpen: boolean; nerd: boolean; still: boolean; glyphs: { open: string; closed: string } }

type State = { isOver: boolean; at: number; level: number }

// A pointer that left without a leave event stops lighting the pill after this long.
const QUIET_MS = 5000

const latest = new WeakMap<object, FoldProps>()

// Each pill's timer runs from the pointer's first event until the pill is at rest again: every folded turn of a long session ticking kept the process busy.
const timers = new WeakMap<object, () => void>()

const wake = (surface: Parameters<ClientModule<FoldProps, State>>[1]) => {
  if (timers.has(surface)) return
  const stop = surface.every(HOVER_TICK_MS, () => {
    const { state } = surface
    if (!state) return
    if (state.level !== (state.isOver ? HOVER_STEPS : 0)) surface.setState({ ...state, level: stepToward(state.level, state.isOver) })
    else if (state.isOver && Date.now() - state.at >= QUIET_MS) surface.setState({ ...state, isOver: false })
    else if (!state.isOver) {
      stop()
      timers.delete(surface)
    }
  })
  timers.set(surface, stop)
}

// The fold chip on a surface3 pill: a Button would invert only its own cell under the pointer, never the caps.
const Fold: ClientModule<FoldProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  latest.set(surface, props)

  if (!surface.state) surface.setState({ isOver: false, at: 0, level: 0 })

  surface.onPointer(event => {
    wake(surface)
    const over = event.type !== 'leave'
    const base = surface.state ?? { isOver: false, at: 0, level: 0 }
    const level = over === base.isOver ? base.level : latest.get(surface)?.still ? (over ? HOVER_STEPS : 0) : over ? HOVER_STEPS : base.level
    surface.setState({ isOver: over, at: Date.now(), level })
    if (event.type === 'down' && event.button === 'left') surface.post({ type: 'fold', kind: props.kind, id: props.id } satisfies BarMessage)
    else if (over !== base.isOver) postTip(surface, `fold-${props.id}`, over ? { glyph: '', label: text.tipLabel[props.kind], text: text.tipFold[props.kind] } : null)
  })

  const mark = hoverMix(props.color, THEME.accent, surface.state?.level ?? 0)
  const glyph = props.isOpen ? props.glyphs.open : props.glyphs.closed
  return (
    <Box flexDirection="row">
      {props.nerd ? <Text color={THEME.surface3}>{CAPS.left}</Text> : null}
      <Text color={mark} backgroundColor={THEME.surface3} bold>{props.nerd ? glyph : ` ${glyph} `}</Text>
      {props.nerd ? <Text color={THEME.surface3}>{CAPS.right}</Text> : null}
    </Box>
  )
}

export default Fold

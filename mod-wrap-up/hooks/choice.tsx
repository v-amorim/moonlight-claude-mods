// mod-wrap-up / hooks/choice.tsx, by v-amorim
// Draws the wrap-up pill and its option cards with hover tips and idle muting.
import type { ClientModule } from 'claude-code'

import { HOVER_STEPS, HOVER_TICK_MS, hoverMix, postTip, stepToward, type EntryMessage, type Tip } from './entry'
import style from './style'
import { CAPS, THEME } from './theme'

// tips: the head's first, then one per option, shown while the pointer is on that part.
// mode: the id of the option the open card is in, and isOn an option that is switched on: both drawn as the lifted subpill of the track and keeping the pill open; isIdle false mutes it while Claude works.
// still: the animations setting is off, so an option's hover color switches at once.
// The pill's own caps are drawn here too, so the pointer on a cap is still on the pill and the options stay open.
export type ChoiceProps = { id: string; label: string; options: { id: string; label: string; isOn?: boolean }[]; mode: string | null; bg: string; nerd: boolean; isIdle: boolean; tips: Tip[]; still?: boolean; icon?: string; cells?: number; compact?: boolean; isMenuOpen?: boolean }

export const choiceCells = (label: string, nerd: boolean) => (nerd ? 2 : 0) + [...label].length + 2

// A dialog opening under the pointer can swallow the leave event, so a hover with no pointer event for this long ends on its own.
const HOVER_QUIET_MS = 5000
const TICK_MS = 500

// over: -2 off the pill, -1 on its label, else the option under the pointer.
// tipId: the part whose tip was posted last, null once the pointer left.
// levels: each option's hover fade, full while the pointer is on it and one step down per tick once it left.
type Hover = { over: number; at: number; tipId?: string | null; levels?: number[] }

// A rail before every option but the first, then the label padded by a space each side (the subpill caps stand in the padding).
const widthOf = (label: string, index: number) => (index > 0 ? 1 : 0) + label.length + 2

// The stale-hover watch runs only while the pointer is on the pill, so an idle pill costs no wakeups.
const timers = new WeakMap<object, () => void>()

const watch = (surface: Parameters<ClientModule<ChoiceProps, Hover>>[1], id: string) => {
  if (timers.has(surface)) return
  const stop = surface.every(TICK_MS, () => {
    const { state } = surface
    if (state && state.over !== -2 && Date.now() - state.at < HOVER_QUIET_MS) return
    if (state && state.over !== -2) {
      surface.setState({ over: -2, at: Date.now(), tipId: null })
      postTip(surface, id, null)
    }
    stop()
    timers.delete(surface)
  })
  timers.set(surface, stop)
}

const fades = new WeakMap<object, () => void>()

const startFade = (surface: Parameters<ClientModule<ChoiceProps, Hover>>[1]) => {
  if (fades.has(surface)) return
  const stop = surface.every(HOVER_TICK_MS, () => {
    const { state } = surface
    if (!state) return
    const before = state.levels ?? []
    const levels = before.map((level, index) => stepToward(level, index === state.over))
    if (levels.some((level, index) => level !== before[index])) surface.setState({ ...state, levels })
    if (levels.every((level, index) => level === 0 || index === state.over)) {
      stop()
      fades.delete(surface)
    }
  })
  fades.set(surface, stop)
}

const Choice: ClientModule<ChoiceProps, Hover> = (props, surface) => {
  const { Box, Text } = surface.elements
  const over = surface.state?.over ?? -2
  const isFolded = props.compact === true
  const isExpanded = !isFolded && props.isIdle && (over !== -2 || props.mode !== null)
  const head = ` ${props.compact && props.icon ? props.icon : props.label} `

  if (!surface.state) surface.setState({ over: -2, at: 0 })

  const optionAt = (x: number) => {
    // The head pill, a space, then the track: its cap (Nerd) or a space of padding.
    let start = head.length + (props.nerd ? 4 : 2)
    for (const [index, option] of props.options.entries()) {
      const end = start + widthOf(option.label, index)
      if (x >= start && x < end) return index
      start = end
    }
    return -1
  }

  surface.onPointer(event => {
    watch(surface, props.id)
    // While folded the options are not where they will be, so the first event only opens the pill.
    const next = event.type === 'leave' ? -2 : isExpanded ? optionAt(event.x) : -1
    const isClick = event.type === 'down' && event.button === 'left'
    const tipId = next === -2 ? null : `${props.id}-tip-${next}`
    // One post lands per event, so a click posts its own message and the next move posts the tip.
    if (tipId !== (surface.state?.tipId ?? null) && !isClick) postTip(surface, tipId ?? props.id, tipId === null ? null : props.tips[next + 1]!)
    const levels = props.options.map((_, index) => (index === next ? HOVER_STEPS : props.still ? 0 : (surface.state?.levels?.[index] ?? 0)))
    surface.setState({ over: next, at: Date.now(), tipId: isClick ? (surface.state?.tipId ?? null) : tipId, levels })
    if (!props.still && levels.some((level, index) => level > 0 && index !== next)) startFade(surface)
    if (!isClick) return
    surface.post({ type: 'menu-entry', id: isFolded ? `${props.id}-open` : next >= 0 ? props.options[next]!.id : props.id } satisfies EntryMessage)
  })

  const option = (index: number) => {
    const { id, label, isOn } = props.options[index]!
    const isActive = props.isIdle && (id === props.mode || isOn === true)
    const color = props.isIdle ? hoverMix(isActive ? THEME.ok : THEME.muted, THEME.accent, surface.state?.levels?.[index] ?? 0) : THEME.muted
    const caps = isActive && props.nerd
    return (
      <Box key={id} flexDirection="row">
        {index > 0 ? <Text key={`${id}-rail`} color={style.colors.pills.separator} backgroundColor={THEME.surface3}>{style.marks.rail}</Text> : null}
        {caps ? <Text key={`${id}-cap-left`} color={THEME.lifted} backgroundColor={THEME.surface3}>{CAPS.left}</Text> : null}
        <Text key={`${id}-label`} color={color} bold={isActive} backgroundColor={isActive ? THEME.lifted : THEME.surface3}>{caps ? label : ` ${label} `}</Text>
        {caps ? <Text key={`${id}-cap-right`} color={THEME.lifted} backgroundColor={THEME.surface3}>{CAPS.right}</Text> : null}
      </Box>
    )
  }

  const track = isExpanded ? [
    <Text key="track-gap"> </Text>,
    props.nerd ? <Text key="track-cap-left" color={THEME.surface3}>{CAPS.left}</Text> : <Text key="track-pad-left" backgroundColor={THEME.surface3}> </Text>,
    ...props.options.map((_, index) => option(index)),
    props.nerd ? <Text key="track-cap-right" color={THEME.surface3}>{CAPS.right}</Text> : <Text key="track-pad-right" backgroundColor={THEME.surface3}> </Text>,
  ] : null

  return (
    <Box flexDirection="row">
      {props.nerd ? <Text key="cap-left" color={props.bg}>{CAPS.left}</Text> : null}
      <Text key="head" color={props.isIdle ? (isExpanded ? THEME.muted : THEME.onSurface) : THEME.muted} bold={isFolded && props.isMenuOpen === true} backgroundColor={isFolded && props.isMenuOpen === true ? THEME.lifted : props.bg}>{head}</Text>
      {props.nerd ? <Text key="cap-right" color={props.bg}>{CAPS.right}</Text> : null}
      {track}
    </Box>
  )
}

export default Choice

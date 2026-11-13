// mod-model-effort / hooks/meter.tsx, by v-amorim
// Draws the footer meter with model pill and effort levels, handling hover and clicks.
import type { ClientModule } from 'claude-code'

import { HOVER_STEPS, HOVER_TICK_MS, hoverMix, postTip, stepToward, type Tip } from './entry'
import { LEVEL_LOOK, LEVELS } from './levels'
import style from './style'
import { CAPS, THEME } from './theme'

// card: the meter drawn inside the effort card, always open and never compact. under: the fill behind its caps there.
// still: the animations are off, so the levels switch at once. nerd: the meter draws its caps, so a pointer on one keeps the levels open.
export type MeterProps = { effort: string | null; model: string; bg: string; still?: boolean; nerd?: boolean; tipModel: Tip; tipRest: Tip; tipLevels: Tip[]; cells?: number; compact?: boolean; card?: boolean; under?: string }

// The meter at rest: its caps on Nerd, the model name padded by one, then the current level and its space.
export const meterCells = (model: string, nerd: boolean) => (nerd ? 2 : 0) + [...model].length + 2 + 2

export type MeterMessage = { type: 'set'; effort: string } | { type: 'model-menu' } | { type: 'effort-card' }

// The readout color inside the model pill.
const PILL_FG = style.colors.pills.readout

// A dialog opening under the pointer can swallow the leave event, so a hover ends after this long without pointer events.
const HOVER_QUIET_MS = 5000

// lights: each glyph's fade from dark (0) to its level color (HOVER_STEPS).
// tipId: the part of the pill whose tip was posted last, null once the pointer left.
type Hover = { level: number; at: number; lights?: number[]; tipId?: string | null }

const litOf = (props: MeterProps, level: number) => (level >= 0 ? level : props.effort ? LEVELS.indexOf(props.effort as (typeof LEVELS)[number]) : -1)

const targets = (lit: number) => LEVELS.map((_, index) => (index <= lit ? HOVER_STEPS : 0))

// The ticker's closure keeps the first props, so it reads the latest from here.
const latest = new WeakMap<object, MeterProps>()

// The timer runs while a glyph fades or a hover may need ending, and stops at rest, so an idle meter costs no wakeups.
const timers = new WeakMap<object, () => void>()

const wake = (surface: Parameters<ClientModule<MeterProps, Hover>>[1]) => {
  if (timers.has(surface)) return
  const stop = surface.every(HOVER_TICK_MS, () => {
    const { state } = surface
    const now = latest.get(surface)
    if (!state || !now) return
    const goal = targets(litOf(now, state.level))
    const lights = state.lights ?? goal
    if (lights.some((light, index) => light !== goal[index])) {
      surface.setState({ ...state, lights: now.still ? goal : lights.map((light, index) => stepToward(light, goal[index]! > 0)) })
      return
    }
    if (state.level === -2) {
      stop()
      timers.delete(surface)
      return
    }
    if (Date.now() - state.at < HOVER_QUIET_MS) return
    surface.setState({ ...state, level: -2, at: Date.now(), tipId: null })
    postTip(surface, 'effort-meter', null)
  })
  timers.set(surface, stop)
}

// Mouse-only slider: a level glyph and the space after it set that level.
const Meter: ClientModule<MeterProps, Hover> = (props, surface) => {
  const { Box, Text } = surface.elements
  const reached = props.effort ? LEVELS.indexOf(props.effort as (typeof LEVELS)[number]) : -1
  // A compact meter never opens inline: a click opens the effort card instead.
  const compact = Boolean(props.compact) && !props.card
  const head = compact ? ' ' : ` ${props.model} ` // compact keeps one cell before the level, which still opens the model menu
  const start = (props.nerd ? 1 : 0) + head.length

  // The level under the pointer previews what a click would set: -1 on the model name, -2 off the pill.
  const hovered = surface.state?.level ?? -2
  latest.set(surface, props)
  if (!surface.state) surface.setState({ level: -2, at: 0, lights: targets(reached) })
  // A new effort from outside moves the lights too.
  const goalNow = targets(litOf(props, hovered))
  if ((surface.state?.lights ?? goalNow).some((light, index) => light !== goalNow[index])) wake(surface)
  const isExpanded = Boolean(props.card) || (!compact && hovered !== -2)
  surface.onPointer(event => {
    wake(surface)
    const slot = event.x - start
    // While folded the slots are not where they will be, so the first event only opens the meter.
    const level = event.type === 'leave' ? -2 : isExpanded && slot >= 0 && slot < LEVELS.length * 2 ? Math.floor(slot / 2) : -1
    const isClick = event.type === 'down' && event.button === 'left'
    const isModel = !compact && slot < 0
    const tipId = level === -2 ? null : level >= 0 ? `effort-level-${LEVELS[level]}` : isModel ? 'effort-model' : 'effort-rest'
    // One post lands per event, so a click posts its own message and the next move posts the tip.
    if (tipId !== (surface.state?.tipId ?? null) && !isClick) postTip(surface, tipId ?? 'effort-meter', tipId === null ? null : level >= 0 ? props.tipLevels[level]! : isModel ? props.tipModel : props.tipRest)
    const lights = surface.state?.lights ?? targets(reached)
    // The first fade step lands with the pointer, so the meter answers at once.
    const stepped = targets(litOf(props, level)).map((goal, index) => stepToward(lights[index] ?? 0, goal > 0))
    surface.setState({ ...surface.state, level, at: Date.now(), tipId: isClick ? (surface.state?.tipId ?? null) : tipId, lights: props.still ? targets(litOf(props, level)) : level !== hovered ? stepped : lights })
    if (isClick && compact) {
      surface.post({ type: 'effort-card' } satisfies MeterMessage)
      return
    }
    if (isClick && level >= 0) surface.post({ type: 'set', effort: LEVELS[level]! } satisfies MeterMessage)
    if (isClick && level < 0 && isModel) surface.post({ type: 'model-menu' } satisfies MeterMessage)
  })
  const lights = surface.state?.lights ?? targets(litOf(props, hovered))

  return (
    <Box flexDirection="row">
      {props.nerd ? <Text key="cap-left" color={props.bg} backgroundColor={props.under}>{CAPS.left}</Text> : null}
      <Text key="head" color={PILL_FG} backgroundColor={props.bg}>{head}</Text>
      {LEVELS.map((level, index) =>
        isExpanded || index === Math.max(reached, 0) ? (
          <Text key={level} color={hoverMix(THEME.border, LEVEL_LOOK[level]!.color, lights[index] ?? 0)} bold={index === hovered} backgroundColor={props.bg}>
            {`${LEVEL_LOOK[level]!.glyph} `}
          </Text>
        ) : null,
      )}
      {props.nerd ? <Text key="cap-right" color={props.bg} backgroundColor={props.under}>{CAPS.right}</Text> : null}
    </Box>
  )
}

export default Meter

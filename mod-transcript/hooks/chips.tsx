// mod-transcript / hooks/chips.tsx, by v-amorim
// Draws clickable tool chips with marks, counts and added or removed line totals.
import type { ClientModule } from 'claude-code'

import { cells } from './cells'
import { HOVER_STEPS, HOVER_TICK_MS, hoverMix, postTip, stepToward } from './entry'
import style from './style'
import text from './text'
import { CAPS, THEME } from './theme'

export type Chip = { kind: keyof typeof style.colors.kinds; mark: string; label: string; count: number; added: number; removed: number; isOpen: boolean }

export type ChipsProps = { id: string; chips: Chip[]; nerd: boolean; still: boolean }

export type ChipsMessage = { type: 'chip'; id: string; kind: Chip['kind'] }

// over: the chip under the pointer; levels: each chip's hover fade, 0 at rest.
type State = { over: Chip['kind'] | null; at: number; levels: Partial<Record<Chip['kind'], number>> }

// A pointer that left without a leave event stops lighting the chip after this long.
const QUIET_MS = 5000

const stat = (chip: Chip) => [chip.added ? `+${chip.added}` : '', chip.removed ? `−${chip.removed}` : ''].filter(Boolean).join(' ')

// Cells a chip takes: its two ends, mark, label, the count badge with its two ends, and the counts after it.
const widthOf = (chip: Chip) => 1 + cells(chip.mark) + 1 + cells(chip.label) + 1 + (2 + String(chip.count).length) + (stat(chip) ? 1 + cells(stat(chip)) : 0) + 1

// The chip under the pointer, per instance, so a tip posts only when it changes.
const under = new WeakMap<object, string | null>()

const latest = new WeakMap<object, ChipsProps>()

// Each line's timer runs from the pointer's first event until every chip is at rest again.
const timers = new WeakMap<object, () => void>()

type Surface = Parameters<ClientModule<ChipsProps, State>>[1]

const wake = (surface: Surface) => {
  if (timers.has(surface)) return
  const stop = surface.every(HOVER_TICK_MS, () => {
    const { state } = surface
    if (!state) return
    const levels = { ...state.levels }
    let isMoving = false
    for (const kind of Object.keys(levels) as Chip['kind'][]) {
      const next = stepToward(levels[kind] ?? 0, state.over === kind)
      if (next !== levels[kind]) isMoving = true
      levels[kind] = next
    }
    if (isMoving) surface.setState({ ...state, levels })
    else if (state.over && Date.now() - state.at >= QUIET_MS) surface.setState({ ...state, over: null })
    else if (!state.over) {
      stop()
      timers.delete(surface)
    }
  })
  timers.set(surface, stop)
}

const Chips: ClientModule<ChipsProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const { chips, nerd } = props
  latest.set(surface, props)
  const state = surface.state ?? { over: null, at: 0, levels: {} }
  if (!surface.state) surface.setState(state)
  // Without a Nerd Font the pill ends are plain spaces in the pill's color.
  const left = nerd ? CAPS.left : ' '
  const right = nerd ? CAPS.right : ' '

  surface.onPointer(event => {
    wake(surface)
    let hit: Chip | undefined
    let x = 0
    for (const chip of chips) {
      const width = widthOf(chip)
      if (event.x >= x && event.x < x + width) hit = chip
      x += width + 1
    }
    const base = surface.state ?? state
    const over = event.type === 'leave' ? null : (hit?.kind ?? null)
    if (over !== base.over) {
      const levels = { ...base.levels }
      if (over) levels[over] = HOVER_STEPS
      if (base.over && latest.get(surface)?.still) levels[base.over] = 0
      surface.setState({ over, at: Date.now(), levels })
    }
    if (event.type === 'down' && event.button === 'left') {
      if (hit) surface.post({ type: 'chip', id: props.id, kind: hit.kind } satisfies ChipsMessage)
      return
    }
    if (over === (under.get(surface) ?? null)) return
    under.set(surface, over)
    postTip(surface, `chip-${props.id}`, hit && over ? { glyph: '', label: hit.label, text: text.tipChip[hit.kind] } : null)
  })

  return (
    <Box flexDirection="row" columnGap={1}>
      {chips.map(chip => {
        const fill = chip.isOpen ? THEME.surface3 : THEME.surface2
        const { hue } = style.colors.kinds[chip.kind]
        // The kind's hue lives only in its mark; the count is the neutral Badge, one step above the chip.
        const badge = chip.isOpen ? THEME.lifted : THEME.surface3
        const label = hoverMix(chip.isOpen ? THEME.onSurface : THEME.muted, THEME.accent, state.levels[chip.kind] ?? 0)
        const cap = (side: string, key: string, color: string) => nerd ? <Text key={key} color={color}>{side}</Text> : <Box key={key} backgroundColor={color}><Text> </Text></Box>
        return (
          <Box key={chip.kind} flexDirection="row" flexShrink={0}>
            {cap(left, `${chip.kind}-left`, fill)}
            <Box key={`${chip.kind}-body`} flexDirection="row" backgroundColor={fill}>
              <Text color={hue}>{`${chip.mark} `}</Text>
              <Text color={label} bold={chip.isOpen}>{`${chip.label} `}</Text>
              {cap(left, `${chip.kind}-badge-left`, badge)}
              <Box key={`${chip.kind}-badge`} backgroundColor={badge}><Text color={THEME.muted}>{String(chip.count)}</Text></Box>
              {cap(right, `${chip.kind}-badge-right`, badge)}
              {stat(chip) ? (
                <Text key={`${chip.kind}-stat`}>
                  <Text color={THEME.good}>{chip.added ? ` +${chip.added}` : ''}</Text>
                  <Text color={THEME.alert}>{chip.removed ? ` −${chip.removed}` : ''}</Text>
                </Text>
              ) : null}
            </Box>
            {cap(right, `${chip.kind}-right`, fill)}
          </Box>
        )
      })}
    </Box>
  )
}

export default Chips

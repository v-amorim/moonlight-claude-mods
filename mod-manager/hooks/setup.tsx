// mod-manager / hooks/setup.tsx, by v-amorim
// Draws the setup rows: the tick lists of mods to install or update, the Checked list and the Apply lines.
import type { ClientModule, RenderElement } from 'claude-code'

import { HOVER_STEPS, HOVER_TICK_MS, hoverMix, mix, postTip, stepToward } from './entry'
import { fadeLevels, isFading } from './list'
import { cardFill } from './look'
import type { Check, Step } from './plan'
import { CAPS, MARK, THEME } from './theme'

// A tick row is a catalog mod, named by its catalog key (cat:<name>), never by an index into the mod list.
export type PickRow = { key: string; name: string; detail: string; ticked: boolean }

// kind tells the pane which set the key belongs to: mods ticked for install, or updates left ticked.
export type PickMessage = { type: 'pick'; key: string; kind: 'install' | 'update' }

export type PickProps = { kind: 'install' | 'update'; rows: PickRow[]; nameWidth: number; on: string; nerd: boolean; tipGlyph: string; tip: string; still?: boolean }

// A status tag keeps 15% of its colour: the share of the card fill it is washed into.
const TAG_WASH = 0.85

type State = { row: number; levels: Record<number, number> }

const fades = new WeakMap<object, () => void>()

// One row per catalog mod: a click anywhere on it ticks or unticks it; the row under the pointer lights as the list's rows do.
const PickList: ClientModule<PickProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const { kind, rows, nameWidth, on, nerd, tipGlyph, tip, still } = props
  const hovered = surface.state?.row ?? -1
  const levels = surface.state?.levels ?? {}

  surface.onPointer(event => {
    if (!still && !fades.has(surface)) {
      const stop = surface.every(HOVER_TICK_MS, () => {
        const state = surface.state
        if (state && isFading(state.levels, state.row)) {
          surface.setState({ ...state, levels: fadeLevels(state.levels, state.row) })
          return
        }
        stop()
        fades.delete(surface)
      })
      fades.set(surface, stop)
    }
    const row = event.type !== 'leave' && event.y >= 0 && event.y < rows.length ? event.y : -1
    const isClick = event.type === 'down' && event.button === 'left' && row >= 0
    if (row !== hovered) {
      surface.setState({ row, levels: still ? (row >= 0 ? { [row]: HOVER_STEPS } : {}) : fadeLevels(levels, row) })
      if (!isClick) postTip(surface, row >= 0 ? `manager-pick-${rows[row]!.key}` : 'manager-pick', row >= 0 ? { glyph: tipGlyph, label: rows[row]!.name, text: tip } : null)
    }
    if (isClick) surface.post({ type: 'pick', key: rows[row]!.key, kind } satisfies PickMessage)
  })

  return (
    <Box flexDirection="column">
      {rows.map((row, at) => {
        const level = levels[at] ?? 0
        const bg = hoverMix(cardFill(), THEME.lifted, level)
        const fill = row.ticked ? THEME.surface3 : THEME.surface2
        const end = (side: string, key: string) => <Text key={key} color={fill} backgroundColor={nerd ? bg : fill}>{nerd ? side : ' '}</Text>
        return (
          <Box key={`pick-${kind}-${at}`} flexDirection="row" backgroundColor={bg}>
            {/* Only the detail gives way: a squeezed Text wraps and makes the row two tall. */}
            <Box key={`pick-${kind}-${at}-pill`} flexDirection="row" flexShrink={0}>
              {end(CAPS.left, `pick-${kind}-${at}-left`)}
              <Text key={`pick-${kind}-${at}-tick`} color={THEME.muted} backgroundColor={fill}>
                <Text key={`pick-${kind}-${at}-mark`} backgroundColor={fill} color={row.ticked ? THEME.accent : THEME.muted}>{row.ticked ? MARK.stopOpen : MARK.stop}</Text>
                {` ${on}`}
              </Text>
              {end(CAPS.right, `pick-${kind}-${at}-right`)}
            </Box>
            <Box key={`pick-${kind}-${at}-name`} flexShrink={0}>
              <Text color={hoverMix(row.ticked ? THEME.onSurface : THEME.muted, THEME.accent, level)}>{` ${row.name.padEnd(nameWidth)}  `}</Text>
            </Box>
            <Box key={`pick-${kind}-${at}-detail`} flexShrink={1}>
              <Text color={THEME.muted} wrap="truncate-end">{row.detail}</Text>
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}

type Elements = { Box: (props: any) => RenderElement; Text: (props: any) => RenderElement }

// The Checked list (the Receipt): each line wrapped whole, its status tag on the right, square on a 15% tint of its colour.
export function checkedRows({ Box, Text }: Elements, tags: { ok: string; warn: string }, checks: Check[]) {
  return checks.map((check, at) => {
    const hue = check.ok ? THEME.ok : THEME.warn
    return (
      <Box key={`checked-${at}`} flexDirection="row" columnGap={1}>
        <Box key={`checked-${at}-line`} flexGrow={1} flexShrink={1}>
          <Text color={THEME.muted} wrap="wrap">{check.line}</Text>
        </Box>
        <Box key={`checked-${at}-tag`} flexShrink={0}>
          <Text color={hue} backgroundColor={mix(hue, cardFill(), TAG_WASH)}>{` ${check.ok ? tags.ok : tags.warn} `}</Text>
        </Box>
      </Box>
    )
  })
}

// Every pending line in full: wrapped under a hanging bullet, never cut with an ellipsis.
export function planRows({ Box, Text }: Elements, steps: Step[]) {
  return steps.map((step, at) => (
    <Box key={`plan-${at}`} flexDirection="row" columnGap={1}>
      <Box key={`plan-${at}-mark`} flexShrink={0}>
        <Text color={THEME.accent}>{MARK.bullet}</Text>
      </Box>
      <Text color={THEME.onSurface} wrap="wrap">{step.line}</Text>
    </Box>
  ))
}

export default PickList

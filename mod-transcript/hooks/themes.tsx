// mod-transcript / hooks/themes.tsx, by v-amorim
// The Code theme picker's rows: the chosen one on surface3 in primary-70, the one under the pointer lifted with accent text; a click posts its value.
import type { ClientModule } from 'claude-code'

import { cells } from './cells'
import { HOVER_STEPS, HOVER_TICK_MS, hoverMix, postTip, stepToward } from './entry'
import type { Tip } from './entry'
import { cardFill, sepText } from './look'
import text from './text'
import { MARK, THEME } from './theme'

// value is what the setting saves ('' follows VS Code); detail follows the label after a dot, tag in parentheses after that, both muted.
export type ThemeRow = { value: string; label: string; detail?: string; tag?: string; isChosen: boolean }

// glyph marks the chosen row (a second cue besides its fill); tip is what the pane footer says under the pointer, led by the row's label.
export type ThemesProps = { rows: ThemeRow[]; glyph: string; tip: Pick<Tip, 'glyph' | 'text'>; still?: boolean }

export type ThemesMessage = { type: 'code-theme'; value: string }

// Follow VS Code first, then the theme VS Code uses and the one chosen (so both show before the cut), then the rest; `chosen` is the saved setting, empty to follow.
export function themeRows(labels: string[], active: string | undefined, chosen: string): ThemeRow[] {
  const picked = chosen.trim()
  const pinned = [active, picked].filter((label, at, all): label is string => Boolean(label) && all.indexOf(label) === at)
  const order = [...pinned, ...labels.filter(label => !pinned.includes(label))]
  // Client props refuse an undefined value, so a row without detail or tag has no such key.
  return [
    { value: '', label: text.themeFollow, ...(active ? { detail: active } : {}), isChosen: !picked },
    ...order.map(label => ({ value: label, label, ...(label === active ? { tag: text.themeActive } : {}), isChosen: label === picked })),
  ]
}

type State = { row: number; levels: Record<number, number> }

const fadeLevels = (levels: Record<number, number>, hovered: number) => {
  const next: Record<number, number> = {}
  for (const row of new Set([...Object.keys(levels).map(Number), hovered])) {
    const level = stepToward(levels[row] ?? 0, row === hovered)
    if (row >= 0 && level > 0) next[row] = level
  }
  return next
}

const isFading = (levels: Record<number, number>, hovered: number) => Object.entries(levels).some(([row, level]) => level !== (Number(row) === hovered ? HOVER_STEPS : 0)) || (hovered >= 0 && !levels[hovered])

// Each list's fade timer runs only while a hover is moving.
const fades = new WeakMap<object, () => void>()

const Themes: ClientModule<ThemesProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const { rows, glyph, tip, still } = props
  const hovered = surface.state?.row ?? -1
  const levels = surface.state?.levels ?? {}

  surface.onPointer(event => {
    if (!still && !fades.has(surface)) {
      const stop = surface.every(HOVER_TICK_MS, () => {
        const { state } = surface
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
      // One post lands per event, so a click posts its own message and the next move posts the tip.
      if (!isClick) postTip(surface, row >= 0 ? `theme-${row}` : 'theme', row >= 0 ? { ...tip, label: rows[row]!.label } : null)
    }
    if (isClick) surface.post({ type: 'code-theme', value: rows[row]!.value } satisfies ThemesMessage)
  })

  const lead = cells(glyph)
  return (
    <Box flexDirection="column">
      {rows.map((row, at) => {
        const level = levels[at] ?? 0
        const bg = hoverMix(row.isChosen ? THEME.surface3 : cardFill(), THEME.lifted, level)
        const color = hoverMix(row.isChosen ? THEME.ok : THEME.onSurface, THEME.accent, level)
        return (
          <Box key={`theme-${at}`} flexDirection="row" backgroundColor={bg}>
            <Text key={`theme-${at}-label`} color={color} bold={row.isChosen}>{`${row.isChosen ? glyph : ' '.repeat(lead)} ${row.label}`}</Text>
            {row.detail ? sepText({ Text }, ` ${MARK.sep} ${row.detail}`, THEME.muted, `theme-${at}-detail`) : null}
            {row.tag ? <Text key={`theme-${at}-tag`} color={THEME.muted}>{` ${row.tag}`}</Text> : null}
            <Box key={`theme-${at}-fill`} flexGrow={1} />
          </Box>
        )
      })}
    </Box>
  )
}

export default Themes

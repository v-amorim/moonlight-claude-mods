// mod-progress / hooks/timeline.tsx, by v-amorim: a lane per loop on one shared clock.
import type { ClientModule } from 'claude-code'

import { postTip } from './entry'
import { cardFill, lookFor } from './look'
import type { LoopsMessage } from './loops'
import marks from './marks'
import { cutText, laneCells, laneLabels, timelineCols, type Row } from './progress'
import text from './text'
import { decodeAll, MARK, THEME } from './theme'

export type TimelineProps = { rows: Row[]; width: number; expanded: string; nerd: boolean; viewing: string; now: number }

// @ts-expect-error Row holds undefined fields, which the host's JsonValue props type refuses.
const Timeline: ClientModule<TimelineProps, number> = (props, surface) => {
  const { Box, Text } = surface.elements
  const { rows, width, expanded, nerd, viewing, now } = props
  const look = lookFor(nerd)
  const own = decodeAll(marks.glyphs)[nerd ? 'nerd' : 'safe']
  const hovered = surface.state ?? -1
  const durs = rows.map(row => row.elapsed || '0s')
  const cols = timelineCols(width, Math.max(3, ...durs.map(dur => dur.length)))
  const labels = laneLabels(rows)
  const lanes = laneCells(rows.map(row => ({ start: row.startedAt, end: row.endedAt, isRunning: row.status === 'running' })), now, cols.lane)

  surface.onPointer(event => {
    const at = event.type === 'leave' || event.y < 0 || event.y >= rows.length ? -1 : event.y
    if (at !== hovered) {
      surface.setState(at)
      const row = rows[at]
      postTip(surface, 'loops', row ? { glyph: row.id === expanded ? look.glyph.expanded : look.glyph.collapsed, label: row.name, text: text.tipLane } : null)
    }
    if (event.type === 'down' && event.button === 'left' && at >= 0) surface.post({ type: 'toggle', id: rows[at]!.id } satisfies LoopsMessage)
  })

  return (
    <Box flexDirection="column">
      {rows.map((row, at) => {
        const key = `lane-${at}`
        const isHover = hovered === at
        const mark = row.status === 'running' ? { glyph: own.running, color: THEME.accent } : row.status === 'done' ? { glyph: look.glyph.ok, color: THEME.ok } : { glyph: look.glyph.warn, color: THEME.alert }
        const { from, to } = lanes[at]!
        const spanColor = row.status === 'running' ? THEME.accent : row.status === 'done' ? THEME.ok : THEME.alert
        return (
          <Box key={key} height={1} width={width} flexDirection="row" backgroundColor={isHover ? THEME.lifted : cardFill()}>
            <Text wrap="truncate-end">
              <Text>{' '}</Text>
              <Text color={THEME.accent} bold>{row.id === viewing ? MARK.cursor : ' '}</Text>
              <Text color={mark.color}>{mark.glyph}</Text>
              <Text>{' '}</Text>
              <Text color={isHover ? THEME.accent : THEME.onSurface} bold={row.id === expanded}>{cutText(labels[at]!, cols.name).padEnd(cols.name)}</Text>
              <Text>{' '}</Text>
              <Text color={THEME.border}>{own.laneIdle.repeat(from)}</Text>
              <Text color={spanColor}>{own.laneSpan.repeat(to - from)}</Text>
              <Text color={THEME.border}>{own.laneIdle.repeat(cols.lane - to)}</Text>
              <Text>{' '}</Text>
              <Text color={THEME.muted}>{durs[at]!.padStart(cols.dur)}</Text>
              <Text>{' '}</Text>
            </Text>
          </Box>
        )
      })}
    </Box>
  )
}

export default Timeline

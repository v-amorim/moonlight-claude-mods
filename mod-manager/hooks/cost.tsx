// mod-manager / hooks/cost.tsx, by v-amorim
// The cost pill that marks a mod with a cost, drawn the same in the list and on the mod's page.
import type { RenderElement } from 'claude-code'

import { CAPS, THEME } from './theme'

type Elements = { Box: (props: any) => RenderElement; Text: (props: any) => RenderElement }

// Cells a pill takes: its two ends and the glyph, on Nerd and safe alike.
export const COST_CELLS = 3

// One glyph in `color` on `fill`, sitting on `on`, the row or card; caps on Nerd, a space each side on safe.
function badge({ Box, Text }: Elements, nerd: boolean, glyph: string, color: string, fill: string, on: string, key: string) {
  return (
    <Box key={key} flexDirection="row" flexShrink={0}>
      {nerd ? <Text key={`${key}-left`} color={fill} backgroundColor={on}>{CAPS.left}</Text> : null}
      <Text key={`${key}-body`} color={color} backgroundColor={fill} bold>{nerd ? glyph : ` ${glyph} `}</Text>
      {nerd ? <Text key={`${key}-right`} color={fill} backgroundColor={on}>{CAPS.right}</Text> : null}
    </Box>
  )
}

// The cost and settings marks share one neutral look: the glyph in secondary on surface3.
export const costPill = (elements: Elements, nerd: boolean, glyph: string, on: string, key: string) => badge(elements, nerd, glyph, THEME.secondary, THEME.surface3, on, key)

export const gearPill = (elements: Elements, nerd: boolean, glyph: string, on: string, key: string) => badge(elements, nerd, glyph, THEME.secondary, THEME.surface3, on, key)

// hooks/card.tsx, by v-amorim
// Shared sticky card; every mod whose pane has a card carries the same copy.
import type { RenderElement } from 'claude-code'

import { cardFill } from './look'
import { THEME } from './theme'

// Rows above the card: the head row and the gap under it.
export const HEAD_ROWS = 2

type Elements = { Box: (props: any) => RenderElement; Text: (props: any) => RenderElement }

// The card's space in the pane's flow; the section under it brings its own blank row, so the list starts one row clear of the border.
export const cardSpace = ({ Box }: Pick<Elements, 'Box'>, rows: number) => <Box key="card-space" height={rows} marginTop={1} flexShrink={0} />

// Drawn last over the list at the top of the view; the painted row under it keeps a scrolled row off the border.
export function stickyCard(elements: Elements, offset: number, columns: number, rows: number, body: unknown, hue: string = THEME.accent) {
  const { Box } = elements
  return (
    <Box key="card-wrap" position="absolute" top={Math.max(HEAD_ROWS, offset)} left={1} width={Math.max(10, columns - 2)} height={rows + 1} flexDirection="column">
      <Box
        key="card"
        height={rows}
        flexDirection="column"
        paddingX={1}
        overflow="hidden"
        borderStyle="round"
        borderColor={THEME.border}
        backgroundColor={cardFill(hue)}
      >
        {body}
      </Box>
      <Box key="card-gap" height={1} backgroundColor={THEME.bg} />
    </Box>
  )
}

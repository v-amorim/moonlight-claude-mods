// mod-transcript / hooks/table.tsx, by v-amorim
// A reply's markdown tables drawn as the terminal standard's table: caps headers in the dim colour, hairline rows, no sides.
import type { RenderElement } from 'claude-code'

import { cells } from './cells'
import style from './style'
import { MARK, THEME } from './theme'

type Elements = { Box: (props: any) => RenderElement; Text: (props: any) => RenderElement }
export type Table = { head: string[]; right: boolean[]; rows: string[][] }
export type Block = { kind: 'markdown'; text: string } | { kind: 'table'; table: Table }

const GAP = 3
const isRow = (line: string) => /^\s*\|.*\|\s*$/.test(line)
const isRule = (line: string) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line)
const split = (line: string) => line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, '|'))
// What a cell shows: markdown emphasis drops, code keeps its text and is coloured where it is drawn.
const plain = (cell: string) => cell.replace(/\*\*(.+?)\*\*|__(.+?)__/g, '$1$2').replace(/`([^`]*)`/g, '$1')
const isNumber = (cell: string) => /^[-+]?[\d.,]+\s*%?$/.test(plain(cell))

// The reply cut into markdown and the tables inside it, outside fenced code.
export function splitTables(text: string): Block[] {
  const lines = text.split('\n')
  const blocks: Block[] = []
  let prose: string[] = []
  let isFence = false
  const keep = () => {
    if (prose.join('\n').trim()) blocks.push({ kind: 'markdown', text: prose.join('\n').trim() })
    prose = []
  }
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at]!
    if (/^\s*(```|~~~)/.test(line)) isFence = !isFence
    if (!isFence && isRow(line) && isRule(lines[at + 1] ?? '')) {
      const head = split(line)
      const marks = split(lines[at + 1]!)
      const rows: string[][] = []
      at += 2
      while (at < lines.length && isRow(lines[at]!)) rows.push(split(lines[at++]!))
      at--
      const right = head.map((_, column) => marks[column]?.endsWith(':') === true || (rows.length > 0 && rows.every(row => isNumber(row[column] ?? ''))))
      keep()
      blocks.push({ kind: 'table', table: { head, right, rows } })
      continue
    }
    prose.push(line)
  }
  keep()
  return blocks
}

const widths = (table: Table) => table.head.map((cell, column) => Math.max(cells(plain(cell)), ...table.rows.map(row => cells(plain(row[column] ?? '')))))

export const tableWidth = (table: Table) => widths(table).reduce((sum, width) => sum + width, 0) + GAP * Math.max(0, table.head.length - 1)

// One cell's text, code spans in accent, padded to its column on the side its numbers align to.
function cellText({ Text }: Elements, cell: string, width: number, isRight: boolean, color: string, isBold: boolean, key: string) {
  const room = ' '.repeat(Math.max(0, width - cells(plain(cell))))
  const parts = cell.replace(/\*\*(.+?)\*\*|__(.+?)__/g, '$1$2').split(/`([^`]*)`/)
  return (
    <Text key={key} color={color} bold={isBold}>
      {isRight ? room : ''}
      {parts.map((part, at) => (at % 2 ? <Text key={`${key}-code-${at}`} color={THEME.accent}>{part}</Text> : part))}
      {isRight ? '' : room}
    </Text>
  )
}

export function tableBlock(elements: Elements, table: Table, key: string) {
  const { Box, Text } = elements
  const sizes = widths(table)
  const total = tableWidth(table)
  const gap = ' '.repeat(GAP)
  const line = (cellsOf: string[], at: number, isHead: boolean) => (
    <Text key={`${key}-row-${at}`}>
      {sizes.map((width, column) => [
        column ? gap : '',
        cellText(elements, isHead ? (cellsOf[column] ?? '').toUpperCase() : (cellsOf[column] ?? ''), width, table.right[column] === true, isHead ? style.colors.pills.readout : THEME.onSurface, !isHead && column === 0, `${key}-cell-${at}-${column}`),
      ])}
    </Text>
  )
  const rule = (at: number) => <Text key={`${key}-rule-${at}`} color={THEME.border}>{MARK.rule.repeat(total)}</Text>
  return (
    <Box key={key} flexDirection="column">
      {line(table.head, -1, true)}
      {table.rows.flatMap((row, at) => [rule(at), line(row, at, false)])}
    </Box>
  )
}

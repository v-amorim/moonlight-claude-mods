// mod-transcript / hooks/table.tsx, by v-amorim
// A reply's markdown tables drawn as the terminal standard's table: caps headers in the dim colour, hairline rows, no sides.
import type { RenderElement } from 'claude-code'

import { calloutOf, squareTag, STATUS_EXTRA, statusHue, type Callout, type Fence } from './blocks'
import { hasTask, inline, isSimple, shownWidth, tinted, type Inline } from './prose'
import style from './style'
import { MARK, THEME } from './theme'

type Elements = { Box: (props: any) => RenderElement; Text: (props: any) => RenderElement }
export type Table = { head: string[]; right: boolean[]; rows: string[][] }
export type Block =
  | { kind: 'markdown'; text: string }
  | { kind: 'prose'; text: string }
  | { kind: 'table'; table: Table }
  | ({ kind: 'code' } & Fence)
  | { kind: 'heading'; text: string }
  | ({ kind: 'callout' } & Callout)

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

// Paragraphs split on blank lines outside fenced code, so a fence with a blank line inside stays whole.
function paragraphs(text: string) {
  const out: string[] = []
  let current: string[] = []
  let isFence = false
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) isFence = !isFence
    if (!isFence && !line.trim()) {
      if (current.length) out.push(current.join('\n'))
      current = []
    } else current.push(line)
  }
  if (current.length) out.push(current.join('\n'))
  return out
}

// The reply cut into fenced code and the text around it; an unclosed fence runs to the end, as a reply still streaming holds it.
function fences(text: string): ({ kind: 'text'; text: string } | ({ kind: 'code' } & Fence))[] {
  const out: ({ kind: 'text'; text: string } | ({ kind: 'code' } & Fence))[] = []
  let prose: string[] = []
  let open: { mark: string; lang: string; code: string[] } | null = null
  const keep = () => {
    if (prose.join('\n').trim()) out.push({ kind: 'text', text: prose.join('\n') })
    prose = []
  }
  for (const line of text.split('\n')) {
    const found = /^\s*(`{3,}|~{3,})\s*([^\s`]*)/.exec(line)
    if (open) {
      if (found && found[1]![0] === open.mark[0] && found[1]!.length >= open.mark.length && !found[2]) {
        out.push({ kind: 'code', lang: open.lang, code: open.code.join('\n') })
        open = null
      } else open.code.push(line)
    } else if (found) {
      keep()
      open = { mark: found[1]!, lang: found[2]!, code: [] }
    } else prose.push(line)
  }
  if (open) out.push({ kind: 'code', lang: open.lang, code: open.code.join('\n') })
  keep()
  return out
}

const HEADING = /^ {0,3}#{1,3}\s+(.*?)(?:\s+#+)?\s*$/

// A paragraph cut into headings, callouts and the lines left over, in order; the rest keeps Claude Code's drawing unless the mod can draw it.
function lineBlocks(paragraph: string): Block[] {
  const out: Block[] = []
  let rest: string[] = []
  const flush = () => {
    if (rest.length) out.push({ kind: 'markdown', text: rest.join('\n') })
    rest = []
  }
  const lines = paragraph.split('\n')
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at]!
    const heading = HEADING.exec(line)
    if (heading?.[1]) {
      flush()
      out.push({ kind: 'heading', text: heading[1] })
      continue
    }
    if (/^\s*>/.test(line)) {
      let end = at + 1
      while (end < lines.length && /^\s*>/.test(lines[end]!) && !calloutOf([lines[end]!])) end++
      const callout = calloutOf(lines.slice(at, end))
      if (callout) {
        flush()
        out.push({ kind: 'callout', ...callout })
        at = end - 1
        continue
      }
    }
    rest.push(line)
  }
  flush()
  return out
}

// Marks the mod's own paragraph drawing does not handle, so a paragraph holding one stays with Claude Code.
export const unsupported = (paragraph: string) => /[*~]|(^|\W)_\S|\S_(\W|$)|!\[|<\w/.test(paragraph.replace(/`[^`]*`/g, '').replace(/\*\*.+?\*\*/g, ''))

// A paragraph worth drawing once the reply is the mod's own, so its code and links match the cards around it.
const isMarked = (paragraph: string) => isSimple(paragraph) && !unsupported(paragraph) && /`[^`]+`|\[[^\]]+\]\([^)]+\)/.test(paragraph)

// The reply as fenced code, tables, headings, callouts, the paragraphs holding a hex color or a task the mod can draw, and the rest left to Claude Code's markdown.
export function richBlocks(text: string, wants: (paragraph: string) => boolean): Block[] {
  const parts: { block: Block; isMarked?: boolean }[] = []
  for (const segment of fences(text)) {
    if (segment.kind === 'code') {
      parts.push({ block: segment })
      continue
    }
    for (const block of splitTables(segment.text)) {
      if (block.kind !== 'markdown') {
        parts.push({ block })
        continue
      }
      for (const paragraph of paragraphs(block.text)) {
        for (const piece of lineBlocks(paragraph)) {
          if (piece.kind !== 'markdown') parts.push({ block: piece })
          else if ((wants(piece.text) || hasTask(piece.text)) && isSimple(piece.text)) parts.push({ block: { kind: 'prose', text: piece.text } })
          else parts.push({ block: piece, isMarked: isMarked(piece.text) })
        }
      }
    }
  }
  const isOwn = parts.some(part => part.block.kind !== 'markdown')
  const out: Block[] = []
  for (const { block, isMarked: adopt } of parts) {
    const last = out.at(-1)
    if (block.kind !== 'markdown') out.push(block)
    else if (isOwn && adopt) out.push({ kind: 'prose', text: block.text })
    else if (last?.kind === 'markdown') last.text += `\n\n${block.text}`
    else out.push({ ...block })
  }
  return out
}

// A body cell holding only a status word draws as a tag, two cells wider than its word.
// A header is drawn in capitals, which would spoil a link's address, so only body cells carry links.
const cellWidth = (cell: string, isHead: boolean, look?: Inline) => shownWidth(cell, isHead ? undefined : look) + (!isHead && statusHue(plain(cell)) ? STATUS_EXTRA : 0)

const widths = (table: Table, look?: Inline) => table.head.map((cell, column) => Math.max(cellWidth(cell, true), ...table.rows.map(row => cellWidth(row[column] ?? '', false, look))))

export const tableWidth = (table: Table, look?: Inline) => widths(table, look).reduce((sum, width) => sum + width, 0) + GAP * Math.max(0, table.head.length - 1)

// One cell's text with its inline marks, hex pills and status tag, padded to its column on the side its numbers align to.
function cellText(elements: Elements, cell: string, width: number, isRight: boolean, color: string, isBold: boolean, isHead: boolean, look: Inline, key: string) {
  const { Text } = elements
  const room = ' '.repeat(Math.max(0, width - cellWidth(cell, isHead, look)))
  const hue = isHead ? undefined : statusHue(plain(cell))
  return (
    <Text key={key} color={tinted(look.paint, color, 'table')} bold={isBold}>
      {isRight ? room : ''}
      {hue ? squareTag(elements, plain(cell).trim(), hue, THEME.bg, `${key}-tag`, look.paint, 'table') : inline(elements, cell, isHead ? { ...look, links: undefined } : look, key)}
      {isRight ? '' : room}
    </Text>
  )
}

export function tableBlock(elements: Elements, table: Table, look: Inline, key: string) {
  const { Box, Text } = elements
  const sizes = widths(table, look)
  const { paint } = look
  // A hovered copy choice washes the table and brightens its hairlines and bars one step.
  const wash = paint?.wash('table')
  const lines = paint ? paint.rule('table') : THEME.border
  const line = (cellsOf: string[], at: number, isHead: boolean) => (
    <Text key={`${key}-row-${at}`} backgroundColor={wash}>
      {sizes.map((width, column) => [
        column ? <Text key={`${key}-bar-${at}-${column}`} color={lines}>{` ${MARK.rail} `}</Text> : '',
        cellText(elements, isHead ? (cellsOf[column] ?? '').toUpperCase() : (cellsOf[column] ?? ''), width, table.right[column] === true, isHead ? style.colors.pills.readout : THEME.onSurface, !isHead && column === 0, isHead, look, `${key}-cell-${at}-${column}`),
      ])}
    </Text>
  )
  // The hairline crosses each column bar, so the lines join instead of stopping short of it.
  const rule = (at: number) => <Text key={`${key}-rule-${at}`} color={lines} backgroundColor={wash}>{sizes.map(width => MARK.rule.repeat(width)).join(`${MARK.rule}┼${MARK.rule}`)}</Text>
  return (
    <Box key={key} flexDirection="column">
      {line(table.head, -1, true)}
      {table.rows.flatMap((row, at) => [rule(at), line(row, at, false)])}
    </Box>
  )
}

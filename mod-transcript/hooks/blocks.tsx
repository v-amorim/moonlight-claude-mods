// mod-transcript / hooks/blocks.tsx, by v-amorim
// The reply blocks the mod draws itself: code and diff cards, headings on a rule, callout cards, status tags.
import type { RenderElement } from 'claude-code'

import { cellOf } from './cells'
import { chunkPieces, diffLanguage, highlight, type Piece } from './hilite'
import type { Paint, Part } from './mark'
import { inline, noteMark, tinted, type Inline } from './prose'
import text from './text'
import { MARK, mix, THEME } from './theme'
import style from './style'

type Elements = { Box: (props: any) => RenderElement; Text: (props: any) => RenderElement }

// Rounded card corners; style.ts is a shared copy and has none, so they live here.
export const CORNER = { topLeft: '╭', topRight: '╮', bottomLeft: '╰', bottomRight: '╯' }

// A code block taller than this shows its last rows and an expand control (my call: about a screen's third).
export const CODE_CAP = 12

const DIFF_LANG = /^(diff|patch)$/i

export type Fence = { lang: string; code: string }

// What the card needs from the reply row: the copy pill and the expand control are Clients, which only it can draw.
export type CardParts = {
  copy: (code: string) => unknown
  more: (isOpen: boolean, hidden: number, bg: string) => unknown
  isOpen: boolean
  paint?: Paint
}

// A line cut into rows of at most `room` cells; an empty line is one empty row.
export function chunks(line: string, room: number) {
  const rows: string[] = []
  let row = ''
  let used = 0
  for (const char of line.replace(/\t/g, '  ')) {
    if (used + cellOf(char) > room && row) {
      rows.push(row)
      row = ''
      used = 0
    }
    row += char
    used += cellOf(char)
  }
  return [...rows, row]
}

// A diff line's kind: the added and removed lines carry their mark in the gutter, headers and hunks sit dim.
function diffKind(line: string) {
  if (/^(\+\+\+|---|@@|diff |index )/.test(line)) return 'head'
  if (line.startsWith('+')) return 'add'
  if (line.startsWith('-')) return 'del'
  return 'same'
}

export const WASH_ADD = mix(THEME.surface1, THEME.good, 0.16)
export const WASH_DEL = mix(THEME.surface1, THEME.alert, 0.22)

export function codeCard({ Box, Text }: Elements, fence: Fence, parts: CardParts, width: number, key: string) {
  const isDiff = DIFF_LANG.test(fence.lang)
  const lines = fence.code.replace(/\n+$/, '').split('\n')
  const isCapped = lines.length > CODE_CAP
  const shown = isCapped && !parts.isOpen ? lines.slice(-CODE_CAP) : lines
  const first = lines.length - shown.length
  const digits = String(lines.length).length
  const gutter = isDiff ? 2 : digits + 3
  const room = Math.max(1, width - 4 - gutter)
  const tag = isDiff ? text.diffTag : fence.lang.toUpperCase()
  const { paint } = parts
  // A hovered copy choice dims the card or washes its fill; the diff rows keep their own tints while marked.
  const c = (color: string) => tinted(paint, color, 'code')!
  const fillOf = (base: string, isPlain: boolean) => (!paint ? base : paint.on('code') ? (isPlain ? paint.fill(base, 'code') : base) : paint.fill(base, 'code'))
  const edge = (side: string, body: unknown, id: string) => (
    <Box key={`${key}-${id}`} flexDirection="row">
      <Text color={c(THEME.border)}>{MARK.rail}</Text>
      <Box key={`${key}-${id}-in`} width={width - 2} backgroundColor={side} paddingX={1} flexDirection="row">{body}</Box>
      <Text color={c(THEME.border)}>{MARK.rail}</Text>
    </Box>
  )
  const bodyOf = (line: string) => {
    const kind = isDiff ? diffKind(line) : 'same'
    return { kind, body: isDiff && (kind === 'add' || kind === 'del') ? line.slice(1) : line }
  }
  // The whole block is tokenized, so a comment opened above the rows shown still colors them; a diff header line is left out of the code.
  const colors = highlight(isDiff ? diffLanguage(fence.code) : fence.lang, lines.map(line => (bodyOf(line).kind === 'head' ? '' : bodyOf(line).body)).join('\n'))
  const rows = shown.flatMap((line, at) => {
    const { kind, body } = bodyOf(line)
    const bg = fillOf(kind === 'add' ? WASH_ADD : kind === 'del' ? WASH_DEL : THEME.surface1, kind !== 'add' && kind !== 'del')
    const mark = kind === 'add' ? { char: '+', color: c(THEME.good) } : kind === 'del' ? { char: '−', color: c(THEME.alert) } : { char: ' ', color: c(style.colors.pills.readout) }
    const pieces = kind === 'head' ? undefined : colors?.[first + at]
    const wrapped: (string | Piece[])[] = pieces ? chunkPieces(pieces, room) : chunks(body, room)
    return wrapped.map((chunk, part) => (
      edge(
        bg,
        <Text key={`${key}-text-${at}-${part}`} wrap="truncate-end">
          {isDiff ? <Text color={mark.color}>{`${part ? ' ' : mark.char} `}</Text> : <Text color={c(style.colors.pills.readout)}>{part ? ' '.repeat(digits) : String(first + at + 1).padStart(digits)}</Text>}
          {isDiff ? null : <Text color={c(THEME.border)}>{` ${MARK.rail} `}</Text>}
          {typeof chunk === 'string' ? (
            <Text color={c(kind === 'head' ? style.colors.pills.readout : THEME.onSurface)}>{chunk || ' '}</Text>
          ) : chunk.length ? (
            chunk.map((piece, index) => <Text key={`${key}-piece-${at}-${part}-${index}`} color={tinted(paint, piece.color, 'code')} bold={piece.bold} italic={piece.italic} underline={piece.underline}>{piece.text}</Text>)
          ) : (
            <Text color={c(THEME.onSurface)}> </Text>
          )}
        </Text>,
        `row-${at}-${part}`,
      )
    ))
  })
  const run = Math.max(1, width)
  return (
    <Box key={key} flexDirection="column">
      <Box key={`${key}-top`} flexDirection="row" height={1}>
        {/* The run after it is drawn longer than the card, so the tag must not shrink or it loses its last letter. */}
        <Box key={`${key}-tag`} flexShrink={0}>
          <Text>
            <Text color={c(THEME.border)}>{`${CORNER.topLeft}${MARK.rule}`}</Text>
            <Text color={c(style.colors.pills.readout)}>{tag ? ` ${tag} ` : ''}</Text>
          </Text>
        </Box>
        {/* Clipped by the box, not truncated, so the run never ends in an ellipsis. */}
        <Box key={`${key}-run`} flexGrow={1} flexShrink={1} height={1} overflow="hidden">
          <Text color={c(THEME.border)}>{MARK.rule.repeat(run)}</Text>
        </Box>
        <Text color={c(THEME.border)}>{' '}</Text>
        <Box key={`${key}-copy`} flexShrink={0}>{parts.copy(fence.code) as never}</Box>
        <Text color={c(THEME.border)}>{` ${MARK.rule}${CORNER.topRight}`}</Text>
      </Box>
      {rows}
      {isCapped ? edge(fillOf(THEME.surface1, true),[<Box key={`${key}-gap`} flexGrow={1} />, <Box key={`${key}-more`} flexShrink={0}>{parts.more(parts.isOpen, lines.length - CODE_CAP, fillOf(THEME.surface1, true)) as never}</Box>], 'more') : null}
      <Text key={`${key}-bottom`} color={c(THEME.border)}>{`${CORNER.bottomLeft}${MARK.rule.repeat(Math.max(0, width - 2))}${CORNER.bottomRight}`}</Text>
    </Box>
  )
}

// Heading text in capitals, but a code span keeps its case.
const upper = (heading: string) => heading.replace(/(`[^`]*`)|[^`]+/g, (part, code) => (code ? part : part.toUpperCase()))

// `#`, `##` and `###` alike: dim caps, then a hairline to the reply's width.
export function headingRow({ Box, Text }: Elements, heading: string, look: Inline, width: number, key: string) {
  const title = upper(heading)
  return (
    <Box key={key} flexDirection="row" height={1}>
      <Box key={`${key}-title`} flexShrink={0}>
        <Text color={tinted(look.paint, style.colors.pills.readout, 'text')} backgroundColor={look.paint?.wash('text')}>{inline({ Text }, title, look, key)}</Text>
      </Box>
      <Box key={`${key}-rule`} flexGrow={1} flexShrink={1} height={1} overflow="hidden">
        <Text color={tinted(look.paint, THEME.border, 'text')}>{` ${MARK.rule.repeat(Math.max(1, width))}`}</Text>
      </Box>
    </Box>
  )
}

// A thematic break: a hairline in the border color across the reply.
export function ruleRow({ Box, Text }: Elements, look: Inline, width: number, key: string) {
  return (
    <Box key={key} height={1} overflow="hidden">
      <Text color={tinted(look.paint, THEME.border, 'text')}>{MARK.rule.repeat(Math.max(1, width))}</Text>
    </Box>
  )
}

// The width of the short hairline above a reply's footnotes.
const NOTES_RULE = 16

// Footnotes under a short hairline: the mark in accent, the note muted.
export function footnoteRows({ Box, Text }: Elements, notes: { mark: string; text: string }[], look: Inline, key: string) {
  return (
    <Box key={key} flexDirection="column">
      <Text key={`${key}-rule`} color={tinted(look.paint, THEME.border, 'text')}>{MARK.rule.repeat(NOTES_RULE)}</Text>
      {notes.map((note, n) => (
        <Text key={`${key}-${n}`}>
          <Text color={tinted(look.paint, THEME.accent, 'text')}>{`${noteMark(note.mark)} `}</Text>
          <Text color={tinted(look.paint, THEME.muted, 'text')}>{inline({ Text }, note.text, look, `${key}-${n}-text`)}</Text>
        </Text>
      ))}
    </Box>
  )
}

// A <details> section as a round card: one line closed, the body inside the card when open. `toggle` is the summary's Client, which flips it.
export function detailsCard({ Box, Text }: Elements, body: string, isOpen: boolean, toggle: unknown, look: Inline, width: number, key: string) {
  const border = tinted(look.paint, THEME.border, 'text')
  const [start, end] = isOpen ? [CORNER.topLeft, CORNER.topRight] : ['╶', '╴']
  return (
    <Box key={key} flexDirection="column">
      <Box key={`${key}-top`} flexDirection="row" height={1}>
        <Text color={border}>{`${start}${MARK.rule} `}</Text>
        <Box key={`${key}-toggle`} flexShrink={0}>{toggle as never}</Box>
        <Box key={`${key}-run`} flexGrow={1} flexShrink={1} height={1} overflow="hidden">
          <Text color={border}>{` ${MARK.rule.repeat(Math.max(1, width))}`}</Text>
        </Box>
        <Text color={border}>{end}</Text>
      </Box>
      {isOpen ? body.split('\n').map((line, n) => (
        <Box key={`${key}-row-${n}`} flexDirection="row">
          <Text color={border}>{MARK.rail}</Text>
          <Box key={`${key}-row-${n}-in`} width={width - 2} paddingX={1}>
            <Text color={tinted(look.paint, THEME.onSurface, 'text')}>{line.trim() ? inline({ Text }, line, look, `${key}-row-${n}-text`) : ' '}</Text>
          </Box>
          <Text color={border}>{MARK.rail}</Text>
        </Box>
      )) : null}
      {isOpen ? <Text key={`${key}-bottom`} color={border}>{`${CORNER.bottomLeft}${MARK.rule.repeat(Math.max(0, width - 2))}${CORNER.bottomRight}`}</Text> : null}
    </Box>
  )
}

export type Callout = { tone: 'note' | 'warning'; label: string; detail: string }

const CALLOUT_KINDS: Record<string, Callout['tone']> = { note: 'note', tip: 'note', important: 'note', warning: 'warning', caution: 'warning' }

// `> **Note:** text` or `> [!NOTE]` with the text after it or on the lines below; null for a plain quote.
export function calloutOf(lines: string[]): Callout | null {
  const first = /^\s*>\s*(?:\*\*(note|tip|important|warning|caution):?\*\*:?|\[!(note|tip|important|warning|caution)\])\s*(.*)$/i.exec(lines[0] ?? '')
  if (!first) return null
  const kind = (first[1] ?? first[2])!.toLowerCase()
  const detail = [first[3]!, ...lines.slice(1).map(line => line.replace(/^\s*>\s?/, ''))].map(line => line.trim()).filter(Boolean).join(' ')
  return { tone: CALLOUT_KINDS[kind]!, label: kind, detail }
}

// A square tag tinted at 15% of its hue over the fill it sits on.
export const squareTag = ({ Text }: Pick<Elements, 'Text'>, label: string, hue: string, under: string, key: string, paint?: Paint, part: Part = 'text') => (
  <Text key={key} color={tinted(paint, hue, part)} backgroundColor={mix(tinted(paint, under, part)!, tinted(paint, hue, part)!, 0.15)}>{` ${label} `}</Text>
)

export function calloutCard({ Box, Text }: Elements, callout: Callout, look: Inline, width: number, key: string) {
  const hue = callout.tone === 'warning' ? THEME.alert : THEME.accent
  const { paint } = look
  const fill = paint ? paint.fill(THEME.surface1, 'text') : THEME.surface1
  return (
    <Box key={key} borderStyle="round" borderColor={tinted(paint, callout.tone === 'warning' ? mix(THEME.bg, THEME.alert, 0.33) : THEME.border, 'text')} backgroundColor={fill} paddingX={1} width={width} flexDirection="row" columnGap={1}>
      <Box key={`${key}-tag`} flexShrink={0}>{squareTag({ Text }, text.calloutMark[callout.tone], hue, THEME.surface1, `${key}-tag-text`, paint)}</Box>
      <Box key={`${key}-body`} flexShrink={1} flexGrow={1}>
        <Text wrap="wrap">
          <Text bold color={tinted(paint, THEME.onSurface, 'text')}>{text.calloutTitle[callout.label as keyof typeof text.calloutTitle]}</Text>
          {callout.detail ? <Text color={tinted(paint, THEME.muted, 'text')}>{[' ', ...inline({ Text }, callout.detail, look, `${key}-detail`)]}</Text> : null}
        </Text>
      </Box>
    </Box>
  )
}

const STATUS: [RegExp, string][] = [
  [/^(pass|ok|done|success)$/i, THEME.good],
  [/^(fail|failed|error)$/i, THEME.alert],
  [/^(warn|warning|skipped)$/i, THEME.warn],
]

// The hue of a table cell whose whole text is a status word; undefined for any other cell.
export const statusHue = (word: string) => STATUS.find(([pattern]) => pattern.test(word.trim()))?.[1]

export const STATUS_EXTRA = 2

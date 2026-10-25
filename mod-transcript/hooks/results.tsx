// mod-transcript / hooks/results.tsx, by v-amorim: a file tool's open result as the diff card, Read as plain numbered code.
import type { RenderElement } from 'claude-code'

import { cells, cut } from './cells'
import { chunks, CODE_CAP, CORNER, WASH_ADD, WASH_DEL } from './blocks'
import { chunkPieces, languageForPath, previewPieces, type Piece } from './hilite'
import { linkPill } from './prose'
import style from './style'
import text from './text'
import { MARK, THEME } from './theme'

type Elements = { Box: (props: any) => RenderElement; Text: (props: any) => RenderElement }

export type ResultRow = { kind: 'add' | 'del' | 'same'; n: number; text: string; hunk: number }

// What the card draws: the file, its rows (a hunk gap is a row of the gap kind), the new line the link opens and the text the copy pill takes.
export type FileResult = { path: string; rows: (ResultRow | { kind: 'gap' })[]; line: number; copy: string }

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const linesOf = (content: string) => content.replace(/\n+$/, '').split('\n')

type Hunk = { oldStart: number; newStart: number; lines: string[] }

function hunksOf(patch: unknown): Hunk[] | null {
  if (!Array.isArray(patch)) return null
  const hunks: Hunk[] = []
  for (const hunk of patch) {
    if (!isObject(hunk) || typeof hunk.oldStart !== 'number' || typeof hunk.newStart !== 'number' || !Array.isArray(hunk.lines) || !hunk.lines.every(line => typeof line === 'string')) return null
    hunks.push({ oldStart: hunk.oldStart, newStart: hunk.newStart, lines: hunk.lines as string[] })
  }
  return hunks
}

// The card's data from a tool's own result record; null for any shape this does not know, so Claude Code draws it.
export function fileResult(tool: string, output: unknown): FileResult | null {
  if (!isObject(output)) return null
  if (tool === 'Read') {
    const file = output.file
    if (output.type !== 'text' || !isObject(file) || typeof file.filePath !== 'string' || typeof file.content !== 'string' || !file.content.trim()) return null
    const start = typeof file.startLine === 'number' ? file.startLine : 1
    const rows = linesOf(file.content).map((line, at): ResultRow => ({ kind: 'same', n: start + at, text: line, hunk: 0 }))
    return { path: file.filePath, rows, line: start, copy: linesOf(file.content).join('\n') }
  }
  if (tool !== 'Edit' && tool !== 'MultiEdit' && tool !== 'Write') return null
  if (typeof output.filePath !== 'string' || output.staged === true) return null
  if (tool === 'Write' && output.type === 'create') {
    if (typeof output.content !== 'string' || !output.content) return null
    const rows = linesOf(output.content).map((line, at): ResultRow => ({ kind: 'add', n: at + 1, text: line, hunk: 0 }))
    return { path: output.filePath, rows, line: 1, copy: linesOf(output.content).join('\n') }
  }
  const hunks = hunksOf(output.structuredPatch)
  if (!hunks?.length) return null
  const rows: FileResult['rows'] = []
  let line = 0
  hunks.forEach((hunk, at) => {
    if (at) rows.push({ kind: 'gap' })
    let old = hunk.oldStart
    let now = hunk.newStart
    for (const raw of hunk.lines) {
      const mark = raw[0]
      if (mark === '+') rows.push({ kind: 'add', n: now, text: raw.slice(1), hunk: at })
      else if (mark === '-') rows.push({ kind: 'del', n: old, text: raw.slice(1), hunk: at })
      else if (mark === ' ') rows.push({ kind: 'same', n: now, text: raw.slice(1), hunk: at })
      else continue
      if (!line && mark !== ' ') line = now
      if (mark !== '+') old++
      if (mark !== '-') now++
    }
  })
  if (!rows.some(row => row.kind === 'add' || row.kind === 'del')) return null
  const copy = hunks.map(hunk => hunk.lines.filter(raw => raw[0] === '+' || raw[0] === ' ').map(raw => raw.slice(1)).join('\n')).join('\n')
  return { path: output.filePath, rows, line: line || hunks[0]!.newStart, copy }
}

// What the card needs from the row: the copy pill and the expand control are Clients, which only the row can draw.
export type ResultParts = {
  copy: (code: string) => unknown
  more: (isOpen: boolean, hidden: number, bg: string) => unknown
  isOpen: boolean
  Link: (props: any) => RenderElement
  nerd: boolean
  href: string
  label: string
}

const COPY_PILL = 10

export function resultCard({ Box, Text }: Elements, result: FileResult, parts: ResultParts, width: number, key: string) {
  const dim = style.colors.pills.readout
  const rows = result.rows
  const isCapped = rows.length > CODE_CAP
  const shown = isCapped && !parts.isOpen ? rows.slice(0, CODE_CAP) : rows
  const digits = String(Math.max(...rows.map(row => ('n' in row ? row.n : 0)))).length
  const room = Math.max(1, width - 4 - (digits + 5))
  const language = languageForPath(result.path)
  const ext = /\.([^.\\/]+)$/.exec(result.path)?.[1]
  const tag = ext ? ext.toUpperCase() : text.resultNoExt
  // A diff's two sides are tokenized apart inside each hunk, so a removed quote recolours no other line.
  const colored = new Map<ResultRow, Piece[]>()
  const byHunk = new Map<number, ResultRow[]>()
  for (const row of rows) if (row.kind !== 'gap') byHunk.set(row.hunk, [...(byHunk.get(row.hunk) ?? []), row])
  for (const group of byHunk.values()) previewPieces(language, group.map(row => ({ kind: row.kind, text: row.text })), false)?.forEach((each, at) => each && colored.set(group[at]!, each.code))
  const edge = (side: string, body: unknown, id: string) => (
    <Box key={`${key}-${id}`} flexDirection="row">
      <Text color={THEME.border}>{MARK.rail}</Text>
      <Box key={`${key}-${id}-in`} width={width - 2} backgroundColor={side} paddingX={1} flexDirection="row">{body}</Box>
      <Text color={THEME.border}>{MARK.rail}</Text>
    </Box>
  )
  const lines = shown.flatMap((row, at) => {
    if (row.kind === 'gap') return [edge(THEME.surface1, <Text key={`${key}-gap-${at}`} color={dim}>{style.statuslineMarks.menu.padStart(digits)}</Text>, `row-${at}`)]
    const bg = row.kind === 'add' ? WASH_ADD : row.kind === 'del' ? WASH_DEL : THEME.surface1
    const mark = row.kind === 'add' ? { char: '+', color: THEME.good } : row.kind === 'del' ? { char: '−', color: THEME.alert } : { char: ' ', color: dim }
    const pieces = colored.get(row)
    const wrapped: (string | Piece[])[] = pieces ? chunkPieces(pieces, room) : chunks(row.text, room)
    return wrapped.map((chunk, part) =>
      edge(
        bg,
        <Text key={`${key}-text-${at}-${part}`} wrap="truncate-end">
          <Text color={dim}>{part ? ' '.repeat(digits) : String(row.n).padStart(digits)}</Text>
          <Text color={mark.color}>{` ${part ? ' ' : mark.char} `}</Text>
          <Text color={THEME.border}>{`${MARK.rail} `}</Text>
          {typeof chunk === 'string' ? (
            <Text color={THEME.onSurface}>{chunk || ' '}</Text>
          ) : chunk.length ? (
            chunk.map((piece, index) => <Text key={`${key}-piece-${at}-${part}-${index}`} color={piece.color} bold={piece.bold} italic={piece.italic} underline={piece.underline}>{piece.text}</Text>)
          ) : (
            <Text color={THEME.onSurface}> </Text>
          )}
        </Text>,
        `row-${at}-${part}`,
      ),
    )
  })
  // The edge's room: the corners, the tag and its dot, the copy pill and the gaps around; the file takes what is left.
  const extra = parts.nerd ? 4 : 2
  const label = cut(parts.label, Math.max(8, width - 8 - cells(tag) - 3 - COPY_PILL - extra))
  const bottom = `${CORNER.bottomLeft}${MARK.rule.repeat(Math.max(0, width - 2))}${CORNER.bottomRight}`
  return (
    <Box key={key} flexDirection="column">
      <Box key={`${key}-top`} flexDirection="row" height={1}>
        <Box key={`${key}-tag`} flexShrink={0}>
          <Text>
            <Text color={THEME.border}>{`${CORNER.topLeft}${MARK.rule}`}</Text>
            <Text color={dim}>{` ${tag} `}</Text>
            <Text color={style.colors.pills.separator}>{`${MARK.sep} `}</Text>
          </Text>
        </Box>
        <Box key={`${key}-file`} flexShrink={0}>
          {linkPill({ Text }, { Link: parts.Link, open: () => undefined }, parts.href, label, 'path', parts.nerd, `${key}-link`)}
        </Box>
        <Box key={`${key}-run`} flexGrow={1} flexShrink={1} height={1} overflow="hidden">
          <Text color={THEME.border}>{` ${MARK.rule.repeat(Math.max(1, width))}`}</Text>
        </Box>
        <Text color={THEME.border}>{' '}</Text>
        <Box key={`${key}-copy`} flexShrink={0}>{parts.copy(result.copy) as never}</Box>
        <Text color={THEME.border}>{` ${MARK.rule}${CORNER.topRight}`}</Text>
      </Box>
      {lines}
      {isCapped ? edge(THEME.surface1, [<Box key={`${key}-gap`} flexGrow={1} />, <Box key={`${key}-more`} flexShrink={0}>{parts.more(parts.isOpen, rows.length - CODE_CAP, THEME.surface1) as never}</Box>], 'more') : null}
      <Text key={`${key}-bottom`} color={THEME.border}>{bottom}</Text>
    </Box>
  )
}

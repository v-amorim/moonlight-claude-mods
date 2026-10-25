// mod-transcript / hooks/hilite.ts, by v-amorim: code as colored pieces, each token styled by the active VS Code theme, or by the mod's own palette when none resolved.
import { cellOf, cells } from './cells'
import { languageOf, languageOfPath, tokenizeCode } from './grammar'
import { SYNTAX, THEME } from './theme'
import { buildTheme, styleFor, type Theme } from './vstheme'

export type Piece = { text: string; color: string; bold?: boolean; italic?: boolean; underline?: boolean }

const own = (color: string, extra: object = {}) => ({ settings: { foreground: color, ...extra } })

// The mod's palette as a theme: shell roles for code, the surface colors for the rest.
const PALETTE = buildTheme(
  {
    colors: { 'editor.foreground': THEME.onSurface },
    tokenColors: [
      { scope: ['punctuation', 'meta.brace'], ...own(SYNTAX.operator) },
      { scope: ['keyword', 'storage', 'entity.name.tag', 'entity.name.command', 'support.function.builtin'], ...own(SYNTAX.command) },
      { scope: ['keyword.operator', 'keyword.other.unit'], ...own(SYNTAX.operator) },
      { scope: ['string', 'markup.inline.raw'], ...own(SYNTAX.text) },
      { scope: ['constant.numeric'], ...own(SYNTAX.number) },
      { scope: ['constant', 'variable.language', 'entity.other.attribute-name', 'constant.other.option'], ...own(SYNTAX.option) },
      { scope: ['entity.name.function', 'support.function', 'support.type.property-name', 'variable.other.property', 'variable.other.normal', 'variable.other.member'], ...own(SYNTAX.variable) },
      { scope: ['entity.name.type', 'entity.name.class', 'support.type', 'support.class', 'entity.name.section', 'entity.other.inherited-class'], ...own(THEME.secondary) },
      { scope: ['comment'], ...own(THEME.muted, { fontStyle: 'italic' }) },
      { scope: ['markup.inserted', 'meta.diff.header.to-file'], ...own(THEME.good) },
      { scope: ['markup.deleted', 'meta.diff.header.from-file'], ...own(THEME.alert) },
      { scope: ['markup.bold'], settings: { fontStyle: 'bold' } },
      { scope: ['markup.italic'], settings: { fontStyle: 'italic' } },
    ],
  },
  'palette',
  '',
)

let theme: Theme = PALETTE
const cache = new Map<string, Piece[][]>()

// Whatever the person's setting resolved to; null puts the mod's palette back.
export function useTheme(next: Theme | null) {
  theme = next ?? PALETTE
  cache.clear()
}

export const themeInUse = () => theme

// Past this a block draws plain: tokenizing costs time on every new reply (my call: far above any reply's code).
const MAX_CHARS = 60_000
const CACHE_SIZE = 200

// `code` as lines of colored pieces, tokenized once per language and text; undefined when the language is unknown, so the caller keeps its own color.
export function highlight(language: string | undefined, code: string): Piece[][] | undefined {
  const name = language ? languageOf(language) : undefined
  if (!name || code.length > MAX_CHARS) return undefined
  const key = `${name}\0${code}`
  const known = cache.get(key)
  if (known) return known
  const lines = (tokenizeCode(name, code) ?? []).map(tokens =>
    tokens.reduce<Piece[]>((pieces, token) => {
      const style = styleFor(theme, [...token.scopes])
      const piece: Piece = { text: token.text, color: style.color ?? THEME.onSurface, ...(style.bold ? { bold: true } : {}), ...(style.italic ? { italic: true } : {}), ...(style.underline ? { underline: true } : {}) }
      const last = pieces[pieces.length - 1]
      if (last && last.color === piece.color && last.bold === piece.bold && last.italic === piece.italic && last.underline === piece.underline) last.text += piece.text
      else pieces.push(piece)
      return pieces
    }, []),
  )
  if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value!)
  cache.set(key, lines)
  return lines
}

// The grammar a diff names in its file header (`+++ b/src/a.ts`, `diff --git a/x.py b/x.py`), by the file's extension.
export function diffLanguage(diff: string) {
  const path = /^\+\+\+ (?:b\/)?(\S+)/m.exec(diff)?.[1] ?? /^--- (?:a\/)?(\S+)/m.exec(diff)?.[1] ?? /^diff --git a\/(\S+)/m.exec(diff)?.[1]
  return path ? languageOfPath(path) : undefined
}

export const languageForPath = languageOfPath

export type PreviewLine = { kind: string; text: string }

// A Read result's line: its number and arrow or tab, then the file's own line.
const NUMBERED = /^(\s*\d+[→\t])(.*)$/

const MARKS: Record<string, string> = { add: '+ ', del: '- ', same: '  ' }

// Each preview line as its lead (diff mark or Read line number) and colored code; a diff's new and old sides are two files, so a removed quote colors nothing around it.
export function previewPieces(language: string | undefined, lines: PreviewLine[], isRead: boolean): ({ lead: string; code: Piece[] } | undefined)[] | undefined {
  if (!language || !lines.length) return undefined
  const split = lines.map(line => {
    const numbered = isRead && line.kind === 'out' ? NUMBERED.exec(line.text) : null
    return { lead: numbered ? numbered[1]! : (MARKS[line.kind] ?? ''), code: numbered ? numbered[2]! : line.text, isCode: !isRead || line.kind !== 'out' || Boolean(numbered), kind: line.kind }
  })
  const color = (picked: number[]) => {
    const colored = highlight(language, picked.map(at => split[at]!.code).join('\n'))
    return new Map(picked.map((at, row) => [at, colored?.[row]] as const))
  }
  const every = split.map((_, at) => at)
  const isDiff = split.some(line => line.kind === 'add' || line.kind === 'del')
  const removed = isDiff ? [...color(every.filter(at => split[at]!.kind === 'del' || split[at]!.kind === 'same'))].filter(([at]) => split[at]!.kind === 'del') : []
  const colors = isDiff ? new Map([...color(every.filter(at => split[at]!.kind !== 'del')), ...removed]) : color(every.filter(at => split[at]!.isCode))
  if (![...colors.values()].some(Boolean)) return undefined
  return split.map((line, at) => (line.isCode && colors.get(at) ? { lead: line.lead, code: colors.get(at)! } : undefined))
}

// A line cut into rows of at most `room` cells, colors kept across the cut; a tab is two spaces, an empty line one empty row.
export function chunkPieces(line: Piece[], room: number): Piece[][] {
  const rows: Piece[][] = []
  let row: Piece[] = []
  let used = 0
  for (const piece of line) {
    for (const char of piece.text.replace(/\t/g, '  ')) {
      if (used + cellOf(char) > room && row.length) {
        rows.push(row)
        row = []
        used = 0
      }
      const last = row[row.length - 1]
      if (last && last.color === piece.color && last.bold === piece.bold && last.italic === piece.italic && last.underline === piece.underline) last.text += char
      else row.push({ ...piece, text: char })
      used += cellOf(char)
    }
  }
  return [...rows, row]
}

// The pieces cut to `width` cells, the last cell an ellipsis in the color it cuts, as `cut` does for text.
export function cutPieces(line: Piece[], width: number): Piece[] {
  if (line.reduce((sum, piece) => sum + cells(piece.text), 0) <= width) return line
  const out: Piece[] = []
  let used = 0
  for (const piece of line) {
    let text = ''
    for (const char of piece.text) {
      if (used + cellOf(char) > width - 1) return [...out, ...(text ? [{ ...piece, text }] : []), { ...piece, text: '…' }]
      text += char
      used += cellOf(char)
    }
    out.push(piece)
  }
  return out
}

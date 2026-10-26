// mod-transcript / hooks/clip.ts, by v-amorim
// Extracts a reply's code, text, tables or links from its markdown for copying.
import { cells } from './cells'

export type CopyChoice = 'reply' | 'code' | 'text' | 'table' | 'links'

const FENCE = /^ *(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^ *\1[ \t]*$/gm

// The reply cut into prose and code, so inline marks are never read inside a code block.
export function pieces(markdown: string) {
  const parts: { isCode: boolean; text: string; raw: string }[] = []
  let at = 0
  for (const match of markdown.matchAll(FENCE)) {
    const before = markdown.slice(at, match.index)
    parts.push({ isCode: false, text: before, raw: before }, { isCode: true, text: match[2]!.replace(/\n$/, ''), raw: match[0] })
    at = match.index! + match[0].length
  }
  const rest = markdown.slice(at)
  return [...parts, { isCode: false, text: rest, raw: rest }]
}

export const codeOf = (markdown: string) =>
  pieces(markdown).filter(part => part.isCode && part.text).map(part => part.text).join('\n\n')

export const plainLine = (line: string) =>
  line
    .replace(/^ {0,3}#{1,6}\s+/, '')
    .replace(/^(\s*)>\s?/, '$1')
    .replace(/^(\s*)[-*+]\s+(\[[ xX]\]\s+)?/, '$1• ')
    .replace(/!?\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_, label: string, url: string) => (label && label !== url ? `${label} (${url})` : url))
    .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, '$2')
    .replace(/(?<![\w*])\*(?=\S)(.+?)(?<=\S)\*(?![\w*])/g, '$1')
    .replace(/(?<![\w_])_(?=\S)(.+?)(?<=\S)_(?![\w_])/g, '$1')
    .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1')

// The reply as plain text: headings, emphasis, inline code and link marks dropped, list items as bullets, code kept as written.
export const textOf = (markdown: string) =>
  pieces(markdown)
    .map(part => (part.isCode ? part.text : part.text.split('\n').map(plainLine).join('\n')))
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

type Align = 'left' | 'center' | 'right' | null
const RULE_CELL = /^\s*:?-{3,}:?\s*$/

// A row's cells: the outer pipes dropped, split on every pipe not escaped.
const cellsOf = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '')
    .split(/(?<!\\)\|/)
    .map(cell => cell.trim())

const alignOf = (cell: string): Align => {
  const left = cell.trim().startsWith(':')
  const right = cell.trim().endsWith(':')
  return left && right ? 'center' : right ? 'right' : left ? 'left' : null
}

// Every table in the prose: a header row, the rule under it, then the rows that carry a pipe.
function tablesOf(markdown: string) {
  const tables: { aligns: Align[]; rows: string[][]; part: number; from: number; to: number }[] = []
  for (const [index, part] of pieces(markdown).entries()) {
    if (part.isCode) continue
    const lines = part.text.split('\n')
    for (let n = 0; n + 1 < lines.length; n++) {
      const rule = cellsOf(lines[n + 1]!)
      if (!lines[n]!.includes('|') || !rule.every(cell => RULE_CELL.test(cell))) continue
      const rows = [cellsOf(lines[n]!)]
      let next = n + 2
      while (next < lines.length && lines[next]!.includes('|') && lines[next]!.trim()) rows.push(cellsOf(lines[next++]!))
      tables.push({ aligns: rule.map(alignOf), rows, part: index, from: n, to: next })
      n = next - 1
    }
  }
  return tables
}

const widthOf = (text: string) => cells(text)

// One table rebuilt as clean markdown: every column padded to one width, the rule keeping each column's alignment.
function formatTable({ aligns, rows }: { aligns: Align[]; rows: string[][] }) {
  const columns = Math.max(aligns.length, ...rows.map(row => row.length))
  const widths = Array.from({ length: columns }, (_, column) => Math.max(3, ...rows.map(row => widthOf(row[column] ?? ''))))
  const pad = (cell: string, column: number) => {
    const room = widths[column]! - widthOf(cell)
    if (aligns[column] === 'right') return ' '.repeat(room) + cell
    if (aligns[column] === 'center') return ' '.repeat(Math.floor(room / 2)) + cell + ' '.repeat(Math.ceil(room / 2))
    return cell + ' '.repeat(room)
  }
  const line = (cells: string[]) => `| ${widths.map((_, column) => pad(cells[column] ?? '', column)).join(' | ')} |`
  const rule = widths.map((width, column) => {
    const align = aligns[column] ?? null
    const dashes = '-'.repeat(width - (align === 'center' ? 2 : align ? 1 : 0))
    return align === 'center' ? `:${dashes}:` : align === 'left' ? `:${dashes}` : align === 'right' ? `${dashes}:` : dashes
  })
  return [line(rows[0]!), `| ${rule.join(' | ')} |`, ...rows.slice(1).map(line)].join('\n')
}

// Where each table sits: the piece it is in and its first line up to its last line, as the reply wrote them.
export const tableRanges = (markdown: string) => tablesOf(markdown).map(({ part, from, to }) => ({ part, from, to }))

export const tableOf = (markdown: string) => tablesOf(markdown).map(formatTable).join('\n\n')

const URL_RE = /https?:\/\/[^\s<>()[\]`"']+/g
// A path with a folder and an extension, a line number allowed: src/cart.js:1, ~/.claude/x.md, C:\repo\a.ts.
const PATH_RE = /(?:~|\.{1,2}|[A-Za-z]:)?[\\/]?(?:[\w.@-]+[\\/])+[\w@-]+(?:\.[\w-]+)+(?::\d+(?::\d+)?)?/g

// The URLs and file paths one line of prose names, where each starts and ends; a trailing stop is not part of a URL.
export function linkSpans(line: string) {
  const spans = [...line.matchAll(URL_RE)].map(match => ({ from: match.index!, to: match.index! + match[0].replace(/[.,;:!?]+$/, '').length }))
  const rest = line.replace(URL_RE, url => ' '.repeat(url.length))
  for (const match of rest.matchAll(PATH_RE)) spans.push({ from: match.index!, to: match.index! + match[0].length })
  return spans.sort((a, b) => a.from - b.from)
}

export function linksOf(markdown: string) {
  const found: string[] = []
  for (const part of pieces(markdown)) {
    if (part.isCode) continue
    const urls = [...part.text.matchAll(URL_RE)].map(match => match[0].replace(/[.,;:!?]+$/, ''))
    const paths = [...part.text.replace(URL_RE, ' ').matchAll(PATH_RE)].map(match => match[0])
    for (const link of [...urls, ...paths]) if (!found.includes(link)) found.push(link)
  }
  return found.join('\n')
}

export function copyText(reply: string, what: CopyChoice) {
  if (what === 'code') return codeOf(reply)
  if (what === 'text') return textOf(reply)
  if (what === 'table') return tableOf(reply)
  if (what === 'links') return linksOf(reply)
  return reply
}

// The choices a reply offers: text only when it differs from the markdown, the rest only when the reply holds some.
export const copyChoices = (reply: string | undefined): CopyChoice[] =>
  reply?.trim() ? (['reply', 'code', 'text', 'table', 'links'] as const).filter(what => what === 'reply' || (what === 'text' ? textOf(reply) !== reply.trim() : Boolean(copyText(reply, what)))) : []

// mod-transcript / hooks/mark.ts, by v-amorim
// Cuts a reply into the parts a copy choice copies and the parts it leaves, so the copied characters can be marked.
import { linkSpans, pieces, plainLine, tableRanges, textOf, type CopyChoice } from './clip'
import style from './style'
import { mix, THEME } from './theme'

// A leaf Claude Code draws as markdown, marked whole or not, or text the mod draws itself with some characters marked.
export type Piece = { kind: 'markdown'; text: string; isMarked?: boolean } | { kind: 'marked'; parts: { text: string; isMarked: boolean }[] }

// The Markdown leaf takes at most this many characters.
const LEAF_LIMIT = 10000

const marked = (text: string): Piece => ({ kind: 'marked', parts: [{ text, isMarked: true }] })

const paragraphsOf = (text: string) => {
  const found: string[][] = []
  let run: string[] = []
  for (const line of text.split('\n')) {
    if (line.trim()) run.push(line)
    else if (run.length) {
      found.push(run)
      run = []
    }
  }
  return run.length ? [...found, run] : found
}

// A paragraph as plain lines with each link marked; undefined when it names none.
function linkedParagraph(lines: string[]): Piece | undefined {
  const plain = lines.map(plainLine)
  if (!plain.some(line => linkSpans(line).length)) return undefined
  const parts: { text: string; isMarked: boolean }[] = []
  plain.forEach((line, n) => {
    let at = 0
    for (const span of linkSpans(line)) {
      if (span.from > at) parts.push({ text: line.slice(at, span.from), isMarked: false })
      parts.push({ text: line.slice(span.from, span.to), isMarked: true })
      at = span.to
    }
    parts.push({ text: line.slice(at) + (n < plain.length - 1 ? '\n' : ''), isMarked: false })
  })
  return { kind: 'marked', parts }
}

// The text choice marks the plain text, but each table stays markdown: as plain lines it would lose its box and change height.
function textPieces(reply: string): Piece[] | null {
  const ranges = tableRanges(reply)
  if (!ranges.length) {
    const plain = textOf(reply)
    return plain ? [marked(plain)] : null
  }
  const out: Piece[] = []
  let rest = ''
  const flush = () => {
    const plain = textOf(rest)
    if (plain) out.push(marked(plain))
    rest = ''
  }
  for (const [index, part] of pieces(reply).entries()) {
    if (part.isCode) {
      rest += `${part.raw}\n\n`
      continue
    }
    const lines = part.raw.split('\n')
    let at = 0
    for (const range of ranges.filter(each => each.part === index)) {
      rest += lines.slice(at, range.from).join('\n') + '\n'
      flush()
      out.push({ kind: 'markdown', text: lines.slice(range.from, range.to).join('\n'), isMarked: true })
      at = range.to
    }
    rest += lines.slice(at).join('\n')
  }
  flush()
  return out.length ? out : null
}

// The reply as pieces with the characters `what` copies marked; null when it marks none, so the reply draws as Claude Code draws it.
export function markPieces(reply: string, what: CopyChoice): Piece[] | null {
  // The whole reply stays drawn as markdown: its source shows fence lines the drawing hides, so it would grow under the pointer.
  if (what === 'reply') return reply.trim() && reply.length <= LEAF_LIMIT ? [{ kind: 'markdown', text: reply, isMarked: true }] : null
  if (what === 'text') return textPieces(reply)
  const out: Piece[] = []
  let rest = ''
  const flush = () => {
    const text = rest.replace(/^(?:[ \t]*\n)+/, '').trimEnd()
    if (text) out.push({ kind: 'markdown', text })
    rest = ''
  }
  const ranges = what === 'table' || what === 'links' ? tableRanges(reply) : []
  const prose = (text: string) => {
    for (const run of paragraphsOf(text)) {
      const linked = linkedParagraph(run)
      if (linked) {
        flush()
        out.push(linked)
      } else rest += run.join('\n') + '\n\n'
    }
  }
  for (const [index, part] of pieces(reply).entries()) {
    // A fence's raw ends on its closing marks, and the prose after it may be rebuilt without its leading newlines.
    if (part.isCode) {
      if (what === 'code' && part.text) {
        flush()
        out.push(marked(part.text))
      } else rest += `${part.raw}\n\n`
      continue
    }
    if (what === 'code') {
      rest += part.raw
      continue
    }
    const lines = part.raw.split('\n')
    if (what === 'table') {
      let at = 0
      for (const range of ranges.filter(each => each.part === index)) {
        rest += lines.slice(at, range.from).join('\n') + '\n'
        flush()
        // As markdown, like the whole reply: the source would lose the drawn table's box and change height.
        out.push({ kind: 'markdown', text: lines.slice(range.from, range.to).join('\n'), isMarked: true })
        at = range.to
      }
      rest += lines.slice(at).join('\n')
      continue
    }
    let at = 0
    for (const range of ranges.filter(each => each.part === index)) {
      prose(lines.slice(at, range.from).join('\n'))
      const table = lines.slice(range.from, range.to)
      // A table holding a link is marked whole as markdown: as source lines it loses its box, as with the table and text choices.
      if (table.some(line => linkSpans(plainLine(line)).length)) {
        flush()
        out.push({ kind: 'markdown', text: table.join('\n'), isMarked: true })
      } else rest += table.join('\n') + '\n\n'
      at = range.to
    }
    prose(lines.slice(at).join('\n'))
  }
  flush()
  const isMarking = out.some(piece => piece.kind === 'marked' || piece.isMarked)
  return isMarking && out.every(piece => piece.kind !== 'markdown' || piece.text.length <= LEAF_LIMIT) ? out : null
}

// The parts of a drawn reply a copy choice can mark.
export type Part = 'text' | 'code' | 'table' | 'link'

// How a hovered choice paints the reply the mod draws itself: what it copies keeps its colours on an accent wash, every other part dims.
export type Paint = {
  on: (part: Part) => boolean
  color: (color: string | undefined, part: Part) => string | undefined
  wash: (part: Part) => string | undefined
  fill: (base: string, part: Part) => string
  rule: (part: Part) => string
}

const WASH = mix(THEME.bg, THEME.accent, 0.15)

export function paintOf(what: CopyChoice): Paint {
  const on = (part: Part) => what === 'reply' || what === 'text' || what === part || (what === 'links' && part === 'link')
  return {
    on,
    // A part with no colour of its own draws in the text colour once it dims.
    color: (color, part) => (on(part) ? color : mix(color ?? THEME.onSurface, THEME.bg, 0.55)),
    wash: part => (on(part) ? WASH : undefined),
    fill: (base, part) => (on(part) ? mix(base, THEME.accent, 0.15) : mix(base, THEME.bg, 0.4)),
    rule: part => (on(part) ? style.colors.pills.separator : mix(THEME.border, THEME.bg, 0.55)),
  }
}

// mod-transcript / hooks/prose.tsx, by v-amorim
// Reply text the mod draws itself, so a hex color shows as its pill where it is written.
import type { RenderElement } from 'claude-code'

import { cells } from './cells'
import { isPathLike, isWebUrl, scan, type Found, type Links } from './links'
import type { Paint, Part } from './mark'
import { HEX, isHexCode, type HexColor } from './rows'
import { CAPS, MARK, THEME } from './theme'

type Elements = { Box: (props: any) => RenderElement; Text: (props: any) => RenderElement }
export type Colors = Map<string, HexColor>
export type Inline = { colors: Colors; nerd: boolean; links?: Links; paint?: Paint }

// A colour, dimmed when a hovered copy choice leaves its part; as it is at rest.
export const tinted = (paint: Paint | undefined, color: string | undefined, part: Part) => (paint ? paint.color(color, part) : color)

// The pill the strip under a reply draws, so a color reads the same inline and in the strip.
export const CHIP_EXTRA = 4

export function hexChip({ Text }: Pick<Elements, 'Text'>, color: HexColor, nerd: boolean, key: string, paint?: Paint) {
  const fill = tinted(paint, THEME.surface2, 'text')
  return (
    <Text key={key}>
      {nerd ? <Text color={fill}>{CAPS.left}</Text> : null}
      <Text backgroundColor={fill}>
        {nerd ? '' : ' '}
        <Text color={tinted(paint, color.rgb, 'text')}>{MARK.stopOpen}</Text>
        <Text color={tinted(paint, THEME.muted, 'text')}>{` ${color.code}`}</Text>
        {nerd ? '' : ' '}
      </Text>
      {nerd ? <Text color={fill}>{CAPS.right}</Text> : null}
    </Text>
  )
}

const colorOf = (colors: Colors, code: string) => colors.get(code.toUpperCase())

// Text with every hex color it holds as a pill.
function withChips(elements: Pick<Elements, 'Text'>, text: string, look: Inline, key: string, tint?: string): unknown[] {
  const { Text } = elements
  const out: unknown[] = []
  let last = 0
  for (const found of text.matchAll(HEX)) {
    const color = colorOf(look.colors, found[0])
    if (!color || !isHexCode(found[1]!)) continue
    if (found.index! > last) out.push(tint ? <Text key={`${key}-${last}`} color={tint}>{text.slice(last, found.index)}</Text> : text.slice(last, found.index))
    out.push(hexChip(elements, color, look.nerd, `${key}-hex-${found.index}`, look.paint))
    last = found.index! + found[0].length
  }
  if (last < text.length) out.push(tint ? <Text key={`${key}-${last}`} color={tint}>{text.slice(last)}</Text> : text.slice(last))
  return out
}

const hasHex = (text: string) => [...text.matchAll(HEX)].some(found => isHexCode(found[1]!))

// An inline code span: surface3 fill and primary-70 text, with the rounded caps where the font has them, else one padding cell each side.
function codePill({ Text }: Pick<Elements, 'Text'>, code: string, nerd: boolean, key: string, paint?: Paint) {
  const fill = pillFill(nerd, 'code', paint)
  if (!nerd) return <Text key={key} color={tinted(paint, THEME.ok, 'code')} backgroundColor={fill}>{` ${code} `}</Text>
  return (
    <Text key={key}>
      <Text color={fill} backgroundColor={paint?.wash('code')}>{CAPS.left}</Text>
      <Text color={tinted(paint, THEME.ok, 'code')} backgroundColor={fill}>{code}</Text>
      <Text color={fill} backgroundColor={paint?.wash('code')}>{CAPS.right}</Text>
    </Text>
  )
}

// A pill's fill, dimmed when its part is left; a marked pill's caps sit on the wash, and without the font, which has no cap to carry it, the fill takes the wash.
function pillFill(nerd: boolean, part: Part, paint?: Paint) {
  if (!paint) return THEME.surface3
  return paint.on(part) && !nerd ? paint.fill(THEME.surface3, part) : paint.color(THEME.surface3, part)
}

// The icons a link pill leads with in Nerd mode, local since style.ts is a shared copy: the VS Code mark for a path, the globe for a web link.
const LINK_ICON = { path: String.fromCodePoint(0xf0a1e), web: String.fromCodePoint(0xf0ac) }

// A clickable pill, the whole of it the link: caps on surface3 and the icon leading, or one padding cell each side without the font; the text underlined.
export function linkPill({ Text }: Pick<Elements, 'Text'>, links: Links, href: string, label: string, kind: 'path' | 'web', nerd: boolean, key: string, paint?: Paint) {
  const { Link } = links
  const fill = pillFill(nerd, 'link', paint)
  return (
    <Link key={key} href={href}>
      {nerd ? <Text color={fill} backgroundColor={paint?.wash('link')}>{CAPS.left}</Text> : null}
      <Text backgroundColor={fill}>
        {nerd ? <Text color={tinted(paint, THEME.secondary, 'link')}>{`${LINK_ICON[kind]} `}</Text> : ' '}
        <Text color={tinted(paint, THEME.secondary, 'link')} underline>{label}</Text>
        {nerd ? '' : ' '}
      </Text>
      {nerd ? <Text color={fill} backgroundColor={paint?.wash('link')}>{CAPS.right}</Text> : null}
    </Link>
  )
}

// A bare URL, or a bare path that exists, as a link pill; a path that does not exist is plain text still.
const linksIn = (text: string, links: Links): Found[] => scan(text, token => isPathLike(token) && links.open(token) !== undefined)

// Text with its links as pills and every hex color it holds as its pill.
function withLinks(elements: Pick<Elements, 'Text'>, text: string, look: Inline, key: string): unknown[] {
  if (!look.links) return withChips(elements, text, look, key)
  const out: unknown[] = []
  let last = 0
  for (const found of linksIn(text, look.links)) {
    if (found.at > last) out.push(...withChips(elements, text.slice(last, found.at), look, `${key}-${last}`))
    out.push(linkPill(elements, look.links, found.web ? found.text : look.links.open(found.text)!, found.text, found.web ? 'web' : 'path', look.nerd, `${key}-link-${found.at}`, look.paint))
    last = found.at + found.text.length
  }
  out.push(...withChips(elements, text.slice(last), look, `${key}-${last}`))
  return out
}

const MARKS = /`([^`]+)`|\*\*(.+?)\*\*|__(.+?)__|\[([^\]]+)\]\(([^)]+)\)/g

// Markdown inline marks: code as a pill (a hex code stays a hex pill, a path that exists a link), bold, a web link as a pill, every hex color as its pill.
export function inline(elements: Pick<Elements, 'Text'>, text: string, look: Inline, key: string): unknown[] {
  const { Text } = elements
  const out: unknown[] = []
  let last = 0
  for (const found of text.matchAll(MARKS)) {
    const at = found.index!
    if (at > last) out.push(...withLinks(elements, text.slice(last, at), look, `${key}-t-${at}`))
    const [, code, bold, under, label, target] = found
    const open = code !== undefined && !hasHex(code) ? look.links?.open(code) : undefined
    if (code !== undefined) out.push(...(hasHex(code) ? withChips(elements, code, look, `${key}-c-${at}`) : open ? [linkPill(elements, look.links!, open, code, 'path', look.nerd, `${key}-c-${at}`, look.paint)] : [codePill(elements, code, look.nerd, `${key}-c-${at}`, look.paint)]))
    else if (bold !== undefined || under !== undefined) out.push(<Text key={`${key}-b-${at}`} bold>{inline(elements, bold ?? under!, look, `${key}-b-${at}`)}</Text>)
    else if (look.links && isWebUrl(target!)) out.push(linkPill(elements, look.links, target!, label!, 'web', look.nerd, `${key}-l-${at}`, look.paint))
    else out.push(<Text key={`${key}-l-${at}`} color={tinted(look.paint, THEME.secondary, 'link')} underline>{label}</Text>)
    last = at + found[0].length
  }
  out.push(...withLinks(elements, text.slice(last), look, `${key}-t-end`))
  return out
}

// The cells a code pill adds around its text, with caps or with padding.
const CODE_EXTRA = 2

// The cells a link pill adds around its text: both caps and the icon with its space, or the padding cell each side.
const linkExtra = (nerd: boolean) => (nerd ? 4 : 2)

// The cells the links of a line add beyond its text; a code span that becomes a link has its code pill's cells already.
function linksWidth(text: string, look: Inline, links: Links): number {
  const each = linkExtra(look.nerd)
  let extra = 0
  let last = 0
  for (const found of text.matchAll(MARKS)) {
    extra += linksIn(text.slice(last, found.index), links).length * each
    const [, code, bold, under, , target] = found
    if (code !== undefined) extra += !hasHex(code) && links.open(code) ? each - CODE_EXTRA : 0
    else if (bold !== undefined || under !== undefined) extra += linksWidth(bold ?? under!, look, links)
    else if (isWebUrl(target!)) extra += each
    last = found.index! + found[0].length
  }
  return extra + linksIn(text.slice(last), links).length * each
}

// The cells a line takes once its marks are drawn, each code span is a pill, each link is a pill and each hex color is a pill; `look` says which links.
export function shownWidth(text: string, look?: Inline) {
  const codes = [...text.matchAll(/`([^`]*)`/g)].filter(found => !hasHex(found[1]!)).length
  const bare = text.replace(/\*\*(.+?)\*\*|__(.+?)__/g, '$1$2').replace(/`([^`]*)`/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  const chips = [...bare.matchAll(HEX)].filter(found => isHexCode(found[1]!)).length
  return cells(bare) + CHIP_EXTRA * chips + CODE_EXTRA * codes + (look?.links ? linksWidth(text, look, look.links) : 0)
}

const BULLET = /^([-*+]|\d+\.) +/
const TASK = /^\[([ xX])\] +/
// Task boxes: Nerd checkbox glyphs, or the bracket pair where the font has none. Local, since style.ts is a shared copy.
const BOX = { nerd: { done: '\u{F14A}', open: '\u{F096}' }, safe: { done: '[x]', open: '[ ]' } }
export const hasTask = (paragraph: string) => /^\s*([-*+]|\d+\.)\s+\[[ xX]\]\s/m.test(paragraph)
// A paragraph the mod can draw: plain lines and one level of bullets, nothing Claude Code draws a block for.
export const isSimple = (paragraph: string) =>
  paragraph.split('\n').every(line => !/^\s*(#|>|```|~~~|\|)/.test(line) && !/^( {2,}|\t)\S/.test(line) && !/^\s*([-*_])\s*\1\s*\1\s*$/.test(line))

export function proseBlock(elements: Elements, paragraph: string, look: Inline, key: string) {
  const { Box, Text } = elements
  const items: { bullet: string; text: string; task?: 'done' | 'open' }[] = []
  for (const line of paragraph.split('\n')) {
    const bullet = BULLET.exec(line)
    // Each written line keeps its row, since a reply breaks lines on purpose; only a bullet's indented continuation joins it.
    if (bullet) {
      const rest = line.slice(bullet[0].length)
      const task = TASK.exec(rest)
      items.push({ bullet: bullet[1]!, text: task ? rest.slice(task[0].length) : rest, task: task ? (task[1] === ' ' ? 'open' : 'done') : undefined })
    } else if (items.at(-1)?.bullet && line.startsWith(' ')) items.at(-1)!.text += ` ${line.trim()}`
    else items.push({ bullet: '', text: line.trim() })
  }
  const box = look.nerd ? BOX.nerd : BOX.safe
  // A hovered copy choice washes and dims the text; at rest this adds nothing.
  const ink = (color?: string) => ({ color: tinted(look.paint, color, 'text'), backgroundColor: look.paint?.wash('text') })
  return (
    <Box key={key} flexDirection="column">
      {items.map((item, at) =>
        item.task ? (
          <Box key={`${key}-item-${at}`} flexDirection="row">
            <Box key={`${key}-mark-${at}`} width={cells(box[item.task]) + 1} flexShrink={0}>
              <Text {...ink(THEME.accent)}>{`${box[item.task]} `}</Text>
            </Box>
            <Text key={`${key}-text-${at}`} wrap="wrap" {...ink(item.task === 'done' ? THEME.muted : undefined)}>{inline(elements, item.text, look, `${key}-${at}`)}</Text>
          </Box>
        ) : item.bullet ? (
          <Box key={`${key}-item-${at}`} flexDirection="row">
            <Box key={`${key}-mark-${at}`} width={item.bullet.length + 1} flexShrink={0}>
              <Text {...ink()}>{`${item.bullet} `}</Text>
            </Box>
            <Text key={`${key}-text-${at}`} wrap="wrap" {...ink()}>{inline(elements, item.text, look, `${key}-${at}`)}</Text>
          </Box>
        ) : (
          <Text key={`${key}-text-${at}`} wrap="wrap" {...ink()}>{inline(elements, item.text, look, `${key}-${at}`)}</Text>
        ),
      )}
    </Box>
  )
}

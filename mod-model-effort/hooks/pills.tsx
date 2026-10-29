// hooks/pills.tsx, by v-amorim
// Shared pill row; every mod that draws in the row carries the same copy.
import type { RenderElement } from 'claude-code'

import { entryCells, type EntryProps, type Tip } from './entry'
import style from './style'
import { CAPS, decodeAll, THEME } from './theme'

// The menu group on Moonlight surface-3, readouts on surface-2.
export const PILL = { primary: style.colors.pills.primary, secondary: style.colors.pills.secondary }

// Menu entries left to right, by the id in their `menu-pad-<id>` Box key; an unknown id goes last.
const ENTRY_ORDER = ['manager', 'skills', 'prompts', 'filetree', 'progress', 'headsup']

type Node = { props?: Record<string, unknown>; children?: unknown[] } | null | undefined
type Elements = { Box: (props: any) => RenderElement; Text: (props: any) => RenderElement }

const keyOf = (node: unknown) => (node as Node)?.props?.key as string | undefined
const childrenOf = (node: unknown) => (node as Node)?.children ?? []

// Splits next(e) into the menu entries other mods drew, the rest of the row, what else the band holds, and the hover tip under the row.
export function splitRow(others: unknown) {
  if (keyOf(others) !== 'menu-rows') return { group: [] as unknown[], row: [] as unknown[], rest: [others], tip: null as unknown }
  const children = childrenOf(others)
  const rest = children.filter(child => keyOf(child) !== 'menu-row' && keyOf(child) !== 'menu-tip')
  const pills = childrenOf(children.find(child => keyOf(child) === 'menu-row'))
  const groupPill = pills.find(child => keyOf(child) === 'menu-group')
  const body = childrenOf(groupPill).find(child => keyOf(child) === 'menu-group-body')
  return {
    // A mod still running an older copy may draw `menu-group-sep-*` separators between entries; the group drops them.
    group: childrenOf(body).filter(child => !keyOf(child)?.startsWith('menu-group-sep')),
    row: pills.filter(child => keyOf(child) !== 'menu-group'),
    rest,
    tip: children.find(child => keyOf(child) === 'menu-tip') ?? null,
  }
}

// The one-line tip above the pill row, filled while the pointer is on an entry: its "Name:" in bold accent, the rest muted.
export const tipLine = ({ Box, Text }: Elements, text: string) => {
  const at = text.indexOf(': ')
  return (
    <Box key="menu-tip" paddingLeft={2} flexDirection="row">
      {at < 0 ? null : <Text color={THEME.accent} bold>{text.slice(0, at + 1)}</Text>}
      <Text color={THEME.muted}>
        {(at < 0 ? text : text.slice(at + 1)).split(style.marks.sep).flatMap((part, index) => (index === 0 ? [part] : [<Text key={`sep-${index}`} color={style.colors.pills.separator}>{style.marks.sep}</Text>, part]))}
      </Text>
    </Box>
  )
}

// One pill with caps where the font has them, on `on`; `hover` colours the caps under scope `key`, which they follow but cannot light (gotchas).
export function pill({ Box, Text }: Elements, nerd: boolean, bg: string, body: unknown, key = 'menu-pill', on?: string, hover?: string) {
  const under = on ? { backgroundColor: on } : {}
  const lit = hover ? { hover: { scope: key, color: hover } } : {}
  return (
    <Box key={key} flexDirection="row">
      {nerd ? <Text><Text key={`${key}-cap-left`} color={bg} {...under} {...lit}>{CAPS.left}</Text></Text> : null}
      <Box key={`${key}-body`} flexDirection="row" backgroundColor={bg}>
        {body}
      </Box>
      {nerd ? <Text><Text key={`${key}-cap-right`} color={bg} {...under} {...lit}>{CAPS.right}</Text></Text> : null}
    </Box>
  )
}

// An icon-only chip whose `grown` (glyph and name, surface-4) covers the row leftward under the pointer; a grown Button has no caps (see gotchas).
export function iconChip({ Box, Text }: Elements, nerd: boolean, key: string, on: string, rest: unknown, grown: unknown, isButton = false) {
  const cap = (fill: string, side: string, glyph: string) => (nerd ? <Text key={`${key}-${side}`} color={fill} backgroundColor={on}>{glyph}</Text> : null)
  return (
    <Box key={`${key}-chip`} flexDirection="row" flexShrink={0}>
      {cap(THEME.surface3, 'left', CAPS.left)}
      <Box key={`${key}-rest`} flexDirection="row" backgroundColor={THEME.surface3}>{rest}</Box>
      {cap(THEME.surface3, 'right', CAPS.right)}
      {/* Unkeyed and unscoped: the chip's keyed Box reveals it, and a pointer on it counts as on the chip, so it starts no hover of its own. */}
      <Box position="absolute" top={0} right={0} display="none" hover={{ display: 'flex' }} flexDirection="row">
        {isButton ? null : cap(THEME.lifted, 'grown-left', CAPS.left)}
        <Box flexDirection="row" backgroundColor={THEME.lifted}>{grown}</Box>
        {isButton ? null : cap(THEME.lifted, 'grown-right', CAPS.right)}
      </Box>
    </Box>
  )
}

// mod-menu's `labels`: `always` icon and label, `never` the icon alone, `auto` the icon alone while the row overflows (Nerd only; safe keeps labels).
export type LabelsMode = 'auto' | 'always' | 'never'

// The value of `{ plugin: 'mod-menu', key: 'labels' }` as a mode; a missing or unknown value is `auto`, so a mod works without mod-menu.
export const labelsOf = (value: unknown): LabelsMode => (value === 'always' || value === 'never' ? value : 'auto')

type ClientNode = { type: 'Client'; props: { props: Record<string, unknown> } }
const isClient = (node: unknown): node is ClientNode => (node as { type?: string } | null)?.type === 'Client'

// The cells a drawn row takes with every label shown: a Client that may go compact says its own `cells`, or is an entry.tsx one.
const cellsOf = (node: unknown): number => {
  if (Array.isArray(node)) return node.reduce((sum: number, each) => sum + cellsOf(each), 0)
  if (typeof node === 'string') return [...node].length
  if (!node || typeof node !== 'object') return 0
  if (isClient(node)) {
    const { props } = node.props
    return typeof props.cells === 'number' ? props.cells : entryCells({ ...(props as EntryProps), compact: false })
  }
  // A `menu-flash` word comes and goes with the pointer; counting it would flip the row under the pointer.
  const kids = childrenOf(node).filter(each => each && !keyOf(each)?.startsWith('menu-flash'))
  return kids.reduce((sum: number, each) => sum + cellsOf(each), Number((node as Node)?.props?.columnGap ?? 0) * Math.max(0, kids.length - 1))
}

const compacted = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(compacted)
  if (!node || typeof node !== 'object') return node
  if (isClient(node)) return node.props.props.compact === false ? { ...node, props: { ...node.props, props: { ...node.props.props, compact: true } } } : node
  const kids = (node as Node)?.children
  return kids ? { ...node, children: kids.map(compacted) } : node
}

// A count as the neutral Badge: muted, one step above the pill it sits on.
export const badgeOf = (text: string, on: string) => ({ text, color: THEME.muted, bg: on === THEME.surface3 ? THEME.lifted : THEME.surface3 })

// A panel's entry in the menu group, keyed `menu-pad-<id>` for the row's order; the open one is a pill of its own.
export function menuEntry({ Box, Client, Text }: Elements & { Client: (props: any) => RenderElement }, nerd: boolean, id: string, { labels, ...props }: Omit<EntryProps, 'id' | 'bg' | 'tight'> & { labels?: LabelsMode }) {
  // The open panel is lifted into its own surface-4 pill in primary-70; a closed one fills to surface-4 under the pointer, caps and all.
  const bg = props.isOpen ? THEME.lifted : PILL.primary
  const key = props.isOpen ? `menu-open-${id}` : `menu-closed-${id}`
  const lift = props.isOpen ? {} : { lift: { scope: key, bg: THEME.lifted } }
  const glyph = (style.glyphs.nerd.icon as Record<string, string>)[`menu-${id}`]
  const icon = nerd && !props.lead && glyph ? decodeAll(glyph) : undefined
  // The icon sits tight against the cap, so the label that follows brings its own gap.
  const shown = icon ? { lead: icon, label: labels === 'never' ? '' : ` ${props.label}`, ...(labels === 'auto' ? { compact: false } : {}) } : {}
  // On Nerd the caps take the label's padding cells, so an entry is as wide as before the caps.
  const entry = <Client key={`menu-entry-${id}`} module="./entry.tsx" height={1} props={{ id, bg, ...props, ...(props.isOpen ? { color: THEME.ok } : {}), ...shown, ...lift, nerd, tight: nerd } satisfies EntryProps} />
  return (
    <Box key={`menu-pad-${id}`} flexDirection="row">
      {/* A closed entry gets caps in the group's own color, so opening a panel never shifts its neighbours. */}
      {pill({ Box, Text }, nerd, bg, entry, key, PILL.primary, props.isOpen ? undefined : THEME.lifted)}
    </Box>
  )
}

// The band above the prompt: what else it holds (Claude Code's own effort line), then the pill row, so the pills sit on the input.
export function pillRow(elements: Elements & { Client?: (props: any) => RenderElement }, nerd: boolean, group: unknown[], row: unknown[], rest: unknown[], tip: unknown = null, columns?: number) {
  const { Box, Client, Text } = elements
  // Load order changes with an install or a toggle, so entries sort by a fixed rank.
  const rank = (entry: unknown) => {
    const at = ENTRY_ORDER.indexOf(String(keyOf(entry) ?? '').replace(/^menu-pad-/, ''))
    return at < 0 ? ENTRY_ORDER.length : at
  }
  // Like a choice bar: the entries side by side on one pill, the open panel's lifted into its own, a divider Client between neighbours.
  const sorted = [...group].sort((a, b) => rank(a) - rank(b))
  const entries = Client
    ? sorted.flatMap((entry, at) => (at === 0 ? [entry] : [<Client key={`menu-group-sep-${at}`} module="./entry.tsx" height={1} props={{ id: `sep-${at}`, label: '', isOpen: false, bg: PILL.primary, rail: true } satisfies EntryProps} />, entry]))
    : sorted
  const pills = (
    <Box key="menu-row" flexDirection="row" columnGap={1}>
      {group.length > 0 ? pill(elements, nerd, PILL.primary, entries, 'menu-group') : null}
      {row}
    </Box>
  )
  // Measured with every label shown, so a row cut to icons never grows back into a row that does not fit.
  const fits = columns === undefined || cellsOf(pills) <= columns
  return (
    <Box key="menu-rows" flexDirection="column">
      {rest}
      {/* Above the row, kept even when empty so nothing above jumps when a tip appears. */}
      {tip ?? tipLine(elements, ' ')}
      {fits ? pills : compacted(pills)}
    </Box>
  )
}

// One chip per view of a panel (its list, its settings), standing in for the title: id, label, icon glyph, an optional count and an optional hover tip.
export type Tab = { id: string; label: string; icon: string; isOpen: boolean; count?: number; tip?: Tip }

// A panel's title line: the open view on surface3 and bold, the others on surface2 and muted; a click swaps the view.
export function tabRow({ Box, Client, Text }: Elements & { Client: (props: any) => RenderElement }, nerd: boolean, tabs: Tab[], still: boolean) {
  return (
    <Box key="tab-row" flexDirection="row" columnGap={1}>
      {tabs.map(tab => {
        const bg = tab.isOpen ? THEME.surface3 : THEME.surface2
        // Client props refuse an undefined value, so a tab without a count or tip leaves the key out.
        const badge = tab.count === undefined ? {} : { badge: badgeOf(String(tab.count), bg) }
        const tip = tab.tip ? { tip: tab.tip } : {}
        // A closed tab fills one step up under the pointer, caps and all, like a menu entry.
        const lift = tab.isOpen ? {} : { lift: { scope: `${tab.id}-pill`, bg: THEME.surface3 } }
        const entry = (
          <Client key={tab.id} module="./entry.tsx" height={1} props={{ id: tab.id, label: tab.label, isOpen: tab.isOpen, bg, idle: THEME.muted, still, subLead: tab.icon, subLeadColor: THEME.accent, nerd, ...(tab.isOpen ? { color: THEME.secondary } : {}), ...badge, ...tip, ...lift } satisfies EntryProps} />
        )
        return pill({ Box, Text }, nerd, bg, entry, `${tab.id}-pill`, undefined, tab.isOpen ? undefined : THEME.surface3)
      })}
    </Box>
  )
}

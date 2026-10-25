// hooks/theme.ts, by v-amorim
// Shared theme; every mod carries the same copy. Colors, marks and glyphs live in style.ts.
import style from './style'

export const THEME = style.colors.theme

// Shell command roles: what runs, its options, quoted text, variables, numbers and the glue between steps.
export const SYNTAX = style.colors.syntax

// One cell each and never an emoji: ⚠ switches to its emoji form in some fonts and draws two cells wide.
export const MARK = style.marks

// style.ts writes Nerd glyphs as {U+XXXX}, since private-use characters do not survive many editors and tools.
const decode = (text: string) => text.replace(/\{U\+([0-9A-F]+)\}/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))

export function decodeAll<T>(value: T): T {
  if (typeof value === 'string') return decode(value) as T
  if (Array.isArray(value)) return value.map(decodeAll) as T
  return Object.fromEntries(Object.entries(value as object).map(([key, inner]) => [key, decodeAll(inner)])) as T
}

// A pill's rounded ends, drawn only where the font has them.
export const CAPS = decodeAll(style.caps)

export const statusColor = (note: string) =>
  note.startsWith(MARK.ok) ? THEME.good : note.startsWith(MARK.warn) ? THEME.alert : THEME.muted

const channels = (hex: string) => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16))
const isHex = (color: string) => /^#[0-9a-f]{6}$/i.test(color)

// The color `t` of the way from `from` to `to`; a color that is not #RRGGBB switches halfway.
export function mix(from: string, to: string, t: number) {
  if (t <= 0) return from
  if (t >= 1) return to
  if (!isHex(from) || !isHex(to)) return t < 0.5 ? from : to
  const end = channels(to)
  return `#${channels(from).map((value, at) => Math.round(value + (end[at]! - value) * t).toString(16).padStart(2, '0')).join('')}`
}

// The share of a hue left in a subpill or count badge, washed into the fill it sits on.
export const WASH = 0.72

// A text.ts string with its {name} slots filled; a slot with no value stays as written, so a missing one shows.
export const fill = (template: string, values: Record<string, string | number> = {}) =>
  template.replace(/\{(\w+)\}/g, (slot, name: string) => (name in values ? String(values[name]) : slot))

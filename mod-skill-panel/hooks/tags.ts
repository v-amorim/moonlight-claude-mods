// mod-skill-panel / hooks/tags.ts, by v-amorim
// Reads skill frontmatter, groups skills by tag and builds colored tag badges.
import style from './style'
import text from './text'
import { mix } from './entry'
import { CAPS, THEME } from './theme'

export const PERSONAL = 'personal'

type Swatch = { hex: string; icon: string }

// Hues spread away from the theme blue, each over 9:1 on bg; icons are single-width Unicode, no Nerd Font.
export const SWATCHES: Record<string, Swatch> = Object.fromEntries(Object.entries(style.tags).map(([tag, { color, icon }]) => [tag, { hex: color, icon }]))

const FALLBACK = SWATCHES[PERSONAL]!

export const tagName = (tag: string) => (text.tagNames as Record<string, string>)[tag] ?? tag

export const swatchFor = (tag: string) => SWATCHES[tag] ?? FALLBACK

export function readFrontmatter(text: string): { name?: string; tag: string; description?: string; hidden: boolean } | null {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1]
  if (block === undefined) return null
  const field = (key: string) => {
    const raw = new RegExp(`^${key}:[ \\t]*(.+?)[ \\t]*$`, 'm').exec(block)?.[1]
    return raw?.replace(/^(["'])(.*)\1$/, '$2')
  }
  // A model-disabled skill is internal unless it says user-invocable outright, which marks a slash-only command.
  const hidden = field('disable-model-invocation') === 'true' && field('user-invocable') !== 'true'
  return { name: field('name'), tag: field('color-tag')?.toLowerCase() ?? PERSONAL, description: field('description'), hidden }
}

export type Skill = { name: string; tag: string; description: string; hidden: boolean }

export const TAG_ORDER = ['router', 'start', 'debug', 'review', 'interface', 'writing', 'utility', 'mods', PERSONAL]

export const groupSkills = (skills: Skill[]) => {
  const known = skills.map(skill => ({ skill, tag: TAG_ORDER.includes(skill.tag) ? skill.tag : PERSONAL }))
  known.sort((a, b) => TAG_ORDER.indexOf(a.tag) - TAG_ORDER.indexOf(b.tag) || a.skill.name.localeCompare(b.skill.name))
  const groups = new Map<string, Skill[]>()
  for (const { skill, tag } of known) groups.set(tag, [...(groups.get(tag) ?? []), skill])
  return [...groups].map(([tag, members]) => ({ tag, swatch: swatchFor(tag), skills: members }))
}

// The share of the tag's own hue left in the badge, as the panel's tag pills tint theirs.
export const TAG_WASH = 0.72

export const knownTag = (tag: string) => (TAG_ORDER.includes(tag) ? tag : PERSONAL)

// The typeahead collapses whitespace runs (a no-break space too), so the padding is the blank braille cell.
const PAD = '⠀'

// Every badge pads to the longest tag name, so the descriptions after it line up.
const nameWidth = () => Math.max(...TAG_ORDER.map(tag => tagName(tag).length))

const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(';')
const fgOf = (hex: string) => `\x1b[38;2;${rgb(hex)}m`
const bgOf = (hex: string) => `\x1b[48;2;${rgb(hex)}m`

// The last Claude Code release seen drawing color codes in the typeahead; later ones drop the ESC byte and leak the rest.
const LAST_COLORED = [2, 1, 289]

// Unknown or newer releases get the plain badge, so a wrong guess costs color, never leaked codes.
export function paintsDescriptions(version: string | undefined) {
  const parts = /^(\d+)\.(\d+)\.(\d+)/.exec(version ?? '')?.slice(1).map(Number)
  if (!parts) return false
  const step = parts.findIndex((part, i) => part !== LAST_COLORED[i])
  return step === -1 || parts[step]! < LAST_COLORED[step]!
}

export type BadgeLook = { nerd: boolean; colored: boolean }

// A tinted pill in the tag's hue where the typeahead draws color codes, else the bracketed icon and name.
export function badge(tag: string, { nerd, colored }: BadgeLook) {
  const known = knownTag(tag)
  const { hex, icon } = swatchFor(known)
  const name = tagName(known)
  const pad = PAD.repeat(nameWidth() - name.length)
  if (!colored) return `[${icon} ${name}]${pad}`
  const wash = mix(hex, THEME.bg, TAG_WASH)
  const body = `${bgOf(wash)}${fgOf(hex)}${nerd ? '' : ' '}${icon} ${name}${nerd ? '' : ' '}\x1b[39m\x1b[49m`
  const caps = nerd ? [`${fgOf(wash)}${CAPS.left}\x1b[39m`, `${fgOf(wash)}${CAPS.right}\x1b[39m`] : ['', '']
  return `${caps[0]}${body}${caps[1]}${pad}`
}

// The typeahead draws the name and description only, so the badge rides on the description.
export const markDescription = (description: string, tag: string, look: BadgeLook) => `${badge(tag, look)} ${description}`
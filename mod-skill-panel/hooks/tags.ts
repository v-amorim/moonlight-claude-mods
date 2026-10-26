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

const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(';')
const fgOf = (hex: string) => `\x1b[38;2;${rgb(hex)}m`
const bgOf = (hex: string) => `\x1b[48;2;${rgb(hex)}m`

// The share of the tag's own hue left in the badge, as the panel's tag pills tint theirs.
export const TAG_WASH = 0.72

export const knownTag = (tag: string) => (TAG_ORDER.includes(tag) ? tag : PERSONAL)

// The typeahead collapses whitespace runs (a no-break space too), so the padding is the blank braille cell.
const PAD = '⠀'

// Every badge pads to the longest tag name, so the descriptions after it line up.
const nameWidth = () => Math.max(...TAG_ORDER.map(tag => tagName(tag).length))

// A tinted pill with the tag's icon and name in its hue, on the typeahead's own background; rounded where the font has the caps.
export function badge(tag: string, nerd: boolean) {
  const known = knownTag(tag)
  const { hex, icon } = swatchFor(known)
  const wash = mix(hex, THEME.bg, TAG_WASH)
  const name = tagName(known)
  const body = `${bgOf(wash)}${fgOf(hex)}${nerd ? '' : ' '}${icon} ${name}${nerd ? '' : ' '}\x1b[39m\x1b[49m`
  const caps = nerd ? [`${fgOf(wash)}${CAPS.left}\x1b[39m`, `${fgOf(wash)}${CAPS.right}\x1b[39m`] : ['', '']
  return `${caps[0]}${body}${caps[1]}${PAD.repeat(nameWidth() - name.length)}`
}

// The typeahead draws the name and description only, so the badge rides on the description.
export const markDescription = (description: string, tag: string, nerd: boolean) => `${badge(tag, nerd)} ${description}`

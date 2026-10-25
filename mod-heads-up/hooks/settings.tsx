// hooks/settings.tsx, by v-amorim
// Shared settings body; every mod carries the same copy.
import type { ConfigRow, ConfigValue, RenderElement } from 'claude-code'

import type { EntryProps, Tip } from './entry'
import { cardFill, cardGap, section, sepText, type Look, type Reveal } from './look'
import style from './style'
import { CAPS, fill, MARK, THEME } from './theme'

// A button a mod offers beside its settings: runs `/<command> <args>`, declared in its showcase.json.
// isLocal marks the drawing mod's own command, which it calls directly, so Claude working does not hold it.
export type Action = { label: string; command: string; args?: string; isLocal?: boolean }

type Elements = { Box: (props: any) => RenderElement; Button: (props: any) => RenderElement; Client: (props: any) => RenderElement; Text: (props: any) => RenderElement }

export type SettingsProps = {
  // The mod's own /config rows (`<plugin>.<field>`), as $.config.list() returns them.
  rows: ConfigRow[]
  actions: Action[]
  // Another mod's command run while Claude works only queues as a prompt, so those actions go inert.
  working: boolean
  run: (action: Action) => unknown
  // The animations setting is off: a clicked control does not shimmer.
  still?: boolean
  // Hover tips by setting field (the key after the dot); a setting without one shows its description's first sentence.
  tips?: Record<string, string>
  // The mod's example cards, from its showcase.json, so its own panel and mod-manager draw the same ones.
  previews?: Previews
  // The mod's plugin.json userConfig, read by its own panel and by mod-manager alike, for the min and max a number setting declares.
  fields?: Record<string, Range>
}

export type Range = { min?: number; max?: number }

// A title's trailing "(unit)" is what its number reads in; the head drops it and the value carries it.
export function splitTitle(label: string) {
  const match = /^(.*?)\s*\(([^()]+)\)$/.exec(label)
  return match ? { name: match[1]!, unit: match[2]! } : { name: label, unit: '' }
}

// Large round counts read short, in thousands or millions.
const short = (n: number) => (n >= 1_000_000 && n % 100_000 === 0 ? `${n / 1_000_000}M` : n >= 10_000 && n % 1000 === 0 ? `${n / 1000}K` : String(n))

export function showNumber(value: number, unit: string) {
  if (!unit) return String(value)
  if (unit === '%') return `${value}%`
  return `${short(value)} ${value === 1 ? unit.replace(/s$/, '') : unit}`
}

// About twenty clicks from one end of the range to the other, on a 1, 2 or 5 step; no range steps by one.
export function stepOf({ min, max }: Range = {}) {
  if (min === undefined || max === undefined || max <= min) return 1
  const raw = (max - min) / 20
  const power = 10 ** Math.floor(Math.log10(raw))
  const nearest = [1, 2, 5, 10].map(factor => factor * power).reduce((best, step) => (Math.abs(step - raw) < Math.abs(best - raw) ? step : best))
  return Math.max(1, nearest)
}

export function stepNumber(value: number, by: 1 | -1, range: Range = {}) {
  return Math.min(range.max ?? Infinity, Math.max(range.min ?? -Infinity, value + by * stepOf(range)))
}

type ThemeColor = keyof typeof THEME

// A literal run of an example line, as the mod's previews test drew it from its real tree; a color is a theme name or a #hex.
export type PreviewSpan = { text: string; color?: string; bg?: string; bold?: boolean }
export type PreviewLine = { spans: PreviewSpan[] }
export type Preview = { frame?: { border: string; bg: string }; nerd: PreviewLine[]; safe: PreviewLine[] }

// showcase.json's "previews", written by `just previews`: per setting field, per value as text ("true", "false", an option), the card in each icon mode.
export type Previews = Record<string, Record<string, Preview>>

const shade = (color: string | undefined) => (color === undefined ? undefined : color in THEME ? THEME[color as ThemeColor] : color)

// What the row's current value looks like, as a card under it; null when the mod drew none for that value.
function exampleOf({ Box, Text }: Elements, look: Look, previews: Previews | undefined, row: ConfigRow, index: number) {
  const entry = previews?.[row.key.slice(row.key.indexOf('.') + 1)]?.[String(row.value)]
  const lines = look.nerd ? entry?.nerd : entry?.safe
  if (!entry || !lines?.length) return null
  // The lines carry their own padding and strip, so the frame adds none. The example sinks to bg, so it never matches the card it sits in.
  const sunk = (color: string | undefined) => (color !== undefined && color === shade(entry.frame?.bg) ? THEME.bg : color)
  return (
    <Box key={`setting-preview-${index}`} flexDirection="column" borderStyle="round" borderColor={shade(entry.frame?.border) ?? THEME.border} backgroundColor={THEME.bg} marginTop={1}>
      {lines.map((line, index) => (
        <Text key={`line-${index}`} wrap="truncate-end">
          {line.spans.length === 0 ? ' ' : line.spans.map((span, at) => <Text key={`span-${at}`} color={shade(span.color) ?? THEME.onSurface} {...(span.bg ? { backgroundColor: sunk(shade(span.bg)) } : {})} {...(span.bold ? { bold: true } : {})}>{span.text}</Text>)}
        </Text>
      ))}
    </Box>
  )
}

// The value as the panel shows it: on/off as words, a list as its items.
const shown = (row: ConfigRow) =>
  row.kind === 'boolean' ? (row.value === true ? style.text.on : style.text.off) : Array.isArray(row.value) ? row.value.join(', ') : String(row.value)

// Words that stay capitalized when a description follows a tip's label and colon.
const PROPER = new Set(['Claude', 'Haiku', 'Opus', 'Sonnet', 'Windows', 'Nerd'])

// A setting's description as the tip after "Label: ": its first sentence, led by a lowercase letter unless that word is a proper noun.
export function descriptionTip(description: string) {
  const sentence = description.split('. ')[0]!.replace(/\.$/, '')
  const word = /^[A-Z][a-z]+\b/.exec(sentence)?.[0]
  return word && !PROPER.has(word) ? sentence[0]!.toLowerCase() + sentence.slice(1) : sentence
}

// A control is an Entry pill posting `setting:<key>=<value as JSON>`; the mod's ui.message hook saves it with settingChoice.
const SETTING = 'setting:'
const settingId = (row: ConfigRow, value: ConfigValue) => `${SETTING}${row.key}=${JSON.stringify(value)}`

// The change a clicked settings control asks for, or null when the message is something else.
export function settingChoice(data: unknown): { key: string; value: ConfigValue } | null {
  const message = data as { type?: string; id?: string } | undefined
  if (message?.type !== 'menu-entry' || !message.id?.startsWith(SETTING)) return null
  const rest = message.id.slice(SETTING.length)
  const at = rest.indexOf('=')
  if (at === -1) return null
  try {
    return { key: rest.slice(0, at), value: JSON.parse(rest.slice(at + 1)) as ConfigValue }
  } catch {
    return null
  }
}

// A pill already frames the glyph, so drop the brackets and padding of the standalone button (safe `[↻]`).
const bare = (glyph: string) => glyph.replace(/[[\]\s]/g, '')

// A pill on the card's tint, capped where the font has the caps; `hover` lights the caps with a Button scoped to the pill's key.
const pillOn = ({ Box, Text }: Elements, look: Look, key: string, bg: string, body: unknown, on = THEME.surface1, hover?: string) => {
  const lit = hover ? { hover: { scope: key, color: hover } } : {}
  return (
    <Box key={key} flexDirection="row" flexShrink={0}>
      {look.nerd ? <Text key={`${key}-left`} color={bg} backgroundColor={on} {...lit}>{CAPS.left}</Text> : null}
      {body}
      {look.nerd ? <Text key={`${key}-right`} color={bg} backgroundColor={on} {...lit}>{CAPS.right}</Text> : null}
    </Box>
  )
}

export type Choice = { key: string; isOn: boolean; props: Pick<EntryProps, 'id' | 'label' | 'still' | 'tip' | 'subLead' | 'subLeadColor'> }

// A control track: a surface3 pill on `on`, padded by a space each side in safe mode, where it has no caps.
function track(elements: Elements, look: Look, key: string, on: string, parts: unknown[]) {
  const { Box, Text } = elements
  const space = (side: string) => (look.nerd ? null : <Text key={`${key}-space-${side}`} backgroundColor={THEME.surface3}> </Text>)
  return pillOn(elements, look, `${key}-bar`, THEME.surface3, <Box key={`${key}-options`} flexDirection="row" backgroundColor={THEME.surface3}>{[space('left'), ...parts, space('right')]}</Box>, on)
}

// A choice in a track: the pick a lifted (surface-4) subpill in primary-70 (`ok`), the rest muted; `on` is what the track sits on.
export function choiceBar(elements: Elements, look: Look, key: string, on: string, choices: Choice[]) {
  const { Client } = elements
  const entry = (choice: Choice, shape: Partial<EntryProps>) => (
    <Client key={choice.key} module="./entry.tsx" height={1} props={{ ...choice.props, isOpen: choice.isOn, bg: THEME.surface3, ...shape } satisfies EntryProps} />
  )
  const options = choices.map(choice =>
    choice.isOn
      ? // Tight, so the subpill is as wide as an idle option: the caps (Nerd) or a space (safe) stand where its padding was.
        pillOn(elements, look, `${choice.key}-chosen`, THEME.lifted, entry(choice, { bg: THEME.lifted, color: THEME.ok, idle: THEME.muted, nerd: look.nerd, tight: true }), THEME.surface3)
      : entry(choice, { idle: THEME.muted }),
  )
  return track(elements, look, key, on, options)
}

const actionScope = (index: number) => `action-row-${index}`

// The tip each live action shows in the pane footer on hover; a Button cannot post one, so paneFooter reveals it by the pill's hover group.
export const actionReveals = (actions: Action[], look: Look, working: boolean): Reveal[] =>
  actions.flatMap((action, index) =>
    working && !action.isLocal ? [] : [{ scope: actionScope(index), tip: { glyph: bare(look.glyph.go), label: action.label, text: fill(style.text.runsCommand, { command: [action.command, action.args].filter(Boolean).join(' ') }) } }],
  )

// Edits the row in place: on/off flips, a choice is a bar, a number steps; text is edited in /config.
function control(elements: Elements, look: Look, row: ConfigRow, index: number, still: boolean, tips?: Record<string, string>, fields?: Record<string, Range>) {
  const { Client, Text } = elements
  const key = `setting-${index}`
  const text = tips?.[row.key.slice(row.key.indexOf('.') + 1)] ?? (row.description ? descriptionTip(row.description) : '')
  // Client props refuse an undefined value, so no tip text means no key.
  const tipFor = (glyph: string) => (text ? { tip: { glyph: bare(glyph), label: splitTitle(row.label).name, text } satisfies Tip } : {})
  const entry = (suffix: string, label: string, value: ConfigValue, bg: string, color: string, isOpen: boolean, glyph = look.glyph.cycle) => (
    <Client key={`${key}-${suffix}`} module="./entry.tsx" height={1} props={{ id: settingId(row, value), label, isOpen, bg, color, idle: color, still, ...tipFor(glyph) } satisfies EntryProps} />
  )
  if (row.isLocked) return <Text color={THEME.muted}>{`${shown(row)} ${bare(look.glyph.locked)} ${style.text.locked}`}</Text>
  if (row.kind === 'boolean') {
    // The switch: `━━●` on, `●━━` off, the knob a bare glyph joined to the line.
    const isOn = row.value === true
    const shape = isOn
      ? { lead: MARK.track, leadColor: THEME.accent, label: MARK.knob, idle: THEME.ok }
      : { lead: MARK.knob, leadColor: style.colors.pills.readout, label: MARK.track, idle: THEME.trackOff }
    const flip = <Client key={`${key}-flip`} module="./entry.tsx" height={1} props={{ id: settingId(row, !isOn), isOpen: false, bg: THEME.surface3, tight: true, still, ...shape, ...tipFor(look.glyph.cycle) } satisfies EntryProps} />
    return track(elements, look, key, cardFill(), [flip])
  }
  if (row.kind === 'choice' && row.options?.length) {
    const choices = row.options.map((option, at) => ({ key: `${key}-option-${at}`, isOn: option === String(row.value), props: { id: settingId(row, option), label: option, still, ...tipFor(look.glyph.cycle) } }))
    return choiceBar(elements, look, key, cardFill(), choices)
  }
  if (row.kind === 'number' && typeof row.value === 'number') {
    const range = fields?.[row.key.slice(row.key.indexOf('.') + 1)]
    const value = <Text key={`${key}-value`} color={THEME.ok} backgroundColor={THEME.lifted} bold>{look.nerd ? showNumber(row.value, splitTitle(row.label).unit) : ` ${showNumber(row.value, splitTitle(row.label).unit)} `}</Text>
    return track(elements, look, key, cardFill(), [
      entry('down', bare(look.glyph.down), stepNumber(row.value, -1, range), THEME.surface3, THEME.muted, false, look.glyph.down),
      pillOn(elements, look, `${key}-value-pill`, THEME.lifted, value, THEME.surface3),
      entry('up', bare(look.glyph.up), stepNumber(row.value, 1, range), THEME.surface3, THEME.muted, false, look.glyph.up),
    ])
  }
  return <Text color={THEME.secondary}>{shown(row)}</Text>
}

// A setting's first row: the label bold on the left, its control anchored right.
export const settingHead = ({ Box, Text }: Pick<Elements, 'Box' | 'Text'>, key: string, label: string, control: unknown) => (
  <Box key={key} flexDirection="row" columnGap={2} justifyContent="space-between">
    <Text color={THEME.onSurface} bold>{label}</Text>
    {control}
  </Box>
)

// A hairline across its box, under a setting's head row; a Client, since only a Client learns the width it gets.
export const hairline = ({ Client }: Pick<Elements, 'Client'>, key: string, bg: string) => (
  <Client key={key} module="./entry.tsx" width="100%" height={1} props={{ id: key, label: '', isOpen: false, bg, rule: true } satisfies EntryProps} />
)

// The Settings and Actions sections of a mod's panel or page: one round-bordered card per setting.
export function settingsBody(elements: Elements, look: Look, { rows, actions, working, run, previews, tips, fields, still = false }: SettingsProps) {
  const { Box, Button, Text } = elements
  const settings = [
    rows.length === 0 ? <Text key="settings-none" color={THEME.muted}>{style.text.noSettings}</Text> : null,
    ...rows.map((row, index) => {
      const example = exampleOf(elements, look, previews, row, index)
      return (
        <Box key={`setting-row-${index}`} flexDirection="column" borderStyle="round" borderColor={THEME.border} backgroundColor={cardFill()} paddingX={1} marginTop={index === 0 ? 0 : 1}>
          {settingHead(elements, `setting-head-${index}`, splitTitle(row.label).name, control(elements, look, row, index, still, tips, fields))}
          {row.description || example ? hairline(elements, `setting-rule-${index}`, cardFill()) : null}
          {row.description ? (
            sepText(elements, row.kind === 'text' ? `${row.description} ${MARK.sep} ${style.text.editInConfig}` : row.description, THEME.muted, `setting-text-${index}`)
          ) : null}
          {example}
        </Box>
      )
    }),
  ]
  const buttons = actions.map((action, index) =>
    working && !action.isLocal ? (
      sepText(elements, `${look.glyph.go} ${action.label} ${MARK.sep} ${style.text.idleOnly}`, THEME.muted, `action-${index}`)
    ) : (
      // A plain Button so the action needs a real press; the glyph sits in the label so the whole pill lights.
      pillOn(
        elements,
        look,
        actionScope(index),
        THEME.surface3,
        <Button key={`action-${index}`} label={look.nerd ? `${bare(look.glyph.go)} ${action.label}` : ` ${bare(look.glyph.go)} ${action.label} `} plain hover={{ scope: actionScope(index), color: THEME.accent, inverse: true }} onPress={() => run(action)} />,
        THEME.surface1,
        THEME.accent,
      )
    ),
  )
  return (
    <Box key="settings" flexDirection="column">
      {/* The cards carry their own border, and the panel's open Settings tab already names them. */}
      <Box key="settings-cards" flexDirection="column">
        {cardGap(elements, 'settings')}
        {settings}
      </Box>
      {actions.length > 0 ? section(elements, look, 'actions', 'actions', style.text.actions, buttons) : null}
    </Box>
  )
}


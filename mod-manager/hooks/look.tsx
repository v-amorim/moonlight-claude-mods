// hooks/look.tsx, by v-amorim
// Shared look; every mod carries the same copy.
import type { RenderElement } from 'claude-code'

import style from './style'
import type { Tip } from './entry'
import { CAPS, decodeAll, MARK, mix, THEME, WASH } from './theme'

type Glyphs = Omit<typeof style.glyphs.nerd, 'icon' | 'mark'> & { icon: Record<string, string>; mark: Record<string, string> }

// Safe mode: common Unicode that every modern terminal font draws. Headings and rows carry no icon.
const SAFE: Glyphs = decodeAll(style.glyphs.safe)

// Nerd mode: Font Awesome, Material and VS Code glyphs from any Nerd Font, controls padded to the same three cells.
const NERD: Glyphs = decodeAll(style.glyphs.nerd)

export type Look = { nerd: boolean; glyph: typeof SAFE }

export const lookFor = (nerd: boolean): Look => ({ nerd, glyph: nerd ? NERD : SAFE })

// The icons setting every drawing mod declares in its userConfig.
export type IconMode = 'auto' | 'nerd' | 'safe'

export const terminalSettings = (localAppData: string) => [
  `${localAppData}/Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json`,
  `${localAppData}/Microsoft/Windows Terminal/settings.json`,
]

// Matches "Fira Code Nerd Font Mono" and the patched suffixes NF, NFM and NFP, as in "FiraCodeNFM-Reg".
export const isNerdName = (face: string) => /nerd|\bNFM?\b/i.test(face) || /NF[MP]?(?![A-Za-z])/.test(face)

export const isNerdFace = (settingsText: string) => [...settingsText.matchAll(/"face"\s*:\s*"([^"]*)"/g)].some(match => isNerdName(match[1]!))

// The variables that name the terminal: WT_SESSION from Windows Terminal, TERM_PROGRAM from programs such as mintty and iTerm2.
export type TerminalEnv = Partial<
  Record<'WT_SESSION' | 'TERM_PROGRAM' | 'ITERM_PROFILE' | 'KITTY_WINDOW_ID' | 'ALACRITTY_WINDOW_ID' | 'GNOME_TERMINAL_SCREEN' | 'KONSOLE_VERSION', string | undefined>
>

// What detection reads: files by path, and the stdout of a command that exits 0 (it throws otherwise).
export type Host = { localAppData: string; home: string; read: (path: string) => Promise<string>; run: (argv: string[]) => Promise<string> }

// mintty inherits WT_SESSION from a Windows Terminal tab, so only an unset or Windows Terminal TERM_PROGRAM counts.
export const isWindowsTerminal = ({ WT_SESSION, TERM_PROGRAM }: TerminalEnv) =>
  Boolean(WT_SESSION) && (!TERM_PROGRAM || /windows\s*terminal/i.test(TERM_PROGRAM))

// Terminals whose font sits in a text config: the first file that names a font wins, and within a file the first pattern.
const CONFIG_TERMINALS: { is: (env: TerminalEnv) => boolean; files: (host: Host) => string[]; faces: RegExp[] }[] = [
  {
    is: env => env.TERM_PROGRAM === 'vscode',
    files: ({ home, localAppData }) => [
      `${home}/Library/Application Support/Code/User/settings.json`,
      `${home}/.config/Code/User/settings.json`,
      `${localAppData.replace(/\/Local$/, '/Roaming')}/Code/User/settings.json`,
    ],
    faces: [/"terminal\.integrated\.fontFamily"\s*:\s*"([^"]*)"/, /"editor\.fontFamily"\s*:\s*"([^"]*)"/],
  },
  {
    is: env => env.TERM_PROGRAM === 'ghostty',
    files: ({ home }) => [`${home}/.config/ghostty/config`, `${home}/Library/Application Support/com.mitchellh.ghostty/config`],
    faces: [/^\s*font-family\s*=\s*"?([^"\n#]+)/m],
  },
  {
    is: env => Boolean(env.KITTY_WINDOW_ID),
    files: ({ home }) => [`${home}/.config/kitty/kitty.conf`],
    faces: [/^\s*font_family\s+(.+)$/m],
  },
  {
    is: env => env.TERM_PROGRAM === 'WezTerm',
    files: ({ home }) => [`${home}/.wezterm.lua`, `${home}/.config/wezterm/wezterm.lua`],
    faces: [/wezterm\.font(?:_with_fallback)?\(\s*\{?\s*["']([^"']+)["']/],
  },
  {
    is: env => Boolean(env.ALACRITTY_WINDOW_ID),
    files: ({ home }) => [`${home}/.config/alacritty/alacritty.toml`],
    faces: [/\[font\.normal\][^[]*?family\s*=\s*"([^"]+)"/],
  },
]

// iTerm2 keeps its profiles in a plist; plutil prints the part asked for. The profile is the one this window runs, else the default.
async function itermFace(env: TerminalEnv, host: Host) {
  const plist = `${host.home}/Library/Preferences/com.googlecode.iterm2.plist`
  const profiles: { Name?: string; Guid?: string; 'Normal Font'?: string }[] = JSON.parse(await host.run(['plutil', '-extract', 'New Bookmarks', 'json', '-o', '-', plist]))
  const named = profiles.find(profile => profile.Name === env.ITERM_PROFILE)
  if (named) return named['Normal Font']
  const guid = (await host.run(['plutil', '-extract', 'Default Bookmark Guid', 'raw', '-o', '-', plist])).trim()
  return profiles.find(profile => profile.Guid === guid)?.['Normal Font']
}

// GNOME Terminal keeps the default profile's font in dconf, and ignores it while the profile uses the system font.
async function gnomeFace(host: Host) {
  const unquote = (text: string) => text.trim().replace(/^'|'$/g, '')
  const schema = `org.gnome.Terminal.Legacy.Profile:/org/gnome/terminal/legacy/profiles:/:${unquote(await host.run(['gsettings', 'get', 'org.gnome.Terminal.ProfilesList', 'default']))}/`
  if (unquote(await host.run(['gsettings', 'get', schema, 'use-system-font'])) === 'true') return undefined
  return unquote(await host.run(['gsettings', 'get', schema, 'font']))
}

// Konsole names its profile in konsolerc, and the profile file holds `Font=Name,size,...`.
async function konsoleFace(host: Host) {
  const profile = /^DefaultProfile=(.+)$/m.exec(await host.read(`${host.home}/.config/konsolerc`))?.[1]?.trim()
  return profile ? /^Font=([^,\n]+)/m.exec(await host.read(`${host.home}/.local/share/konsole/${profile}`))?.[1] : undefined
}

async function configFace(terminal: (typeof CONFIG_TERMINALS)[number], host: Host) {
  for (const path of terminal.files(host)) {
    const text = await host.read(path).catch(() => '')
    for (const pattern of terminal.faces) {
      const face = pattern.exec(text)?.[1]
      if (face) return face
    }
  }
  return undefined
}

function terminalFace(env: TerminalEnv, host: Host) {
  if (env.TERM_PROGRAM === 'iTerm.app') return itermFace(env, host)
  if (env.GNOME_TERMINAL_SCREEN) return gnomeFace(host)
  if (env.KONSOLE_VERSION) return konsoleFace(host)
  const terminal = CONFIG_TERMINALS.find(candidate => candidate.is(env))
  return terminal ? configFace(terminal, host) : Promise.resolve(undefined)
}

// Every mod looks up the font on start at once, so a lookup can fail by chance; a third failure throws and the caller keeps its saved answer.
async function retried<T>(attempt: () => Promise<T>, tries = 3): Promise<T> {
  for (let left = tries - 1; ; left--) {
    try {
      return await attempt()
    } catch (error) {
      if (left === 0) throw error
    }
  }
}

// Nerd glyphs only when the terminal this window runs in names a Nerd font; an unknown terminal stays safe, and a lookup that keeps failing throws.
export async function detectNerd(env: TerminalEnv, host: Host) {
  if (isWindowsTerminal(env)) {
    for (const path of terminalSettings(host.localAppData)) {
      if (isNerdFace(await host.read(path).catch(() => ''))) return true
    }
    return false
  }
  const face = await retried(() => terminalFace(env, host))
  return face !== undefined && isNerdName(face)
}

// `text` led by its icon in Nerd mode; the text alone in safe mode or when the name has no icon.
export const withIcon = (look: Look, name: string, text: string) => (look.glyph.icon[name] ? `${look.glyph.icon[name]} ${text}` : text)

// A status note with its leading mark (MARK.warn or MARK.ok from theme.ts) drawn as this look's glyph.
export function withMark(look: Look, note: string) {
  if (note.startsWith('! ')) return `${look.glyph.warn} ${note.slice(2)}`
  if (note.startsWith('✓ ')) return `${look.glyph.ok} ${note.slice(2)}`
  return note
}

type Elements = { Box: (props: any) => RenderElement; Text: (props: any) => RenderElement }

// A pane's title line: the name's icon in Nerd mode, the safe mark otherwise.
export const paneTitle = ({ Text }: Elements, look: Look, icon: string, text: string) => (
  <Text key="pane-title" color={THEME.accent} bold>{`${look.glyph.icon[icon] ?? look.glyph.title} ${text}`}</Text>
)

// One line of text in `color` with every separator dot in the separator colour, since a dot in the text's colour reads as part of the words.
export function sepText({ Text }: Pick<Elements, 'Text'>, text: string, color: string, key: string, props: Record<string, unknown> = {}) {
  return (
    <Text key={key} {...props}>
      {text.split(MARK.sep).flatMap((part, at) => [
        ...(at > 0 ? [<Text key={`${key}-sep-${at}`} color={style.colors.pills.separator}>{MARK.sep}</Text>] : []),
        <Text key={`${key}-part-${at}`} color={color}>{part}</Text>,
      ])}
    </Text>
  )
}

// The footer rows every pane reserves at its bottom: a rule, the hint or the hovered control's tip, then the status line.
export const FOOTER_ROWS = 3

// A Button cannot post a tip, so its tip is drawn hidden and shown by the hover group the Button's pill shares.
export type Reveal = { scope: string; tip: Tip }

const cells = (text: string) => [...text].length

// The words of `text` that fit `room` cells, then the rest.
function firstLine(text: string, room: number): [string, string] {
  const words = text.split(' ')
  let line = ''
  let at = 0
  while (at < words.length && cells(line ? `${line} ${words[at]}` : words[at]!) <= room) line = line ? `${line} ${words[at++]}` : words[at++]!
  return [line, words.slice(at).join(' ')]
}

// A tip may wrap onto a second row (the status row's place) and is cut after it; the hint is one row.
const tipRow = ({ Box, Text }: Elements, key: string, tip: Tip | null, columns: number, extra: Record<string, unknown> = {}, hint = '') => {
  if (!tip) {
    return (
      <Box key={key} flexDirection="row" paddingX={1} width={columns} height={1} backgroundColor={THEME.bg} {...extra}>
        {hint ? sepText({ Text }, hint, style.colors.pills.readout, `${key}-hint`, { backgroundColor: THEME.bg, wrap: 'truncate-end' }) : <Text backgroundColor={THEME.bg}> </Text>}
      </Box>
    )
  }
  const [head, rest] = firstLine(tip.text, Math.max(1, columns - 2 - cells(tip.glyph) - cells(` ${tip.label}`) - 3))
  return (
    <Box key={key} flexDirection="column" paddingX={1} width={columns} height={2} backgroundColor={THEME.bg} {...extra}>
      <Box key={`${key}-first`} flexDirection="row">
        <Text color={THEME.accent} backgroundColor={THEME.bg}>{tip.glyph}</Text>
        <Box flexShrink={0}><Text color={THEME.onSurface} backgroundColor={THEME.bg}>{` ${tip.label}`}</Text></Box>
        {sepText({ Text }, ` ${MARK.sep} ${head}`, THEME.muted, `${key}-text`, { backgroundColor: THEME.bg, wrap: 'truncate-end' })}
      </Box>
      {rest ? sepText({ Text }, rest, THEME.muted, `${key}-more`, { backgroundColor: THEME.bg, wrap: 'truncate-end' }) : <Text backgroundColor={THEME.bg}> </Text>}
    </Box>
  )
}

export type FooterLines = { hint?: string; status?: string }

// Pinned at the pane bottom on its own background: under the rule the hovered tip (two rows, then cut), else the dim `hint` and then `status`; empty rows stay blank.
export function paneFooter(elements: Elements, tip: Tip | null, columns: number, scroll: { offset: number; bodyRows: number }, reveals: Reveal[] = [], { hint = '', status = '' }: FooterLines = {}) {
  const { Box, Text } = elements
  return (
    <Box key="pane-footer" position="absolute" top={Math.max(0, scroll.offset + scroll.bodyRows - FOOTER_ROWS)} left={0} width={columns} height={FOOTER_ROWS} flexDirection="column" backgroundColor={THEME.bg}>
      <Text key="footer-rule" color={THEME.border} backgroundColor={THEME.bg}>{MARK.rule.repeat(Math.max(1, columns))}</Text>
      {tipRow(elements, 'footer-tip', tip, columns, {}, hint)}
      {tip ? null : (
        <Box key="footer-status" flexDirection="row" paddingX={1} width={columns} height={1} backgroundColor={THEME.bg}>
          {status ? sepText({ Text }, status, style.colors.pills.readout, 'footer-status-text', { backgroundColor: THEME.bg, wrap: 'truncate-end' }) : <Text backgroundColor={THEME.bg}> </Text>}
        </Box>
      )}
      {reveals.map((reveal, at) =>
        tipRow(elements, `footer-reveal-${at}`, reveal.tip, columns, { position: 'absolute', top: 1, left: 0, display: 'none', hover: { scope: reveal.scope, display: 'flex' } }),
      )}
    </Box>
  )
}

// A pill's leading icon, mark or digit, or its count: a rounded subpill washed from `hue` into the `fill` it sits on.
export function subpill({ Box, Text }: Elements, nerd: boolean, fill: string, text: string, key: string, hue: string = THEME.accent) {
  const bg = mix(hue, fill, WASH)
  return (
    <Box key={key} flexDirection="row" flexShrink={0}>
      {nerd ? <Text key={`${key}-left`} color={bg} backgroundColor={fill}>{CAPS.left}</Text> : null}
      <Text key={`${key}-text`} color={hue} backgroundColor={bg} bold>{nerd ? text : ` ${text} `}</Text>
      {nerd ? <Text key={`${key}-right`} color={bg} backgroundColor={fill}>{CAPS.right}</Text> : null}
    </Box>
  )
}

// A section's heading: a surface3 pill led by its icon as a subpill in Nerd mode, bold accent text in safe mode.
export function heading(elements: Elements, look: Look, key: string, icon: string, title: string) {
  const { Box, Text } = elements
  if (!look.nerd) {
    return (
      <Box key={`${key}-head`}>
        <Text color={THEME.accent} bold>{title}</Text>
      </Box>
    )
  }
  const glyph = look.glyph.icon[icon]
  return (
    <Box key={`${key}-head`} flexDirection="row">
      <Text color={THEME.surface3}>{CAPS.left}</Text>
      <Box key={`${key}-head-body`} flexDirection="row" backgroundColor={THEME.surface3}>
        {glyph ? subpill(elements, true, THEME.surface3, glyph, `${key}-head-icon`) : null}
        <Text color={THEME.onSurface} bold>{glyph ? ` ${title}` : title}</Text>
      </Box>
      <Text color={THEME.surface3}>{CAPS.right}</Text>
    </Box>
  )
}

// A card's fill: surface1 washed lightly toward its hue, under a neutral border. Pills on the card sit on it.
export const cardFill = (hue: string = THEME.accent) => mix(THEME.surface1, hue, 0.06)

// The row above a card, painted on bg so a scrolled card above never shows through the gap.
export function cardGap({ Box }: Elements, key: string, bg: string = THEME.bg) {
  return <Box key={`${key}-gap`} height={1} flexShrink={0} backgroundColor={bg} />
}

// A card's title laid over its top border after the corner (`top` is the border's row); Pane refuses borderTop, so the border stays whole underneath.
export function titleEdge(elements: Elements, look: Look, key: string, icon: string, title: string, hint = '', top = 1, edge: string = THEME.border) {
  const { Box, Text } = elements
  const glyph = look.nerd ? look.glyph.icon[icon] : undefined
  return (
    <Box key={`${key}-edge`} position="absolute" top={top} left={1} flexDirection="row" height={1} backgroundColor={THEME.bg}>
      <Text color={edge}>{`${MARK.rule} `}</Text>
      {glyph ? <Text color={THEME.accent}>{`${glyph} `}</Text> : null}
      {sepText(elements, title, THEME.onSurface, `${key}-title`, { bold: true })}
      {hint ? sepText(elements, ` ${hint}`, THEME.muted, `${key}-hint`) : null}
      <Text> </Text>
    </Box>
  )
}

// A round card tinted toward `hue`, its title (and muted `hint`) set into the top edge, `right` (such as Fold all) at that edge's end.
export function section(elements: Elements, look: Look, key: string, icon: string, title: string, body: unknown, hue: string = THEME.accent, { hint = '', right }: { hint?: string; right?: unknown } = {}) {
  const { Box } = elements
  return (
    <Box key={`${key}-block`} flexDirection="column">
      {cardGap(elements, key)}
      <Box key={key} flexDirection="column" borderStyle="round" borderColor={THEME.border} backgroundColor={cardFill(hue)} paddingX={1}>
        {body}
      </Box>
      {title ? titleEdge(elements, look, key, icon, title, hint) : null}
      {right ? (
        <Box key={`${key}-edge-right`} position="absolute" top={1} right={1} flexDirection="row" height={1} backgroundColor={THEME.bg}>
          {right}
        </Box>
      ) : null}
    </Box>
  )
}


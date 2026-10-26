// tests/look.test.ts, by v-amorim
// Tests Nerd Font detection and icon mode choice against fake host files and commands.
import { expect, test } from 'claude-code/testing'

import { detectNerd, isNerdName, lookFor, type Host } from '../hooks/look'

const LOCAL = 'C:/Users/me/AppData/Local'
const HOME = '/Users/me'
const NERD_FONT = '{ "profiles": { "defaults": { "font": { "face": "CaskaydiaCove Nerd Font Mono" } } } }'
const PLAIN_FONT = '{ "profiles": { "defaults": { "font": { "face": "Cascadia Mono" } } } }'

const reading = (text: string) => async () => text

// A host whose files and commands are the given tables, keyed by path and by the command as typed; anything else is missing.
const host = (files: Record<string, string> = {}, commands: Record<string, string> = {}, extra: Partial<Host> = {}): Host => ({
  localAppData: LOCAL,
  home: HOME,
  read: async path => (path in files ? files[path]! : Promise.reject(new Error('missing'))),
  run: async argv => (argv.join(' ') in commands ? commands[argv.join(' ')]! : Promise.reject(new Error('exit 1'))),
  ...extra,
})

test('Windows Terminal with a Nerd font draws Nerd glyphs', async () => {
  expect(await detectNerd({ WT_SESSION: 'guid' }, host({}, {}, { read: reading(NERD_FONT) }))).toBe(true)
})

test('Windows Terminal with a plain font stays safe', async () => {
  expect(await detectNerd({ WT_SESSION: 'guid' }, host({}, {}, { read: reading(PLAIN_FONT) }))).toBe(false)
})

test('Windows Terminal that names itself keeps the Nerd check', async () => {
  expect(await detectNerd({ WT_SESSION: 'guid', TERM_PROGRAM: 'WindowsTerminal' }, host({}, {}, { read: reading(NERD_FONT) }))).toBe(true)
})

test('mintty inside a Windows Terminal tab stays safe even with a Nerd font', async () => {
  expect(await detectNerd({ WT_SESSION: 'guid', TERM_PROGRAM: 'mintty' }, host({}, {}, { read: reading(NERD_FONT) }))).toBe(false)
})

test('conhost, with neither variable, stays safe and never reads anything', async () => {
  let reads = 0
  const read = async () => {
    reads += 1
    return NERD_FONT
  }

  expect(await detectNerd({}, host({}, {}, { read }))).toBe(false)
  expect(reads).toBe(0)
})

test('an unreadable settings file stays safe', async () => {
  expect(await detectNerd({ WT_SESSION: 'guid' }, host())).toBe(false)
})

test('a Nerd name is told by the word or by the NF, NFM and NFP suffixes', () => {
  for (const face of ['FiraCode Nerd Font Mono', 'FiraCodeNFM-Reg', 'MesloLGSNF-Regular', 'JetBrainsMono NF', 'Hack NFP', 'Hack nfm', 'CaskaydiaCove NFM']) expect(isNerdName(face)).toBe(true)
  for (const face of ['Cascadia Mono', 'Menlo', 'Monaco', 'Informal Roman', 'SF Mono', 'CONFIG Mono', 'Consolas']) expect(isNerdName(face)).toBe(false)
})

const PLIST = `${HOME}/Library/Preferences/com.googlecode.iterm2.plist`
const PROFILES = JSON.stringify([
  { Name: 'Default', Guid: 'A', 'Normal Font': 'Monaco 12' },
  { Name: 'Fira', Guid: 'B', 'Normal Font': 'FiraCodeNFM-Reg 12' },
])
const iterm = (commands: Record<string, string>) => host({}, { [`plutil -extract New Bookmarks json -o - ${PLIST}`]: PROFILES, ...commands })

test('iTerm2 reads the font of the profile the window runs', async () => {
  expect(await detectNerd({ TERM_PROGRAM: 'iTerm.app', ITERM_PROFILE: 'Fira' }, iterm({}))).toBe(true)
  expect(await detectNerd({ TERM_PROGRAM: 'iTerm.app', ITERM_PROFILE: 'Default' }, iterm({}))).toBe(false)
})

test('iTerm2 without a known profile name falls back to the default profile', async () => {
  const guid = (value: string) => ({ [`plutil -extract Default Bookmark Guid raw -o - ${PLIST}`]: `${value}\n` })

  expect(await detectNerd({ TERM_PROGRAM: 'iTerm.app' }, iterm(guid('B')))).toBe(true)
  expect(await detectNerd({ TERM_PROGRAM: 'iTerm.app' }, iterm(guid('A')))).toBe(false)
})

test('iTerm2 with no readable plist throws, so the saved answer stays', async () => {
  await expect(detectNerd({ TERM_PROGRAM: 'iTerm.app' }, host())).rejects.toThrow()
})

test('iTerm2 retries a lookup that fails by chance', async () => {
  let calls = 0
  const flaky = iterm({})
  const { run } = flaky
  flaky.run = async argv => ((calls += 1) <= 2 ? Promise.reject(new Error('busy')) : run(argv))

  expect(await detectNerd({ TERM_PROGRAM: 'iTerm.app', ITERM_PROFILE: 'Fira' }, flaky)).toBe(true)
})

test('VS Code prefers the terminal font, then the editor font, across the per-OS settings paths', async () => {
  const path = `${HOME}/Library/Application Support/Code/User/settings.json`
  const env = { TERM_PROGRAM: 'vscode' }

  expect(await detectNerd(env, host({ [path]: '{ // c\n "terminal.integrated.fontFamily": "FiraCode Nerd Font", "editor.fontFamily": "Menlo" }' }))).toBe(true)
  expect(await detectNerd(env, host({ [path]: '{ "editor.fontFamily": "FiraCode Nerd Font" }' }))).toBe(true)
  expect(await detectNerd(env, host({ [path]: '{ "terminal.integrated.fontFamily": "Menlo", "editor.fontFamily": "FiraCode Nerd Font" }' }))).toBe(false)
  expect(await detectNerd(env, host({ [`${HOME}/.config/Code/User/settings.json`]: '{ "editor.fontFamily": "Hack Nerd Font" }' }))).toBe(true)
  expect(await detectNerd(env, host({ [`${LOCAL.replace(/Local$/, 'Roaming')}/Code/User/settings.json`]: '{ "editor.fontFamily": "Hack NFM" }' }))).toBe(true)
})

test('Ghostty, kitty, WezTerm and Alacritty read the font from their own config', async () => {
  const cases: [Record<string, string>, string, string][] = [
    [{ TERM_PROGRAM: 'ghostty' }, `${HOME}/.config/ghostty/config`, '# c\nfont-family = "FiraCode Nerd Font"\nfont-size = 13'],
    [{ TERM_PROGRAM: 'ghostty' }, `${HOME}/Library/Application Support/com.mitchellh.ghostty/config`, 'font-family = JetBrainsMono NF'],
    [{ KITTY_WINDOW_ID: '1' }, `${HOME}/.config/kitty/kitty.conf`, 'font_family FiraCode Nerd Font Mono\nbold_font auto'],
    [{ TERM_PROGRAM: 'WezTerm' }, `${HOME}/.config/wezterm/wezterm.lua`, 'config.font = wezterm.font("FiraCode Nerd Font")'],
    [{ TERM_PROGRAM: 'WezTerm' }, `${HOME}/.wezterm.lua`, "config.font = wezterm.font_with_fallback({ 'Hack NFM', 'Menlo' })"],
    [{ ALACRITTY_WINDOW_ID: '1' }, `${HOME}/.config/alacritty/alacritty.toml`, '[window]\nopacity = 1\n[font.normal]\nfamily = "FiraCode Nerd Font"\nstyle = "Regular"'],
  ]
  for (const [env, path, text] of cases) {
    expect(await detectNerd(env, host({ [path]: text }))).toBe(true)
    expect(await detectNerd(env, host({ [path]: text.replace(/Nerd Font|NFM|NF/, 'Plain') }))).toBe(false)
  }
})

test('GNOME Terminal reads the default profile font, and ignores it while the system font is used', async () => {
  const schema = 'org.gnome.Terminal.Legacy.Profile:/org/gnome/terminal/legacy/profiles:/:abc/'
  const gnome = (systemFont: string, font: string) =>
    host({}, {
      'gsettings get org.gnome.Terminal.ProfilesList default': "'abc'\n",
      [`gsettings get ${schema} use-system-font`]: `${systemFont}\n`,
      [`gsettings get ${schema} font`]: `'${font}'\n`,
    })
  const env = { GNOME_TERMINAL_SCREEN: '/org/gnome/Terminal/screen/x' }

  expect(await detectNerd(env, gnome('false', 'FiraCode Nerd Font Mono 12'))).toBe(true)
  expect(await detectNerd(env, gnome('false', 'Monospace 12'))).toBe(false)
  expect(await detectNerd(env, gnome('true', 'FiraCode Nerd Font Mono 12'))).toBe(false)
})

test('Konsole reads the font of the profile konsolerc names', async () => {
  const files = (font: string) => ({ [`${HOME}/.config/konsolerc`]: '[Desktop Entry]\nDefaultProfile=Mine.profile\n', [`${HOME}/.local/share/konsole/Mine.profile`]: `[Appearance]\nFont=${font},12,-1,5,50,0,0,0,0,0\n` })

  expect(await detectNerd({ KONSOLE_VERSION: '240800' }, host(files('FiraCode Nerd Font Mono')))).toBe(true)
  expect(await detectNerd({ KONSOLE_VERSION: '240800' }, host(files('Monospace')))).toBe(false)
})

test('an unknown terminal stays safe and reads nothing', async () => {
  let touched = 0
  const spy = host({}, {}, { read: async () => ((touched += 1), NERD_FONT), run: async () => ((touched += 1), '') })

  expect(await detectNerd({ TERM_PROGRAM: 'Apple_Terminal' }, spy)).toBe(false)
  expect(touched).toBe(0)
})

test('the safe glyph set holds no private-use code points, so it draws without a Nerd font', () => {
  const strings = (value: unknown): string[] => (typeof value === 'string' ? [value] : Object.values(value as object).flatMap(strings))
  const privateUse = strings(lookFor(false).glyph)
    .flatMap(text => [...text])
    .filter(ch => {
      const code = ch.codePointAt(0)!
      return (code >= 0xe000 && code <= 0xf8ff) || code >= 0xf0000
    })

  expect(privateUse).toEqual([])
  expect(lookFor(false).nerd).toBe(false)
})

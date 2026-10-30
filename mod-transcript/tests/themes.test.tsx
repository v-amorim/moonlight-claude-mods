// mod-transcript / tests/themes.test.tsx, by v-amorim
// Tests the Code theme picker in the settings panel and the list of installed themes it shows.
import { expect, mock, test } from 'claude-code/testing'

import Themes, { themeRows } from '../hooks/themes'
import { mix, THEME } from '../hooks/theme'
import { listThemes } from '../hooks/vstheme'
import { reading } from './bridge-feed'

const EXTENSIONS = '/home/.vscode/extensions'
const SETTINGS = '/home/AppData/Roaming/Code/User/settings.json'

const pack = (themes: string[]) => JSON.stringify({ contributes: { themes: themes.map(label => ({ label, uiTheme: 'vs-dark', path: './t.json' })) } })

// Extension folders by name, each with its package.json; VS Code is set to `active`.
const world = (packs: Record<string, string[]>, active = 'Moonlight 🌌') => {
  const files: Record<string, string> = { [SETTINGS]: JSON.stringify({ 'workbench.colorTheme': active }, null, 2) }
  for (const [folder, themes] of Object.entries(packs)) files[`${EXTENSIONS}/${folder}/package.json`] = pack(themes)
  return files
}

const textOf = (node: any): string => (typeof node === 'string' ? node : Array.isArray(node) ? node.map(textOf).join('') : node ? textOf(node.children) : '')

const host = (files: Record<string, string>) => ({
  home: '/home',
  appData: '/home/AppData/Roaming',
  read: async (path: string) => files[path] ?? Promise.reject(new Error('missing')),
  list: async (path: string) => {
    const names = Object.keys(files).filter(file => file.startsWith(`${path}/`)).map(file => file.slice(path.length + 1).split('/')[0]!)
    if (!names.length) throw new Error('missing')
    return [...new Set(names)]
  },
})

test('every installed theme label is listed once, sorted, from all extensions and skipping packs without themes', async () => {
  const files = world({ 'moon.moonlight': ['Moonlight 🌌', 'Moonlight Light'], 'dracula.theme': ['Dracula', 'Moonlight Light'], 'icons.pack': [] })
  files[`${EXTENSIONS}/plain.ext/package.json`] = JSON.stringify({ name: 'plain' })
  expect(await listThemes(host(files))).toEqual(['Dracula', 'Moonlight 🌌', 'Moonlight Light'])
  expect(await listThemes({ ...host({}) })).toEqual([])
})

test('the editor\'s built-in themes are listed too, under a version folder, with %key% labels filled from package.nls.json', async () => {
  const builtIn = '/local/Programs/Microsoft VS Code/e646868227/resources/app/extensions'
  const files = world({ 'moon.moonlight': ['Moonlight 🌌'] })
  files[`${builtIn}/theme-defaults/package.json`] = pack(['%darkModernThemeLabel%', '%lightPlusColorThemeLabel%'])
  files[`${builtIn}/theme-defaults/package.nls.json`] = JSON.stringify({ darkModernThemeLabel: 'Dark Modern', lightPlusColorThemeLabel: 'Light+' })
  files[`${builtIn}/theme-seti/package.json`] = JSON.stringify({ contributes: { iconThemes: [{ id: 'vs-seti', label: '%themeLabel%', path: './icons.json' }] } })
  expect(await listThemes({ ...host(files), localAppData: '/local' })).toEqual(['Dark Modern', 'Light+', 'Moonlight 🌌'])
})

test('the rows are Follow VS Code with the active theme, then the active and the chosen ones first, then the rest', () => {
  const rows = themeRows(['Dracula', 'Moonlight 🌌', 'Nord', 'Solarized'], 'Moonlight 🌌', 'Nord')
  expect(rows.map(row => [row.value, row.label, row.detail, row.tag, row.isChosen])).toEqual([
    ['', 'Follow VS Code', 'Moonlight 🌌', undefined, false],
    ['Moonlight 🌌', 'Moonlight 🌌', undefined, '(selected on VS Code)', false],
    ['Nord', 'Nord', undefined, undefined, true],
    ['Dracula', 'Dracula', undefined, undefined, false],
    ['Solarized', 'Solarized', undefined, undefined, false],
  ])
  expect(themeRows(['Nord'], undefined, '')[0]).toEqual({ value: '', label: 'Follow VS Code', isChosen: true })
  expect(themeRows([], undefined, 'Typed Theme').map(row => row.label)).toEqual(['Follow VS Code', 'Typed Theme'])
})

function fakeSurface() {
  const posts: any[] = []
  let pointer: (event: any) => void = () => {}
  const surface: any = {
    elements: { Box: (props: any) => props, Text: (props: any) => props },
    state: undefined,
    columns: 40,
    setState: (state: any) => (surface.state = state),
    every: () => () => {},
    onPointer: (handler: (event: any) => void) => (pointer = handler),
    post: (data: any) => posts.push(data),
  }
  return { surface, posts, point: (event: object) => pointer(event) }
}

const PICKER = {
  glyph: '✓',
  tip: { glyph: '✓', text: 'colors it' },
  still: true,
  rows: [
    { value: '', label: 'Follow VS Code', detail: 'Moonlight', isChosen: false },
    { value: 'Moonlight', label: 'Moonlight', tag: '(selected on VS Code)', isChosen: false },
    { value: 'Nord', label: 'Nord', isChosen: true },
  ],
}

test('the chosen row is surface3 with primary-70 text and a check, the row under the pointer is lifted with accent text', () => {
  const list = fakeSurface()
  const rest = JSON.stringify(Themes(PICKER as never, list.surface))
  expect(rest).toContain(`"backgroundColor":"${THEME.surface3}"`)
  expect(rest).toContain(`"color":"${THEME.ok}"`)
  expect(rest).toContain('✓ Nord')
  expect(rest).not.toContain(THEME.lifted)
  expect(rest).toContain('"·"')
  expect(rest).toContain(' (selected on VS Code)')
  list.point({ type: 'move', x: 3, y: 1 })
  const lit = JSON.stringify(Themes(PICKER as never, list.surface))
  expect(lit).toContain(`"backgroundColor":"${THEME.lifted}"`)
  expect(lit).toContain(`"color":"${THEME.accent}"`)
  expect(list.posts.at(-1)).toEqual({ type: 'tip', id: 'theme-1', glyph: '✓', label: 'Moonlight', text: 'colors it' })
  list.point({ type: 'leave', x: 3, y: 1 })
  expect(JSON.stringify(Themes(PICKER as never, list.surface))).not.toContain(THEME.lifted)
  expect(mix(THEME.surface3, THEME.lifted, 1)).toBe(THEME.lifted)
})

test('a click on a row posts its value, Follow VS Code posts an empty one', () => {
  const list = fakeSurface()
  Themes(PICKER as never, list.surface)
  list.point({ type: 'down', button: 'left', x: 2, y: 2 })
  list.point({ type: 'down', button: 'left', x: 2, y: 0 })
  expect(list.posts.filter(post => post.type === 'code-theme')).toEqual([{ type: 'code-theme', value: 'Nord' }, { type: 'code-theme', value: '' }])
})

const SETTING_ROWS = (value: string) => [
  { key: 'mod-transcript.fold_turns', label: 'Fold finished turns', description: 'Starts folded', kind: 'boolean', value: true, provider: { kind: 'plugin', name: 'mod-transcript' }, isLocked: false },
  { key: 'mod-transcript.code_theme', label: 'Code theme', description: 'The VS Code color theme', kind: 'text', value, provider: { kind: 'plugin', name: 'mod-transcript' }, isLocked: false },
]

// The settings panel of a mod whose extension folder holds `files`, and the config.set calls it makes.
async function panel($: any, on: any, files: Record<string, string>, chosen: string) {
  const saved: unknown[] = []
  on('store.get', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 0, mtimeMs: 0, isLink: false } }))
  on('fs.read', reading((_$: unknown, e: { path: string }) => ({ value: files[String(e.path).replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')] ?? '' })))
  on('fs.list', (_$: unknown, e: { path: string }) => {
    const base = String(e.path).replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
    const names = Object.keys(files).filter(file => file.startsWith(`${base}/`)).map(file => file.slice(base.length + 1).split('/')[0]!)
    if (!names.length) throw new Error('missing')
    return { value: [...new Set(names)].map(name => ({ name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false })) }
  })
  mock.env(on, { USERPROFILE: '/home', APPDATA: '/home/AppData/Roaming' })
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('config.list', () => ({ value: SETTING_ROWS(chosen) as never }))
  on('config.set', (_$: unknown, e: { key: string; value: unknown }) => {
    saved.push([e.key, e.value])
    return { value: e.value }
  })
  mock.clock(on)
  on('session.start', () => ({ cwd: '/w' }))
  await $.command.run({ command: 'mod-transcript', args: 'settings' } as never)
  const ui = await $.ui.mount({
    plugin: 'mod-transcript',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'toggle-settings',
    props: { title: 'mod-transcript', isFocused: false, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  } as never)
  return { ui, saved }
}

const rowsOf = async (ui: any) => (await ui.find({ type: 'Client', key: 'themes-list' })).props.props.rows as { value: string; label: string; detail?: string; tag?: string; isChosen: boolean }[]

for (const icons of ['safe', 'nerd'] as const) {
  test(`icons=${icons}: the settings panel lists Follow VS Code and every installed theme in a Code theme card, tags the active one, marks the chosen one, and saves a click`, { options: { icons } }, async ($, on) => {
    const files = world({ 'moon.moonlight': ['Moonlight 🌌', 'Moonlight Light'], 'dracula.theme': ['Dracula'] })
    const { ui, saved } = await panel($, on, files, 'Dracula')
    expect((await rowsOf(ui)).map(row => [row.label, row.detail, row.tag, row.isChosen])).toEqual([
      ['Follow VS Code', 'Moonlight 🌌', undefined, false],
      ['Moonlight 🌌', undefined, '(selected on VS Code)', false],
      ['Dracula', undefined, undefined, true],
      ['Moonlight Light', undefined, undefined, false],
    ])
    expect((await ui.find({ type: 'Client', key: 'themes-list' })).props.props.glyph).toBe(icons === 'safe' ? '✓' : String.fromCodePoint(0xeab2))
    // One card for the setting: the section, not the plain settings card.
    expect(await ui.find({ key: 'themes-block' })).toBeDefined()
    expect(await ui.find({ key: 'setting-head-1' })).toBeUndefined()
    expect(JSON.stringify(await ui.drawn({ in: 'setting-name-0' }))).toContain(' Fold finished turns ')
    // The head: the mod name segment carries the mod icon (Nerd only), the gear chip always the gear; the hint sits in the pinned footer.
    const name = JSON.stringify(await ui.drawn({ in: 'mod-transcript-settings-tab-name' }))
    const chip = JSON.stringify(await ui.drawn({ in: 'mod-transcript-settings-tab' }))
    const icon = String.fromCodePoint(0xf09ed)
    const gear = icons === 'safe' ? '⊛' : String.fromCodePoint(0xf0493)
    expect(name).toContain('Transcript')
    expect(name.includes(icon)).toBe(icons === 'nerd')
    expect(chip).toContain(gear)
    expect(chip.includes(icon)).toBe(false)
    expect(JSON.stringify(await ui.find({ key: 'pane-footer' }))).toContain('Click a setting to change it')
    expect(JSON.stringify(await ui.drawn())).toContain('mod-transcript')
    await ui.pointer({ in: 'themes-list', type: 'down', button: 'left', x: 2, y: 3 })
    expect(saved).toEqual([['mod-transcript.code_theme', 'Moonlight Light']])
    await ui.pointer({ in: 'themes-list', type: 'down', button: 'left', x: 2, y: 0 })
    expect(saved.at(-1)).toEqual(['mod-transcript.code_theme', ''])
    await ui.unmount()
  })
}

test('an empty setting marks Follow VS Code as the chosen row', async ($, on) => {
  const { ui } = await panel($, on, world({ 'moon.moonlight': ['Moonlight 🌌'] }), '')
  expect((await rowsOf(ui)).map(row => row.isChosen)).toEqual([true, false])
  await ui.unmount()
})

test('a long list folds behind an expand control that says how many more, and a click shows them all and back', async ($, on) => {
  const labels = Array.from({ length: 12 }, (_, n) => `Theme ${String(n).padStart(2, '0')}`)
  const { ui } = await panel($, on, world({ 'many.themes': labels }, 'Theme 00'), '')
  expect(await rowsOf(ui)).toHaveLength(8)
  const more = () => ui.find({ type: 'Client', key: 'themes-more' })
  expect(textOf((await more()).props.props.label)).toBe('5 more')
  await ui.pointer({ in: 'themes-more', type: 'down', button: 'left', x: 1, y: 0 })
  expect(await rowsOf(ui)).toHaveLength(13)
  expect((await more()).props.props.label).toBe('Show fewer')
  await ui.pointer({ in: 'themes-more', type: 'down', button: 'left', x: 1, y: 0 })
  expect(await rowsOf(ui)).toHaveLength(8)
  await ui.unmount()
})

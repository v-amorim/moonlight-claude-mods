// tests/vstheme.test.ts, by v-amorim: finding a VS Code theme and matching scopes, on a fixture and on the real Moonlight file when present.
import { expect, test } from 'claude-code/testing'

import { activeLabel, buildTheme, findThemePath, hexOf, loadTheme, parseJsonc, styleFor, type ThemeHost } from '../hooks/vstheme'

const FIXTURE = {
  colors: { 'editor.foreground': '#111111' },
  tokenColors: [
    { scope: 'comment', settings: { foreground: '#333333', fontStyle: 'italic' } },
    { scope: ['string', 'constant.numeric'], settings: { foreground: '#444444' } },
    { scope: 'string.quoted.double', settings: { foreground: '#555555' } },
    { scope: 'keyword.control, storage.type', settings: { foreground: '#666666' } },
    { scope: 'keyword.control', settings: { fontStyle: 'bold' } },
    { scope: 'meta.function entity.name.function', settings: { foreground: '#777777' } },
    { scope: 'entity.name.function', settings: { foreground: '#888888' } },
  ],
}

const theme = buildTheme(FIXTURE, 'Fixture', '/x.json')
const at = (...scopes: string[]) => styleFor(theme, scopes)

test('a scope takes the colour of a selector that is a dotted prefix of it', () => {
  expect(at('source.ts', 'comment.line.double-slash.ts').color).toBe('#333333')
  expect(at('source.ts', 'comment.line.double-slash.ts').italic).toBe(true)
})

test('a selector that only shares letters with a scope does not match', () => {
  expect(at('source.ts', 'commentary.line').color).toBe('#111111')
  expect(at('source.ts', 'strings.x').color).toBe('#111111')
})

test('the longer selector wins over the shorter one', () => {
  expect(at('source.ts', 'string.quoted.double.ts').color).toBe('#555555')
  expect(at('source.ts', 'string.quoted.single.ts').color).toBe('#444444')
})

test('a comma separated scope string and a scope array both list selectors', () => {
  expect(at('source.ts', 'storage.type.function.ts').color).toBe('#666666')
  expect(at('source.ts', 'constant.numeric.decimal.ts').color).toBe('#444444')
})

test('colour and font style come from different rules when no rule sets both', () => {
  const style = at('source.ts', 'keyword.control.flow.ts')
  expect(style.color).toBe('#666666')
  expect(style.bold).toBe(true)
})

test('a descendant selector needs its parent scope above the token', () => {
  expect(at('source.ts', 'meta.function.ts', 'entity.name.function.ts').color).toBe('#777777')
  expect(at('source.ts', 'entity.name.function.ts').color).toBe('#888888')
})

test('a deeper scope overrides an outer one, and an unmatched stack gets the editor foreground', () => {
  expect(at('source.ts', 'comment.block.ts', 'string.quoted.double.ts').color).toBe('#555555')
  expect(at('source.ts', 'variable.other.readwrite.ts').color).toBe('#111111')
})

test('a rule without a scope sets the foreground when the theme names none', () => {
  const plain = buildTheme({ tokenColors: [{ settings: { foreground: '#222222' } }, ...FIXTURE.tokenColors] }, 'No colors', '/y.json')
  expect(plain.foreground).toBe('#222222')
  expect(styleFor(plain, ['source.ts', 'variable.other.ts']).color).toBe('#222222')
})

test('hexOf drops alpha and spells short colours out', () => {
  expect(hexOf('#abcd1280')).toBe('#ABCD12')
  expect(hexOf('#f0a')).toBe('#FF00AA')
  expect(hexOf('red')).toBeUndefined()
})

test('parseJsonc reads comments and trailing commas but leaves strings alone', () => {
  const parsed = parseJsonc('{\n // note\n "a": "http://x", /* gap */ "b": [1, 2,],\n}')
  expect(parsed).toEqual({ a: 'http://x', b: [1, 2] })
})

// A machine of files: path to text; a folder lists the names directly under it.
const machine = (files: Record<string, string>): ThemeHost => ({
  home: '/home/me',
  appData: '/home/me/AppData/Roaming',
  read: async path => (path in files ? files[path]! : Promise.reject(new Error('missing'))),
  list: async path => {
    const names = Object.keys(files).filter(file => file.startsWith(`${path}/`)).map(file => file.slice(path.length + 1).split('/')[0]!)
    if (!names.length) throw new Error('missing')
    return [...new Set(names)]
  },
})

const PACKAGE = JSON.stringify({ contributes: { themes: [{ label: 'Night 🌌', path: './themes/night.json' }, { label: 'Day', path: './themes/day.json' }] } })
const EXT = '/home/me/.vscode/extensions/acme.night-1.0.0'
const FILES: Record<string, string> = {
  '/home/me/AppData/Roaming/Code/User/settings.json': '{\n  // "workbench.colorTheme": "Day",\n  "workbench.colorTheme": "Night \\ud83c\\udf0c",\n}',
  [`${EXT}/package.json`]: PACKAGE,
  [`${EXT}/themes/night.json`]: '{ // a comment\n "include": "./base.json", "tokenColors": [{ "scope": "comment", "settings": { "foreground": "#010203" } }], }',
  [`${EXT}/themes/base.json`]: JSON.stringify({ colors: { 'editor.foreground': '#0A0B0C' }, tokenColors: [{ scope: 'string', settings: { foreground: '#0D0E0F' } }, { scope: 'comment', settings: { foreground: '#999999' } }] }),
}

test('the active label is the uncommented workbench.colorTheme, emoji escapes decoded', async () => {
  expect(await activeLabel(machine(FILES))).toBe('Night 🌌')
})

test('a label matches only a theme an extension contributes with exactly that label', async () => {
  expect(await findThemePath(machine(FILES), 'Night 🌌')).toBe(`${EXT}/themes/night.json`)
  expect(await findThemePath(machine(FILES), 'Night')).toBeUndefined()
})

test('an empty setting follows VS Code, and the include stacks under the theme', async () => {
  const loaded = await loadTheme(machine(FILES), '')
  expect(loaded?.path).toBe(`${EXT}/themes/night.json`)
  expect(loaded?.foreground).toBe('#0A0B0C')
  expect(styleFor(loaded!, ['source.ts', 'comment.line.ts']).color).toBe('#010203')
  expect(styleFor(loaded!, ['source.ts', 'string.quoted.ts']).color).toBe('#0D0E0F')
})

test('a named setting wins over the editor, and an unknown label resolves to nothing', async () => {
  expect((await loadTheme(machine(FILES), 'Night 🌌'))?.label).toBe('Night 🌌')
  expect(await loadTheme(machine(FILES), 'Nope')).toBeNull()
  expect(await loadTheme(machine({}), '')).toBeNull()
})

test('a known path is reused when its label still matches, and searched again when it is gone', async () => {
  const files = { ...FILES }
  expect((await loadTheme(machine(files), '', { label: 'Night 🌌', path: `${EXT}/themes/night.json` }))?.path).toBe(`${EXT}/themes/night.json`)
  expect((await loadTheme(machine(files), '', { label: 'Night 🌌', path: '/gone.json' }))?.path).toBe(`${EXT}/themes/night.json`)
})

// The test kit has no real file system, so the Moonlight theme is checked through rules copied from its tokenColors (v-amorim.moonlight-vscode-theme 6.0.0).
const MOONLIGHT = {
  colors: { 'editor.foreground': '#EEEEFA' },
  tokenColors: [
    { scope: ['entity.name.class', 'entity.name.function'], settings: { fontStyle: 'bold' } },
    { scope: ['entity.name.class', 'entity.name.function'], settings: { foreground: '#b0b9e5' } },
    { scope: ['entity.name.function.member'], settings: { foreground: '#698cff' } },
    { scope: ['constant.numeric'], settings: { foreground: '#b0c8ff' } },
    { scope: ['constant.language', 'constant.language.boolean'], settings: { foreground: '#d8a8f0' } },
    { scope: ['constant.language.undefined.ts'], settings: { fontStyle: 'bold italic' } },
    { scope: ['constant.language.undefined.ts'], settings: { foreground: '#ffafaf' } },
    { scope: ['markup.inserted'], settings: { foreground: '#49ef95' } },
    { scope: ['markup.deleted'], settings: { foreground: '#ca5f71' } },
  ],
}

test('the Moonlight rules colour a function bold, a member over it, and leave other scopes the editor foreground', () => {
  const moon = buildTheme(MOONLIGHT, 'Moonlight 🌌', '/moon.json')
  expect(moon.foreground).toBe('#EEEEFA')
  expect(styleFor(moon, ['source.ts', 'constant.numeric.decimal.ts']).color).toBe('#B0C8FF')
  expect(styleFor(moon, ['source.ts', 'entity.name.function.ts'])).toMatchObject({ color: '#B0B9E5', bold: true })
  expect(styleFor(moon, ['source.ts', 'entity.name.function.member.ts']).color).toBe('#698CFF')
  expect(styleFor(moon, ['source.ts', 'entity.name.function.member.ts']).bold).toBe(true)
  expect(styleFor(moon, ['source.ts', 'constant.language.undefined.ts'])).toMatchObject({ color: '#FFAFAF', bold: true, italic: true })
  expect(styleFor(moon, ['source.ts', 'constant.language.boolean.true.ts']).color).toBe('#D8A8F0')
  expect(styleFor(moon, ['source.diff', 'markup.deleted.diff']).color).toBe('#CA5F71')
  expect(styleFor(moon, ['source.ts', 'variable.other.readwrite.ts']).color).toBe('#EEEEFA')
})

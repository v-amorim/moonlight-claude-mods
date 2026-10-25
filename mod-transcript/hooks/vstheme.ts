// mod-transcript / hooks/vstheme.ts, by v-amorim: a VS Code color theme found on disk and asked for the style of a scope stack; pure, the caller reads files.

export type Style = { color?: string; bold?: boolean; italic?: boolean; underline?: boolean }

type Rule = { selector: string[]; rank: number; order: number; style: Style }

export type Theme = { label: string; path: string; foreground: string | undefined; rules: Rule[]; cache: Map<string, Style> }

// What the theme finder needs from the machine: files by path and a folder's entry names; both reject when missing.
export type ThemeHost = {
  home: string
  appData: string
  localAppData?: string
  programFiles?: string
  read: (path: string) => Promise<string>
  list: (path: string) => Promise<string[]>
}

// JSONC to JSON: comments and trailing commas go, strings stay as they are.
export function parseJsonc(source: string): any {
  let out = ''
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!
    if (c === '"') {
      let end = i + 1
      while (end < source.length && source[end] !== '"') end += source[end] === '\\' ? 2 : 1
      out += source.slice(i, end + 1)
      i = end
    } else if (c === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++
      out += '\n'
    } else if (c === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2)
      i = end < 0 ? source.length : end + 1
    } else out += c
  }
  return JSON.parse(out.replace(/^﻿/, '').replace(/,(\s*[}\]])/g, '$1'))
}

// #rgb, #rrggbb or #rrggbbaa as #rrggbb; anything else is not a color.
export function hexOf(value: unknown) {
  if (typeof value !== 'string') return undefined
  const hex = /^#([0-9a-f]{3,8})$/i.exec(value.trim())?.[1]
  if (!hex) return undefined
  if (hex.length === 3 || hex.length === 4) return `#${[...hex.slice(0, 3)].map(digit => digit + digit).join('')}`.toUpperCase()
  return hex.length === 6 || hex.length === 8 ? `#${hex.slice(0, 6)}`.toUpperCase() : undefined
}

function styleOf(settings: any): Style {
  const style: Style = {}
  const color = hexOf(settings?.foreground)
  if (color) style.color = color
  if (typeof settings?.fontStyle === 'string') {
    const words = settings.fontStyle.split(/\s+/)
    style.bold = words.includes('bold')
    style.italic = words.includes('italic')
    style.underline = words.includes('underline')
  }
  return style
}

// A selector is its space-separated scopes; the last is the one a token's scope must match.
const selectorsOf = (scope: unknown): string[][] =>
  (Array.isArray(scope) ? scope : typeof scope === 'string' ? [scope] : [])
    .flatMap(each => String(each).split(','))
    .map(each => each.trim().split(/\s+/).filter(Boolean))
    .filter(each => each.length > 0 && !each.some(part => part.startsWith('-')))

// The theme's tokenColors (those of `parents` first, as an `include` stacks them) and its default foreground.
export function buildTheme(json: any, label: string, path: string, parents: any[] = []): Theme {
  const rules: Rule[] = []
  let foreground: string | undefined
  for (const source of [...parents, json]) {
    foreground = hexOf(source?.colors?.['editor.foreground']) ?? foreground
    for (const entry of Array.isArray(source?.tokenColors) ? source.tokenColors : []) {
      if (!entry || typeof entry !== 'object') continue
      const style = styleOf(entry.settings)
      const selectors = entry.scope === undefined ? [] : selectorsOf(entry.scope)
      if (entry.scope === undefined) foreground = style.color ?? foreground
      for (const selector of selectors) rules.push({ selector, rank: selector[selector.length - 1]!.length + (selector.length - 1) / 2, order: rules.length, style })
    }
  }
  return { label, path, foreground, rules, cache: new Map() }
}

const matches = (scope: string, selector: string) => scope === selector || scope.startsWith(`${selector}.`)

// A rule's selector matches a scope when its last part is a dotted prefix of it and the parts before it are prefixes of scopes above.
function matchAt(selector: string[], stack: string[], at: number) {
  if (!matches(stack[at]!, selector[selector.length - 1]!)) return false
  let up = at - 1
  for (let part = selector.length - 2; part >= 0; part--) {
    while (up >= 0 && !matches(stack[up]!, selector[part]!)) up--
    if (up < 0) return false
    up--
  }
  return true
}

// Like VS Code: scopes are read from the outermost in; within one scope the longest matching selector wins (a later rule on a tie), each property on its own, and a deeper scope overrides what an outer one set.
export function styleFor(theme: Theme, stack: string[]): Style {
  const key = stack.join(' ')
  const known = theme.cache.get(key)
  if (known) return known
  const out: Style = { color: theme.foreground }
  stack.forEach((_, at) => {
    const best: { color?: Rule; bold?: Rule; italic?: Rule; underline?: Rule } = {}
    const beats = (rule: Rule, held?: Rule) => !held || rule.rank > held.rank || (rule.rank === held.rank && rule.order > held.order)
    for (const rule of theme.rules) {
      if (!matchAt(rule.selector, stack, at)) continue
      for (const property of ['color', 'bold', 'italic', 'underline'] as const) {
        if (rule.style[property] !== undefined && beats(rule, best[property])) best[property] = rule
      }
    }
    for (const property of ['color', 'bold', 'italic', 'underline'] as const) {
      const rule = best[property]
      if (rule) (out as any)[property] = rule.style[property]
    }
  })
  theme.cache.set(key, out)
  return out
}

// VS Code's user settings, as each editor spells its place on Windows, macOS and Linux.
export const settingsPaths = ({ home, appData }: Pick<ThemeHost, 'home' | 'appData'>) =>
  ['Code', 'Code - Insiders', 'Cursor', 'VSCodium'].flatMap(name => [
    ...(appData ? [`${appData}/${name}/User/settings.json`] : []),
    `${home}/Library/Application Support/${name}/User/settings.json`,
    `${home}/.config/${name}/User/settings.json`,
  ])

export const extensionRoots = (home: string) => ['.vscode', '.vscode-insiders', '.cursor', '.vscode-oss'].map(name => `${home}/${name}/extensions`)

const EDITORS = ['Microsoft VS Code', 'Microsoft VS Code Insiders', 'cursor', 'VSCodium']

// Where each editor keeps the extensions it ships with (Dark Modern, Monokai and the rest); a Windows install nests them under a version folder.
async function builtInRoots(host: ThemeHost) {
  const installs = [
    ...(host.localAppData ? EDITORS.map(name => `${host.localAppData}/Programs/${name}`) : []),
    ...(host.programFiles ? EDITORS.map(name => `${host.programFiles}/${name}`) : []),
  ]
  const nested = await Promise.all(installs.map(async install => [install, ...(await host.list(install).catch(() => [] as string[])).map(folder => `${install}/${folder}`)]))
  return [
    ...nested.flat().map(dir => `${dir}/resources/app/extensions`),
    '/Applications/Visual Studio Code.app/Contents/Resources/app/extensions',
    `${host.home}/Applications/Visual Studio Code.app/Contents/Resources/app/extensions`,
    '/usr/share/code/resources/app/extensions',
    '/opt/visual-studio-code/resources/app/extensions',
    '/usr/lib/code/extensions',
  ]
}

type Found = { label: string; path: string }

// Every color theme an extension folder contributes, `%key%` labels filled from its package.nls.json as VS Code shows them.
async function themesIn(host: ThemeHost, root: string, folder: string): Promise<Found[]> {
  const text = await host.read(`${root}/${folder}/package.json`).catch(() => '')
  if (!text.includes('"themes"')) return []
  try {
    const themes: Contributed[] = parseJsonc(text)?.contributes?.themes ?? []
    const needsNls = themes.some(theme => theme.label?.startsWith('%'))
    const nls: Record<string, string> = needsNls ? (parseJsonc(await host.read(`${root}/${folder}/package.nls.json`).catch(() => '{}')) ?? {}) : {}
    return themes.flatMap(theme => {
      const label = theme.label?.startsWith('%') ? nls[theme.label.slice(1, -1)] : theme.label
      return typeof label === 'string' && typeof theme.path === 'string' ? [{ label, path: `${root}/${folder}/${theme.path.replace(/^\.\//, '')}` }] : []
    })
  } catch {
    return []
  }
}

// The user's extensions first, then the editor's own, so an installed theme wins a label it shares with a built-in one.
async function allThemes(host: ThemeHost): Promise<Found[]> {
  const roots = [...extensionRoots(host.home), ...(await builtInRoots(host))]
  const perRoot = await Promise.all(roots.map(async root => (await Promise.all((await host.list(root).catch(() => [] as string[])).map(folder => themesIn(host, root, folder)))).flat()))
  return perRoot.flat()
}

// The theme label VS Code is set to: its settings file is JSONC, so a line is matched, not parsed.
export async function activeLabel(host: ThemeHost) {
  for (const path of settingsPaths(host)) {
    const found = /^[ \t]*"workbench\.colorTheme"\s*:\s*("(?:[^"\\]|\\.)*")/m.exec(await host.read(path).catch(() => ''))?.[1]
    if (found) return JSON.parse(found) as string
  }
  return undefined
}

type Contributed = { label?: string; path?: string }

// The theme file of the first extension that contributes a theme with exactly this label.
export async function findThemePath(host: ThemeHost, label: string) {
  return (await allThemes(host)).find(theme => theme.label === label)?.path
}

// Every color theme label the user's extensions and the editor's own contribute, each once, in alphabetical order.
export async function listThemes(host: ThemeHost) {
  return [...new Set((await allThemes(host)).map(theme => theme.label))].sort((a, b) => a.localeCompare(b))
}

const dirOf =(path: string) => path.slice(0, path.lastIndexOf('/'))

// The theme file and the files it includes, the included first so the including theme overrides them.
async function chainOf(host: ThemeHost, path: string, depth = 0): Promise<any[]> {
  const json = parseJsonc(await host.read(path))
  if (typeof json?.include !== 'string' || depth >= 4) return [json]
  return [...(await chainOf(host, `${dirOf(path)}/${json.include.replace(/^\.\//, '')}`, depth + 1)), json]
}

async function readTheme(host: ThemeHost, path: string, label: string): Promise<Theme> {
  const chain = await chainOf(host, path)
  return buildTheme(chain[chain.length - 1], label, path, chain.slice(0, -1))
}

// The theme the setting names (empty: the one VS Code uses), or null when none resolves. `known` is a theme found earlier, which saves the search of the extensions.
export async function loadTheme(host: ThemeHost, setting: string, known?: { label: string; path: string }): Promise<Theme | null> {
  try {
    const label = setting.trim() || (await activeLabel(host))
    if (!label) return null
    const again = known?.label === label ? await readTheme(host, known.path, label).catch(() => null) : null
    if (again) return again
    const path = await findThemePath(host, label)
    return path ? await readTheme(host, path, label) : null
  } catch {
    return null
  }
}

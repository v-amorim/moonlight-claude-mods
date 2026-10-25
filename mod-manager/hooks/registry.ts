// mod-manager / hooks/registry.ts, by v-amorim
// Discovers installed mods, reads their features and writes enabled state to settings.
import type { Previews, Range } from './settings'
import { fill } from './theme'
import shown from './text'

export type Io = {
  read: (path: string) => Promise<string>
  write: (path: string, text: string) => Promise<void>
  list: (path: string) => Promise<{ name: string; kind: string }[]>
  home: () => Promise<string>
  // CLAUDE_CODE_PLUGIN_DIRS from the process environment, beside the one in settings.json.
  pluginDirs?: () => Promise<string>
  // CLAUDE_CONFIG_DIR when set, else ~/.claude.
  config: () => Promise<string>
  // A process environment variable (the refresh opt-outs).
  env?: (name: string) => Promise<string | undefined>
  // Runs the claude CLI.
  run?: (argv: string[], timeoutMs: number) => Promise<{ exitCode: number; stdout: string; stderr: string }>
  // This mod's store, for the refresh timestamp.
  store?: { get: (key: string) => Promise<unknown>; set: (key: string, value: unknown) => Promise<void> }
  now?: () => number
}

export type Feature = { title: string; detail: string }
export type ShowcaseAction = { label: string; command: string; args?: string }
export type Showcase = { tagline?: string; features?: Feature[]; actions?: ShowcaseAction[]; editors?: string[]; previews?: Previews; cost?: { summary: string } }

export type ModInfo = {
  id: string
  name: string
  description: string
  version: string
  root: string
  source: 'dir' | 'installed'
  // Lives in ~/.claude/mods: listed as the person's own even when installed from their local marketplace.
  isOwn: boolean
  enabled: boolean
  events: string[]
  commands: string[]
  showcase: Showcase | null
  // How many settings its manifest declares (userConfig); /config lists them only while it is on.
  settings: number
  // Its userConfig fields, for the min and max a number setting declares.
  fields: Record<string, Range>
}

export type Outcome = { ok: true; needsRestart?: boolean } | { ok: false; reason: string }

export const SELF = 'mod-manager'

const BLURBS: Record<string, string> = shown.blurbs

type Json = Record<string, any>

const readJson = async (io: Io, path: string): Promise<Json | null> => {
  try {
    return JSON.parse(String(await io.read(path))) as Json
  } catch {
    return null
  }
}

const slashes = (path: string) => path.replace(/\\/g, '/')

const homeDir = async (io: Io) => slashes(await io.home())

const expand = (path: string, home: string) => slashes(path.startsWith('~') ? home + path.slice(1) : path)

const tildeForm = (path: string, home: string) => (path.startsWith(home) ? '~' + path.slice(home.length) : path)

const separatorFor = (home: string) => (/^[A-Za-z]:/.test(home) ? ';' : ':')

const splitDirs = (value: string, separator: string) =>
  value
    .split(separator)
    .map(entry => entry.trim())
    .filter(Boolean)

const scan = (source: string) => {
  const events = new Set<string>()
  for (const found of source.matchAll(/\bon\(\s*['"]([\w.*]+)['"](?:\s*,\s*\{\s*component:\s*['"](\w+)['"])?/g)) {
    events.add(found[2] ? `${found[1]}:${found[2]}` : found[1]!)
  }
  const commands = [...source.matchAll(/command\.register\(\{\s*name:\s*['"]([\w-]+)['"]/g)].map(found => found[1]!)
  return { events: [...events], commands }
}

// A cost's longer readme is for the mod's own page elsewhere; only its one-sentence summary is kept.
const showcaseOf = (json: Json | null) => {
  if (!json) return null
  const { cost, ...rest } = json
  return (typeof cost?.summary === 'string' ? { ...rest, cost: { summary: cost.summary } } : rest) as Showcase
}

const inspect = async (
  io: Io,
  root: string,
  source: ModInfo['source'],
  id: string,
  enabled: boolean,
): Promise<ModInfo | null> => {
  const hooks = await readJson(io, `${root}/hooks/hooks.json`)
  const modules: unknown = hooks?.modules
  if (!Array.isArray(modules)) return null
  const manifest = (await readJson(io, `${root}/.claude-plugin/plugin.json`)) ?? {}
  let text = ''
  for (const module of modules) {
    text += await io.read(`${root}/hooks/${String(module).replace(/^\.\//, '')}`).catch(() => '')
  }
  return {
    isOwn: false,
    id,
    name: String(manifest.name ?? root.split('/').pop()),
    description: String(manifest.description ?? ''),
    version: String(manifest.version ?? ''),
    root,
    source,
    enabled,
    ...scan(text),
    showcase: showcaseOf(await readJson(io, `${root}/showcase.json`)),
    settings: Object.keys(manifest.userConfig ?? {}).length,
    fields: manifest.userConfig ?? {},
  }
}

export async function discover(io: Io): Promise<ModInfo[]> {
  const home = await homeDir(io)
  const claudeDir = slashes(await io.config())
  const settings = (await readJson(io, `${claudeDir}/settings.json`)) ?? {}
  const separator = separatorFor(home)
  const fromProcess = splitDirs(String((await io.pluginDirs?.().catch(() => '')) ?? ''), separator)
  const fromSettings = splitDirs(String(settings.env?.CLAUDE_CODE_PLUGIN_DIRS ?? ''), separator)
  const active = [...new Set([...fromSettings, ...fromProcess].map(entry => expand(entry, home)))]

  const roots = new Set(active)
  for (const entry of await io.list(`${claudeDir}/mods`).catch(() => [])) {
    if (entry.kind === 'dir') roots.add(`${claudeDir}/mods/${entry.name}`)
  }

  // A folder installed from the local marketplace loads in place: its installed entry is the one that loads and toggles.
  const installed = await readJson(io, `${claudeDir}/plugins/installed_plugins.json`)
  const entries = Object.entries<any[]>(installed?.plugins ?? {}).map(([id, list]) => ({ id, entry: Array.isArray(list) ? (list.find(candidate => candidate?.scope === 'user') ?? list[0]) : undefined }))
  const same = (a: string, b: string) => slashes(a).replace(/\/+$/, '').toLowerCase() === slashes(b).replace(/\/+$/, '').toLowerCase()
  const isOwnPath = (path: string) => slashes(path).toLowerCase().startsWith(`${claudeDir}/mods/`.toLowerCase())

  // A local marketplace over ~/.claude/mods loads its plugins in place, though the install record names a cache path.
  const markets = (await readJson(io, `${claudeDir}/plugins/known_marketplaces.json`)) ?? {}
  const ownMarkets = new Set(
    Object.entries<any>(markets)
      .filter(([, market]) => [market?.source?.path, market?.installLocation].some(path => typeof path === 'string' && same(path, `${claudeDir}/mods`)))
      .map(([name]) => name),
  )
  const folderOf = (id: string) => {
    const [name, market] = id.split('@')
    return market && ownMarkets.has(market) ? `${claudeDir}/mods/${name}` : null
  }
  const installedFolders = entries.map(({ id }) => folderOf(id)).filter((folder): folder is string => folder !== null)

  const mods: ModInfo[] = []
  for (const root of roots) {
    if (!active.includes(root) && installedFolders.some(folder => same(folder, root))) continue
    if (!active.includes(root) && entries.some(({ entry }) => entry?.installPath && same(entry.installPath, root))) continue
    const mod = await inspect(io, root, 'dir', `dir:${root}`, active.includes(root))
    // A listed dir loads as `<name>@inline`, which enabledPlugins can switch off without unlisting it.
    if (mod) mods.push({ ...mod, isOwn: true, enabled: mod.enabled && settings.enabledPlugins?.[inlineId(mod)] !== false })
  }

  for (const { id, entry } of entries) {
    if (!entry?.installPath) continue
    const folder = folderOf(id)
    // A switched-off install of a folder that already loads as a listed dir would only repeat that row.
    if (folder && settings.enabledPlugins?.[id] !== true && active.some(root => same(root, folder))) continue
    const mod = await inspect(io, folder ?? slashes(entry.installPath), 'installed', id, settings.enabledPlugins?.[id] === true)
    if (mod) mods.push({ ...mod, isOwn: folder !== null || isOwnPath(entry.installPath) })
  }
  return mods.sort((a, b) => a.name.localeCompare(b.name))
}

export const featuresOf = (mod: ModInfo): Feature[] =>
  mod.showcase?.features ??
  mod.events.map(event => ({
    title: event,
    detail: BLURBS[event.split(':')[0]!] ?? fill(shown.reactsTo, { event }),
  }))

const refuse = (reason: string): Outcome => ({ ok: false, reason })

const inlineId = (mod: ModInfo) => `${mod.name}@inline`

const untouched = (before: Json, after: Json, edited: string[]) =>
  Object.keys(before).every(key => edited.includes(key) || JSON.stringify(before[key]) === JSON.stringify(after[key])) &&
  Object.keys(after).every(key => edited.includes(key) || key in before)

export async function setEnabled(io: Io, mod: ModInfo, enabled: boolean): Promise<Outcome> {
  if (mod.name === SELF) return refuse(shown.refuseSelf)

  const home = await homeDir(io)
  const path = `${slashes(await io.config())}/settings.json`
  let text: string
  try {
    text = String(await io.read(path))
  } catch {
    return refuse(shown.refuseUnreadable)
  }
  let before: Json
  try {
    before = JSON.parse(text)
  } catch {
    return refuse(shown.refuseInvalid)
  }

  const after: Json = JSON.parse(text)
  const edited = ['enabledPlugins']
  let needsRestart = false
  if (mod.source === 'installed') {
    after.enabledPlugins = { ...after.enabledPlugins, [mod.id]: enabled }
  } else {
    // /reload-plugins applies `<name>@inline`, but reads the dirs list only at startup: a dir stays listed and only a new one forces a restart.
    after.enabledPlugins = { ...after.enabledPlugins, [inlineId(mod)]: enabled }
    const separator = separatorFor(home)
    const entries = splitDirs(String(after.env?.CLAUDE_CODE_PLUGIN_DIRS ?? ''), separator)
    if (enabled && !entries.some(entry => expand(entry, home) === mod.root)) {
      after.env = { ...after.env, CLAUDE_CODE_PLUGIN_DIRS: [...entries, tildeForm(mod.root, home)].join(separator) }
      edited.push('env')
      needsRestart = true
    }
  }

  const indent = /^\{\r?\n([ \t]+)"/.exec(text)?.[1] ?? '  '
  const out = JSON.stringify(after, null, indent) + '\n'
  if (!untouched(before, JSON.parse(out), edited)) return refuse(shown.refuseOtherSettings)

  // The first backup is the one worth keeping: later writes never replace it.
  const backup = `${path}.mod-manager.bak`
  const hasBackup = await io.read(backup).then(() => true, () => false)
  if (!hasBackup) await io.write(backup, text)
  await io.write(path, out)
  return mod.source === 'dir' ? { ok: true, needsRestart } : { ok: true }
}

export const DEFAULT_MARKET = 'claude-mods'
export const REFRESH_KEY = 'catalog-refreshed'
export const REFRESH_MS = 24 * 60 * 60 * 1000
export const RETRY_MS = 60 * 60 * 1000
export const REFRESH_OPT_OUTS = ['DISABLE_AUTOUPDATER', 'DISABLE_UPDATES', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC']

// The marketplace mod-manager itself was installed from, else the default.
export async function marketOf(io: Io): Promise<string> {
  const claudeDir = slashes(await io.config())
  const installed = await readJson(io, `${claudeDir}/plugins/installed_plugins.json`)
  const id = Object.keys(installed?.plugins ?? {}).find(key => key.startsWith(`${SELF}@`))
  return id ? id.slice(SELF.length + 1) : DEFAULT_MARKET
}

export type CatalogEntry = { name: string; description: string; version: string; declaresIcons: boolean }

// The marketplace's plugin list, each with the version and icons support its own plugin.json declares.
export async function catalogOf(io: Io, market: string): Promise<CatalogEntry[]> {
  const claudeDir = slashes(await io.config())
  const known = await readJson(io, `${claudeDir}/plugins/known_marketplaces.json`)
  const location = known?.[market]?.installLocation
  if (typeof location !== 'string') return []
  const base = slashes(location).replace(/\/+$/, '')
  const listing = await readJson(io, `${base}/.claude-plugin/marketplace.json`)
  if (!Array.isArray(listing?.plugins)) return []
  const entries: CatalogEntry[] = []
  for (const plugin of listing.plugins) {
    if (typeof plugin?.name !== 'string') continue
    const source = typeof plugin.source === 'string' ? plugin.source : typeof plugin.source?.path === 'string' ? plugin.source.path : plugin.name
    const manifest = (await readJson(io, `${base}/${source.replace(/^\.\//, '')}/.claude-plugin/plugin.json`)) ?? {}
    entries.push({
      name: plugin.name,
      description: String(plugin.description ?? manifest.description ?? ''),
      version: String(manifest.version ?? ''),
      declaresIcons: Boolean(manifest.userConfig?.icons),
    })
  }
  return entries
}

const parts = (version: string) => {
  const found = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim())
  return found ? [Number(found[1]), Number(found[2]), Number(found[3])] : null
}

// True when `latest` is higher than `current` on major.minor.patch; an unreadable version never is.
export function isNewer(latest: string, current: string): boolean {
  const a = parts(latest)
  const b = parts(current)
  if (!a || !b) return false
  for (let at = 0; at < 3; at++) if (a[at] !== b[at]) return a[at]! > b[at]!
  return false
}

export type CatalogState = 'on' | 'off' | 'not-installed' | 'update'
// Where the running copy comes from: this marketplace, a folder, or another marketplace.
export type CopyOrigin = 'marketplace' | 'dir' | 'other'

export type CatalogMod = {
  // Own id space, never an index into `mods`.
  key: string
  name: string
  description: string
  version: string
  declaresIcons: boolean
  state: CatalogState
  origin: CopyOrigin | null
  // A copy is enabled, whatever the state says (an update can be on or off).
  enabled: boolean
  installedVersion: string
  // The loaded copy's id, for setEnabled.
  modId: string | null
  // A folder copy is never offered either: it would load twice.
  canInstall: boolean
  canUpdate: boolean
  // `<name>@<market>`, for the CLI.
  target: string
}

export function catalogState(catalog: CatalogEntry[], mods: ModInfo[], market: string): CatalogMod[] {
  return catalog.map(entry => {
    const copies = mods.filter(mod => mod.name === entry.name)
    const originOf = (mod: ModInfo): CopyOrigin => (mod.source === 'dir' ? 'dir' : mod.id.endsWith(`@${market}`) ? 'marketplace' : 'other')
    const running = copies.find(mod => mod.enabled) ?? copies[0] ?? null
    const hasFolder = copies.some(mod => originOf(mod) === 'dir')
    const fromMarket = copies.find(mod => originOf(mod) === 'marketplace')
    const behind = !!fromMarket && !hasFolder && isNewer(entry.version, fromMarket.version)
    const state: CatalogState = !running ? 'not-installed' : behind ? 'update' : running.enabled ? 'on' : 'off'
    return {
      key: `cat:${entry.name}`,
      name: entry.name,
      description: entry.description,
      version: entry.version,
      declaresIcons: entry.declaresIcons,
      state,
      origin: running ? originOf(running) : null,
      enabled: !!running?.enabled,
      installedVersion: fromMarket?.version ?? running?.version ?? '',
      modId: running?.id ?? null,
      canInstall: copies.length === 0,
      canUpdate: behind,
      target: `${entry.name}@${market}`,
    }
  })
}

export type Refresh = 'ran' | 'throttled' | 'disabled' | 'failed'

// Pulls the marketplace at most once a day, never when an opt-out env var is set. A failure is silent, keeps the old catalog and tries again an hour later.
export async function refreshCatalog(io: Io, market: string): Promise<Refresh> {
  if (!io.run) return 'failed'
  for (const name of REFRESH_OPT_OUTS) {
    const value = (await io.env?.(name).catch(() => undefined)) ?? ''
    if (value !== '' && !/^(0|false)$/i.test(value)) return 'disabled'
  }
  const now = (io.now ?? Date.now)()
  const last = await io.store?.get(REFRESH_KEY).catch(() => undefined)
  if (typeof last === 'number' && now - last < REFRESH_MS) return 'throttled'
  // Stamped before the run, so two sessions starting together pull once; a failure moves the stamp back to allow the retry.
  await io.store?.set(REFRESH_KEY, now).catch(() => undefined)
  const outcome = await io.run(['claude', 'plugin', 'marketplace', 'update', market], 60000).then(result => (result.exitCode === 0 ? 'ran' : 'failed'), () => 'failed' as const)
  if (outcome === 'failed') await io.store?.set(REFRESH_KEY, now - REFRESH_MS + RETRY_MS).catch(() => undefined)
  return outcome
}

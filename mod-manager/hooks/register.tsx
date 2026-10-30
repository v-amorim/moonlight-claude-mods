// mod-manager / hooks/register.tsx, by v-amorim
// Registers the mod manager pane, pill, command and toggle actions with the engine.
import type { ConfigValue, EngineInterface, Register, RenderChildren } from 'claude-code'

import { catalogOf, catalogState, discover, featuresOf, marketOf, refreshCatalog, SELF, setEnabled, type CatalogEntry, type Io, type ModInfo } from './registry'
import { checkedOf, planOf, runSteps, type Step } from './plan'
import { OPEN_SETUP_SCOPE, signatureOf, updatesCard, welcomeCard } from './cards'
import { checkedRows, planRows, type PickMessage, type PickProps } from './setup'
import { fill, MARK, THEME } from './theme'
import text from './text'
import { isTipMessage, type EntryMessage, type EntryProps, type Tip } from './entry'
import { labelsOf, menuEntry, pill, pillRow, splitRow, tabRow, tipLine } from './pills'
import { TOAST_MS, ToastList, toastCards } from './toasts'
import { cardFill, cardGap, detectNerd, FOOTER_ROWS, lookFor, paneFooter, section, sepText, titleEdge, type IconMode, type Reveal, withMark } from './look'
import { actionReveals, choiceBar, editorReveals, hairline, settingChoice, settingHead, settingsBody, openSetting, type Action } from './settings'
import { cardSpace, HEAD_ROWS, stickyCard } from './card'
import { costPill } from './cost'
import { readSpend, resetSpend, spendLine, type Spend } from './spend'
import { type ListMessage, type ListProps } from './list'

const homeOf = async ($: EngineInterface) => ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '').replace(/\\/g, '/')

const configDir = async ($: EngineInterface) => ((await $.env.get('CLAUDE_CONFIG_DIR')) || `${await homeOf($)}/.claude`).replace(/\\/g, '/')

// `$` cannot cross an import, so the registry gets plain functions instead.
const ioOf = ($: EngineInterface): Io => ({
  config: () => configDir($),
  read: path => $.fs.read(path),
  write: (path, text) => $.fs.write(path, text),
  list: path => $.fs.list(path),
  pluginDirs: async () => (await $.env.get('CLAUDE_CODE_PLUGIN_DIRS')) ?? '',
  home: async () => (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '',
  // The validator needs literal names, so the refresh opt-outs are listed here.
  env: async name => {
    const known: Record<string, string | undefined> = {
      DISABLE_AUTOUPDATER: (await $.env.get('DISABLE_AUTOUPDATER')) ?? undefined,
      DISABLE_UPDATES: (await $.env.get('DISABLE_UPDATES')) ?? undefined,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: (await $.env.get('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC')) ?? undefined,
    }
    return known[name]
  },
  run: async (argv, timeoutMs) => {
    const result = await $.process.run(argv, { timeoutMs })
    return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }
  },
  store: { get: key => $.store.get(key), set: (key, value) => $.store.set(key, value as ConfigValue) },
})

// The icons setting (userConfig), fixed per activation: a change reloads the mod.
let iconMode: IconMode = 'auto'
let look = lookFor(false)

// Whether the terminal's font is a Nerd Font, whatever the icons setting says.
async function nerdFontFound($: EngineInterface) {
  const env = {
    WT_SESSION: await $.env.get('WT_SESSION'),
    TERM_PROGRAM: await $.env.get('TERM_PROGRAM'),
    ITERM_PROFILE: await $.env.get('ITERM_PROFILE'),
    KITTY_WINDOW_ID: await $.env.get('KITTY_WINDOW_ID'),
    ALACRITTY_WINDOW_ID: await $.env.get('ALACRITTY_WINDOW_ID'),
    GNOME_TERMINAL_SCREEN: await $.env.get('GNOME_TERMINAL_SCREEN'),
    KONSOLE_VERSION: await $.env.get('KONSOLE_VERSION'),
  }
  const host = {
    localAppData: ((await $.env.get('LOCALAPPDATA')) ?? '').replace(/\\/g, '/'),
    home: ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '').replace(/\\/g, '/'),
    read: (path: string) => $.fs.read(path).then(String),
    run: async (argv: string[]) => {
      const result = await $.process.run(argv, { timeoutMs: 5000 })
      if (result.exitCode !== 0) throw new Error(result.stderr)
      return result.stdout
    },
  }
  return detectNerd(env, host)
}

// Nerd glyphs when the setting asks for them, or on auto when the terminal's font is a Nerd Font.
async function detectLook($: EngineInterface) {
  if (iconMode !== 'auto') return lookFor(iconMode === 'nerd')
  return lookFor(await nerdFontFound($))
}

// Reading the terminal's settings takes a while, so on auto the last answer, kept in this mod's store, draws until it returns.
async function savedLook($: EngineInterface) {
  if (iconMode !== 'auto') return look
  try {
    const nerd = await $.store.get('look-nerd')
    return typeof nerd === 'boolean' ? lookFor(nerd) : look
  } catch {
    return look
  }
}

async function saveLook($: EngineInterface) {
  try {
    await $.store.set('look-nerd', look.nerd)
  } catch {
    // Without a store the mod still draws; it only starts from safe again next time.
  }
}

// Hooks of one event run in turn, so the slow font check runs beside them instead of holding up every mod after this one.
let lookLoad: Promise<void> | null = null

function loadLook($: EngineInterface) {
  lookLoad ??= (async () => {
    look = await savedLook($)
    void detectLook($).then(async found => {
      const isChanged = found.nerd !== look.nerd
      look = found
      await saveLook($)
      if (isChanged) $.ui.invalidate('ui.render')
    }).catch(() => {
      // A failed check keeps the icons drawn now.
    })
  })()
  return lookLoad
}

let mods: ModInfo[] = []
// Each mod with a cost, by name: its last days of side-model spend, or null; read again after a few seconds and after a Reset.
let spends: Record<string, Spend | null> = {}
let spendsAt = -Infinity
const SPEND_FRESH_MS = 3000

async function loadSpends($: EngineInterface) {
  const now = await $.clock.now()
  if (now - spendsAt < SPEND_FRESH_MS) return
  spendsAt = now
  const config = await configDir($)
  const next: Record<string, Spend | null> = {}
  for (const mod of mods) if (mod.showcase?.cost) next[mod.name] = await readSpend(path => $.fs.read(path), config, mod.name, now)
  spends = next
}

// A failed write leaves the counts as they were.
async function resetSpendOf($: EngineInterface, name: string) {
  await resetSpend((path, body) => $.fs.write(path, body), await configDir($), name).catch(() => undefined)
  spendsAt = -Infinity
  $.ui.invalidate('ui.render')
}
// Mods toggled in the pane, by name, with the state Apply gives them; toggling back drops one.
const pending = new Map<string, boolean>()
// The mod whose page fills the pane, or -1 for the list.
let page = -1
// The mod under the pointer in the list, whose description shows in a card at the bottom of the pane.
let hovering = -1
// The row whose cut description keeps its card after the pointer left the row, so the pointer can reach the card's control.
let heldCard = -1
// The mod whose card shows every line; pointing at another row or control clears it.
let fullCard = ''
let note = ''
// The page's Features card shows every line in full.
let featuresOpen = false
let working = false

// The marketplace mod-manager came from and its listing; each mod's state is worked out from it and `mods` on every draw.
let market = 'claude-mods'
let catalogEntries: CatalogEntry[] = []
let catalogLoaded = false
// Catalog keys ticked for install, and update keys the person unticked: updates start ticked.
const installs = new Set<string>()
const skipped = new Set<string>()
// What the Checked list reads, once per pane open: the `claude --version` output and whether the font is a Nerd Font.
let ccVersion: string | null = null
let fontFound: boolean | null = null

const catalogRows = () => catalogState(catalogEntries, mods, market)

const planNow = () => planOf({ pending, shown: shownName, catalog: catalogRows(), installs, skipped, iconMode, arrow: look.glyph.icon.arrow ?? '' })

// The catalog is cheap to read; the version and the font take longer, so they fill in beside the first draw.
async function loadSetup($: EngineInterface) {
  const io = ioOf($)
  market = await marketOf(io)
  catalogEntries = await catalogOf(io, market).catch(() => [])
  catalogLoaded = true
  void (async () => {
    ccVersion = await io.run?.(['claude', '--version'], 10000).then(result => (result.exitCode === 0 ? result.stdout : null)).catch(() => null) ?? null
    fontFound = await nerdFontFound($).catch(() => false)
    $.ui.invalidate('ui.render')
  })()
}

const isOn = (mod: ModInfo) => pending.get(mod.name) ?? mod.enabled

// A click only changes the plan; settings.json waits for Apply.
function toggleMod($: EngineInterface, index: number) {
  const mod = mods[index]
  if (!mod) return
  if (mod.name === SELF) {
    note = `${MARK.warn} ${text.refuseSelf}`
  } else {
    note = ''
    if (pending.has(mod.name)) pending.delete(mod.name)
    else pending.set(mod.name, !mod.enabled)
  }
  $.ui.invalidate('ui.render')
}

// A second Apply while one runs would reload twice.
let isApplying = false

// Toggles write one at a time, as two read-edit-writes of settings.json would cross; the updates card passes only its update steps.
async function applyChanges($: EngineInterface, only?: Step[]) {
  if (isApplying) return
  isApplying = true
  const steps = only ?? planNow()
  $.ui.invalidate('ui.render')
  try {
    const io = ioOf($)
    // Only a folder new to the dirs list waits for a restart; every other toggle lands with /reload-plugins.
    let needsRestart = false
    for (const step of steps) {
      const mod = step.kind === 'on' || step.kind === 'off' ? mods.find(each => each.name === step.name) : undefined
      if (!mod) continue
      const outcome = await setEnabled(io, mod, step.kind === 'on')
      if (!outcome.ok) $.ui.toast(`${MARK.warn} ${fill(text.toggleFailed, { line: step.line, error: outcome.reason })}`)
      else if (outcome.needsRestart) needsRestart = true
    }
    if (!only) pending.clear()
    await runSteps(io, steps, (step, reason) => $.ui.toast(`${MARK.warn} ${fill(step.kind === 'install' ? text.installFailed : text.updateFailed, { name: shownName(step.name), error: reason })}`))
    if (!only) {
      installs.clear()
      skipped.clear()
    }
    mods = await discover(io)
    await settingsCaughtUp($).catch(() => {})
    note = await $.command
      .run({ command: 'reload-plugins' })
      .then(() => `${MARK.ok} ${fill(text.applyDone, { n: steps.length })}${needsRestart ? `, ${text.howRestart}` : ''}`)
      .catch(error => `${MARK.warn} ${fill(text.reloadFailed, { error: String(error) })}`)
  } finally {
    isApplying = false
    // The Apply card goes once nothing is pending, so its tip goes with it.
    paneTip = null
    $.ui.invalidate('ui.render')
  }
}

// Claude Code picks up a settings.json write a moment later; a reload before that applied the old toggles.
async function settingsCaughtUp($: EngineInterface) {
  const onDisk = JSON.stringify(JSON.parse(String(await $.fs.read(`${await configDir($)}/settings.json`))).enabledPlugins ?? {})
  for (let tries = 0; tries < 30; tries++) {
    const loaded = await $.settings.read({ source: 'user' })
    if (JSON.stringify(loaded.enabledPlugins ?? {}) === onDisk) return
    await $.clock.sleep(100)
  }
}

// `mod-skill-panel` reads `Skill Panel`: the package name is for commands, people read this.
const shownName = (name: string) => name.replace(/^mod-/, '').split('-').map(word => (word ? `${word[0]!.toUpperCase()}${word.slice(1)}` : word)).join(' ')
const isOpen = async ($: EngineInterface) => (await $.ui.panes()).some(pane => pane.id === 'manager' && pane.isPlaced)

// The command and the bar entry both toggle. An unplaced pane is waiting, not open.
async function togglePane($: EngineInterface) {
  if (await isOpen($)) {
    await $.ui.close({ id: 'manager' })
    await $.state.set({ plugin: 'mod-manager', key: 'pane' }, false)
    return
  }
  mods = await discover(ioOf($))
  page = -1
  note = ''
  pending.clear()
  installs.clear()
  skipped.clear()
  await loadSetup($)
  const opened = await $.ui.open({ id: 'manager', title: text.paneTitle, closeOnEscape: true })
  if (!opened.isPlaced) $.ui.toast(text.panelWaiting)
  await $.state.set({ plugin: 'mod-manager', key: 'pane' }, opened.isPlaced)
}

// Marketplace auto-update lives in /plugin, which a mod cannot set; this opens it.
async function openPlugin($: EngineInterface) {
  note = await $.command
    .run({ command: 'plugin' })
    .then(() => '')
    .catch(error => `${MARK.warn} ${String(error)}`)
  $.ui.invalidate('ui.render')
}

// What the band cards read, loaded beside the first draw: the band never waits on the catalog or the font.
let bandLoad: Promise<void> | null = null
let isBandReady = false
// What the band last said about Claude working, since a click handler cannot read the band's props.
let bandIsWorking = false

function loadBand($: EngineInterface) {
  bandLoad ??= (async () => {
    const io = ioOf($)
    const font = nerdFontFound($).catch(() => false)
    if (!catalogLoaded) {
      market = await marketOf(io)
      catalogEntries = await catalogOf(io, market).catch(() => [])
      catalogLoaded = true
    }
    if (mods.length === 0) mods = await discover(io)
    isBandReady = true
    fontFound ??= await font
    $.ui.invalidate('ui.render')
  })().catch(() => {})
  return bandLoad
}

// A store read can throw; then neither card draws, since a card that cannot be dismissed would come back on every draw.
async function readStore($: EngineInterface, key: string) {
  try {
    return { isReadable: true, value: await $.store.get(key) }
  } catch {
    return { isReadable: false, value: undefined }
  }
}

async function writeStore($: EngineInterface, key: string, value: ConfigValue) {
  try {
    await $.store.set(key, value)
  } catch {
    // The card stays until the store works again.
  }
}

const updatesNow = () => catalogRows().filter(cat => cat.canUpdate)

// The Update button runs the Apply flow for the update lines only.
async function updateFromCard($: EngineInterface) {
  if (isApplying) return
  if (working || bandIsWorking) {
    $.ui.toast(text.cardUpdateBusy)
    return
  }
  const steps = planOf({ pending: new Map(), shown: shownName, catalog: catalogRows(), installs: new Set(), skipped: new Set(), iconMode, arrow: look.glyph.icon.arrow ?? '' })
  if (steps.length) await applyChanges($, steps)
}

// At most one card: the welcome while `welcomed` is unset, else the updates of a release the person has not put off.
async function bandCard($: EngineInterface, elements: Parameters<typeof welcomeCard>[0], maxRows: number, isWorking: boolean) {
  const welcomed = await readStore($, 'welcomed')
  // The font check lands in a moment; drawing the card after it keeps the tip from growing the band under the prompt.
  if (welcomed.isReadable && !welcomed.value) {
    return fontFound === null ? null : welcomeCard(elements, look, { showFontTip: fontFound === false, still, maxRows, onOpen: () => cardClick($, 'card-welcome-open') })
  }
  if (!isBandReady) return null
  const updates = updatesNow()
  if (updates.length === 0) return null
  const dismissed = await readStore($, 'updates-dismissed')
  if (!dismissed.isReadable || dismissed.value === signatureOf(updates)) return null
  return updatesCard(elements, look, { updates, shown: shownName, isWorking: isWorking || working, isUpdating: isApplying, still, maxRows })
}

async function cardClick($: EngineInterface, id: string) {
  // The card may go with this click, and a tip left in the band row would name a control no longer there.
  toastTip = ''
  if (id === 'card-welcome-open' || id === 'card-welcome-skip') {
    // The pane opens first: once the card is gone, the press behind it no longer counts as the person asking.
    if (id === 'card-welcome-open') await openingPane($)
    await writeStore($, 'welcomed', true)
    $.ui.invalidate('ui.render')
  }
  if (id === 'card-update-skip') {
    await writeStore($, 'updates-dismissed', signatureOf(updatesNow()))
    $.ui.invalidate('ui.render')
  }
  if (id === 'card-update-run') await updateFromCard($)
}

const openPage = ($: EngineInterface, index: number) => {
  page = index
  note = ''
  $.ui.invalidate('ui.render')
}

// The panel's title: the list as a tab with its count; on a mod's page a click on it goes back.
// The glyph-set key of a mod's own icon: its menu entry's (`menu-<id>`) or, for a settings-only mod, its name; the generic mod icon otherwise.
const OWN_ICON: Record<string, string> = {
  'mod-skill-panel': 'menu-skills',
  'mod-prompts': 'menu-prompts',
  'mod-file-tree': 'menu-filetree',
  'mod-progress': 'menu-progress',
  'mod-heads-up': 'menu-headsup',
  'mod-collision-guard': 'collision-guard',
  'mod-model-effort': 'model-effort',
  'mod-next-steps': 'next-steps',
  'mod-transcript': 'transcript',
  'mod-wrap-up': 'wrap-up',
}
const iconOf = (name: string) => {
  const key = OWN_ICON[name]
  return key && look.glyph.icon[key] ? key : 'mod'
}

const listTab = (isShown: boolean) => ({ id: 'manager-tab', label: text.paneTitle, icon: look.glyph.icon.mod ?? look.glyph.title, isOpen: isShown, count: mods.length, tip: { glyph: look.glyph.title, label: text.paneTitle, text: isShown ? text.tipTabList : text.tipTabBack } })

// A saved change reloads that mod, which redraws its page with the new value.
async function saveSetting($: EngineInterface, key: string, value: ConfigValue) {
  const row = (await $.config.list()).find(each => each.key === key)
  const result = await $.config.set({ key, value })
  note = 'deny' in result && result.deny ? `${MARK.warn} ${result.deny}` : `${MARK.ok} ${fill(text.settingSaved, { label: row?.label ?? key })}`
  $.ui.invalidate('ui.render')
}

// True while the pointer is on this mod's pill entry, which then shows its tip under the row.
let tipShown = false

// The control the pointer is on in the pane, shown in its footer.
let paneTip: Tip | null = null
// The toast × under the pointer, shown in the band's tip row.
let toastTip = ''

// A band redraw can replace a hovered entry, whose leave and quiet timer then never come, so a band tip ends on its own.
const BAND_TIP_MS = 5000
let bandTipAt = 0

function expireBandTip($: EngineInterface) {
  const at = ++bandTipAt
  $.clock.after(BAND_TIP_MS, () => {
    if (at !== bandTipAt || (!tipShown && !toastTip)) return
    tipShown = false
    toastTip = ''
    $.ui.invalidate('ui.render')
  })
}

const toasts = new ToastList('manager')
// The animations setting, fixed per activation: off, every entry draws still.
let still = false

// The entry shimmers from the click until the pane draws, so a slow open never looks ignored.
const OPEN_WAIT_MS = 8000
let isOpening = false

function endOpening($: EngineInterface) {
  if (!isOpening) return
  isOpening = false
  $.ui.invalidate('ui.render')
}

async function openingPane($: EngineInterface) {
  if (!(await isOpen($))) {
    isOpening = true
    $.ui.invalidate('ui.render')
    $.clock.after(OPEN_WAIT_MS, () => endOpening($))
  }
  await togglePane($)
  if (!(await isOpen($))) endOpening($)
}

// The icons switch: every mod keeps its own icons setting, and this writes the same value into each, as a person would in its panel.
const ICON_MODES = ['auto', 'nerd', 'safe'] as const

// The hover card's own rows, border included.
const CARD_ROWS = 4
const TEXT_ROWS = CARD_ROWS - 2
const CARD_MORE = 'manager-card-more'

// The rows a text takes at this width, wrapped at spaces, a word wider than the width breaking across rows.
const wrapRows = (value: string, width: number) =>
  value.split('\n').flatMap(line => {
    const rows = ['']
    let used = 0
    for (const word of line.split(' ')) {
      const chars = [...word]
      if (used > 0 && used + 1 + chars.length <= width) {
        rows[rows.length - 1] += ` ${word}`
        used += 1 + chars.length
        continue
      }
      if (used > 0) rows.push('')
      rows[rows.length - 1] = chars.slice(0, width).join('')
      used = Math.min(chars.length, width)
      for (let at = width; at < chars.length; at += width) {
        rows.push(chars.slice(at, at + width).join(''))
        used = Math.min(chars.length - at, width)
      }
    }
    return rows
  })

// A control glyph without the brackets and padding it carries as a Button label.
const bare = (glyph: string) => glyph.replace(/[[\]\s]/g, '')

// A mod follows the standard when its icons field offers exactly auto, nerd and safe.
const followsStandard = (options: readonly string[] | undefined) =>
  Array.isArray(options) && options.length === ICON_MODES.length && ICON_MODES.every(mode => options.includes(mode))

const iconRowsOf = async ($: EngineInterface) =>
  (await $.config.list()).filter(row => row.key.startsWith('mod-') && row.key.endsWith('.icons') && followsStandard(row.options))

async function setAllIcons($: EngineInterface, mode: string) {
  const rows = await iconRowsOf($)
  // A saved change reloads that mod, this one included, so this mod's own setting goes last.
  const ordered = [...rows.filter(row => !row.key.startsWith('mod-manager.')), ...rows.filter(row => row.key.startsWith('mod-manager.'))]
  const changing = ordered.filter(row => row.value !== mode)
  note = `${MARK.ok} ${fill(text.iconsSaved, { mode: (text.iconModes as Record<string, string>)[mode] ?? mode, n: changing.length })}`
  $.ui.invalidate('ui.render')
  for (const row of changing) {
    const result = await $.config.set({ key: row.key, value: mode })
    if ('deny' in result && result.deny) {
      note = `${MARK.warn} ${result.deny}`
      $.ui.invalidate('ui.render')
      return
    }
  }
}

export const register: Register = (on, options) => {
  still = options.animations === false
  toasts.isStill = still
  // This mod's toasts draw as cards in the band; Claude Code's own box is narrow and cuts them.
  on('ui.toast', async ($, e) => {
    const id = toasts.add(e.text)
    $.ui.invalidate('ui.render')
    $.clock.after(e.timeoutMs ?? TOAST_MS, () => {
      toasts.drop(id)
      $.ui.invalidate('ui.render')
    })
    return { value: undefined }
  })

  iconMode = (options.icons as IconMode | undefined) ?? 'auto'
  // A forced mode needs no detection; auto loads the saved answer, then checks the terminal font beside the hooks.
  look = lookFor(iconMode === 'nerd')

  on('session.start', async ($, e, next) => {
    await loadLook($)
    await $.command.register({ name: 'mod-manager', description: text.commandDescription })
    // The bar entry reads this; an unload drops the pane without raising ui.close here.
    await $.state.set({ plugin: 'mod-manager', key: 'pane' }, await isOpen($))
    // A hot reload leaves an open pane on its old drawing until something redraws it.
    $.ui.invalidate('ui.render')
    // Background and silent: a failure keeps the old catalog.
    const io = ioOf($)
    // A refreshed listing may hold new versions, so the cards read it again.
    void marketOf(io)
      .then(async name => {
        await refreshCatalog(io, name)
        catalogEntries = await catalogOf(io, name)
        market = name
        $.ui.invalidate('ui.render')
      })
      .catch(() => undefined)

    return next(e)
  })

  // Subagent turns carry agentId and say nothing about the main prompt being free.
  on('turn.start', async ($, e, next) => {
    if (!(e as { agentId?: string }).agentId) {
      working = true
      $.ui.invalidate('ui.render')
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      working = false
      $.ui.invalidate('ui.render')
    }

    return next(e)
  })

  on('command.run', { command: 'mod-manager' }, async $ => {
    await togglePane($)

    return { text: '' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === 'manager') await $.state.set({ plugin: 'mod-manager', key: 'pane' }, false)

    return next(e)
  })

  // One panel at a time: another mod's pane opening closes this one.
  on('state.set', async ($, e, next) => {
    // Deferred past this dispatch, so this mod's own state write is not nested in another plugin's.
    // The declared state names no other mod's pane, so the types narrow this event to never.
    if (e.key === 'pane' && e.plugin !== 'mod-manager' && (e as { value?: unknown }).value === true) {
      $.clock.after(0, async () => {
        if (!(await isOpen($))) return
        await $.ui.close({ id: 'manager' })
        await $.state.set({ plugin: 'mod-manager', key: 'pane' }, false)
      })
    }

    return next(e)
  })

  // The bar entry lives here, not in mod-menu: only a press in this mod counts as the person asking for this pane.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    await loadLook($)
    const hidden = await $.state.get({ plugin: 'mod-menu', key: 'hidden' })
    const labels = labelsOf((await $.state.get({ plugin: 'mod-menu', key: 'labels' })).value)
    if (e.surface !== 'terminal' || e.props.hasSurvey) return next(e)
    const { Box, Button, Client, Link, Text } = $.ui.resolve(e)
    void loadBand($)
    bandIsWorking = e.props.isWorking
    // A card that fails to draw must not take the pill row with it: one throw in this hook drops the whole band.
    const card = await bandCard($, { Box, Button, Client, Link, Text }, e.props.maxRows, e.props.isWorking).catch(() => null)
    // A Button cannot post a tip, so Open setup's tip lies hidden over the tip row and shows while its pill is lit; padded to cover what is under it.
    const openTip = (card as { props?: { key?: unknown } } | null)?.props?.key === 'card-welcome-block' ? (
      <Box key="card-open-tip" position="absolute" top={0} left={0} display="none" hover={{ scope: OPEN_SETUP_SCOPE, display: 'flex' }}>
        {tipLine({ Box, Text }, `${text.cardOpenSetup}: ${text.tipCardOpen}`.padEnd(Math.max(0, e.props.bodyColumns - 2)))}
      </Box>
    ) : null
    if (hidden.value === true) {
      if (toasts.items.length === 0 && !card) return next(e)
      return <Box key="toasts-manager" flexDirection="column">{toastCards({ Box, Client, Text }, toasts, look, text.tipToast)}{card}{await next(e)}</Box>
    }
    // Reading the value subscribes the bar to redraws; the look trusts the pane list itself.
    await $.state.get({ plugin: 'mod-manager', key: 'pane' })
    const shown = await isOpen($)
    const { group, row, rest, tip } = splitRow(await next(e))
    // Opening the pane from here queues nothing, so the entry stays live mid-turn.
    const entry = menuEntry({ Box, Client, Text }, look.nerd, 'manager', { label: look.glyph.gear, isOpen: shown, idle: THEME.pill, isBusy: isOpening, still, labels })

    // splitRow types the tip as unknown (shared pills.tsx); it is always a menu-tip child of the row stack.
    const tipNow = (toastTip ? tipLine({ Box, Text }, toastTip) : tipShown ? tipLine({ Box, Text }, text.pillTip) : tip) as RenderChildren
    // Keyed as the tip row, so the next mod's splitRow takes it as the tip and never as one more row.
    const tipSlot = openTip ? <Box key="menu-tip" flexDirection="column">{tipNow ?? tipLine({ Box, Text }, ' ')}{openTip}</Box> : tipNow
    return pillRow({ Box, Client, Text }, look.nerd, [entry, ...group], row, [...toastCards({ Box, Client, Text }, toasts, look, text.tipToast), ...(card ? [card] : []), ...rest], tipSlot, e.props.bodyColumns)
  })

  on('ui.message', async ($, e, next) => {
    const clicked = e.data as EntryMessage
    const dismissed = clicked?.type === 'menu-entry' ? toasts.idOf(clicked.id) : undefined
    if (dismissed !== undefined) {
      toasts.drop(dismissed)
      $.ui.invalidate('ui.render')
      return next(e)
    }
    if (isTipMessage(e.data)) {
      const tip = e.data
      // A band card's buttons and the toast × show their tip in the band's tip row.
      const isToast = Boolean(tip.id?.startsWith('toast-manager-') || tip.id?.startsWith('card-'))
      toastTip = isToast ? `${tip.label}: ${tip.text}` : ''
      if (toastTip) expireBandTip($)
      paneTip = tip.id && !isToast ? { glyph: tip.glyph ?? '', label: tip.label ?? '', text: tip.text ?? '' } : null
      // The list's tip carries the row under the pointer, whose card shows above the list.
      hovering = tip.id?.startsWith('manager-row-') ? Number(tip.id.slice('manager-row-'.length)) : -1
      if (hovering >= 0 && mods[hovering]?.name !== fullCard) fullCard = ''
      // Leaving a row for empty cells or for the card's own control keeps the held card; any other control drops it.
      if (hovering >= 0 || (tip.id && tip.id !== CARD_MORE)) {
        heldCard = -1
        if (hovering < 0) fullCard = ''
      }
      $.ui.invalidate('ui.render')
      return next(e)
    }
    const hover = e.data as { type?: string; id?: string; isOver?: boolean }
    if (hover?.type === 'menu-hover' && hover.id === 'manager') {
      tipShown = hover.isOver === true
      if (tipShown) expireBandTip($)
      $.ui.invalidate('ui.render')
    }
    const message = e.data as EntryMessage
    if (message?.type === 'menu-entry' && message.id === 'manager') await openingPane($)
    if (message?.type === 'menu-entry' && message.id === CARD_MORE) {
      const shown = mods[hovering >= 0 ? hovering : heldCard]
      if (shown) fullCard = fullCard === shown.name ? '' : shown.name
      $.ui.invalidate('ui.render')
    }
    if (message?.type === 'menu-entry' && message.id === 'manager-features') {
      featuresOpen = !featuresOpen
      $.ui.invalidate('ui.render')
    }
    if (message?.type === 'menu-entry' && message.id.startsWith('spend-reset-')) await resetSpendOf($, message.id.slice('spend-reset-'.length))
    if (message?.type === 'menu-entry' && message.id.startsWith('icons-')) await setAllIcons($, message.id.slice('icons-'.length))
    if (message?.type === 'menu-entry' && message.id === 'manager-apply') await applyChanges($)
    if (message?.type === 'menu-entry' && message.id.startsWith('card-')) await cardClick($, message.id)
    if (message?.type === 'menu-entry' && message.id === 'manager-tab' && page >= 0) openPage($, -1)
    openSetting($, e.data)
    const change = settingChoice(e.data)
    if (change) await saveSetting($, change.key, change.value)

    return next(e)
  })

  on('ui.message', { requestId: 'manager' }, async ($, e, next) => {
    const message = e.data as ListMessage | PickMessage
    // A click posts only its own message, so a toggle also says which row the pointer is on.
    // While Apply runs, a toggle or a tick would change the plan under it.
    if (message?.type === 'toggle' && !isApplying) {
      hovering = message.index
      toggleMod($, message.index)
    }
    if (message?.type === 'pick' && !isApplying) {
      const set = message.kind === 'install' ? installs : skipped
      if (!set.delete(message.key)) set.add(message.key)
      $.ui.invalidate('ui.render')
    }
    if (message?.type === 'select') {
      hovering = -1
      heldCard = -1
      fullCard = ''
      paneTip = null
      openPage($, message.index)
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    await loadLook($)
    if (e.requestId !== 'manager') return next(e)
    if (isOpening) $.clock.after(0, () => endOpening($))

    // A reload resets module state while the pane stays open, so reload the list.
    if (mods.length === 0) mods = await discover(ioOf($))
    await loadSpends($).catch(() => undefined)

    // @ts-expect-error The host's types omit Client from a Pane's elements, yet a Pane draws it.
    const { Box, Button, Client, Link, Text } = $.ui.resolve(e)
    const redraw = () => $.ui.invalidate('ui.render')
    const frame = (children: RenderChildren, reveals: Reveal[] = [], footer: { hint?: string; status?: string } = {}) => (
      <Box flexDirection="column" backgroundColor={THEME.bg} paddingX={1} minHeight={e.props.scroll.bodyRows}>
        {children}
        <Box key="footer-space" height={FOOTER_ROWS} flexShrink={0} />
        {paneFooter({ Box, Text }, paneTip, e.props.bodyColumns, e.props.scroll, reveals, footer)}
      </Box>
    )

    const mod = mods[page]
    if (mod) {
      // /config lists a plugin's settings as `<plugin>.<field>`, and only while the plugin is on.
      const rows = mod.enabled ? (await $.config.list()).filter(row => row.key.startsWith(`${mod.name}.`)) : []
      const actions: Action[] = mod.enabled ? (mod.showcase?.actions ?? []) : []
      // showcase.json names the text settings the mod edits in its own panel, which its command opens; the manifest has no room for it.
      const editors: Record<string, Action> = {}
      for (const field of mod.showcase?.editors ?? []) editors[field] = { label: fill(text.openInSettings, { name: shownName(mod.name) }), command: mod.name, args: 'settings' }
      const run = async (action: Action) => {
        note = await $.command
          .run({ command: action.command, args: action.args ?? '' })
          .then(() => `${MARK.ok} ${fill(text.actionRan, { command: [action.command, action.args].filter(Boolean).join(' ') })}`)
          .catch(error => `${MARK.warn} ${String(error)}`)
        redraw()
      }
      const hint = rows.length || actions.length ? fill(text.pageHint, { sep: MARK.sep }) : text.pageHintBack
      const listed = featuresOf(mod)
      // The card's border and padding take two columns a side; the title, its gap and the separator come before the detail.
      const room = e.props.bodyColumns - 4
      const isCut = listed.some(item => item.title.length + 3 + item.detail.length > room)
      // Closed, one cut row each; open, the name on its own row with its text two cells in, so every wrapped line hangs at one indent.
      const titleWidth = Math.max(0, ...listed.map(item => item.title.length))
      const features = listed.map((item, index) =>
        featuresOpen ? (
          <Box key={`feature-${index}`} flexDirection="column" marginTop={index === 0 ? 0 : 1}>
            <Text key={`feature-${index}-name`} color={THEME.onSurface} bold>{item.title}</Text>
            <Box key={`feature-${index}-detail`} paddingLeft={2}>
              <Text color={THEME.muted} wrap="wrap">{item.detail}</Text>
            </Box>
          </Box>
        ) : (
          <Box key={`feature-${index}`} flexDirection="row" columnGap={1}>
            <Box flexShrink={0}>
              <Text color={THEME.onSurface} bold>{item.title.padEnd(titleWidth)}</Text>
            </Box>
            {sepText({ Text }, `${MARK.sep} ${item.detail}`, THEME.muted, `feature-${index}-detail`, { wrap: 'truncate-end' })}
          </Box>
        ),
      )
      // Arrow then muted label, at the right end of the last feature row.
      const label = featuresOpen ? text.featuresLess : text.featuresAll
      const arrow = featuresOpen ? look.glyph.less : look.glyph.more
      const more = isCut ? (
        <Client key="manager-features" module="./entry.tsx" height={1} props={{ id: 'manager-features', label, lead: arrow, leadColor: THEME.accent, isOpen: false, bg: cardFill(), idle: THEME.muted, nerd: look.nerd, still, tip: { glyph: arrow, label, text: featuresOpen ? text.tipFeaturesLess : text.tipFeaturesAll } } satisfies EntryProps} />
      ) : null
      const featureRows = more
        ? [
            ...features.slice(0, -1),
            <Box key="features-last" flexDirection="row" alignItems="flex-end" columnGap={1}>
              <Box key="features-last-text" flexGrow={1} flexShrink={1}>{features[features.length - 1]}</Box>
              <Box key="features-more" flexShrink={0}>{more}</Box>
            </Box>,
          ]
        : features

      const spend = spends[mod.name]
      const resetGlyph = look.glyph.cycle.replace(/[[\]\s]/g, '')
      // The Spend card leads the settings cards, in the same round border.
      const spendCard = mod.showcase?.cost
        ? section(
            { Box, Text },
            look,
            'page-spend',
            'cost',
            text.spendTitle,
            <Text key="page-spend-text" color={THEME.muted} wrap="wrap">{spend ? spendLine(spend) : text.spendNone}</Text>,
            THEME.accent,
            {
              right: spend
                ? pill(
                    { Box, Text },
                    look.nerd,
                    THEME.surface3,
                    <Client key="page-spend-reset" module="./entry.tsx" height={1} props={{ id: `spend-reset-${mod.name}`, label: `${text.spendReset} ${resetGlyph}`, isOpen: false, bg: THEME.surface3, color: THEME.onSurface, idle: THEME.onSurface, still, tip: { glyph: resetGlyph, label: text.spendReset, text: text.tipSpendReset } } satisfies EntryProps} />,
                    'page-spend-pill',
                    THEME.bg,
                  )
                : null,
            },
          )
        : null
      return frame([
        <Box key="page-head" flexDirection="row">
          {tabRow({ Box, Client, Text }, look.nerd, [listTab(false), { id: 'manager-page', label: shownName(mod.name), icon: look.glyph.icon[iconOf(mod.name)] ?? look.glyph.title, isOpen: true, tip: { glyph: look.glyph.title, label: shownName(mod.name), text: text.tipTabPage } }], still)}
        </Box>,
        section(
          { Box, Text },
          look,
          'page-about',
          iconOf(mod.name),
          fill(text.pageTitle, { name: shownName(mod.name), sep: MARK.sep, version: mod.version }),
          <Box key="page-about-body" flexDirection="column">
            <Text color={THEME.muted}>{mod.description}</Text>
            {mod.showcase?.tagline ? <Text color={THEME.secondary}>{mod.showcase.tagline}</Text> : null}
          </Box>,
          THEME.accent,
          { hint: mod.enabled ? text.stateOn : text.stateOff },
        ),
        mod.showcase?.cost
          ? section(
              { Box, Text },
              look,
              'page-cost',
              'cost',
              text.costTitle,
              // A setting named in backticks stands out, so the reader knows what to look for.
              <Text key="page-cost-text" color={THEME.muted} wrap="wrap">
                {mod.showcase.cost.summary.split('`').map((part, n) => (n % 2 ? <Text key={`cost-part-${n}`} color={THEME.accent}>{part}</Text> : part))}
              </Text>,
              THEME.accent,
              { right: costPill({ Box, Text }, look.nerd, look.glyph.icon.cost!, THEME.bg, 'page-cost-pill') },
            )
          : null,
        spendCard,
        mod.enabled || mod.settings === 0 ? (
          settingsBody({ Box, Button, Client, Text }, look, { rows, actions, working, run, previews: mod.showcase?.previews, fields: mod.fields, editors, still, mod: mod.name })
        ) : (
          <Box key="page-off" flexDirection="column">
            {cardGap({ Box, Text }, 'page-off')}
            <Text color={THEME.muted}>{fill(text.turnOnFirst, { name: shownName(mod.name) })}</Text>
          </Box>
        ),
        section({ Box, Text }, look, 'features', 'features', text.sectionFeatures, features.length ? featureRows : <Text color={THEME.muted}>{text.noFeatures}</Text>),
      ], [...actionReveals(actions, look, working), ...editorReveals(rows, editors, look, working)], { hint, status: withMark(look, note) })
    }

    if (!catalogLoaded) await loadSetup($)
    const cats = catalogRows()
    const steps = planNow()
    const isBusy = working || isApplying
    // The switch already says on or off, so the text beside the version is only for an update.
    const updateOf = (item: ModInfo) => {
      const update = cats.find(cat => cat.name === item.name && cat.canUpdate)
      return update ? { update: fill(text.stateUpdate, { version: update.version }) } : {}
    }

    // One section per source, so a row needs no "yours" or "installed" label of its own.
    const group = (source: ModInfo['source'], title: string, icon: string, hint = '') => {
      const members = mods.map((item, index) => ({ item, index })).filter(({ item }) => item.isOwn === (source === 'dir'))
      if (members.length === 0) return null
      return section(
        { Box, Text },
        look,
        `list-${source}`,
        icon,
        title,
        <Client
          key={`list-${source}`}
          module="./list.tsx"
          height={members.length}
          props={{
            rows: members.map(({ item, index }) => ({
              index,
              name: shownName(item.name),
              version: item.version,
              enabled: isOn(item),
              // A command named after its mod repeats the folder the hover card names, so only other commands show.
              commands: item.commands.filter(name => name !== item.name),
              hasSettings: item.settings > 0,
              ...updateOf(item),
              // A Client prop refuses undefined, so a mod without a cost leaves the key out.
              // The footer tip is one row, so it says only that the mod costs; the page card holds the full summary.
              ...(item.showcase?.cost ? { cost: spends[item.name] ? `${spendLine(spends[item.name]!)} ${MARK.sep} ${text.costTip}` : text.costTip } : {}),
            })),
            gear: look.glyph.gear,
            still,
            nameWidth: Math.max(...members.map(({ item }) => shownName(item.name).length)),
            icon: look.glyph.icon[icon] ?? '',
            nerd: look.nerd,
            switchTip: { glyph: bare(look.glyph.on), label: '', text: text.tipSwitch },
            openTip: text.tipOpen,
            openChip: text.openChip,
            costGlyph: look.glyph.icon.cost!,
            costLabel: text.costTitle,
          } satisfies ListProps}
        />,
        THEME.accent,
        { hint },
      )
    }
    const applyLabel = fill(text.applyAction, { n: steps.length })
    const onCount = mods.filter(isOn).length
    const counts = fill(text.onOffCount, { on: onCount, off: mods.length - onCount, sep: MARK.sep })

    // The sticky card above the list keeps its space while nothing is hovered, so the list never jumps.
    const shownAt = hovering >= 0 ? hovering : heldCard
    const hovered = mods[shownAt]
    // The card's text is the pane's width less its border and padding; a description past its rows gives the last one to the control.
    const wrapped = hovered ? wrapRows(hovered.description || text.noDescription, Math.max(10, e.props.bodyColumns - 6)) : []
    const isClipped = wrapped.length > TEXT_ROWS
    // A cut description keeps its card once the pointer leaves the row, so the pointer can reach the control.
    if (hovering >= 0) heldCard = isClipped ? hovering : -1
    const isFull = isClipped && hovered !== undefined && fullCard === hovered.name
    // Opened, the card grows to every row, as far as the pane has room for it.
    const roomRows = Math.max(TEXT_ROWS, e.props.scroll.bodyRows - HEAD_ROWS - FOOTER_ROWS - 4)
    const textShown = isFull ? Math.min(wrapped.length, roomRows) : TEXT_ROWS
    const cardRows = CARD_ROWS + (textShown - TEXT_ROWS)
    const shownRows = wrapped.slice(0, textShown)
    const moreLabel = isFull ? text.showLess : text.showAll
    const moreArrow = isFull ? look.glyph.less : look.glyph.more
    const moreControl = (
      <Client key={CARD_MORE} module="./entry.tsx" width={[...moreLabel].length + 4} height={1} props={{ id: CARD_MORE, label: moreLabel, lead: moreArrow, leadColor: THEME.accent, isOpen: false, bg: cardFill(), idle: THEME.muted, still, nerd: look.nerd, tip: { glyph: moreArrow, label: moreLabel, text: isFull ? text.tipShowLess : text.tipShowAll } } satisfies EntryProps} />
    )
    const hoverCard = () => {
      return stickyCard(
        { Box, Text },
        e.props.scroll.offset,
        e.props.bodyColumns,
        cardRows,
        hovered ? (
          <Box key="hover-card" flexDirection="column">
            <Box key="hover-card-text" height={shownRows.length} flexDirection="column" overflow="hidden" flexShrink={0}>
              {shownRows.map((row, at) =>
                isClipped && at === shownRows.length - 1 ? (
                  <Box key={`card-row-${at}`} flexDirection="row">
                    <Box key="card-row-text" flexShrink={1}><Text color={THEME.muted} wrap="truncate-end">{row || ' '}</Text></Box>
                    <Box key="card-row-gap" flexGrow={1} />
                    <Box key="card-row-more" flexShrink={0}>{moreControl}</Box>
                  </Box>
                ) : (
                  <Text key={`card-row-${at}`} color={THEME.muted} wrap="truncate-end">{row || ' '}</Text>
                ),
              )}
            </Box>
          </Box>
        ) : (
          <Text key="hover-card-empty" color={THEME.muted}>{text.cardEmpty}</Text>
        ),
        THEME.accent,
        hovered ? titleEdge({ Box, Text }, look, 'hover-card', '', fill(text.pageTitle, { name: shownName(hovered.name), sep: MARK.sep, version: hovered.version }), `${MARK.sep} ${hovered.name}`, 0) : null,
      )
    }

    // One switch for every mod's icons; Mixed when they differ, and nothing at all when no mod has the setting.
    const iconRows = await iconRowsOf($)
    const iconValues = new Set(iconRows.map(row => String(row.value)))
    const iconsNow = iconValues.size === 1 ? [...iconValues][0] : ''
    const iconChoices = ICON_MODES.map(mode => ({
      key: `icons-${mode}`,
      isOn: iconsNow === mode,
      props: { id: `icons-${mode}`, label: (text.iconModes as Record<string, string>)[mode]!, still, tip: { glyph: look.glyph.title, label: text.iconsLabel, text: fill(text.tipIcons, { mode: (text.iconModes as Record<string, string>)[mode]! }) } },
    }))
    // The card also carries the font line: shown once the check found no Nerd Font, with a link to get one.
    const iconsCard =
      iconRows.length || fontFound === false
        ? section(
            { Box, Text },
            look,
            'sec-icons',
            'icons',
            text.iconsLabel,
            <Box key="icons-body" flexDirection="column">
              {iconRows.length
                ? settingHead({ Box, Text }, 'icons-switch-row', iconsNow ? text.iconsAll : `${text.iconsAll} ${MARK.sep} ${text.iconsMixed}`, choiceBar({ Box, Client, Text, Button }, look, 'icons', cardFill(), iconChoices))
                : null}
              {iconRows.length ? hairline({ Client }, 'icons-rule', cardFill()) : null}
              {iconRows.length ? <Text color={THEME.muted}>{text.iconsDescription}</Text> : null}
              {fontFound === false ? (
                <Text key="nerd-line" color={THEME.muted}>
                  <Text color={THEME.warn}>{look.glyph.warn}</Text>
                  {sepText({ Text }, ` ${text.noNerdFont} ${MARK.sep} `, THEME.muted, 'nerd-line-text')}
                  <Link href={text.nerdFontsUrl} label={text.getOne} />
                </Text>
              ) : null}
            </Box>,
          )
        : null

    const notInstalled = cats.filter(cat => cat.canInstall)
    const pickList = (kind: PickProps['kind'], rows: PickProps['rows'], tickedLabel: string, tip: string) => (
      <Client
        key={`list-${kind}`}
        module="./setup.tsx"
        height={rows.length}
        props={{ kind, rows, nameWidth: Math.max(...rows.map(row => row.name.length)), on: tickedLabel, nerd: look.nerd, tipGlyph: bare(look.glyph.on), tip, still } satisfies PickProps}
      />
    )
    const notInstalledCard = notInstalled.length
      ? section(
          { Box, Text },
          look,
          'sec-install',
          'not-installed',
          text.sectionNotInstalled,
          pickList('install', notInstalled.map(cat => ({ key: cat.key, name: shownName(cat.name), ticked: installs.has(cat.key), detail: fill(text.pickDetail, { version: cat.version, sep: MARK.sep, description: cat.description }) })), text.tickAdd, text.tipPickInstall),
        )
      : null

    // Updates start ticked; the card lists every mod behind the marketplace, and always says where auto-update lives.
    const updatable = cats.filter(cat => cat.canUpdate)
    const arrow = look.glyph.icon.arrow ?? ''
    const pluginControl = isBusy ? (
      <Text key="open-plugin" color={THEME.muted}>{`${look.glyph.go} ${text.openPlugin}`}</Text>
    ) : (
      // A pill around a plain Button, since opening /plugin needs the person's press behind it; the glyph rides in the label so the whole pill lights.
      pill(
        { Box, Text },
        look.nerd,
        THEME.surface3,
        // Swapped on purpose: the engine inverts a Button under the pointer, which lands it as accent on surface-4.
        <Button key="open-plugin" label={look.nerd ? `${bare(look.glyph.go)} ${text.openPlugin}` : ` ${bare(look.glyph.go)} ${text.openPlugin} `} plain hover={{ scope: 'open-plugin-pill', color: THEME.lifted, backgroundColor: THEME.accent }} onPress={() => openPlugin($)} />,
        'open-plugin-pill',
        cardFill(),
        THEME.lifted,
      )
    )
    const updatesCard = section(
      { Box, Text },
      look,
      'sec-updates',
      'updates',
      text.sectionUpdates,
      <Box key="updates-body" flexDirection="column">
        {updatable.length ? (
          pickList('update', updatable.map(cat => ({ key: cat.key, name: shownName(cat.name), ticked: !skipped.has(cat.key), detail: fill(text.pickUpdateDetail, { from: cat.installedVersion, to: cat.version, arrow }) })), text.tickUpdate, text.tipPickUpdate)
        ) : (
          <Text key="updates-none" color={THEME.muted}>{catalogEntries.length ? text.updatesNone : text.noCatalog}</Text>
        )}
        <Box key="updates-auto" flexDirection="column" marginTop={updatable.length ? 1 : 0}>
          <Text color={THEME.muted}>{text.autoUpdateOff}</Text>
          <Box key="updates-auto-row" flexDirection="row" columnGap={1}>
            {/* The hint wraps in a narrow pane; the pill never does. */}
            <Box key="open-plugin-cell" flexShrink={0} alignSelf="flex-start">{pluginControl}</Box>
            <Text color={THEME.muted} wrap="wrap">{fill(text.pluginHint, { market })}</Text>
          </Box>
          {/* Its own line, so the busy note never reads as part of the Open /plugin instruction. */}
          {isBusy ? <Text key="open-plugin-busy" color={THEME.muted}>{fill(text.pluginBusy, { label: text.openPlugin })}</Text> : null}
        </Box>
      </Box>,
    )

    // Only while something is pending: what was checked, every line Apply runs, and the Apply control.
    const checks = checkedOf({ version: ccVersion, market, hasCatalog: catalogEntries.length > 0, fontFound })
    const goLead = { subLead: bare(look.glyph.go), subLeadColor: THEME.accent }
    const spinning = isApplying ? (
      <Box key="apply-running" flexDirection="row">
        <Client key="manager-applying" module="./entry.tsx" height={1} props={{ id: 'manager-applying', label: fill(text.applyRunning, { n: steps.length }), isOpen: false, bg: cardFill(), nerd: look.nerd, still, spinner: true, tight: true }} />
        {sepText({ Text }, ` ${fill(text.applyRunningNote, { sep: MARK.sep })}`, THEME.muted, 'apply-running-note')}
      </Box>
    ) : null
    const applyCard =
      steps.length || isApplying
        ? [
            section(
              { Box, Text },
              look,
              'sec-apply',
              'apply',
              text.checkedTitle,
              <Box key="apply-body" flexDirection="column">
                {checkedRows({ Box, Text }, look.nerd, { ok: text.tagOk, warn: text.tagWarn }, checks)}
              </Box>,
            ),
            section(
              { Box, Text },
              look,
              'sec-about',
              'apply',
              text.aboutTitle,
              <Box key="about-body" flexDirection="column">
              <Box key="apply-lines" flexDirection="column">
                {planRows({ Box, Text }, steps)}
              </Box>
              <Box key="list-apply" flexDirection="row" marginTop={1}>
                {/* A reload while Claude works would only queue as a prompt, and Apply twice would reload twice. */}
                {isApplying ? (
                  spinning
                ) : working ? (
                  sepText({ Text }, fill(text.applyBusy, { label: applyLabel, sep: MARK.sep }), THEME.muted, 'apply-busy')
                ) : (
                  [
                    <Box key="apply-gap" flexGrow={1} />,
                    pill({ Box, Text }, look.nerd, THEME.surface3, <Client key="manager-apply" module="./entry.tsx" height={1} props={{ id: 'manager-apply', label: applyLabel, isOpen: true, bg: THEME.surface3, nerd: look.nerd, still, ...goLead, tip: { glyph: bare(look.glyph.cycle), label: applyLabel, text: text.tipApply } }} />, 'manager-apply-pill', cardFill()),
                  ]
                )}
              </Box>
            </Box>,
            ),
          ]
        : null

    return frame([
      <Box key="list-head" flexDirection="row">
        {tabRow({ Box, Client, Text }, look.nerd, [listTab(true)], still)}
      </Box>,
      cardSpace({ Box }, cardRows),
      mods.length === 0 ? <Text key="list-empty" color={THEME.muted}>{text.noMods}</Text> : null,
      group('dir', text.sectionYours, 'mod', counts),
      group('installed', text.sectionInstalled, 'installed', mods.some(item => item.isOwn) ? '' : counts),
      notInstalledCard,
      iconsCard,
      updatesCard,
      applyCard ? <Box key="apply-cards" flexDirection="column">{applyCard}</Box> : null,
      hoverCard(),
    ], isBusy ? [] : [{ scope: 'open-plugin-pill', tip: { glyph: bare(look.glyph.go), label: text.openPlugin, text: text.tipOpenPlugin } }], { hint: fill(text.listHint, { sep: MARK.sep }), status: withMark(look, note) })
  })
}

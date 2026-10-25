// mod-model-effort / hooks/register.tsx, by v-amorim
// Registers the mod: wires the meter, settings pane, commands, toasts and model switching.
import type { ConfigValue, EngineInterface, Register, RenderElement } from 'claude-code'

import { bridgeOn, endBridge, startBridge, type BridgeRecord } from './bridge'
import { displayName, LEVEL_LOOK, LEVELS, plainModel, withEffort, withModel } from './levels'
import { entryCells, isTipMessage, tipText, type EntryMessage, type EntryProps, type Tip, type TipMessage } from './entry'
import { cardFill, detectNerd, FOOTER_ROWS, lookFor, paneFooter, sepText, titleEdge, type IconMode, withMark } from './look'
import { meterCells, type MeterMessage } from './meter'
import { settingChoice, settingsBody } from './settings'
import style from './style'
import { firstText, isSpeed, replySpeed, watch } from './speed'
import { fill, MARK, statusColor, THEME } from './theme'
import { labelsOf, PILL, pill, pillRow, splitRow, tabRow, tipLine } from './pills'
import text from './text'
import { TOAST_MS, ToastList, toastCards } from './toasts'

const homeOf = async ($: EngineInterface) => ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '').replace(/\\/g, '/')

const configDir = async ($: EngineInterface) => ((await $.env.get('CLAUDE_CONFIG_DIR')) || `${await homeOf($)}/.claude`).replace(/\\/g, '/')

const PANE ='model-effort-settings'

// Streams the step as it is and keeps the speed of a reply that came out whole.
async function* timed<C extends { kind: string }, R extends { usage: { output_tokens: number } | null }>($: EngineInterface, open: () => AsyncGenerator<C, R>): AsyncGenerator<C, R> {
  // A clock that fails only costs the reading, never the stream.
  const tick = () => $.clock.now().catch(() => undefined)
  const start = await tick()
  let first: number | undefined
  const result = yield* watch(open(), async chunk => {
    if (first === undefined && (chunk.kind === 'text' || chunk.kind === 'thinking')) first = await tick()
  })
  const end = await tick()
  const speed = start === undefined || end === undefined ? null : replySpeed(start, first, end, result.usage?.output_tokens)
  if (speed) await $.state.set({ plugin: 'mod-model-effort', key: 'speed' }, speed)
  return result
}

// The tip with the last reply's speed after it; as it was before any reply.
const withSpeed = (tip: Tip, speed: unknown): Tip => {
  if (!isSpeed(speed)) return tip
  return { ...tip, text: `${tip.text} ${MARK.sep} ${fill(text.tipSpeed, { first: firstText(speed.first), rate: String(speed.rate) })}` }
}

// The icons setting (userConfig), fixed per activation: a change reloads the mod.
let iconMode: IconMode = 'auto'
let look = lookFor(false)
let note = ''
let flash: string | null = null
// The clicked level and the level before it; a saved level other than these means Alt+P or /effort took over.
let override: { effort: string; before: string } | null = null

// Nerd glyphs when the setting asks for them, or on auto when the terminal's font is a Nerd Font.
async function detectLook($: EngineInterface) {
  if (iconMode !== 'auto') return lookFor(iconMode === 'nerd')
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
  return lookFor(await detectNerd(env, host))
}

// Reading the terminal's settings is slow, so on auto the last answer in the store draws until it returns.
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

const isPaneOpen = async ($: EngineInterface) => (await $.ui.panes()).some(pane => pane.id === PANE && pane.isPlaced)

// `/mod-model-effort settings` toggles the panel. An unplaced pane is waiting, not open.
async function togglePane($: EngineInterface) {
  if (await isPaneOpen($)) {
    await $.ui.close({ id: PANE })
    await $.state.set({ plugin: 'mod-model-effort', key: 'pane' }, false)
    return
  }
  note = ''
  const opened = await $.ui.open({ id: PANE, title: text.paneName, closeOnEscape: true })
  if (!opened.isPlaced) $.ui.toast(fill(text.settingsWaiting, { reason: opened.reason }))
  await $.state.set({ plugin: 'mod-model-effort', key: 'pane' }, opened.isPlaced)
}

// Saves the clicked level for the main model, as Alt+P does; the next request's effort shows whether it took.
async function setEffort($: EngineInterface, effort: string) {
  const current = (await $.state.get({ plugin: 'mod-model-effort', key: 'current' })).value
  if (!current) {
    $.ui.toast(text.sendFirst)
    return
  }
  const path = `${await configDir($)}/settings.json`
  // A fresh machine has no settings.json yet: start from {} and create it.
  const isMissing = !(await $.fs.exists(path).catch(() => true))
  let raw: string
  try {
    raw = isMissing ? '{}' : String(await $.fs.read(path))
  } catch {
    $.ui.toast(fill(text.settingsNotJson, { mark: MARK.warn }))
    return
  }
  const out = withEffort(raw, current.model, effort)
  if (!out) {
    $.ui.toast(fill(text.settingsNotJson, { mark: MARK.warn }))
    return
  }
  // The first backup is the one worth keeping: later clicks never replace it.
  const backup = `${path}.mod-model-effort.bak`
  if (!isMissing && !(await $.fs.exists(backup).catch(() => false))) await $.fs.write(backup, raw)
  await $.fs.write(path, out)
  override = { effort, before: current.effort }
  await $.state.set({ plugin: 'mod-model-effort', key: 'current' }, { model: current.model, effort })
  flash = effort
  $.ui.invalidate('ui.render')
  $.clock.after(2000, () => {
    if (flash !== effort) return
    flash = null
    $.ui.invalidate('ui.render')
  })
}


// The level Claude Code reads for a model: the model's own, else the one for every model.
async function savedEffort($: EngineInterface, model: string) {
  const settings = await $.settings.read()
  const models = settings.modelSettings as Record<string, { effortLevel?: unknown }> | undefined
  const effort = models?.[model]?.effortLevel ?? settings.effortLevel
  return typeof effort === 'string' ? effort : null
}

// The pill's model and level, and the model the store keeps for the next session's start.
async function setCurrent($: EngineInterface, model: string, effort: string) {
  await $.state.set({ plugin: 'mod-model-effort', key: 'current' }, { model, effort })
  await $.store.set('model', model)
  $.ui.invalidate('ui.render')
}

// The session's model as the last render saw it.
let lastLive: string | undefined

// The pill moves to a model the session switched to, at the level saved for it.
async function followModel($: EngineInterface, to: string) {
  const current = (await $.state.get({ plugin: 'mod-model-effort', key: 'current' })).value
  // A clicked level was set on the old model; the new model's saved level applies.
  if (to !== current?.model) override = null
  await setCurrent($, to, (await savedEffort($, to)) ?? current?.effort ?? 'medium')
}

// Alt+P and /effort save the level to the settings, so a settings change shows it on the pill at once.
async function followSavedLevel($: EngineInterface) {
  const current = (await $.state.get({ plugin: 'mod-model-effort', key: 'current' })).value
  const saved = current ? await savedEffort($, current.model) : null
  if (!current || !saved) return
  // Same rule as turn.step: a saved level other than the clicked one and the one before it means another level took over.
  if (override && saved !== override.effort && saved !== override.before) override = null
  const effort = override?.effort ?? saved
  if (effort === current.effort) return
  await $.state.set({ plugin: 'mod-model-effort', key: 'current' }, { model: current.model, effort })
  $.ui.invalidate('ui.render')
}

// A reload makes the bridge replay the last record of each event once. The first record of an event after this module started is skipped when it is the one already handled, so a replayed old switch never moves the pill back.
const replayChecked = new Set<string>()
const REPLAY_KEPT_MS = 30 * 24 * 60 * 60 * 1000
const replayKey = (session: string, event: string) => `bridge-last:${session}:${event}`

async function isReplay($: EngineInterface, record: BridgeRecord) {
  const key = replayKey(String(record.session_id ?? ''), String(record.hook_event_name ?? ''))
  const raw = JSON.stringify(record)
  const isFirst = !replayChecked.has(key)
  replayChecked.add(key)
  const kept = (await $.store.get(key).catch(() => undefined)) as { raw?: unknown } | undefined
  await $.store.set(key, { raw, at: await $.clock.now() }).catch(() => undefined)
  return isFirst && kept?.raw === raw
}

// Keys of sessions long gone leave the store.
async function pruneReplays($: EngineInterface) {
  try {
    const now = await $.clock.now()
    for (const key of await $.store.keys()) {
      if (key.startsWith('bridge-last:') && Number(((await $.store.get(key)) as { at?: unknown } | null)?.at) < now - REPLAY_KEPT_MS) await $.store.delete(key)
    }
  } catch {
    // Old entries stay until the next start.
  }
}

// /model and the Alt+P picker switch without a request, so the pill follows at once. A failed read never blocks the switch.
async function modelSwitched($: EngineInterface, record: BridgeRecord) {
  try {
    if (await isReplay($, record)) return
    if (typeof record.to_model === 'string' && record.to_model) await followModel($, record.to_model)
  } catch {
    // The next request shows the model and level.
  }
}

// Alt+P and /effort save the level to the user settings; any other source leaves the pill alone.
async function configChanged($: EngineInterface, record: BridgeRecord) {
  try {
    if (record.source === 'user_settings') await followSavedLevel($)
  } catch {
    // The next request shows the level.
  }
}

// The level last seen in the settings for the pill's model, and whether a check of it is already waiting.
let lastSaved: { model: string; effort: string | null } | undefined
let isCheckingLevel = false

// The ConfigChange record can fail to arrive, so a render looks for a changed saved level. Only a change counts, so a level a request downgraded stays.
async function followSavedChange($: EngineInterface) {
  const current = (await $.state.get({ plugin: 'mod-model-effort', key: 'current' })).value
  if (!current) return
  const seen = lastSaved
  lastSaved = { model: current.model, effort: await savedEffort($, current.model) }
  if (seen?.model === current.model && seen.effort !== lastSaved.effort) await followSavedLevel($)
}

// The pill part or menu entry under the pointer, shown in the tip row.
let bandTip: TipMessage | null = null

// A band redraw can replace a hovered entry, whose leave and quiet timer then never come, so a band tip ends on its own.
const BAND_TIP_MS = 5000
let bandTipAt = 0

function expireBandTip($: EngineInterface) {
  const at = ++bandTipAt
  $.clock.after(BAND_TIP_MS, () => {
    if (at !== bandTipAt || !bandTip) return
    bandTip = null
    $.ui.invalidate('ui.render')
  })
}

// The settings pane's control under the pointer, shown in its footer.
let paneTip: Tip | null = null

// The level under the pointer, named beside the pill like a clicked level is.
const hoveredLevel = () => (bandTip?.id?.startsWith('effort-level-') ? bandTip.id.slice('effort-level-'.length) : null)

// The model menu above the pill, opened by a click on the model name.
let isModelMenuOpen = false

// The effort card above the pill, opened by a click on a compact meter.
let isEffortCardOpen = false

// Whether Claude is working, as the band's last draw saw it: `/model` run by a click would queue as a prompt.
let isWorking = false

// The models used before, newest first, as the menu last drew them; an entry's id is its index.
let menuModels: string[] = []

// Switches through Claude Code's own `/model`, then shows the pick at once instead of after the next request.
async function switchModel($: EngineInterface, id: string) {
  isModelMenuOpen = false
  bandTip = null
  try {
    await $.command.run({ command: 'model', args: id })
  } catch (error) {
    $.ui.toast(fill(text.switchFailed, { mark: MARK.warn, model: displayName(id), error: String(error) }))
    return
  }
  const current = (await $.state.get({ plugin: 'mod-model-effort', key: 'current' })).value
  await setCurrent($, id, current?.effort ?? 'medium')
}

// Claude Code's own picker has every model, new ones included.
async function openPicker($: EngineInterface) {
  isModelMenuOpen = false
  bandTip = null
  $.ui.invalidate('ui.render')
  await $.command.run({ command: 'model', args: '' }).catch(error => $.ui.toast(fill(text.pickerFailed, { mark: MARK.warn, error: String(error) })))
}

type Elements = { Box: (props: any) => RenderElement; Client: (props: any) => RenderElement; Text: (props: any) => RenderElement }

// A model entry as its own pill on the card; `entry` holds what differs between the current model, the others and the picker.
const menuEntry = ({ Box, Client, Text }: Elements, id: string, fill: string, entry: Omit<EntryProps, 'id' | 'bg'>) =>
  pill({ Box, Text }, look.nerd, fill, <Client key={id} module="./entry.tsx" height={1} props={{ id, bg: fill, nerd: look.nerd, still, ...entry } satisfies EntryProps} />, `${id}-pill`, cardFill())

// A control glyph without the brackets and padding it carries as a Button label, for drawing as a subpill.
const bare = (glyph: string) => glyph.replace(/[[\]\s]/g, '')

// The models used before (the current one with a ✓), the full picker and ×: one line while it fits the band, else stacked.
function modelMenu(elements: Elements, currentId: string, columns: number) {
  const { Box } = elements
  const ok = bare(look.glyph.ok)
  // While Claude works a pick would queue as a prompt, so the entries draw muted and a click only says why.
  const live = !isWorking
  // Stacked, the others start with blanks as wide as the ✓ subpill, so every name lines up.
  const blank = ' '.repeat([...ok].length + 2)
  const models: [string, string, Omit<EntryProps, 'id' | 'bg'>][] = menuModels.map((id, index) =>
    currentId && id === plainModel(currentId)
      ? [`effort-model-${index}`, THEME.surface3, { label: displayName(id), isOpen: live, idle: THEME.muted, subLead: ok, subLeadColor: THEME.ok, tip: { glyph: ok, label: displayName(id), text: text.tipModelEntry } }]
      : [`effort-model-${index}`, THEME.surface2, { label: displayName(id), isOpen: live, idle: THEME.muted, tip: { glyph: ok, label: displayName(id), text: text.tipModelEntry } }],
  )
  const all: [string, string, Omit<EntryProps, 'id' | 'bg'>] = ['effort-model-all', THEME.surface2, { label: text.allModels, isOpen: false, subLead: bare(look.glyph.go), tip: { glyph: bare(look.glyph.go), label: text.allModels, text: text.tipAll } }]
  // The × closes the menu without a pick, as on a toast card.
  const close: [string, string, Omit<EntryProps, 'id' | 'bg'>] = ['effort-model-close', THEME.surface3, { label: bare(look.glyph.close), isOpen: false, tip: { glyph: bare(look.glyph.close), label: text.labelClose, text: text.tipModelClose } }]
  const line = [...models, all, close]
  // Each pill is its entry plus two caps on Nerd; the card adds its border and padding, two cells a side.
  const lineCells = line.reduce((sum, [id, bg, entry]) => sum + entryCells({ id, bg, nerd: look.nerd, ...entry }) + (look.nerd ? 2 : 0), line.length - 1 + 4)
  const draw = ([id, bg, entry]: [string, string, Omit<EntryProps, 'id' | 'bg'>]) => menuEntry(elements, id, bg, entry)
  const stacked = models.map(([id, bg, entry]) => draw([id, bg, entry.subLead ? entry : { ...entry, label: `${blank}${entry.label}` }]))
  return (
    <Box key="effort-models-row" flexDirection="row" justifyContent="flex-end">
      <Box key="effort-models-block" flexDirection="column">
      {lineCells <= columns ? (
        <Box key="effort-models" flexDirection="row" columnGap={1} paddingX={1} borderStyle="round" borderColor={THEME.border} backgroundColor={cardFill()}>
          {line.map(draw)}
        </Box>
      ) : (
        <Box key="effort-models" flexDirection="column" alignItems="flex-start" paddingX={1} borderStyle="round" borderColor={THEME.border} backgroundColor={cardFill()}>
          <Box key="effort-models-head" flexDirection="row" columnGap={1}>
            {stacked[0] ?? null}
            {draw(close)}
          </Box>
          {stacked.slice(1)}
          {draw(all)}
        </Box>
      )}
      {titleEdge(elements, look, 'effort-models', '', text.labelModel, '', 0)}
      </Box>
    </Box>
  )
}

// The effort card above the pill row: the meter held open, then a × pill; opened by a click on a compact meter.
function effortCard(elements: Elements, meterProps: Record<string, unknown>) {
  const { Box, Client } = elements
  const close = menuEntry(elements, 'effort-card-close', THEME.surface3, { label: bare(look.glyph.close), isOpen: false, tip: { glyph: bare(look.glyph.close), label: text.labelClose, text: text.tipCardClose } })
  return (
    <Box key="effort-card-row" flexDirection="row" justifyContent="flex-end">
      <Box key="effort-card-block" flexDirection="column">
      <Box key="effort-card" flexDirection="row" columnGap={1} paddingX={1} borderStyle="round" borderColor={THEME.border} backgroundColor={cardFill()}>
        <Client key="effort-card-meter" module="./meter.tsx" height={1} props={{ ...meterProps, card: true, compact: false, under: cardFill() }} />
        {close}
      </Box>
      {titleEdge(elements, look, 'effort-card', '', text.labelEffort, '', 0)}
      </Box>
    </Box>
  )
}

const toasts = new ToastList('effort')
// The animations setting, fixed per activation: off, every entry draws still.
let still = false

// A settings card's click: its row, saved through /config; a saved change reloads this mod.
async function saveSetting($: EngineInterface, key: string, value: ConfigValue) {
  const row = (await $.config.list()).find(each => each.key === key)
  if (!row) return
  const result = await $.config.set({ key: row.key, value })
  note = 'deny' in result && result.deny ? `${MARK.warn} ${result.deny}` : `${MARK.ok} ${fill(text.settingSaved, { label: row.label })}`
  $.ui.invalidate('ui.render')
}

export const register: Register = (on, options) => {
  still = options.animations === false
  toasts.isStill = still
  iconMode = (options.icons as IconMode | undefined) ?? 'auto'
  look = lookFor(iconMode === 'nerd')
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

  on('session.start', async ($, e, next) => {
    // The classic hooks never reach a mod, so the command hooks in hooks.json hand these over through the bridge.
    bridgeOn('PostModelSwitch', record => modelSwitched($, record))
    bridgeOn('ConfigChange', record => configChanged($, record))
    await startBridge($, 'mod-model-effort')
    await pruneReplays($)
    await loadLook($)
    await $.command.register({ name: 'mod-model-effort', description: text.commandDescription, argumentHint: '[settings]' })
    await $.state.set({ plugin: 'mod-model-effort', key: 'pane' }, await isPaneOpen($))
    // Before the first request the session's own model stands in, since `--model` can differ from the last session's.
    const own = await $.session.model().catch(() => undefined)
    const model = typeof own === 'string' && own ? own : await $.store.get('model')
    if (typeof model === 'string') {
      const effort = await savedEffort($, model)
      if (effort) await $.state.set({ plugin: 'mod-model-effort', key: 'current' }, { model, effort })
    }

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    // What the ended session's file still holds is delivered before the session id changes under it.
    await endBridge($, e.sessionId)
    for (const event of ['PostModelSwitch', 'ConfigChange']) await $.store.delete(replayKey(e.sessionId, event)).catch(() => undefined)

    return next(e)
  })

  on('command.run', { command: 'mod-model-effort' }, async ($, e) => {
    if (e.args.trim() !== 'settings') return { text: text.usage }
    await togglePane($)
    return { text: '' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) await $.state.set({ plugin: 'mod-model-effort', key: 'pane' }, false)

    return next(e)
  })

  on('state.set', async ($, e, next) => {
    if (e.key === 'pane' && e.plugin !== 'mod-model-effort' && e.value === true) {
      $.clock.after(0, async () => {
        if (!(await isPaneOpen($))) return
        await $.ui.close({ id: PANE })
        await $.state.set({ plugin: 'mod-model-effort', key: 'pane' }, false)
      })
    }

    return next(e)
  })

  // Each main request carries the real model id and effort, so the meter always shows what went out.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId) return yield* next(e)
    if (typeof e.effort !== 'string') return yield* timed($, () => next(e))

    // Claude Code reads the saved level only at startup, so a clicked level rides on each request until Alt+P or /effort saves another.
    if (override) {
      const settings = await $.settings.read({ source: 'user' })
      const saved = (settings.modelSettings as Record<string, { effortLevel?: unknown } | undefined> | undefined)?.[e.model]?.effortLevel
      if (saved !== override.effort && saved !== override.before) override = null
    }
    const effort = override?.effort ?? e.effort
    const current = (await $.state.get({ plugin: 'mod-model-effort', key: 'current' })).value
    if (current?.model !== e.model || current?.effort !== effort) {
      await $.state.set({ plugin: 'mod-model-effort', key: 'current' }, { model: e.model, effort })
      await $.store.set('model', e.model)
    }

    const result = yield* timed($, () => next(effort === e.effort ? e : { ...e, effort: effort as typeof e.effort }))
    // Only a model the API answered joins the menu, so a mistyped or retired id never stays there.
    const models = await $.store.get('models')
    if (result.usage && !(Array.isArray(models) && models[0] === plainModel(e.model))) await $.store.set('models', withModel(models, e.model))
    return result
  })

  on('ui.message', async ($, e, next) => {
    if (isTipMessage(e.data)) {
      const tip = e.data
      const own = Boolean(tip.id?.startsWith('effort-') || tip.id?.startsWith('toast-effort-'))
      bandTip = own ? tip : null
      if (bandTip?.id) expireBandTip($)
      paneTip = tip.id && !own ? { glyph: tip.glyph ?? '', label: tip.label ?? '', text: tip.text ?? '' } : null
      $.ui.invalidate('ui.render')
      return next(e)
    }
    const change = settingChoice(e.data)
    if (change) await saveSetting($, change.key, change.value)
    const clicked = e.data as EntryMessage
    const dismissed = clicked?.type === 'menu-entry' ? toasts.idOf(clicked.id) : undefined
    if (dismissed !== undefined) {
      toasts.drop(dismissed)
      $.ui.invalidate('ui.render')
      return next(e)
    }
    if (clicked?.type === 'menu-entry' && clicked.id === 'effort-card-close') {
      isEffortCardOpen = false
      bandTip = null
      $.ui.invalidate('ui.render')
      return next(e)
    }
    if (clicked?.type === 'menu-entry' && clicked.id === 'effort-model-close') {
      isModelMenuOpen = false
      bandTip = null
      $.ui.invalidate('ui.render')
      return next(e)
    }
    if (clicked?.type === 'menu-entry' && clicked.id === 'effort-model-all') {
      if (isWorking) $.ui.toast(fill(text.modelBusy, { name: text.allModels }))
      else await openPicker($)
      return next(e)
    }
    const picked = clicked?.type === 'menu-entry' && clicked.id.startsWith('effort-model-') ? menuModels[Number(clicked.id.slice('effort-model-'.length))] : undefined
    if (picked && isWorking) {
      $.ui.toast(fill(text.modelBusy, { name: displayName(picked) }))
      return next(e)
    }
    if (picked) {
      await switchModel($, picked)
      return next(e)
    }
    const message = e.data as MeterMessage
    if (message?.type === 'effort-card') {
      isEffortCardOpen = !isEffortCardOpen
      isModelMenuOpen = false
      bandTip = null
      $.ui.invalidate('ui.render')
    }
    if (message?.type === 'model-menu') {
      isEffortCardOpen = false
      isModelMenuOpen = !isModelMenuOpen
      bandTip = null
      const current = (await $.state.get({ plugin: 'mod-model-effort', key: 'current' })).value
      menuModels = withModel(await $.store.get('models'), current?.model ?? (await $.session.model().catch(() => undefined)))
      $.ui.invalidate('ui.render')
    }
    if (message?.type === 'set') {
      isEffortCardOpen = false
      bandTip = null
      await setEffort($, message.effort)
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    await loadLook($)
    const hidden = await $.state.get({ plugin: 'mod-menu', key: 'hidden' })
    if (e.surface !== 'terminal' || e.props.hasSurvey) return next(e)
    isWorking = e.props.isWorking
    // With the menu hidden the pill steps aside, but a toast still needs its card.
    if (hidden.value === true) {
      if (toasts.items.length === 0) return next(e)
      const { Box, Client, Text } = $.ui.resolve(e)
      return <Box key="toasts-effort" flexDirection="column">{toastCards({ Box, Client, Text }, toasts, look, text.tipToast)}{await next(e)}</Box>
    }

    const { Box, Client, Text } = $.ui.resolve(e)
    const current = await $.state.get({ plugin: 'mod-model-effort', key: 'current' })
    let shown = current.value
    // The PostModelSwitch record can fail to arrive, so the session's model is the signal too.
    const live = await $.session.model().catch(() => undefined)
    if (typeof live === 'string' && displayName(live) !== live) {
      // Only a change of the session's model counts: a request on a fallback model leaves the pill as it went out.
      const isSwitched = lastLive !== undefined && live !== lastLive
      lastLive = live
      if (shown && isSwitched && live !== shown.model) {
        shown = { model: live, effort: (await savedEffort($, live).catch(() => null)) ?? shown.effort }
        // A render only reads, so the state follows right after it.
        $.clock.after(0, () => followModel($, live).catch(() => {}))
      }
    }
    if (!isCheckingLevel) {
      isCheckingLevel = true
      $.clock.after(250, () => followSavedChange($).catch(() => {}).finally(() => { isCheckingLevel = false }))
    }
    const modelId = shown?.model ?? (await $.session.model().catch(() => undefined))
    const model = displayName(modelId ?? '')
    const { group, row, rest, tip } = splitRow(await next(e))
    // The pill row cuts the meter to its level when the row overflows; labels never always does.
    const labels = labelsOf((await $.state.get({ plugin: 'mod-menu', key: 'labels' })).value)
    const fit = look.nerd && labels !== 'always' ? { cells: meterCells(model, look.nerd), compact: labels === 'never' } : {}
    const speed = (await $.state.get({ plugin: 'mod-model-effort', key: 'speed' })).value
    const meterProps = { effort: shown?.effort ?? null, model, bg: PILL.secondary, still, nerd: look.nerd, ...fit, tipModel: withSpeed({ glyph: look.glyph.title, label: text.labelModel, text: text.tipModel }, speed), tipRest: withSpeed({ glyph: look.glyph.title, label: text.paneName, text: text.tipRest }, speed), tipLevels: LEVELS.map(level => withSpeed({ glyph: LEVEL_LOOK[level]!.glyph, label: text.paneName, text: fill(text.tipLevel, { level: (text.levelNames as Record<string, string>)[level]! }) }, speed)) }
    const meter = <Client key="meter" module="./meter.tsx" height={1} props={meterProps} />
    // The level word follows the pill, so it never moves the glyphs under the pointer.
    const shownWord = hoveredLevel() ?? flash
    const word = shownWord ? <Text key="menu-flash" color={style.colors.pills.readout}>{(text.levelNames as Record<string, string>)[shownWord] ?? shownWord}</Text> : null

    const menu = isModelMenuOpen ? [modelMenu({ Box, Client, Text }, modelId, e.props.bodyColumns)] : isEffortCardOpen ? [effortCard({ Box, Client, Text }, meterProps)] : []
    return pillRow({ Box, Client, Text }, look.nerd, group, [...row, <Box key="menu-pill" flexDirection="row">{meter}</Box>, word], [...toastCards({ Box, Client, Text }, toasts, look, text.tipToast), ...rest, ...menu], bandTip?.id ? tipLine({ Box, Text }, tipText(bandTip)) : tip, e.props.bodyColumns)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    await loadLook($)
    if (e.requestId !== PANE) return next(e)

    // @ts-expect-error The host's types omit Client from a Pane's elements, yet a Pane draws it.
    const { Box, Button, Client, Text } = $.ui.resolve(e)
    const rows = (await $.config.list()).filter(row => row.key.startsWith('mod-model-effort.'))

    return (
      <Box flexDirection="column" backgroundColor={THEME.bg} paddingX={1} minHeight={e.props.scroll.bodyRows}>
        {tabRow({ Box, Client, Text }, look.nerd, [{ id: 'mod-model-effort-settings-tab', label: `${text.paneName} ${MARK.sep} ${text.paneSettings}`, icon: look.glyph.gear, isOpen: true, tip: { glyph: look.glyph.gear, label: text.paneSettings, text: text.tipTab } }], still)}
        {sepText({ Text }, withMark(look, note) || `${text.statusHint} ${MARK.sep} ${text.statusHintSaved}`, statusColor(note), 'settings-status', { wrap: 'truncate-end' })}
        {settingsBody({ Box, Button, Client, Text }, look, { rows, actions: [], working: false, run: async () => {}, previews: undefined, still: still })}
        <Box key="footer-space" height={FOOTER_ROWS} flexShrink={0} />
        {paneFooter({ Box, Text }, paneTip, e.props.bodyColumns, e.props.scroll)}
      </Box>
    )
  })
}

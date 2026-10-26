// mod-collision-guard / hooks/register.tsx, by v-amorim
// Wires the mod into the engine: checks edit tools for conflicts, asks, and draws its pane.
import type { ConfigValue, EngineInterface, Register, RenderChildren } from 'claude-code'

import { agoText, clearOwn, cleanReason, clockText, EDIT_TOOLS, findConflict, normalize, pathOf, recordEdit, titleOf, type Clash, type Io } from './guard'
import { GUARD, holdCard, type HoldView } from './hold'
import { isTipMessage, tipText, type EntryMessage, type Tip, type TipMessage } from './entry'
import { detectNerd, FOOTER_ROWS, lookFor, paneFooter, sepText, type IconMode, withMark } from './look'
import { pillRow, splitRow, tabRow, tipLine } from './pills'
import { settingChoice, settingsBody, type Action, type Previews, type Range } from './settings'
import text from './text'
import { TOAST_MS, ToastList, toastCards } from './toasts'
import { fill, MARK, statusColor, THEME } from './theme'

// The person's settings (userConfig), fixed per activation: a change reloads the mod.
let enabled = true
// The control under the pointer, from its tip post: the pane footer shows it.
let hovered: TipMessage | null = null
const hoveredTip = (): Tip | null => (hovered?.id && hovered.label ? { glyph: hovered.glyph ?? '', label: hovered.label, text: hovered.text ?? '' } : null)

// A band redraw can replace a hovered entry, whose leave and quiet timer then never come, so a band tip ends on its own.
const BAND_TIP_MS = 5000
let bandTipAt = 0
// The tip the band stopped showing; the pane footer keeps its own.
let bandExpired: TipMessage | null = null

function expireBandTip($: EngineInterface) {
  const at = ++bandTipAt
  $.clock.after(BAND_TIP_MS, () => {
    if (at !== bandTipAt || !hovered?.id) return
    bandExpired = hovered
    $.ui.invalidate('ui.render')
  })
}
let windowMinutes = 30
// False for a `-p` run or the SDK, from session.start.
let isInteractive = true
// When the person last chose Proceed per file: quiet until another session edits it after that, so at most one window.
const snoozed = new Map<string, number>()
// The animations setting, fixed per activation: off, every entry draws still.
let still = false
const toasts = new ToastList('collisionguard')
let iconMode: IconMode = 'auto'
let look = lookFor(false)

const PANE = 'collision-guard'
let actions: Action[] = []
let previews: Previews | undefined
let fields: Record<string, Range> | undefined
let note = ''

const CHOICES = [text.choiceProceed, text.choiceWorktree, text.choiceCancel]

// `$` cannot cross an import, so the log gets plain functions instead.
const ioOf = ($: EngineInterface): Io => ({
  read: path => $.fs.read(path),
  write: (path, text) => $.fs.write(path, text),
  list: path => $.fs.list(path),
})

// Claude's config folder: CLAUDE_CONFIG_DIR when set, else ~/.claude. The literal name is for the host's static scan.
async function configDir($: EngineInterface) {
  const custom = ((await $.env.get('CLAUDE_CONFIG_DIR')) ?? '').trim()
  const dir = custom || `${(await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''}/.claude`
  return dir.replace(/\\/g, '/').replace(/\/+$/, '')
}

async function logDir($: EngineInterface) {
  return `${await configDir($)}/mods-data/mod-collision-guard/sessions`
}

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

const isPaneOpen = async ($: EngineInterface) => (await $.ui.panes()).some(pane => pane.id === PANE && pane.isPlaced)

// `/mod-collision-guard settings` toggles the panel; an unplaced pane is waiting, not open.
async function toggleSettings($: EngineInterface) {
  if (await isPaneOpen($)) {
    await $.ui.close({ id: PANE })
    await $.state.set({ plugin: 'mod-collision-guard', key: 'pane' }, false)
    return
  }
  note = ''
  const showcase = await $.fs.read(`${$.plugin.root}/showcase.json`).then(text => JSON.parse(String(text))).catch(() => null)
  previews = showcase?.previews
  fields = await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`).then(text => JSON.parse(String(text)).userConfig).catch(() => undefined)
  actions = (Array.isArray(showcase?.actions) ? showcase.actions : []).map((action: Action) => ({ ...action, isLocal: action.command === 'mod-collision-guard' }))
  const opened = await $.ui.open({ id: PANE, title: text.paneName, closeOnEscape: true })
  if (!opened.isPlaced) $.ui.toast(fill(text.settingsWaiting, { reason: opened.reason }))
  await $.state.set({ plugin: 'mod-collision-guard', key: 'pane' }, opened.isPlaced)
}

// What `/mod-collision-guard <args>` does; the panel's own actions call it directly, since $.command.run skips the calling plugin.
async function answer($: EngineInterface, args: string) {
  if (args.trim() === 'settings') {
    await toggleSettings($)
    return ''
  }
  if (args.trim() === 'clear') {
    await clearOwn(ioOf($), await logDir($), await $.session.id())
    return text.cleared
  }
  const line = fill(text.statusLine, { state: enabled ? text.statusOn : text.statusOff, minutes: windowMinutes })
  return enabled ? fill(text.statusWatching, { line }) : line
}

const worktreeReason = (path: string) =>
  `The user chose to move to a worktree because another open session is editing ${path}. Call EnterWorktree, then redo this edit there.`

// A worktree needs a git repo: a .git entry in the file's folder or one above it.
async function isInRepo($: EngineInterface, path: string) {
  const parts = path.replace(/\\/g, '/').split('/').slice(0, -1)
  for (; parts.length > 0; parts.pop()) {
    if (await $.fs.exists(`${parts.join('/') || '/'}/.git`).catch(() => false)) return true
  }
  return false
}

type Decision = 'proceed' | 'worktree' | 'cancel' | 'interrupted' | 'error'
type Outcome = { decision: Decision; reason?: string }
type Held = HoldView & { decision: Decision | null; reason?: string }

// One hold at a time: edit calls in a turn run in order, but a subagent's can overlap.
let held: Held | null = null

// A transcript larger than this is never read for the other session's title: the card names it by its short id instead.
const NAME_READ_MAX = 64_000_000

// The other session's /rename title, read from its transcript once the card is up; the short id shows until it lands.
async function loadName($: EngineInterface, mine: Held) {
  const projects = `${await configDir($)}/projects`
  const file = `${mine.session.replace(/[^A-Za-z0-9_-]/g, '_')}.jsonl`
  for (const dir of await $.fs.list(projects)) {
    if (dir.kind !== 'dir') continue
    const stat = await $.fs.stat(`${projects}/${dir.name}/${file}`).catch(() => null)
    if (!stat || stat.kind !== 'file') continue
    if (stat.size > NAME_READ_MAX) return
    const title = titleOf(String(await $.fs.read(`${projects}/${dir.name}/${file}`)))
    if (title && held === mine) {
      mine.name = title
      $.ui.invalidate('ui.render')
    }
    return
  }
}

// A hold's own time is 10 s, but time inside a `$` call is free, so the hold waits on a short child process.
const PAUSES = {
  windows: [['sleep', '0.25'], ['powershell', '-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Milliseconds 250'], ['ping', '-n', '1', '-w', '250', '192.0.2.1']],
  other: [['sleep', '0.25'], ['perl', '-e', 'select(undef,undef,undef,0.25)']],
}
let pauseAt = 0
let isWindows: boolean | undefined

async function pause($: EngineInterface) {
  // A failed read is not kept: an environment that is failing is the very case the unchecked card holds.
  if (isWindows === undefined) {
    const os = await $.env.get('OS').then(value => value ?? '', () => null)
    if (os !== null) isWindows = os === 'Windows_NT'
  }
  const choices = isWindows ? PAUSES.windows : PAUSES.other
  // The last waiter that worked goes first, yet every one is tried before giving up, so one slow run never sticks.
  for (let tried = 0; tried < choices.length; tried++) {
    const at = (pauseAt + tried) % choices.length
    try {
      const waited = await $.process.run(choices[at]!, { timeoutMs: 5000 })
      // Nothing answers ping's reserved address, so its exit 1 is the wait it was asked for.
      if (waited.exitCode === 0 || (choices[at]![0] === 'ping' && waited.exitCode === 1)) {
        pauseAt = at
        return
      }
    } catch {
      // that waiter is not installed or timed out; try the next one
    }
  }
  throw new Error('no way to wait')
}

// A surface that draws the band can hold the call on a card; VS Code chat, -p and SDK sessions cannot, and ask in their own dialog instead.
async function canDraw($: EngineInterface) {
  const surfaces = await $.session.surfaces().catch(() => ['terminal' as const])
  return surfaces.some(surface => surface === 'terminal' || surface === 'desktop')
}

// The dialog fallback for a session with no band: the same choices, and free text counts as the reason for cancelling.
async function askInstead($: EngineInterface, view: HoldView, now: number): Promise<Outcome> {
  try {
    const question = view.isUnchecked ? fill(text.questionUnchecked, { path: view.path }) : fill(text.question, { path: view.path, ago: agoText(now - view.at), clock: clockText(view.at) })
    const options = view.isUnchecked ? [text.choiceProceed, text.choiceCancel] : view.canWorktree ? CHOICES : CHOICES.filter(choice => choice !== text.choiceWorktree)
    const picked = await $.ui.ask(question, { options, header: text.askHeader })
    if (picked === text.choiceProceed) return { decision: 'proceed' }
    if (picked === text.choiceWorktree) return { decision: 'worktree' }
    if (picked !== text.choiceCancel) return { decision: 'cancel', reason: cleanReason(picked) }
  } catch {
    // Dismissed or nobody to ask: refuse, the safe answer.
  }
  return { decision: 'cancel' }
}

// A card action, from a click on its entry or its digit typed into the empty prompt.
function choose($: EngineInterface, id: string) {
  if (!held || held.decision !== null) return
  if (held.isAsking) {
    if (id === GUARD.send) sendReason($, held.draft)
    if (id === GUARD.back) {
      held.isAsking = false
      held.draft = ''
    }
  } else if (id === GUARD.proceed) held.decision = 'proceed'
  else if (id === GUARD.worktree && held.canWorktree && !held.isUnchecked) held.decision = 'worktree'
  // Cancel asks why first; Enter on the field, empty or not, ends the hold.
  else if (id === GUARD.cancel) held.isAsking = true
  $.ui.invalidate('ui.render')
}

function sendReason($: EngineInterface, value: string) {
  if (!held || held.decision !== null || !held.isAsking) return
  held.reason = cleanReason(value)
  held.decision = 'cancel'
  $.ui.invalidate('ui.render')
}

function typeReason($: EngineInterface, value: string) {
  if (!held?.isAsking) return
  held.draft = value
  $.ui.invalidate('ui.render')
}

// Holds the edit on the card until the person answers, or the turn is interrupted. No timeout decides for them.
async function hold($: EngineInterface, next: { signal: AbortSignal }, view: HoldView): Promise<Outcome> {
  if (!(await canDraw($))) return askInstead($, view, await $.clock.now())
  // `held` is claimed with no await between the check and the claim, so two waiting calls cannot both pass.
  while (held !== null) {
    if (next.signal.aborted) return { decision: 'interrupted' }
    try {
      await pause($)
    } catch {
      return { decision: 'error' }
    }
  }
  // The session folder is what the file link is shown relative to; an unreadable one leaves the absolute path.
  const root = await $.session.cwd().catch(() => undefined)
  const mine: Held = { ...view, root, decision: null }
  held = mine
  pauseAt = 0
  try {
    if (!view.isUnchecked) void Promise.resolve().then(() => loadName($, mine)).catch(() => undefined)
    $.ui.invalidate('ui.render')
    while (mine.decision === null) {
      if (next.signal.aborted) mine.decision = 'interrupted'
      else await pause($)
    }
  } catch {
    mine.decision = 'error'
  } finally {
    if (held === mine) held = null
    hovered = null
    $.ui.invalidate('ui.render')
  }
  return { decision: mine.decision as Decision, reason: mine.reason }
}

const cancelDeny = (path: string, reason?: string) =>
  `The user cancelled this edit of ${path} because another open session is editing it${reason ? `, and said why: "${reason}"` : ''}. Do not retry it; ask what to do instead.`

const stopDeny = (decision: Decision) =>
  decision === 'interrupted'
    ? 'The turn was interrupted while this edit waited for the person, so it did not run.'
    : 'Collision guard hit an error while holding this edit and did not run it. Do not retry it unless the person asks you to.'

// The card, its answer and what each means for the call: undefined lets it run.
async function decide($: EngineInterface, next: { signal: AbortSignal }, path: string, clash: Clash, now: number) {
  // A `-p` run has nobody to ask, and refusing would fail every collision in it.
  if (!isInteractive) return undefined
  const key = normalize(path)
  const quiet = snoozed.get(key)
  if (quiet !== undefined && clash.at <= quiet) return undefined
  // Fire and forget: a refused notification must never touch the pause.
  void Promise.resolve().then(() => $.ui.notify(fill(text.notifyPaused, { file: path.split(/[\\/]/).pop() ?? '' }), { title: text.notifyTitle })).catch(() => undefined)
  const outcome = await hold($, next, { path, session: clash.session, prompt: clash.prompt, at: clash.at, more: clash.more, isUnchecked: false, canWorktree: await isInRepo($, path), isAsking: false, draft: '' })
  if (outcome.decision === 'proceed') {
    snoozed.set(key, now)
    return undefined
  }
  if (outcome.decision === 'worktree') return { deny: worktreeReason(path) }
  if (outcome.decision === 'cancel') return { deny: cancelDeny(path, outcome.reason) }
  return { deny: stopDeny(outcome.decision) }
}

// The check itself failed: the edit is not let through unasked, and with nobody to ask it is refused.
async function askUnchecked($: EngineInterface, next: { signal: AbortSignal }, path: string) {
  const outcome = await hold($, next, { path, session: '', at: 0, more: 0, isUnchecked: true, canWorktree: false, isAsking: false, draft: '' }).catch((): Outcome => ({ decision: 'error' }))
  if (outcome.decision === 'proceed') return undefined
  if (outcome.decision === 'interrupted' || outcome.decision === 'error') return { deny: stopDeny(outcome.decision) }
  const why = outcome.reason ? `, and the person said why: "${outcome.reason}"` : ''
  return { deny: `Collision guard could not check ${path} against other open sessions and did not run this edit${why}. Do not retry it; ask what to do instead.` }
}

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
  // Cards in the band; Claude Code's own toast box is narrow and cuts long text.
  on('ui.toast', async ($, e) => {
    const id = toasts.add(e.text)
    $.ui.invalidate('ui.render')
    $.clock.after(e.timeoutMs ?? TOAST_MS, () => {
      toasts.drop(id)
      $.ui.invalidate('ui.render')
    })
    return { value: undefined }
  })

  on('ui.message', async ($, e, next) => {
    if (isTipMessage(e.data)) {
      hovered = e.data
      if (hovered.id) expireBandTip($)
      $.ui.invalidate('ui.render')
      return next(e)
    }
    const clicked = e.data as EntryMessage
    const dismissed = clicked?.type === 'menu-entry' ? toasts.idOf(clicked.id) : undefined
    if (dismissed !== undefined) {
      toasts.drop(dismissed)
      $.ui.invalidate('ui.render')
      return next(e)
    }
    const change = settingChoice(e.data)
    if (change) await saveSetting($, change.key, change.value)
    // The card's choices are entry Clients; a click posts the entry's id.
    if (clicked?.type === 'menu-entry') choose($, clicked.id)

    return next(e)
  })

  enabled = options.enabled !== false
  snoozed.clear()
  isInteractive = true
  const minutes = Number(options.window_minutes)
  windowMinutes = minutes > 0 ? minutes : 30
  iconMode = (options.icons as IconMode | undefined) ?? 'auto'
  // A forced mode needs no detection; auto loads the saved answer, then checks the terminal font beside the hooks.
  look = lookFor(iconMode === 'nerd')

  on('session.start', async ($, e, next) => {
    isInteractive = e.isInteractive !== false
    await loadLook($)
    await $.command.register({
      name: 'mod-collision-guard',
      description: text.commandDescription,
      argumentHint: '[settings|clear]',
    })
    await $.state.set({ plugin: 'mod-collision-guard', key: 'pane' }, await isPaneOpen($))
    $.ui.invalidate('ui.render')

    return next(e)
  })

  // A closed session no longer collides with anything, so its entries go with it.
  on('session.end', async ($, e, next) => {
    await clearOwn(ioOf($), await logDir($), e.sessionId).catch(() => undefined)

    return next(e)
  })

  // The host accepts a list of tools here, yet its types name a single one.
  on('tool.call', { tool: EDIT_TOOLS as unknown as 'Edit' }, async ($, e, next) => {
    const windowMs = windowMinutes * 60000
    let path = ''
    // The host lets a call through when its hook throws, so a failure before the verdict asks instead.
    try {
      path = pathOf(e as unknown as Record<string, unknown>)
      if (!path) return next(e)

      // A log that cannot be read must never block an edit.
      const clash = enabled ? await findConflict(ioOf($), await logDir($), await $.session.id(), path, await $.clock.now(), windowMs).catch(() => undefined) : undefined
      if (clash) {
        const verdict = await decide($, next, path, clash, await $.clock.now())
        if (verdict) return verdict
      }
    } catch {
      const verdict = await askUnchecked($, next, path || 'this file')
      if (verdict) return verdict
    }

    const result = (await next(e)) as { deny?: string; isError?: boolean }
    try {
      if (path && !result.deny && !result.isError) await recordEdit(ioOf($), await logDir($), await $.session.id(), path, await $.clock.now(), windowMs, await $.session.turns().catch(() => undefined))
    } catch {
      // The edit already ran; a log that cannot be written only costs the next check.
    }

    return result as never
  })

  on('command.run', { command: 'mod-collision-guard' }, async ($, e) => ({ text: await answer($, e.args) }))

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) await $.state.set({ plugin: 'mod-collision-guard', key: 'pane' }, false)

    return next(e)
  })

  // One panel at a time: another mod's pane opening closes this one, deferred past that plugin's dispatch.
  on('state.set', async ($, e, next) => {
    if (e.key === 'pane' && e.plugin !== 'mod-collision-guard' && e.value === true) {
      $.clock.after(0, async () => {
        if (!(await isPaneOpen($))) return
        await $.ui.close({ id: PANE })
        await $.state.set({ plugin: 'mod-collision-guard', key: 'pane' }, false)
      })
    }

    return next(e)
  })

  // The hold card and the toasts draw here; the pill row below is other mods', joined through splitRow so load order cannot start a second row.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    await loadLook($)
    // The card draws wherever the band does, desktop included, since canDraw lets a hold start there.
    if (held && held.decision === null) {
      // @ts-expect-error The host's types omit Client from an AbovePrompt's elements, yet it draws it.
      const { Box, Button, Client, Input, Link, Text } = $.ui.resolve(e)
      const { group, row, tip: menuTip } = splitRow(await next(e))
      const cards = toastCards({ Box, Client, Text }, toasts, look, text.tipToast)
      const tip = hovered?.id && hovered !== bandExpired ? tipLine({ Box, Text }, tipText(hovered)) : menuTip
      const view = { now: await $.clock.now(), columns: e.props.bodyColumns, maxRows: e.props.maxRows, still }
      // While a call is held only the card and the pill row draw, so other rows cannot fill the band and cut the card off.
      return pillRow({ Box, Client, Text }, look.nerd, group, row, [...cards, holdCard({ Box, Button, Client, Input, Link, Text }, look, held, view, { key: id => choose($, id), input: value => typeReason($, value), submit: value => sendReason($, value) })], tip, e.props.bodyColumns)
    }
    if (e.surface !== 'terminal' || e.props.hasSurvey) return next(e)
    const { Box, Client, Text } = $.ui.resolve(e)
    const cards = toastCards({ Box, Client, Text }, toasts, look, text.tipToast)
    if (cards.length === 0) return next(e)
    const { group, row, rest, tip: menuTip } = splitRow(await next(e))
    const tip = hovered?.id && hovered !== bandExpired ? tipLine({ Box, Text }, tipText(hovered)) : menuTip
    if (group.length || row.length || tip) return pillRow({ Box, Client, Text }, look.nerd, group, row, [...cards, ...rest], tip, e.props.bodyColumns)
    return <Box key="collisionguard" flexDirection="column">{cards}{rest as RenderChildren}</Box>
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    await loadLook($)
    if (e.requestId !== PANE) return next(e)

    // @ts-expect-error The host's types omit Client from a Pane's elements, yet a Pane draws it.
    const { Box, Button, Client, Text } = $.ui.resolve(e)
    const rows = (await $.config.list()).filter(row => row.key.startsWith('mod-collision-guard.'))
    // A saved change reloads this mod, which redraws the panel with the new value.
    const run = async (action: Action) => {
      note = await answer($, action.args ?? '')
        .then(text => `${MARK.ok} ${text || action.label}`)
        .catch(error => `${MARK.warn} ${String(error)}`)
      $.ui.invalidate('ui.render')
    }

    return (
      <Box flexDirection="column" backgroundColor={THEME.bg} paddingX={1} minHeight={e.props.scroll.bodyRows}>
        {tabRow({ Box, Client, Text }, look.nerd, [{ id: 'mod-collision-guard-settings-tab', label: `${text.paneTitle} ${MARK.sep} ${text.paneTitleSettings}`, icon: look.glyph.gear, isOpen: true, tip: { glyph: look.glyph.gear, label: text.paneTitleSettings, text: text.tipTabSettings } }], still)}
        {sepText({ Text }, withMark(look, note) || `${text.defaultNote} ${MARK.sep} ${text.defaultNoteTail}`, statusColor(note), 'settings-note', { wrap: 'truncate-end' })}
        {settingsBody({ Box, Button, Client, Text }, look, { rows, actions, working: false, run, previews, fields, still })}
        <Box key="footer-space" height={FOOTER_ROWS} flexShrink={0} />
        {paneFooter({ Box, Text }, hoveredTip(), e.props.bodyColumns, e.props.scroll)}
      </Box>
    )
  })
}

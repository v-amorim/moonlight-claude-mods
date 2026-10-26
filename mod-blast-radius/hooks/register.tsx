// mod-blast-radius / hooks/register.tsx, by v-amorim
// Wires the mod into the engine: holds risky Bash commands, draws the card, pane and settings.
import type { ConfigValue, EngineInterface, Register, RenderElement } from 'claude-code'

import { cardFill, cardGap, detectNerd, FOOTER_ROWS, lookFor, paneFooter, section, titleEdge, type IconMode, type Look } from './look'
import { entryCells, isTipMessage, tipText, type EntryMessage, type EntryProps, type Tip, type TipMessage } from './entry'
import { labelsOf, pill, pillRow, splitRow, tabRow, tipLine } from './pills'
import { TOAST_MS, ToastList, toastCards } from './toasts'
import { ACTION_EXTRA, ACTION_GAP, actionLabels, canOpenDoes, cardRows, HOTKEY, plainFor, segmentsOf, stepsView, whyOf, type Plain } from './explain'
import { describePrompt, parseDescribed, SYSTEM, verdictOf, type Described } from './haiku'
import { colorLines, colorStep, LEGEND, wrapSpans, type Role, type Span } from './syntax'
import { measure, tilde, type Io, type Report } from './preview'
import { CHECKS, compileRules, errorRisk, evaluate, type Risk, type Session, type UserRule } from './risk'
import { countdownOf, countdownParts } from './countdown'
import { outsideTargets, planRecycle, sessionRoot } from './recycle'
import { approvalKey, approveOutside, birthArgv, compileKeep, parseBirths, type Keep, type OutsideFs } from './outside'
import { native } from './paths'
import { actionReveals, settingChoice, settingsBody, type Action, type Previews } from './settings'
import { recordSpend } from './spend'
import style from './style'
import text from './text'
import { decodeAll, fill, MARK, mix, statusColor, SYNTAX, THEME, WASH } from './theme'
import { familyOf, isRefusal, settle, summarize, tally, upsert, verdictOfCheck, type Check, type Counts, type Verdict } from './checks'
import marks from './marks'

const SETTINGS_PANE = 'blast-radius-settings'
const LIST_PANE = 'blast-radius-list'
const DETAILS_TAB = 'mod-blast-radius-details-tab'
const SETTINGS_TAB = 'mod-blast-radius-settings-tab'
const RULES_FILE = '.claude/mods-data/mod-blast-radius/rules.json'
const KEEP_FILE = 'mods-data/mod-blast-radius/keep.json'
const BUILT_IN = [...new Set(CHECKS.map(check => check.reason))]

type Unit = { one: string; many: string }
const plural = (count: number, unit: Unit) => fill(count === 1 ? unit.one : unit.many, { n: count })

type Decision = 'run' | 'cancel' | 'interrupted' | 'error' | 'idle'
// isDescribing: Haiku is still writing the card's words.
// isFull: the Details pane shows the whole command, not its first rows; isDoesOpen: the card shows its whole sentence, not two rows.
type Held = { command: string; risk: Risk; report: Report | null; plain: Plain | null; decision: Decision | null; described?: Described; isDescribing?: boolean; isFull?: boolean; isDoesOpen?: boolean; isAsking?: boolean; isStored?: boolean; touchedAt?: number; leftMs?: number; draft?: string; reason?: string }

// Commands whose card timed out, by exact text: the chip lists them and a stored answer waits for the next identical call.
type Waiting = { held: Held; answer: { decision: 'run' | 'cancel'; reason?: string } | null }
const waiting = new Map<string, Waiting>()
const WAIT_CHIP = 'blast-wait'

const MORE = 'blast-more'
const DOES_MORE = 'blast-does-more'
const REASON_FIELD = 'blast-reason'
const REASON_SEND = 'blast-reason-send'
const REASON_BACK = 'blast-reason-back'
// Claude reads the reason in one line, so a long one is cut here.
const REASON_MAX = 300
// The Details pane's full command: this many rows closed, and at most this many opened.
const FULL_ROWS = 12
const FULL_ROWS_OPEN = 400

// The person's settings (userConfig), fixed per activation: a change reloads the mod.
let isEnabled = true
// Opt-in, off by default: no held command is sent to Haiku: the card keeps the rule's words and the preview.
let isExplaining = false
// Opt-in: ms a card waits with no answer before its call is refused; 0 never.
let idleMs = 0
// On check error: Hold (the default) holds a command whose check failed; Run lets it through.
let isFailClosed = true
// Opt-in: a plain rm inside the session folder goes to the OS bin, with no card.
let isBinning = false
// Opt-in: a risky command measured harmless still shows the card.
let isAlwaysCard = false
let iconMode: IconMode = 'auto'
let look: Look = lookFor(false)

// One hold at a time: Bash calls in a turn run in order, but a subagent's can overlap.
let held: Held | null = null
let note = ''
let working = false
// The control under the pointer, from its tip post: the card's tip row and the Details footer show it.
let hovered: TipMessage | null = null

const hoveredTip = (): Tip | null => (hovered?.id && hovered.label ? { glyph: hovered.glyph ?? '', label: hovered.label, text: hovered.text ?? '' } : null)

// A band redraw can replace a hovered entry, whose leave and quiet timer then never come, so a band tip ends on its own.
const BAND_TIP_MS = 5000
let bandTipAt = 0
// The tip the band stopped showing; the Details footer keeps its own.
let bandExpired: TipMessage | null = null

function expireBandTip($: EngineInterface) {
  const at = ++bandTipAt
  $.clock.after(BAND_TIP_MS, () => {
    if (at !== bandTipAt || !hovered?.id) return
    bandExpired = hovered
    $.ui.invalidate('ui.render')
  })
}
let actions: Action[] = []
let previews: Previews | undefined

// A repo's own config can run code (fsmonitor, hooks), and the preview runs before the person answers; git reads /dev/null as NUL on Windows.
const GIT_SAFETY = ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null']

const ioOf = ($: EngineInterface): Io => ({
  cwd: () => $.session.cwd(),
  home: async () => (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '',
  run: (argv, cwd) => $.process.run(argv[0] === 'git' ? ['git', ...GIT_SAFETY, ...argv.slice(1)] : argv, { cwd, timeoutMs: 15000 }),
  list: path => $.fs.list(path),
  stat: path => $.fs.stat(path),
  env: name => folderVar($, name),
})

// The validator wants literal names, and only folder variables are ever read: see FOLDER_VARS in preview.ts.
async function folderVar($: EngineInterface, name: string) {
  switch (name.toUpperCase()) {
    case 'TEMP': return $.env.get('TEMP')
    case 'TMP': return $.env.get('TMP')
    case 'TMPDIR': return $.env.get('TMPDIR')
    case 'HOME': return (await $.env.get('HOME')) ?? $.env.get('USERPROFILE')
    case 'USERPROFILE': return $.env.get('USERPROFILE')
    case 'APPDATA': return $.env.get('APPDATA')
    case 'LOCALAPPDATA': return $.env.get('LOCALAPPDATA')
    default: return undefined
  }
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

// error: the file as a whole could not be used, so the person's rules are missing from every verdict.
type Rules = { path: string; mtimeMs: number; rules: UserRule[]; notes: string[]; error?: string }
let rulesCache: Rules | null = null

// Claude's config folder: CLAUDE_CONFIG_DIR when set, else ~/.claude. The literal name is for the host's static scan.
async function configDir($: EngineInterface) {
  const custom = ((await $.env.get('CLAUDE_CONFIG_DIR')) ?? '').trim()
  const dir = custom || `${(await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''}/.claude`
  return dir.replace(/\\/g, '/').replace(/\/+$/, '')
}

// rules.json, re-read only when its mtime moves; a missing or broken file never disables the built-in checks.
async function loadRules($: EngineInterface): Promise<Rules> {
  const path = `${await configDir($)}/${RULES_FILE.replace('.claude/', '')}`
  try {
    const stat = await $.fs.stat(path).catch(() => null)
    if (!stat) return (rulesCache = { path, mtimeMs: -1, rules: [], notes: [] })
    if (rulesCache?.path === path && rulesCache.mtimeMs === stat.mtimeMs) return rulesCache
    const { rules, notes, isBroken } = compileRules(String(await $.fs.read(path)))
    return (rulesCache = { path, mtimeMs: stat.mtimeMs, rules, notes, ...(isBroken ? { error: notes[0]! } : {}) })
  } catch (error) {
    const note = fill(text.rulesNotes.unreadable, { why: String((error as Error)?.message ?? error).slice(0, 60) })
    return { path, mtimeMs: -1, rules: [], notes: [note], error: note }
  }
}

// keep.json, re-read only when its mtime moves. A missing file keeps nothing; a broken or unreadable one is null, which keeps everything outside the session folder.
let keepCache: { path: string; mtimeMs: number; keep: Keep } | null = null

async function loadKeep($: EngineInterface, home: string, isWindows: boolean): Promise<Keep | null> {
  try {
    const path = `${await configDir($)}/${KEEP_FILE}`
    const stat = await $.fs.stat(path).catch(() => null)
    if (!stat) return { entries: [] }
    if (keepCache?.path === path && keepCache.mtimeMs === stat.mtimeMs) return keepCache.keep
    const keep = compileKeep(String(await $.fs.read(path)), home, isWindows)
    keepCache = { path, mtimeMs: stat.mtimeMs, keep }
    return keep
  } catch {
    return null
  }
}

// When this mod first saw the session; a /clear or a resume is a new session id, so it starts a new time. Null when it cannot be known.
let seenSession: { id: string; at: number } | null = null

async function noteSession($: EngineInterface): Promise<number | null> {
  try {
    const id = String(await $.session.id())
    if (seenSession?.id === id) return seenSession.at
    const saved = (await $.store.get('session-start').catch(() => undefined)) as { id?: unknown; at?: unknown } | undefined
    const isSaved = saved?.id === id && typeof saved.at === 'number'
    const at = isSaved ? (saved.at as number) : await $.clock.now()
    seenSession = { id, at }
    if (!isSaved) await $.store.set('session-start', { id, at }).catch(() => undefined)
    return at
  } catch {
    return null
  }
}

// The delete targets outside the session folder that may go to the bin with no card (see outside.ts); a check that throws approves nothing.
async function approveTargets($: EngineInterface, targets: string[], session: Session, isWindows: boolean) {
  try {
    const root = sessionRoot(session, isWindows)
    if (root === null) return new Set<string>()
    const pending = (await $.state.get({ plugin: 'mod-wrap-up', key: 'pending' })).value
    const io: OutsideFs = {
      stat: async path => {
        const stat = await $.fs.stat(path)
        return { kind: stat.kind, isLink: stat.isLink }
      },
      exists: path => $.fs.stat(path).then(() => true, () => false),
      list: async path => (await $.fs.list(path)).map(entry => ({ name: entry.name, kind: entry.kind, isLink: entry.isLink })),
      births: async paths => {
        const ran = await $.process.run(birthArgv(paths, isWindows), { timeoutMs: 15000 })
        return ran.exitCode === 0 ? parseBirths(ran.stdout, paths.length) : paths.map(() => null)
      },
    }
    const standing = { startedAt: await noteSession($), keep: await loadKeep($, session.home, isWindows), pending: Array.isArray(pending) ? pending.filter(item => typeof item === 'string') : undefined, isWindows, home: native(session.home, isWindows), root }
    return await approveOutside(targets, standing, io)
  } catch {
    return new Set<string>()
  }
}

async function sessionOf($: EngineInterface): Promise<Session> {
  const cwd = String((await $.session.cwd().catch(() => '')) ?? '')
  return { cwd: cwd || null, home: (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '' }
}

// failed: why the check could not finish; isPartial: only rules.json was lost, so the built-in checks still ran.
type Judged = { risk: Risk | null; command: string; session?: Session; rules?: UserRule[]; failed?: string; isPartial?: true }

const failure = (why: unknown) => fill(text.reasons.checkFailed, { why: String((why as Error)?.message ?? why).slice(0, 80) })

async function judge($: EngineInterface, value: unknown): Promise<Judged> {
  const session = await sessionOf($)
  const { rules, error } = await loadRules($)
  return { ...evaluate(value, rules, session), session, rules, ...(error ? { failed: failure(error), isPartial: true as const } : {}) }
}

// A judge that throws is a failed check, never an exception.
async function judgeSafely($: EngineInterface, value: unknown): Promise<Judged> {
  try {
    return await judge($, value)
  } catch (error) {
    return { risk: null, command: typeof value === 'string' ? value : String(value ?? ''), failed: failure(error) }
  }
}

// The check could not tell: it threw, or the matcher itself failed. A lost rules.json alone is not this, since the built-in checks held.
const isCheckBroken = (judged: Judged) => (judged.failed !== undefined && !judged.isPartial) || judged.risk?.isError === true

// On check error: Hold keeps a failed check on the card, Run lets the command through.
function applyOnError(judged: Judged): Judged {
  if (isFailClosed) return judged.failed === undefined ? judged : { ...judged, risk: judged.risk ?? errorRisk(judged.failed) }
  return isCheckBroken(judged) ? { ...judged, risk: null } : judged
}

// Haiku rewrites the card's words once per command; the rule's own text shows until it answers, and stays when it fails.
const describedCache = new Map<string, Described>()

async function describe($: EngineInterface, mine: Held) {
  if (!isExplaining) return
  const { rules } = await loadRules($)
  const risky = segmentsOf(mine.command, rules).filter(step => step.risk)
  let found = describedCache.get(mine.command)
  if (!found) {
    mine.isDescribing = true
    let reply: Awaited<ReturnType<typeof $.model.complete>> | null = null
    try {
      $.ui.invalidate('ui.render')
      const prompt = describePrompt(mine.command, mine.risk.reason, mine.report?.summary ?? '', risky.map(step => step.text))
      reply = await $.model.complete({ model: 'haiku', system: SYSTEM, prompt, maxTokens: 500, timeoutMs: 15000 }).catch(() => null)
      recordSpend($, 'haiku', reply)
    } finally {
      mine.isDescribing = false
      $.ui.invalidate('ui.render')
    }
    found = reply?.isAnswered ? parseDescribed(reply.text, risky.length) ?? undefined : undefined
    // No answer still gets a verdict line: with nothing to go on, it points to Details.
    if (!found) {
      if (held === mine && mine.decision === null && mine.plain) mine.plain = { ...mine.plain, verdict: { isOk: false, why: text.verdict.noAnswer } }
      $.ui.invalidate('ui.render')
      return
    }
    describedCache.set(mine.command, found)
  }
  const cwd = String((await $.session.cwd().catch(() => '')) ?? '')
  if (held !== mine || mine.decision !== null || !mine.plain) return
  mine.described = found
  mine.plain = { ...mine.plain, verb: found.verb, subject: undefined, does: found.does, undo: found.undo, targets: found.targets, verdict: verdictOf(found, mine.report, cwd) }
  $.ui.invalidate('ui.render')
}

// VS Code chat, -p and SDK sessions list no surface that draws a pane or a band.
async function canDraw($: EngineInterface) {
  const surfaces = await $.session.surfaces().catch(() => ['terminal' as const])
  return surfaces.some(surface => surface === 'terminal' || surface === 'desktop')
}

const isPaneOpen = async ($: EngineInterface, id: string) => (await $.ui.panes()).some(pane => pane.id === id && pane.isPlaced)

// One of this mod's panels at a time; `pane` tells other mods that a panel of this one is open.
async function closePanes($: EngineInterface, except = '') {
  for (const id of [SETTINGS_PANE, LIST_PANE]) {
    if (id !== except && (await isPaneOpen($, id))) await $.ui.close({ id })
  }
}

// The Details entry on the card: a read-only pane with everything about the held command.
async function toggleList($: EngineInterface) {
  if (await isPaneOpen($, LIST_PANE)) {
    await $.ui.close({ id: LIST_PANE })
    await $.state.set({ plugin: 'mod-blast-radius', key: 'pane' }, false)
    return
  }
  if (!held?.report) {
    toast($, text.ui.nothingHeld)
    return
  }
  await closePanes($, LIST_PANE)
  const opened = await $.ui.open({ id: LIST_PANE, title: text.card.details, closeOnEscape: true })
  if (!opened.isPlaced) toast($, fill(text.ui.listWaiting, { reason: opened.reason }))
  await $.state.set({ plugin: 'mod-blast-radius', key: 'pane' }, opened.isPlaced)
}

// A hook's own time is 10 s, but time inside a `$` call is free, so the hold waits on a short child process.
const PAUSES = {
  windows: [['sleep', '0.25'], ['powershell', '-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Milliseconds 250'], ['ping', '-n', '1', '-w', '250', '192.0.2.1']],
  other: [['sleep', '0.25'], ['perl', '-e', 'select(undef,undef,undef,0.25)']],
}
let pauseAt = 0
let isWindows: boolean | undefined

async function isWindowsHost($: EngineInterface) {
  isWindows ??= (await $.env.get('OS')) === 'Windows_NT'
  return isWindows
}

// The helper that sends paths to this machine's bin, or null where there is none; settled once per activation.
let binScript: Promise<string | null> | null = null

function prepareBin($: EngineInterface) {
  binScript ??= (async () => {
    try {
      const run = async (argv: string[]) => (await $.process.run(argv, { timeoutMs: 15000 })).exitCode === 0
      const hasBin = (await isWindowsHost($))
        ? await run(['powershell', '-NoProfile', '-NonInteractive', '-Command', 'Add-Type -AssemblyName Microsoft.VisualBasic'])
        : await run(['sh', '-c', (await $.process.run(['uname', '-s'], { timeoutMs: 5000 })).stdout.trim() === 'Darwin' ? 'command -v trash || command -v osascript' : 'command -v gio'])
      return hasBin ? `${$.plugin.root.replace(/\\/g, '/').replace(/\/+$/, '')}/bin/recycle.sh` : null
    } catch {
      return null
    }
  })()
  return binScript
}

async function pause($: EngineInterface) {
  const choices = (await isWindowsHost($)) ? PAUSES.windows : PAUSES.other
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

// Both panes' title line: Details and Settings as tabs, the shown one open.
const tabs = (isSettings: boolean) => [
  { id: DETAILS_TAB, label: text.card.details, icon: look.glyph.mark.shell ?? '', isOpen: !isSettings, tip: { glyph: look.glyph.mark.shell ?? '', label: text.card.details, text: text.tipTabDetails } },
  { id: SETTINGS_TAB, label: text.ui.settings, icon: look.glyph.gear, isOpen: isSettings, tip: { glyph: look.glyph.gear, label: text.ui.settings, text: text.tipTabSettings } },
]

const isSettingsOpen = async ($: EngineInterface) => (await $.ui.panes()).some(pane => pane.id === SETTINGS_PANE && pane.isPlaced)

// `/mod-blast-radius settings` toggles the panel; an unplaced pane is waiting, not open.
async function toggleSettings($: EngineInterface) {
  if (await isSettingsOpen($)) {
    await $.ui.close({ id: SETTINGS_PANE })
    await $.state.set({ plugin: 'mod-blast-radius', key: 'pane' }, false)
    return
  }
  await closePanes($, SETTINGS_PANE)
  note = ''
  const showcase = await $.fs.read(`${$.plugin.root}/showcase.json`).then(file => JSON.parse(String(file))).catch(() => null)
  previews = showcase?.previews
  actions = (Array.isArray(showcase?.actions) ? showcase.actions : []).map((action: Action) => ({ ...action, isLocal: action.command === 'mod-blast-radius' }))
  const opened = await $.ui.open({ id: SETTINGS_PANE, title: text.ui.paneName, closeOnEscape: true })
  if (!opened.isPlaced) toast($, fill(text.ui.settingsWaiting, { reason: opened.reason }))
  await $.state.set({ plugin: 'mod-blast-radius', key: 'pane' }, opened.isPlaced)
}

// What `/mod-blast-radius <args>` does; the panel's own actions call it directly, since $.command.run skips the calling plugin.
async function answer($: EngineInterface, args: string) {
  if (args.trim() === 'settings') {
    await toggleSettings($)
    return ''
  }
  const { rules, notes } = await loadRules($)
  const mine = rules.length ? fill(text.ui.mine, { n: rules.length }) : ''
  const bad = notes.length ? fill(text.ui.bad, { n: notes.length }) : ''
  return isEnabled ? fill(text.ui.isOn, { builtIn: BUILT_IN.length, mine, bad }) : text.ui.isOff
}

// A control glyph without the brackets and padding it has as a standalone button, for the tip row.
const bare = (glyph: string) => glyph.replace(/[[\]\s]/g, '')

const oneLine = (command: string) => {
  const line = command.replace(/\s+/g, " ").trim()
  return line.length > 80 ? `${line.slice(0, 77)}...` : line
}

const refusal = (decision: Decision | null) => (text.refusal as Record<string, string | undefined>)[decision ?? 'error'] ?? text.refusal.none

// What the person typed as one quoted line: flat, no control characters, cut, and its quotes escaped.
const cleanReason = (raw: string) => {
  const flat = raw.replace(/\s+/g, ' ').replace(/\p{Cc}/gu, '').trim()
  const cut = [...flat].length > REASON_MAX ? `${[...flat].slice(0, REASON_MAX).join('').trimEnd()}...` : flat
  return cut.replace(/"/g, '\\"')
}

type Elements = { Box: (props: any) => RenderElement; Client: (props: any) => RenderElement; Text: (props: any) => RenderElement }

// The session's permission checks, newest last; the module copy is the one every hook reads and writes, and $.state keeps it across a reload.
let checks: Check[] = []
let isChecksLoaded = false

async function loadChecks($: EngineInterface) {
  if (isChecksLoaded) return
  isChecksLoaded = true
  try {
    const kept = await $.state.get({ plugin: 'mod-blast-radius', key: 'checks' })
    if (Array.isArray(kept) && checks.length === 0) checks = kept as Check[]
  } catch {
    // Nothing kept yet: the list starts empty.
  }
}

function keepChecks($: EngineInterface, next: Check[]) {
  checks = next
  void Promise.resolve($.state.set({ plugin: 'mod-blast-radius', key: 'checks' }, JSON.parse(JSON.stringify(checks)))).catch(() => undefined)
  if (held) $.ui.invalidate('ui.render')
}

type Seen = { tool: string; input?: unknown; tool_use_id?: string; agentId?: string }

// Watching must never touch a verdict or a call: a failure here is dropped.
async function noteCheck($: EngineInterface, seen: Seen, verdict: Verdict) {
  if (!seen.tool_use_id) return
  try {
    await loadChecks($)
    keepChecks($, upsert(checks, { id: seen.tool_use_id, tool: seen.tool, family: familyOf(seen.tool), summary: summarize(seen.tool, seen.input), verdict, isAgent: Boolean(seen.agentId), at: Date.now() }))
  } catch {
    // The list stays as it was.
  }
}

// The ask a person or the classifier answered: it ran (asked) or it was refused (denied).
async function settleCheck($: EngineInterface, call: Seen, result: unknown) {
  if (!call.tool_use_id) return
  try {
    await loadChecks($)
    const refused = isRefusal(result)
    if (checks.some(check => check.id === call.tool_use_id)) keepChecks($, settle(checks, call.tool_use_id, refused ? 'denied' : 'asked'))
    else if (refused) await noteCheck($, call, 'denied')
  } catch {
    // The list stays as it was.
  }
}

const CHECK_HUE: Record<Verdict, string> = { allowed: THEME.ok, asked: THEME.accent, denied: THEME.alert, waiting: THEME.warn }
const cellHue = (check: Check) => (check.isAgent && check.verdict !== 'denied' ? THEME.lifted : CHECK_HUE[check.verdict])

// The hold card's count: nothing until a check has been seen.
function sessionCount(list: Check[]) {
  const counts = tally(list)
  return counts.total === 0 ? '' : fill(text.checks.count, { checks: plural(counts.total, text.checks.check), denied: counts.denied })
}

// The Details pane's last section: one cell per check in time order, a legend with counts, and the counts per family.
function checksSection({ Box, Text }: Pick<Elements, 'Box' | 'Text'>, list: Check[], columns: number) {
  const own = decodeAll(marks.glyphs)[look.nerd ? 'nerd' : 'safe']
  const counts: Counts = tally(list)
  const perRow = Math.max(8, columns - 6)
  const cells: unknown[] = []
  for (let from = 0; from < list.length; from += perRow) {
    cells.push(
      <Box key={`checks-row-${from}`} flexDirection="row">
        {list.slice(from, from + perRow).map((check, at) => <Text key={`checks-cell-${from + at}`} color={cellHue(check)}>{check.verdict === 'denied' ? own.cross : own.cell}</Text>)}
      </Box>,
    )
  }
  const parts: { glyph: string; hue: string; label: string }[] = [
    ...(counts.allowed ? [{ glyph: own.cell, hue: THEME.ok, label: `${counts.allowed} ${text.checks.allowed}` }] : []),
    ...(counts.asked ? [{ glyph: own.cell, hue: THEME.accent, label: `${counts.asked} ${text.checks.asked}` }] : []),
    { glyph: own.cross, hue: THEME.alert, label: `${counts.denied} ${text.checks.denied}` },
    ...(counts.waiting ? [{ glyph: own.cell, hue: THEME.warn, label: `${counts.waiting} ${text.checks.waiting}` }] : []),
    ...(counts.agent ? [{ glyph: own.cell, hue: THEME.lifted, label: text.checks.agent }] : []),
  ]
  const legend = parts.flatMap((part, at) => [
    <Text key={`checks-gap-${at}`}>{at === 0 ? '' : '  '}</Text>,
    <Text key={`checks-mark-${at}`} color={part.hue}>{part.glyph}</Text>,
    <Text key={`checks-label-${at}`} color={THEME.muted}>{` ${part.label}`}</Text>,
  ])
  return section(
    { Box, Text },
    look,
    'checks',
    'tool',
    text.checks.sectionTitle,
    [
      ...cells,
      <Box key="checks-legend"><Text wrap="wrap">{legend}</Text></Box>,
      <Box key="checks-families"><Text color={THEME.muted} wrap="wrap">{fill(text.checks.families, { file: counts.file, shell: counts.shell, other: counts.other, sep: MARK.sep })}</Text></Box>,
    ],
    THEME.accent,
    { hint: `${MARK.sep} ${plural(counts.total, text.checks.permissionCheck)}` },
  )
}

// Counts and sizes in a line get the warning color.
const FIGURE = /(\d[\d.,]*\s(?:[KMGT]?B|files?|folders?|commits?|paths?|entr(?:y|ies)|branch(?:es)?|statements?)\b)/
const NOT_LOST = [text.preview.searchesUnder, text.preview.reaches, text.preview.statements]

function figures(Text: Elements['Text'], text: string, key: string) {
  return text.split(FIGURE).map((part, index) => (index % 2 ? <Text key={`${key}-${index}`} color={THEME.warn}>{part}</Text> : part))
}

// Moonlight syntax roles for a shell command; the risky part reads as risk.
const roleProps = (role: Role) => {
  if (role === 'command') return { color: SYNTAX.command, bold: true }
  if (role === 'option') return { color: SYNTAX.option }
  if (role === 'text') return { color: SYNTAX.text }
  if (role === 'variable') return { color: SYNTAX.variable }
  if (role === 'number') return { color: SYNTAX.number }
  if (role === 'operator') return { color: SYNTAX.operator }
  if (role === 'risk') return { color: THEME.alert, bold: true }
  if (role === 'muted') return { color: THEME.muted }
  return { color: THEME.onSurface }
}

// One row of colored spans; a row of a single color is one plain Text.
function spansText(Text: Elements['Text'], spans: Span[], key: string) {
  if (spans.length === 1) return <Text key={key} wrap="wrap" {...roleProps(spans[0]!.role)}>{spans[0]!.text}</Text>
  return <Text key={key} wrap="wrap">{spans.map((span, index) => <Text key={`${key}-${index}`} {...roleProps(span.role)}>{span.text}</Text>)}</Text>
}

// The held command as a card above the pills: what happens in plain words, what it touches, then Cancel, Details and the consequence. Every row fits the band.
function holdCard({ Box, Button, Client, Input, Text }: Elements & { Button: (props: any) => RenderElement; Input: (props: any) => RenderElement }, state: Held, columns: number, maxRows: number, onKey: (id: string) => unknown, onInput: (value: string) => unknown, onSubmit: (value: string) => unknown, sessionNote = '') {
  const width = Math.max(20, columns - 4)
  // The card's rows are what is left after its border, its action row and the pill row below.
  const isAsking = state.isAsking === true
  // While the person types a reason, the field and its hint replace the action row, one row more.
  const bodyRows = Math.max(1, maxRows - 2 - 3 - (isAsking ? 1 : 0))
  const isOpen = state.isDoesOpen === true
  // The expand standard: arrow, then a muted label, bottom right on the action row; with no room beside the actions it takes a row of its own below them.
  const moreLabel = isOpen ? text.card.showLess : text.card.showAll
  const moreWidth = [...moreLabel].length + 4
  const reserve = moreWidth + ACTION_GAP
  const fitsBeside = (labels: ReturnType<typeof actionLabels>) => labels.cancel.length + labels.details.length + labels.run.length + 3 * ACTION_EXTRA + 2 * ACTION_GAP + reserve <= width
  // The run label says what the command does, so the control never shortens it: it sits beside the actions only where they keep their full labels.
  const beside = actionLabels(state.plain!, width)
  const isBeside = fitsBeside(beside)
  const ownRowBody = Math.max(1, bodyRows - 1)
  const hasControl = !isAsking && canOpenDoes(state.plain!, state.report!, width, isBeside ? bodyRows : ownRowBody)
  const rows = cardRows(state.plain!, state.report!, width, hasControl && !isBeside ? ownRowBody : bodyRows, isOpen)
  const labels = hasControl && isBeside ? beside : actionLabels(state.plain!, width)
  const actionsWidth = labels.cancel.length + labels.details.length + labels.run.length + 3 * ACTION_EXTRA + 2 * ACTION_GAP
  const isShimmering = state.isDescribing === true && !hasControl && actionsWidth + ACTION_GAP + text.card.explaining.length + 4 <= width
  // The session count comes last on the row and is the first thing dropped: the actions and the toggle keep their room.
  const countWidth = [...sessionNote].length
  const showCount = sessionNote !== '' && !isShimmering && actionsWidth + (hasControl && isBeside ? moreWidth + ACTION_GAP : 0) + ACTION_GAP + countWidth <= width
  const body = rows.map((row, index) => {
    const key = `hold-row-${index}`
    if (row.kind === 'head') return <Text key={key} color={THEME.alert} bold>{`${look.glyph.warn} ${row.text}`}</Text>
    if (row.kind === 'does') return <Text key={key} color={THEME.onSurface}>{row.text}</Text>
    if (row.kind === 'path') {
      return (
        <Text key={key}>
          <Text key={`${key}-path`} color={THEME.alert}>{row.text}</Text>
          <Text key={`${key}-gap`} color={THEME.onSurface}>{'   '}</Text>
          {figures(Text, row.stats ?? '', key)}
        </Text>
      )
    }
    if (row.kind === 'verdict' && row.isOk) {
      return (
        <Text key={key}>
          <Text key={`${key}-mark`} color={THEME.good}>{MARK.ok}</Text>
          <Text key={`${key}-text`} color={THEME.onSurface}>{` ${row.text}`}</Text>
        </Text>
      )
    }
    if (row.kind === 'verdict') {
      return (
        <Text key={key}>
          <Text key={`${key}-mark`} color={THEME.alert} bold>{MARK.warn}</Text>
          <Text key={`${key}-text`} color={THEME.muted}>{` ${row.text}`}</Text>
        </Text>
      )
    }
    if (row.kind === 'line') return <Text key={key} color={THEME.alert}>{figures(Text, row.text, key)}</Text>
    return <Text key={key} color={THEME.muted}>{row.text}</Text>
  })
  const fill = cardFill(THEME.alert)
  // The one card that holds a risky command keeps an alert-tinted edge, the user's pick over the standard's neutral border.
  const edge = mix(THEME.bg, THEME.alert, 0.33)
  const moreGlyph = isOpen ? look.glyph.less : look.glyph.more
  const moreControl = (
    <Client key={DOES_MORE} module="./entry.tsx" width={moreWidth} height={1} props={{ id: DOES_MORE, label: moreLabel, lead: moreGlyph, leadColor: THEME.accent, isOpen: false, bg: fill, idle: THEME.muted, still, nerd: look.nerd, tip: { glyph: moreGlyph, label: moreLabel, text: isOpen ? text.tips.showLess : text.tips.showAll } } satisfies EntryProps} />
  )
  // The entry draws the action; a Button nobody sees carries its digit, since only a Button takes a hotkey and a visible one inverts under the pointer.
  const entry = (id: string, label: string, hotkey: string, tipLabel: string, tipBody: string, tipGlyph: string, color?: string) => (
    <Box key={`${id}-pad`} flexDirection="row">
      {pill({ Box, Text }, look.nerd, THEME.surface3, <Client key={id} module="./entry.tsx" height={1} props={{ id, label, isOpen: true, bg: THEME.surface3, subLead: hotkey, nerd: look.nerd, tip: { glyph: tipGlyph, label: tipLabel, text: tipBody }, ...(color ? { color } : {}), still }} />, `${id}-pill`, fill)}
      <Box key={`${id}-key`} width={0} height={0} overflow="hidden">
        <Button key={`${id}-hotkey`} label={label} hotkey={hotkey} plain onPress={() => onKey(id)} />
      </Box>
    </Box>
  )

  const hint = (id: string, key: string, label: string, tipBody: string) => {
    const props = { id, label, isOpen: false, bg: fill, subLead: key, subLeadColor: THEME.onSurface, idle: THEME.muted, still, nerd: look.nerd, tip: { glyph: key, label, text: tipBody } } satisfies EntryProps
    return <Client key={id} module="./entry.tsx" width={entryCells(props)} height={1} props={props} />
  }
  const isEmpty = (state.draft ?? '').trim() === ''
  const sendLabel = isEmpty ? text.reason.skip : text.reason.send
  const reasonRows = (
    <Box key="hold-reason" flexDirection="column">
      <Box key="hold-reason-field" backgroundColor={THEME.surface3} paddingX={1}>
        <Input key={REASON_FIELD} placeholder={text.reason.placeholder} value={state.draft ?? ''} submitLabel={sendLabel} autoFocus onInput={onInput} onSubmit={onSubmit} />
      </Box>
      <Box key="hold-reason-hint" flexDirection="row" columnGap={1}>
        {hint(REASON_SEND, text.reason.enter, sendLabel, isEmpty ? text.tips.reasonSkip : text.tips.reasonSend)}
        <Text key="hold-reason-sep" color={style.colors.pills.separator}>{MARK.sep}</Text>
        {hint(REASON_BACK, text.reason.esc, text.reason.back, text.tips.reasonBack)}
      </Box>
    </Box>
  )
  const card = isAsking ? (
    <Box key="blast-card-box" flexDirection="column" borderStyle="round" borderColor={edge} backgroundColor={fill} paddingX={1}>
      {body}
      {reasonRows}
    </Box>
  ) : (
    <Box key="blast-card-box" flexDirection="column" borderStyle="round" borderColor={edge} backgroundColor={fill} paddingX={1}>
      {body}
      <Box key="hold-actions" flexDirection="row" columnGap={ACTION_GAP}>
        {entry('blast-cancel', labels.cancel, HOTKEY.cancel, labels.cancel, text.tips.cancel, bare(look.glyph.close))}
        {entry('blast-details', labels.details, HOTKEY.details, labels.details, text.tips.details, bare(look.glyph.mark.shell ?? ''))}
        {entry('blast-run', labels.run, HOTKEY.run, labels.run, text.tips.run, bare(look.glyph.go), THEME.alert)}
        {(hasControl && isBeside) || showCount ? (
          <Box key="hold-more-row" flexGrow={1} flexDirection="row" justifyContent="flex-end" columnGap={ACTION_GAP}>
            {hasControl && isBeside ? moreControl : null}
            {showCount ? <Box key="hold-count-box" flexShrink={0}><Text key="hold-count" color={THEME.muted}>{sessionNote}</Text></Box> : null}
          </Box>
        ) : null}
        {/* While Haiku writes the plain words, a shimmer on the right says they are coming; only where the row has room. */}
        {isShimmering ? (
          <Box key="hold-explaining-row" flexGrow={1} justifyContent="flex-end">
            <Client key="hold-explaining" module="./entry.tsx" height={1} props={{ id: 'hold-explaining', label: text.card.explaining, isOpen: false, bg: fill, isBusy: true, spinner: true, still }} />
          </Box>
        ) : null}
      </Box>
      {hasControl && !isBeside ? (
        <Box key="hold-more-own-row" flexDirection="row" justifyContent="flex-end">
          {moreControl}
        </Box>
      ) : null}
    </Box>
  )
  // The idle countdown sits at the top edge's right end, across from the title; it never takes the title's room.
  const titleUsed = 1 + 2 + [...text.card.title].length + (text.card.titleHint ? 1 + [...text.card.titleHint].length : 0) + 1
  const parts = idleMs > 0 && state.leftMs !== undefined && !state.isStored ? countdownParts(state.leftMs, columns - 1 - titleUsed - 1 - 1, idleMs) : null
  const countdown = parts ? (
    <Box key="blast-card-edge-right" position="absolute" top={0} right={1} flexDirection="row" height={1} backgroundColor={THEME.bg}>
      <Text key="blast-idle-lead" color={THEME.muted}>{` ${parts.lead}`}</Text>
      <Text key="blast-idle-time" color={parts.color}>{parts.time}</Text>
      <Text key="blast-idle-tail" color={THEME.muted}>{`${parts.tail} `}</Text>
    </Box>
  ) : null
  return (
    <Box key="blast-card" flexDirection="column">
      {card}
      {titleEdge({ Box, Text }, look, 'blast-card', '', text.card.title, text.card.titleHint, 0, edge)}
      {countdown}
    </Box>
  )
}

// The chip at the right end of the pill row: an alert icon, the words in on-surface, on surface-3. `count` shows only the icon and the number.
function waitChip({ Box, Client, Text }: Pick<Elements, 'Box' | 'Client' | 'Text'>, mode: 'full' | 'count', count: number, command: string) {
  const label = fill(count === 1 ? text.waiting.approve.one : text.waiting.approve.many, { n: count })
  const tip = { glyph: bare(look.glyph.warn), label, text: fill(text.waiting.tip, { command: oneLine(command) }) }
  const props = { id: WAIT_CHIP, label: mode === 'full' ? label : String(count), isOpen: true, bg: THEME.surface3, color: THEME.onSurface, lead: look.glyph.warn, leadColor: THEME.alert, nerd: look.nerd, still, tip, ...(mode === 'full' ? { compact: false } : {}) } satisfies EntryProps
  return pill({ Box, Text }, look.nerd, THEME.surface3, <Client key={WAIT_CHIP} module="./entry.tsx" height={1} props={props} />, `${WAIT_CHIP}-pill`)
}

// True when the pill row cut the chip to its icon because the row did not fit.
const isChipCut = (node: unknown): boolean => {
  if (Array.isArray(node)) return node.some(isChipCut)
  if (!node || typeof node !== 'object') return false
  const found = node as { type?: string; props?: { props?: { id?: string; compact?: boolean } }; children?: unknown[] }
  if (found.type === 'Client' && found.props?.props?.id === WAIT_CHIP) return found.props.props.compact === true
  return (found.children ?? []).some(isChipCut)
}

// Using the card restarts the idle time, and its countdown with it.
function touch(card: Held, now: number) {
  card.touchedAt = now
  if (idleMs > 0) card.leftMs = idleMs
}

// A card action, from a click on its entry or its digit typed into the empty prompt.
async function choose($: EngineInterface, id: string) {
  const now = await $.clock.now()
  if (!held || held.decision !== null) return
  touch(held, now)
  if (held.isAsking) {
    if (id === REASON_SEND) await sendReason($, held.draft ?? '')
    if (id === REASON_BACK) {
      held.isAsking = false
      held.draft = undefined
    }
    $.ui.invalidate('ui.render')
    return
  }
  if (id === 'blast-run') held.decision = 'run'
  // Cancel asks why first; Enter on the field, empty or not, ends the hold.
  if (id === 'blast-cancel') held.isAsking = true
  if (id === 'blast-details') await toggleList($)
  await keepStored($)
  $.ui.invalidate('ui.render')
}

// A card reopened from the chip has no call waiting on it: its answer goes to the stored entry, and the card closes.
async function keepStored($: EngineInterface) {
  const card = held
  if (!card?.isStored || card.decision === null) return
  const entry = waiting.get(card.command)
  if (entry) entry.answer = { decision: card.decision === 'run' ? 'run' : 'cancel', ...(card.reason ? { reason: card.reason } : {}) }
  held = null
  hovered = null
  if (await isPaneOpen($, LIST_PANE).catch(() => false)) {
    await $.ui.close({ id: LIST_PANE }).catch(() => undefined)
    await $.state.set({ plugin: 'mod-blast-radius', key: 'pane' }, false).catch(() => undefined)
  }
}

async function sendReason($: EngineInterface, value: string) {
  const now = await $.clock.now()
  if (!held || held.decision !== null || !held.isAsking) return
  touch(held, now)
  held.reason = cleanReason(value)
  held.decision = 'cancel'
  await keepStored($)
  $.ui.invalidate('ui.render')
}

async function typeReason($: EngineInterface, value: string) {
  const now = await $.clock.now()
  if (!held?.isAsking) return
  touch(held, now)
  held.draft = value
  $.ui.invalidate('ui.render')
}

const toasts = new ToastList('blast')
// Texts this mod raised and has not yet drawn: the ui.toast handler draws these, and passes every other mod's toast on.
const ownToasts: string[] = []
function toast($: EngineInterface, message: string) {
  ownToasts.push(message)
  $.ui.toast(message)
}
// The animations setting, fixed per activation: off, every entry draws still.
let still = false

// A settings card's click: its row, saved through /config; a saved change reloads this mod.
async function saveSetting($: EngineInterface, key: string, value: ConfigValue) {
  const row = (await $.config.list()).find(each => each.key === key)
  if (!row) return
  const result = await $.config.set({ key: row.key, value })
  note = 'deny' in result && result.deny ? `${MARK.warn} ${result.deny}` : `${MARK.ok} ${fill(text.ui.settingSaved, { label: row.label })}`
  $.ui.invalidate('ui.render')
}

// The setting's choice as ms: "Off" or anything without a number is never.
const idleOf = (value: unknown) => {
  const minutes = Number(/^\d+/.exec(String(value ?? ''))?.[0])
  return minutes > 0 ? minutes * 60000 : 0
}

// Judged risky: everything from here to the verdict fails closed. Returns 'run' or a deny.
async function holdRisky($: EngineInterface, next:{ signal: AbortSignal }, risk: Risk, command: string): Promise<'run' | { deny: string }> {
  // Without a surface that draws, nothing could answer a hold: tool.check puts the call to the permission system instead.
  if (!(await canDraw($))) return 'run'

  // `held` is claimed with no await between the check and the claim, so two waiting calls cannot both pass.
  while (held !== null) {
    if (next.signal.aborted) return { deny: fill(text.deny.held, { why: refusal('interrupted') }) }
    try {
      await pause($)
    } catch {
      return { deny: fill(text.deny.held, { why: refusal('error') }) }
    }
  }
  const mine: Held = { command, risk, report: null, plain: null, decision: null }
  held = mine
  pauseAt = 0
  let isSilent = false
  try {
    mine.report = await measure(ioOf($), risk)
    mine.plain = plainFor(risk, mine.report)
    if (mine.report.isHarmless && !isAlwaysCard) {
      isSilent = true
      mine.decision = 'run'
    } else {
      // Other band mods can read this to step aside while the card is up.
      await $.state.set({ plugin: 'mod-blast-radius', key: 'holding' }, true)
      if (idleMs > 0) mine.leftMs = idleMs
      $.clock.after(0, () => describe($, mine).catch(() => undefined))
      // Fire and forget: a refused notification must never touch the hold.
      void Promise.resolve().then(() => $.ui.notify(fill(text.ui.notifyHeld, { command: oneLine(command) }), { title: text.ui.notifyTitle })).catch(() => undefined)
      $.ui.invalidate('ui.render')
      // The hold stays until the person answers or the turn is interrupted; with an idle timeout set, it also ends once nobody used the card for that long.
      const shownAt = await $.clock.now()
      while (mine.decision === null) {
        const left = idleMs - ((await $.clock.now()) - (mine.touchedAt ?? shownAt))
        if (next.signal.aborted) mine.decision = 'interrupted'
        else if (idleMs > 0 && left <= 0) mine.decision = 'idle'
        else {
          // Redraw only when the shown time or its tone changes; a scaled threshold can fall inside a minute.
          const [now, was] = [countdownOf(left, idleMs), countdownOf(mine.leftMs ?? left, idleMs)]
          if (idleMs > 0 && (now.time !== was.time || now.color !== was.color)) {
            mine.leftMs = left
            $.ui.invalidate('ui.render')
          }
          await pause($)
        }
      }
    }
  } catch {
    mine.decision = 'error'
  } finally {
    if (held === mine) held = null
    hovered = null
    await $.state.set({ plugin: 'mod-blast-radius', key: 'holding' }, false).catch(() => undefined)
    if (await isPaneOpen($, LIST_PANE).catch(() => false)) {
      await $.ui.close({ id: LIST_PANE }).catch(() => undefined)
      await $.state.set({ plugin: 'mod-blast-radius', key: 'pane' }, false).catch(() => undefined)
    }
    $.ui.invalidate('ui.render')
  }

  if (mine.decision === 'run') {
    if (!isSilent) toast($, text.ui.running)
    return 'run'
  }
  if (mine.decision === 'idle') {
    waiting.set(command, { held: mine, answer: null })
    return { deny: fill(text.deny.idle, { minutes: idleMs / 60000 }) }
  }
  const why = mine.decision === 'cancel' && mine.reason ? fill(text.refusal.cancelWhy, { said: mine.reason }) : refusal(mine.decision)
  return { deny: fill(text.deny.heldWhy, { why, reason: mine.risk.reason, summary: mine.report?.summary ?? mine.risk.label }) }
}

// Claude asks again for a command whose card timed out: the answer stored for that exact text applies, once. No answer means a fresh card.
async function useStored($: EngineInterface, next: { signal: AbortSignal }, command: string): Promise<'run' | { deny: string } | null> {
  while (held?.isStored && held.command === command) {
    if (next.signal.aborted) return { deny: fill(text.deny.held, { why: refusal('interrupted') }) }
    try {
      await pause($)
    } catch {
      return { deny: fill(text.deny.held, { why: refusal('error') }) }
    }
  }
  const entry = waiting.get(command)
  if (!entry) return null
  waiting.delete(command)
  $.ui.invalidate('ui.render')
  if (!entry.answer) return null
  if (entry.answer.decision === 'run') {
    toast($, text.ui.running)
    return 'run'
  }
  const why = entry.answer.reason ? fill(text.refusal.cancelWhy, { said: entry.answer.reason }) : refusal('cancel')
  return { deny: fill(text.deny.heldWhy, { why, reason: entry.held.risk.reason, summary: entry.held.report?.summary ?? entry.held.risk.label }) }
}

// Reopens the oldest waiting command's card; its Cancel, Details and Run work as on a live hold, and the answer is kept for Claude's next identical call.
async function reopenWaiting($: EngineInterface) {
  const now = await $.clock.now()
  if (held) {
    toast($, text.waiting.busy)
    return
  }
  const entry = [...waiting.values()].find(each => !each.answer) ?? [...waiting.values()][0]
  if (!entry) return
  const { isAsking, draft, reason, ...rest } = entry.held
  held = { ...rest, decision: null, isStored: true, isDescribing: false, touchedAt: now }
  $.ui.invalidate('ui.render')
}

// Checks that failed, by message: a burst of commands toasts each distinct failure once.
const warned = new Set<string>()
function warnOnce($: EngineInterface, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (warned.has(message)) return
  warned.add(message)
  void Promise.resolve().then(() => toast($, text.ui.checkFailed)).catch(() => undefined)
}

export const register: Register = (on, options) => {
  still = options.animations === false
  toasts.isStill = still
  // This mod's toasts draw as cards in the band; Claude Code's own box is narrow and cuts them.
  on('ui.toast', async ($, e, next) => {
    const own = ownToasts.indexOf(e.text)
    if (own >= 0) ownToasts.splice(own, 1)
    // Another mod's toast stays its own to draw, unless the hold card is covering the band where it would show.
    const isCardUp = held !== null && held.decision === null
    if (own < 0 && !isCardUp) return next(e)
    const id = toasts.add(e.text)
    $.ui.invalidate('ui.render')
    $.clock.after(e.timeoutMs ?? TOAST_MS, () => {
      toasts.drop(id)
      $.ui.invalidate('ui.render')
    })
    return { value: undefined }
  })

  checks = []
  isChecksLoaded = false
  isEnabled = options.enabled !== false
  isExplaining = options.explain === true
  idleMs = idleOf(options.idle)
  isFailClosed = options.onError !== 'Run'
  isBinning = options.recycle === true
  isAlwaysCard = options.alwaysCard === true
  binScript = null
  waiting.clear()
  iconMode = (options.icons as IconMode | undefined) ?? 'auto'
  // A forced mode needs no detection; auto loads the saved answer, then checks the terminal font beside the hooks.
  look = lookFor(iconMode === 'nerd')

  on('session.start', async ($, e, next) => {
    await loadLook($)
    await $.command.register({
      name: 'mod-blast-radius',
      description: text.ui.commandDescription,
      argumentHint: '[settings]',
    })
    await $.state.set({ plugin: 'mod-blast-radius', key: 'pane' }, await isSettingsOpen($))
    if (isBinning) await noteSession($)
    $.ui.invalidate('ui.render')

    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!isEnabled) return next(e)
    const seen = await judgeSafely($, e.command)
    // With On check error set to Run, a check that failed lets the command through and says so once.
    if (!isFailClosed && isCheckBroken(seen)) warnOnce($, seen.failed ?? seen.risk?.reason)
    const judged = applyOnError(seen)
    // A plain rm inside the session folder goes to the bin, with no card; the person's passed rules and holds are no reason to delete for good.
    if (isBinning && judged.failed === undefined) {
      const recycling = { session: judged.session!, isWindows: await isWindowsHost($), rules: judged.rules! }
      let plan = planRecycle(e.command, recycling)
      // Outside that folder only a target this session made, that nothing keeps and the ledger does not name, goes with no card.
      const outside = plan ? [] : outsideTargets(e.command, recycling)
      if (outside.length > 0) {
        const approved = await approveTargets($, outside, recycling.session, recycling.isWindows)
        plan = planRecycle(e.command, { ...recycling, outside: path => approved.has(approvalKey(path, recycling.isWindows)) })
      }
      const script = plan ? await prepareBin($) : null
      if (plan && script) return next({ ...e, command: plan(script) })
    }
    if (!judged.risk) return next(e)
    let outcome: 'run' | { deny: string }
    try {
      outcome = (await useStored($, next, judged.command)) ?? (await holdRisky($, next, judged.risk, judged.command))
    } catch {
      outcome = { deny: 'Blast radius hit an error while checking this command and did not run it. Do not retry it unless the person asks you to.' }
    }
    // next runs outside the try, so an error from the command itself passes through unchanged.
    if (outcome === 'run') return next(e)
    // A held command that was refused never reaches the permission check, so its denial is noted here.
    await noteCheck($, e, 'denied')
    return outcome
  })

  // Every tool call passes here once: a check that asked is settled by what became of the call. It changes nothing.
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    await settleCheck($, e, result)
    return result
  })

  // Watches every permission check of the session; the verdict it returns is the one beneath, except where no surface can answer a hold, so the permission system asks.
  on('tool.check', async ($, e, next) => {
    let verdict = await next(e)
    if (e.tool === 'Bash' && isEnabled && verdict.decision !== 'deny' && !(await canDraw($))) {
      const { risk } = applyOnError(await judgeSafely($, (e.input as { command?: unknown } | null)?.command))
      if (risk) verdict = { decision: 'ask', reason: fill(text.ui.askReason, { reason: risk.reason }) }
    }
    await noteCheck($, e, verdictOfCheck(verdict.decision))
    return verdict
  })

  // /clear ends the session and starts no new one, so the count starts again here.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') keepChecks($, [])
    waiting.clear()
    if (held?.isStored) held = null
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === SETTINGS_PANE || e.id === LIST_PANE) await $.state.set({ plugin: 'mod-blast-radius', key: 'pane' }, false)

    return next(e)
  })

  // One panel at a time: another mod's pane opening closes this mod's panels, deferred past that plugin's dispatch.
  on('state.set', async ($, e, next) => {
    if (e.key === 'pane' && e.plugin !== 'mod-blast-radius' && e.value === true) {
      $.clock.after(0, async () => {
        await closePanes($)
        await $.state.set({ plugin: 'mod-blast-radius', key: 'pane' }, false)
      })
    }

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (!(e as { agentId?: string }).agentId) {
      working = true
      // session.start does not fire again after /clear, so each turn start settles the new session's time before its tools run.
      if (isBinning) await noteSession($)
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

  on('command.run', { command: 'mod-blast-radius' }, async ($, e) => ({ text: await answer($, e.args) }))

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    await loadLook($)
    // @ts-expect-error The host's types omit Client from a Pane's elements, yet a Pane draws it.
    const { Box, Button, Client, Text } = $.ui.resolve(e)

    if (e.requestId === LIST_PANE) {
      if (!held?.report || !held.plain) return next(e)
      const { report, plain, risk, command } = held
      const { source } = whyOf(risk)
      const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
      const plainText = (key: string, value: string, color: string, extra: Record<string, unknown> = {}) => <Text key={key} color={color} wrap="wrap" {...extra}>{value}</Text>
      const { rules } = await loadRules($)
      const { shown, rest } = stepsView(segmentsOf(command, rules))
      // Haiku's step sentences line up with the risky steps only, so a shown step maps to its place among them.
      const riskyIndex = (index: number) => shown.slice(0, index).filter(step => step.risk).length
      const does = [
        ...shown.map((step, index) => (
          <Box key={`does-${index}`} flexDirection="column" marginTop={index === 0 ? 0 : 1}>
            {spansText(Text, colorStep(step.text, rules), `does-${index}-text`)}
            {plainText(`does-${index}-says`, (step.risk && held!.described?.steps[riskyIndex(index)]) || step.says, step.risk ? THEME.onSurface : THEME.muted)}
          </Box>
        )),
        rest ? plainText('does-rest', rest, THEME.muted) : null,
      ]
      const everyRow = wrapSpans(colorLines(command, rules), Math.max(20, e.props.bodyColumns - 6), Number.POSITIVE_INFINITY).rows
      const hidden = Math.max(0, everyRow.length - FULL_ROWS)
      const isFull = hidden > 0 && held?.isFull === true
      const fullShown = everyRow.slice(0, isFull ? FULL_ROWS_OPEN : FULL_ROWS)
      const moreLabel = isFull ? text.ui.showLess : fill(text.ui.moreLines, { n: hidden })
      const moreArrow = isFull ? look.glyph.less : look.glyph.more
      // The expand standard: arrow, then a muted label, pinned right on the last text row.
      const moreControl = (
        <Client key="blast-more" module="./entry.tsx" width={[...moreLabel].length + 4} height={1} props={{ id: MORE, label: moreLabel, lead: moreArrow, leadColor: THEME.accent, isOpen: false, bg: cardFill(), idle: THEME.muted, still, nerd: look.nerd, tip: { glyph: moreArrow, label: moreLabel, text: isFull ? text.ui.tipShowLess : text.ui.tipShowAll } } satisfies EntryProps} />
      )
      const fullRows = fullShown.map((row, index) => {
        const line = spansText(Text, row.length ? row : [{ text: ' ', role: 'plain' }], `full-${index}`)
        return hidden > 0 && index === fullShown.length - 1 ? (
          <Box key="full-last-row" flexDirection="row">
            <Box key="full-last-text" flexShrink={1}>{line}</Box>
            <Box key="full-last-gap" flexGrow={1} />
            <Box key="full-last-more" flexShrink={0}>{moreControl}</Box>
          </Box>
        ) : line
      })
      // One pill per role, in a wash of its color.
      const legend = LEGEND.map(span => {
        const hue = roleProps(span.role).color
        return pill({ Box, Text }, look.nerd, mix(hue, THEME.bg, WASH), <Text color={hue}>{look.nerd ? span.text : ` ${span.text} `}</Text>, `legend-${span.role}`, THEME.bg)
      })

      const touches: unknown[] = [
        <Text key="touch-total" color={THEME.onSurface} wrap="wrap">{figures(Text, report.listTitle ?? fill(text.ui.wouldSummary, { summary: report.summary }), 'touch-total')}</Text>,
      ]
      report.groups.forEach((group, index) => {
        const color = NOT_LOST.includes(group.title) ? THEME.onSurface : THEME.alert
        touches.push(plainText(`touch-${index}-title`, group.title, THEME.muted, { bold: true }))
        if (group.entries) {
          const byDir = new Map<string, { name: string; detail: string }[]>()
          for (const entry of group.entries) byDir.set(entry.dir, [...(byDir.get(entry.dir) ?? []), entry])
          let drawn = 0
          for (const [dir, files] of byDir) {
            if (drawn >= 400) break
            touches.push(plainText(`dir-${index}-${drawn}`, `${tilde(dir, home)}/`, THEME.muted))
            for (const file of files) {
              touches.push(
                <Text key={`file-${index}-${drawn}`} wrap="wrap">
                  <Text key={`file-${index}-${drawn}-name`} color={color}>{`  ${file.name}`}</Text>
                  <Text key={`file-${index}-${drawn}-size`} color={THEME.warn}>{`  ${file.detail}`}</Text>
                </Text>,
              )
              drawn++
            }
          }
          if (group.entries.length > drawn) touches.push(plainText(`touch-${index}-rest`, fill(text.ui.andMoreNotShown, { n: group.entries.length - drawn }), THEME.muted))
        } else {
          ;(group.all ?? group.lines).forEach((line, at) => touches.push(<Text key={`line-${index}-${at}`} color={color} wrap="wrap">{figures(Text, line, `line-${index}-${at}`)}</Text>))
        }
      })
      if (report.isUnknown && report.note) touches.push(plainText('touch-note', report.note, THEME.muted))

      return (
        <Box flexDirection="column" backgroundColor={THEME.bg} paddingX={1} minHeight={e.props.scroll.bodyRows}>
          {tabRow({ Box, Client, Text }, look.nerd, tabs(false), still)}
          <Text color={THEME.muted} wrap="truncate-end">{`${text.ui.readOnly} ${MARK.sep} ${text.ui.answerOnCard}`}</Text>
          {section({ Box, Text }, look, 'does', 'menu-headsup', text.ui.sectionDoes, [...does, plainText('why-source', fill(text.ui.heldBy, { source: source.replace(/\.$/, '') }), THEME.muted, { key: 'why-source' })])}
          {section({ Box, Text }, look, 'touches', 'tool', text.ui.sectionTouches, touches)}
          {section({ Box, Text }, look, 'undo', 'actions', text.ui.sectionUndo, [plainText('undo-text', plain.undo, THEME.onSurface)])}
          {section({ Box, Text }, look, 'full', 'prompt', text.ui.sectionFull, fullRows)}
          {cardGap({ Box, Text }, 'legend')}
          <Box key="legend-row" flexDirection="row" flexWrap="wrap" columnGap={1}>{legend}</Box>
          {checks.length > 0 ? checksSection({ Box, Text }, checks, e.props.bodyColumns) : null}
          <Box key="footer-space" height={FOOTER_ROWS} flexShrink={0} />
          {paneFooter({ Box, Text }, hoveredTip(), e.props.bodyColumns, e.props.scroll)}
        </Box>
      )
    }
    if (e.requestId !== SETTINGS_PANE) return next(e)

    const rows = (await $.config.list()).filter(row => row.key.startsWith('mod-blast-radius.'))
    // A saved change reloads this mod, which redraws the panel with the new value.
    const run = async (action: Action) => {
      const said = action.command === 'mod-blast-radius' ? answer($, action.args ?? '') : $.command.run({ command: action.command, args: action.args ?? '' }).then(() => fill(text.ui.ran, { command: action.command }))
      note = await said.then(reply => `${MARK.ok} ${reply || action.label}`).catch(error => `${MARK.warn} ${String(error)}`)
      $.ui.invalidate('ui.render')
    }
    const patterns = BUILT_IN.map((name, index) => (
      <Box key={`built-in-${index}`} flexDirection="row" columnGap={1}>
        <Text color={THEME.accent}>{MARK.bullet}</Text>
        <Text color={THEME.onSurface} wrap="truncate-end">{name}</Text>
      </Box>
    ))
    const loaded = await loadRules($)
    const bad = loaded.notes.length ? `${MARK.warn} ${loaded.notes[0]}${loaded.notes.length > 1 ? fill(text.ui.moreProblems, { n: loaded.notes.length - 1 }) : ''}` : ''
    const ruleLines = [
      <Text key="rules-path" color={THEME.onSurface} wrap="truncate-end">{`~/${RULES_FILE}`}</Text>,
      <Text key="rules-format" color={THEME.muted} wrap="truncate-end">{'[{ "pattern": "terraform\\s+destroy", "reason": "Destroys infrastructure", "flags": "i" }]'}</Text>,
      <Text key="rules-count" color={THEME.muted}>{`${fill(text.ui.rulesLoaded, { rules: plural(loaded.rules.length, text.units.rule) })} ${MARK.sep} ${text.ui.rulesNote}`}</Text>,
    ]

    return (
      <Box flexDirection="column" backgroundColor={THEME.bg} paddingX={1} minHeight={e.props.scroll.bodyRows}>
        {tabRow({ Box, Client, Text }, look.nerd, tabs(true), still)}
        <Text wrap="truncate-end" color={statusColor(note || bad)}>{note || bad || `${text.ui.statusHint} ${MARK.sep} ${text.ui.statusHintSaved}`}</Text>
        {settingsBody({ Box, Button, Client, Text }, look, { rows, actions, working, run, previews , still: still, tips: text.settingTips })}
        {section({ Box, Text }, look, 'rules', 'Bash', text.ui.sectionRules, ruleLines)}
        {section({ Box, Text }, look, 'built-in', 'Bash', text.ui.sectionBuiltIn, patterns)}
        <Box key="footer-space" height={FOOTER_ROWS} flexShrink={0} />
        {paneFooter({ Box, Text }, hoveredTip(), e.props.bodyColumns, e.props.scroll, actionReveals(actions, look, working))}
      </Box>
    )
  })

  // Cancel, Details and Run are entry Clients in the card; a click posts the entry's id.
  on('ui.message', async ($, e, next) => {
    if (isTipMessage(e.data)) {
      hovered = e.data
      if (hovered.id) expireBandTip($)
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
    const message = e.data as EntryMessage
    if (message?.type === 'menu-entry' && message.id === WAIT_CHIP) await reopenWaiting($)
    if (message?.type === 'menu-entry') await choose($, message.id)
    // The Details pane's expand control only changes how much of the command it draws; the card's Run and Cancel never read it.
    if (message?.type === 'menu-entry' && message.id === DOES_MORE && held) {
      held.isDoesOpen = !held.isDoesOpen
      $.ui.invalidate('ui.render')
    }
    if (message?.type === 'menu-entry' && message.id === MORE && held) {
      held.isFull = !held.isFull
      $.ui.invalidate('ui.render')
    }
    // The title line's tabs swap Details and Settings; the open tab does nothing.
    if (message?.type === 'menu-entry' && message.id === SETTINGS_TAB && !(await isSettingsOpen($))) await toggleSettings($)
    if (message?.type === 'menu-entry' && message.id === DETAILS_TAB && !(await isPaneOpen($, LIST_PANE))) await toggleList($)

    return next(e)
  })

  // The hold is a card above the pill row, so it draws wherever the band does, desktop included.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    await loadLook($)
    // @ts-expect-error The host's types omit Client from a Pane's elements, yet a Pane draws it.
    const { Box, Button, Client, Input, Text } = $.ui.resolve(e)
    // The waiting chip ends the pill row; with labels off, or a row too narrow for the words, it shows the icon and the count only.
    const chips = [...waiting.values()]
    const drawRow = async (group: unknown[], row: unknown[], rest: unknown[], tip: unknown) => {
      const labels = labelsOf((await $.state.get({ plugin: 'mod-menu', key: 'labels' }).catch(() => undefined))?.value)
      const draw = (mode: 'full' | 'count') => pillRow({ Box, Client, Text }, look.nerd, group, [...row, waitChip({ Box, Client, Text }, mode, chips.length, (chips.find(each => !each.answer) ?? chips[0]!).held.command)], rest, tip, e.props.bodyColumns)
      const full = draw(labels === 'never' ? 'count' : 'full')
      return labels !== 'never' && isChipCut(full) ? draw('count') : full
    }
    if (!held || !held.report || !held.plain || held.decision !== null) {
      if (toasts.items.length === 0 && chips.length === 0) return next(e)
      const others = await next(e)
      const { group, row, rest, tip } = splitRow(others)
      const cards = toastCards({ Box, Client, Text }, toasts, look, text.tipToast)
      if (chips.length > 0) return drawRow(group, row, [...cards, ...rest], hovered?.id && hovered !== bandExpired ? tipLine({ Box, Text }, tipText(hovered)) : tip)
      if (group.length > 0 || row.length > 0) return pillRow({ Box, Client, Text }, look.nerd, group, row, [...cards, ...rest], tip, e.props.bodyColumns)
      return (
        <Box key="toasts-blast" flexDirection="column">
          {cards}
          {others}
        </Box>
      )
    }
    const { group, row, tip: menuTip } = splitRow(await next(e))
    const cards = toastCards({ Box, Client, Text }, toasts, look, text.tipToast)
    const tip = hovered?.id && hovered !== bandExpired ? tipLine({ Box, Text }, tipText(hovered)) : menuTip

    // While a call is held only the card and the pill row draw, so other rows cannot fill the band and cut the card off.
    const card = holdCard({ Box, Button, Client, Input, Text }, held, e.props.bodyColumns, e.props.maxRows, id => choose($, id), value => typeReason($, value), value => sendReason($, value), sessionCount(checks))
    if (chips.length > 0) return drawRow(group, row, [...cards, card], tip)
    return pillRow({ Box, Client, Text }, look.nerd, group, row, [...cards, card], tip, e.props.bodyColumns)
  })
}

// mod-heads-up / hooks/register.tsx, by v-amorim
// Registers the heads up pane, pill, commands and side check flow with the engine.
import type { ConfigValue, EngineInterface, Register, RenderElement, SessionMessage } from 'claude-code'

import { bridgeOn, endBridge, startBridge, type BridgeRecord } from './bridge'
import { checkPrompt, parseCheck, parseRecheck, parseRewrite, recheckPrompt, rewritePrompt, type Direction } from './ask'
import { isTipMessage, tipText, type EntryMessage, type EntryProps, type Tip } from './entry'
import { cardFill, detectNerd, FOOTER_ROWS, lookFor, paneFooter, section, titleEdge, withMark, type IconMode, type Reveal } from './look'
import { byTurn, canFork, CLEAR_AFTER_PROMPTS, emptySaved, KNOWN_KEPT, pack, recentSessions, remember, restates, sameText, savedOf, SEEN_KEPT, shouldCheck, stringsOf, unreadCount, type Note, type Saved } from './notes'
import { countSpawn, countTool, endTurn, receiptLine, receiptOf, startTurn, type Open, type Receipt } from './receipt'
import { recordSpend } from './spend'
import { isPrompt, PLACEHOLDER, PromptNumbers } from './prompts'
import { labelsOf, menuEntry, pill, PILL, pillRow, splitRow, tabRow, tipLine } from './pills'
import { actionReveals, settingChoice, settingsBody, type Action, type Previews } from './settings'
import text from './text'
import { fill, MARK, mix, statusColor, THEME, WASH } from './theme'
import type { RowProps } from './timeline'
import { TOAST_MS, ToastList, toastCards } from './toasts'
import { bytesOf, CHUNK_BYTES, chunkArgv, feedLines, utf8Length, WHOLE_READ_BYTES } from './transcript'

// The settings (userConfig), fixed per activation: a change reloads the mod.
let iconMode: IconMode = 'auto'
let enabled = false
let look = lookFor(false)

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

const PANE = 'headsup'
const SETTINGS = 'headsup-settings'

// The session's notes, the shown card and the prompt count live in the store, so a reload or a resume keeps them.
let saved: Saved = emptySaved()
let loadedSession = ''
// The load of the session's store. Hooks that ask at once share it, so none reads the notes before they load.
let loading: { session: string; done: Promise<void> } | null = null
// The seen topics live per session; the known topics live per project, under the folder the session runs in.
let seen: string[] = []
let known: string[] = []
let knownKey = 'known:'
// The main turn in progress, and the last one that ended (kept in the store per session, so a reload shows it).
let openTurn: Open | null = null
let receipt: Receipt | undefined
const sessionCost = async ($: EngineInterface) => (await $.session.usage().catch(() => undefined))?.cost?.usd
// The prompts drawn in the composer this session, by requestId: the transcript may not hold them yet.
const drawnPrompts = new Map<string, string>()
// How far the transcript was read, so a check reads only what was written since. A cache: a reload starts it over.
let transcript: { path: string; read: number; numbers: PromptNumbers } | null = null
// A headless run (claude -p, the SDK) has no one at the prompt to read a note, so it never checks. Set at session.start.
let isInteractive = true

// The last main request's model and effort, which pick the check's route.
let lastModel = ''
let lastEffort: string | number | undefined
// A check runs at most once per turn.
let checkedTurn = ''
let isChecking = false
// Main requests seen so far, so a check knows whether the session moved on while it ran.
let mainSteps = 0
// `<direction>-<note id>` while a rewrite runs.
let rewriting = ''
// The notes opened in the panel, kept in $.state so they survive redraws.
const OPEN_KEY = { plugin: 'mod-heads-up', key: 'open' } as const
const openIds = async ($: EngineInterface) => stringsOf((await $.state.get(OPEN_KEY)).value)

async function setOpen($: EngineInterface, id: string, isOpen: boolean) {
  const ids = (await openIds($)).filter(each => each !== id)
  await $.state.set(OPEN_KEY, isOpen ? [...ids, id] : ids)
}
// The panel's X hid the card; a click on a timeline row or a new note shows it again.
let isCardClosed = false
// The note whose rewording choices are shown.
let wording = ''
// The note whose bullets show in full; the others cut each bullet to one row.
let fullNote = ''
let note = ''
let actions: Action[] = []
let previews: Previews | undefined

async function ensureLoaded($: EngineInterface) {
  const session = await $.session.id()
  if (loading?.session !== session) loading = { session, done: loadSession($, session) }
  await loading.done
}

async function loadSession($: EngineInterface, session: string) {
  drawnPrompts.clear()
  const key = `known:${await $.session.cwd().catch(() => '')}`
  const [nextSaved, nextSeen, nextKnown, sessions, nextReceipt] = await Promise.all([
    $.store.get(`notes:${session}`).catch(() => undefined),
    $.store.get(`seen:${session}`).catch(() => undefined),
    $.store.get(key).catch(() => undefined),
    $.store.get('sessions').catch(() => undefined),
    $.store.get(`receipt:${session}`).catch(() => undefined),
  ])
  // A load for another session started meanwhile: that one owns the state now.
  if (loading?.session !== session) return
  // The panel's view of the session before a /resume or /clear is not this one's.
  if (loadedSession && loadedSession !== session) {
    isCardClosed = false
    wording = ''
    note = ''
    checkedTurn = ''
    isChecking = false
    mainSteps = 0
    rewriting = ''
    transcript = null
    lastModel = ''
    lastEffort = undefined
    openTurn = null
  }
  loadedSession = session
  receipt = receiptOf(nextReceipt)
  knownKey = key
  saved = savedOf(nextSaved)
  seen = stringsOf(nextSeen)
  known = stringsOf(nextKnown)
  // Only the most recent sessions keep their notes and seen topics in the store.
  const recent = recentSessions(stringsOf(sessions), session)
  await $.store.set('sessions', recent.kept).catch(() => {})
  for (const old of recent.dropped) await Promise.all([$.store.delete(`notes:${old}`), $.store.delete(`seen:${old}`), $.store.delete(`receipt:${old}`)]).catch(() => {})
}

async function save($: EngineInterface) {
  await $.store.set(`notes:${loadedSession}`, saved).catch(() => {
    // Without a store the notes still show until the next reload.
  })
}

// The transcript the session's SessionStart named; a session that began before this mod loaded is found by its file name.
async function transcriptOf($: EngineInterface) {
  const named = pathOf(await $.store.get(`transcript:${await $.session.id()}`).catch(() => undefined))
  return named || findTranscript($)
}

// Only the SessionStart record names the transcript, and the bridge delivers it; the store keeps it per session, as mod-transcript does.
async function sessionStarted($: EngineInterface, record: BridgeRecord) {
  const session = String(record.session_id ?? '')
  const path = String(record.transcript_path ?? '')
  if (!session || !path) return
  await $.store.set(`transcript:${session}`, { path, at: await $.clock.now() }).catch(() => {})
}

// A transcript path is kept with the time it was named; an older bare string counts as a path with no age yet.
const pathOf = (kept: unknown) => {
  const path = typeof kept === 'object' && kept !== null ? (kept as { path?: unknown }).path : kept
  return typeof path === 'string' ? path : ''
}

const TRANSCRIPT_KEEP_MS = 30 * 24 * 60 * 60 * 1000

// Entries untouched for 30 days go; a bare string from an older version starts its clock now.
async function pruneTranscripts($: EngineInterface) {
  try {
    const now = await $.clock.now()
    for (const key of await $.store.keys()) {
      if (!key.startsWith('transcript:')) continue
      const kept = await $.store.get(key)
      const at = typeof kept === 'object' && kept !== null ? Number((kept as { at?: unknown }).at) : NaN
      if (Number.isFinite(at)) {
        if (at < now - TRANSCRIPT_KEEP_MS) await $.store.delete(key)
      } else if (typeof kept === 'string') await $.store.set(key, { path: kept, at: now })
    }
  } catch {
    // Old entries stay until the next start.
  }
}

// Claude Code's config folder: CLAUDE_CONFIG_DIR when set, else ~/.claude.
async function configDir($: EngineInterface) {
  const set = ((await $.env.get('CLAUDE_CONFIG_DIR')) ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
  if (set) return set
  const home = ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '').replace(/\\/g, '/')
  return `${home}/.claude`
}

// When no SessionStart named the transcript, it is `<session id>.jsonl` in one of the config folder's projects folders.
async function findTranscript($: EngineInterface) {
  const projects = `${await configDir($)}/projects`
  const file = `${await $.session.id()}.jsonl`
  for (const entry of await $.fs.list(projects).catch(() => [])) {
    const path = `${projects}/${entry.name}/${file}`
    if (entry.kind === 'dir' && (await $.fs.exists(path).catch(() => false))) return path
  }
  return ''
}

// $.fs.read takes a whole file up to 4 MiB and cannot seek, so past that, and for any read from an offset, a process prints the bytes.
async function readBytes($: EngineInterface, path: string, from: number, length: number) {
  if (from === 0) {
    const whole = await $.fs.read(path, { as: 'bytes' }).catch(() => null)
    if (whole) return bytesOf(whole.base64)
  }
  const { stdout } = await $.process.run(chunkArgv(path, from, length)).catch(() => ({ stdout: '' }))
  return bytesOf(stdout)
}

// The prompts numbered as the transcript numbers them. Each check reads only the bytes written since the last one, so /rewind and a late load still change the live branch as the file grows.
async function numberPrompts($: EngineInterface) {
  const path = await transcriptOf($)
  const size = path ? ((await $.fs.stat(path).catch(() => null))?.size ?? 0) : 0
  // A file that shrank, or another transcript, starts over.
  if (transcript?.path !== path || size < transcript.read) transcript = { path, read: 0, numbers: new PromptNumbers() }
  const cache = transcript
  // A long session's first read streams the whole file once: one process per chunk took far longer on a very large file.
  if (cache.read === 0 && size > WHOLE_READ_BYTES) {
    const isWindows = /^[A-Za-z]:|\\/.test(path)
    // cmd's type rejects forward slashes.
    const argv = isWindows ? ['cmd', '/c', 'type', path.replace(/\//g, '\\')] : ['cat', path]
    let text = ''
    for await (const chunk of $.process.spawn({ argv })) if (chunk.stream === 'stdout') text += chunk.text
    const whole = text.slice(0, text.lastIndexOf('\n') + 1)
    for (const line of whole.split('\n')) if (line.trim()) cache.numbers.feed(line)
    cache.read = utf8Length(whole)
  }
  let carry: Uint8Array = new Uint8Array(0)
  let at = cache.read
  while (at < size) {
    const chunk = await readBytes($, path, at, Math.min(CHUNK_BYTES, size - at))
    if (chunk.length === 0) break
    at += chunk.length
    carry = feedLines(cache.numbers, carry, chunk)
  }
  cache.read = at - carry.length
  cache.numbers.drawn([...drawnPrompts].map(([id, text]) => ({ id, text })))
  return cache.numbers
}

const noteOf = (id: string) => saved.notes.find(each => each.id === id)

const ASK_TIMEOUT_MS = 120_000

const REASON_CHARS = 80

// The session that already got the "side check unavailable" toast.
let warnedSession: string | null = null

// One toast per session when the side model call fails, so a blocked plan is not silent forever.
async function sideUnavailable($: EngineInterface, reason: string) {
  const session = await $.session.id().catch(() => '')
  if (warnedSession === session) return
  warnedSession = session
  const short = reason.replace(/_/g, ' ').replace(/\s+/g, ' ').trim().slice(0, REASON_CHARS)
  const message = short ? fill(text.sideUnavailableWhy, { reason: short }) : text.sideUnavailable
  $.ui.toast(message)
}

const apiReason = (reply: { isAnswered: boolean; reason?: string; status?: number | null; error?: string }) =>
  reply.isAnswered || reply.reason !== 'api-error' ? null : [reply.error ?? '', reply.status ? String(reply.status) : ''].filter(Boolean).join(' ')

// A fork runs at the session's effort and reads its cache; above medium, or with nothing to fork yet, the packed conversation goes to the session's model at medium.
async function ask($: EngineInterface, prompt: string) {
  try {
    if (canFork(lastEffort)) {
      // $.model.fork takes no timeoutMs, so a fork that never answers is cut here.
      const reply = await Promise.race([$.model.fork({ prompt }), $.clock.sleep(ASK_TIMEOUT_MS).then(() => null)])
      if (reply === null) return null
      recordSpend($, lastModel || (await $.session.model().catch(() => '')), !reply.isAnswered && reply.reason === 'nothing-to-fork' ? null : reply)
      if (reply.isAnswered) return reply.text
      const failure = apiReason(reply)
      if (failure !== null) await sideUnavailable($, failure)
      if (!('reason' in reply) || reply.reason !== 'nothing-to-fork') return null
    }
    const messages = (await $.session.messages()) as SessionMessage[]
    const model = lastModel || (await $.session.model())
    const reply = await $.model.complete({ model, effort: 'medium', prompt: `<conversation>\n${pack(messages)}\n</conversation>\n\n${prompt}`, maxTokens: 1500, timeoutMs: ASK_TIMEOUT_MS })
    recordSpend($, model, reply)
    const failure = apiReason(reply)
    if (failure !== null) await sideUnavailable($, failure)
    return reply.isAnswered ? reply.text : null
  } catch (error) {
    await sideUnavailable($, error instanceof Error ? error.message : String(error))
    throw error
  }
}

async function check($: EngineInterface) {
  if (isChecking) return
  isChecking = true
  $.ui.invalidate('ui.render')
  try {
    await ensureLoaded($)
    const session = loadedSession
    const startStep = mainSteps
    // The prompt the running turn answers, numbered before the check's model call takes a while.
    const running = (await numberPrompts($)).latest()
    const reply = await ask($, checkPrompt(seen, known))
    const found = reply ? parseCheck(reply) : null
    // A /clear while the check ran makes it another session's.
    if (reply === null || session !== (await $.session.id())) return
    const turn = running?.number ?? 0
    // A topic offered or known before, in other words or the same, is not offered again.
    if (!found || [...seen, ...known].some(each => restates(each, found.learn))) return await recordCheck($, turn, false)
    // The main agent often catches the same thing within a step or two, so a finding that a newer step may have overtaken is asked about once more.
    if (mainSteps !== startStep) {
      const verdict = await ask($, recheckPrompt(found))
      if (verdict === null || session !== (await $.session.id())) return
      if (!parseRecheck(verdict)) return await recordCheck($, turn, false)
    }
    const at = await $.clock.now()
    const added: Note = { ...found, id: `n${saved.notes.length + 1}-${at}`, turn, prompt: running?.text ?? '', promptId: running?.id, at, isRead: false }
    saved = { ...saved, notes: [...saved.notes, added], card: added.id, since: 0, checked: { turn, at, found: true } }
    seen = remember(seen, found.learn, SEEN_KEPT)
    isCardClosed = false
    await save($)
    await $.store.set(`seen:${session}`, seen).catch(() => {})
  } catch {
    // A heads-up is a courtesy: any failure shows nothing.
  } finally {
    isChecking = false
    $.ui.invalidate('ui.render')
  }
}

// The last check's result for the pane's last-check line. A check that got no answer records nothing.
async function recordCheck($: EngineInterface, turn: number, found: boolean) {
  saved = { ...saved, checked: { turn, at: await $.clock.now(), found } }
  await save($)
  $.ui.invalidate('ui.render')
}

async function update($: EngineInterface, id: string, change: Partial<Note>) {
  saved = { ...saved, notes: saved.notes.map(each => (each.id === id ? { ...each, ...change } : each)) }
  await save($)
  $.ui.invalidate('ui.render')
}

async function closeCard($: EngineInterface) {
  if (!saved.card) return
  saved = { ...saved, card: null, since: 0 }
  await save($)
  $.ui.invalidate('ui.render')
}

async function knowIt($: EngineInterface, id: string) {
  const found = noteOf(id)
  if (!found) return
  known = remember(known, found.title || found.learn, KNOWN_KEPT)
  await $.store.set(knownKey, known).catch(() => {})
  if (saved.card === id) saved = { ...saved, card: null, since: 0 }
  await update($, id, { isRead: true })
}

async function chat($: EngineInterface, id: string) {
  const found = noteOf(id)
  if (!found) return
  const prompt = fill(text.chatPrompt, { learn: found.learn })
  const result = await $.prompt.submit({ text: prompt, asUser: true }).catch((error: unknown) => ({ drop: String(error) }))
  if (!('drop' in result) || !result.drop) return
  // A dropped prompt (an Esc that interrupted the turn is one way) leaves the note in the box for the person's own Enter.
  const box = await $.prompt.read()
  const filled = await $.prompt.fill({ text: box.text.trim() ? `\n${prompt}` : prompt, mode: box.text.trim() ? 'append' : 'replace' }).catch(() => ({ isFilled: false }))
  $.ui.toast(fill(filled.isFilled ? text.chatDropped : text.chatLost, { reason: result.drop }))
}

// The band card's actions.
async function cardAction($: EngineInterface, id: string) {
  const card = saved.card ?? ''
  if (!card) return
  if (id === 'headsup-card-open') await learnMore($, card)
  else if (id === 'headsup-card-chat') await chat($, card)
  else if (id === 'headsup-card-dismiss') {
    bandTip = ''
    await closeCard($)
    await update($, card, { isRead: true })
  }
}

async function redo($: EngineInterface, id: string, direction: Direction) {
  const found = noteOf(id)
  if (!found || rewriting) return
  rewriting = `${direction}-${id}`
  $.ui.invalidate('ui.render')
  try {
    const reply = await ask($, rewritePrompt(found, direction))
    const rewritten = reply ? parseRewrite(reply) : null
    if (rewritten) await update($, id, { title: rewritten.title || found.title, body: rewritten.body })
  } catch {
    // The old explanation stays.
  } finally {
    rewriting = ''
    $.ui.invalidate('ui.render')
  }
}

const isOpen = async ($: EngineInterface, id = PANE) => (await $.ui.panes()).some(pane => pane.id === id && pane.isPlaced)

// The command and the bar entry both toggle. An unplaced pane is waiting, not open.
async function togglePane($: EngineInterface) {
  if (await isOpen($)) {
    await $.ui.close({ id: PANE })
    await $.state.set({ plugin: 'mod-heads-up', key: 'pane' }, false)
    return
  }
  await showPane($)
}

async function showPane($: EngineInterface) {
  if (await isOpen($)) {
    $.ui.invalidate('ui.render')
    return
  }
  if (await isOpen($, SETTINGS)) await $.ui.close({ id: SETTINGS })
  note = ''
  const opened = await $.ui.open({ id: PANE, title: text.paneTitle, closeOnEscape: true })
  if (!opened.isPlaced) $.ui.toast(text.panelWaiting)
  await $.state.set({ plugin: 'mod-heads-up', key: 'pane' }, opened.isPlaced)
}

// `/mod-heads-up settings` and the Settings tab swap the panel for its settings.
async function toggleSettings($: EngineInterface) {
  if (await isOpen($, SETTINGS)) {
    await $.ui.close({ id: SETTINGS })
    await $.state.set({ plugin: 'mod-heads-up', key: 'pane' }, false)
    return
  }
  if (await isOpen($)) await $.ui.close({ id: PANE })
  note = ''
  const showcase = await $.fs.read(`${$.plugin.root}/showcase.json`).then(raw => JSON.parse(String(raw))).catch(() => null)
  previews = showcase?.previews
  actions = (Array.isArray(showcase?.actions) ? showcase.actions : []).map((action: Action) => ({ ...action, isLocal: action.command === 'mod-heads-up' }))
  const opened = await $.ui.open({ id: SETTINGS, title: text.settingsPaneTitle, closeOnEscape: true })
  if (!opened.isPlaced) $.ui.toast(fill(text.settingsWaiting, { reason: opened.reason }))
  await $.state.set({ plugin: 'mod-heads-up', key: 'pane' }, opened.isPlaced)
}

// The entry shimmers from the click until the pane draws, so a slow open never looks ignored.
const OPEN_WAIT_MS = 8000
let isOpening = false

function endOpening($: EngineInterface) {
  if (!isOpening) return
  isOpening = false
  $.ui.invalidate('ui.render')
}

async function openingPane($: EngineInterface, open: () => Promise<void>) {
  if (!(await isOpen($))) {
    isOpening = true
    $.ui.invalidate('ui.render')
    $.clock.after(OPEN_WAIT_MS, () => endOpening($))
  }
  await open()
  if (!(await isOpen($))) endOpening($)
}

// The card's Learn more: the panel opens on that note, already expanded and read.
async function learnMore($: EngineInterface, id: string) {
  await setOpen($, id, true)
  isCardClosed = false
  bandTip = ''
  if (saved.card === id) saved = { ...saved, card: null, since: 0 }
  await update($, id, { isRead: true })
  await openingPane($, () => showPane($))
}

// What `/mod-heads-up <args>` does; the panel's own actions call it directly, since $.command.run skips the calling plugin.
async function answer($: EngineInterface, args: string) {
  const word = args.trim()
  if (word === 'clear') {
    await closeCard($)
    return text.cardCleared
  }
  if (word === 'forget') {
    await ensureLoaded($)
    known = []
    await $.store.set(knownKey, known).catch(() => {})
    return text.knownForgotten
  }
  if (word === 'settings') await toggleSettings($)
  else await togglePane($)
  return ''
}

// Scrolls the transcript to the turn's prompt row by its id, so a prompt sent twice reaches its own turn. Claude Code allows the scroll only with the person's press behind it.
async function jump($: EngineInterface, turn: number, requestId: string) {
  if (!requestId) {
    note = `${MARK.warn} ${fill(text.notDrawn, { n: turn })}`
  } else {
    const result = await $.ui.scroll({ to: { requestId }, block: 'start' }).catch((error: Error) => ({ deny: error.message }))
    note = 'deny' in result && result.deny ? `${MARK.warn} ${result.deny}` : `${MARK.ok} ${fill(text.jumped, { n: turn })}`
  }
  $.ui.invalidate('ui.render')
}

async function saveSetting($: EngineInterface, key: string, value: ConfigValue) {
  const row = (await $.config.list()).find(each => each.key === key)
  const result = await $.config.set({ key, value })
  note = 'deny' in result && result.deny ? `${MARK.warn} ${result.deny}` : `${MARK.ok} ${fill(text.settingSaved, { label: row?.label ?? key })}`
  $.ui.invalidate('ui.render')
}

const fit = (line: string, width: number) => {
  const flat = line.replace(/\s+/g, ' ')
  return flat.length <= width ? flat : `${flat.slice(0, Math.max(0, width - 1))}…`
}

const clock = (at: number) => {
  const date = new Date(at)
  return Number.isNaN(date.getTime()) ? '' : `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

// A control glyph without the brackets and padding it carries as a Button label, for drawing inside a pill.
const bare = (glyph: string) => glyph.replace(/[[\]\s]/g, '')

// The row under the hint: when the last check ran, the turn it read and whether it showed a note.
async function lastCheckLine($: EngineInterface) {
  const { checked } = saved
  if (!checked) return text.noCheck
  const minutes = Math.max(0, Math.floor(((await $.clock.now()) - checked.at) / 60_000))
  const ago = minutes < 1 ? text.agoUnder : fill(text.agoMinutes, { min: minutes })
  return fill(checked.found ? text.checkedNote : text.checkedNone, { n: checked.turn, ago })
}

const tabs = (isSettings: boolean) => [
  { id: 'headsup-tab', label: text.paneTitle, icon: look.glyph.warn, isOpen: !isSettings, count: saved.notes.length, tip: { glyph: bare(look.glyph.warn), label: text.paneTitle, text: text.tipTabNotes } },
  { id: 'headsup-settings', label: text.settingsTab, icon: look.glyph.gear, isOpen: isSettings, tip: { glyph: bare(look.glyph.gear), label: text.settingsTab, text: text.tipTabSettings } },
]

// The hovered control's tip: the band's tip row text, and the pane footer's glyph, label and text.
let bandTip = ''
let paneTip: Tip | null = null

// A band redraw can replace a hovered entry, whose leave and quiet timer then never come, so a band tip ends on its own.
const BAND_TIP_MS = 5000
let bandTipAt = 0

function expireBandTip($: EngineInterface) {
  const at = ++bandTipAt
  $.clock.after(BAND_TIP_MS, () => {
    if (at !== bandTipAt || !bandTip) return
    bandTip = ''
    $.ui.invalidate('ui.render')
  })
}

const toasts = new ToastList('headsup')
// The animations setting, fixed per activation: off, every entry draws still.
let still = false

// Rows of the card's text box; a longer note is cut at its foot.
const NOTE_TEXT_ROWS = 8

const DIRECTIONS: [Direction, string, string][] = [['simpler', text.simpler, text.tipSimpler], ['less', text.lessDetail, text.tipLess], ['more', text.moreDetail, text.tipMore]]

export const register: Register = (on, options) => {
  still = options.animations === false
  enabled = options.enabled === true
  iconMode = (options.icons as IconMode | undefined) ?? 'auto'
  // A forced mode needs no detection; auto loads the saved answer, then checks the terminal font beside the hooks.
  look = lookFor(iconMode === 'nerd')
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

  on('session.start', async ($, e, next) => {
    isInteractive = e.isInteractive
    bridgeOn('SessionStart', record => sessionStarted($, record))
    await startBridge($, 'mod-heads-up')
    await loadLook($)
    await $.command.register({ name: 'mod-heads-up', description: text.commandDescription, argumentHint: '[settings|clear|forget]' })
    await ensureLoaded($)
    await pruneTranscripts($)
    // The bar entry reads this; an unload drops the pane without raising ui.close here.
    await $.state.set({ plugin: 'mod-heads-up', key: 'pane' }, (await isOpen($)) || (await isOpen($, SETTINGS)))
    $.ui.invalidate('ui.render')

    return next(e)
  })

  on('command.run', { command: 'mod-heads-up' }, async ($, e) => ({ text: await answer($, e.args ?? '') }))

  // Main requests only: a subagent's steps carry agentId. The check runs off the hook's time, so the turn never waits.
  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) {
      lastModel = e.model
      lastEffort = e.effort
      mainSteps += 1
      if (enabled && isInteractive && shouldCheck(e.index, e.turnId, checkedTurn, Boolean(saved.card))) {
        checkedTurn = e.turnId
        $.clock.after(0, () => check($))
      }
    }

    return yield* next(e)
  })

  // The receipt of the main turn: subagent turns pass through, their calls count into it.
  on('turn.start', async ($, e, next) => {
    if (!e.agentId) openTurn = startTurn(openTurn, e, await $.clock.now(), await sessionCost($))

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) {
      const ended = endTurn(openTurn, e, await $.clock.now(), await sessionCost($))
      openTurn = ended.open
      if (ended.receipt) {
        await ensureLoaded($)
        receipt = ended.receipt
        await $.store.set(`receipt:${loadedSession}`, receipt).catch(() => {})
        $.ui.invalidate('ui.render')
      }
    }

    return result
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    openTurn = countTool(openTurn, e.tool, result.isError === true)

    return result
  })

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    openTurn = countSpawn(openTurn)

    return result
  })

  on('prompt.submit', async ($, e, next) => {
    const sent = sameText(String(e.text ?? ''))
    if (sent && !sent.startsWith('/')) {
      await ensureLoaded($)
      const since = saved.card ? saved.since + 1 : 0
      saved = { ...saved, since, card: since >= CLEAR_AFTER_PROMPTS ? null : saved.card }
      await save($)
      $.ui.invalidate('ui.render')
    }

    return next(e)
  })

  // Each prompt row as Claude Code draws it, so ↗ scrolls to the id the row really has, and a prompt the transcript may not hold yet is numbered.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.props.origin?.kind === 'composer') {
      const promptText = String(e.props.text ?? '')
      await ensureLoaded($)
      if (e.requestId !== PLACEHOLDER && isPrompt(promptText)) drawnPrompts.set(e.requestId, promptText)
    }

    return next(e)
  })

  // A /resume or /clear ends this session; what its bridge file still holds is delivered first.
  on('session.end', async ($, e, next) => {
    await endBridge($, e.sessionId)

    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE || e.id === SETTINGS) paneTip = null
    if (e.id === PANE || e.id === SETTINGS) await $.state.set({ plugin: 'mod-heads-up', key: 'pane' }, await isOpen($, e.id === PANE ? SETTINGS : PANE))

    return next(e)
  })

  // One panel at a time: another mod's pane opening closes this one, deferred past that plugin's dispatch.
  on('state.set', async ($, e, next) => {
    // The declared state names no other mod's pane, so the types narrow this event to never.
    if (e.key === 'pane' && e.plugin !== 'mod-heads-up' && (e as { value?: unknown }).value === true) {
      $.clock.after(0, async () => {
        if (!(await isOpen($)) && !(await isOpen($, SETTINGS))) return
        await $.ui.close({ id: PANE })
        await $.ui.close({ id: SETTINGS })
        await $.state.set({ plugin: 'mod-heads-up', key: 'pane' }, false)
      })
    }

    return next(e)
  })

  on('ui.message', async ($, e, next) => {
    const change = settingChoice(e.data)
    if (change) await saveSetting($, change.key, change.value)
    if (isTipMessage(e.data)) {
      const tip = e.data
      const isBand = tip.id === 'headsup' || Boolean(tip.id?.startsWith('headsup-card')) || Boolean(tip.id?.startsWith('toast-headsup-'))
      if (!tip.id) {
        bandTip = ''
        paneTip = null
      } else if (isBand) {
        bandTip = tipText(tip)
        if (bandTip) expireBandTip($)
      } else paneTip = { glyph: tip.glyph ?? '', label: tip.label ?? '', text: tip.text ?? '' }
      $.ui.invalidate('ui.render')
      return next(e)
    }
    const clicked = e.data as EntryMessage
    if (clicked?.type !== 'menu-entry') return next(e)
    const dismissed = toasts.idOf(clicked.id)
    if (dismissed !== undefined) {
      toasts.drop(dismissed)
      $.ui.invalidate('ui.render')
      return next(e)
    }
    const { id } = clicked
    const card = saved.card ?? ''
    if (id === 'headsup') await openingPane($, () => togglePane($))
    else if (id === 'headsup-tab' && !(await isOpen($))) await showPane($)
    else if (id === 'headsup-settings' && !(await isOpen($, SETTINGS))) await toggleSettings($)
    else if (id.startsWith('headsup-card-')) await cardAction($, id)
    else if (id.startsWith('headsup-note-')) {
      const noteId = id.slice('headsup-note-'.length)
      await $.state.set(OPEN_KEY, [noteId])
      isCardClosed = false
      wording = ''
      await update($, noteId, { isRead: true })
    } else if (id === 'headsup-close') {
      isCardClosed = true
      wording = ''
      paneTip = null
      await $.state.set(OPEN_KEY, [])
      $.ui.invalidate('ui.render')
    } else if (id.startsWith('headsup-understood-')) {
      const noteId = id.slice('headsup-understood-'.length)
      await setOpen($, noteId, false)
      wording = ''
      paneTip = null
      await knowIt($, noteId)
    } else if (id.startsWith('headsup-more-')) {
      const noteId = id.slice('headsup-more-'.length)
      fullNote = fullNote === noteId ? '' : noteId
      $.ui.invalidate('ui.render')
    } else if (id.startsWith('headsup-chat-')) await chat($, id.slice('headsup-chat-'.length))
    else if (id.startsWith('headsup-reword-')) {
      const noteId = id.slice('headsup-reword-'.length)
      wording = wording === noteId ? '' : noteId
      $.ui.invalidate('ui.render')
    } else if (id.startsWith('headsup-redo-')) {
      const [direction, ...rest] = id.slice('headsup-redo-'.length).split('-')
      wording = ''
      await redo($, rest.join('-'), direction as Direction)
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    await loadLook($)
    if (e.surface !== 'terminal' || e.props.hasSurvey) return next(e)
    await ensureLoaded($)
    const elements = $.ui.resolve(e)
    const { Box, Client, Text } = elements
    const { nerd } = look
    // A command waiting on the person outranks a heads-up: the band has few rows, and a hidden hold looks like a hang.
    const isHolding = (await $.state.get({ plugin: 'mod-blast-radius', key: 'holding' })).value === true
    const shown = saved.card && !isHolding ? noteOf(saved.card) : undefined
    const action = (id: string, label: string, glyph: string, tipBody: string) =>
      pill({ Box, Text }, nerd, THEME.surface3, <Client key={id} module="./entry.tsx" height={1} props={{ id, label, isOpen: true, bg: THEME.surface3, nerd, still, subLead: glyph, tip: { glyph, label, text: tipBody } } satisfies EntryProps} />, `${id}-pill`, cardFill())
    const card = shown ? (
      <Box key="headsup-card-block" flexDirection="column">
        <Box key="headsup-card" flexDirection="column" paddingX={1} borderStyle="round" borderColor={THEME.border} backgroundColor={cardFill()}>
          <Box key="headsup-card-text">
            <Text color={THEME.onSurface}>{shown.learn}</Text>
          </Box>
          <Box key="headsup-card-keys" flexDirection="row" columnGap={2} marginTop={1}>
            {action('headsup-card-open', text.open, bare(look.glyph.go), text.tipOpen)}
            {action('headsup-card-chat', text.askClaude, bare(look.glyph.go), text.tipAsk)}
            {action('headsup-card-dismiss', text.dismiss, bare(look.glyph.close), text.tipDismiss)}
          </Box>
        </Box>
        {titleEdge({ Box, Text }, look, 'headsup-card', '', text.pillLabel, shown.tag, 0)}
      </Box>
    ) : null
    const items = [...toastCards({ Box, Client, Text }, toasts, look, text.tipToast), card].filter(Boolean)

    const hidden = await $.state.get({ plugin: 'mod-menu', key: 'hidden' })
    if (hidden.value === true) {
      if (items.length === 0) return next(e)
      return <Box key="headsup-band" flexDirection="column">{items}{await next(e)}</Box>
    }
    // Reading the value subscribes the bar to redraws; the look trusts the pane list itself.
    await $.state.get({ plugin: 'mod-heads-up', key: 'pane' })
    const isShown = (await isOpen($)) || (await isOpen($, SETTINGS))
    const labels = labelsOf((await $.state.get({ plugin: 'mod-menu', key: 'labels' })).value)
    const { group, row, rest, tip } = splitRow(await next(e))
    const unread = unreadCount(saved.notes)
    const badge = unread > 0 ? { badge: { text: String(unread), color: THEME.accent, bg: mix(THEME.accent, isShown ? mix(THEME.ok, PILL.primary, WASH) : PILL.primary, WASH) } } : {}
    // Opening the pane from here queues nothing, so the entry stays live mid-turn.
    const entry = menuEntry({ Box, Client, Text }, nerd, 'headsup', { label: text.pillLabel, isOpen: isShown, idle: THEME.pill, isBusy: isOpening || isChecking || rewriting !== '', still, nerd, tip: { glyph: nerd ? bare(look.glyph.warn) : MARK.bullet, label: text.pillLabel, text: receipt ? receiptLine(receipt) : text.tipPill }, labels, ...badge })

    return pillRow({ Box, Client, Text }, nerd, [entry, ...group], row, [...items, ...rest], bandTip ? tipLine({ Box, Text }, bandTip) : tip, e.props.bodyColumns)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    await loadLook($)
    if (e.requestId !== PANE && e.requestId !== SETTINGS) return next(e)
    if (isOpening) $.clock.after(0, () => endOpening($))
    await ensureLoaded($)
    const elements = $.ui.resolve(e)
    // @ts-expect-error The host's types omit Client from a Pane's elements, yet a Pane draws it.
    const { Box, Button, Client, Text } = elements
    const { nerd } = look

    if (e.requestId === SETTINGS) {
      const rows = (await $.config.list()).filter(row => row.key.startsWith('mod-heads-up.'))
      const run = async (action: Action) => {
        const said = action.command === 'mod-heads-up' ? answer($, action.args ?? '') : Promise.resolve('')
        note = await said.then(result => `${MARK.ok} ${result || action.label}`).catch(error => `${MARK.warn} ${String(error)}`)
        $.ui.invalidate('ui.render')
      }
      return (
        <Box flexDirection="column" backgroundColor={THEME.bg} paddingX={1} minHeight={e.props.scroll.bodyRows}>
          {tabRow({ Box, Client, Text }, nerd, tabs(true), still)}
          <Text wrap="truncate-end" color={statusColor(note)}>{withMark(look, note) || fill(text.settingsHint, { sep: MARK.sep })}</Text>
          {settingsBody({ Box, Button, Client, Text }, look, { rows, actions, working: false, run, previews, tips: text.settingTips, still })}
          <Box key="footer-space" height={FOOTER_ROWS} flexShrink={0} />
          {paneFooter(elements, paneTip, e.props.bodyColumns, e.props.scroll, actionReveals(actions, look, false))}
        </Box>
      )
    }

    // Pane padding, the section's border and padding, then the row's lead glyph and gaps.
    const inner = Math.max(20, e.props.bodyColumns - 2 - 4)
    const entryPill = (id: string, label: string, subLead: string | undefined, tip: Tip, extra: Partial<EntryProps> = {}) =>
      pill({ Box, Text }, nerd, THEME.surface3, <Client key={id} module="./entry.tsx" height={1} props={{ id, label, isOpen: true, bg: THEME.surface3, nerd, still, tip, ...(subLead ? { subLead } : {}), ...extra } satisfies EntryProps} />, `${id}-pill`, cardFill())

    // The selected note in a card with its actions in one row at the foot, and every note in a timeline under it.
    const noteCard = (found: Note) => {
      const turn = fill(text.turnNumber, { n: found.turn })
      // The card's border and padding take two columns a side; the bullet and its space come before the line.
      const isCut = found.body.some(line => line.length + 2 > e.props.bodyColumns - 2 - 4)
      const isFull = isCut && fullNote === found.id
      const close = pill({ Box, Text }, nerd, THEME.surface3, <Client key="headsup-close" module="./entry.tsx" height={1} props={{ id: 'headsup-close', label: bare(look.glyph.close), isOpen: true, bg: THEME.surface3, nerd, still, tip: { glyph: bare(look.glyph.close), label: text.close, text: text.tipClose } } satisfies EntryProps} />, 'headsup-close-pill', THEME.bg)
      return section(elements, look, 'note-card', '', `${turn} ${clock(found.at)}`, [
        // A floor on the height, so a short note never moves the actions; a long one grows the card instead of losing rows.
        <Box key="note-card-text" flexDirection="column" flexShrink={0} minHeight={NOTE_TEXT_ROWS}>
          <Box key={`summary-${found.id}`}>
            <Text color={THEME.onSurface} bold>{found.learn}</Text>
          </Box>
          {found.title ? (
            <Box key={`title-${found.id}`} marginTop={1}>
              <Text color={THEME.onSurface} bold>{found.title}</Text>
            </Box>
          ) : null}
          {found.body.map((line, at) =>
            isFull ? (
              <Box key={`body-${found.id}-${at}`} flexDirection="row">
                <Box flexShrink={0}>
                  <Text color={THEME.onSurface}>{`${MARK.bullet} `}</Text>
                </Box>
                <Text color={THEME.onSurface} wrap="wrap">{line}</Text>
              </Box>
            ) : (
              <Text key={`body-${found.id}-${at}`} color={THEME.onSurface} wrap="truncate-end">{`${MARK.bullet} ${line}`}</Text>
            ),
          )}
        </Box>,
        actionsBar(found, isCut ? moreToggle(found, isFull) : null),
      ], THEME.accent, { hint: found.tag, right: close })
    }

    const timeline = (list: Note[], selected: Note | undefined) =>
      section(elements, look, 'note-timeline', '', '', list.map(found => {
        const isSelected = found.id === selected?.id
        const time = clock(found.at)
        // Pane padding, section border and padding, the time, the dot, gaps, and the ↗ pill.
        const room = Math.max(8, inner - time.length - 11)
        return (
          <Box key={`note-row-${found.id}`} flexDirection="row">
            <Client key={`headsup-note-${found.id}`} module="./timeline.tsx" height={1} props={{ id: `headsup-note-${found.id}`, time: ` ${time} `, mark: ` ${found.isRead && !isSelected ? MARK.stop : MARK.stopOpen}`, summary: ` ${fit(found.learn, room).padEnd(room)} `, isSelected, isUnread: !found.isRead, still, tip: { glyph: bare(look.glyph.expanded), label: text.noteLabel, text: text.tipNote } } satisfies RowProps} />
            <Box key={`note-gap-${found.id}`} flexGrow={1} />
            <Box key={`note-jump-pill-${found.id}`} flexShrink={0}>
              {pill({ Box, Text }, nerd, THEME.surface3, (
                <Button key={`note-jump-${found.id}`} label={nerd ? MARK.open : ` ${MARK.open} `} plain hover={{ scope: `note-jump-box-${found.id}`, color: THEME.accent, inverse: true }} onPress={() => jump($, found.turn, found.promptId ?? '')} />
              ), `note-jump-box-${found.id}`, cardFill(), THEME.accent)}
            </Box>
          </Box>
        )
      }))

    // One row, always: Reword swaps the other two buttons for its three choices, so no button changes place with the note's text.
    // The expand standard: the arrow, then a muted label, on the card's own fill, at the action row's right end.
    const moreToggle = (found: Note, isFull: boolean) => {
      const label = isFull ? text.showLess : text.showAll
      const arrow = isFull ? look.glyph.less : look.glyph.more
      return <Client key={`headsup-more-${found.id}`} module="./entry.tsx" height={1} props={{ id: `headsup-more-${found.id}`, label, lead: arrow, leadColor: THEME.accent, isOpen: false, bg: cardFill(), idle: THEME.muted, nerd, still, tip: { glyph: arrow, label, text: isFull ? text.tipShowLess : text.tipShowAll } } satisfies EntryProps} />
    }

    const actionsBar = (found: Note, more: RenderElement | null) => {
      const isRewording = wording === found.id
      const reword = pill({ Box, Text }, nerd, THEME.surface3, <Client key={`headsup-reword-${found.id}`} module="./entry.tsx" height={1} props={{ id: `headsup-reword-${found.id}`, label: text.reword, isOpen: true, bg: THEME.surface3, nerd, still, isBusy: rewriting.endsWith(`-${found.id}`), spinner: rewriting.endsWith(`-${found.id}`), subLead: bare(look.glyph.cycle), tip: { glyph: bare(look.glyph.cycle), label: text.reword, text: text.tipReword } } satisfies EntryProps} />, `headsup-reword-${found.id}-pill`, cardFill())
      return (
        <Box key="headsup-actions" flexDirection="row" columnGap={1} flexShrink={0} marginTop={1}>
          {isRewording ? null : entryPill(`headsup-understood-${found.id}`, text.gotIt, bare(look.glyph.ok), { glyph: bare(look.glyph.ok), label: text.gotIt, text: text.tipGotIt })}
          {isRewording ? null : entryPill(`headsup-chat-${found.id}`, text.askClaude, bare(look.glyph.go), { glyph: bare(look.glyph.go), label: text.askClaude, text: text.tipAsk })}
          {reword}
          {isRewording ? pill({ Box, Text }, nerd, THEME.surface2, (
            <Box key={`redo-body-${found.id}`} flexDirection="row">
              {DIRECTIONS.map(([direction, label, tipBody]) => {
                const id = `headsup-redo-${direction}-${found.id}`
                return <Client key={id} module="./entry.tsx" height={1} props={{ id, label: ` ${label} `, isOpen: false, bg: THEME.surface2, idle: THEME.muted, nerd, still, isBusy: rewriting === `${direction}-${found.id}`, tip: { glyph: bare(look.glyph.cycle), label, text: tipBody } } satisfies EntryProps} />
              })}
            </Box>
          ), `redo-${found.id}`, cardFill()) : null}
          {more ? <Box key="headsup-more-gap" flexGrow={1} /> : null}
          {more}
        </Box>
      )
    }

    const opened = await openIds($)
    const ordered = byTurn(saved.notes).flatMap(group => group.notes)
    // The list reads oldest first; the card shows the last note the person picked, or the newest.
    const chronological = [...ordered].sort((a, b) => a.at - b.at)
    const selected = isCardClosed ? undefined : ([...opened].reverse().map(id => ordered.find(found => found.id === id)).find(Boolean) ?? chronological[chronological.length - 1])
    const checkedLine = await lastCheckLine($)
    // A Button posts no tip, so each jump pill's tip rides in the footer, shown through the pill's hover group.
    const jumpReveals: Reveal[] = chronological.map(found => ({ scope: `note-jump-box-${found.id}`, tip: { glyph: MARK.open, label: text.jumpLabel, text: text.tipJump } }))
    return (
      <Box flexDirection="column" backgroundColor={THEME.bg} paddingX={1} minHeight={e.props.scroll.bodyRows}>
        {tabRow({ Box, Client, Text }, nerd, tabs(false), still)}
        <Text wrap="truncate-end" color={statusColor(note)}>{withMark(look, note) || fill(text.hint, { sep: MARK.sep })}</Text>
        <Text wrap="truncate-end" color={THEME.muted}>{checkedLine}</Text>
        {selected ? noteCard(selected) : chronological.length === 0 ? <Text color={THEME.muted}>{text.empty}</Text> : null}
        {chronological.length > 0 ? timeline(chronological, selected) : null}
        <Box key="footer-space" height={FOOTER_ROWS} flexShrink={0} />
        {paneFooter(elements, paneTip, e.props.bodyColumns, e.props.scroll, jumpReveals)}
      </Box>
    )
  })
}

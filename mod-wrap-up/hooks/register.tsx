// mod-wrap-up / hooks/register.tsx, by v-amorim
// Registers the wrap-up pill, commands, settings pane and handoff or compact actions with the engine.
import type { ConfigValue, EngineInterface, ModelCompleteRequest, ModelCompleteResult, ModelForkResult, Register, RenderElement } from 'claude-code'

import { AUTO_SYSTEM, autoPrompt, capWords, clampCompactAt, clampCompactTokens, clampEvery, emptyLedger, flip, gatherFragments, isDue, ledgerMarkdown, MAX_PENDING, mergeDelta, mergeFragments, parseRelated, pendingCandidates, parseUpdate, readLedger, RELATED_SYSTEM, relatedPrompt, restoreContext, shortGoal, shouldCompact, yieldsToManual, countGates, type Carry, type CompactMarks, type Fragment, type GatesRun, type Ledger } from './ledger'
import { ALSO_KEEP, buildPrompt, LANGUAGE_RULE, clampWords, compactNote, FORK_FAILURES, isFresh, parseNames, parseThreads, scopeNote, threadsPrompt, THREADS_SYSTEM, transcriptText, type AlsoId, type Names, type Thread } from './handoff'
import { cardFill, detectNerd, FOOTER_ROWS, lookFor, paneFooter, sepText, titleEdge, type IconMode, withMark } from './look'
import { isTipMessage, tipText, type EntryMessage, type EntryProps, type Tip, type TipMessage } from './entry'
import { choiceCells, type ChoiceProps } from './choice'
import { labelsOf, PILL, pill, pillRow, splitRow, tabRow, tipLine } from './pills'
import { TOAST_MS, ToastList, toastCards } from './toasts'
import { actionReveals, openSetting, settingChoice, settingsBody, type Action, type Previews, type Range } from './settings'
import { recordSpend } from './spend'
import { bridgeOn, endBridge, startBridge, type BridgeRecord } from './bridge'
import { bytesOf, chunkArgv, scanTail } from './tail'
import text from './text'
import { lateNext, latestTitle, planNames, remember, type NamePlan } from './titles'
import style from './style'
import { fill, MARK, statusColor, THEME } from './theme'

const PANE = 'wrap-up'

// The settings (userConfig), fixed per activation: a change reloads the mod.
let iconMode: IconMode = 'auto'
let maxWords = clampWords(undefined)
let look = lookFor(false)

// The automatic handoff (opt-in, off by default), fixed per activation like the settings above.
let autoOn = false
let every = 1
let marks: CompactMarks = { percent: 65, tokens: 400_000 }
let compactOn = false

// Counters that reset on a compaction, a clear or a newer run; a result that finds them moved is stale and dropped.
let turnsSince = 0
let runId = 0
let epoch = 0
let cursor = 0
// A clear waits for the first prompt to decide; a compaction waits for the next one to carry the handoff.
let awaitFirst = false
let inject = false
let manualAt: number | null = null
// When the mod's own clear at the mark ran, so the first prompt after it never asks "related?".
let carriedAt: number | null = null
let ledgerPath = ''

// The countdown before the handoff at the mark; left is 0 while the ledger catches up.
type Countdown = { token: number; left: number; tokens: string; percent: number }
let countdown: Countdown | null = null
let countToken = 0

// The chain this process works on: the session id it started with, kept across /compact and a carried /clear.
let chain = ''
let clearedFrom = ''
// The first prompt after a clear was carried or started fresh; held is the other chain a switch brings back.
// link: the two sessions' own names and hops, and their topic, for the card's header; isFull: the cut goal shows in full.
type Link = Pick<NamePlan, 'oldOwn' | 'nextOwn' | 'topic' | 'oldHop' | 'nextHop'>
type Choice = { carry: Carry; goal: string; token: number; link: Link; isFull: boolean }
const NO_LINK: Link = { oldOwn: '', nextOwn: '', topic: '', oldHop: 0, nextHop: 0 }
let choice: Choice | null = null
let choiceToken = 0
let held: string | null = null

let working = false
let isRunning = false
let pickThreads = true
let note = ''

type Mode = 'handoff' | 'compact'
type NameId = 'this' | 'next'
const NAME_IDS: NameId[] = ['this', 'next']
const NO_NAMES: Names = { this: '', next: '', topic: '' }
// The card that picks what carries over; threads and names are null while Haiku still reads the session.
type Card = { mode: Mode; threads: Thread[] | null; kept: boolean[]; also: Record<AlsoId, boolean>; names: Names | null; hops: { old: number; next: number }; useNames: Record<NameId, boolean>; token: number }

let card: Card | null = null
// The choices card a pill cut to its icon opens above the row.
let isMenuOpen = false
let cardToken = 0
let actions: Action[] = []
let previews: Previews | undefined
let fields: Record<string, Range> | undefined

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

const isOpen = async ($: EngineInterface) => (await $.ui.panes()).some(pane => pane.id === PANE && pane.isPlaced)

// `/mod-wrap-up settings` toggles the panel. An unplaced pane is waiting, not open.
async function togglePane($: EngineInterface) {
  if (await isOpen($)) {
    await $.ui.close({ id: PANE })
    await $.state.set({ plugin: 'mod-wrap-up', key: 'pane' }, false)
    return
  }
  note = ''
  const showcase = await $.fs.read(`${$.plugin.root}/showcase.json`).then(text => JSON.parse(String(text))).catch(() => null)
  previews = showcase?.previews
  fields = await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`).then(text => JSON.parse(String(text)).userConfig).catch(() => undefined)
  actions = (Array.isArray(showcase?.actions) ? showcase.actions : []).map((action: Action) => ({ ...action, isLocal: action.command === 'mod-wrap-up' }))
  const opened = await $.ui.open({ id: PANE, title: text.paneName, closeOnEscape: true })
  if (!opened.isPlaced) $.ui.toast(fill(text.settingsWaiting, { reason: opened.reason }))
  await $.state.set({ plugin: 'mod-wrap-up', key: 'pane' }, opened.isPlaced)
}

// The pane shows the last outcome; a failure is a toast, since a long line in the pill row wraps and breaks it.
function say($: EngineInterface, line: string) {
  note = line
  if (line.startsWith(MARK.warn)) $.ui.toast(line.slice(MARK.warn.length).trim())
  $.ui.invalidate('ui.render')
}

// Puts the waiting handoff into the fresh prompt. It stays in the store until a fill lands, so a late call is harmless.
async function fillPending($: EngineInterface) {
  const pending = await $.store.get('pending')
  if (!isFresh(pending, await $.clock.now())) return false
  const filled = await $.prompt.fill({ text: pending.text, mode: 'replace' })
  if (!filled.isFilled) return false
  await $.store.delete('pending')
  say($, `${MARK.ok} ${text.filledIn}`)
  return true
}

// Never throws: a failed read or fill counts as "not filled", so a timer or a command never fails on it.
async function fillWithRetry($: EngineInterface) {
  try {
    for (let tries = 0; tries < 10; tries++) {
      if (await fillPending($)) return true
      if (!isFresh(await $.store.get('pending'), await $.clock.now())) return false
      await $.clock.sleep(200)
    }
  } catch {
    // The handoff stays in the store, so a later fill can still land.
  }
  return false
}

async function isPendingLeft($: EngineInterface) {
  try {
    return isFresh(await $.store.get('pending'), await $.clock.now())
  } catch {
    return true
  }
}

// Haiku splits the session into threads the card can keep or drop and names both sessions; none when it fails or finds nothing to choose between.
async function readSession($: EngineInterface): Promise<{ threads: Thread[]; names: Names }> {
  const messages = await $.session.messages().catch(() => [])
  if (!Array.isArray(messages) || messages.length === 0) return { threads: [], names: NO_NAMES }
  const reply = await $.model.complete({ model: 'haiku', system: THREADS_SYSTEM, prompt: threadsPrompt(transcriptText(messages, 150_000)), maxTokens: 600, timeoutMs: 30000 }).catch(() => null)
  recordSpend($, 'haiku', reply)
  return reply?.isAnswered ? { threads: parseThreads(reply.text), names: parseNames(reply.text) } : { threads: [], names: NO_NAMES }
}

const defaultAlso = () => Object.fromEntries(ALSO_KEEP.map(item => [item.id, item.isKept])) as Record<AlsoId, boolean>

// Either choice opens the card; the other one switches its mode and keeps what was picked.
function openCard($: EngineInterface, mode: Mode) {
  if (card) {
    card = { ...card, mode }
    $.ui.invalidate('ui.render')
    return
  }
  const token = (cardToken += 1)
  card = { mode, threads: pickThreads ? null : [], kept: [], also: defaultAlso(), names: null, hops: { old: 0, next: 0 }, useNames: { this: true, next: true }, token }
  $.ui.invalidate('ui.render')
  void readSession($).then(async ({ threads, names }) => {
    // The card shows the topic and hops the rename will use, planned the same way the handoff plans them.
    const id = await $.session.id().catch(() => '')
    const dir = autoOn ? await ledgerDir($) : ''
    const ledger = dir ? await loadLedger($, dir) : null
    const plan = planNames(await titleOf($, id), await appliedTitles($), names, ledger ? placeIn(ledger, id) : 1)
    if (card?.token !== token) return
    card = { ...card, names: { ...names, topic: plan.topic }, hops: { old: plan.oldHop, next: plan.nextHop }, ...(pickThreads ? { threads, kept: threads.map(() => true) } : {}) }
    $.ui.invalidate('ui.render')
  })
}

function closeCard($: EngineInterface) {
  card = null
  bandTip = null
  cardToken += 1
  $.ui.invalidate('ui.render')
}

function toggleLine($: EngineInterface, id: string) {
  if (!card) return
  const thread = /^wrap-up-thread-(\d+)$/.exec(id)
  if (thread) card = { ...card, kept: card.kept.map((isKept, at) => (at === Number(thread[1]) ? !isKept : isKept)) }
  const also = ALSO_KEEP.find(item => id === `wrap-up-also-${item.id}`)
  if (also) card = { ...card, also: { ...card.also, [also.id]: !card.also[also.id] } }
  const name = NAME_IDS.find(each => id === `wrap-up-name-${each}`)
  if (name) card = { ...card, useNames: { ...card.useNames, [name]: !card.useNames[name] } }
  $.ui.invalidate('ui.render')
}

const keptThreads = (picked: Card) => (picked.threads ?? []).filter((_, at) => picked.kept[at])

const chosenNames = (picked: Card): Names => ({ this: picked.useNames.this ? (picked.names?.this ?? '') : '', next: picked.useNames.next ? (picked.names?.next ?? '') : '', topic: picked.names?.topic ?? '' })

// The card's go: Compact fills /compact with the picks for review, Handoff writes, clears and fills the handoff.
async function finishCard($: EngineInterface) {
  if (!card) return
  const picked = card
  closeCard($)
  if (picked.mode === 'handoff') {
    await startHandoff($, scopeNote(picked.threads ?? [], keptThreads(picked), picked.also), chosenNames(picked))
    return
  }
  const instructions = compactNote(picked.threads ?? [], keptThreads(picked), picked.also, autoOn ? await ledgerFile($) : '')
  const filled = await $.prompt.fill({ text: instructions ? `/compact ${instructions}` : '/compact', mode: 'replace' })
  say($, filled.isFilled ? `${MARK.ok} ${text.compactFilled}` : `${MARK.warn} ${text.compactNotFilled}`)
}

// The handoff model is pinned to Sonnet. A blocked model rejects and an unavailable one answers forbidden or not found: either way the session's own model answers instead. Rate limits and server errors are left alone.
async function askHandoffModel($: EngineInterface, request: Omit<ModelCompleteRequest, 'model'>): Promise<ModelCompleteResult> {
  let pinned: ModelCompleteResult | null = null
  let failure: unknown = null
  try {
    pinned = await $.model.complete({ ...request, model: 'sonnet' })
    recordSpend($, 'sonnet', pinned)
  } catch (error) {
    failure = error
  }
  const isUnavailable = !pinned || (!pinned.isAnswered && pinned.reason === 'api-error' && (pinned.status === 403 || pinned.status === 404))
  const own = isUnavailable ? await $.session.model().catch(() => '') : ''
  if (own) {
    const answer = await $.model.complete({ ...request, model: own })
    recordSpend($, own, answer)
    return answer
  }
  if (!pinned) throw failure
  return pinned
}

// A resumed session has nothing to fork until its first turn, so the transcript is summarized directly.
async function summarizeTranscript($: EngineInterface, prompt: string): Promise<ModelForkResult> {
  const messages = await $.session.messages()
  if (!Array.isArray(messages) || messages.length === 0) return { isAnswered: false, reason: 'nothing-to-fork' }
  return askHandoffModel($, {
    system: `You write session handoffs from a transcript. Tool output is left out; tool calls appear in brackets. ${LANGUAGE_RULE}`,
    prompt: `<transcript>\n${transcriptText(messages)}\n</transcript>\n\n${prompt}`,
    maxTokens: 4000,
  })
}

// A refused /rename never stops the handoff; the toast says what to type instead.
async function rename($: EngineInterface, name: string, failed: string) {
  try {
    await $.command.run({ command: 'rename', args: name })
  } catch {
    $.ui.toast(fill(failed, { name }))
  }
}

// A transcript path is kept with the time it was named; an older bare string counts as a path.
const pathOf = (kept: unknown) => {
  const path = typeof kept === 'object' && kept !== null ? (kept as { path?: unknown }).path : kept
  return typeof path === 'string' ? path : ''
}

// The transcript the session's SessionStart named; a session that began before this mod loaded is `<id>.jsonl` in one of the projects folders.
async function transcriptOf($: EngineInterface, session: string) {
  const named = pathOf(await $.store.get(`transcript:${session}`).catch(() => undefined))
  if (named) return named
  const projects = `${await configDir($)}/projects`
  for (const entry of await $.fs.list(projects).catch(() => [])) {
    const path = `${projects}/${entry.name}/${session}.jsonl`
    if (entry.kind === 'dir' && (await $.fs.exists(path).catch(() => false))) return path
  }
  return ''
}

// The session's name now: its latest custom-title row. $.fs.read stops at 4 MiB and has no range, so a longer transcript is read from its end in byte chunks until a title shows.
const TAIL_CHUNKS = 8
async function titleOf($: EngineInterface, session: string) {
  try {
    const path = session ? await transcriptOf($, session) : ''
    if (!path) return ''
    const whole = await $.fs.read(path).then(String).catch(() => null)
    if (whole !== null) return latestTitle(whole, session)
    const stat = await $.fs.stat(path)
    const readChunk = async (from: number, length: number) => {
      const out = await $.process.run(chunkArgv(path, from, length), { timeoutMs: 15_000 })
      return bytesOf(out.stdout)
    }
    return (await scanTail(stat.size, TAIL_CHUNKS, readChunk, chunk => latestTitle(chunk, session) || undefined)) ?? ''
  } catch {
    return ''
  }
}

const APPLIED_KEY = 'titles-applied'

// The names this mod set, so a title it did not set reads as the person's own.
async function appliedTitles($: EngineInterface) {
  const kept = await $.store.get(APPLIED_KEY).catch(() => undefined)
  return Array.isArray(kept) ? kept.filter((title): title is string => typeof title === 'string') : []
}

async function keepApplied($: EngineInterface, titles: string[]) {
  if (titles.some(Boolean)) await $.store.set(APPLIED_KEY, remember(await appliedTitles($), titles)).catch(() => {})
}

// What a handoff names the session it leaves and the fresh one, read from the leaving session's own title.
async function planOf($: EngineInterface, names: Names, ledger: Ledger | null): Promise<NamePlan> {
  const id = await $.session.id().catch(() => '')
  const plan = planNames(await titleOf($, id), await appliedTitles($), names, ledger ? placeIn(ledger, id) : 1)
  await keepApplied($, [plan.old, plan.next])
  return plan
}

// Summarize through a hidden fork, run /clear, fill the handoff into the new prompt. Nothing is sent. scope is what the card dropped.
async function startHandoff($: EngineInterface, scope: string, names: Names = NO_NAMES) {
  if (isRunning) return
  if (working) {
    say($, `${MARK.warn} ${text.claudeWorking}`)
    return
  }
  isRunning = true
  try {
    $.ui.invalidate('ui.render')
    say($, text.writing)
    const skill = await $.fs.read(`${$.plugin.root}/skills/session-handoff/SKILL.md`).then(String)
    const base = buildPrompt(skill, maxWords, autoOn ? await ledgerFile($) : '')
    const prompt = scope ? `${base}\n\n${scope}` : base
    let result = await $.model.fork({ prompt })
    recordSpend($, await $.session.model().catch(() => ''), result.isAnswered ? result : null)
    if (!result.isAnswered && result.reason === 'nothing-to-fork') result = await summarizeTranscript($, prompt)
    if (!result.isAnswered) {
      say($, `${MARK.warn} ${FORK_FAILURES[result.reason] ?? result.reason}`)
      return
    }
    const summary = result.text.trim()
    if (!summary) {
      say($, `${MARK.warn} ${FORK_FAILURES['empty-reply']}`)
      return
    }
    if (working) {
      say($, `${MARK.warn} ${text.startedWorking}`)
      return
    }
    const dir = autoOn ? await ledgerDir($) : ''
    const plan = await planOf($, names, dir ? await loadLedger($, dir) : null)
    if (plan.old) await rename($, plan.old, text.renameOldFailed)
    manualAt = await $.clock.now()
    await $.store.set('pending', { text: summary, at: manualAt })
    try {
      await $.command.run({ command: 'clear' })
    } catch {
      // The person can run /clear themselves; session.end then fills the handoff.
      await $.prompt.fill({ text: '/clear', mode: 'replace' })
      say($, `${MARK.warn} ${text.clearFailed}`)
      return
    }
    if (plan.next) await rename($, plan.next, text.renameFailed)
    // A /clear can reach session.end first, which fills the prompt itself: warn only when the handoff is still waiting.
    if (!(await fillWithRetry($)) && (await isPendingLeft($))) say($, `${MARK.warn} ${text.clearedNotFilled}`)
  } catch (error) {
    say($, `${MARK.warn} ${String(error)}`)
  } finally {
    isRunning = false
    $.ui.invalidate('ui.render')
  }
}

// What `/mod-wrap-up <args>` does; the panel's action calls it directly, since $.command.run skips the calling plugin.
async function answer($: EngineInterface, args: string) {
  if (args.trim() === 'settings') {
    await togglePane($)
    return ''
  }
  openCard($, args.trim() === 'compact' ? 'compact' : 'handoff')
  return text.cardOpened
}

// Claude Code's config folder: CLAUDE_CONFIG_DIR when set, else ~/.claude; empty when the home folder is unknown.
async function configDir($: EngineInterface) {
  const set = ((await $.env.get('CLAUDE_CONFIG_DIR')) ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
  if (set) return set
  const home = ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '').replace(/\\/g, '/')
  return home ? `${home}/.claude` : ''
}

// One folder for every chain, with no cwd in the path, so a chain keeps one ledger wherever the session's folder moves; empty when the config folder is unknown.
async function ledgerDir($: EngineInterface) {
  try {
    const config = await configDir($)
    if (!config) return ''
    const dir = `${config}/mods-data/mod-wrap-up/chains`
    // A reload mid-session forgets the chain; the ledger that lists this session or the one before a clear still names it.
    if (!chain) {
      const id = await $.session.id()
      chain = (await chainFor($, dir, [id, clearedFrom])) ?? id
    }
    return dir
  } catch {
    return ''
  }
}

async function ledgerFile($: EngineInterface) {
  const dir = await ledgerDir($)
  if (dir) ledgerPath = mdOf(dir)
  return ledgerPath
}

// One file per chain, so sessions never read or write each other's ledger.
const fileOf = (dir: string, of = chain) => `${dir}/${of}.json`

const loadLedger = async ($: EngineInterface, dir: string, of = chain) => readLedger(await $.fs.read(fileOf(dir, of)).then(String).catch(() => ''))

// The markdown twin is what the model reads; the JSON stays the source of truth for merging.
const mdOf = (dir: string, of = chain) => fileOf(dir, of).replace(/\.json$/, '.md')

async function saveLedger($: EngineInterface, dir: string, ledger: Ledger, of = chain) {
  await $.fs.write(fileOf(dir, of), JSON.stringify(ledger, null, 1))
  await $.fs.write(mdOf(dir, of), ledgerMarkdown(ledger))
  if (of === chain) await publishPending($, ledger)
}

// The paths the chain's open tasks and decisions in force name, for mod-blast-radius to read; a bare folder-like path counts only when it exists.
const MAYBE_CAP = 300

async function publishPending($: EngineInterface, ledger: Ledger | null) {
  try {
    const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
    const { sure, maybe } = pendingCandidates(ledger, home)
    const found = [...sure]
    for (const path of maybe.slice(0, MAYBE_CAP)) {
      if (await $.fs.stat(path).then(() => true, () => false)) found.push(path)
    }
    await $.state.set({ plugin: 'mod-wrap-up', key: 'pending' }, found.slice(0, MAX_PENDING))
  } catch {
    // Without the list the other mod sees no state and keeps its own checks.
  }
}

const withSession = (ledger: Ledger, id: string) => ({ ...ledger, sessions: ledger.sessions.includes(id) ? ledger.sessions : [...ledger.sessions, id] })

// A session's 1-based place in its chain, the hop its name gets when its title carries none.
const placeIn = (ledger: Ledger, id: string) => ledger.sessions.indexOf(id) + 1 || ledger.sessions.length || 1

// The chain's gates runs with open boxes, under <GATES_HOME or ~/.claude/gates>/<repo>/<session>; `skip` is a session that already owns its run.
async function unfinishedRuns($: EngineInterface, ledger: Ledger, skip = ''): Promise<GatesRun[]> {
  try {
    const home = ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '').replace(/\\/g, '/')
    const base = ((await $.env.get('GATES_HOME')) ?? `${home}/.claude/gates`).replace(/\\/g, '/')
    const repos = (await $.fs.list(base).catch(() => [])).filter(entry => entry.kind === 'dir')
    const runs: GatesRun[] = []
    for (const repo of repos) {
      for (const session of ledger.sessions.filter(id => id && id !== skip)) {
        const dir = `${base}/${repo.name}/${session}`
        const leaves = (await $.fs.list(`${dir}/gates`).catch(() => [])).filter(entry => entry.kind === 'file' && entry.name.toLowerCase().endsWith('.md'))
        const files = [`${dir}/GATES.md`, ...leaves.map(entry => `${dir}/gates/${entry.name}`)]
        const counts = await Promise.all(files.map(file => $.fs.read(file).then(body => countGates(String(body)), () => ({ open: 0, total: 0 }))))
        const open = counts.reduce((sum, count) => sum + count.open, 0)
        if (open > 0) runs.push({ session, dir, open, total: counts.reduce((sum, count) => sum + count.total, 0) })
      }
    }
    return runs
  } catch {
    return []
  }
}

// A resumed session's chain is the ledger that already lists it.
async function chainOf($: EngineInterface, dir: string, id: string) {
  const entries = await $.fs.list(dir).catch(() => [])
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
    const of = entry.name.slice(0, -'.json'.length)
    if ((await loadLedger($, dir, of))?.sessions.includes(id)) return of
  }
  return undefined
}

// Every per-folder ledger an older version left under `<slug>/ledgers/`; read only, never edited.
async function oldFragments($: EngineInterface, dir: string) {
  const root = dir.replace(/\/chains$/, '')
  const found: Fragment[] = []
  for (const folder of await $.fs.list(root).catch(() => [])) {
    if (folder.kind !== 'dir' || folder.name === 'chains') continue
    for (const entry of await $.fs.list(`${root}/${folder.name}/ledgers`).catch(() => [])) {
      if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
      const ledger = readLedger(await $.fs.read(`${root}/${folder.name}/ledgers/${entry.name}`).then(String).catch(() => ''))
      if (ledger) found.push({ chain: entry.name.slice(0, -'.json'.length), ledger })
    }
  }
  return found
}

// The chain of any of these sessions: the ledger in chains/ that lists one, else the old per-folder fragments merged into a new chains/ file.
async function chainFor($: EngineInterface, dir: string, ids: string[]) {
  for (const id of ids.filter(Boolean)) {
    const of = await chainOf($, dir, id)
    if (of) return of
  }
  const gathered = gatherFragments(await oldFragments($, dir), ids)
  if (!gathered) return undefined
  // A chains/ file of that name that does not list the session is merged in, never overwritten.
  const existing = await loadLedger($, dir, gathered.chain)
  const merged = mergeFragments(existing ? [existing, ...gathered.fragments] : gathered.fragments)
  await saveLedger($, dir, merged, gathered.chain)
  return gathered.chain
}

// A startup starts its own chain; a resume (the transcript has messages) picks its chain back up, and so does a reload, whose transcript can read empty.
async function openLedger($: EngineInterface) {
  const dir = await ledgerDir($)
  if (!dir) return
  const id = await $.session.id()
  const messages = await $.session.messages().catch(() => [])
  const isResume = Array.isArray(messages) && messages.length > 0
  chain = (await chainOf($, dir, id)) ?? (isResume ? await chainFor($, dir, [id]) : undefined) ?? id
  const existing = await loadLedger($, dir)
  if (existing) await publishPending($, existing)
  else await saveLedger($, dir, emptyLedger(await $.clock.now(), id))
  await ledgerFile($)
}

let isReplaying = false

// A compaction finished: the next update reads only what follows the summary, a run still going is stale, and the next prompt carries the handoff.
async function compactionDone($: EngineInterface) {
  if (!autoOn) return
  const messages = await $.session.messages().catch(() => [])
  cursor = Array.isArray(messages) ? messages.length : 0
  epoch += 1
  runId += 1
  inject = true
}

// The SessionStart record names the transcript, which the store keeps per session; source "compact" marks a finished compaction.
async function sessionStarted($: EngineInterface, record: BridgeRecord) {
  const session = String(record.session_id ?? '')
  const path = String(record.transcript_path ?? '')
  if (session && path) await $.store.set(`transcript:${session}`, { path, at: await $.clock.now() }).catch(() => {})
  if (record.source === 'compact' && !isReplaying) await compactionDone($)
  if (record.source === 'resume' && session && autoOn) await rejoinChain($, session)
}

// `claude --resume` starts under a fresh id and switches to the resumed one after openLedger already ran, so the resumed id picks the chain again.
async function rejoinChain($: EngineInterface, session: string) {
  const dir = await ledgerDir($)
  if (!dir) return
  const found = (await chainOf($, dir, session)) ?? (await chainFor($, dir, [session]))
  if (found && found !== chain) {
    chain = found
    await ledgerFile($)
  }
}

const COUNTDOWN_S = 5

// Between turns past the mark, a countdown card above the prompt; its end hands off. Cancel, a draft or a new turn stops it.
async function startCountdown($: EngineInterface) {
  if (!autoOn || !compactOn || working || countdown || isRunning) return
  const { context } = await $.session.usage()
  if (!shouldCompact(context ?? {}, marks)) return
  if (working || countdown || (await hasDraft($))) return
  const token = (countToken += 1)
  countdown = { token, left: COUNTDOWN_S, tokens: `${Math.round((context.tokens ?? 0) / 1000)}K`, percent: Math.round(context.percent ?? 0) }
  $.ui.invalidate('ui.render')
  tickCountdown($, token)
}

function stopCountdown($: EngineInterface) {
  countdown = null
  countToken += 1
  $.ui.invalidate('ui.render')
}

const hasDraft = async ($: EngineInterface) => ((await $.prompt.read().catch(() => ({ text: '' }))).text ?? '').trim() !== ''

function tickCountdown($: EngineInterface, token: number) {
  $.clock.after(1000, async () => {
    if (countdown?.token !== token) return
    if (await hasDraft($)) {
      if (countdown?.token === token) stopCountdown($)
      return
    }
    if (countdown?.token !== token) return
    countdown = { ...countdown, left: countdown.left - 1 }
    $.ui.invalidate('ui.render')
    if (countdown.left > 0) tickCountdown($, token)
    else await handOffAtMark($, token)
  })
}

// The countdown ran out: bring the ledger up to date, clear keeping the chain, then continue the open task or fill the handoff.
async function handOffAtMark($: EngineInterface, token: number) {
  const isLive = () => countdown?.token === token
  try {
    const messages = await $.session.messages().catch(() => [])
    if (Array.isArray(messages) && messages.length > cursor) await runAuto($)
    if (!isLive()) return
    if (working || (await hasDraft($))) {
      stopCountdown($)
      return
    }
    const dir = await ledgerDir($)
    const ledger = dir ? await loadLedger($, dir) : null
    if (!dir || !ledger?.handoff) {
      stopCountdown($)
      $.ui.toast(text.auto.noHandoff)
      return
    }
    // Read before the clear, so this session's own run counts: the session after the clear has a new id.
    const carried = restoreContext(ledger, mdOf(dir), undefined, await unfinishedRuns($, ledger))
    const hasOpenTask = ledger.tasks.some(task => task.status === 'open')
    stopCountdown($)
    carriedAt = await $.clock.now()
    if (!hasOpenTask) await $.store.set('pending', { text: carried, at: carriedAt })
    const plan = await planOf($, ledger.names, ledger)
    if (plan.old) await rename($, plan.old, text.renameOldFailed)
    try {
      await $.command.run({ command: 'clear' })
    } catch {
      carriedAt = null
      await $.store.delete('pending')
      $.ui.toast(text.auto.clearFailed)
      return
    }
    if (plan.next) await rename($, plan.next, text.renameFailed)
    await saveLedger($, dir, withSession(ledger, await $.session.id()))
    showChoice($, 'carried', ledger.goal, plan)
    if (hasOpenTask) await $.prompt.submit({ text: `${text.auto.continue}\n\n${carried}` })
    else if (!(await fillWithRetry($))) $.ui.toast(text.clearedNotFilled)
  } catch {
    if (isLive()) stopCountdown($)
  }
}

async function runAuto($: EngineInterface) {
  if (!autoOn || isRunning) return
  const mine = (runId += 1)
  const mineEpoch = epoch
  try {
    const dir = await ledgerDir($)
    if (!dir) return
    const ledger = (await loadLedger($, dir)) ?? emptyLedger(await $.clock.now(), await $.session.id())
    const messages = await $.session.messages()
    const turns = Array.isArray(messages) && cursor > 0 && cursor <= messages.length ? messages.slice(cursor) : messages
    if (!Array.isArray(turns) || turns.length === 0) return
    const skill = await $.fs.read(`${$.plugin.root}/skills/session-handoff/SKILL.md`).then(String)
    const reply = await askHandoffModel($, { effort: 'low', system: AUTO_SYSTEM, prompt: autoPrompt(skill, maxWords, ledger, transcriptText(turns, 150_000)), maxTokens: 4000, timeoutMs: 180_000 }).catch(() => null)
    if (mine !== runId || mineEpoch !== epoch || !reply?.isAnswered) return
    const update = parseUpdate(reply.text)
    if (!update) return
    const now = await $.clock.now()
    // A reply with no usable names keeps the last good pair rather than wiping it, and the chain keeps the first topic it was given.
    const names = { ...(update.names.this || update.names.next ? update.names : ledger.names), topic: ledger.names.topic || update.names.topic }
    await saveLedger($, dir, { ...mergeDelta(ledger, update.delta, now), handoff: capWords(update.handoff, maxWords), handoffAt: now, names })
    cursor = messages.length
  } catch {
    // A background update never shows an error; the next turn tries again.
  }
}

async function restoreFrom($: EngineInterface) {
  const dir = await ledgerDir($)
  const ledger = dir ? await loadLedger($, dir) : null
  return ledger?.handoff ? restoreContext(ledger, mdOf(dir), undefined, await unfinishedRuns($, ledger, await $.session.id())) : ''
}

function showChoice($: EngineInterface, carry: Carry, goal: string, link: Link = NO_LINK) {
  const token = (choiceToken += 1)
  choice = { carry, goal, token, link, isFull: false }
  $.clock.after(120_000, () => {
    if (choice?.token !== token) return
    choice = null
    $.ui.invalidate('ui.render')
  })
  $.ui.invalidate('ui.render')
}

// The first prompt after a clear: related work keeps the ledger and carries the handoff, unrelated work archives it and starts a new one.
async function decideAfterClear($: EngineInterface, prompt: string) {
  const dir = await ledgerDir($)
  const ledger = dir ? await loadLedger($, dir) : null
  if (!dir || !ledger || !(ledger.handoff || ledger.goal)) return ''
  const reply = await askHandoffModel($, { effort: 'low', system: RELATED_SYSTEM, prompt: relatedPrompt(ledger.goal, ledger.handoff, prompt), maxTokens: 100, timeoutMs: 20_000 }).catch(() => null)
  const id = await $.session.id()
  // Only a clear "related" carries the old handoff; an unsure answer starts fresh.
  if (reply?.isAnswered && parseRelated(reply.text)) {
    await saveLedger($, dir, withSession(ledger, id))
    // Only the fresh session can take a name, and a /rename run inside this prompt.submit is refused, so it waits.
    const plan = lateNext(await titleOf($, clearedFrom), await appliedTitles($), ledger.names, placeIn(ledger, clearedFrom))
    await keepApplied($, [plan.next])
    if (plan.next) $.clock.after(0, () => void rename($, plan.next, text.renameFailed))
    showChoice($, 'carried', ledger.goal, plan)
    return ledger.handoff ? restoreContext(ledger, mdOf(dir), undefined, await unfinishedRuns($, ledger, id)) : ''
  }
  held = chain
  chain = id
  await saveLedger($, dir, emptyLedger(await $.clock.now(), id))
  showChoice($, 'fresh', ledger.goal)
  return ''
}

// What a prompt carries beside its text: the post-clear decision once, or the handoff once after a compaction.
async function promptContext($: EngineInterface, prompt: string) {
  if (awaitFirst) {
    // A slash command is not the work the person is starting.
    if (prompt.trimStart().startsWith('/')) return ''
    awaitFirst = false
    return decideAfterClear($, prompt)
  }
  if (!inject) return ''
  inject = false
  return restoreFrom($)
}

// The card's switch: leave the carried chain for one of this session's own, or go back to the chain left behind. Neither file is touched beyond who it lists.
async function flipChoice($: EngineInterface) {
  if (!choice) return
  const dir = await ledgerDir($)
  if (!dir) return
  const id = await $.session.id()
  const carry = flip(choice.carry)
  if (carry === 'fresh') {
    const left = await loadLedger($, dir)
    if (left) await saveLedger($, dir, { ...left, sessions: left.sessions.filter(item => item !== id) })
    held = chain
    chain = id
    if (!(await loadLedger($, dir))) await saveLedger($, dir, emptyLedger(await $.clock.now(), id))
    cursor = 0
  } else {
    if (!held) return
    const back = await loadLedger($, dir, held)
    if (!back) return
    ;[chain, held] = [held, chain]
    await saveLedger($, dir, withSession(back, id))
    inject = true
  }
  runId += 1
  epoch += 1
  showChoice($, carry, choice.goal, choice.link)
}

type Elements = { Box: (props: any) => RenderElement; Client: (props: any) => RenderElement; Text: (props: any) => RenderElement }

const bare = (glyph: string) => glyph.replace(/[[\]\s]/g, '')

// The pill cut to its icon opens its choices here: one pill of the three side by side, then a × pill, right-aligned over the row.
function menuCard({ Box, Client, Text }: Elements, options: { id: string; label: string; tip: Tip }[], isIdle: boolean) {
  const bg = THEME.surface3
  const entry = (id: string, label: string, isOpen: boolean, tip: Tip) =>
    <Client key={id} module="./entry.tsx" height={1} props={{ id, label, isOpen, bg, nerd: look.nerd, still, idle: THEME.muted, tip } satisfies EntryProps} />
  const entries = options.flatMap((option, at) => [
    ...(at === 0 ? [] : [<Client key={`wrap-up-menu-rail-${at}`} module="./entry.tsx" height={1} props={{ id: `wrap-up-menu-rail-${at}`, label: '', isOpen: false, bg, rail: true } satisfies EntryProps} />]),
    entry(option.id, option.label, isIdle, option.tip),
  ])
  const close = bare(look.glyph.close)
  return (
    <Box key="wrap-up-menu-row" flexDirection="row" justifyContent="flex-end">
      <Box key="wrap-up-menu" flexDirection="row" columnGap={1} paddingX={1} borderStyle="round" borderColor={THEME.border} backgroundColor={cardFill()}>
        {pill({ Box, Text }, look.nerd, bg, entries, 'wrap-up-menu-group', cardFill())}
        {pill({ Box, Text }, look.nerd, bg, entry('wrap-up-menu-close', close, false, { glyph: close, label: text.menu.close, text: text.menu.tipClose }), 'wrap-up-menu-close-pill', cardFill())}
      </Box>
    </Box>
  )
}

function cardBox({ Box, Client, Text }: Elements, picked: Card) {
  const widest = (labels: string[]) => Math.max(0, ...labels.map(label => [...label].length))
  const line = (id: string, label: string, isKept: boolean, tip: string, width = 0) => {
    const bg = isKept ? THEME.surface3 : THEME.surface2
    const mark = isKept ? MARK.stopOpen : MARK.stop
    return pill({ Box, Text }, look.nerd, bg, <Client key={id} module="./entry.tsx" height={1} props={{ id, label: label.padEnd(width), isOpen: isKept, bg, nerd: look.nerd, still, idle: THEME.muted, subLead: mark, subLeadColor: isKept ? THEME.accent : THEME.muted, tip: { glyph: mark, label, text: tip } } satisfies EntryProps} />, `${id}-pill`, cardFill())
  }
  const action = (id: string, label: string, lead: Pick<EntryProps, 'subLead'>, tip: string) => (
    pill({ Box, Text }, look.nerd, THEME.surface3, <Client key={id} module="./entry.tsx" height={1} props={{ id, label, isOpen: true, bg: THEME.surface3, nerd: look.nerd, still, tip: { glyph: lead.subLead ?? bare(look.glyph.close), label, text: tip }, ...lead } satisfies EntryProps} />, `${id}-pill`, cardFill())
  )
  // A group inside the card: its name in dim caps over its lines, as in the web's section headers.
  const block = (key: string, title: string, body: unknown) => (
    <Box key={key} flexDirection="column" marginTop={1}>
      <Box key={`${key}-head-pad`} paddingLeft={1}>
        <Text key={`${key}-head`} color={style.colors.pills.readout}>{title.toUpperCase()}</Text>
      </Box>
      {body}
    </Box>
  )
  const threads = picked.threads === null
    ? <Client key="wrap-up-reading" module="./entry.tsx" height={1} props={{ id: 'wrap-up-reading', label: text.card.reading, isOpen: false, bg: cardFill(), isBusy: true, spinner: true, still } satisfies EntryProps} />
    : picked.threads.length === 0
      ? <Text key="wrap-up-none" color={THEME.muted}>{text.card.noThreads}</Text>
      : picked.threads.map((thread, at, all) => (
          <Box key={`wrap-up-thread-row-${at}`} flexDirection="row">
            <Box key={`wrap-up-thread-pad-${at}`} flexShrink={0}>{line(`wrap-up-thread-${at}`, thread.label, picked.kept[at] === true, text.tips.thread, widest(all.map(each => each.label)))}</Box>
            {sepText({ Text }, `${MARK.sep} ${thread.detail}`, THEME.muted, `wrap-up-thread-detail-${at}`, { wrap: "truncate-end" })}
          </Box>
        ))
  const hopPill = (key: string, hop: number) => pill({ Box, Text }, look.nerd, THEME.surface3, <Text key={`${key}-text`} color={THEME.secondary}>{look.nerd ? `#${hop}` : ` #${hop} `}</Text>, key, cardFill())
  const shownNames = picked.names
  const names = shownNames === null
    ? <Client key="wrap-up-names-reading" module="./entry.tsx" height={1} props={{ id: 'wrap-up-names-reading', label: text.card.reading, isOpen: false, bg: cardFill(), isBusy: true, spinner: true, still } satisfies EntryProps} />
    : !shownNames.this && !shownNames.next
      ? <Text key="wrap-up-names-none" color={THEME.muted}>{text.card.noNames}</Text>
      : [
          ...(shownNames.topic ? [
            <Box key="wrap-up-name-row-topic" flexDirection="row" paddingLeft={1}>
              <Text key="wrap-up-name-topic" color={THEME.accent} bold>{`${shownNames.topic} `}</Text>
              {picked.hops.old > 0 ? [
                hopPill('wrap-up-name-hop-old', picked.hops.old),
                <Text key="wrap-up-name-hop-arrow" color={THEME.muted}>{` ${text.link} `}</Text>,
                hopPill('wrap-up-name-hop-next', picked.hops.next),
                <Text key="wrap-up-name-hop-gap"> </Text>,
              ] : null}
              {sepText({ Text }, `${MARK.sep} ${text.card.topic}`, THEME.muted, 'wrap-up-name-detail-topic', { wrap: "truncate-end" })}
            </Box>,
          ] : []),
          ...NAME_IDS.filter(id => shownNames[id]).map((id, _at, ids) => (
            <Box key={`wrap-up-name-row-${id}`} flexDirection="row">
              <Box key={`wrap-up-name-pad-${id}`} flexShrink={0}>{line(`wrap-up-name-${id}`, shownNames[id], picked.useNames[id], text.tips.name[id], widest(ids.map(each => shownNames[each])))}</Box>
              {sepText({ Text }, `${MARK.sep} ${text.card.name[id]}`, THEME.muted, `wrap-up-name-detail-${id}`, { wrap: "truncate-end" })}
            </Box>
          )),
        ]
  const instructions = compactNote(picked.threads ?? [], keptThreads(picked), picked.also, autoOn ? ledgerPath : '')
  const foot = picked.mode === 'compact' ? (
    <Box key="wrap-up-foot" flexDirection="row">
      <Text key="wrap-up-foot-command" color={THEME.accent} bold>{'/compact '}</Text>
      <Text key="wrap-up-foot-text" color={THEME.accent}>{instructions}</Text>
    </Box>
  ) : (
    <Text key="wrap-up-foot" color={THEME.muted}>{text.card.handoffFoot}</Text>
  )
  return (
    <Box key="wrap-up-card-block" flexDirection="column">
      <Box key="wrap-up-card" flexDirection="column" paddingX={1} borderStyle="round" borderColor={THEME.border} backgroundColor={cardFill()}>
        {pickThreads ? block('wrap-up-threads', text.card.threads, threads) : null}
        {block('wrap-up-also', text.card.also, (
          <Box key="wrap-up-also-row" flexDirection="row" flexWrap="wrap" columnGap={1}>
            {ALSO_KEEP.map(item => <Box key={`wrap-up-also-pad-${item.id}`} flexShrink={0}>{line(`wrap-up-also-${item.id}`, text.alsoKeep[item.id], picked.also[item.id], text.tips.also)}</Box>)}
          </Box>
        ))}
        {picked.mode === 'handoff' ? block('wrap-up-names', text.card.names, names) : null}
        <Box key="wrap-up-gap" height={1} />
        {foot}
        <Box key="wrap-up-actions" flexDirection="row" justifyContent="flex-end" columnGap={1}>
          {action('wrap-up-go', text.card.go[picked.mode], { subLead: bare(look.glyph.go) }, text.tips.go[picked.mode])}
          {action('wrap-up-cancel', text.card.cancel, { subLead: bare(look.glyph.close) }, text.tips.cancel)}
        </Box>
      </Box>
      {titleEdge({ Box, Text }, look, 'wrap-up-card', '', text.choice[picked.mode], `${text.card.title} ${MARK.sep} ${text.card.hint}`, 0)}
    </Box>
  )
}

// About the cells the switch and close pills take; a goal wider than the room left is cut.
const ACTION_CELLS = 30

function choiceCard({ Box, Client, Text }: Elements, picked: Choice, columns: number) {
  const isCarried = picked.carry === 'carried'
  const line = isCarried ? (picked.goal ? fill(text.auto.carried, { goal: picked.isFull ? picked.goal : shortGoal(picked.goal) }) : text.auto.carriedNoGoal) : text.auto.fresh
  const isCut = isCarried && picked.goal !== '' && (shortGoal(picked.goal) !== picked.goal || [...fill(text.auto.carried, { goal: picked.goal })].length > columns - 4 - ACTION_CELLS)
  const label = isCarried ? text.auto.toFresh : text.auto.toCarry
  const close = bare(look.glyph.close)
  const control = (id: string, name: string, isOpen: boolean, tip: string, glyph: string) =>
    pill({ Box, Text }, look.nerd, THEME.surface3, <Client key={id} module="./entry.tsx" height={1} props={{ id, label: name, isOpen, bg: THEME.surface3, nerd: look.nerd, still, tip: { glyph, label: name, text: tip } } satisfies EntryProps} />, `${id}-pill`, cardFill())
  const moreLabel = picked.isFull ? text.auto.showLess : text.auto.showAll
  const moreArrow = picked.isFull ? look.glyph.less : look.glyph.more
  const more = (
    <Client key="wrap-up-choice-more" module="./entry.tsx" width={[...moreLabel].length + 4} height={1} props={{ id: 'wrap-up-choice-more', label: moreLabel, lead: moreArrow, leadColor: THEME.accent, isOpen: false, bg: cardFill(), idle: THEME.muted, still, nerd: look.nerd, tip: { glyph: moreArrow, label: moreLabel, text: picked.isFull ? text.tips.showLess : text.tips.showAll } } satisfies EntryProps} />
  )
  const { oldOwn, nextOwn, oldHop, nextHop, topic } = picked.link
  // Each session's hop rides in a pill before its own name, the old one first.
  const hopName = (key: string, hop: number, name: string) => [
    hop > 0 ? pill({ Box, Text }, look.nerd, THEME.surface3, <Text key={`${key}-hop`} color={THEME.secondary}>{look.nerd ? `#${hop}` : ` #${hop} `}</Text>, `${key}-hop-pill`, cardFill()) : null,
    <Text key={`${key}-name`} color={THEME.muted} bold wrap="truncate-end">{name}</Text>,
  ]
  const names = isCarried && nextOwn ? (
    <Box key="wrap-up-choice-names" flexDirection="row" columnGap={1}>
      {oldOwn ? [...hopName('wrap-up-choice-old', oldHop, oldOwn), <Text key="wrap-up-choice-arrow" color={THEME.muted}>{text.link}</Text>] : null}
      {hopName('wrap-up-choice-next', nextHop, nextOwn)}
    </Box>
  ) : null
  const switches = [
    control('wrap-up-switch', label, true, isCarried ? text.tips.toFresh : text.tips.toCarry, bare(look.glyph.cycle)),
    control('wrap-up-switch-close', close, false, text.tips.dismissAuto, close),
  ]
  // Cut, the goal gets its own rows and the pills drop to an action row with Show all at its right; otherwise they share the goal's row.
  const body = isCut ? (
    <Box key="wrap-up-choice-body" flexDirection="column">
      <Text key="wrap-up-choice-text" color={THEME.onSurface} wrap={picked.isFull ? 'wrap' : 'truncate-end'}>{line}</Text>
      <Box key="wrap-up-choice-actions" flexDirection="row" justifyContent="flex-end" columnGap={1}>
        {more}
        {switches}
      </Box>
    </Box>
  ) : (
    <Box key="wrap-up-choice-body" flexDirection="row" columnGap={1}>
      <Box key="wrap-up-choice-text-pad" flexGrow={1} flexShrink={1}>
        <Text key="wrap-up-choice-text" color={THEME.onSurface} wrap="truncate-end">{line}</Text>
      </Box>
      {switches}
    </Box>
  )
  // The chain's topic titles the card, as the handoff card's title rides its top edge.
  return (
    <Box key="wrap-up-choice-block" flexDirection="column">
      <Box key="wrap-up-choice-card" flexDirection="column" paddingX={1} borderStyle="round" borderColor={THEME.border} backgroundColor={cardFill()}>
        {names}
        {body}
      </Box>
      {titleEdge({ Box, Text }, look, 'wrap-up-choice', '', isCarried && topic ? topic : text.choice.handoff, '', 0)}
    </Box>
  )
}

function countdownCard({ Box, Button, Text }: Elements & { Button: (props: any) => RenderElement }, shown: Countdown, onCancel: () => void) {
  const line = shown.left > 0 ? fill(text.auto.countdown, { tokens: shown.tokens, percent: shown.percent, seconds: shown.left }) : fill(text.auto.updating, { tokens: shown.tokens, percent: shown.percent })
  const scope = 'wrap-up-countdown-cancel-pill'
  return (
    <Box key="wrap-up-countdown-card" flexDirection="row" columnGap={1} paddingX={1} borderStyle="round" borderColor={THEME.border} backgroundColor={cardFill()}>
      <Box key="wrap-up-countdown-text" flexGrow={1} flexShrink={1}>
        <Text color={THEME.onSurface} wrap="truncate-end">{line}</Text>
      </Box>
      {/* The glyph rides in the label so the whole pill lights; the hover is swapped because the engine inverts a Button under the pointer. */}
      {pill({ Box, Text }, look.nerd, THEME.surface3, (
        <Button key="wrap-up-countdown-cancel" label={look.nerd ? `${bare(look.glyph.close)} ${text.card.cancel}` : ` ${bare(look.glyph.close)} ${text.card.cancel} `} plain hover={{ scope, color: THEME.lifted, backgroundColor: THEME.accent }} onPress={onCancel} />
      ), scope, cardFill(), THEME.lifted)}
    </Box>
  )
}

// The pill part or card control under the pointer, shown in the tip row above the pill row.
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

const toasts = new ToastList('wrap-up')
// The animations setting, fixed per activation: off, every entry draws still.
let still = false

const marksText = () => fill(text.tips.autoMarks, { tokens: `${Math.round(marks.tokens / 1000)}K`, percent: marks.percent })

// What the Auto switch is set to now, since the pill shows only its on or off mark.
function autoTip() {
  if (!autoOn) return text.tips.autoNeedsHandoff
  return fill(compactOn ? text.tips.autoOn : text.tips.autoOff, { marks: marksText() })
}

async function saveSetting($: EngineInterface, key: string, value: ConfigValue) {
  const row = (await $.config.list()).find(each => each.key === key)
  if (!row) return
  const result = await $.config.set({ key: row.key, value })
  say($, 'deny' in result && result.deny ? `${MARK.warn} ${result.deny}` : `${MARK.ok} ${fill(text.settingSaved, { label: row.label })}`)
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
  maxWords = clampWords(options.max_words)
  pickThreads = options.pick_threads !== false
  autoOn = options.auto_handoff === true
  every = clampEvery(options.auto_every)
  compactOn = options.auto_compact === true
  marks = { percent: clampCompactAt(options.compact_at), tokens: clampCompactTokens(options.compact_at_tokens) }
  look = lookFor(iconMode === 'nerd')

  on('session.start', async ($, e, next) => {
    bridgeOn('SessionStart', record => sessionStarted($, record))
    // A reload replays the last record the file holds; a compaction from before it is not a new one.
    isReplaying = true
    try {
      await startBridge($, 'mod-wrap-up')
    } finally {
      isReplaying = false
    }
    await loadLook($)
    await $.command.register({
      name: 'mod-wrap-up',
      description: text.commandDescription,
      argumentHint: '[settings]',
    })
    await $.state.set({ plugin: 'mod-wrap-up', key: 'pane' }, await isOpen($))
    $.ui.invalidate('ui.render')
    if (autoOn) $.clock.after(0, () => void openLedger($).catch(() => undefined))

    return next(e)
  })

  on('command.run', { command: 'mod-wrap-up' }, async ($, e) => ({ text: await answer($, e.args) }))

  // session.start does not fire on /clear, session.end does: that is the cue to fill a waiting handoff.
  on('session.end', async ($, e, next) => {
    // What the ended session's bridge file still holds is delivered first, so the reset below has the last word.
    await endBridge($, e.sessionId)
    runId += 1
    epoch += 1
    turnsSince = 0
    cursor = 0
    inject = false
    choice = null
    held = null
    if (e.reason === 'clear') {
      clearedFrom = e.sessionId
      const now = await $.clock.now()
      awaitFirst = autoOn && !yieldsToManual(manualAt, now) && !yieldsToManual(carriedAt, now)
      manualAt = null
      carriedAt = null
    }
    if (e.reason === 'clear' && isFresh(await $.store.get('pending'), await $.clock.now())) {
      $.clock.after(300, () => fillWithRetry($).catch(() => undefined))
    }

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (!(e as { agentId?: string }).agentId) {
      if (countdown) stopCountdown($)
      working = true
      $.ui.invalidate('ui.render')
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      working = false
      $.ui.invalidate('ui.render')
      turnsSince += 1
      const isUpdate = autoOn && isDue(turnsSince, every)
      if (isUpdate) turnsSince = 0
      if (autoOn) $.clock.after(0, () => void (isUpdate ? runAuto($) : Promise.resolve()).then(() => startCountdown($)).catch(() => undefined))
    }

    return next(e)
  })

  // The bridge's SessionStart record says a compaction ended; a context entry can only ride a prompt, so the next one carries the restore.
  on('prompt.submit', async ($, e, next) => {
    if (!autoOn || e.origin?.kind !== 'composer' || e.turnId) return next(e)
    const context = await promptContext($, e.text).catch(() => '')

    return next(context ? { ...e, context: [...(e.context ?? []), context] } : e)
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) await $.state.set({ plugin: 'mod-wrap-up', key: 'pane' }, false)

    return next(e)
  })

  on('state.set', async ($, e, next) => {
    // The declared state names no other mod's pane, so the types narrow this event to never.
    if (e.key === 'pane' && e.plugin !== 'mod-wrap-up' && (e as { value?: unknown }).value === true) {
      $.clock.after(0, async () => {
        if (!(await isOpen($))) return
        await $.ui.close({ id: PANE })
        await $.state.set({ plugin: 'mod-wrap-up', key: 'pane' }, false)
      })
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    await loadLook($)
    const hidden = await $.state.get({ plugin: 'mod-menu', key: 'hidden' })
    if (e.surface !== 'terminal' || e.props.hasSurvey) return next(e)
    const { Box, Button, Client, Text } = $.ui.resolve(e)
    const counting = countdown ? [countdownCard({ Box, Button, Client, Text },countdown, () => stopCountdown($))] : []
    if (hidden.value === true) {
      const shown = [...toastCards({ Box, Client, Text }, toasts, look, text.tipToast), ...counting, ...(choice ? [choiceCard({ Box, Client, Text }, choice, e.props.bodyColumns)] : []), ...(card ? [cardBox({ Box, Client, Text }, card)] : [])]
      if (shown.length === 0) return next(e)
      return <Box key="toasts-wrap-up" flexDirection="column">{shown}{await next(e)}</Box>
    }

    const { group, row, rest, tip } = splitRow(await next(e))
    // A muted entry while Claude works; a click then explains in a toast instead of crowding the row.
    const isIdle = !(e.props.isWorking || working)
    const autoGlyph = (compactOn ? look.glyph.on : look.glyph.off).trim()
    const options = [
      { id: 'wrap-up-handoff', label: text.choice.handoff },
      { id: 'wrap-up-compact', label: text.choice.compact },
      { id: 'wrap-up-auto', label: text.choice.auto, isOn: compactOn },
    ]
    // The pill row cuts the pill to its icon when the row overflows; labels never draws the icon alone.
    const labels = labelsOf((await $.state.get({ plugin: 'mod-menu', key: 'labels' })).value)
    const icon = look.nerd ? look.glyph.icon.wrapup : undefined
    const fit = icon && labels !== 'always' ? { icon, cells: choiceCells(text.label, look.nerd), compact: labels === 'never' } : {}
    const body = isRunning ? (
      <Box key="wrap-up-running-pad">
        <Client key="wrap-up-running" module="./entry.tsx" height={1} props={{ id: 'wrap-up-running', label: text.writingStage, isOpen: isIdle, bg: PILL.secondary, isBusy: true, spinner: true, still }} />
      </Box>
    ) : (
      <Box key="wrap-up-choice-pad">
        <Client key="wrap-up-entry" module="./choice.tsx" height={1} props={{ id: 'wrap-up-entry', label: text.label, options, mode: card ? `wrap-up-${card.mode}` : null, isMenuOpen, bg: PILL.secondary, nerd: look.nerd, isIdle, still, tips: [{ glyph: look.glyph.icon.actions ?? look.glyph.title, label: text.label, text: text.tips.head }, { glyph: look.glyph.title, label: text.choice.handoff, text: text.tips.handoff }, { glyph: look.glyph.title, label: text.choice.compact, text: text.tips.compact }, { glyph: autoGlyph, label: text.choice.autoCompact, text: autoTip() }], ...fit } satisfies ChoiceProps} />
      </Box>
    )
    const menu = isMenuOpen && !isRunning
    const menuOptions = [
      { ...options[0]!, tip: { glyph: look.glyph.title, label: text.choice.handoff, text: text.tips.handoff } },
      { ...options[1]!, tip: { glyph: look.glyph.title, label: text.choice.compact, text: text.tips.compact } },
      { ...options[2]!, tip: { glyph: autoGlyph, label: text.choice.autoCompact, text: autoTip() } },
    ]
    const cards = [...counting, ...(choice ? [choiceCard({ Box, Client, Text }, choice, e.props.bodyColumns)] : []), ...(card ? [cardBox({ Box, Client, Text }, card)] : []), ...(menu ? [menuCard({ Box, Client, Text }, menuOptions, isIdle)] : [])]
    const menuHint = `${text.label}: ${fill(text.menu.hint, { close: bare(look.glyph.close) })}`
    const shownTip = bandTip?.id ? tipLine({ Box, Text }, tipText(bandTip)) : menu ? tipLine({ Box, Text }, menuHint) : tip

    return pillRow({ Box, Client, Text }, look.nerd, group, [...row, isRunning ? pill({ Box, Text }, look.nerd, PILL.secondary, body, 'wrap-up-pill') : <Box key="wrap-up-pill" flexDirection="row">{body}</Box>], [...toastCards({ Box, Client, Text }, toasts, look, text.tipToast), ...cards, ...rest], shownTip, e.props.bodyColumns)
  })

  on('ui.message', async ($, e, next) => {
    if (isTipMessage(e.data)) {
      const tip = e.data
      const own = Boolean(tip.id?.startsWith('wrap-up-') || tip.id?.startsWith('toast-wrap-up-'))
      bandTip = own ? tip : null
      if (bandTip?.id) expireBandTip($)
      paneTip = tip.id && !own ? { glyph: tip.glyph ?? '', label: tip.label ?? '', text: tip.text ?? '' } : null
      $.ui.invalidate('ui.render')
      return next(e)
    }
    openSetting($, e.data)
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
    if (message?.type !== 'menu-entry') return next(e)
    const picksFromMenu = message.id === 'wrap-up-handoff' || message.id === 'wrap-up-compact' || message.id === 'wrap-up-auto'
    const wasMenuOpen = isMenuOpen
    if (message.id === 'wrap-up-menu-close' || picksFromMenu) isMenuOpen = false
    if (message.id === 'wrap-up-entry-open') isMenuOpen = !isMenuOpen && !working
    if (wasMenuOpen !== isMenuOpen) {
      bandTip = null
      $.ui.invalidate('ui.render')
    }
    const isChoice = message.id === 'wrap-up-entry' || message.id === 'wrap-up-entry-open' || message.id === 'wrap-up-handoff' || message.id === 'wrap-up-compact' || message.id === 'wrap-up-auto'
    if (isChoice && working) $.ui.toast(text.claudeWorkingPill)
    else if (message.id === 'wrap-up-handoff') openCard($, 'handoff')
    else if (message.id === 'wrap-up-compact') openCard($, 'compact')
    // Saving reloads the mod, which redraws the switch with the new mark.
    else if (message.id === 'wrap-up-auto') await $.config.set({ key: 'mod-wrap-up.auto_compact', value: !compactOn })
    if (message.id === 'wrap-up-switch') await flipChoice($)
    if (message.id === 'wrap-up-choice-more' && choice) {
      choice = { ...choice, isFull: !choice.isFull }
      $.ui.invalidate('ui.render')
    }
    if (message.id === 'wrap-up-switch-close') {
      choice = null
      $.ui.invalidate('ui.render')
    }
    if (message.id === 'wrap-up-cancel') closeCard($)
    if (message.id === 'wrap-up-go') await finishCard($)
    toggleLine($, message.id)

    return next(e)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    await loadLook($)
    if (e.requestId !== PANE) return next(e)

    // @ts-expect-error The host's types omit Client from a Pane's elements, yet a Pane draws it.
    const { Box, Button, Client, Text } = $.ui.resolve(e)
    const rows = (await $.config.list()).filter(row => row.key.startsWith('mod-wrap-up.'))
    const run = async (_action: Action) => openCard($, 'handoff')

    return (
      <Box flexDirection="column" backgroundColor={THEME.bg} paddingX={1} minHeight={e.props.scroll.bodyRows}>
        {tabRow({ Box, Client, Text }, look.nerd, [{ id: 'mod-wrap-up-settings-tab', label: `${text.label} ${MARK.sep} ${text.paneSettings}`, icon: look.glyph.icon['wrap-up'] ?? '', isOpen: true, tip: { glyph: look.glyph.gear, label: text.paneSettings, text: text.tips.tab } }], still)}
        {settingsBody({ Box, Button, Client, Text }, look, { rows, actions, working, run, previews, fields, still: still, mod: 'mod-wrap-up' })}
        <Box key="footer-space" height={FOOTER_ROWS} flexShrink={0} />
        {paneFooter({ Box, Text }, paneTip, e.props.bodyColumns, e.props.scroll, actionReveals(actions, look, working), { hint: `${text.statusHint} ${MARK.sep} ${text.statusHintSaved}`, status: withMark(look, note) })}
      </Box>
    )
  })
}

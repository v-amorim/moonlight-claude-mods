// mod-file-tree / hooks/register.tsx, by v-amorim
// Registers the files sidebar: pane, pill, command, toasts and settings wiring with the engine.
import type { ConfigValue, EngineInterface, Register } from 'claude-code'

import { bridgeOn, endBridge, startBridge, type BridgeRecord } from './bridge'
import { NAME_COLOR, OPEN_CELLS, type ListMessage, type Row as ListRow } from './list'
import { detectNerd, FOOTER_ROWS, lookFor, section, paneFooter, sepText, subpill, withIcon, type IconMode, type Look, withMark } from './look'
import { isTipMessage, mix, type EntryMessage, type EntryProps, type Tip } from './entry'
import { labelsOf, menuEntry, pill, pillRow, splitRow, tabRow, tipLine } from './pills'
import { TOAST_MS, ToastList, toastCards } from './toasts'
import { choiceBar as sharedChoiceBar, settingChoice, settingsBody, type Action, type Previews, type Range } from './settings'
import text from './text'
import { fill, MARK, statusColor, THEME } from './theme'
import { shellPlans, TranscriptFiles } from './transcript'
import { cells, cut } from './cells'
import { commit, diffLines, emptyLog, iconOf, latestStepOf, liveFolds, relPath, rootOf, recentView, rowsOf, stepsOfTurn, touch, turnView, type Entry, type Kind, type Line, type Log } from './tree'

const PANE = 'filetree'
const SETTINGS = 'filetree-settings'

let showReads = true
let wrapDiff = true
let iconMode: IconMode = 'auto'
let look = lookFor(false)

// The transcript is read once per session start, since a long session's file is large; live calls then update the log. Kept in $.state for the pane and reloads.
let log: Log | undefined
let transcript = ''
// `/mod-file-tree clear` hides what came before it; the transcript would bring it back otherwise.
let cleared = { seq: 0, step: 0 }
let scope: 'turn' | 'recent' | 'session' = 'turn'
let recentTurns = 5
let mode: 'tree' | 'replay' = 'tree'
// null follows the latest turn that edited something.
let replayTurn: number | null = null
let index = 0
let collapsed: string[] = []
let note = ''
let actions: Action[] = []
let previews: Previews | undefined
let fields: Record<string, Range> | undefined

const isOpen = async ($: EngineInterface, id: string) => (await $.ui.panes()).some(pane => pane.id === id && pane.isPlaced)

// The session the log belongs to. A /resume or /clear keeps the process and changes the id, so the old log must never show for the new one.
let logSession = ''

function startLog(session: string, path = '') {
  logSession = session
  transcript = path
  log = undefined
  loading = null
  loadFailed = false
  loadError = ''
  changes = []
  cleared = { seq: 0, step: 0 }
  replayTurn = null
  index = 0
  collapsed = []
  opened = []
  note = ''
  landed.clear()
}

// Asking the id on every hook would cost a round trip each, so hooks ask after a session.end, or once this long has passed.
const SESSION_CHECK_MS = 500
let sessionCheckedAt = 0

async function followSession($: EngineInterface) {
  const now = Date.now()
  if (logSession && now - sessionCheckedAt < SESSION_CHECK_MS) return
  sessionCheckedAt = now
  const asked = logSession
  const session = String(await $.session.id().catch(() => logSession))
  // A SessionStart that switched the log while the id was on its way knows better than this answer.
  if (session !== logSession && asked === logSession) startLog(session)
}

// The transcript read in flight, one per session; changes made meanwhile replay onto what it builds, so a live edit is never lost.
let loading: { session: string; done: Promise<void> } | null = null
let changes: ((current: Log) => Log)[] = []
// A read that failed leaves the log partial, so the next hydrate reads again, keeping the changes made since.
let loadFailed = false
// The short reason the last failed read gave, kept until a read succeeds so the empty state can name it.
let loadError = ''
let readFailure = ''
const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').trim().slice(0, 80)

// A hook waits this long at most for the read, so a long session's transcript never holds up the start or the pane.
const LOAD_WAIT_MS = 300

// A reload empties the module copy and $.state still holds it; only an empty state, or another session's, reads the transcript.
async function hydrate($: EngineInterface) {
  await followSession($)
  if (log && !loadFailed) return log
  const session = logSession
  const owner = (await $.state.get({ plugin: 'mod-file-tree', key: 'session' })).value
  const kept = (await $.state.get({ plugin: 'mod-file-tree', key: 'log' })).value as Log | undefined
  if (session !== logSession) return log ?? emptyLog()
  if (kept && owner === session && !loadFailed) {
    cleared = (await $.state.get({ plugin: 'mod-file-tree', key: 'cleared' })).value ?? cleared
    log = kept
    return log
  }
  if (!loading) {
    loadFailed = false
    const started: NonNullable<typeof loading> = {
      session,
      done: load($, session).catch(error => {
        if (loading !== started) return
        loading = null
        loadFailed = true
        loadError = readFailure || reasonOf(error)
      }),
    }
    loading = started
  }
  log = emptyLog()
  await Promise.race([loading.done, $.clock.sleep(LOAD_WAIT_MS).catch(() => {})])
  return log ?? emptyLog()
}

// Every change to the log goes through here, so one made while the transcript loads is replayed onto it.
async function apply($: EngineInterface, change: (current: Log) => Log) {
  await hydrate($)
  log = change(log ?? emptyLog())
  if (loading || loadFailed) changes.push(change)
  await save($)
}

async function save($: EngineInterface) {
  await $.state.set({ plugin: 'mod-file-tree', key: 'log' }, log ?? emptyLog())
  await $.state.set({ plugin: 'mod-file-tree', key: 'session' }, logSession)
  $.ui.invalidate('ui.render')
}

async function configDir($: EngineInterface) {
  const set = ((await $.env.get('CLAUDE_CONFIG_DIR')) ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
  if (set) return set
  const home = ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '').replace(/\\/g, '/')

  return `${home}/.claude`
}

// When no SessionStart named the transcript, it is `<session id>.jsonl` in one of the config folder's projects folders.
async function findTranscript($: EngineInterface) {
  const projects = `${await configDir($)}/projects`
  const file = `${await $.session.id().catch(() => '')}.jsonl`
  for (const entry of await $.fs.list(projects).catch(() => [])) {
    const path = `${projects}/${entry.name}/${file}`
    if (entry.kind === 'dir' && (await $.fs.exists(path).catch(() => false))) return path
  }
  return ''
}

// A transcript path is kept with the time it was named; an older bare string counts as a path with no age yet.
const pathOf = (kept: unknown) => {
  const path = typeof kept === 'object' && kept !== null ? (kept as { path?: unknown }).path : kept
  return typeof path === 'string' ? path : ''
}

const TRANSCRIPT_KEEP_MS = 30 * 24 * 60 * 60 * 1000

// A bare string from an older version starts its clock now.
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

// Builds the log from the whole transcript; a long session outgrows $.fs.read's 4 MiB cap, so it then streams through the platform's file printer.
async function load($: EngineInterface, session: string) {
  const path = transcript || pathOf(await $.store.get(`transcript:${session}`).catch(() => '')) || (await findTranscript($))
  if (session !== logSession) return
  transcript = path
  let raw = ''
  readFailure = ''
  if (path) {
    raw = String(await $.fs.read(path).catch(error => (readFailure = reasonOf(error), '')))
    if (!raw) {
      const isWindows = /^[A-Za-z]:|\\/.test(path)
      // cmd's type rejects forward slashes.
      const argv = isWindows ? ['cmd', '/c', 'type', path.replace(/\//g, '\\')] : ['cat', path]
      for await (const chunk of $.process.spawn({ argv })) {
        if (chunk.stream === 'stdout') raw += chunk.text
      }
    }
    if (!raw && readFailure) throw new Error(readFailure)
  }
  // A switch while the file was read makes it another session's.
  if (session !== logSession) return
  const parsed = new TranscriptFiles(String((await $.session.cwd().catch(() => '')) ?? ''))
  for (const line of raw.split('\n')) if (line.trim()) parsed.feed(line)
  if (session !== logSession) return
  log = changes.reduce((current, change) => change(current), { ...parsed.log, working: false })
  changes = []
  loading = null
  loadError = ''
  $.ui.invalidate('ui.render')
  // A pane render can be what started the read, and a render may not write state.
  $.clock.after(0, () => void save($))
}

// Only the SessionStart record names the transcript, and the bridge delivers it. A compact keeps the same file and the log already holds it, so only a new transcript is read.
async function sessionStarted($: EngineInterface, record: BridgeRecord) {
  const session = String(record.session_id ?? '')
  const path = String(record.transcript_path ?? '')
  if (!session || !path) return
  try {
    if (session !== logSession || path !== transcript || !log) {
      startLog(session, path)
      await $.state.set({ plugin: 'mod-file-tree', key: 'cleared' }, cleared)
      await $.store.set(`transcript:${session}`, { path, at: await $.clock.now() })
      // The state may hold another session's log, which this one must not reuse.
      await $.state.set({ plugin: 'mod-file-tree', key: 'session' }, '')
      await hydrate($)
    }
  } catch {
    // The tree stays as it was.
  }
}

function viewOf(current: Log): Log {
  const scoped = scope === 'turn' ? turnView(current) : scope === 'recent' ? recentView(current, recentTurns) : current
  return { ...scoped, files: scoped.files.filter(file => file.seq > cleared.seq), steps: scoped.steps.filter(step => step.id > cleared.step) }
}

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

// One panel at a time, this mod's two panes included; opening one closes the other.
async function togglePane($: EngineInterface) {
  if (await isOpen($, PANE)) {
    await $.ui.close({ id: PANE })
    await $.state.set({ plugin: 'mod-file-tree', key: 'pane' }, false)
    return
  }
  if (await isOpen($, SETTINGS)) await $.ui.close({ id: SETTINGS })
  note = ''
  await hydrate($)
  const opened = await $.ui.open({ id: PANE, title: text.pill, closeOnEscape: true })
  if (!opened.isPlaced) $.ui.toast(fill(text.paneWaiting, { reason: opened.reason }))
  await $.state.set({ plugin: 'mod-file-tree', key: 'pane' }, opened.isPlaced)
}

// `/mod-file-tree settings` toggles the panel; an unplaced pane is waiting, not open.
async function toggleSettings($: EngineInterface) {
  if (await isOpen($, SETTINGS)) {
    await $.ui.close({ id: SETTINGS })
    await $.state.set({ plugin: 'mod-file-tree', key: 'pane' }, false)
    return
  }
  if (await isOpen($, PANE)) await $.ui.close({ id: PANE })
  note = ''
  const showcase = await $.fs.read(`${$.plugin.root}/showcase.json`).then(raw => JSON.parse(String(raw))).catch(() => null)
  previews = showcase?.previews
  fields = await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`).then(text => JSON.parse(String(text)).userConfig).catch(() => undefined)
  actions = (Array.isArray(showcase?.actions) ? showcase.actions : []).map((action: Action) => ({ ...action, isLocal: action.command === 'mod-file-tree' }))
  const opened = await $.ui.open({ id: SETTINGS, title: text.settingsFrame, closeOnEscape: true })
  if (!opened.isPlaced) $.ui.toast(fill(text.settingsWaiting, { reason: opened.reason }))
  await $.state.set({ plugin: 'mod-file-tree', key: 'pane' }, opened.isPlaced)
}

async function clearAll($: EngineInterface) {
  const current = await hydrate($)
  cleared = { seq: current.seq, step: current.steps[current.steps.length - 1]?.id ?? 0 }
  await $.state.set({ plugin: 'mod-file-tree', key: 'cleared' }, cleared)
  mode = 'tree'
  replayTurn = null
  index = 0
  collapsed = []
  await save($)
}

// What `/mod-file-tree <args>` does; the settings panel's own actions call it directly, since $.command.run skips the calling plugin.
async function answer($: EngineInterface, args: string) {
  if (args.trim() === 'settings') {
    await toggleSettings($)
    return ''
  }
  if (args.trim() === 'clear') {
    await clearAll($)
    return text.cleared
  }
  await togglePane($)
  return ''
}

// Runs a command to its end: its exit code, or null and the reason when it could not start.
async function launch($: EngineInterface, argv: string[]) {
  try {
    const result = await $.process.run(argv, { timeoutMs: 15_000 })
    return { code: result.exitCode as number | null, reason: result.stderr.trim() }
  } catch (error) {
    return { code: null, reason: String(error) }
  }
}

// Explorer, Finder or the desktop's file manager on a folder, the default app on a file. Only a failed start counts as failing.
async function openWithSystem($: EngineInterface, isWindows: boolean, native: string) {
  // A mod's child starts with its window hidden, which Explorer honors, so the shell handler launches it with a normal window; no cmd, so a name's `&` or `%` is never read as a command.
  if (isWindows) return launch($, ['rundll32.exe', 'url.dll,FileProtocolHandler', native])
  const opened = await launch($, ['open', native])
  return opened.code === 0 ? opened : launch($, ['xdg-open', native])
}

async function nativePath($: EngineInterface, path: string) {
  const cwd = String((await $.session.cwd().catch(() => '')) ?? '').replace(/\\/g, '/')
  const full = /^([A-Za-z]:)?\//.test(path) ? path : `${cwd}/${path}`
  const isWindows = /^[A-Za-z]:/.test(full)
  return { isWindows, native: isWindows ? full.replace(/\//g, '\\') : full }
}

async function openFolder($: EngineInterface, path: string, name = path) {
  const { isWindows, native } = await nativePath($, path)
  const opened = await openWithSystem($, isWindows, native)
  note = opened.code === null ? `${MARK.warn} ${fill(text.openFailed, { path: name, reason: opened.reason })}` : `${MARK.ok} ${fill(text.openedFolder, { path: name })}`
  $.ui.invalidate('ui.render')
}

// On Windows `code` is a .cmd script that needs a shell, so the installed Code.exe is run directly instead.
async function codeExe($: EngineInterface) {
  const local = ((await $.env.get('LOCALAPPDATA')) ?? '').replace(/\\/g, '/')
  const files = ((await $.env.get('ProgramFiles')) ?? '').replace(/\\/g, '/')
  const found = [local && `${local}/Programs/Microsoft VS Code/Code.exe`, files && `${files}/Microsoft VS Code/Code.exe`]
  for (const path of found) if (path && (await $.fs.exists(path).catch(() => false))) return path.replace(/\//g, '\\')
  return ''
}

// The default app runs these instead of showing them, and a model wrote the name.
const RUNNABLE = /\.(exe|bat|cmd|com|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|msi|msp|lnk|scr|pif|hta|cpl|reg|jar|app|command|sh|tool)$/i

async function openFile($: EngineInterface, path: string) {
  const { isWindows, native } = await nativePath($, path)
  const editor = isWindows ? await codeExe($) : 'code'
  if (editor && (await launch($, [editor, native])).code === 0) {
    note = `${MARK.ok} ${fill(text.openedInCode, { path })}`
  } else if (RUNNABLE.test(native)) {
    const folder = native.slice(0, Math.max(native.lastIndexOf('\\'), native.lastIndexOf('/'))) || native
    const opened = await openWithSystem($, isWindows, folder)
    note = opened.code === null ? `${MARK.warn} ${fill(text.openFailed, { path, reason: opened.reason })}` : `${MARK.ok} ${fill(text.openedRunnable, { path })}`
  } else {
    const opened = await openWithSystem($, isWindows, native)
    note = opened.code === null ? `${MARK.warn} ${fill(text.openFailed, { path, reason: opened.reason })}` : `${MARK.ok} ${fill(text.opened, { path })}`
  }
  $.ui.invalidate('ui.render')
}

async function openDiff($: EngineInterface, path: string) {
  const current = viewOf(await hydrate($))
  const step = latestStepOf(current, path)
  if (!step) {
    note = `${MARK.warn} ${fill(text.onlyRead, { path })}`
  } else {
    mode = 'replay'
    replayTurn = step.turn
    index = Math.max(0, stepsOfTurn(current, step.turn).findIndex(other => other.id === step.id))
    note = `${MARK.ok} ${fill(text.replaying, { path })}`
  }
  $.ui.invalidate('ui.render')
}

function walk($: EngineInterface, delta: number, total: number) {
  index = Math.max(0, Math.min(index + delta, total - 1))
  note = ''
  $.ui.invalidate('ui.render')
}

// Folders the person opened while Claude works; the live folds leave them open until the next turn.
let opened: string[] = []

const foldsOf = (current: Log) => liveFolds(current, showReads)?.filter(key => !opened.includes(key)) ?? collapsed

function fold($: EngineInterface, current: Log, key: string) {
  const isLiveFold = liveFolds(current, showReads)?.includes(key)
  if (isLiveFold) opened = opened.includes(key) ? opened.filter(other => other !== key) : [...opened, key]
  else collapsed = collapsed.includes(key) ? collapsed.filter(other => other !== key) : [...collapsed, key]
  note = ''
  $.ui.invalidate('ui.render')
}

// Every folder at once; while Claude works, `opened` is what the live folds leave open.
function foldAll($: EngineInterface, current: Log, isShut: boolean) {
  const folders = rowsOf(current, [], showReads).filter(row => row.isDir).map(row => row.key)
  collapsed = isShut ? folders : []
  opened = isShut ? [] : folders
  note = ''
  $.ui.invalidate('ui.render')
}

const WORD: Record<Kind, { done: string; live: string }> = text.words

const STATUS: Record<Kind, { tone: ListRow['tone'] }> = {
  read: { tone: 'read' },
  edit: { tone: 'changed' },
  write: { tone: 'changed' },
  new: { tone: 'added' },
}

type ToolEvent = { tool: string; [argument: string]: unknown }

// What a call does to which file, read before it runs so a Write can see the file it replaces.
async function planOf($: EngineInterface, e: ToolEvent) {
  const cwd = await $.session.cwd().catch(() => '')
  const at = (path: unknown) => relPath(String(cwd ?? ''), String(path))
  if (e.tool === 'Read' && e.file_path) return { path: at(e.file_path), tool: 'Read', kind: 'read' as Kind, note: '', lines: [] as Line[] }
  if ((e.tool === 'Edit' || e.tool === 'MultiEdit') && e.file_path) {
    return { path: at(e.file_path), tool: e.tool, kind: 'edit' as Kind, note: e.replace_all ? text.notes.replaceAll : '', lines: diffLines(String(e.old_string ?? ''), String(e.new_string ?? '')) }
  }
  if (e.tool === 'NotebookEdit' && e.notebook_path) {
    const editMode = String(e.edit_mode ?? 'replace')
    return { path: at(e.notebook_path), tool: 'NotebookEdit', kind: 'edit' as Kind, note: fill(text.notes.cell, { mode: editMode }), lines: diffLines('', String(e.new_source ?? '')) }
  }
  if (e.tool === 'Write' && e.file_path) {
    const path = String(e.file_path)
    const isThere = await $.fs.exists(path).catch(() => false)
    const before = isThere ? String(await $.fs.read(path).catch(() => '')) : ''
    return { path: at(path), tool: 'Write', kind: (isThere ? 'write' : 'new') as Kind, note: isThere ? text.notes.rewrite : text.notes.newFile, lines: diffLines(before, String(e.content ?? '')) }
  }
  return undefined
}

// The engine refuses a Client whose drawing is too large, which a whole session's tree reaches; each list draws this many rows.
const LIST_CHUNK = 40

// When each file's latest live edit landed, and the log's seq then; transcript rebuilds leave it empty, so old edits don't glow.
const landed = new Map<string, { at: number; seq: number }>()

const chunksOf = <T,>(items: T[]) => Array.from({ length: Math.ceil(items.length / LIST_CHUNK) }, (_, n) => items.slice(n * LIST_CHUNK, (n + 1) * LIST_CHUNK))

function listRows(current: Log, rows: ReturnType<typeof rowsOf>, glyphs: Look, width: number): ListRow[] {
  const icon = (name: string) => glyphs.glyph.icon[name] ?? ''
  return rows.map(row => {
    const guides = '│ '.repeat(row.depth)
    // Widths below are terminal cells: a CJK character takes two, so counting characters would overflow the row.
    const entry: Entry | undefined = row.entry
    const done = entry ? landed.get(entry.path) : undefined
    // Once the edit lands the row stops being live and glows instead, until Claude touches another file.
    const isLive = Boolean(entry && current.working && entry.seq === current.seq && done?.seq !== entry.seq)
    const lead = row.isDir ? (row.isFolded ? glyphs.glyph.collapsed : glyphs.glyph.expanded) : ''
    const mark = row.isDir ? icon(row.isFolded ? 'folder' : 'folder-open') : icon(iconOf(row.name))
    const marks = [lead, mark].filter(Boolean).join(' ')
    // Safe mode has no folder icon, so a trailing slash tells a folder from a file.
    const name = row.isDir && !glyphs.nerd ? `${row.name}/` : row.name
    const status = entry && isLive ? WORD[entry.last].live : ''
    // A folded folder shows what its files add up to, so folding hides no change.
    const inside = row.isDir && row.isFolded ? current.files.filter(file => file.path.startsWith(`${row.key}/`)) : []
    const add = entry?.add ?? inside.reduce((sum, file) => sum + file.add, 0)
    const del = entry?.del ?? inside.reduce((sum, file) => sum + file.del, 0)
    const counts = [add > 0 ? `+${add}` : '', del > 0 ? `−${del}` : ''].filter(Boolean).join(' ')
    // The counts' pill adds a cap on each side where the font has them.
    const stats = cells(counts) + (counts && glyphs.nerd ? 2 : 0) + (status && counts ? 1 : 0)
    // The live word sits in a pill, one cell wider on each side.
    const used = cells(guides) + (marks ? cells(marks) + 1 : 0) + stats + cells(status) + (isLive ? 4 : 0) + OPEN_CELLS
    const shown = cut(name, Math.max(6, width - used - 1))
    return {
      guides,
      lead,
      mark,
      markColor: row.isDir ? THEME.folder : THEME.accent,
      name: shown,
      tone: !entry ? 'dir' : isLive ? 'live' : STATUS[entry.kind].tone,
      add,
      del,
      status,
      pad: width - used - cells(shown),
      endMark: row.isDir ? glyphs.glyph.reveal : MARK.open,
      endColor: row.isDir ? THEME.folder : THEME.accent,
      tip: row.isDir ? text.folderRowTip : entry?.kind === 'read' ? text.readRowTip : text.fileRowTip,
      tipLabel: row.isDir ? text.folderRowLabel : entry?.kind === 'read' ? text.readRowLabel : text.fileRowLabel,
      openTip: row.isDir ? text.openFolderTip : text.openFileTip,
      ...(done ? { changedAt: done.at } : {}),
    }
  })
}

// True while the pointer is on this mod's pill entry, which then shows its tip under the row.
let tipShown = false
let hoveredTip: Tip | null = null
let toastTip = ''

const toasts = new ToastList('filetree')
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
  if (!(await isOpen($, PANE))) {
    isOpening = true
    $.ui.invalidate('ui.render')
    $.clock.after(OPEN_WAIT_MS, () => endOpening($))
  }
  await togglePane($)
  if (!(await isOpen($, PANE))) endOpening($)
}

// The share of each status color left in its legend pill.
const LEGEND_WASH = 0.72

// A settings card's click: its row, saved through /config; a saved change reloads this mod.
async function saveSetting($: EngineInterface, key: string, value: ConfigValue) {
  const row = (await $.config.list()).find(each => each.key === key)
  if (!row) return
  const result = await $.config.set({ key, value })
  note = 'deny' in result && result.deny ? `${MARK.warn} ${result.deny}` : `${MARK.ok} ${fill(text.settingSaved, { label: row.label })}`
  $.ui.invalidate('ui.render')
}

const tabs = (isSettings: boolean, touched: number) => [
  { id: 'filetree-tab', label: text.pill, icon: look.glyph.icon.files ?? look.glyph.title, isOpen: !isSettings, ...(isSettings ? {} : { count: touched }), tip: { glyph: look.glyph.icon.files ?? look.glyph.title, label: text.pill, text: text.filesTabTip } },
  { id: 'filetree-settings', label: text.settingsLabel, icon: look.glyph.gear, isOpen: isSettings, tip: { glyph: look.glyph.gear, label: text.settingsLabel, text: text.settingsTabTip } },
]

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

  showReads = options.show_reads !== false
  wrapDiff = options.wrap_diff !== false
  recentTurns = Math.min(20, Math.max(2, Math.round(Number(options.recent_turns ?? 5)) || 5))
  iconMode = (options.icons as IconMode | undefined) ?? 'auto'
  look = lookFor(iconMode === 'nerd')

  on('session.start', async ($, e, next) => {
    bridgeOn('SessionStart', record => sessionStarted($, record))
    await startBridge($, 'mod-file-tree')
    try {
      await loadLook($)
      await $.command.register({
        name: 'mod-file-tree',
        description: text.commandDescription,
        argumentHint: '[settings|clear]',
      })
      await pruneTranscripts($)
      // The bar entry reads this; an unload drops the pane without raising ui.close here.
      await $.state.set({ plugin: 'mod-file-tree', key: 'pane' }, (await isOpen($, PANE)) || (await isOpen($, SETTINGS)))
      await hydrate($)
      // A hot reload leaves an open pane on its old drawing until something redraws it.
      $.ui.invalidate('ui.render')
    } catch {
      // The tree stays as it was.
    }

    return next(e)
  })

  on('command.run', { command: 'mod-file-tree' }, async ($, e) => ({ text: await answer($, e.args) }))

  on('ui.close', async ($, e, next) => {
    try {
      if (e.id === PANE || e.id === SETTINGS) {
        await $.state.set({ plugin: 'mod-file-tree', key: 'pane' }, await isOpen($, e.id === PANE ? SETTINGS : PANE))
      }
    } catch {
      // The tree stays as it was.
    }

    return next(e)
  })

  // Deferred past this dispatch, so this mod's own state write is not nested in another plugin's.
  on('state.set', async ($, e, next) => {
    // The declared state names no other mod's pane, so the types narrow this event to never.
    if (e.key === 'pane' && e.plugin !== 'mod-file-tree' && (e as { value?: unknown }).value === true) {
      $.clock.after(0, async () => {
        const wasOpen = (await isOpen($, PANE)) || (await isOpen($, SETTINGS))
        if (!wasOpen) return
        await $.ui.close({ id: PANE })
        await $.ui.close({ id: SETTINGS })
        await $.state.set({ plugin: 'mod-file-tree', key: 'pane' }, false)
      })
    }

    return next(e)
  })

  // Observes only: the call is recorded before it runs (the tree shows it live) and its diff once it succeeds.
  on('tool.call', async ($, e, next) => {
    const plan = await planOf($, e as ToolEvent).catch(() => undefined)
    if (!plan) {
      if (e.tool !== 'Bash') return next(e)
      // A shell command's edits come back with its result, as Claude Code diffed them.
      const ran = await next(e)
      try {
        const cwd = String((await $.session.cwd().catch(() => '')) ?? '')
        const shells = shellPlans((ran as { result?: { bashEditDiff?: unknown } })?.result?.bashEditDiff, cwd)
        if (shells.length > 0) {
          await apply($, current => shells.reduce((each, shell) => commit(touch(each, shell.path, shell.kind), shell.path, shell.tool, shell.kind, shell.note, shell.lines), current))
          for (const shell of shells) landed.set(shell.path, { at: Date.now(), seq: log!.seq })
        }
      } catch {
        // The tree stays as it was.
      }
      return ran
    }

    try {
      await apply($, current => touch(current, plan.path, plan.kind))
    } catch {
      // The tree stays as it was.
    }

    const result = await next(e)
    const isFailed = typeof result === 'object' && result !== null && ('deny' in result || ('isError' in result && result.isError === true))
    try {
      if (plan.kind !== 'read' && !isFailed) {
        await apply($, current => commit(current, plan.path, plan.tool, plan.kind, plan.note, plan.lines))
        landed.set(plan.path, { at: Date.now(), seq: log!.seq })
        if (replayTurn === null) index = Math.max(0, stepsOfTurn(viewOf(log!), null).length - 1)
      }
    } catch {
      // The tree stays as it was.
    }

    return result
  })

  on('turn.start', async ($, e, next) => {
    try {
      if (!(e as { agentId?: string }).agentId) {
        opened = []
        replayTurn = null
        await apply($, current => ({ ...current, turn: current.turn + 1, working: true }))
      }
    } catch {
      // The tree stays as it was.
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    try {
      if (!e.agentId) {
        if (replayTurn === null) index = 0
        await apply($, current => ({ ...current, working: false }))
      }
    } catch {
      // The tree stays as it was.
    }

    return next(e)
  })

  // A /resume or /clear ends this session; the next hook asks for the id at once.
  on('session.end', async ($, e, next) => {
    sessionCheckedAt = 0
    await endBridge($, e.sessionId)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    await loadLook($)
    const hidden = await $.state.get({ plugin: 'mod-menu', key: 'hidden' })
    if (e.surface !== 'terminal' || e.props.hasSurvey) return next(e)
    if (hidden.value === true) {
      if (toasts.items.length === 0) return next(e)
      const { Box, Client, Text } = $.ui.resolve(e)
      return <Box key="toasts-filetree" flexDirection="column">{toastCards({ Box, Client, Text }, toasts, look, text.tipToast)}{await next(e)}</Box>
    }

    const { Box, Client, Text } = $.ui.resolve(e)
    // Reading the value subscribes the bar to redraws; the look trusts the pane list itself.
    await $.state.get({ plugin: 'mod-file-tree', key: 'pane' })
    const shown = (await isOpen($, PANE)) || (await isOpen($, SETTINGS))
    const labels = labelsOf((await $.state.get({ plugin: 'mod-menu', key: 'labels' })).value)
    const { group, row, rest, tip } = splitRow(await next(e))
    // Opening the pane from here queues nothing, so the entry stays live mid-turn.
    const entry = menuEntry({ Box, Client, Text }, look.nerd, 'filetree', { label: text.pill, isOpen: shown, idle: THEME.pill, isBusy: isOpening, still, labels })

    return pillRow({ Box, Client, Text }, look.nerd, [entry, ...group], row, [...toastCards({ Box, Client, Text }, toasts, look, text.tipToast), ...rest], toastTip ? tipLine({ Box, Text }, toastTip) : tipShown ? tipLine({ Box, Text }, text.pillTip) : tip, e.props.bodyColumns)
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
      const { id, glyph, label, text: tipText } = e.data
      const isToast = Boolean(id?.startsWith('toast-filetree-'))
      toastTip = isToast ? `${label}: ${tipText}` : ''
      hoveredTip = !isToast && id && glyph !== undefined && label && tipText ? { glyph, label, text: tipText } : null
      $.ui.invalidate('ui.render')
      return next(e)
    }
    const hover = e.data as { type?: string; id?: string; isOver?: boolean }
    if (hover?.type === 'menu-hover' && hover.id === 'filetree') {
      tipShown = hover.isOver === true
      $.ui.invalidate('ui.render')
    }
    try {
      const change = settingChoice(e.data)
      if (change) await saveSetting($, change.key, change.value)
      const message = e.data as EntryMessage
      if (message?.type === 'menu-entry') {
        if (message.id === 'filetree') await openingPane($)
        if (message.id === 'filetree-settings' && !(await isOpen($, SETTINGS))) await toggleSettings($)
        if (message.id === 'filetree-tab' && !(await isOpen($, PANE))) await togglePane($)
        if (message.id === 'tab-tree' || message.id === 'tab-replay') {
          mode = message.id === 'tab-tree' ? 'tree' : 'replay'
          note = ''
          $.ui.invalidate('ui.render')
        }
        if (message.id === 'scope-turn' || message.id === 'scope-recent' || message.id === 'scope-session') {
          scope = message.id === 'scope-turn' ? 'turn' : message.id === 'scope-recent' ? 'recent' : 'session'
          note = ''
          $.ui.invalidate('ui.render')
        }
        if (message.id === 'fold-all' || message.id === 'unfold-all') {
          const isFolding = message.id === 'fold-all'
          foldAll($, viewOf(await hydrate($)), isFolding)
          // The click swaps the toggle for its opposite under the pointer, and the old one never posts its leave.
          hoveredTip = isFolding ? { glyph: look.glyph.more, label: text.unfoldAll, text: text.unfoldAllTip } : { glyph: look.glyph.less, label: text.foldAll, text: text.foldAllTip }
        }
        if (message.id === 'session-reveal') {
          const cwd = String((await $.session.cwd().catch(() => '')) ?? '').replace(/\\/g, '/')
          await openFolder($, cwd, cwd.split('/').pop() || text.rootFallback)
        }
        if (message.id === 'replay-prev' || message.id === 'replay-next') {
          walk($, message.id === 'replay-prev' ? -1 : 1, stepsOfTurn(viewOf(await hydrate($)), replayTurn).length)
        }
      }
    } catch {
      // The tree stays as it was.
    }

    return next(e)
  })

  on('ui.message', { requestId: PANE }, async ($, e, next) => {
    const message = e.data as ListMessage
    try {
      if (message?.type === 'select') {
        const current = viewOf(await hydrate($))
        const row = rowsOf(current, foldsOf(current), showReads)[message.index]
        if (row?.isDir) fold($, current, row.key)
        else if (row) await openDiff($, row.key)
      }
      if (message?.type === 'open') {
        const current = viewOf(await hydrate($))
        const row = rowsOf(current, foldsOf(current), showReads)[message.index]
        if (row?.isDir) await openFolder($, row.key)
        else if (row) await openFile($, row.key)
      }
    } catch {
      // The tree stays as it was.
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    await loadLook($)
    if (e.requestId !== PANE && e.requestId !== SETTINGS) return next(e)
    if (isOpening) $.clock.after(0, () => endOpening($))

    // @ts-expect-error The host's types omit Client from a Pane's elements, yet a Pane draws it.
    const { Box, Button, Client, Text } = $.ui.resolve(e)
    const elements = { Box, Button, Text }

    if (e.requestId === SETTINGS) {
      const rows = (await $.config.list()).filter(row => row.key.startsWith('mod-file-tree.'))
      const run = async (action: Action) => {
        const said = answer($, action.args ?? '')
        note = await said.then(said => `${MARK.ok} ${said || action.label}`).catch(error => `${MARK.warn} ${String(error)}`)
        $.ui.invalidate('ui.render')
      }
      return (
        <Box flexDirection="column" paddingX={1} minHeight={e.props.scroll.bodyRows} backgroundColor={THEME.bg}>
          {tabRow({ Box, Client, Text }, look.nerd, tabs(true, 0), still)}
          {sepText({ Text }, withMark(look, note) || fill(text.settingsHint, { sep: MARK.sep }), statusColor(note), 'status-line', { wrap: 'truncate-end' })}
          <Box marginTop={0}>{settingsBody({ Box, Button, Client, Text }, look, { rows, actions, working: false, run, previews, fields, still })}</Box>
          <Box key="footer-space" height={FOOTER_ROWS} flexShrink={0} />
          {paneFooter({ Box, Text }, hoveredTip, e.props.bodyColumns, e.props.scroll)}
        </Box>
      )
    }

    // Reading the log subscribes the pane to every tool call; a reload empties the copy, so it is read again.
    await $.state.get({ plugin: 'mod-file-tree', key: 'log' })
    const current = viewOf(await hydrate($))
    const rows = rowsOf(current, foldsOf(current), showReads)
    // Every file in the view, folded or not.
    const touched = current.files.filter(file => showReads || file.kind !== 'read').length
    const { glyph } = look

    const entry = (id: string, label: string, isOn: boolean, bg: string = THEME.surface1, extra: Partial<EntryProps> = {}) => (
      <Box key={`${id}-pad`}>
        <Client key={id} module="./entry.tsx" height={1} props={{ id, label, isOpen: isOn, bg, nerd: look.nerd, still, ...extra }} />
      </Box>
    )
    // A Nerd icon as a subpill before the label; safe mode has none, so the prop stays out.
    // A switch is the settings page's choice bar, so both read the same.
    const choiceBar = (key: string, options: { id: string; label: string; isOn: boolean; icon?: string; tip: string }[]) =>
      sharedChoiceBar({ Box, Button, Client, Text }, look, key, THEME.bg, options.map(option => ({
        key: option.id,
        isOn: option.isOn,
        // No icon subpill: it changes the options' widths between states, so the bar shifts on every switch.
        props: { id: option.id, label: option.label, still, nerd: look.nerd, tip: { glyph: look.glyph.icon[option.icon ?? ''] ?? look.glyph.title, label: option.label, text: option.tip } },
      })))

    const emptyText = (legit: string) => (loadError ? fill(text.unreadableWhy, { reason: loadError }) : legit)
    // The pane pads one column on both sides, the section its border and one more column.
    const width = Math.max(20, e.props.bodyColumns - 6)
    const tree =
      rows.length === 0
        ? <Text key="tree-empty" color={THEME.muted}>{emptyText(text.treeEmpty)}</Text>
        : (
            <Box key="lists" flexDirection="column">
              {chunksOf(listRows(current, rows, look, width)).map((chunk, n) => (
                <Client key={`list-${n}`} module="./list.tsx" height={chunk.length} props={{ rows: chunk, offset: n * LIST_CHUNK, still, nerd: look.nerd, width, glyph: look.glyph.icon.files ?? look.glyph.title, openLabel: text.openLabel }} />
              ))}
            </Box>
          )
    const root = rootOf(current, showReads)
    const rootName = root.split('/').pop() || String(await $.session.cwd().catch(() => '')).replace(/\\/g, '/').split('/').pop() || text.rootFallback

    const steps = stepsOfTurn(current, replayTurn)
    const at = Math.max(0, Math.min(index, steps.length - 1))
    const step = steps[at]
    const color = (op: Line['op']) => (op === '+' ? THEME.good : op === '-' ? THEME.alert : THEME.muted)
    const replay = !step
      ? <Text key="replay-empty" color={THEME.muted}>{emptyText(text.replayEmpty)}</Text>
      : (
          <Box key="replay-body" flexDirection="column">
            <Box key="replay-file" flexDirection="row" marginTop={1}>
              <Text color={THEME.accent} bold wrap="truncate-start">{withIcon(look, iconOf(step.path), step.path)}</Text>
            </Box>
            <Box key="replay-meta" flexDirection="row" columnGap={1}>
              {sepText({ Text }, [step.tool, step.note].filter(Boolean).join(` ${MARK.sep} `), THEME.muted, 'replay-meta-text')}
              {step.add > 0 ? <Text color={THEME.good}>{`+${step.add}`}</Text> : null}
              {step.del > 0 ? <Text color={THEME.alert}>{`−${step.del}`}</Text> : null}
            </Box>
            <Box key="replay-diff" flexDirection="column" marginTop={1}>
              {step.lines.length === 0 ? <Text color={THEME.muted}>{text.noLineChanges}</Text> : null}
              {step.lines.map((line, n) => (
                // Red text on the delete tint fails contrast, so only the sign carries the signal color.
                <Box key={`diff-${n}`} flexDirection="row" backgroundColor={line.op === '+' ? THEME.addBg : line.op === '-' ? THEME.delBg : undefined}>
                  <Text color={color(line.op)} bold={line.op === '+' || line.op === '-'}>{`${line.op === '~' ? ' ' : line.op === '-' ? '−' : line.op} `}</Text>
                  <Text color={line.op === ' ' || line.op === '~' ? THEME.muted : THEME.onSurface} wrap={wrapDiff ? 'wrap' : 'truncate-end'}>{line.t}</Text>
                </Box>
              ))}
            </Box>
          </Box>
        )

    // An edge stepper is plain text, so it neither lights nor posts a tip.
    const stepper = (id: string, label: string, isEdge: boolean, hue: string, place: 'lead' | 'trail', mark: string, tipText: string) => {
      const sub = place === 'lead' ? { subLead: mark, subLeadColor: hue } : { badge: { text: mark, color: hue, bg: mix(hue, THEME.surface3, LEGEND_WASH) } }
      const body = isEdge ? (
        <Box key={`${id}-edge`} flexDirection="row">
          {place === 'lead' ? subpill(elements, look.nerd, THEME.surface3, mark, `${id}-edge-mark`, THEME.muted) : null}
          <Text color={THEME.muted} backgroundColor={THEME.surface3}>{` ${label} `}</Text>
          {place === 'trail' ? subpill(elements, look.nerd, THEME.surface3, mark, `${id}-edge-mark`, THEME.muted) : null}
        </Box>
      ) : (
        entry(id, label, false, THEME.surface3, { idle: THEME.secondary, ...sub, tip: { glyph: mark, label, text: tipText } })
      )
      // The steppers sit in the card's top edge, on bg.
      return pill({ Box, Text }, look.nerd, THEME.surface3, body, `${id}-pill`, THEME.bg)
    }
    const replayNav = step ? (
      <Box key="replay-nav" flexDirection="row" columnGap={1}>
        {stepper('replay-prev', text.prev, at <= 0, THEME.accent, 'lead', glyph.back, text.prevTip)}
        <Text color={THEME.onSurface} bold>{fill(text.stepOf, { at: at + 1, total: steps.length })}</Text>
        {stepper('replay-next', text.next, at >= steps.length - 1, THEME.accent, 'trail', glyph.title, text.nextTip)}
      </Box>
    ) : null
    const replayTitle = fill(text.replayHeading, { sep: MARK.sep, n: steps.length, unit: steps.length === 1 ? text.editOne : text.editMany })

    // Keyed on folded, not open: the live fold keeps the edited folder open through a Fold all.
    const isAnyFolded = rows.some(row => row.isDir && row.isFolded)
    const foldToggle = (id: string, label: string, arrow: string, tipText: string) =>
      entry(id, label, false, THEME.bg, { idle: THEME.muted, lead: arrow, leadColor: THEME.accent, tip: { glyph: arrow, label, text: tipText } })
    const fold = !rows.some(row => row.isDir) ? null : isAnyFolded ? foldToggle('unfold-all', text.unfoldAll, glyph.more, text.unfoldAllTip) : foldToggle('fold-all', text.foldAll, glyph.less, text.foldAllTip)

    const hint =
      mode === 'tree'
        ? `${fill(text.hintTree, { sep: MARK.sep })}${showReads ? '' : fill(text.hintReadsHidden, { sep: MARK.sep })}`
        : fill(text.hintReplay, { sep: MARK.sep })

    return (
      <Box flexDirection="column" paddingX={1} minHeight={e.props.scroll.bodyRows} backgroundColor={THEME.bg}>
        <Box key="title-line" flexDirection="row" columnGap={1}>
          {tabRow({ Box, Client, Text }, look.nerd, tabs(false, touched), still)}
          {current.working ? entry('working', text.working, false, THEME.bg, { spinner: true, idle: THEME.muted }) : null}
        </Box>
        {sepText({ Text }, withMark(look, note) || hint, statusColor(note), 'status-line', { wrap: 'truncate-end' })}
        <Box key="tabs" flexDirection="row" columnGap={1} marginTop={1}>
          {choiceBar('view', [
            { id: 'tab-tree', label: text.tabTree, isOn: mode === 'tree', icon: 'files', tip: text.tabTreeTip },
            { id: 'tab-replay', label: text.tabReplay, isOn: mode === 'replay', icon: 'replay', tip: text.tabReplayTip },
          ])}
          {mode === 'tree'
            ? choiceBar('scope', [
                { id: 'scope-turn', label: text.scopeTurn, isOn: scope === 'turn', tip: text.scopeTurnTip },
                { id: 'scope-recent', label: fill(text.scopeRecent, { n: recentTurns }), isOn: scope === 'recent', tip: text.scopeRecentTip },
                { id: 'scope-session', label: text.scopeSession, isOn: scope === 'session', tip: text.scopeSessionTip },
              ])
            : null}
        </Box>
        {mode === 'tree'
          ? section(elements, look, 'tree', 'folder-open', rootName, tree, THEME.accent, { right: fold })
          : section(elements, look, 'replay', 'replay', replayTitle, replay, THEME.accent, { right: replayNav })}
        {mode === 'tree' ? <Box key="legend-push" flexGrow={1} /> : null}
        {mode === 'tree' ? (
          <Box key="legend" flexDirection="column">
            <Box key="legend-row" flexDirection="row" columnGap={1}>
              {(['changed', 'added', 'read'] as const).map(tone =>
                pill({ Box, Text }, look.nerd, mix(NAME_COLOR[tone], THEME.bg, LEGEND_WASH), <Text color={NAME_COLOR[tone]}>{look.nerd ? text.legend[tone] : ` ${text.legend[tone]} `}</Text>, `legend-${tone}`, THEME.bg),
              )}
              <Box key="legend-gap" flexGrow={1} />
              {pill({ Box, Text }, look.nerd, THEME.surface3, entry('session-reveal', text.sessionFolder, false, THEME.surface3, { idle: THEME.onSurface, subLead: look.glyph.icon.folder ?? look.glyph.reveal, subLeadColor: THEME.folder, tip: { glyph: look.glyph.icon.folder ?? look.glyph.reveal, label: text.sessionFolder, text: text.sessionFolderTip } }), 'session-reveal-pill', THEME.bg)}
            </Box>
          </Box>
        ) : null}
        <Box key="footer-space" height={FOOTER_ROWS} flexShrink={0} />
        {paneFooter({ Box, Text }, hoveredTip, e.props.bodyColumns, e.props.scroll)}
      </Box>
    )
  })
}

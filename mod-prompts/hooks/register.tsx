// mod-prompts / hooks/register.tsx, by v-amorim
// Registers the mod: wires the prompts sidebar, timeline, settings, jumps and toasts.
import type { ConfigValue, EngineInterface, Register } from 'claude-code'

import { bridgeOn, endBridge, startBridge, type BridgeRecord } from './bridge'
import { cardSpace, HEAD_ROWS, stickyCard } from './card'
import { isTipMessage, type EntryMessage, type EntryProps, type Tip } from './entry'
import { cardFill, detectNerd, FOOTER_ROWS, lookFor, paneFooter, section, sepText, titleEdge, withMark, type IconMode } from './look'
import { labelsOf, menuEntry, pill, pillRow, splitRow, tabRow, tipLine } from './pills'
import { settingChoice, settingsBody } from './settings'
import { TOAST_MS, ToastList, toastCards } from './toasts'
import { promptsOf, promptText, rowKey, targetOf, TranscriptRows, type Prompt } from './prompts'
import { bytesOf, CHUNK_BYTES, chunkArgv, utf8Length } from './tail'
import { GUTTER, timelineRows, type TimelineMessage, type TimelineProps } from './timeline'
import { fill, MARK, statusColor, THEME } from './theme'
import style from './style'
import text from './text'


// The icons setting (userConfig), fixed per activation: a change reloads the mod.
let iconMode: IconMode = 'auto'
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

const PANE = 'prompts'
const SETTINGS = 'prompts-settings'
// Claude Code draws a prompt under this id as it is sent, then under its uuid; only the uuid draw is listed.
const PLACEHOLDER = 'placeholder'

// Border, the number line and six lines of the prompt.
const CARD_ROWS = 8

// An entry click with this prefix flips the card of the prompt whose id follows.
const MORE = 'prompts-more:'

const STOPS_PER_CLIENT = 30

const PAGE_SIZE = 100

let transcript = ''
let transcriptRows = new TranscriptRows()
// The bytes of the file fed so far, and the unfinished line after them; a turn that added nothing reads nothing.
let fedBytes = 0
let carry = ''
// A file that could not be read at this size is not read again until it grows.
let failedSize = -1
// The short reason the last failed read gave, for the empty state.
let readError = ''
const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').trim().slice(0, 80)
// Read in full once, then in part; prompts drawn in between come from the rows Claude Code draws.
let isLoaded = false
// A turn ended, so the next read takes what it added.
let isStale = false
let prompts: Prompt[] = []
let selected = -1
// The page the timeline shows; -1 follows the open prompt.
let page = -1
// How many pages the last drawing had, so a pager click knows its bounds.
let pageCount = 1
let note = ''
// Row key -> the requestId Claude Code drew that prompt's row under, which a jump scrolls to.
const drawn = new Map<string, string>()

const isOpen = async ($: EngineInterface, id = PANE) => (await $.ui.panes()).some(pane => pane.id === id && pane.isPlaced)

// The session the prompts belong to. A /resume or /clear keeps the process and changes the id, so the old list must never show for the new one.
let listSession = ''

function startList(session: string, path = '') {
  listSession = session
  transcript = path
  transcriptRows = new TranscriptRows()
  fedBytes = 0
  carry = ''
  failedSize = -1
  readError = ''
  isLoaded = false
  isStale = false
  prompts = []
  selected = -1
  page = -1
  note = ''
  drawn.clear()
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

// Only the SessionStart record names the transcript, and the bridge delivers it; kept per session so a reload finds it again.
async function sessionStarted($: EngineInterface, record: BridgeRecord) {
  const session = String(record.session_id ?? '')
  const path = String(record.transcript_path ?? '')
  if (!session || !path) return
  // A compact keeps the same session and transcript, and the prompts learned since the read are already here.
  if (session !== listSession || path !== transcript) startList(session, path)
  await $.store.set(`transcript:${session}`, { path, at: await $.clock.now() }).catch(() => {})
  $.ui.invalidate('ui.render')
}

// Asking the id on every row would cost a round trip each, so rows ask after a session.end, or once this long has passed.
const SESSION_CHECK_MS = 500
let sessionCheckedAt = 0

async function followSession($: EngineInterface) {
  const now = Date.now()
  if (listSession && now - sessionCheckedAt < SESSION_CHECK_MS) return
  sessionCheckedAt = now
  const asked = listSession
  const session = String(await $.session.id().catch(() => listSession))
  // A SessionStart that switched the list while the id was on its way knows better than this answer.
  if (session !== listSession && asked === listSession) startList(session)
}

// One read at a time: two at once would feed the same lines twice.
let reading: Promise<void> = Promise.resolve()
const load = ($: EngineInterface) => (reading = reading.then(() => readMore($)).catch(() => {}))

// An open or a draw waits this long at most, so a long session's first read never holds up the panel; it redraws once the read lands.
const LOAD_WAIT_MS = 300
const loadAWhile = ($: EngineInterface) => Promise.race([load($), $.clock.sleep(LOAD_WAIT_MS).catch(() => {})])

// One fs.read takes a file up to this size.
const WHOLE_READ_BYTES = 4 * 1024 * 1024

// The file's text from byte `from` on; past one fs.read, only the first read streams the whole file, later ones take the new bytes.
async function readFrom($: EngineInterface, path: string, from: number, size: number) {
  if (size <= WHOLE_READ_BYTES) {
    const whole = String(await $.fs.read(path).catch(error => (readError ||= reasonOf(error), '')))
    if (whole) return from ? new TextDecoder().decode(new TextEncoder().encode(whole).subarray(from)) : whole
  }
  if (from > 0) {
    const parts: Uint8Array[] = []
    for (let at = from; at < size; at += CHUNK_BYTES) parts.push(bytesOf((await $.process.run(chunkArgv(path, at, Math.min(CHUNK_BYTES, size - at)))).stdout))
    const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
    parts.reduce((at, part) => (bytes.set(part, at), at + part.length), 0)
    return new TextDecoder().decode(bytes)
  }
  const isWindows = /^[A-Za-z]:|\\/.test(path)
  // cmd's type rejects forward slashes ("The syntax of the command is incorrect").
  const argv = isWindows ? ['cmd', '/c', 'type', path.replace(/\//g, '\\')] : ['cat', path]
  let text = ''
  for await (const chunk of $.process.spawn({ argv })) {
    if (chunk.stream === 'stdout') text += chunk.text
  }
  return text
}

async function readMore($: EngineInterface) {
  await followSession($)
  if (isLoaded && !isStale) return
  const session = listSession
  isStale = false
  const path = transcript || pathOf(await $.store.get(`transcript:${session}`).catch(() => '')) || (await findTranscript($))
  if (!path || session !== listSession) return
  transcript = path
  const { size } = await $.fs.stat(path).catch(() => ({ size: -1 }))
  if (size < 0 || size === failedSize || (isLoaded && size === fedBytes)) return
  // A file shorter than what was fed was rewritten, so it is read again from its start.
  if (size < fedBytes) {
    transcriptRows = new TranscriptRows()
    fedBytes = 0
    carry = ''
  }
  const from = fedBytes
  readError = ''
  const fresh = await readFrom($, path, from, size).catch(error => (readError ||= reasonOf(error), ''))
  if (session !== listSession || path !== transcript) return
  // A failed read leaves the transcript unloaded until the file grows, so a draw does not read it again and again.
  if (!fresh) {
    failedSize = size
    $.ui.invalidate('ui.render')
    return
  }
  failedSize = -1
  readError = ''
  carry = transcriptRows.append(carry + fresh)
  fedBytes = from + utf8Length(fresh)
  isLoaded = true
  $.ui.invalidate('ui.render')
  // Prompts drawn since the read, not yet in the file, stay at the end.
  const read = promptsOf(transcriptRows.rows)
  // A queued prompt is drawn under another id than the file's, so a drawn one also matches it by its text.
  const known = new Set([...read.map(prompt => rowKey(prompt.id)), ...read.filter(prompt => prompt.isQueued).map(prompt => sameText(prompt.text))])
  prompts = [...read, ...prompts.filter(prompt => !known.has(rowKey(prompt.id)) && !known.has(sameText(prompt.text)))]
  if (selected < 0 || selected >= prompts.length) selected = prompts.length - 1
}

const sameText = (text: string) => `text:${text.replace(/\[Image #\d+\]/g, '').replace(/\s+/g, ' ').trim()}`

// A turn's length as the fold writes it: seconds, then minutes and seconds.
const duration = (ms: number) => {
  const seconds = Math.round(ms / 1000)
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

// A saved change reloads this mod, which redraws the panel with the new value.
async function saveSetting($: EngineInterface, key: string, value: ConfigValue) {
  const row = (await $.config.list()).find(each => each.key === key)
  const result = await $.config.set({ key, value })
  note = 'deny' in result && result.deny ? `${MARK.warn} ${result.deny}` : `${MARK.ok} ${fill(text.settingSaved, { label: row?.label ?? key })}`
  $.ui.invalidate('ui.render')
}

// The panel's title line: the list and its settings as tabs, the shown one open.
const tabs = (isSettings: boolean) => [
  { id: 'prompts-tab', label: text.paneTitle, icon: look.glyph.icon.prompt ?? look.glyph.title, isOpen: !isSettings, count: prompts.length, tip: { glyph: look.glyph.icon.prompt ?? look.glyph.title, label: text.paneTitle, text: text.promptsTabTip } },
  { id: 'prompts-settings', label: text.settingsTab, icon: look.glyph.gear, isOpen: isSettings, tip: { glyph: look.glyph.gear, label: text.settingsTab, text: text.settingsTabTip } },
]

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

// The command and the bar entry both toggle. An unplaced pane is waiting, not open.
async function togglePane($: EngineInterface) {
  if (await isOpen($)) {
    await $.ui.close({ id: PANE })
    await $.state.set({ plugin: 'mod-prompts', key: 'pane' }, false)
    return
  }
  if (await isOpen($, SETTINGS)) await $.ui.close({ id: SETTINGS })
  note = ''
  selected = -1
  page = -1
  await loadAWhile($)
  const opened = await $.ui.open({ id: PANE, title: text.paneTitle, closeOnEscape: true })
  if (!opened.isPlaced) $.ui.toast(text.panelWaiting)
  await $.state.set({ plugin: 'mod-prompts', key: 'pane' }, opened.isPlaced)
}

// `/mod-prompts settings` and the title row's pill toggle the settings panel, which takes the sidebar's place.
async function toggleSettings($: EngineInterface) {
  if (await isOpen($, SETTINGS)) {
    await $.ui.close({ id: SETTINGS })
    await $.state.set({ plugin: 'mod-prompts', key: 'pane' }, false)
    return
  }
  if (await isOpen($)) await $.ui.close({ id: PANE })
  note = ''
  const opened = await $.ui.open({ id: SETTINGS, title: text.settingsPaneTitle, closeOnEscape: true })
  if (!opened.isPlaced) $.ui.toast(text.settingsWaiting)
  await $.state.set({ plugin: 'mod-prompts', key: 'pane' }, opened.isPlaced)
}

// Scrolls the transcript to the prompt's row; Claude Code allows it only with the person's press behind it.
async function jump($: EngineInterface, index: number) {
  const prompt = prompts[index]
  if (!prompt) return
  selected = index
  const result = await $.ui.scroll({ to: { requestId: targetOf(drawn, prompt.id) }, block: 'start' }).catch((error: Error) => ({ deny: error.message }))
  note = result.deny ? `${MARK.warn} ${result.deny}` : `${MARK.ok} ${fill(text.jumped, { n: index + 1 })}`
  $.ui.invalidate('ui.render')
}

const oneLine = (text: string, width: number) => {
  const flat = text.replace(/\s+/g, ' ')
  return flat.length > width ? `${flat.slice(0, Math.max(0, width - 1))}…` : flat
}

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

// The prompt whose card shows every line; a click on its control flips it.
let fullPrompt = ''

const clock = (at?: string) => {
  const date = at ? new Date(at) : undefined
  return date && !Number.isNaN(date.getTime()) ? `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` : ''
}

// True while the pointer is on this mod's pill entry, which then shows its tip above the row.
let tipShown = false
// The control under the pointer in the pane, which the footer describes.
let hoveredTip: Tip | null = null
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

const toasts = new ToastList('prompts')
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

export const register: Register = (on, options) => {
  still = options.animations === false
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
    try {
      bridgeOn('SessionStart', record => sessionStarted($, record))
      await startBridge($, 'mod-prompts')
      await loadLook($)
      await $.command.register({ name: 'mod-prompts', description: text.commandDescription, argumentHint: '[settings]' })
      await pruneTranscripts($)
      // The bar entry reads this; an unload drops the pane without raising ui.close here.
      await $.state.set({ plugin: 'mod-prompts', key: 'pane' }, await isOpen($))
      // A hot reload leaves an open pane on its old drawing until something redraws it.
      $.ui.invalidate('ui.render')
    } catch {
      // The pane stays as it was.
    }

    return next(e)
  })

  // A /resume or /clear ends this session; the next row asks for the id at once.
  on('session.end', async ($, e, next) => {
    sessionCheckedAt = 0
    await endBridge($, e.sessionId)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      // A closed pane reads the file when it next opens.
      isStale = true
      if (await isOpen($)) {
        $.clock.after(0, async () => {
          await load($)
          $.ui.invalidate('ui.render')
        })
      }
    }

    return next(e)
  })

  // Each prompt row as Claude Code draws it, so a jump scrolls to the id the row really has.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    await loadLook($)
    await followSession($)
    drawn.set(rowKey(e.requestId), e.requestId)
    // A prompt sent after the read joins the list as its row draws.
    const text = e.props.origin?.kind === 'composer' ? promptText(String(e.props.text ?? '')) : undefined
    // A row redrawn under its id is already listed, and so is a queued prompt drawn again under another id.
    if (isLoaded && text && e.requestId !== PLACEHOLDER && !prompts.some(prompt => rowKey(prompt.id) === rowKey(e.requestId) || (prompt.isQueued && sameText(prompt.text) === sameText(text)))) {
      prompts = [...prompts, { id: e.requestId, text, at: new Date().toISOString(), tools: 0, added: 0, removed: 0 }]
      $.clock.after(0, () => $.ui.invalidate('ui.render'))
    }

    return next(e)
  })

  on('command.run', { command: 'mod-prompts' }, async ($, e) => {
    if ((e.args ?? '').trim() === 'settings') await toggleSettings($)
    else await togglePane($)

    return { text: '' }
  })

  on('ui.close', async ($, e, next) => {
    try {
      if (e.id === PANE || e.id === SETTINGS) await $.state.set({ plugin: 'mod-prompts', key: 'pane' }, await isOpen($, e.id === PANE ? SETTINGS : PANE))
    } catch {
      // The pane stays as it was.
    }

    return next(e)
  })

  // Deferred past this dispatch, so this mod's own state write is not nested in another plugin's.
  on('state.set', async ($, e, next) => {
    // The declared state names no other mod's pane, so the types narrow this event to never.
    if (e.key === 'pane' && e.plugin !== 'mod-prompts' && (e as { value?: unknown }).value === true) {
      $.clock.after(0, async () => {
        const wasOpen = (await isOpen($)) || (await isOpen($, SETTINGS))
        if (!wasOpen) return
        await $.ui.close({ id: PANE })
        await $.ui.close({ id: SETTINGS })
        await $.state.set({ plugin: 'mod-prompts', key: 'pane' }, false)
      })
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    await loadLook($)
    const hidden = await $.state.get({ plugin: 'mod-menu', key: 'hidden' })
    if (e.surface !== 'terminal' || e.props.hasSurvey) return next(e)
    if (hidden.value === true) {
      if (toasts.items.length === 0) return next(e)
      const { Box, Client, Text } = $.ui.resolve(e)
      return <Box key="toasts-prompts" flexDirection="column">{toastCards({ Box, Client, Text }, toasts, look, text.tipToast)}{await next(e)}</Box>
    }
    const nerd = look.nerd
    const labels = labelsOf((await $.state.get({ plugin: 'mod-menu', key: 'labels' })).value)

    const { Box, Client, Text } = $.ui.resolve(e)
    // Reading the value subscribes the bar to redraws; the look trusts the pane list itself.
    await $.state.get({ plugin: 'mod-prompts', key: 'pane' })
    const shown = (await isOpen($)) || (await isOpen($, SETTINGS))
    const { group, row, rest, tip } = splitRow(await next(e))
    // Opening the pane from here queues nothing, so the entry stays live mid-turn.
    const entry = menuEntry({ Box, Client, Text }, nerd, 'prompts', { label: text.pillLabel, labels, isOpen: shown, idle: THEME.pill, isBusy: isOpening, still })

    return pillRow({ Box, Client, Text }, nerd, [entry, ...group], row, [...toastCards({ Box, Client, Text }, toasts, look, text.tipToast), ...rest], toastTip ? tipLine({ Box, Text }, toastTip) : tipShown ? tipLine({ Box, Text }, text.tip) : tip, e.props.bodyColumns)
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
      const isToast = Boolean(id?.startsWith('toast-prompts-'))
      toastTip = isToast ? `${label}: ${tipText}` : ''
      if (toastTip) expireBandTip($)
      hoveredTip = !isToast && id && glyph !== undefined && label && tipText ? { glyph, label, text: tipText } : null
      $.ui.invalidate('ui.render')
      return next(e)
    }
    const hover = e.data as { type?: string; id?: string; isOver?: boolean }
    if (hover?.type === 'menu-hover' && hover.id === 'prompts') {
      tipShown = hover.isOver === true
      if (tipShown) expireBandTip($)
      $.ui.invalidate('ui.render')
    }
    try {
      const message = e.data as EntryMessage
      if (message?.type === 'menu-entry' && message.id === 'prompts') await openingPane($)
      if (message?.type === 'menu-entry' && message.id === 'prompts-settings' && !(await isOpen($, SETTINGS))) await toggleSettings($)
      if (message?.type === 'menu-entry' && message.id === 'prompts-tab' && !(await isOpen($))) await togglePane($)
      if (message?.type === 'menu-entry' && (message.id === 'prompts-page-prev' || message.id === 'prompts-page-next')) {
        const shown = page < 0 ? Math.floor(Math.max(0, selected) / PAGE_SIZE) : page
        page = Math.max(0, Math.min(pageCount - 1, shown + (message.id === 'prompts-page-next' ? 1 : -1)))
        $.ui.invalidate('ui.render')
      }
      if (message?.type === 'menu-entry' && message.id.startsWith(MORE)) {
        const id = message.id.slice(MORE.length)
        fullPrompt = fullPrompt === id ? '' : id
        $.ui.invalidate('ui.render')
      }
      const change = settingChoice(e.data)
      if (change) await saveSetting($, change.key, change.value)
    } catch {
      // The pane stays as it was.
    }

    return next(e)
  })

  on('ui.message', { requestId: 'prompts' }, async ($, e, next) => {
    const message = e.data as TimelineMessage
    if (message?.type === 'select' && message.index !== selected) {
      selected = message.index
      $.ui.invalidate('ui.render')
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    await loadLook($)
    if (e.requestId !== PANE && e.requestId !== SETTINGS) return next(e)
    if (isOpening) $.clock.after(0, () => endOpening($))
    // @ts-expect-error The host's types omit Client from a Pane's elements, yet a Pane draws it.
    const { Box, Button, Client, Text } = $.ui.resolve(e)

    if (e.requestId === SETTINGS) {
      const rows = (await $.config.list()).filter(row => row.key.startsWith('mod-prompts.'))
      return (
        <Box flexDirection="column" paddingX={1} minHeight={e.props.scroll.bodyRows} backgroundColor={THEME.bg}>
          {tabRow({ Box, Client, Text }, look.nerd, tabs(true), still)}
          {sepText({ Text }, withMark(look, note) || fill(text.settingsHint, { sep: MARK.sep }), statusColor(note), 'status-line', { wrap: 'truncate-end' })}
          <Box marginTop={0}>{settingsBody({ Box, Button, Client, Text }, look, { rows, actions: [], working: false, run: async () => {}, still })}</Box>
          <Box key="footer-space" height={FOOTER_ROWS} flexShrink={0} />
          {paneFooter({ Box, Text }, hoveredTip, e.props.bodyColumns, e.props.scroll)}
        </Box>
      )
    }

    // A reload resets module state while the pane stays open, so read the transcript again.
    await followSession($)
    if (prompts.length === 0) await loadAWhile($)

    // Pane padding, the section's border and padding, the gutter and the dot.
    const width = Math.max(10, e.props.bodyColumns - 2 - 4 - GUTTER - 2)
    const current = prompts[selected]
    const stops = prompts.map((prompt, index) => ({ index, time: clock(prompt.at), text: oneLine(prompt.text, width), label: fill(text.stopLabel, { n: index + 1 }), tip: text.stopTip }))
    const marks = { dot: MARK.stop, openDot: MARK.stopOpen }
    pageCount = Math.max(1, Math.ceil(stops.length / PAGE_SIZE))
    const shownPage = Math.min(pageCount - 1, page < 0 ? Math.floor(Math.max(0, selected) / PAGE_SIZE) : page)
    const first = shownPage * PAGE_SIZE
    const onPage = stops.slice(first, first + PAGE_SIZE)
    const hasOpen = selected >= first && selected < first + PAGE_SIZE
    const before = hasOpen ? onPage.filter(stop => stop.index <= selected) : onPage
    const after = hasOpen ? onPage.filter(stop => stop.index > selected) : []
    // At the first or last page the button stays in its place, dimmed; a press there changes nothing.
    const pager = (id: string, label: string, tip: string, isEdge: boolean) => (
      <Client key={id} module="./entry.tsx" height={1} props={{ id, label, isOpen: false, bg: THEME.surface3, idle: isEdge ? THEME.muted : THEME.secondary, still, tip: { glyph: look.glyph.icon.prompt ?? look.glyph.title, label, text: tip } } satisfies EntryProps} />
    )
    // The engine caps how large one Client's tree may serialize, so a long session's stops spread over several Clients.
    const timeline = (key: string, list: typeof stops) =>
      Array.from({ length: Math.ceil(list.length / STOPS_PER_CLIENT) }, (_, n) => {
        const chunk = list.slice(n * STOPS_PER_CLIENT, (n + 1) * STOPS_PER_CLIENT)
        return <Client key={n === 0 ? key : `${key}-${n}`} module="./timeline.tsx" height={timelineRows(chunk.length)} props={{ stops: chunk, selected, glyph: look.glyph.icon.prompt ?? look.glyph.title, still, ...marks } satisfies TimelineProps} />
      })
    const stat = (key: string, body: unknown) => pill({ Box, Text }, look.nerd, THEME.surface3, body, key, THEME.surface1)
    const stats = current
      ? [
          current.durationMs !== undefined ? stat('open-time', <Text color={THEME.secondary}>{duration(current.durationMs)}</Text>) : null,
          current.added || current.removed
            ? stat('open-counts', (
                <Text>
                  <Text color={THEME.good}>{current.added ? `+${current.added}` : ''}</Text>
                  <Text color={THEME.alert}>{current.added && current.removed ? ' ' : ''}{current.removed ? `−${current.removed}` : ''}</Text>
                </Text>
              ))
            : null,
          current.tools ? stat('open-tools', <Text color={THEME.secondary}>{fill(text.tools, { count: current.tools })}</Text>) : null,
        ].filter(Boolean)
      : []

    // The card's text is the pane's width less its border and padding; a prompt past its rows gives the last one to the count.
    const pagerRows = pageCount > 1 ? 1 : 0
    const textRows = CARD_ROWS - 2 - pagerRows
    const wrapped = current ? wrapRows(current.text, Math.max(10, e.props.bodyColumns - 6)) : []
    const rowsNeeded = wrapped.length
    const isClipped = rowsNeeded > textRows
    // Opened, the card grows to every row, as far as the pane has room for it.
    const isFull = isClipped && current !== undefined && fullPrompt === current.id
    const roomRows = Math.max(textRows, e.props.scroll.bodyRows - HEAD_ROWS - FOOTER_ROWS - 4 - pagerRows)
    const textShown = isFull ? Math.min(rowsNeeded, roomRows) : textRows
    const cardRows = CARD_ROWS + (textShown - textRows)
    const shownRows = wrapped.slice(0, textShown)
    const moreId = `${MORE}${current?.id ?? ''}`
    const moreLabel = isFull ? text.showLess : fill(text.cardMore, { n: rowsNeeded - textRows })
    const moreArrow = isFull ? look.glyph.less : look.glyph.more
    const moreControl = (
      <Client key={moreId} module="./entry.tsx" width={[...moreLabel].length + 4} height={1} props={{ id: moreId, label: moreLabel, lead: moreArrow, leadColor: THEME.accent, isOpen: false, bg: cardFill(), idle: THEME.muted, still, nerd: look.nerd, tip: { glyph: moreArrow, label: moreLabel, text: isFull ? text.tipShowLess : text.tipShowAll } } satisfies EntryProps} />
    )

    // Mouse only: the jump is a Button, since a scroll needs the person's press behind it; a click on a stop opens it.
    return (
      <Box flexDirection="column" paddingX={1} minHeight={e.props.scroll.bodyRows} backgroundColor={THEME.bg}>
        {tabRow({ Box, Client, Text }, look.nerd, tabs(false), still)}
        {sepText({ Text }, note || fill(text.hint, { sep: MARK.sep }), statusColor(note), 'status-line', { wrap: 'truncate-end' })}
        {prompts.length === 0 ? <Text color={THEME.muted}>{failedSize > 0 ? (readError ? fill(text.unreadableWhy, { reason: readError }) : text.unreadable) : text.empty}</Text> : null}
        {current ? cardSpace({ Box }, cardRows) : null}
        {section({ Box, Text }, look, 'timeline', '', text.thisSession, [
          before.length > 0 ? (
            timeline('timeline-before', before)
          ) : null,
          current && hasOpen ? (
            <Box key="open" flexDirection="row" paddingLeft={GUTTER} columnGap={1}>
              <Text color={style.colors.pills.separator}>{after.length > 0 ? MARK.rail : ' '}</Text>
              <Box key="open-stats" flexDirection="row" columnGap={1} flexGrow={1}>
                {stats}
              </Box>
              {/* A Button, not an Entry: a transcript scroll needs the person's press, and a Client click is refused as not person-initiated. */}
              {/* A Button takes no color prop; its scoped hover inverts it, so the whole pill lights with its caps. */}
              <Box key="open-jump-pill" flexShrink={0}>
                {pill({ Box, Text }, look.nerd, THEME.surface3, (
                  <Button key="open-jump" label={look.nerd ? MARK.open : ` ${MARK.open} `} plain hover={{ scope: 'open-jump-box', color: THEME.accent, inverse: true }} onPress={() => jump($, selected)} />
                ), 'open-jump-box', THEME.surface1, THEME.accent)}
              </Box>
            </Box>
          ) : null,
          after.length > 0 ? (
            timeline('timeline-after', after)
          ) : null,
        ])}
        {current
          ? [stickyCard({ Box, Text }, e.props.scroll.offset, e.props.bodyColumns, cardRows, [
              <Box key="card-text" height={shownRows.length} flexDirection="column" overflow="hidden" flexShrink={0}>
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
              </Box>,
              // The pager rides in the pinned card, so it stays in view however far the timeline scrolls.
              pageCount > 1 ? (
                <Box key="pager" flexDirection="row" columnGap={1} flexShrink={0}>
                  {pill({ Box, Text }, look.nerd, THEME.surface3, pager('prompts-page-prev', text.pagePrev, text.pagePrevTip, shownPage === 0), 'pager-prev', cardFill())}
                  {pill({ Box, Text }, look.nerd, THEME.surface3, pager('prompts-page-next', text.pageNext, text.pageNextTip, shownPage === pageCount - 1), 'pager-next', cardFill())}
                  {sepText({ Text }, fill(text.page, { page: shownPage + 1, pages: pageCount, from: first + 1, to: first + onPage.length, sep: MARK.sep }), THEME.muted, 'page-count')}
                </Box>
              ) : null,
            ]),
              <Box key="card-edge-wrap" position="absolute" top={Math.max(HEAD_ROWS, e.props.scroll.offset)} left={1} width={Math.max(10, e.props.bodyColumns - 2)} height={1}>
                {titleEdge({ Box, Text }, look, 'card', 'prompt', fill(text.cardNumber, { n: selected + 1 }), clock(current.at), 0)}
              </Box>]
          : null}
        <Box key="footer-space" height={FOOTER_ROWS} flexShrink={0} />
        {paneFooter({ Box, Text }, hoveredTip, e.props.bodyColumns, e.props.scroll, current && hasOpen ? [{ scope: 'open-jump-box', tip: { glyph: MARK.open, label: text.jumpLabel, text: text.jumpTip } }] : [])}
      </Box>
    )
  })
}

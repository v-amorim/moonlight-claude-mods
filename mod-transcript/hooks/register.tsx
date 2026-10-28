// mod-transcript / hooks/register.tsx, by v-amorim
// Registers the transcript's drawing, commands, settings pane and click handling with the engine.
import type { ConfigValue, EngineInterface, ModelApiError, Register, RenderElement } from 'claude-code'

import { cells, cut, fit, wrapWords } from './cells'
import type { BarMessage, BarProps } from './bar'
import type { Chip, ChipsMessage, ChipsProps } from './chips'
import { copyWidth, type CopyHoverMessage, type CopyMessage, type CopyProps, type CopyTipMessage } from './copy'
import type { EdgeProps } from './edge'
import type { DotProps } from './dot'
import type { FoldProps } from './fold'
import type { LabelPart, LabelProps } from './label'
import { pillWidth, type NumberProps } from './number'
import { codeCard, calloutCard, detailsCard, footnoteRows, headingRow, ruleRow } from './blocks'
import { diagramPage, isMermaid, openCommands } from './diagram'
import { cutPieces, languageForPath, previewPieces, useTheme, type Piece as TokenPiece } from './hilite'
import { PathLinks, pathTokens } from './links'
import { fileResult, resultCard } from './results'
import { activeLabel, listThemes, loadTheme, type ThemeHost } from './vstheme'
import { themeRows, type ThemesMessage, type ThemesProps } from './themes'
import { entryCells, isTipMessage, tipText, type EntryMessage, type EntryProps, type Tip, type TipMessage } from './entry'
import { cardFill, detectNerd, FOOTER_ROWS, lookFor, paneFooter, section, type IconMode, withMark } from './look'
import { pillRow, splitRow, tabRow, tipLine } from './pills'
import { actionReveals, settingChoice, settingsBody, type Action, type Previews } from './settings'
import style from './style'
import text from './text'
import { TOAST_MS, ToastList, toastCards } from './toasts'
import { announceView, viewing } from './view'
import { tokenizeLine, type Role } from './shell'
import { detectWedge, FILLED, OUTLINE, type Wedge } from './wedge'
import { CAPS, fill, MARK, mix, statusColor, SYNTAX, THEME, WASH } from './theme'
import { copyChoices, copyText, type CopyChoice } from './clip'
import { markPieces, paintOf, type Piece } from './mark'
import { proseBlock, type Inline } from './prose'
import { richBlocks, tableBlock, tableMinWidth, unsupported, type Block, type Table } from './table'
import { callTime, commandOf, diffStat, elapsed, isPrompt, rowKey, timeOfDay, toolLabel, turnKinds, turnLine, turnThoughts, TurnLog, type Turn } from './turns'
import { apiErrorAction, completeLines, hexColors, questionsOf, reportOf, senderTaskOf, statusesOf, withNotice, type Notice, type Question, type Report } from './rows'
import { bridgeOn, endBridge, startBridge, type BridgeRecord } from './bridge'
import { bytesOf, CHUNK_BYTES, chunkArgv, utf8Length } from './tail'

let transcript = ''
let log = new TurnLog()
let isLoaded = false
// How many bytes of the transcript are fed, and whether its last line was still unfinished at the last read.
let fedBytes = 0
let isPartial = false
// The session the log belongs to. A /resume or /clear keeps the process and changes the id, so the old log must never draw the new rows.
let logSession = ''
// Until the transcript is read, turns come from the in-memory messages: a row that folds later off screen keeps its height and eats the scroll.
let guessing: Promise<void> | null = null
const guess = ($: EngineInterface) => {
  const session = logSession
  return (guessing ??= $.session.messages().then(messages => {
    if (!isLoaded && session === logSession) log = TurnLog.fromMessages(messages)
  }).catch(() => {
    // Without the messages, rows draw as before: unfolded until the transcript is read.
  }))
}
let working = false
// The engine's expanded view (ctrl+o, --verbose) draws every row in full, so the rows pass through there.
let isFullView = false
// Calls a hook or the person refused (PermissionDenied): an error the person chose, drawn neutral.
const declined = new Set<string>()
type ApiFailure = { error: ModelApiError; details: string; text: string }
// The API error that ended the last turn (StopFailure); the reply row with its text draws as one line.
let apiFailure: ApiFailure | null = null
// The person's settings (userConfig), fixed per activation: a change reloads the mod.
let foldTurns = true
let foldTools = true
let showTimes = true
let expandLive = true
let showCopy = true
let showNumbers = true
// The animations setting, off: chips switch hover colors at once and the running dot stays lit.
let still = false
let iconMode: IconMode = 'auto'
// The code_theme setting: a VS Code theme label, or empty to follow the editor's own.
let codeTheme = ''
// What the session's disk said about the paths replies name; a reply draws a path's link once the path is known to exist.
const paths = new PathLinks()
// The installed theme labels and the one VS Code uses, scanned each time the Settings pane opens.
let themeList: Promise<{ labels: string[]; active: string | undefined }> | null = null
let isThemesOpen = false
let look = lookFor(false)
let wedge: Wedge = FILLED
type Kind = 'turns' | 'tools'
// For /mod-transcript debug: each drawn row's component and id, and whether it landed in a turn.
const seen = new Map<string, boolean>()
// Each task's notice, and the tasks with a report drawn; see taskRow.
const notices = new Map<string, Notice>()
const reported = new Set<string>()

const PANE = 'toggle-settings'
let actions: Action[] = []
let previews: Previews | undefined
let note = ''

// The control under the pointer, from its tip post: the band's tip row and the Settings footer show it.
let hovered: TipMessage | null = null
const toasts = new ToastList('transcript')
const hoveredTip = (): Tip | null => (hovered?.id && hovered.label ? { glyph: hovered.glyph ?? '', label: hovered.label, text: hovered.text ?? '' } : null)

const isPaneOpen = async ($: EngineInterface) => (await $.ui.panes()).some(pane => pane.id === PANE && pane.isPlaced)

// `/mod-transcript settings` toggles the panel; an unplaced pane is waiting, not open.
async function toggleSettings($: EngineInterface) {
  if (await isPaneOpen($)) {
    await $.ui.close({ id: PANE })
    await $.state.set({ plugin: 'mod-transcript', key: 'pane' }, false)
    return
  }
  note = ''
  themeList = null
  const showcase = await $.fs.read(`${$.plugin.root}/showcase.json`).then(text => JSON.parse(String(text))).catch(() => null)
  previews = showcase?.previews
  actions = (Array.isArray(showcase?.actions) ? showcase.actions : []).map((action: Action) => ({ ...action, isLocal: action.command === 'mod-transcript' }))
  const result = await $.ui.open({ id: PANE, title: text.panePlacedTitle, closeOnEscape: true })
  if (!result.isPlaced) $.ui.toast(fill(text.paneWaiting, { reason: String(result.reason) }))
  await $.state.set({ plugin: 'mod-transcript', key: 'pane' }, result.isPlaced)
}

// One fs.read takes a file up to this size.
const WHOLE_READ_BYTES = 4 * 1024 * 1024

// The text from byte `from` on ('' for none, null when unreadable); past one fs.read, only the first read streams the whole file.
async function readTranscript($: EngineInterface, from: number): Promise<{ text: string | null; size: number }> {
  const size = transcript ? ((await $.fs.stat(transcript).catch(() => null))?.size ?? 0) : 0
  if (!size || size <= from) return { text: '', size }
  if (size <= WHOLE_READ_BYTES) {
    const whole = String(await $.fs.read(transcript).catch(() => ''))
    if (whole) return { text: from ? new TextDecoder().decode(new TextEncoder().encode(whole).subarray(from)) : whole, size }
  }
  if (from > 0) {
    const parts: Uint8Array[] = []
    for (let at = from; at < size; at += CHUNK_BYTES) {
      const { stdout } = await $.process.run(chunkArgv(transcript, at, Math.min(CHUNK_BYTES, size - at)))
      parts.push(bytesOf(stdout))
    }
    const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
    parts.reduce((at, part) => (bytes.set(part, at), at + part.length), 0)
    return { text: new TextDecoder().decode(bytes), size }
  }
  const isWindows = /^[A-Za-z]:|\\/.test(transcript)
  // cmd's type rejects forward slashes ("The syntax of the command is incorrect").
  const argv = isWindows ? ['cmd', '/c', 'type', transcript.replace(/\//g, '\\')] : ['cat', transcript]
  let text = ''
  for await (const chunk of $.process.spawn({ argv })) {
    if (chunk.stream === 'stdout') text += chunk.text
  }
  return { text: text || null, size }
}

function startLog(session: string, path = '') {
  logSession = session
  transcript = path
  log = new TurnLog()
  isLoaded = false
  fedBytes = 0
  isPartial = false
  guessing = null
  working = false
  endedPrompt = ''
  apiFailure = null
  seen.clear()
}

// Asking the id on every row slowed scrolling, so rows ask after a session.end, or once this long has passed.
const SESSION_CHECK_MS = 500
let sessionCheckedAt = 0

// A new session's rows can draw before its SessionStart arrives, so rows check the id before using the log.
async function followSession($: EngineInterface) {
  const now = Date.now()
  if (logSession && now - sessionCheckedAt < SESSION_CHECK_MS) return
  sessionCheckedAt = now
  const asked = logSession
  const session = await $.session.id().catch(() => logSession)
  // A SessionStart that switched the log while the id was on its way knows better than this answer.
  if (session === logSession || asked !== logSession) return
  startLog(session)
  // The session's SessionStart may never come, so its transcript is looked up by id.
  $.clock.after(0, () => void load($))
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

// One read at a time: two at once would feed the same lines twice.
let reading: Promise<void> = Promise.resolve()
const load = ($: EngineInterface) => (reading = reading.then(() => readMore($)).catch(() => {}))

// A startup hook waits this long at most, so a long session's read never holds up the start; rows fold from the guess meanwhile.
const LOAD_WAIT_MS = 300
const loadAWhile = ($: EngineInterface) => Promise.race([load($), $.clock.sleep(LOAD_WAIT_MS).catch(() => {})])

// Later reads feed only the text after what was fed; a failed read leaves the log unloaded for the next turn.
async function readMore($: EngineInterface) {
  await followSession($)
  if (isLoaded && !isPartial) return
  const session = logSession
  const path = transcript || pathOf(await $.store.get(`transcript:${session}`).catch(() => '')) || (await findTranscript($))
  // A switch while this read waited makes it another session's.
  if (session !== logSession) return
  transcript = path
  const readAt = Date.now()
  lastRead = `reading ${path}`
  const failed = (error: Error) => {
    lastRead = `read failed after ${Date.now() - readAt} ms: ${error?.message ?? error}`
    return { text: null, size: 0 }
  }
  let from = isLoaded ? fedBytes : 0
  let read = await readTranscript($, from).catch(failed)
  // A file shorter than what was fed was rewritten, so it is read again from its start.
  if (read.text !== null && read.size < fedBytes) {
    isLoaded = false
    isPartial = false
    from = 0
    read = await readTranscript($, 0).catch(failed)
  }
  const fresh = read.text
  if (fresh === null || session !== logSession || path !== transcript) return
  const fedAt = Date.now()
  const { lines, rest } = completeLines(fresh)
  // A line unfinished through two reads is taken as it stands: feed drops it when it is not JSON.
  const isStale = isPartial && rest.length > 0
  // The first read builds its log aside, so rows keep drawing from the guess until it is whole.
  const target = isLoaded ? log : new TurnLog()
  const fed = isStale ? [...lines, rest] : lines
  for (let at = 0; at < fed.length; at += FEED_SLICE) {
    for (const line of fed.slice(at, at + FEED_SLICE)) target.feed(line)
    // A long session has tens of thousands of rows; feeding them in one go stalled every row draw meanwhile.
    if (at + FEED_SLICE < fed.length) {
      await $.clock.sleep(0)
      if (session !== logSession || path !== transcript) return
    }
  }
  log = target
  fedBytes = from + utf8Length(fresh) - (isStale ? 0 : utf8Length(rest))
  isPartial = rest.length > 0 && !isPartial
  isLoaded = true
  lastRead = `last read: ${fresh.length} chars from byte ${from} in ${fedAt - readAt} ms, ${lines.length} lines fed in ${Date.now() - fedAt} ms`
  $.ui.invalidate('ui.render')
}

const FEED_SLICE = 2000

// Only the SessionStart record names the transcript, and the bridge delivers it; the store keeps it per session so a reload finds it again.
async function sessionStarted($: EngineInterface, record: BridgeRecord) {
  const session = String(record.session_id ?? '')
  const path = String(record.transcript_path ?? '')
  if (!session) return
  // A compact keeps the same session and file, which the log already holds; so does a read that found the file by its id before this record came, in slashes of its own.
  const isNew = session !== logSession || path.replace(/\\/g, '/') !== transcript.replace(/\\/g, '/') || !isLoaded
  if (isNew) startLog(session, path)
  await $.store.set(`transcript:${session}`, { path, at: await $.clock.now() }).catch(() => {})
  if (isNew) await loadAWhile($)
  // SessionStart comes between turns, so whatever the transcript holds has ended.
  markEnded()
}

// A replay after a reload hands over the last record again; a set holds the id once.
function permissionDenied($: EngineInterface, record: BridgeRecord) {
  if (typeof record.tool_use_id !== 'string' || !record.tool_use_id) return
  declined.add(record.tool_use_id)
  $.ui.invalidate('ui.render')
}

// The reply row draws the failure only where its text matches, so a replayed record changes nothing.
function stopFailed($: EngineInterface, record: BridgeRecord) {
  apiFailure = { error: record.error as ModelApiError, details: String(record.error_details ?? ''), text: String(record.last_assistant_message ?? '').trim() }
  $.ui.invalidate('ui.render')
}

// For /mod-transcript debug: how long the last transcript read and feed took.
let lastRead = ''

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

// The turns list holds the turns flipped away from what fold_turns sets for all of them.
const isTurnOpen = (flipped: string[], turn: Turn) => flipped.includes(turn.prompt) === foldTurns

// The latest turn draws in full until the next prompt; a row the transcript doesn't hold yet belongs to it.
const isLive = (turn: Turn | undefined) => expandLive && (!turn || !isDone(turn))

// The prompt of the last turn known to have ended. A flag set by turn.start would read idle after a mod reload mid-turn.
let endedPrompt = ''

// With expand_live off, the latest turn folds as soon as it ends instead of at the next prompt.
const isDone = (turn: Turn) =>
  turn !== log.turns[log.turns.length - 1] || (!expandLive && (turn.durationMs !== undefined || turn.prompt === endedPrompt))

const markEnded = () => {
  endedPrompt = log.turns[log.turns.length - 1]?.prompt ?? ''
}

const listOf = (value: unknown): string[] => (Array.isArray(value) ? value : [])

// The flipped lists, copied from $.state: reading the state on every row cost a round trip per row while scrolling. A change redraws every row.
const flips: Record<Kind, string[]> = { turns: [], tools: [] }

function setFlips($: EngineInterface, kind: Kind, value: unknown) {
  flips[kind] = listOf(value)
  $.ui.invalidate('ui.render')
}

async function readFlips($: EngineInterface) {
  setFlips($, 'turns', (await $.state.get({ plugin: 'mod-transcript', key: 'turns' })).value)
  setFlips($, 'tools', (await $.state.get({ plugin: 'mod-transcript', key: 'tools' })).value)
}

// Writes a list computed from its latest value, only while no other write landed since the read; a lost race reads again.
async function changeList($: EngineInterface, kind: Kind, change: (list: string[]) => string[]) {
  for (let tries = 0; tries < 5; tries++) {
    if (kind === 'turns') {
      const { value, version } = await $.state.get({ plugin: 'mod-transcript', key: 'turns' })
      const next = change(listOf(value))
      if ((await $.state.set({ plugin: 'mod-transcript', key: 'turns' }, next, { ifVersion: version })).isSet) return setFlips($, kind, next)
    } else {
      const { value, version } = await $.state.get({ plugin: 'mod-transcript', key: 'tools' })
      const next = change(listOf(value))
      if ((await $.state.set({ plugin: 'mod-transcript', key: 'tools' }, next, { ifVersion: version })).isSet) return setFlips($, kind, next)
    }
  }
}

async function flip($: EngineInterface, kind: Kind, id: string) {
  await changeList($, kind, list => (list.includes(id) ? list.filter(open => open !== id) : [...list, id]))
}

// `11:32 · 6m 12s` with its two caps and a space: the widest start-and-duration a tool line shows.
const WHEN_WIDTH = 18

const widthOf =(e: { viewport?: { columns: number } }) => Math.max(20, (e.viewport?.columns ?? 100) - 6)

// The head line's cells around its label: the card's edges and padding, the bar and its padding, the fold chip and its gap, and one spare.
const HEAD_CHROME = 12

// How a turn's row draws: hidden while its turn is folded, inside the card while unfolded, as is in the live turn or as the reply.
async function placeOf($: EngineInterface, turn: Turn | undefined, requestId: string) {
  if (!turn || !isDone(turn) || turn.command || rowKey(requestId) === turn.reply) return 'plain'
  return isTurnOpen(flips.turns, turn) || turn.answers.has(rowKey(requestId)) ? 'card' : 'hidden'
}

type Elements = { Box: (props: any) => RenderElement }

// One row's share of a turn's card; stacked rows make one tinted block with a bar down its left edge.
const slice = ({ Box, Client }: Bars, key: string, bar: string, body: unknown, fold: BarProps) => (
  <Box key={key} flexDirection="row" backgroundColor={THEME.surface1}>
    <Box key={`${key}-bar`} width={1} flexShrink={0} backgroundColor={bar}>
      <Client key={`${key}-strip`} module="./bar.tsx" width={1} height="100%" props={fold} />
    </Box>
    <Box key={`${key}-body`} flexDirection="column" flexGrow={1} paddingX={1}>
      {body}
    </Box>
  </Box>
)

// A strip is clickable, so drawing one takes a Client.
type Bars = Elements & { Client: (props: any) => RenderElement }

const edge = ({ Box, Client }: Bars, key: string, props: EdgeProps) =>
  props.kind === 'top' || props.kind === 'bottom' ? (
    <Box key={key} height={1}>
      <Client key={`${key}-edge`} module="./edge.tsx" width="100%" height={1} props={props} />
    </Box>
  ) : (
    // Absolute so its lines never stretch the row; clipped so lines left from a taller row never paint below it.
    <Box key={key} width={1} flexShrink={0}>
      <Box key={`${key}-pin`} position="absolute" top={0} left={0} width={1} height="100%" overflow="hidden">
        <Client key={`${key}-edge`} module="./edge.tsx" width={1} height="100%" props={props} />
      </Box>
    </Box>
  )

// A finished turn with tools opens its bubble at the head under the prompt; its card rows and its reply carry on inside.
const hasHead = (turn: Turn) => isDone(turn) && turn.tools.length > 0

function frame({ Box, Client }: Bars, key: string, body: unknown, isTop: boolean, isBottom: boolean, isTight = false, turn?: Turn) {
  const parts = { Box, Client }
  return (
    <Box key={key} flexDirection="column" flexGrow={1}>
      {isTop ? edge(parts, `${key}-top`, { kind: 'top', color: THEME.accent, wedge: wedge.left }) : null}
      <Box key={`${key}-sides`} flexDirection="row">
        {edge(parts, `${key}-left`, { kind: 'side', color: THEME.accent })}
        <Box key={`${key}-body`} flexDirection="column" flexGrow={1} paddingX={isTight ? 0 : 1}>{body}</Box>
        {edge(parts, `${key}-right`, { kind: 'side', color: THEME.accent })}
      </Box>
      {isBottom ? closing(parts, `${key}-bottom`, turn) : null}
    </Box>
  )
}

const cardRow = (parts: Bars, body: unknown, fold: BarProps) => frame(parts, 'toggle-frame', slice(parts, 'toggle-card', THEME.accent, body, fold), false, false)

// Rows draw in no fixed order, so the prompt and duration rows carry the edges; a finished turn's reply closes it.
function bubble(parts: Bars, key: string, turn: Turn, body: unknown, isTight = false) {
  return frame(parts, key, body, false, isDone(turn), isTight, turn)
}

// Claude Code sizes a markdown table to the whole terminal, so a block holding one drops the bubble's padding to fit it.
const hasTable = (text: string) => /^\s*\|.*\|\s*$/m.test(text) && /^\s*\|?\s*:?-{3,}/m.test(text)

// A turn has ended once a later prompt follows it, its duration is stored, or Claude went idle after it.
const hasEnded = (turn: Turn) => turn !== log.turns[log.turns.length - 1] || turn.durationMs !== undefined || turn.prompt === endedPrompt

function copyPill({ Box, Client }: Bars, turn: Turn) {
  const choices = copyChoices(turn.replyText)
  if (!showCopy || !hasEnded(turn) || !choices.length) return null
  const props: CopyProps = { id: turn.prompt, choices: choices.map(what => ({ what, label: text.copyChoice[what] })), icon: look.glyph.copy, copied: text.copied, bg: THEME.surface3, nerd: look.nerd, lead: { char: MARK.rule, color: THEME.accent } }
  return (
    <Box key="toggle-copy" flexShrink={0}>
      <Client key="toggle-copy-pill" module="./copy.tsx" width={copyWidth(props)} height={1} props={props} />
    </Box>
  )
}

// Claude's bubble opens under the prompt: as the head of a finished turn with tools, else as a bare top edge.
const opening = (parts: Bars) => edge(parts, 'toggle-bubble-open', { kind: 'top', color: THEME.accent, wedge: wedge.left })

// The bubble's bottom edge, under the newest output, carries the copy pill near its corner once the turn has ended.
function closing(parts: Bars, key: string, turn: Turn | undefined) {
  const { Box } = parts
  const copy = turn ? copyPill(parts, turn) : null
  if (!copy) return edge(parts, key, { kind: 'bottom', color: THEME.accent })
  return (
    <Box key={`${key}-row`} flexDirection="row" height={1}>
      <Box key={`${key}-run`} flexGrow={1}>{edge(parts, key, { kind: 'bottom', color: THEME.accent, open: 'end' })}</Box>
      {copy}
      <Box key={`${key}-corner`} width={2} flexShrink={0}>{edge(parts, `${key}-end`, { kind: 'bottom', color: THEME.accent, open: 'start' })}</Box>
    </Box>
  )
}

const bare = (glyph: string) => glyph.replace(/[[\]\s]/g, '')

// Chip and label are both Clients, since a Button posts no tip; without caps the chip's ends are a space each, so it takes three cells either way.
const toggleLine = ({ Box, Client }: Elements & { Client: (props: any) => RenderElement }, key: string, chip: string, isOpen: boolean, label: string, fold: BarProps, extra: unknown = null, parts?: LabelPart[]) => {
  const shown = parts ?? [{ text: label }]
  return (
    <Box key={key} flexDirection="row" columnGap={1}>
      <Box key={`${key}-chip-pill`} flexShrink={0}>
        <Client key={`${key}-chip`} module="./fold.tsx" width={3} height={1} props={{ ...fold, color: chip, isOpen, nerd: look.nerd, still, glyphs: { open: bare(look.glyph.down), closed: bare(look.glyph.up) } } satisfies FoldProps} />
      </Box>
      <Box key={`${key}-label`} flexShrink={1}>
        <Client key={`${key}-colored`} module="./label.tsx" width={partsWidth(shown)} height={1} props={{ ...fold, parts: shown, isDim: !isOpen, hover: THEME.accent } satisfies LabelProps} />
      </Box>
      {extra}
    </Box>
  )
}

const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'MultiEdit'])

// Blast-radius's Moonlight roles for a shell command: the command word bold, then options, quoted text, variables, numbers and operators.
const ROLE_LOOK: Partial<Record<Role, Omit<LabelPart, 'text'>>> = {
  command: { color: SYNTAX.command, bold: true },
  option: { color: SYNTAX.option },
  text: { color: SYNTAX.text },
  variable: { color: SYNTAX.variable },
  number: { color: SYNTAX.number },
  operator: { color: SYNTAX.operator },
}

const commandParts = (command: string): LabelPart[] => tokenizeLine(command).map(span => ({ text: span.text, ...ROLE_LOOK[span.role] }))

const partsWidth = (parts: LabelPart[]) => parts.reduce((sum, part) => sum + cells(part.text), 0)

function labelParts(name: string, input: any, width: number): LabelPart[] {
  const label = fit(toolLabel(name, input, 0, 0), width)
  if (name !== 'Bash' || !label.startsWith('Bash(')) return [{ text: label }]
  const isClosed = label.endsWith(')')
  return [{ text: 'Bash(' }, ...commandParts(label.slice('Bash('.length, isClosed ? -1 : undefined)), ...(isClosed ? [{ text: ')' }] : [])]
}

// A Bash call under the Ran chip: the fold glyph and the colored command, spaced like the plain call lines beside it.
function callParts(call: Turn['tools'][number], isOpen: boolean, width: number): LabelPart[] {
  const glyph = isOpen ? look.glyph.expanded : look.glyph.collapsed
  const isLifted = look.nerd && isOpen
  const parts = [{ text: isLifted ? `${glyph} ` : ` ${glyph} ` }, ...labelParts(call.name, call.input, width - 28), ...(isLifted ? [] : [{ text: ' ' }])]
  return isOpen ? parts.map(part => ({ ...part, color: THEME.ok })) : parts
}

// The open call's pill fill, like an On switch: ok washed into the surface.
const OPEN_CALL = mix(THEME.ok, THEME.surface1, WASH)

// Claude Code's own Bash row, drawn here so the command keeps its colors; the blank first line matches the one Claude Code starts each row with.
function bashRow({ Box, Client, Text }: Rows, input: any, isRunning: boolean, isFailed: boolean) {
  const command = String(input?.command ?? '')
  const dot = isRunning
    ? <Client key="bash-dot" module="./dot.tsx" width={1} height={1} props={{ color: THEME.accent, still } satisfies DotProps} />
    : <Text key="bash-dot" color={isFailed ? THEME.alert : THEME.good}>{MARK.stopOpen}</Text>
  return (
    <Box key="bash-row" flexDirection="column">
      <Text key="bash-blank"> </Text>
      <Box key="bash-head" flexDirection="row" columnGap={1}>
        {dot}
        <Text key="bash-description" bold>{String(input?.description || 'Bash')}</Text>
      </Box>
      {command.split('\n').map((line, n) => (
        <Box key={`bash-line-${n}`} flexDirection="row" paddingLeft={2}>
          <Text key="bash-lead" color={THEME.muted}>{n === 0 ? '└ $ ' : '    '}</Text>
          <Box key="bash-command" flexShrink={1}>
            <Text>
              {commandParts(line).map((part, at) => (
                <Text key={`part-${at}`} color={part.color ?? THEME.onSurface} bold={part.bold}>{part.text}</Text>
              ))}
            </Text>
          </Box>
        </Box>
      ))}
    </Box>
  )
}

// The bubble's padding and the reply's gutter, so a table shrinks to what is left, and one that cannot goes back to Claude Code's.
const TABLE_INDENT = 6

// The code each code block's copy pill copies, by block id; set as the block draws.
const codes = new Map<string, string>()
const COPY_CODE = 'copy-code:'
// Blocks whose pill says "copied code" for a moment, in place of a toast that would push the prompt down.
const justCopied = new Set<string>()
const COPIED_MS = 1500

// The pill pinned on a code card's top edge, rounded where the font has caps.
function copyBlock({ Box, Client, Text }: Rows, id: string, code: string) {
  codes.set(id, code)
  const isCopied = justCopied.has(id)
  const props: EntryProps = { id: `${COPY_CODE}${id}`, label: isCopied ? fill(text.copied, { what: text.copyChoice.code }) : text.codeCopy, lead: look.glyph.copy, leadColor: THEME.secondary, isOpen: false, bg: THEME.surface3, idle: isCopied ? THEME.muted : THEME.secondary, nerd: look.nerd, still, tip: { glyph: look.glyph.copy, label: text.tipCodeCopyLabel, text: text.tipCodeCopy } }
  return (
    <Box key={`toggle-copy-code-${id}`} flexDirection="row" flexShrink={0}>
      {look.nerd ? <Text color={THEME.surface3}>{CAPS.left}</Text> : null}
      <Client key={`toggle-copy-code-pill-${id}`} module="./entry.tsx" width={entryCells(props)} height={1} props={props} />
      {look.nerd ? <Text color={THEME.surface3}>{CAPS.right}</Text> : null}
    </Box>
  )
}

const DIAGRAM = 'diagram:'
const DIAGRAM_ICON = { nerd: String.fromCodePoint(0xf0e8), safe: '◇' }

// A mermaid card's second pill: it opens the chart drawn in the browser.
function diagramBlock({ Box, Client, Text }: Rows, id: string, code: string) {
  codes.set(id, code)
  const lead = look.nerd ? DIAGRAM_ICON.nerd : DIAGRAM_ICON.safe
  const props: EntryProps = { id: `${DIAGRAM}${id}`, label: text.diagram, lead, leadColor: THEME.secondary, isOpen: false, bg: THEME.surface3, idle: THEME.secondary, nerd: look.nerd, still, tip: { glyph: lead, label: text.tipDiagramLabel, text: text.tipDiagram } }
  return (
    <Box key={`toggle-diagram-${id}`} flexDirection="row" flexShrink={0} marginRight={1}>
      {look.nerd ? <Text color={THEME.surface3}>{CAPS.left}</Text> : null}
      <Client key={`toggle-diagram-pill-${id}`} module="./entry.tsx" width={entryCells(props)} height={1} props={props} />
      {look.nerd ? <Text color={THEME.surface3}>{CAPS.right}</Text> : null}
    </Box>
  )
}

async function openDiagram($: EngineInterface, id: string, code: string) {
  const home = await homeOf($)
  const isWindows = Boolean(await $.env.get('USERPROFILE'))
  const file = `${home}/.claude/cache/diagram-${id.replace(/[^\w-]/g, '_')}.html`
  try {
    await $.fs.write(file, diagramPage(code))
    for (const argv of openCommands(file, isWindows)) {
      if ((await $.process.run(argv).catch(() => ({ exitCode: 1 }))).exitCode === 0) return
    }
    $.ui.toast(fill(text.diagramFailed, { reason: 'no browser opened it' }))
  } catch (error) {
    $.ui.toast(fill(text.diagramFailed, { reason: String(error) }))
  }
}

// A reply the mod draws in part: tables, code, headings and callouts in the standard's look, paragraphs with hex pills, the rest as Claude Code's markdown; gutter and margin as markedReply.
function richReply(parts: Rows & { Markdown: (props: any) => RenderElement }, blocks: Block[], inlineLook: Inline, isFirst: boolean, requestId: string, width: number) {
  const { Box, Markdown, Text } = parts
  return (
    <Box key="toggle-tables" flexDirection="row" marginTop={isFirst ? 1 : 0}>
      <Box key="toggle-tables-gutter" width={2} flexShrink={0}>
        <Text>{isFirst ? MARK.stopOpen : ' '}</Text>
      </Box>
      <Box key="toggle-tables-body" flexDirection="column" flexGrow={1} flexShrink={1}>
        {blocks.map((block, n) => {
          const id = `${requestId}:${n}`
          const isOpen = flips.tools.includes(`code:${id}`)
          return (
            <Box key={`toggle-block-${n}`} marginTop={n ? 1 : 0} backgroundColor={block.kind === 'markdown' ? inlineLook.paint?.wash('text') : undefined}>
              {block.kind === 'markdown' ? (
                <Markdown text={block.text} dimColor={inlineLook.paint ? !inlineLook.paint.on('text') : undefined} />
              ) : block.kind === 'prose' ? (
                proseBlock({ Box, Text }, block.text, inlineLook, `toggle-prose-${n}`)
              ) : block.kind === 'code' ? (
                codeCard({ Box, Text }, block, { isOpen, paint: inlineLook.paint, copy: code => (isMermaid(block.lang) ? <Box key={`toggle-pills-${id}`} flexDirection="row">{diagramBlock(parts, id, code)}{copyBlock(parts, id, code)}</Box> : copyBlock(parts, id, code)), more: (open, hidden, bg) => moreToggle(parts, `code:${id}`, open, hidden, bg) }, width, `toggle-code-${n}`)
              ) : block.kind === 'heading' ? (
                headingRow({ Box, Text }, block.text, inlineLook, width, `toggle-heading-${n}`)
              ) : block.kind === 'callout' ? (
                calloutCard({ Box, Text }, block, inlineLook, width, `toggle-callout-${n}`)
              ) : block.kind === 'rule' ? (
                ruleRow({ Box, Text }, inlineLook, width, `toggle-rule-${n}`)
              ) : block.kind === 'footnotes' ? (
                footnoteRows({ Box, Text }, block.notes, inlineLook, `toggle-notes-${n}`)
              ) : block.kind === 'details' ? (
                detailsCard({ Box, Text }, block.body, flips.tools.includes(`details:${id}`), detailsToggle(parts, `details:${id}`, block.summary, flips.tools.includes(`details:${id}`)), inlineLook, width, `toggle-details-${n}`)
              ) : (
                tableBlock({ Box, Text }, block.table, inlineLook, `toggle-table-${n}`, width - TABLE_INDENT)
              )}
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

// What a hovered copy choice takes, on the same wash as the mod's own drawing; the rest of the reply dims.
const MARKED = mix(THEME.bg, THEME.accent, 0.15)

// A reply that is Claude Code's own, in pieces while a copy choice is hovered; gutter and top margin match Claude Code's row, since a row that shrinks moves the pill from under the pointer.
function markedReply({ Box, Markdown, Text }: Pick<Rows, 'Box' | 'Text'> & { Markdown: (props: any) => RenderElement }, pieces: Piece[], isFirst: boolean) {
  return (
    <Box key="toggle-marked" flexDirection="row" marginTop={isFirst ? 1 : 0}>
      <Box key="toggle-marked-gutter" width={2} flexShrink={0}>
        <Text>{isFirst ? MARK.stopOpen : ' '}</Text>
      </Box>
      <Box key="toggle-marked-body" flexDirection="column" flexGrow={1} flexShrink={1}>
        {pieces.map((piece, n) =>
          piece.kind === 'markdown' ? (
            <Box key={`toggle-piece-${n}`} marginTop={n ? 1 : 0} {...(piece.isMarked ? { backgroundColor: MARKED } : {})}>
              <Markdown text={piece.text} dimColor={!piece.isMarked} />
            </Box>
          ) : (
            <Box key={`toggle-piece-${n}`} marginTop={n ? 1 : 0}>
              <Text color={THEME.onSurface}>
                {piece.parts.map((part, at) =>
                  part.isMarked ? (
                    <Text key={`part-${at}`} backgroundColor={MARKED} color={THEME.onSurface}>{part.text}</Text>
                  ) : (
                    <Text key={`part-${at}`} dimColor>{part.text}</Text>
                  ),
                )}
              </Text>
            </Box>
          ),
        )}
      </Box>
    </Box>
  )
}

const nested = ({ Box, Client }: Bars, key: string, body: unknown, fold: BarProps) => (
  <Box key={key} flexDirection="row">
    <Box key={`${key}-bar`} width={1} flexShrink={0} backgroundColor={THEME.border}>
      <Client key={`${key}-strip`} module="./bar.tsx" width={1} height="100%" props={fold} />
    </Box>
    <Box key={`${key}-body`} flexDirection="column" flexGrow={1} paddingLeft={1}>
      {body}
    </Box>
  </Box>
)

type Rows = Bars & { Text: (props: any) => RenderElement }

// Lines added and removed as one pill on the card; plain colored text where the font has no caps.
function countsPill({ Box, Text }: Pick<Rows, 'Box' | 'Text'>, key: string, added: number, removed: number) {
  if (!added && !removed) return null
  const parts = [added ? <Text key={`${key}-added`} color={THEME.good}>{`+${added}`}</Text> : null, removed ? <Text key={`${key}-removed`} color={THEME.alert}>{`${added ? ' ' : ''}−${removed}`}</Text> : null]
  if (!look.nerd) return <Box key={key} flexDirection="row" flexShrink={0} height={1} alignSelf="flex-start">{parts}</Box>
  // One row tall whatever the line's height: a filled body stretched by a taller row painted the row below.
  return (
    <Box key={key} flexDirection="row" flexShrink={0} height={1} alignSelf="flex-start">
      <Text color={THEME.surface3}>{CAPS.left}</Text>
      <Box key={`${key}-body`} flexDirection="row" height={1} backgroundColor={THEME.surface3}>{parts}</Box>
      <Text color={THEME.surface3}>{CAPS.right}</Text>
    </Box>
  )
}

const askedCount = (questions: Question[]) => fill(questions.length === 1 ? text.asked.one : text.asked.many, { n: questions.length })

// An answered AskUserQuestion draws as a table of question, answer and note, folded or not: an answer means nothing without its question.
function answersTable({ Box, Text }: Pick<Rows, 'Box' | 'Text'>, questions: Question[], key: string, room: number) {
  const hasNotes = questions.some(each => each.note)
  const table: Table = {
    head: [text.askHead.question, text.askHead.answer, ...(hasNotes ? [text.askHead.note] : [])],
    right: [false, false, false],
    rows: questions.map(each => [each.question, each.answer ?? text.noAnswer, ...(hasNotes ? [each.note ?? ''] : [])]),
  }
  // The answer is what the person chose, so it carries the weight a reply table gives its first column.
  return tableBlock({ Box, Text }, table, { colors: new Map(), nerd: look.nerd }, key, room, 1)
}

function questionTable(parts: Pick<Rows, 'Box' | 'Text'>, questions: Question[], width: number) {
  const { Box, Text } = parts
  return (
    <Box key="toggle-asked" flexDirection="column" rowGap={1}>
      <Text key="toggle-asked-head" color={THEME.onSurface}>{`${look.glyph.mark.search} ${askedCount(questions)}`}</Text>
      {answersTable(parts, questions, 'toggle-asked-table', width - TABLE_INDENT)}
    </Box>
  )
}

const REPORT_LINES = 6

// The expand standard's id prefix: an entry click with it flips the item under the rest of the id, in the open tool ids.
const MORE = 'more:'

// The expand control: the arrow, then a muted label, on the fill it sits on; a click flips `id`.
function moreToggle({ Client }: Pick<Rows, 'Client'>, id: string, isOpen: boolean, hidden: number, bg: string) {
  const label = isOpen ? text.showLess : hidden > 0 ? fill(text.previewMore, { n: hidden }) : text.showAll
  const arrow = isOpen ? look.glyph.less : look.glyph.more
  return (
    <Client
      key={`toggle-more-${id}`}
      module="./entry.tsx"
      width={cells(label) + 4}
      height={1}
      props={{ id: `${MORE}${id}`, label, lead: arrow, leadColor: THEME.accent, isOpen: false, bg, idle: THEME.muted, nerd: look.nerd, still, tip: { glyph: arrow, label, text: isOpen ? text.tipShowLess : text.tipShowAll } } satisfies EntryProps}
    />
  )
}

// A <details> summary as the control that opens and folds its card: the chevron in accent, the summary in the body color.
function detailsToggle({ Client }: Pick<Rows, 'Client'>, id: string, summary: string, isOpen: boolean) {
  const arrow = isOpen ? '▾' : '▸'
  return (
    <Client
      key={`toggle-details-${id}`}
      module="./entry.tsx"
      width={cells(summary) + 4}
      height={1}
      props={{ id: `${MORE}${id}`, label: summary, lead: arrow, leadColor: THEME.accent, isOpen: false, bg: THEME.bg, idle: THEME.onSurface, nerd: look.nerd, still, tip: { glyph: arrow, label: summary, text: isOpen ? text.tipShowLess : text.tipShowAll } } satisfies EntryProps}
    />
  )
}

function rowWithMore({ Box }: Pick<Rows, 'Box'>, key: string, body: unknown, control: unknown) {
  return (
    <Box key={key} flexDirection="row">
      <Box key={`${key}-body`} flexShrink={1}>{body}</Box>
      <Box key={`${key}-gap`} flexGrow={1} />
      <Box key={`${key}-control`} flexShrink={0}>{control}</Box>
    </Box>
  )
}

type TaskProps = { text: string; origin: { kind: string }; from?: { name: string }; task?: { id?: string; status?: string; type?: string; durationMs?: number; toolUseId?: string } }

// A subagent's or teammate's report: a head line with its sender, status, time and first line, then a card of its fields and first lines.
function reportRow(parts: Rows, props: TaskProps, report: Report, width: number, key: string, fold?: { id: string; isOpen: boolean }) {
  const { Box, Client, Text } = parts
  const all = props.text.replace(/\s+$/, '').split('\n')
  const first = all.findIndex(line => line.trim())
  const summary = first < 0 ? '' : all[first]!.trim()
  const time = report.durationMs !== undefined ? elapsed(report.durationMs) : ''
  const head = [report.name || text.reportFallback, report.status, time, summary].filter(Boolean).join(` ${MARK.sep} `)
  const label = `${look.glyph.mark.agent} ${head}`
  const headRoom = fold ? width - 4 : width
  // A summary the head shows whole is not repeated in the card; a cut one stays there in full.
  const lines = cut(label, headRoom) === label ? all.slice(first + 1) : all
  const fields = [
    props.task?.id ? fill(text.reportTask, { id: props.task.id }) : '',
    props.task?.type ? fill(text.reportType, { type: props.task.type }) : '',
    props.task?.toolUseId ? fill(text.reportTool, { id: props.task.toolUseId }) : '',
  ].filter(Boolean)
  const room = width - 4
  // A word wider than the card (a path, a URL) breaks across rows rather than losing its end.
  const split = (row: string) => (cells(row) <= room ? [row] : Array.from({ length: Math.ceil(row.length / room) }, (_, n) => row.slice(n * room, (n + 1) * room)))
  const rows = lines.flatMap(line => (line.trim() ? wrapWords(line, room).flatMap(split) : [line]))
  // Past six rows the rest opens on a click, kept with the open tool ids under this row's own id.
  const moreId = `report:${key}`
  const isAll = flips.tools.includes(moreId)
  const shown = isAll ? rows : rows.slice(0, REPORT_LINES)
  const more = rows.length - REPORT_LINES
  // With no lines past the head, a card of ids alone would repeat the head, so none draws.
  const isOpen = (fold?.isOpen ?? true) && shown.some(line => line.trim())
  return (
    <Box key="toggle-report" flexDirection="column">
      {fold ? (
        toggleLine(parts, 'toggle-report-fold', THEME.onSurface, fold.isOpen, cut(label, headRoom), { kind: 'turns', id: fold.id })
      ) : (
        <Text key="toggle-report-head" color={THEME.onSurface} wrap="truncate-end">{cut(label, headRoom)}</Text>
      )}
      {isOpen ? (
        <Box key="toggle-report-card" flexDirection="column" borderStyle="round" borderColor={THEME.border} backgroundColor={cardFill()} paddingX={1}>
          {fields.map((field, n) => (
            <Text key={`toggle-report-field-${n}`} color={THEME.muted} wrap="truncate-end">{field}</Text>
          ))}
          {shown.map((line, n) => {
            const body = <Text key={`toggle-report-line-${n}`} color={THEME.onSurface} wrap="truncate-end">{line || ' '}</Text>
            // The control sits on the last text row, pinned right.
            return more > 0 && n === shown.length - 1 ? rowWithMore(parts, 'toggle-report-more', body, moreToggle(parts, moreId, isAll, more, cardFill())) : body
          })}
        </Box>
      ) : null}
    </Box>
  )
}

const isSameNotice = (known: Notice | undefined, notice: Notice) => known !== undefined && known.status === notice.status && known.durationMs === notice.durationMs

// Either may draw first, so whichever comes second redraws the row that shows the other.
function learnNotice($: EngineInterface, id: string, notice: Notice) {
  if (isSameNotice(notices.get(id), notice)) return
  notices.set(id, notice)
  if (reported.has(id)) $.ui.invalidate('ui.render')
}

function learnReport($: EngineInterface, id: string) {
  if (reported.has(id)) return
  reported.add(id)
  if (notices.has(id)) $.ui.invalidate('ui.render')
}

// A notice draws nothing once its report draws; a report takes the notice's status and time.
async function taskRow(parts: Rows, $: EngineInterface, requestId: string, props: TaskProps, width: number) {
  const { Box } = parts
  if (props.origin.kind === 'task-notification') {
    const id = props.task?.id
    if (id) learnNotice($, id, { status: props.task?.status, durationMs: props.task?.durationMs })
    if (id && reported.has(id)) return <Box key="toggle-hidden" />
    // Inside a turn it sits between Claude's replies, so it takes the bubble's sides and the room they leave.
    if (!log.turnOf(requestId)) return reportRow(parts, props, reportOf(props.from, props.task), width, requestId)
    return frame(parts, 'toggle-notice', reportRow(parts, props, reportOf(props.from, props.task), width - 4, requestId), false, false)
  }
  const id = senderTaskOf(props.origin)
  if (id) learnReport($, id)
  const report = withNotice(reportOf(props.from, props.task), id ? notices.get(id) : undefined)
  const turn = log.turnAt(requestId)
  if (!turn || !isDone(turn)) return reportRow(parts, props, report, width, requestId)
  const isOpen = isTurnOpen(flips.turns, turn)
  return reportRow(parts, props, report, width, requestId, { id: turn.prompt, isOpen })
}

// An API error that ended the reply, as one line: red when the person must act, muted when Claude Code retries.
function apiErrorRow({ Box, Text }: Pick<Rows, 'Box' | 'Text'>, failure: ApiFailure, width: number) {
  const action = apiErrorAction(failure.error)
  const detail = failure.details ? ` ${MARK.sep} ${failure.details}` : ''
  return (
    <Box key="toggle-api-error" flexDirection="row">
      <Text color={action === 'act' ? THEME.alert : THEME.muted} bold={action === 'act'} wrap="truncate-end">
        {fit(`${MARK.warn} ${text.apiWhat[failure.error]} ${MARK.sep} ${text.apiAction[action]}${detail}`, width)}
      </Text>
    </Box>
  )
}

// One open chip per turn: picking another closes the first, picking the open one closes it.
async function pickChip($: EngineInterface, turnId: string, kind: string) {
  const key = `${turnId}:${kind}`
  await changeList($, 'tools', list => {
    const others = list.filter(open => !open.startsWith(`${turnId}:`))
    return list.includes(key) ? others : [...others, key]
  })
}

// An open turn's work under its head: a line of kind chips (Thought first, then each kind in order of first use) and, under the picked one, its calls or its thinking.
// A click on a call's line opens or closes it: its own row then shows under the list, in the turn's order.
function chipSection({ Box, Client, Link, Text }: Rows & { Link: (props: any) => RenderElement }, turn: Turn, openTools: string[], width: number) {
  // Claude Code's drawing reaches a mod sealed, so the thinking comes from the session's messages, without its time.
  const thoughts = turnThoughts(turn)
  const kinds = turnKinds(turn)
  const isOpen = (kind: string) => openTools.includes(`${turn.prompt}:${kind}`)
  const chips: Chip[] = [
    ...(thoughts.length ? [{ kind: 'thinking' as const, mark: look.glyph.mark.thinking as string, label: text.thought, count: thoughts.length, added: 0, removed: 0, isOpen: isOpen('thinking') }] : []),
    ...kinds.map(group => ({ kind: group.kind, mark: look.glyph.mark[group.kind] as string, label: text.kindChip[group.kind], count: group.calls.length, added: group.added, removed: group.removed, isOpen: isOpen(group.kind) })),
  ]
  const picked = chips.find(chip => chip.isOpen)
  const bar = picked ? style.colors.kinds[picked.kind].hue : THEME.border
  const line = (key: string, body: unknown, time = '') => (
    <Box key={key} flexDirection="row">
      <Box key={`${key}-line`} flexDirection="row" columnGap={1} flexGrow={1} flexShrink={1}>{body}</Box>
      {showTimes && time ? timePill({ Box, Text }, `${key}-time`, time) : null}
    </Box>
  )
  const thoughtLines = thoughts.filter(Boolean).join('\n\n').split('\n').flatMap(paragraph => wrapWords(paragraph, width - 8))
  // An open call's preview under its line: diff lines on Claude Code's add and remove backgrounds, any other output muted.
  const preview = (call: Turn['tools'][number], n: number) => {
    // A file tool's record draws the same card the result row does; any shape it does not know keeps the preview below.
    const result = fileResult(call.name, call.file)
    const href = result ? paths.address(result.path, result.line) : undefined
    if (result && href) {
      const id = `call:${call.id}`
      const parts = { Box, Client, Text }
      return (
        <Box key={`toggle-call-${n}-preview`} flexDirection="column" paddingLeft={3}>
          {resultCard(
            { Box, Text },
            result,
            { isOpen: flips.tools.includes(`code:${id}`), copy: code => copyBlock(parts, id, code), more: (open, hidden, bg) => moreToggle(parts, `code:${id}`, open, hidden, bg), Link, nerd: look.nerd, href, label: fileLabel(result.path, result.line) },
            // The card sits inside the turn card's edge, the picked bar and its padding, and this preview's own padding.
            width - 8,
            'toggle-call-card',
          )}
        </Box>
      )
    }
    const questions = call.name === 'AskUserQuestion' && call.asked ? questionsOf(call.input, call.asked) : []
    if (questions.length) {
      return (
        <Box key={`toggle-call-${n}-preview`} flexDirection="column" paddingLeft={3}>
          {answersTable({ Box, Text }, questions, `toggle-call-${n}-asked`, width - 8)}
        </Box>
      )
    }
    const more = call.preview?.more ?? 0
    const moreId = `preview:${call.id}`
    const lineOf = (previewLine: { kind: string; text: string }) => `${previewLine.kind === 'add' ? '+ ' : previewLine.kind === 'del' ? '- ' : previewLine.kind === 'same' ? '  ' : ''}${previewLine.text}`
    // A line wider than the card counts as hidden too: its control opens every line wrapped in full.
    const isCut = more > 0 || (call.preview?.lines ?? []).some(previewLine => cells(lineOf(previewLine)) > width - 10)
    const isAll = isCut && flips.tools.includes(moreId)
    const shown = [...(call.preview?.lines ?? []), ...(isAll ? (call.preview?.rest ?? []) : [])]
    const language = FILE_TOOLS.has(call.name) ? languageForPath(String(call.input?.file_path ?? '')) : undefined
    const colored = previewPieces(language, shown, call.name === 'Read')
    // The call line cuts a long command, so the open call shows it whole first.
    const command = call.name === 'Bash' ? String(call.input?.command ?? '').split('\n').flatMap(commandLine => wrapWords(commandLine, width - 14)) : []
    // A SendMessage's result only says it was sent, so the open call shows the message itself first.
    const sent = call.name === 'SendMessage' ? String(call.input?.message ?? '').split('\n').flatMap(sentLine => wrapWords(sentLine, width - 12)) : []
    return (
      <Box key={`toggle-call-${n}-preview`} flexDirection="column" paddingLeft={3}>
        {command.map((commandLine, at) => (
          <Text key={`command-${at}`}>
            <Text color={THEME.muted}>{at === 0 ? '$ ' : '  '}</Text>
            {commandParts(commandLine).map((part, index) => (
              <Text key={`part-${index}`} color={part.color ?? THEME.onSurface} bold={part.bold}>{part.text}</Text>
            ))}
          </Text>
        ))}
        {sent.map((sentLine, at) => <Text key={`sent-${at}`} color={THEME.onSurface}>{sentLine || ' '}</Text>)}
        {shown.length === 0 ?<Text key="none" color={THEME.muted}>{text.previewEmpty}</Text> : null}
        {shown.map((previewLine, at) => {
          const background = previewLine.kind === 'add' ? { backgroundColor: THEME.addBg } : previewLine.kind === 'del' ? { backgroundColor: THEME.delBg } : {}
          const parts = colored?.[at]
          const row: TokenPiece[] = parts ? [{ text: parts.lead, color: previewLine.kind === 'out' ? THEME.muted : THEME.onSurface }, ...parts.code] : []
          const body = (
            <Text key={`line-${at}`} color={previewLine.kind === 'out' ? THEME.muted : THEME.onSurface} wrap={isAll ? 'wrap' : 'truncate-end'} {...background}>
              {parts
                ? (isAll ? row : cutPieces(row, width - 10)).map((piece, index) => (
                    <Text key={`piece-${index}`} color={piece.color} bold={piece.bold} italic={piece.italic} underline={piece.underline}>{piece.text}</Text>
                  ))
                : (isAll ? lineOf(previewLine) : cut(lineOf(previewLine), width - 10)) || ' '}
            </Text>
          )
          // The control sits on the last preview row, pinned right.
          return isCut && at === shown.length - 1 ? rowWithMore({ Box }, `more-row-${call.id}`, body, moreToggle({ Client }, moreId, isAll, more, THEME.surface1)) : body
        })}
      </Box>
    )
  }
  const calls = (kind: string) =>
    kinds.find(group => group.kind === kind)?.calls.flatMap((call, n) => {
      const time = call.startedAt !== undefined && call.endedAt !== undefined ? elapsed(call.endedAt - call.startedAt) : ''
      const questions = call.name === 'AskUserQuestion' && call.asked ? questionsOf(call.input, call.asked) : []
      const shown = questions.length ? [{ text: askedCount(questions) }] : callParts(call, openTools.includes(call.id), width)
      return [
        line(
          `toggle-call-${n}`,
          [
            // The open call is a selected pill whose ends take the spaces around the label, so lines keep one width; the others stay dim until the pointer lights them.
            <Box key={`toggle-call-${n}-line`} flexDirection="row" flexShrink={1}>
              {look.nerd && openTools.includes(call.id) ? <Text color={OPEN_CALL}>{CAPS.left}</Text> : null}
              <Box key={`toggle-call-${n}-pick`} flexShrink={1} {...(openTools.includes(call.id) ? { backgroundColor: OPEN_CALL } : {})}>
                <Client
                  key={`toggle-call-${n}-colored`}
                  module="./label.tsx"
                  height={1}
                  width={partsWidth(shown)}
                  props={{ kind: 'tools', id: call.id, parts: shown, isDim: !openTools.includes(call.id), hover: THEME.accent } satisfies LabelProps}
                />
              </Box>
              {look.nerd && openTools.includes(call.id) ? <Text color={OPEN_CALL}>{CAPS.right}</Text> : null}
            </Box>,
            countsPill({ Box, Text }, `toggle-call-${n}-counts`, call.added, call.removed),
          ],
          time,
        ),
        // The answers mean nothing without their questions, so an AskUserQuestion shows its table without a click.
        ...(openTools.includes(call.id) || questions.length ? [preview(call, n)] : []),
      ]
    }) ?? []
  const body = !picked
    ? null
    : picked.kind === 'thinking'
      ? thoughtLines.some(Boolean)
        ? thoughtLines.map((thoughtLine, n) => <Text key={`toggle-thought-${n}`} color={THEME.muted}>{thoughtLine || ' '}</Text>)
        : <Text key="toggle-thought-none" color={THEME.muted}>{text.thoughtNoText}</Text>
      : calls(picked.kind)
  return [
    <Box key="toggle-chips" height={1}>
      <Client key="toggle-chips-line" module="./chips.tsx" height={1} props={{ id: turn.prompt, chips, nerd: look.nerd, still } satisfies ChipsProps} />
    </Box>,
    body ? (
      <Box key="toggle-picked" flexDirection="row">
        <Box key="toggle-picked-bar" width={1} flexShrink={0} backgroundColor={bar} />
        <Box key="toggle-picked-body" flexDirection="column" flexGrow={1} paddingLeft={1}>{body}</Box>
      </Box>
    ) : null,
  ]
}

// The reply row marks the characters of this turn's choice while the pill hovers or has just copied it; null clears it.
async function markCopy($: EngineInterface, id: string, what: string | null) {
  await $.state.set({ plugin: 'mod-transcript', key: 'copy-hover' }, what ? `${id}\n${what}` : '')
}

// What `/mod-transcript <args>` does; the panel's own actions call it directly, since $.command.run skips the calling plugin.
async function answer($: EngineInterface, args: string) {
  if (args.trim() === 'settings') {
    await toggleSettings($)
    return ''
  }
  if (args.trim() === 'debug') {
    const temp = ((await $.env.get('TEMP')) ?? (await $.env.get('TMPDIR')) ?? '/tmp').replace(/\\/g, '/')
    const rows = [...seen].map(([row, isPlaced]) => `${isPlaced ? 'placed  ' : 'unplaced'} ${row}`)
    await $.fs.write(`${temp}/mod-transcript-ids.txt`, `${log.turns.length} turns\n${lastRead}\n${rows.join('\n')}\n`)
    return `${rows.length} drawn rows written to ${temp}/mod-transcript-ids.txt`
  }
  const done = log.turns.filter(isDone)
  let isAnyOpen = false
  // Folding all clears the flips when turns fold by default, and flips every turn when they open by default.
  await changeList($, 'turns', list => {
    isAnyOpen = done.some(turn => isTurnOpen(list, turn))
    return isAnyOpen !== foldTurns ? done.map(turn => turn.prompt) : []
  })

  return isAnyOpen ? text.noteFolded : text.noteUnfolded
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

// The last answer draws until the check returns, so the first frame already has the right wedge.
async function loadWedge($: EngineInterface) {
  try {
    const isOutline = await $.store.get('wedge-outline')
    if (typeof isOutline === 'boolean') wedge = isOutline ? OUTLINE : FILLED
  } catch {
    // Without a store the wedge starts filled until the check returns.
  }
  const found = await detectWedge(await $.env.get('TERM_PROGRAM'), async argv => {
    const result = await $.process.run(argv, { timeoutMs: 5000 })
    if (result.exitCode !== 0) throw new Error(result.stderr)
    return result.stdout
  })
  const isChanged = found.right !== wedge.right
  wedge = found
  try {
    await $.store.set('wedge-outline', found === OUTLINE)
  } catch {
    // Without a store the check just runs again next time.
  }
  if (isChanged) $.ui.invalidate('ui.render')
}

// The theme the code colors come from, read once per session when the first code is about to draw; the mod's own palette draws until it resolves, and when none does.
let themeLoad: Promise<void> | null = null

const ensureTheme = ($: EngineInterface) => {
  void loadCodeTheme($).catch(() => {
    // A failed search keeps the palette's colors.
  })
}

// The file as the card's link shows it: under the session folder it is relative to it; the line follows.
function fileLabel(path: string, line: number) {
  const slash = path.replace(/\\/g, '/')
  const base = paths.cwd.replace(/\/$/, '')
  const isUnder = base && slash.toLowerCase().startsWith(`${base.toLowerCase()}/`)
  return `${isUnder ? slash.slice(base.length + 1) : slash}:${line}`
}

const homeOf = async ($: EngineInterface) => ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '').replace(/\\/g, '/')

// The session's folder and home, read once per session, so a relative or ~ path in a reply resolves against them.
let rootsLoad: Promise<void> | null = null
const loadRoots = ($: EngineInterface) =>
  (rootsLoad ??= (async () => {
    paths.cwd = (await $.session.cwd().catch(() => '')).replace(/\\/g, '/')
    paths.home = await homeOf($).catch(() => '')
  })())

// The machine as the theme finder reads it; null when no home folder is known.
async function themeHost($: EngineInterface): Promise<ThemeHost | null> {
  const home = await homeOf($)
  if (!home) return null
  return {
    home,
    appData: ((await $.env.get('APPDATA')) ?? '').replace(/\\/g, '/'),
    localAppData: ((await $.env.get('LOCALAPPDATA')) ?? '').replace(/\\/g, '/'),
    programFiles: ((await $.env.get('PROGRAMFILES')) ?? '').replace(/\\/g, '/'),
    read: (path: string) => $.fs.read(path).then(String),
    list: (path: string) => $.fs.list(path).then(entries => entries.filter(entry => entry.kind !== 'file').map(entry => entry.name)),
  }
}

function loadCodeTheme($: EngineInterface) {
  themeLoad ??= (async () => {
    const host = await themeHost($)
    if (!host) return
    const saved = await Promise.resolve($.store.get('code-theme')).catch(() => undefined)
    const known = saved && typeof saved === 'object' && typeof (saved as any).label === 'string' && typeof (saved as any).path === 'string' ? (saved as { label: string; path: string }) : undefined
    const found = await loadTheme(host, codeTheme, known)
    if (!found) return
    useTheme(found)
    $.ui.invalidate('ui.render')
    await Promise.resolve($.store.set('code-theme', { label: found.label, path: found.path })).catch(() => {
      // Without a store the search just runs again next time.
    })
  })()
  return themeLoad
}

// Hooks of one event run in turn, so the slow font check runs beside them instead of holding up every mod after this one.
let lookLoad: Promise<void> | null = null

function loadLook($: EngineInterface) {
  lookLoad ??= (async () => {
    void loadWedge($).catch(() => {
      // A failed check keeps the wedge drawn now.
    })
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

// A time as a rounded pill; plain muted text where the font has no caps.
function timePill({ Box, Text }: { Box: (props: any) => RenderElement; Text: (props: any) => RenderElement }, key: string, time: string) {
  if (!look.nerd) return <Box key={key} flexShrink={0} height={1} alignSelf="flex-start"><Text color={THEME.muted}>{`${time} `}</Text></Box>
  // One row tall whatever the line's height: a filled body stretched by a taller row painted the row below.
  return (
    <Box key={key} flexDirection="row" flexShrink={0} height={1} alignSelf="flex-start">
      <Text color={THEME.surface3}>{CAPS.left}</Text>
      <Box key={`${key}-body`} height={1} backgroundColor={THEME.surface3}><Text color={THEME.muted}>{time}</Text></Box>
      <Text color={THEME.surface3}>{`${CAPS.right} `}</Text>
    </Box>
  )
}

// A settings card's click: its row, saved through /config; a saved change reloads this mod.
async function saveSetting($: EngineInterface, key: string, value: ConfigValue) {
  const row = (await $.config.list()).find(each => each.key === key)
  if (!row) return
  const result = await $.config.set({ key: row.key, value })
  note = 'deny' in result && result.deny ? `${MARK.warn} ${result.deny}` : `${MARK.ok} ${fill(text.noteSettingSaved, { label: row.label })}`
  $.ui.invalidate('ui.render')
}

const CODE_THEME = 'mod-transcript.code_theme'
const THEMES_MORE = 'themes-more'
// Past this many rows (Follow VS Code included) the list folds behind its expand control: a long extension folder would push every other card off screen.
const THEME_ROWS = 8

// The Code theme card: Follow VS Code, then every installed theme; a click on a row saves it as the setting.
async function themeCard({ Box, Client, Text }: Pick<Rows, 'Box' | 'Client' | 'Text'>, $: EngineInterface, chosen: string) {
  themeList ??= (async () => {
    const host = await themeHost($)
    return host ? { labels: await listThemes(host), active: await activeLabel(host) } : { labels: [], active: undefined }
  })()
  const found = await themeList.catch(() => ({ labels: [] as string[], active: undefined }))
  const all = themeRows(found.labels, found.active, chosen)
  const shown = isThemesOpen ? all : all.slice(0, THEME_ROWS)
  const hidden = all.length - shown.length
  const arrow = isThemesOpen ? look.glyph.less : look.glyph.more
  const label = isThemesOpen ? text.themeLess : fill(text.themeMore, { n: hidden })
  const list = <Client key="themes-list" module="./themes.tsx" width="100%" height={shown.length} props={{ rows: shown, glyph: look.glyph.ok, tip: { glyph: look.glyph.ok, text: text.tipTheme }, still } satisfies ThemesProps} />
  const more =
    hidden > 0 || isThemesOpen ? (
      <Client
        key={THEMES_MORE}
        module="./entry.tsx"
        width={cells(label) + 4}
        height={1}
        props={{ id: THEMES_MORE, label, lead: arrow, leadColor: THEME.accent, isOpen: false, bg: cardFill(), idle: THEME.muted, nerd: look.nerd, still, tip: { glyph: arrow, label, text: isThemesOpen ? text.tipThemeLess : text.tipThemeMore } } satisfies EntryProps}
      />
    ) : null
  return section({ Box, Text }, look, 'themes', 'icons', text.themeSection, [list, more])
}

export const register: Register = (on, options) => {
  iconMode = (options.icons as IconMode | undefined) ?? 'auto'
  codeTheme = typeof options.code_theme === 'string' ? options.code_theme : ''
  themeLoad = null
  useTheme(null)
  look = lookFor(iconMode === 'nerd')
  foldTurns = options.fold_turns !== false
  foldTools = options.fold_tools !== false
  showTimes = options.timestamps !== false
  expandLive = options.expand_live !== false
  showCopy = options.copy_pill !== false
  showNumbers = options.prompt_numbers !== false
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

  on('session.start', async ($, e, next) => {
    bridgeOn('SessionStart', record => sessionStarted($, record))
    bridgeOn('PermissionDenied', record => permissionDenied($, record))
    bridgeOn('StopFailure', record => stopFailed($, record))
    await startBridge($, 'mod-transcript')
    try {
      await loadLook($)
      await $.command.register({
        name: 'mod-transcript',
        description: text.commandDescription,
        argumentHint: '[settings|debug]',
      })
      await pruneTranscripts($)
      await $.state.set({ plugin: 'mod-transcript', key: 'pane' }, await isPaneOpen($))
      await readFlips($)
      await loadAWhile($)
    } catch {
      // The rows stay as they were.
    }

    return next(e)
  })

  on('ui.message', async ($, e, next) => {
    const react = async () => {
      const clicked = e.data as EntryMessage
      const dismissed = clicked?.type === 'menu-entry' ? toasts.idOf(clicked.id) : undefined
      if (dismissed !== undefined) {
        toasts.drop(dismissed)
        hovered = null
        $.ui.invalidate('ui.render')
        return
      }
      if (isTipMessage(e.data)) {
        const { mark } = e.data as CopyTipMessage
        if (mark) await markCopy($, mark.id, mark.what)
        hovered = e.data
        $.ui.invalidate('ui.render')
        return
      }
      // The pill names the choice to mark; the reply row reads it from the state and redraws.
      const hover = e.data as CopyHoverMessage
      if (hover?.type === 'copy-hover') {
        await markCopy($, hover.id, hover.what)
        return
      }
      // A click can move or remove the control under the pointer, and a leave may never come.
      if (hovered) {
        hovered = null
        $.ui.invalidate('ui.render')
      }
      const change = settingChoice(e.data)
      if (change) await saveSetting($, change.key, change.value)
      const theme = e.data as ThemesMessage
      if (theme?.type === 'code-theme') await saveSetting($, CODE_THEME, theme.value)
      if (clicked?.type === 'menu-entry' && clicked.id === THEMES_MORE) {
        isThemesOpen = !isThemesOpen
        $.ui.invalidate('ui.render')
      }
      const message = e.data as BarMessage
      if (message?.type === 'fold') await flip($, message.kind, message.id)
      if (clicked?.type === 'menu-entry' && clicked.id.startsWith(MORE)) await flip($, 'tools', clicked.id.slice(MORE.length))
      const chart = clicked?.type === 'menu-entry' && clicked.id.startsWith(DIAGRAM) ? clicked.id.slice(DIAGRAM.length) : ''
      if (chart && codes.has(chart)) await openDiagram($, chart, codes.get(chart)!)
      const block = clicked?.type === 'menu-entry' && clicked.id.startsWith(COPY_CODE) ? clicked.id.slice(COPY_CODE.length) : ''
      const code = block ? codes.get(block) : undefined
      if (code !== undefined) {
        const result = await $.ui.copy({ text: code, surface: e.surface })
        if (result.isCopied) {
          justCopied.add(block)
          $.ui.invalidate('ui.render')
          $.clock.after(COPIED_MS, () => {
            justCopied.delete(block)
            $.ui.invalidate('ui.render')
          })
        } else $.ui.toast(fill(text.copyFailed, { reason: String('reason' in result ? result.reason : '') }))
      }
      const picked = e.data as ChipsMessage
      if (picked?.type === 'chip') await pickChip($, picked.id, picked.kind)
      const copy = e.data as CopyMessage
      if (copy?.type === 'copy') {
        await markCopy($, copy.id, copy.what)
        const turn = log.turns.find(each => each.prompt === copy.id)
        const result = turn ? await $.ui.copy({ text: copyText(turn.replyText ?? '', copy.what as CopyChoice), surface: e.surface }) : { isCopied: false, reason: text.copyNoTurn }
        if (!result.isCopied) $.ui.toast(fill(text.copyFailed, { reason: String('reason' in result ? result.reason : '') }))
      }
    }
    try {
      await react()
    } catch {
      // The rows stay as they were.
    }

    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    try {
      if (e.id === PANE) await $.state.set({ plugin: 'mod-transcript', key: 'pane' }, false)
    } catch {
      // The rows stay as they were.
    }

    return next(e)
  })

  // One panel at a time: another mod's pane opening closes this one, deferred past that plugin's dispatch.
  on('state.set', async ($, e, next) => {
    // Another surface, the desktop's say, can fold a turn too.
    if (e.plugin === 'mod-transcript' && (e.key === 'turns' || e.key === 'tools')) {
      const result = await next(e)
      setFlips($, e.key, e.value)
      return result
    }
    if (e.key === 'pane' && e.plugin !== 'mod-transcript' && e.value === true) {
      $.clock.after(0, async () => {
        if (!(await isPaneOpen($))) return
        await $.ui.close({ id: PANE })
        await $.state.set({ plugin: 'mod-transcript', key: 'pane' }, false)
      })
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    await loadLook($)
    if (e.requestId !== PANE) return next(e)

    // @ts-expect-error The host's types omit Client from a Pane's elements, yet a Pane draws it.
    const { Box, Button, Client, Text } = $.ui.resolve(e)
    const own = (await $.config.list()).filter(row => row.key.startsWith('mod-transcript.'))
    // The settings card for code_theme is the picker below, so the plain one is left out.
    const themeRow = own.find(row => row.key === CODE_THEME)
    const rows = own.filter(row => row !== themeRow)
    const picker = themeRow ? await themeCard({ Box, Client, Text }, $, typeof themeRow.value === 'string' ? themeRow.value : '') : null
    // A saved change reloads this mod, which redraws the panel with the new value.
    const run = async (action: Action) => {
      const said =
        action.command === 'mod-transcript'
          ? answer($, action.args ?? '')
          : $.command.run({ command: action.command, args: action.args ?? '' }).then(() => fill(text.noteCommandRan, { command: [action.command, action.args].filter(Boolean).join(' ') }))
      note = await said.then(text => `${MARK.ok} ${text || action.label}`).catch(error => `${MARK.warn} ${String(error)}`)
      $.ui.invalidate('ui.render')
    }

    return (
      <Box flexDirection="column" paddingX={1} backgroundColor={THEME.bg} minHeight={e.props.scroll.bodyRows}>
        {tabRow({ Box, Client, Text }, look.nerd, [{ id: 'mod-transcript-settings-tab', label: `${text.paneHeading} ${MARK.sep} ${text.paneSubheading}`, icon: look.glyph.gear, isOpen: true, tip: { glyph: look.glyph.gear, label: text.paneSubheading, text: text.tipTabSettings } }], still)}
        <Text wrap="truncate-end" color={statusColor(note)}>{withMark(look, note) || `${text.paneHintClick} ${MARK.sep} ${text.paneHintSaved}`}</Text>
        {picker}
        <Box marginTop={0}>{settingsBody({ Box, Button, Client, Text }, look, { rows, actions, working, run, previews, still, tips: text.settingTips })}</Box>
        <Box key="footer-space" height={FOOTER_ROWS} />
        {paneFooter({ Box, Text }, hoveredTip(), e.props.bodyColumns, e.props.scroll, actionReveals(actions, look, working))}
      </Box>
    )
  })

  // The chat rows' controls have no tip row of their own, so their tip shows in the band's, on the shared pill row another mod drew; this mod's toasts draw here as cards.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Read once: a leave posted while next(e) runs clears `hovered`.
    const tip = tipText(hovered)
    if (e.surface === 'terminal') viewing.agent = e.props.view.agentId
    if (e.surface !== 'terminal' || e.props.hasSurvey || (!tip && toasts.items.length === 0)) return next(e)
    const { Box, Client, Text } = $.ui.resolve(e)
    const others = await next(e)
    const cards = toastCards({ Box, Client, Text }, toasts, look, text.tipToast)
    const { group, row, rest, tip: otherTip } = splitRow(others)
    if (group.length === 0 && row.length === 0) return cards.length ? <Box key="toasts-transcript" flexDirection="column">{cards}{others}</Box> : others
    return pillRow({ Box, Client, Text }, look.nerd, group, row, [...cards, ...rest], tip ? tipLine({ Box, Text }, tip) : otherTip, e.props.bodyColumns)
  })

  // A plugin's switch to an agent's transcript is heard before it lands, so rows never draw the main turns' bubbles first.
  on('ui.view', async ($, e, next) => announceView(e, next))

  // A /resume or /clear ends this session; what its bridge file still holds is delivered, and the next row asks for the id at once.
  on('session.end', async ($, e, next) => {
    sessionCheckedAt = 0
    paths.clear()
    rootsLoad = null
    await endBridge($, e.sessionId)

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId && e.tool_use_id) {
      log.dropForeign(e.tool_use_id)
      $.ui.invalidate('ui.render')
    }

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (!(e as { agentId?: string }).agentId) {
      working = true
      // A skill command's turn starts with the stored command text; its row drew before, as an id every row shares, so the turn is made here.
      const command = commandOf(e.text)
      if (isLoaded && command) {
        log.claimCommand(command)
        $.ui.invalidate('ui.render')
      }
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      working = false
      markEnded()
    }
    // The turn is handed on before the messages are read, so no mod after this one waits for them.
    const result = await next(e)
    try {
      if (!e.agentId) {
        await load($)
        const messages = await $.session.messages({ as: 'api' }).catch(() => null)
        if (Array.isArray(messages)) log.learnThoughts(messages)
        $.ui.invalidate('ui.render')
      }
    } catch {
      // The rows stay as they were.
    }

    return result
  })

  on('command.run', { command: 'mod-transcript' }, async ($, e) => ({ text: await answer($, e.args) }))

  // The prompt row carries the card's head: one line naming what the turn did, which a click folds or unfolds.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    await loadLook($)
    if (e.surface !== 'terminal' || viewing.agent) return next(e)
    await followSession($)
    isFullView = e.props.isExpanded
    // A subagent's report opens a turn of its own, as in the transcript, unless it lands while Claude works: the transcript keeps that one in the running turn.
    const isReport = e.props.origin.kind === 'peer'
    // A plugin's prompt is stored as a plain user row, so the transcript opens a turn for it like a typed one.
    const isSent = e.props.origin.kind === 'composer' || e.props.origin.kind === 'plugin'
    if (isLoaded && (isReport ? !working : isSent && isPrompt(e.props.text))) log.claim(e.requestId, 'prompt', Date.now(), isReport, String(e.props.text ?? ''))
    if (isFullView) return next(e)
    if (isLoaded && e.props.origin.kind === 'task-notification') log.claim(e.requestId, 'row')
    if (e.props.origin.kind === 'peer' || e.props.origin.kind === 'task-notification') return taskRow($.ui.resolve(e), $, e.requestId, e.props, widthOf(e))
    if (!isSent) return next(e)
    if (!isLoaded) {
      await guess($)
      log.adopt(e.requestId, 'prompt', e.props.text)
    }
    const turn = log.turnAt(e.requestId)
    seen.set(`UserMessage ${e.requestId}`, Boolean(turn))
    const { Box, Client, Link, Text } = $.ui.resolve(e)
    // Read before next(e) draws, since a row drawn meanwhile can renumber the prompts.
    const n = showNumbers && turn ? log.numberOf(turn) : undefined
    const prompt = await next(e)
    // The wedge is an absolute sibling: Claude Code refuses its row under a positioned Box.
    const row = (
      <Box key="toggle-prompt-row" flexDirection="row" flexGrow={1} justifyContent="flex-end" backgroundColor={THEME.bg}>
        {n !== undefined ? (
          <Box key="toggle-prompt-gutter" flexShrink={0} width={pillWidth(n) + 1} backgroundColor={THEME.bg}>
            <Client key="toggle-prompt-number" module="./number.tsx" width={pillWidth(n) + 1} height="100%" props={{ id: turn!.prompt, n, nerd: look.nerd } satisfies NumberProps} />
          </Box>
        ) : null}
        <Box key="toggle-prompt-bubble" flexDirection="column" flexShrink={1}>
          <Box key="toggle-prompt-outline" flexDirection="row" borderStyle="round" borderColor={THEME.secondary}>
            {showTimes && turn?.at !== undefined ? (
              // The column takes the prompt's background (Moonlight userMessageBackground) down every wrapped line; the pill stays one row tall.
              <Box key="toggle-prompt-time-col" flexShrink={0} alignItems="flex-start" backgroundColor={THEME.surface2}>
                {timePill({ Box, Text }, 'toggle-prompt-time', timeOfDay(turn.at))}
              </Box>
            ) : showTimes && turn ? (
              // A guessed turn has no time until the transcript is read; the space keeps the prompt's wrap, so its height holds.
              <Box key="toggle-prompt-time-col" flexShrink={0} width={look.nerd ? 8 : 6} backgroundColor={THEME.surface2} />
            ) : null}
            {/* Claude Code puts a margin row above a typed prompt only; a plugin's prompt has its label line above instead, so lifting it would hide its first row. */}
            <Box key="toggle-prompt-lift" flexDirection="column" flexShrink={1} marginTop={e.props.origin.kind === 'plugin' ? 0 : -1}>{prompt}</Box>
          </Box>
          <Box key="toggle-prompt-wedge" position="absolute" top={0} right={0}>
            <Text color={THEME.secondary}>{wedge.right}</Text>
          </Box>
        </Box>
      </Box>
    )
    if (!turn) return row
    if (!hasHead(turn)) return <Box key="toggle-prompt" flexDirection="column" flexGrow={1}>{row}{opening({ Box, Client })}</Box>

    const isOpen = isTurnOpen(flips.turns, turn)
    // The head: what the turn did, then its line counts and how long it took, each a pill.
    const added = turn.tools.reduce((sum, call) => sum + call.added, 0)
    const removed = turn.tools.reduce((sum, call) => sum + call.removed, 0)
    const took = turn.durationMs !== undefined ? fill(text.turnTook, { time: elapsed(turn.durationMs) }) : ''
    // The label gets what the pills leave, so it never wraps: a wrapped label made the line two rows and the pills' fill bled into the second.
    const countsWidth = added || removed ? cells(`${added ? `+${added}` : ''}${added && removed ? ' ' : ''}${removed ? `−${removed}` : ''}`) + (look.nerd ? 2 : 0) + 1 : 0
    const tookWidth = took ? cells(took) + (look.nerd ? 3 : 1) + 1 : 0
    const head = (
      <Box key="toggle-head-line" flexDirection="row" columnGap={1}>
        {toggleLine({ Box, Client }, 'toggle-turn', THEME.onSurface, isOpen, fit(turnLine(turn), widthOf(e) - HEAD_CHROME - countsWidth - tookWidth), { kind: 'turns', id: turn.prompt })}
        {countsPill({ Box, Text }, 'toggle-head-counts', added, removed)}
        {took ? timePill({ Box, Text }, 'toggle-head-time', took) : null}
      </Box>
    )
    if (isOpen && turn.tools.some(call => FILE_TOOLS.has(call.name))) {
      ensureTheme($)
      await loadRoots($)
    }
    const kinds = isOpen && foldTools ? chipSection({ Box, Client, Link, Text },turn, flips.tools, widthOf(e)) : null
    // The reply closes the card; a turn cancelled before any reply has none, so its head closes it whenever no tool row draws below.
    const isClosed = !turn.reply && (foldTools || !isOpen)
    return (
      <Box key="toggle-prompt" flexDirection="column" flexGrow={1}>
        {row}
        {frame({ Box, Client }, 'toggle-head-frame', slice({ Box, Client }, 'toggle-head', isOpen ? THEME.accent : THEME.border, [head, kinds], { kind: 'turns', id: turn.prompt }), true, isClosed, false, turn)}
      </Box>
    )
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    await loadLook($)
    if (e.surface !== 'terminal' || viewing.agent) return next(e)
    await followSession($)
    if (isLoaded) log.claim(e.requestId, 'reply')
    if (isFullView) return next(e)
    // Once the transcript is read the guess is not needed, and asking for it fetched every message of the session.
    if (!isLoaded) {
      await guess($)
      log.adopt(e.requestId, 'text', e.props.text)
    }
    const turn = log.turnOf(e.requestId)
    seen.set(`AssistantMessage ${e.requestId}`, Boolean(turn))
    // A reply drawn live is newer than the transcript the log read; the copy pill hands over what it says.
    if (turn && rowKey(e.requestId) === turn.reply && e.props.text.trim()) turn.replyText = e.props.text.trim()
    const place = await placeOf($, turn, e.requestId)
    const { Box, Client, Link, Markdown, Text } = $.ui.resolve(e)
    await loadRoots($)
    // The row draws now with its paths as code pills; each one that exists turns into a link once its stat answers and the row redraws.
    void paths.watch(pathTokens(e.props.text), absolute => $.fs.stat(absolute).then(() => true), () => $.ui.invalidate('ui.render')).catch(() => {
      // A failed stat leaves the path as it is drawn.
    })
    const failure = apiFailure?.text && e.props.text.trim() === apiFailure.text ? apiFailure : null
    // Only the reply's row reads the hover, which subscribes it: the pill's choice on this turn marks what that choice copies.
    const hover = showCopy && !failure && turn && rowKey(e.requestId) === turn.reply ? String((await $.state.get({ plugin: 'mod-transcript', key: 'copy-hover' })).value ?? '') : ''
    const hovered = turn && hover.startsWith(`${turn.prompt}\n`) ? hover.slice(turn.prompt.length + 1) : ''
    const found = failure ? [] : hexColors(e.props.text, THEME.surface2)
    // A paragraph that names a path known to exist is the mod's to draw, since Claude Code's markdown has no link for it.
    const blocks = failure ? null : richBlocks(e.props.text.trim(), paragraph => hexColors(paragraph, THEME.surface2).length > 0 || (!unsupported(paragraph) && pathTokens(paragraph).some(token => paths.href(token))))
    // A turn's card rows sit inside a bar and its padding, three cells narrower than the reply.
    const room = widthOf(e) - (place === 'card' ? 3 : 0)
    // Claude Code's own table takes over only when one cannot fit the bubble's text column even with every column at its narrowest; with nothing of the mod's to draw, the reply stays Claude Code's.
    const inlineLook: Inline = { colors: new Map(found.map(color => [color.code.toUpperCase(), color])), nerd: look.nerd, links: { Link, open: token => paths.href(token) }, paint: hovered ? paintOf(hovered as CopyChoice) : undefined }
    const own = blocks?.some(block => block.kind !== 'markdown') && blocks.every(block => block.kind !== 'table' || tableMinWidth(block.table, inlineLook) <= room - TABLE_INDENT) ? blocks : null
    // A reply that is Claude Code's own at rest stays its drawing while hovered, cut into marked pieces: the mod's drawing would change its height under the pointer.
    const marks = hovered && !failure && !own ? markPieces(e.props.text.trim(), hovered as CopyChoice) : null
    if (own?.some(block => block.kind === 'code')) ensureTheme($)
    const reply = async () =>
      failure ? apiErrorRow({ Box, Text }, failure, widthOf(e)) : marks ? markedReply({ Box, Markdown, Text }, marks, e.props.isFirstOfReply) : own ? richReply({ Box, Client, Markdown, Text }, own, inlineLook, e.props.isFirstOfReply, e.requestId, room) : next(e)
    // Claude Code's markdown cannot color a character, so only the colors left in its blocks show in a strip under the reply.
    const colors = own ? hexColors(own.flatMap(block => (block.kind === 'markdown' ? [block.text] : [])).join('\n'), THEME.surface2) : found
    const drawn = async () =>
      colors.length === 0 ? reply() : (
        <Box key="toggle-colored" flexDirection="column">
          {await reply()}
          <Box key="toggle-colors" marginTop={1} flexDirection="row" flexWrap="wrap" columnGap={1}>
            {colors.map((color, n) => (
              <Box key={`toggle-color-${n}`} flexDirection="row" flexShrink={0}>
                {look.nerd ? <Text color={THEME.surface2}>{CAPS.left}</Text> : null}
                <Box key={`toggle-color-${n}-body`} backgroundColor={THEME.surface2} paddingX={look.nerd ? 0 : 1}>
                  <Text>
                    <Text color={color.rgb}>{MARK.stopOpen}</Text>
                    <Text color={THEME.muted}>{` ${color.code}`}</Text>
                  </Text>
                </Box>
                {look.nerd ? <Text color={THEME.surface2}>{CAPS.right}</Text> : null}
              </Box>
            ))}
          </Box>
        </Box>
      )
    if (place === 'plain') return turn ? bubble({ Box, Client }, 'toggle-bubble', turn, await drawn(), hasTable(e.props.text) && !own) : drawn()

    return place === 'hidden' ? <Box key="toggle-hidden" /> : cardRow({ Box, Client }, await drawn(), { kind: 'turns', id: turn!.prompt })
  })

  // A finished tool row folds to one line of its own; a click shows Claude Code's full row and result under it.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    await loadLook($)
    if (e.surface !== 'terminal' || viewing.agent) return next(e)
    await followSession($)
    if (isLoaded) log.claimCall(e.props.tool_use_id, e.props.tool, e.props.input, e.props.isRunning, e.props.output, e.props.isErrored || e.props.isInterrupted)
    else {
      await guess($)
      log.follow(e.props.tool_use_id)
    }
    const turn = log.turnOf(e.requestId)
    seen.set(`ToolUse ${e.requestId}`, Boolean(turn))
    if (isFullView) return next(e)
    const { Box, Client, Text } = $.ui.resolve(e)
    const place = await placeOf($, turn, e.requestId)
    // In an open turn the head's kind rows list every call, so the row itself draws nothing.
    if (place === 'hidden' || (place === 'card' && foldTools)) return <Box key="toggle-hidden" />
    const inBubble = (body: unknown) => (turn ? bubble({ Box, Client }, 'toggle-bubble', turn, body) : body) as RenderElement
    const isFailed = e.props.isErrored || e.props.isInterrupted
    // A call a hook or the person refused is an error they chose, so it draws neutral.
    const isDeclined = e.props.isErrored && declined.has(e.props.tool_use_id)
    const isRed = isFailed && !isDeclined
    const questions = e.props.tool === 'AskUserQuestion' && !e.props.isRunning ? questionsOf(e.props.input, e.props.output) : []
    if (questions.length) {
      const body = questionTable({ Box, Text }, questions, widthOf(e))
      return place === 'card' ? cardRow({ Box, Client }, body, { kind: 'turns', id: turn!.prompt }) : inBubble(body)
    }
    if (e.props.isRunning || !foldTools || isLive(turn)) {
      const row = e.props.tool === 'Bash' ? bashRow({ Box, Client, Text }, e.props.input, e.props.isRunning, isRed) : await next(e)
      return place === 'card' ? cardRow({ Box, Client }, row, { kind: 'turns', id: turn!.prompt }) : inBubble(row)
    }

    const { added, removed } = diffStat(e.props.tool, e.props.input, e.props.output, isFailed)
    const isOpen = flips.tools.includes(e.props.tool_use_id)
    const when = showTimes ? callTime(log.callOf(e.props.tool_use_id)) : ''
    // The status words take their room first, so the name is cut to leave it.
    const suffix = statusesOf({ isInterrupted: e.props.isInterrupted, isDeclined, output: e.props.output, input: e.props.input }).map(status => ` ${MARK.sep} ${text.status[status]}`).join('')
    const room = widthOf(e) - 16 - (when ? WHEN_WIDTH : 0) - cells(suffix)
    const stats = [
      added ? <Box key="toggle-tool-added"><Text color={THEME.good}>{`+${added}`}</Text></Box> : null,
      removed ? <Box key="toggle-tool-removed"><Text color={THEME.alert}>{`−${removed}`}</Text></Box> : null,
    ]
    const line = toggleLine(
      { Box, Client },
      'toggle-tool',
      isRed ? THEME.alert : THEME.muted,
      isOpen,
      fit(toolLabel(e.props.tool, e.props.input, 0, 0), room) + suffix,
      { kind: 'tools', id: e.props.tool_use_id },
      stats,
      e.props.tool === 'Bash' ? [...labelParts('Bash', e.props.input, room), ...(suffix ? [{ text: suffix }] : [])] : undefined,
    )
    // Start time and duration lead the line, in a fixed-width column so the labels stay aligned.
    const timed = when ? (
      <Box key="toggle-tool-timed" flexDirection="row">
        <Box key="toggle-tool-time-col" flexShrink={0} width={WHEN_WIDTH}>{timePill({ Box, Text }, 'toggle-tool-time', when)}</Box>
        {line}
      </Box>
    ) : line
    const body = isOpen ? [timed, nested({ Box, Client }, 'toggle-tool-row', await next(e), { kind: 'tools', id: e.props.tool_use_id })] : timed
    return inBubble(<Box key="toggle-tool-plain" flexDirection="column">{body}</Box>)
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    await loadLook($)
    if (e.surface !== 'terminal' || viewing.agent) return next(e)
    await followSession($)
    if (isLoaded) log.claim(e.requestId, 'row')
    if (isFullView) return next(e)
    else {
      if (!isLoaded) await guess($)
      log.follow(e.requestId)
    }
    const turn = log.turnOf(e.requestId)
    seen.set(`ToolResult ${e.requestId}`, Boolean(turn))
    const { Box, Client, Link, Text } = $.ui.resolve(e)
    const place = await placeOf($, turn, e.requestId)
    // The question table already shows the answers, so a result that holds them would draw them twice.
    const isAnswered = e.props.tool === 'AskUserQuestion' && !e.props.isErrored && Boolean((e.props.output as { answers?: unknown } | undefined)?.answers)
    if (isAnswered || place === 'hidden' || (place === 'card' && foldTools) || (foldTools && !isLive(turn) && !flips.tools.includes(e.props.tool_use_id))) return <Box key="toggle-hidden" />

    // An errored result, or a record the card does not know, stays Claude Code's.
    const result = e.props.isErrored ? null : fileResult(e.props.tool, e.props.output)
    await loadRoots($)
    const href = result ? paths.address(result.path, result.line) : undefined
    let drawn: unknown
    if (result && href) {
      ensureTheme($)
      const id = `result:${e.requestId}`
      const parts = { Box, Client, Text }
      drawn = resultCard(
        { Box, Text },
        result,
        { isOpen: flips.tools.includes(`code:${id}`), copy: code => copyBlock(parts, id, code), more: (open, hidden, bg) => moreToggle(parts, `code:${id}`, open, hidden, bg), Link, nerd: look.nerd, href, label: fileLabel(result.path, result.line) },
        // The result sits inside the bar and its padding, and inside the turn's card when that is open.
        widthOf(e) - 2 - (place === 'card' ? 3 : 0),
        'toggle-result-card',
      )
    }
    const body = nested({ Box, Client }, 'toggle-result', drawn ?? (await next(e)), { kind: 'tools', id: e.props.tool_use_id })
    if (place === 'card') return cardRow({ Box, Client }, body, { kind: 'turns', id: turn!.prompt })
    return turn ? bubble({ Box, Client }, 'toggle-bubble', turn, body) : body
  })

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    await loadLook($)
    if (e.surface !== 'terminal' || viewing.agent) return next(e)
    await followSession($)
    // A folded group's calls never draw rows of their own, so the group claims them for the turn.
    if (isLoaded) for (const call of e.props.calls) if (call.tool_use_id) log.claimCall(call.tool_use_id, call.tool, call.input, call.isRunning, call.output, call.isErrored || call.isInterrupted)
    // A group of thinking alone has no calls; it joins the turn by its own message id.
    if (isLoaded && e.props.calls.length === 0) log.claim(e.requestId.replace(/^collapsed-/, ''), 'row')
    if (isFullView) return next(e)
    const id = e.props.calls.find(call => call.tool_use_id)?.tool_use_id ?? e.requestId
    if (!isLoaded) {
      await guess($)
      if (e.props.calls.length === 0) log.adoptNear(e.requestId)
      else log.follow(id)
    }
    const turn = log.turnOf(id)
    seen.set(`ToolGroup ${e.requestId}`, Boolean(turn))
    const place = await placeOf($, turn, id)
    const { Box, Client, Text } = $.ui.resolve(e)
    // A group shows its running call while it runs; a Bash one is drawn here so its command keeps its colors.
    const running = e.props.calls.find(call => call.isRunning && call.tool === 'Bash')
    const group = running ? bashRow({ Box, Client, Text }, running.input, true, false) : await next(e)
    if (place === 'plain') return turn ? bubble({ Box, Client }, 'toggle-bubble', turn, group) : group

    // In an open turn the head's kind rows list every call, so the group draws nothing.
    if (place === 'hidden' || foldTools) return <Box key="toggle-hidden" />
    return cardRow({ Box, Client }, await next(e), { kind: 'turns', id: turn!.prompt })
  })

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    await loadLook($)
    if (e.surface !== 'terminal' || viewing.agent) return next(e)
    await followSession($)
    if (isLoaded) log.claim(e.requestId, 'row')
    if (isFullView) return next(e)
    else {
      await guess($)
      log.adoptNear(e.requestId)
    }
    const turn = log.turnOf(e.requestId)
    seen.set(`TurnDuration ${e.requestId}`, Boolean(turn))
    // A turn learned as it drew has no duration row from the transcript; this line carries it.
    if (turn && typeof e.props.durationMs === 'number') log.took(turn, rowKey(e.requestId), e.props.durationMs)
    const place = await placeOf($, turn, e.requestId)
    const { Box, Client } = $.ui.resolve(e)
    if (place === 'hidden') return <Box key="toggle-hidden" />
    // The running turn's last line closes its bubble; a finished turn's reply closes its own.
    if (turn && !isDone(turn)) {
      return (
        <Box key="toggle-close" flexDirection="column">
          {closing({ Box, Client }, 'toggle-bubble-close', turn)}
          {await next(e)}
        </Box>
      )
    }
    return next(e)
  })
}

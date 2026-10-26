// mod-next-steps / hooks/register.tsx, by v-amorim
// Registers the mod: wires the suggestion band, settings pane, commands and toasts.
import type { ConfigValue, EngineInterface, Register, RenderChildren } from 'claude-code'

import { cardFill, detectNerd, FOOTER_ROWS, lookFor, paneFooter, sepText, titleEdge, type IconMode, withMark } from './look'
import { settingChoice, settingsBody, type Action, type Previews, type Range } from './settings'
import { fill, MARK, statusColor, THEME } from './theme'
import { isTipMessage, tipText, type EntryMessage, type EntryProps, type Tip, type TipMessage } from './entry'
import { pill, pillRow, splitRow, tabRow, tipLine } from './pills'
import { TOAST_MS, ToastList, toastCards } from './toasts'
import { recordSpend } from './spend'
import text from './text'

const PANE = 'nextsteps'
const MAX_CHARS = 100
// Cells a suggestion row spends besides its text: the card's border and padding, the pill's caps, digit and padding, and the close pill beside the first row.
const ROW_CHROME = 19
const MIN_ROOM = 10

const keyOf = (node: unknown) => String((node as { props?: { key?: unknown } } | null)?.props?.key ?? '')

const fit = (line: string, width: number) => (line.length <= width ? line : `${line.slice(0, width - 1)}…`)

const bare = (glyph: string) => glyph.replace(/[[\]\s]/g, '')

// The person's settings (userConfig), fixed per activation: a change reloads the mod.
let iconMode: IconMode = 'auto'
let enabled = false
let count = 3
let look = lookFor(false)
// The control under the pointer, from its tip post: the band's tip row and the pane footer show it.
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

// Suggestions on show. `epoch` counts turn starts and submits, so a reply that arrives late is dropped.
let steps: string[] = []
let epoch = 0
let working = false
let note = ''
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

const question = (limit: number) =>
  `Suggest up to ${limit} short prompts I might send you next, given this conversation. ` +
  `Each is one line under 80 characters, written the way I would type it. ` +
  `Reply with the prompts only, one per line, no numbering, no quotes, no commentary.`

function parseSteps(text: string, limit: number) {
  const lines = text
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').replace(/^["'`]+|["'`]+$/g, '').trim())
    .map(line => line.charAt(0).toUpperCase() + line.slice(1))
    .filter(line => line.length > 0 && line.length <= MAX_CHARS)
  return [...new Set(lines)].slice(0, limit)
}

let isSuggesting = false
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

async function suggest($: EngineInterface, mine: number) {
  isSuggesting = true
  $.ui.invalidate('ui.render')
  try {
    const reply = await $.model.fork({ prompt: question(count) })
    recordSpend($, await $.session.model().catch(() => ''), !reply.isAnswered && reply.reason === 'nothing-to-fork' ? null : reply)
    if (!reply.isAnswered && reply.reason === 'api-error') await sideUnavailable($, [reply.error, reply.status ? String(reply.status) : ''].filter(Boolean).join(' '))
    if (mine !== epoch || !reply.isAnswered) return
    const found = parseSteps(reply.text, count)
    if (found.length === 0) return
    steps = found
    $.ui.invalidate('ui.render')
  } catch (error) {
    await sideUnavailable($, error instanceof Error ? error.message : String(error))
  } finally {
    if (mine === epoch) {
      isSuggesting = false
      $.ui.invalidate('ui.render')
    }
  }
}

function clearSteps($: EngineInterface) {
  epoch += 1
  hovered = null
  if (isSuggesting) {
    isSuggesting = false
    $.ui.invalidate('ui.render')
  }
  if (steps.length === 0) return
  steps = []
  $.ui.invalidate('ui.render')
}

async function fillFrom($: EngineInterface, index: number) {
  const text = steps[index]
  if (!text) return
  const draft = await $.prompt.read()
  // The digit that pressed it may still sit in the prompt; the suggestion takes its place.
  if (draft.text.trim() === '' || draft.text.trim() === String(index + 1)) await $.prompt.fill({ text, mode: 'replace' })
  else await $.prompt.fill({ text: ` ${text}`, mode: 'append' })
}

const isPaneOpen = async ($: EngineInterface) => (await $.ui.panes()).some(pane => pane.id === PANE && pane.isPlaced)

// `/mod-next-steps settings` toggles the panel; an unplaced pane is waiting, not open.
async function toggleSettings($: EngineInterface) {
  if (await isPaneOpen($)) {
    await $.ui.close({ id: PANE })
    await $.state.set({ plugin: 'mod-next-steps', key: 'pane' }, false)
    return
  }
  note = ''
  const showcase = await $.fs.read(`${$.plugin.root}/showcase.json`).then(text => JSON.parse(String(text))).catch(() => null)
  previews = showcase?.previews
  fields = await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`).then(text => JSON.parse(String(text)).userConfig).catch(() => undefined)
  actions = (Array.isArray(showcase?.actions) ? showcase.actions : []).map((action: Action) => ({ ...action, isLocal: action.command === 'mod-next-steps' }))
  const opened = await $.ui.open({ id: PANE, title: 'Next steps', closeOnEscape: true })
  if (!opened.isPlaced) $.ui.toast(fill(text.settingsWaiting, { reason: opened.reason }))
  await $.state.set({ plugin: 'mod-next-steps', key: 'pane' }, opened.isPlaced)
}

// What `/mod-next-steps <args>` does; the panel's own actions call it directly, since $.command.run skips the calling plugin.
async function answer($: EngineInterface, args: string) {
  if (args.trim() === 'clear') {
    clearSteps($)
    return text.suggestionsCleared
  }
  await toggleSettings($)
  return ''
}

const toasts = new ToastList('nextsteps')
let still = false

async function saveSetting($: EngineInterface, key: string, value: ConfigValue) {
  const row = (await $.config.list()).find(each => each.key === key)
  if (!row) return
  const clamped = row.key === 'mod-next-steps.count' && typeof value === 'number' ? Math.min(3, Math.max(1, value)) : value
  const result = await $.config.set({ key: row.key, value: clamped })
  note = 'deny' in result && result.deny ? `${MARK.warn} ${result.deny}` : `${MARK.ok} ${fill(text.settingSaved, { label: row.label })}`
  $.ui.invalidate('ui.render')
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
  enabled = options.enabled === true
  count = Math.min(3, Math.max(1, Math.round(Number(options.count ?? 3)) || 3))
  look = lookFor(iconMode === 'nerd')

  on('session.start', async ($, e, next) => {
    await loadLook($)
    await $.command.register({
      name: 'mod-next-steps',
      description: text.commandDescription,
      argumentHint: '[settings|clear]',
    })
    await $.state.set({ plugin: 'mod-next-steps', key: 'pane' }, await isPaneOpen($))
    $.ui.invalidate('ui.render')

    return next(e)
  })

  on('command.run', { command: 'mod-next-steps' }, async ($, e) => ({ text: await answer($, e.args ?? '') }))

  // Subagent turns carry agentId and say nothing about the main prompt.
  on('turn.start', async ($, e, next) => {
    if (!(e as { agentId?: string }).agentId) {
      working = true
      clearSteps($)
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) return next(e)
    working = false
    const result = await next(e)
    if (enabled && e.reason === 'answer' && !e.isAborted && e.answer.trim() !== '') {
      const mine = epoch
      // Off the hook's own time: the turn never waits for the model.
      $.clock.after(0, () => suggest($, mine))
    }

    return result
  })

  on('prompt.submit', async ($, e, next) => {
    clearSteps($)

    return next(e)
  })

  // A /resume or /clear ends this session: its suggestions, and a reply still on its way, belong to it alone.
  on('session.end', async ($, e, next) => {
    working = false
    clearSteps($)

    return next(e)
  })

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
    if (clicked?.type === 'menu-entry' && clicked.id.startsWith('steps-row-')) await fillFrom($, Number(clicked.id.slice('steps-row-'.length)))
    if (clicked?.type === 'menu-entry' && clicked.id === 'steps-dismiss') clearSteps($)

    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) await $.state.set({ plugin: 'mod-next-steps', key: 'pane' }, false)

    return next(e)
  })

  // One panel at a time: another mod's pane opening closes this one, deferred past that plugin's dispatch.
  on('state.set', async ($, e, next) => {
    // The declared state names no other mod's pane, so the types narrow this event to never.
    if (e.key === 'pane' && e.plugin !== 'mod-next-steps' && (e as { value?: unknown }).value === true) {
      $.clock.after(0, async () => {
        if (!(await isPaneOpen($))) return
        await $.ui.close({ id: PANE })
        await $.state.set({ plugin: 'mod-next-steps', key: 'pane' }, false)
      })
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    await loadLook($)
    if (e.surface !== 'terminal' || e.props.hasSurvey) return next(e)
    const { Box, Button, Client, Text } = $.ui.resolve(e)
    // Toasts sit on top, so a tight band cuts them before anything else.
    const cards = toastCards({ Box, Client, Text }, toasts, look, text.tipToast)
    // A command waiting on the person outranks suggestions: the band has few rows, and a hidden hold looks like a hang.
    const isHolding = (await $.state.get({ plugin: 'mod-blast-radius', key: 'holding' })).value === true
    // Joins the shared pill row's top section when other mods drew one below; wrapping it would hide the row from mods drawn around this one, which then start a second row.
    const above = (below: RenderChildren, items: RenderChildren[]) => {
      const { group, row, rest, tip: menuTip } = splitRow(below)
      const tip = hovered?.id && hovered !== bandExpired ? tipLine({ Box, Text }, tipText(hovered)) : menuTip
      // A heads-up card drawn below this mod still goes above the suggestions: it is rarer and more urgent. Without mod-heads-up nothing matches.
      const isHeadsup = (node: unknown) => keyOf(node).startsWith('headsup-')
      const ours = items.findIndex(item => keyOf(item).startsWith('nextsteps'))
      const lifted = rest.filter(isHeadsup)
      const ordered = ours < 0 ? items : [...items.slice(0, ours), ...lifted, ...items.slice(ours)]
      const others = ours < 0 ? rest : rest.filter(node => !isHeadsup(node))
      if (group.length || row.length || tip) return pillRow({ Box, Client, Text }, look.nerd, group, row, [...ordered, ...others], tip, e.props.bodyColumns)
      return <Box key="nextsteps" flexDirection="column">{items}{below}</Box>
    }
    // A prompt sent while the mods below draw clears `steps`, so this frame draws the ones it checked.
    const shown = steps
    if (shown.length === 0 || isHolding) {
      const waiting = enabled && isSuggesting && !isHolding
      if (cards.length === 0 && !waiting) return next(e)
      return above(await next(e), [
        ...cards,
        waiting ? (
          <Box key="nextsteps-waiting" paddingX={1}>
            <Client key="steps-waiting" module="./entry.tsx" height={1} props={{ id: 'steps-waiting', label: text.thinking, isOpen: false, bg: THEME.bg, isBusy: true, spinner: true, still }} />
          </Box>
        ) : null,
      ])
    }
    const below = await next(e)
    const room = Math.max(MIN_ROOM, e.props.bodyColumns - ROW_CHROME)
    const row = (step: string, index: number) => (
      <Box key={`steps-line-${index}`} flexDirection="row">
        {pill({ Box, Text }, look.nerd, THEME.surface2, <Client key={`steps-row-${index}`} module="./entry.tsx" height={1} props={{ id: `steps-row-${index}`, label: fit(step, room), isOpen: false, bg: THEME.surface2, idle: THEME.muted, subLead: String(index + 1), subLeadColor: THEME.muted, nerd: look.nerd, tip: { glyph: bare(look.glyph.go), label: fill(text.tipSuggestionLabel, { n: index + 1 }), text: text.tipSuggestion }, still } satisfies EntryProps} />, `steps-pill-${index}`, cardFill(THEME.border))}
        <Box key={`steps-hotkey-${index}`} width={0} height={0} overflow="hidden">
          <Button key={`steps-hotkey-button-${index}`} label={step} hotkey={String(index + 1)} plain onPress={() => fillFrom($, index)} />
        </Box>
      </Box>
    )
    const dismiss = pill({ Box, Text }, look.nerd, THEME.surface2, <Client key="steps-dismiss" module="./entry.tsx" height={1} props={{ id: 'steps-dismiss', label: bare(look.glyph.close), isOpen: false, bg: THEME.surface2, nerd: look.nerd, tip: { glyph: bare(look.glyph.close), label: text.tipDismissLabel, text: text.tipDismiss }, still } satisfies EntryProps} />, 'steps-dismiss-pill', cardFill(THEME.border))

    return above(below, [
        ...cards,
        <Box key="nextsteps-block" flexDirection="column">
          <Box key="nextsteps-rows" flexDirection="column" paddingX={1} borderStyle="round" borderColor={THEME.border} backgroundColor={cardFill(THEME.border)}>
            <Box key="steps-first" flexDirection="row" justifyContent="space-between" columnGap={1}>
              {row(shown[0]!, 0)}
              {dismiss}
            </Box>
            {shown.slice(1).map((step, at) => row(step, at + 1))}
          </Box>
          {titleEdge({ Box, Text }, look, 'nextsteps', 'prompt', text.cardTitle, text.cardHint, 0)}
        </Box>,
    ])
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    await loadLook($)
    if (e.requestId !== PANE) return next(e)

    // @ts-expect-error The host's types omit Client from a Pane's elements, yet a Pane draws it.
    const { Box, Button, Client, Text } = $.ui.resolve(e)
    const rows = (await $.config.list()).filter(row => row.key.startsWith('mod-next-steps.'))
    const run = async (action: Action) => {
      const said = action.command === 'mod-next-steps' ? answer($, action.args ?? '') : Promise.resolve('')
      note = await said.then(text => `${MARK.ok} ${text || action.label}`).catch(error => `${MARK.warn} ${String(error)}`)
      $.ui.invalidate('ui.render')
    }

    return (
      <Box flexDirection="column" backgroundColor={THEME.bg} paddingX={1} minHeight={e.props.scroll.bodyRows}>
        {tabRow({ Box, Client, Text }, look.nerd, [{ id: 'mod-next-steps-settings-tab', label: `${text.paneHeading} ${MARK.sep} ${text.paneHeadingSettings}`, icon: look.glyph.gear, isOpen: true, tip: { glyph: look.glyph.gear, label: text.paneHeadingSettings, text: text.tipTabSettings } }], still)}
        {sepText({ Text }, withMark(look, note) || `${text.statusHint} ${MARK.sep} ${text.statusReload}`, statusColor(note), 'status', { wrap: 'truncate-end' })}
        {settingsBody({ Box, Button, Client, Text }, look, { rows, actions, working, run, previews, fields, still: still, tips: text.settingTips })}
        <Box key="footer-space" height={FOOTER_ROWS} flexShrink={0} />
        {paneFooter({ Box, Text }, hoveredTip(), e.props.bodyColumns, e.props.scroll)}
      </Box>
    )
  })
}

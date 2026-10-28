// mod-skill-panel / hooks/register.tsx, by v-amorim
// Registers the mod: wires the skills and agents tabs, settings pane, command and footer entry.
import type { ConfigValue, EngineInterface, Register } from 'claude-code'

import { layoutCloud, type CloudGroup, type CloudMessage, type CloudProps } from './cloud'
import { groupSkills, markDescription, paintsDescriptions, readFrontmatter, type Skill } from './tags'
import { fill, MARK, statusColor, THEME } from './theme'
import text from './text'
import { tagName } from './tags'
import { groupAgents, modelHue, readAgent, type Agent } from './agents'
import { cardSpace, HEAD_ROWS, stickyCard } from './card'
import { isTipMessage, type EntryMessage, type EntryProps, type Tip } from './entry'
import { cardFill, detectNerd, FOOTER_ROWS, lookFor, paneFooter, sepText, section, titleEdge, withMark, type IconMode } from './look'
import { labelsOf, menuEntry, pillRow, splitRow, tabRow, tipLine } from './pills'
import { settingChoice, settingsBody } from './settings'
import { TOAST_MS, ToastList, toastCards } from './toasts'

const homeOf = async ($: EngineInterface) => ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '').replace(/\\/g, '/')

const configDir = async ($: EngineInterface) => ((await $.env.get('CLAUDE_CONFIG_DIR')) || `${await homeOf($)}/.claude`).replace(/\\/g, '/')

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

const PANE = 'skill-panel'
const SETTINGS = 'skill-panel-settings'

let skills: Skill[] = []
let colored = false
let mods = new Set<string>()
let note = ''
let selected = 0
let agents: Agent[] = []
let selectedAgent = 0
// The folders the last scan looked in, for the empty-list text.
let agentFolders: string[] = []
// Which list the panel shows; its settings are a pane of their own.
let view: 'skills' | 'agents' = 'skills'

// Skills the panel lists: model-invocable ones, plus routers, which are the entry points even when flagged.
const listed = () => skills.filter(skill => !skill.hidden || skill.tag === 'router')
const orderedAgents = () => groupAgents(agents).flatMap(group => group.agents)

// Appends `word ` to the prompt unless it is already there.
async function addToPrompt($: EngineInterface, word: string, added: string) {
  const { text: current } = await $.prompt.read()
  if (!current.split(/\s+/).includes(word)) {
    const gap = current === '' || /\s$/.test(current) ? '' : ' '
    const filled = await $.prompt.fill({ text: `${gap}${word} `, mode: 'append' })
    note = filled.isFilled ? `${MARK.ok} ${added}` : `${MARK.warn} ${text.promptBusy}`
  }
  $.ui.invalidate('ui.render')
}

async function addSkill($: EngineInterface, index: number) {
  const skill = groupSkills(listed()).flatMap(group => group.skills)[index]
  if (skill) await addToPrompt($, `/${skill.name}`, fill(text.added, { name: skill.name }))
}

// An @agent- mention asks Claude to hand the work to that agent.
async function addAgent($: EngineInterface, index: number) {
  const agent = orderedAgents()[index]
  if (agent) await addToPrompt($, `@agent-${agent.name}`, fill(text.agentAdded, { name: agent.name }))
}

const isOpen = async ($: EngineInterface, id = PANE) => (await $.ui.panes()).some(pane => pane.id === id && pane.isPlaced)

// The command and the bar entry both toggle. An unplaced pane is waiting, not open.
async function togglePane($: EngineInterface) {
  if (await isOpen($)) {
    await $.ui.close({ id: PANE })
    await $.state.set({ plugin: 'mod-skill-panel', key: 'pane' }, false)
    return
  }
  if (await isOpen($, SETTINGS)) await $.ui.close({ id: SETTINGS })
  note = ''
  const opened = await $.ui.open({ id: PANE, title: text.paneTitle, closeOnEscape: true })
  if (!opened.isPlaced) $.ui.toast(fill(text.skillsWaiting, { reason: opened.reason }))
  await $.state.set({ plugin: 'mod-skill-panel', key: 'pane' }, opened.isPlaced)
}

// `/mod-skill-panel settings` and the title row's pill toggle the settings panel, which takes the sidebar's place.
async function toggleSettings($: EngineInterface) {
  if (await isOpen($, SETTINGS)) {
    await $.ui.close({ id: SETTINGS })
    await $.state.set({ plugin: 'mod-skill-panel', key: 'pane' }, false)
    return
  }
  if (await isOpen($)) await $.ui.close({ id: PANE })
  note = ''
  const opened = await $.ui.open({ id: SETTINGS, title: text.settingsPaneTitle, closeOnEscape: true })
  if (!opened.isPlaced) $.ui.toast(fill(text.settingsWaiting, { reason: opened.reason }))
  await $.state.set({ plugin: 'mod-skill-panel', key: 'pane' }, opened.isPlaced)
}


// A saved change reloads this mod, which redraws the panel with the new value.
async function saveSetting($: EngineInterface, key: string, value: ConfigValue) {
  const row = (await $.config.list()).find(each => each.key === key)
  const result = await $.config.set({ key, value })
  note = 'deny' in result && result.deny ? `${MARK.warn} ${result.deny}` : `${MARK.ok} ${fill(text.settingSaved, { label: row?.label ?? key })}`
  $.ui.invalidate('ui.render')
}

// The panel's title line: skills, agents and settings as tabs, the shown one open.
const tabs = (open: 'skills' | 'agents' | 'settings') => [
  { id: 'skills-tab', label: text.paneTitle, icon: look.glyph.icon.skill ?? look.glyph.title, isOpen: open === 'skills', count: listed().length, tip: { glyph: look.glyph.icon.skill ?? look.glyph.title, label: text.paneTitle, text: text.skillsTabTip } },
  { id: 'skills-agents', label: text.agentsTab, icon: look.glyph.icon.Agent ?? look.glyph.mark.agent ?? look.glyph.title, isOpen: open === 'agents', count: agents.length, tip: { glyph: look.glyph.icon.Agent ?? look.glyph.mark.agent ?? look.glyph.title, label: text.agentsTab, text: text.agentsTabTip } },
  { id: 'skills-settings', label: text.settingsTab, icon: look.glyph.gear, isOpen: open === 'settings', tip: { glyph: look.glyph.gear, label: text.settingsTab, text: text.settingsTabTip } },
]

// A list tab: switch the list, opening the sidebar first when its settings are shown.
async function showView($: EngineInterface, next: typeof view) {
  view = next
  note = ''
  if (!(await isOpen($))) await togglePane($)
  $.ui.invalidate('ui.render')
}

// Border, title and six lines of description.
const CARD_ROWS = 8
const TEXT_ROWS = CARD_ROWS - 2
const MORE = 'card-more'
// The card whose description shows every line, as `view:index`; a click on its control flips it, and pointing at another chip clears it.
let fullCard = ''

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


// True while the pointer is on this mod's pill entry, which then shows its tip under the row.
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

const toasts = new ToastList('skills')
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
    await loadLook($)
    colored = paintsDescriptions((await $.session.version().catch(() => undefined))?.version)
    await $.command.register({ name: 'mod-skill-panel', description: text.commandDescription, argumentHint: '[settings]' })
    const config = await configDir($)
    const projectClaude = `${String(e.cwd ?? '').replace(/\\/g, '/')}/.claude`
    // The person's skills, then the project's, which win over a same-named one as they do in Claude Code.
    const foundSkills = new Map<string, Skill>()
    for (const root of [`${config}/skills`, `${projectClaude}/skills`]) {
      for (const entry of await $.fs.list(root).catch(() => [])) {
        if (entry.kind !== 'dir') continue
        const text = await $.fs.read(`${root}/${entry.name}/SKILL.md`).catch(() => '')
        const meta = readFrontmatter(String(text))
        if (!meta) continue
        const name = meta.name ?? entry.name
        foundSkills.set(name, { name, tag: meta.tag, description: meta.description ?? '', hidden: meta.hidden })
      }
    }
    skills = [...foundSkills.values()]
    // The person's agents, then the project's, which win over a same-named one as they do in Claude Code.
    const foundAgents = new Map<string, Agent>()
    agentFolders = [`${config}/agents`, `${projectClaude}/agents`]
    for (const agentRoot of agentFolders) {
      for (const entry of await $.fs.list(agentRoot).catch(() => [])) {
        if (entry.kind !== 'file' || !entry.name.endsWith('.md')) continue
        const agent = readAgent(String(await $.fs.read(`${agentRoot}/${entry.name}`).catch(() => '')), entry.name.slice(0, -3))
        if (agent) foundAgents.set(agent.name, agent)
      }
    }
    agents = [...foundAgents.values()]
    const modDirs = await $.fs.list(`${config}/mods`).catch(() => [])
    mods = new Set(modDirs.filter(entry => entry.kind === 'dir').map(entry => entry.name))
    // The typeahead caches each answer for the session, so ask it to list again.
    $.ui.invalidate('command.describe')
    // The bar entry reads this; an unload drops the pane without raising ui.close here.
    await $.state.set({ plugin: 'mod-skill-panel', key: 'pane' }, await isOpen($))
    // A hot reload leaves an open pane on its old drawing until something redraws it.
    $.ui.invalidate('ui.render')

    return next(e)
  })

  on('command.describe', async ($, e, next) => {
    const answer = await next(e)
    // A mod is a folder under ~/.claude/mods or an install from this repo's marketplace.
    const [plugin, market] = e.provider.plugin.split('@')
    const tag = skills.find(skill => skill.name === e.command)?.tag ?? (mods.has(plugin!) || market === 'claude-mods' ? 'mods' : undefined)
    if (!tag) return answer

    return { ...answer, description: markDescription(answer.description, tag, { nerd: look.nerd, colored }) }
  })
  on('command.run', { command: 'mod-skill-panel' }, async ($, e) => {
    if ((e.args ?? '').trim() === 'settings') await toggleSettings($)
    else await togglePane($)

    return { text: '' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE || e.id === SETTINGS) await $.state.set({ plugin: 'mod-skill-panel', key: 'pane' }, await isOpen($, e.id === PANE ? SETTINGS : PANE))

    return next(e)
  })

  // One panel at a time: another mod's pane opening closes this one.
  on('state.set', async ($, e, next) => {
    // Deferred past this dispatch, so this mod's own state write is not nested in another plugin's.
    if (e.key === 'pane' && e.plugin !== 'mod-skill-panel' && (e as { value?: unknown }).value === true) {
      $.clock.after(0, async () => {
        const wasOpen = (await isOpen($)) || (await isOpen($, SETTINGS))
        if (!wasOpen) return
        await $.ui.close({ id: PANE })
        await $.ui.close({ id: SETTINGS })
        await $.state.set({ plugin: 'mod-skill-panel', key: 'pane' }, false)
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
    if (hidden.value === true) {
      if (toasts.items.length === 0) return next(e)
      const { Box, Client, Text } = $.ui.resolve(e)
      return <Box key="toasts-skills" flexDirection="column">{toastCards({ Box, Client, Text }, toasts, look, text.tipToast)}{await next(e)}</Box>
    }
    const nerd = look.nerd

    const { Box, Client, Text } = $.ui.resolve(e)
    // Reading the value subscribes the bar to redraws; the look trusts the pane list itself.
    await $.state.get({ plugin: 'mod-skill-panel', key: 'pane' })
    const shown = (await isOpen($)) || (await isOpen($, SETTINGS))
    const { group, row, rest, tip } = splitRow(await next(e))
    // Opening the pane from here queues nothing, so the entry stays live mid-turn.
    const entry = menuEntry({ Box, Client, Text }, nerd, 'skills', { label: text.pillLabel, isOpen: shown, idle: THEME.pill, isBusy: isOpening, still, labels })

    return pillRow({ Box, Client, Text }, nerd, [entry, ...group], row, [...toastCards({ Box, Client, Text }, toasts, look, text.tipToast), ...rest], toastTip ? tipLine({ Box, Text }, toastTip) : tipShown ? tipLine({ Box, Text }, text.pillTip) : tip, e.props.bodyColumns)
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
      const isToast = Boolean(id?.startsWith('toast-skills-'))
      toastTip = isToast ? `${label}: ${tipText}` : ''
      if (toastTip) expireBandTip($)
      hoveredTip = !isToast && id && glyph !== undefined && label && tipText ? { glyph, label, text: tipText } : null
      const chip = id?.startsWith('chip:') ? Number(id.slice(5)) : -1
      if (chip >= 0) {
        if (`${view}:${chip}` !== fullCard) fullCard = ''
        if (view === 'agents') selectedAgent = chip
        else selected = chip
      }
      $.ui.invalidate('ui.render')
      return next(e)
    }
    const hover = e.data as { type?: string; id?: string; isOver?: boolean }
    if (hover?.type === 'menu-hover' && hover.id === 'skills') {
      tipShown = hover.isOver === true
      if (tipShown) expireBandTip($)
      $.ui.invalidate('ui.render')
    }
    const message = e.data as EntryMessage
    if (message?.type === 'menu-entry' && message.id === 'skills') await openingPane($)
    // The title line's tabs swap the lists and the settings; the open tab does nothing.
    if (message?.type === 'menu-entry' && message.id === 'skills-settings' && !(await isOpen($, SETTINGS))) await toggleSettings($)
    if (message?.type === 'menu-entry' && message.id === MORE) {
      const here = `${view}:${view === 'agents' ? selectedAgent : selected}`
      fullCard = fullCard === here ? '' : here
      $.ui.invalidate('ui.render')
    }
    if (message?.type === 'menu-entry' && message.id === 'skills-tab') await showView($, 'skills')
    if (message?.type === 'menu-entry' && message.id === 'skills-agents') await showView($, 'agents')
    const change = settingChoice(e.data)
    if (change) await saveSetting($, change.key, change.value)

    return next(e)
  })

  // The cloud reports a click, which adds the chip to the prompt; the chip under the pointer arrives as a tip message.
  on('ui.message', { requestId: 'skill-panel' }, async ($, e, next) => {
    const message = e.data as CloudMessage
    if (message?.type === 'add') await (view === 'agents' ? addAgent($, message.index) : addSkill($, message.index))

    return next(e)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    await loadLook($)
    if (e.requestId !== PANE && e.requestId !== SETTINGS) return next(e)
    if (isOpening) $.clock.after(0, () => endOpening($))

    // @ts-expect-error The host's types omit Client from a Pane's elements, yet a Pane draws it.
    const { Box, Button, Client, Text } = $.ui.resolve(e)

    if (e.requestId === SETTINGS) {
      const rows = (await $.config.list()).filter(row => row.key.startsWith('mod-skill-panel.'))
      return (
        <Box flexDirection="column" backgroundColor={THEME.bg} paddingX={1} minHeight={e.props.scroll.bodyRows}>
          {tabRow({ Box, Client, Text }, look.nerd, tabs('settings'), still)}
          {sepText({ Text }, withMark(look, note) || fill(text.settingsHint, { sep: MARK.sep }), statusColor(note), 'settings-status', { wrap: 'truncate-end' })}
          <Box marginTop={0}>{settingsBody({ Box, Button, Client, Text }, look, { rows, actions: [], working: false, run: async () => {}, still })}</Box>
          <Box key="footer-space" height={FOOTER_ROWS} flexShrink={0} />
          {paneFooter({ Box, Text }, hoveredTip, e.props.bodyColumns, e.props.scroll)}
        </Box>
      )
    }

    // Both lists draw the same way: a cloud of groups and the card for the pointed entry.
    let index = 0
    let cloud: CloudGroup[]
    let card: { icon: string; hex: string; title: string; tag: string; extra: string; description: string } | undefined
    if (view === 'agents') {
      const agentIcon = look.glyph.icon.Agent ?? look.glyph.mark.agent ?? look.glyph.title
      cloud = groupAgents(agents).map(group => ({
        tag: group.model,
        label: group.model,
        icon: agentIcon,
        hex: modelHue(group.model),
        tip: fill(text.tagTip, { count: group.agents.length }),
        skills: group.agents.map(agent => ({ index: index++, name: agent.name, tip: fill(text.agentChipTip, { name: agent.name }) })),
      }))
      const agent = orderedAgents()[selectedAgent]
      if (agent) {
        const extra = agent.tools ? fill(text.agentTools, { count: agent.tools }) : text.agentAllTools
        card = { icon: agentIcon, hex: modelHue(agent.model), title: `@agent-${agent.name}`, tag: agent.model, extra, description: agent.description }
      }
    } else {
      const groups = groupSkills(listed())
      cloud = groups.map(group => ({
        tag: group.tag,
        label: tagName(group.tag),
        icon: group.swatch.icon,
        hex: group.swatch.hex,
        tip: fill(text.tagTip, { count: group.skills.length }),
        skills: group.skills.map(skill => ({ index: index++, name: skill.name, tip: fill(text.chipTip, { name: skill.name }) })),
      }))
      const entry = groups.flatMap(group => group.skills.map(skill => ({ skill, group })))[selected]
      if (entry) card = { icon: entry.group.swatch.icon, hex: entry.group.swatch.hex, title: `/${entry.skill.name}`, tag: tagName(entry.group.tag), extra: '', description: entry.skill.description }
    }
    // Pane padding, then the section's border and padding.
    const width = e.props.bodyColumns - 2 - 4
    const empty = view === 'agents' && agents.length === 0
    const noSkills = view === 'skills' && listed().length === 0

    // The card's text is the pane's width less its border and padding; a description past its rows gives the last one to the control.
    const wrapped = card ? wrapRows(card.description || (view === 'agents' ? text.noAgentDescription : text.noDescription), Math.max(10, e.props.bodyColumns - 6)) : []
    const isClipped = wrapped.length > TEXT_ROWS
    const isFull = isClipped && fullCard === `${view}:${view === 'agents' ? selectedAgent : selected}`
    // Opened, the card grows to every row, as far as the pane has room for it.
    const roomRows = Math.max(TEXT_ROWS, e.props.scroll.bodyRows - HEAD_ROWS - FOOTER_ROWS - 4)
    const textShown = isFull ? Math.min(wrapped.length, roomRows) : TEXT_ROWS
    const cardRows = CARD_ROWS + (textShown - TEXT_ROWS)
    const shownRows = wrapped.slice(0, textShown)
    const moreLabel = isFull ? text.showLess : text.showAll
    const moreArrow = isFull ? look.glyph.less : look.glyph.more
    const moreControl = (
      <Client key={MORE} module="./entry.tsx" width={[...moreLabel].length + 4} height={1} props={{ id: MORE, label: moreLabel, lead: moreArrow, leadColor: THEME.accent, isOpen: false, bg: cardFill(), idle: THEME.muted, still, nerd: look.nerd, tip: { glyph: moreArrow, label: moreLabel, text: isFull ? text.tipShowLess : text.tipShowAll } } satisfies EntryProps} />
    )

    return (
      <Box flexDirection="column" backgroundColor={THEME.bg} paddingX={1} minHeight={e.props.scroll.bodyRows}>
        {tabRow({ Box, Client, Text }, look.nerd, tabs(view), still)}
        {sepText({ Text }, withMark(look, note) || fill(view === 'agents' ? text.agentsHint : text.hint, { sep: MARK.sep }), statusColor(note), 'status', { wrap: 'truncate-end' })}
        {empty ? <Text color={THEME.muted}>{fill(text.noAgents, { folders: agentFolders.join(' or ') })}</Text> : null}
        {noSkills ? <Text color={THEME.muted}>{text.noSkills}</Text> : null}
        {card ? cardSpace({ Box }, cardRows) : null}
        {noSkills ? null : section({ Box, Text }, look, 'cloud', '', '', (
          <Client key={`${view}-cloud`} module="./cloud.tsx" height={layoutCloud(cloud, width).rows.length} props={{ groups: cloud, width, selected: view === 'agents' ? selectedAgent : selected, nerd: look.nerd, still } satisfies CloudProps} />
        ))}
        {card
          ? [stickyCard({ Box, Text }, e.props.scroll.offset, e.props.bodyColumns, cardRows, (
              <Box key="card-body" flexDirection="column">
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
                </Box>
              </Box>
            )),
              <Box key="card-edge-wrap" position="absolute" top={Math.max(HEAD_ROWS, e.props.scroll.offset)} left={1} width={Math.max(10, e.props.bodyColumns - 2)} height={1}>
                {titleEdge({ Box, Text }, look, 'card', view === 'agents' ? 'agent' : 'skill', card.title, [card.tag, card.extra].filter(Boolean).join(` ${MARK.sep} `), 0)}
              </Box>]
          : null}
        <Box key="footer-space" height={FOOTER_ROWS} flexShrink={0} />
        {paneFooter({ Box, Text }, hoveredTip, e.props.bodyColumns, e.props.scroll)}
      </Box>
    )
  })
}

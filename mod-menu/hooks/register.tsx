// mod-menu / hooks/register.tsx, by v-amorim: the /mod-menu command, hidden and labels
import type { EngineInterface, Register } from 'claude-code'

import { beaconsOf, clientKeysOf, entryPad, hasKey, hiddenTipOf, pillRow, readoutsOf } from './pills'
import { revive } from './revive'
import { fill } from './theme'
import text from './text'

const LABELS = ['auto', 'always', 'never'] as const
type Labels = (typeof LABELS)[number]
const isLabels = (value: unknown): value is Labels => LABELS.some(each => each === value)
// The mods that draw an entry in the band; each lists its settings rows in config.list once installed and enabled.
const PANEL_MODS = ['mod-file-tree', 'mod-heads-up', 'mod-manager', 'mod-model-effort', 'mod-progress', 'mod-prompts', 'mod-skill-panel', 'mod-wrap-up']
const owners = new Map<string, string>()
let relays = 0
const BOOT_KEY = { plugin: 'mod-menu', key: 'booted' } as const
const LABELS_KEY = { plugin: 'mod-menu', key: 'labels' } as const

type Drawn = { type?: string; props?: { display?: string; height?: unknown; borderStyle?: unknown; children?: unknown }; children?: unknown }
const drawsSomething = (node: unknown): boolean => {
  if (Array.isArray(node)) return node.some(drawsSomething)
  if (!node || typeof node !== 'object') return false
  const { type, props, children } = node as Drawn
  if (props?.display === 'none' || type === 'engine') return false
  if (type === 'Text' || type === 'Client' || props?.borderStyle || (typeof props?.height === 'number' && props.height > 0)) return true
  return drawsSomething(children ?? props?.children)
}

// The labels state no longer says the setting: a settings pane saved a new one, which reloads this mod with no session start.
const isStale = async ($: EngineInterface, labels: Labels) => (await $.state.get(LABELS_KEY)).value !== labels

// A /clear empties $.state and starts no session, so an unset marker means the two values must be written again.
async function restore($: EngineInterface, labels: Labels) {
  if ((await $.state.get(BOOT_KEY)).value) {
    if (!(await isStale($, labels))) return false
    await $.state.set(LABELS_KEY, labels)
    return true
  }
  await $.state.set(BOOT_KEY, true)
  await $.state.set({ plugin: 'mod-menu', key: 'host' }, true)
  await $.state.set({ plugin: 'mod-menu', key: 'hidden' }, (await $.store.get('hidden')) === true)
  await $.state.set(LABELS_KEY, labels)

  return true
}

// Panel mods draw their own entries in the band above the prompt and read `hidden` and `labels`; this mod owns both.
export const register: Register = (on, options) => {
  const labels = isLabels(options.labels) ? options.labels : 'auto'
  let restoring = false

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'mod-menu', description: text.commandDescription })
    await restore($, labels)
    $.ui.invalidate('ui.render')

    return next(e)
  })

  // Drawing may not write state, so the first draw after a /clear schedules the restore and the redraw follows it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!restoring && (!(await $.state.get(BOOT_KEY)).value || (await isStale($, labels)))) {
      restoring = true
      $.clock.after(0, async () => {
        if (await restore($, labels).catch(() => false)) $.ui.invalidate('ui.render')
        restoring = false
      })
    }

    return next(e)
  })

  // Each mod draws its entry hidden; the one row of entries is drawn here, and its clicks go back to the owner.
  on('ui.render', { component: 'AbovePromptList' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.hasSurvey) return next(e)
    if ((await $.state.get({ plugin: 'mod-menu', key: 'hidden' })).value === true) return next(e)
    const found = e.props.rows.flatMap(row => beaconsOf(row.tree).map(props => ({ plugin: row.plugin, props })))
    // Blast radius's pills (the AFK pass, the waiting chip) end the row, after wrap-up and the model meter.
    const readouts = e.props.rows
      .flatMap(row => readoutsOf(row.tree).map(node => ({ plugin: row.plugin, node })))
      .sort((a, b) => Number(a.plugin === 'mod-blast-radius') - Number(b.plugin === 'mod-blast-radius'))
    // While a call is held only its card and the pills draw, so other rows cannot fill the band and cut the card off.
    const holder = e.props.rows.find(row => hasKey(row.tree, 'band-exclusive'))
    // A row whose only shown node is the engine's still takes lines once stacked, so it is left out.
    const kept = e.props.rows.filter(row => (holder ? row.plugin === holder.plugin : drawsSomething(row.tree)))
    const stacked = () => next({ ...e, props: { ...e.props, rows: kept } })
    if (found.length === 0 && readouts.length === 0) return stacked()
    owners.clear()
    // A leave posts no id, so the owner is also found by the drawn entry's key.
    for (const { plugin, props } of found) owners.set(props.id, plugin).set(`menu-entry-${props.id}`, plugin)
    for (const { plugin, node } of readouts) for (const key of clientKeysOf(node)) owners.set(key, plugin)
    const { Box, Client, Text } = $.ui.resolve(e)
    const tip = e.props.rows.map(row => hiddenTipOf(row.tree)).find(Boolean) ?? null
    const entries = found.map(({ props }) => entryPad({ Box, Client, Text }, props.nerd === true, props))
    const row = readouts.map(({ node }) => revive({ Client }, node))

    return (
      <Box key="menu-host" flexDirection="column">
        {await stacked()}
        {pillRow({ Box, Client, Text }, found[0]?.props.nerd === true, entries, row, [], tip, e.props.bodyColumns)}
      </Box>
    )
  })

  // Clicks and hovers land here, since the entries are this mod's; the owner hears them through the relay key.
  on('ui.message', async ($, e, next) => {
    const id = (e.data as { id?: unknown } | undefined)?.id
    const to = owners.get(e.element) ?? (typeof id === 'string' ? owners.get(id) : undefined)
    if (to) await $.state.set({ plugin: 'mod-menu', key: 'relay' }, { to, data: e.data as object, n: (relays += 1) })

    return next(e)
  })

  on('command.run', { command: 'mod-menu' }, async ($, e) => {
    const [word, mode] = (e.args ?? '').trim().split(/\s+/)
    if (word === 'labels') {
      if (!isLabels(mode)) return { text: text.labelsUsage }
      // The saved setting reloads this mod; the state is set now so the pills redraw at once.
      await $.config.set({ key: 'mod-menu.labels', value: mode })
      await $.state.set(LABELS_KEY, mode)
      $.ui.invalidate('ui.render')

      return { text: fill(text.labelsSet, { mode }) }
    }
    if (word) return { text: text.usage }

    const rows = await $.config.list().catch(() => [])
    if (!rows.some(row => PANEL_MODS.some(mod => row.key.startsWith(`${mod}.`)))) return { text: text.noPanels }

    await restore($, labels)
    const hidden = (await $.state.get({ plugin: 'mod-menu', key: 'hidden' })).value !== true
    await $.state.set({ plugin: 'mod-menu', key: 'hidden' }, hidden)
    await $.store.set('hidden', hidden)
    $.ui.invalidate('ui.render')

    return { text: text[hidden ? 'menuHidden' : 'menuShown'] }
  })
}

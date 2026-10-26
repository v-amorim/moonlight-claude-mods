// mod-menu / hooks/register.tsx, by v-amorim: the /mod-menu command, hidden and labels
import type { EngineInterface, Register } from 'claude-code'

import { fill } from './theme'
import text from './text'

const LABELS = ['auto', 'always', 'never'] as const
type Labels = (typeof LABELS)[number]
const isLabels = (value: unknown): value is Labels => LABELS.some(each => each === value)
// The mods that draw an entry in the band; each lists its settings rows in config.list once installed and enabled.
const PANEL_MODS = ['mod-file-tree', 'mod-heads-up', 'mod-manager', 'mod-model-effort', 'mod-progress', 'mod-prompts', 'mod-skill-panel', 'mod-wrap-up']
const BOOT_KEY = { plugin: 'mod-menu', key: 'booted' } as const
const LABELS_KEY = { plugin: 'mod-menu', key: 'labels' } as const

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

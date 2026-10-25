// mod-manager / tests/cards.test.tsx, by v-amorim: the first-run and updates cards above the prompt
import { expect, test } from 'claude-code/testing'

import { updatesCard } from '../hooks/cards'
import { lookFor } from '../hooks/look'
import { THEME } from '../hooks/theme'

const neutral = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const hooks = JSON.stringify({ modules: ['./register.tsx'] })
const WT_SETTINGS = '/l/Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json'
const NERD_ENV = { WT_SESSION: 'x', LOCALAPPDATA: '/l' }
const NERD_FILES = { [WT_SETTINGS]: '{ "profiles": { "defaults": { "font": { "face": "FiraCode Nerd Font" } } } }' }
const PILL_CAP = String.fromCodePoint(0xe0b6)
const SIGNATURE = 'twomod@2.0.0,upmod@2.0.0'

const plugin = (files: Record<string, string>, root: string, name: string, version: string) => {
  files[`${root}/.claude-plugin/plugin.json`] = JSON.stringify({ name, description: `${name} does a thing`, version })
  files[`${root}/hooks/hooks.json`] = hooks
  files[`${root}/hooks/register.tsx`] = ''
}

// The marketplace lists three mods at 2.0.0; upmod and twomod lag behind, onmod is current.
const diskOf = () => {
  const files: Record<string, string> = {
    '/h/.claude/settings.json': JSON.stringify({ enabledPlugins: { 'onmod@claude-mods': true, 'upmod@claude-mods': true, 'twomod@claude-mods': true } }, null, 2) + '\n',
    '/h/.claude/plugins/installed_plugins.json': JSON.stringify({
      plugins: {
        'mod-manager@claude-mods': [{ scope: 'user', installPath: '/cache/mm' }],
        'onmod@claude-mods': [{ scope: 'user', installPath: '/cache/onmod' }],
        'upmod@claude-mods': [{ scope: 'user', installPath: '/cache/upmod' }],
        'twomod@claude-mods': [{ scope: 'user', installPath: '/cache/twomod' }],
      },
    }),
    '/h/.claude/plugins/known_marketplaces.json': JSON.stringify({ 'claude-mods': { source: { source: 'github', repo: 'x/y' }, installLocation: '/m' } }),
    '/m/.claude-plugin/marketplace.json': JSON.stringify({ plugins: ['onmod', 'upmod', 'twomod'].map(name => ({ name, description: `${name} listed`, source: `./${name}` })) }),
  }
  for (const name of ['onmod', 'upmod', 'twomod']) plugin(files, `/m/${name}`, name, '2.0.0')
  plugin(files, '/cache/mm', 'mod-manager', '2.0.0')
  plugin(files, '/cache/onmod', 'onmod', '2.0.0')
  plugin(files, '/cache/upmod', 'upmod', '1.9.9')
  plugin(files, '/cache/twomod', 'twomod', '1.0.0')
  return files
}

type Rig = { files: Record<string, string>; store: Map<string, unknown>; events: string[]; opened: string[]; band: (props?: Record<string, unknown>, surface?: string) => Promise<any> }

type RigOptions = { store?: [string, unknown][]; env?: Record<string, string>; extra?: Record<string, string>; hidden?: boolean; storeDown?: boolean }

// Over a fake disk and store: every settings write, CLI call and command lands in `events`, in order.
const rig = ($: any, on: any, { store: initial = [], env = {}, extra = {}, hidden = false, storeDown = false }: RigOptions = {}): Rig => {
  const files = { ...diskOf(), ...extra }
  const store = new Map<string, unknown>(initial)
  const events: string[] = []
  const opened: string[] = []
  on('fs.read', (_$: unknown, e: { path: string }) => {
    const path = neutral(e.path)
    if (!(path in files)) throw new Error('ENOENT')
    return { value: files[path]! }
  })
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    if (neutral(e.path).endsWith('/settings.json')) events.push('write settings')
    files[neutral(e.path)] = e.text
    return { value: undefined }
  })
  on('fs.list', () => ({ value: [] }))
  on('env.get', (_$: unknown, e: { name: string }) => ({ value: e.name === 'USERPROFILE' ? '/h' : env[e.name] }))
  on('process.run', (_$: unknown, e: { argv: string[] }) => {
    if (e.argv[1] !== '--version') events.push(e.argv.join(' '))
    return { value: { exitCode: 0, stdout: '2.1.291 (Claude Code)\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('settings.read', () => ({ value: { enabledPlugins: JSON.parse(files['/h/.claude/settings.json']!).enabledPlugins } }) as never)
  on('command.run', (_$: unknown, e: { command: string }) => {
    events.push(`command ${e.command}`)
    return { text: '' }
  })
  on('store.get', (_$: unknown, e: { key: string }) => {
    if (storeDown) throw new Error('store unavailable')
    return { value: store.get(e.key) }
  })
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    if (storeDown) throw new Error('store unavailable')
    store.set(e.key, e.value)
    return { value: undefined } as never
  })
  on('state.get', (_$: unknown, e: { key: string }) => ({ value: { value: e.key === 'hidden' && hidden ? true : undefined } }) as never)
  on('ui.open', (_$: unknown, e: { id: string }) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({ value: [] }))
  on('config.list', () => ({ value: [] }))
  on('turn.start', (_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('ui.render', ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>other mod</Text>
  })
  const band = (props: Record<string, unknown> = {}, surface = 'terminal') =>
    $.ui.mount({ plugin: 'mod-manager', surface, component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 80, scroll: { offset: 0, bodyRows: 12 }, view: {}, ...props } } as never)
  return { files, store, events, opened, band }
}

// The catalog, the mod list and the font load beside the first draw, so a check waits for them to land.
const eventually = async <T,>(ui: any, look: () => Promise<T>) => {
  for (let tries = 0; tries < 100; tries++) {
    await ui.redraw()
    const found = await look()
    if (found) return found
    await sleep(20)
  }
  return look()
}

const settled = async (events: string[], last: string) => {
  for (let waited = 0; waited < 4000 && !events.includes(last); waited += 20) await sleep(20)
}

const click = (ui: any, key: string) => ui.pointer({ in: key, type: 'down', button: 'left', x: 1, y: 0 })

const hover = (ui: any, key: string) => ui.pointer({ in: key, type: 'move', x: 1, y: 0 })

const hasCard = (ui: any, key: string) => ui.find({ key })

const drawn = async (ui: any, key?: string) => JSON.stringify(await ui.drawn(key ? { in: key } : undefined))

const WELCOMED: [string, unknown][] = [['welcomed', true]]

test('first-run: shows once', async ($, on) => {
  const { band, store } = rig($, on)
  const first = await band()
  expect(await eventually(first, () => hasCard(first, 'card-welcome'))).toBeDefined()
  expect(await first.find({ type: 'Text', text: 'Claude Code mods are in' })).toBeDefined()
  expect(await first.find({ type: 'Text', text: 'Pick the mods to install, turn on updates, and more.' })).toBeDefined()
  // A real Button: a narrow terminal opens the pane only for a person's press, never for a Client's post.
  expect(await first.find({ type: 'Button', key: 'card-welcome-open' })).toBeDefined()
  expect(await first.find({ key: 'card-welcome-skip' })).toBeDefined()
  // The pill entry stays beside the card.
  expect(await first.find({ key: 'menu-entry-manager' })).toBeDefined()
  expect(store.has('welcomed')).toBe(false)
  await click(first, 'card-welcome-skip')
  await first.unmount()

  // Once `welcomed` is set, a new draw shows no welcome card, only the pill entry.
  const second = await band()
  await eventually(second, () => second.find({ key: 'menu-entry-manager' }))
  expect(await hasCard(second, 'card-welcome')).toBeUndefined()
  await second.unmount()
})

test('first-run: open setup clears it', async ($, on) => {
  const { band, store, opened } = rig($, on)
  const ui = await band()
  await eventually(ui, () => hasCard(ui, 'card-welcome'))
  await ui.press({ key: 'card-welcome-open' })
  await settled(opened, 'manager')
  expect(opened).toEqual(['manager'])
  expect(store.get('welcomed')).toBe(true)
  await ui.redraw()
  expect(await hasCard(ui, 'card-welcome')).toBeUndefined()
  await ui.unmount()
})

test('first-run: not now clears it', async ($, on) => {
  const { band, store, opened } = rig($, on)
  const ui = await band()
  await eventually(ui, () => hasCard(ui, 'card-welcome'))
  await click(ui, 'card-welcome-skip')
  expect(store.get('welcomed')).toBe(true)
  await ui.redraw()
  expect(await hasCard(ui, 'card-welcome')).toBeUndefined()
  // Putting it off never opens the pane.
  expect(opened).toEqual([])
  await ui.unmount()
})

test('first-run: nerd tip only without a nerd font (missing)', async ($, on) => {
  const { band } = rig($, on)
  const ui = await band()
  await eventually(ui, () => hasCard(ui, 'card-welcome'))
  expect(await ui.find({ type: 'Text', text: /A Nerd Font makes the icons sharper\./ })).toBeDefined()
  const link = await ui.find({ type: 'Link' })
  expect(link?.props.href).toBe('https://www.nerdfonts.com/font-downloads')
  expect(link?.props.label).toBe('How')
  await ui.unmount()
})

test('first-run: nerd tip only without a nerd font (found)', async ($, on) => {
  const { band } = rig($, on, { env: NERD_ENV, extra: NERD_FILES })
  const ui = await band()
  await eventually(ui, () => hasCard(ui, 'card-welcome'))
  expect(await ui.find({ type: 'Text', text: /A Nerd Font makes the icons sharper\./ })).toBeUndefined()
  expect(await ui.find({ type: 'Link' })).toBeUndefined()
  await ui.unmount()
})

test('update-card: shows with updates', async ($, on) => {
  const { band } = rig($, on, { store: WELCOMED })
  const ui = await band()
  await eventually(ui, () => hasCard(ui, 'card-updates'))
  expect(await ui.find({ type: 'Text', text: '2 mods have updates' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Twomod {2}$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '1.0.0 → ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '1.9.9 → ' })).toBeDefined()
  // The new version is drawn in accent, and the buttons sit at the card's right end.
  expect((await ui.findAll({ type: 'Text', text: '2.0.0' })).map((node: any) => node.props.color)).toContain(THEME.accent)
  expect((await ui.find({ key: 'card-updates-buttons' }))?.props.justifyContent).toBe('flex-end')
  // The current mod has no row, and no welcome card shows.
  expect(await ui.find({ type: 'Text', text: /^Onmod/ })).toBeUndefined()
  expect(await hasCard(ui, 'card-welcome')).toBeUndefined()
  expect(await drawn(ui, 'card-update-run')).toContain('Update 2')
  expect(await drawn(ui, 'card-update-skip')).toContain('Not now')
  await ui.unmount()
})

test('update-card: while updating the button spins and says Updating, with no icon', () => {
  const part = (type: string) => (props: object) => ({ type, props })
  const elements = { Box: part('Box'), Client: part('Client'), Text: part('Text'), Link: part('Link') }
  const mod = (name: string) => ({ name, version: '2.0.0', installedVersion: '1.0.0' }) as never
  const draw = (isUpdating: boolean) => JSON.stringify(updatesCard(elements, lookFor(true), { updates: [mod('upmod')], shown: name => name, isWorking: isUpdating, isUpdating, still: true, maxRows: 12 }))
  expect(draw(true)).toContain('"label":"Updating"')
  expect(draw(true)).toContain('"spinner":true,"tight":true')
  expect(draw(true)).not.toContain('subLead')
  expect(draw(false)).not.toContain('"spinner"')
})

test('update-card: runs the update steps only, then reloads', async ($, on) => {
  const { band, events } = rig($, on, { store: WELCOMED })
  const ui = await band()
  await eventually(ui, () => hasCard(ui, 'card-updates'))
  await click(ui, 'card-update-run')
  await settled(events, 'command reload-plugins')
  expect(events.filter(line => line.startsWith('claude plugin install'))).toEqual([])
  expect(events).toContain('claude plugin update upmod@claude-mods')
  expect(events).toContain('claude plugin update twomod@claude-mods')
  expect(events[events.length - 1]).toBe('command reload-plugins')
  await ui.unmount()
})

test('update-card: not now hides it', async ($, on) => {
  const { band, store } = rig($, on, { store: WELCOMED })
  const ui = await band()
  await eventually(ui, () => hasCard(ui, 'card-updates'))
  await click(ui, 'card-update-skip')
  expect(store.get('updates-dismissed')).toBe(SIGNATURE)
  await ui.redraw()
  expect(await hasCard(ui, 'card-updates')).toBeUndefined()
  await ui.unmount()

  // The same release stays put off on a new draw.
  const again = await band()
  await eventually(again, () => again.find({ key: 'menu-entry-manager' }))
  await sleep(50)
  await again.redraw()
  expect(await hasCard(again, 'card-updates')).toBeUndefined()
  await again.unmount()
})

test('update-card: new version brings it back', async ($, on) => {
  const { band, files, store } = rig($, on, { store: [...WELCOMED, ['updates-dismissed', SIGNATURE]] })
  const ui = await band()
  await eventually(ui, () => ui.find({ key: 'menu-entry-manager' }))
  await sleep(50)
  await ui.redraw()
  expect(await hasCard(ui, 'card-updates')).toBeUndefined()

  // A new release lands in the marketplace; opening the pane reads the listing again.
  plugin(files, '/m/upmod', 'upmod', '2.1.0')
  await $.command.run({ command: 'mod-manager' } as never)
  const back = await eventually(ui, () => hasCard(ui, 'card-updates'))
  expect(back).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '1.9.9 → 2.1.0' })).toBeDefined()
  await click(ui, 'card-update-skip')
  expect(store.get('updates-dismissed')).toBe('twomod@2.0.0,upmod@2.1.0')
  await ui.unmount()
})

test('update-card: first-run wins', async ($, on) => {
  const { band } = rig($, on)
  const ui = await band()
  await eventually(ui, () => hasCard(ui, 'card-welcome'))
  // Updates exist, yet only the welcome draws.
  await sleep(50)
  await ui.redraw()
  expect(await hasCard(ui, 'card-welcome')).toBeDefined()
  expect(await hasCard(ui, 'card-updates')).toBeUndefined()
  await click(ui, 'card-welcome-skip')
  const next = await eventually(ui, () => hasCard(ui, 'card-updates'))
  expect(next).toBeDefined()
  expect(await hasCard(ui, 'card-welcome')).toBeUndefined()
  await ui.unmount()
})

test('cards: drawn when mod-menu hides pills', async ($, on) => {
  const { band } = rig($, on, { hidden: true })
  const ui = await band()
  expect(await eventually(ui, () => hasCard(ui, 'card-welcome'))).toBeDefined()
  expect(await ui.find({ key: 'menu-entry-manager' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'other mod' })).toBeDefined()
  await click(ui, 'card-welcome-skip')
  const updates = await eventually(ui, () => hasCard(ui, 'card-updates'))
  expect(updates).toBeDefined()
  expect(await ui.find({ key: 'menu-entry-manager' })).toBeUndefined()
  await ui.unmount()
})

test('cards: none during a survey', async ($, on) => {
  const { band } = rig($, on)
  const ui = await band({ hasSurvey: true })
  await sleep(100)
  await ui.redraw()
  expect(await hasCard(ui, 'card-welcome')).toBeUndefined()
  expect(await ui.find({ key: 'menu-entry-manager' })).toBeUndefined()
  await ui.unmount()
})

test('cards: none during a survey (updates)', async ($, on) => {
  const { band } = rig($, on, { store: WELCOMED })
  const ui = await band({ hasSurvey: true })
  await sleep(100)
  await ui.redraw()
  expect(await hasCard(ui, 'card-updates')).toBeUndefined()
  await ui.unmount()
})

test('cards: none off the terminal', async ($, on) => {
  const { band } = rig($, on)
  const ui = await band({}, 'desktop')
  await sleep(100)
  await ui.redraw()
  expect(await hasCard(ui, 'card-welcome')).toBeUndefined()
  expect(await hasCard(ui, 'card-updates')).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'other mod' })).toBeDefined()
  await ui.unmount()
})

test('cards: none while the store cannot be read', async ($, on) => {
  const { band } = rig($, on, { storeDown: true })
  const ui = await band()
  await sleep(100)
  await ui.redraw()
  expect(await hasCard(ui, 'card-welcome')).toBeUndefined()
  expect(await hasCard(ui, 'card-updates')).toBeUndefined()
  expect(await ui.find({ key: 'menu-entry-manager' })).toBeDefined()
  await ui.unmount()
})

const looks = async ($: any, on: any) => {
  const { band } = rig($, on)
  const ui = await band()
  await eventually(ui, () => hasCard(ui, 'card-welcome'))
  const welcome = await drawn(ui)
  await click(ui, 'card-welcome-skip')
  await eventually(ui, () => hasCard(ui, 'card-updates'))
  const updates = await drawn(ui)
  await ui.unmount()
  return { welcome, updates }
}

const isPrivate = (text: string) => [...text].some(char => (char.codePointAt(0) ?? 0) >= 0xe000 && (char.codePointAt(0) ?? 0) <= 0xf8ff)

test('cards: nerd and safe (nerd draws icons and caps)', { options: { icons: 'nerd' } }, async ($, on) => {
  const { welcome, updates } = await looks($, on)
  expect(welcome).toContain(PILL_CAP)
  expect(welcome).toContain(String.fromCodePoint(0xf135))
  expect(welcome).toContain(String.fromCodePoint(0xf0493))
  expect(updates).toContain(PILL_CAP)
  expect(updates).toContain(String.fromCodePoint(0xf0aa))
  expect(updates).toContain(String.fromCodePoint(0xf021))
  expect(updates).toContain('1.9.9 ' + String.fromCodePoint(0xf061) + ' ')
})

test('cards: nerd and safe (safe draws plain headings and common glyphs)', { options: { icons: 'safe' } }, async ($, on) => {
  const { welcome, updates } = await looks($, on)
  expect(isPrivate(welcome)).toBe(false)
  expect(isPrivate(updates)).toBe(false)
  expect(welcome).toContain('Claude Code mods are in')
  expect(updates).toContain('2 mods have updates')
  expect(updates).toContain('1.9.9 → ')
})

test('cards: buttons post tips', async ($, on) => {
  const { band } = rig($, on)
  const ui = await band()
  await eventually(ui, () => hasCard(ui, 'card-welcome'))
  // Open setup is a Button, so its tip lies hidden over the tip row and shows with its pill's hover group.
  const reveal = await ui.find({ key: 'card-open-tip' })
  expect(reveal?.props.display).toBe('none')
  // The kit hands back what every surface gets, and hover is terminal only, so the hover group itself is a live check.
  expect(reveal?.props.position).toBe('absolute')
  expect(JSON.stringify(reveal)).toContain('Open setup:')
  expect(JSON.stringify(reveal)).toContain(' opens the Mods pane to pick, turn on and update mods')
  // It rides in the tip row, so the next mod's splitRow keeps it as the tip.
  expect(JSON.stringify(await ui.find({ key: 'menu-tip' }))).toContain('"key":"card-open-tip"')
  await hover(ui, 'card-welcome-skip')
  expect(await ui.find({ type: 'Text', text: / hides this card, the gear still opens the pane$/ })).toBeDefined()
  await ui.pointer({ in: 'card-welcome-skip', type: 'leave', x: 0, y: 0 })
  await click(ui, 'card-welcome-skip')

  await eventually(ui, () => hasCard(ui, 'card-updates'))
  await hover(ui, 'card-update-run')
  expect(await ui.find({ type: 'Text', text: 'Update 2:' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: / installs the new versions, then reloads plugins$/ })).toBeDefined()
  await ui.pointer({ in: 'card-update-run', type: 'leave', x: 0, y: 0 })
  await hover(ui, 'card-update-skip')
  expect(await ui.find({ type: 'Text', text: / hides this card until another version comes out$/ })).toBeDefined()
  await ui.unmount()
})

test('cards: update click while Claude works is a toast, and runs nothing', async ($, on) => {
  const { band, events } = rig($, on, { store: WELCOMED })
  const ui = await band({ isWorking: true })
  await eventually(ui, () => hasCard(ui, 'card-updates'))
  await click(ui, 'card-update-run')
  expect(await eventually(ui, () => ui.find({ type: 'Text', text: /Claude is working, Update is available once it is idle/ }))).toBeDefined()
  expect(events).toEqual([])
  await ui.unmount()
})

test('cards: a short band keeps the buttons and counts the rows it cuts', async ($, on) => {
  const { band } = rig($, on, { store: WELCOMED })
  const ui = await band({ maxRows: 6 })
  await eventually(ui, () => hasCard(ui, 'card-updates'))
  expect(await ui.find({ type: 'Text', text: '+1 more' })).toBeDefined()
  expect(await ui.find({ key: 'card-update-run' })).toBeDefined()
  expect(await ui.find({ key: 'card-update-skip' })).toBeDefined()
  await ui.unmount()
})

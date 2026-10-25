// mod-manager / tests/pane.test.tsx, by v-amorim: the setup sections, the Apply card and its run
import { expect, test } from 'claude-code/testing'

import { cardFill } from '../hooks/look'
import { mix, THEME } from '../hooks/theme'

const neutral = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const hooks = JSON.stringify({ modules: ['./register.tsx'] })
const WT_SETTINGS = '/l/Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json'
const LONG = 'a-very-long-mod-name-that-would-never-fit-in-one-pane-row'

const plugin = (files: Record<string, string>, root: string, name: string, version: string, extra: object = {}) => {
  files[`${root}/.claude-plugin/plugin.json`] = JSON.stringify({ name, description: `${name} does a thing`, version, ...extra })
  files[`${root}/hooks/hooks.json`] = hooks
  files[`${root}/hooks/register.tsx`] = ''
}

// The marketplace lists five mods at 2.0.0; mod-manager came from it. upmod lags behind and foldermod loads from a folder.
const diskOf = (catalog: string[]) => {
  const files: Record<string, string> = {
    '/h/.claude/settings.json': JSON.stringify({ enabledPlugins: { 'onmod@claude-mods': true, 'offmod@claude-mods': false, 'upmod@claude-mods': true }, env: { CLAUDE_CODE_PLUGIN_DIRS: '~/.claude/other/foldermod' } }, null, 2) + '\n',
    '/h/.claude/plugins/installed_plugins.json': JSON.stringify({
      plugins: {
        'mod-manager@claude-mods': [{ scope: 'user', installPath: '/cache/mm' }],
        'onmod@claude-mods': [{ scope: 'user', installPath: '/cache/onmod' }],
        'offmod@claude-mods': [{ scope: 'user', installPath: '/cache/offmod' }],
        'upmod@claude-mods': [{ scope: 'user', installPath: '/cache/upmod' }],
      },
    }),
    '/h/.claude/plugins/known_marketplaces.json': JSON.stringify({ 'claude-mods': { source: { source: 'github', repo: 'x/y' }, installLocation: '/m' } }),
    '/m/.claude-plugin/marketplace.json': JSON.stringify({ plugins: catalog.map(name => ({ name, description: `${name} listed`, source: `./${name}` })) }),
  }
  for (const name of catalog) plugin(files, `/m/${name}`, name, '2.0.0', name === 'newicons' || name === LONG ? { userConfig: { icons: { type: 'string' } } } : {})
  plugin(files, '/cache/mm', 'mod-manager', '2.0.0')
  plugin(files, '/cache/onmod', 'onmod', '2.0.0')
  plugin(files, '/cache/offmod', 'offmod', '2.0.0')
  plugin(files, '/cache/upmod', 'upmod', '1.9.9')
  plugin(files, '/h/.claude/other/foldermod', 'foldermod', '0.0.1')
  return files
}

const CATALOG = ['onmod', 'offmod', 'newmod', 'newicons', 'upmod', 'foldermod']

type Rig = { ui: any; files: Record<string, string>; events: string[]; versions: { count: number }; stop: () => Promise<void> }

type RigOptions = { catalog?: string[]; env?: Record<string, string>; columns?: number; version?: { exitCode: number; stdout: string }; failing?: string; extra?: Record<string, string> }

// Mounts the pane over a fake disk; every write, CLI call and command the mod makes lands in `events`, in order.
const mount = async ($: any, on: any, { catalog = CATALOG, env = {}, columns = 80, version = { exitCode: 0, stdout: '2.1.291 (Claude Code)\n' }, failing, extra = {} }: RigOptions = {}): Promise<Rig> => {
  const files = { ...diskOf(catalog), ...extra }
  const events: string[] = []
  const versions = { count: 0 }
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
    const line = e.argv.join(' ')
    if (e.argv[1] === '--version') {
      versions.count++
      return { value: { ...version, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    events.push(line)
    const exitCode = failing && line.includes(failing) ? 1 : 0
    return { value: { exitCode, stdout: '', stderr: exitCode ? 'boom' : '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('settings.read', () => ({ value: { enabledPlugins: JSON.parse(files['/h/.claude/settings.json']!).enabledPlugins } }) as never)
  on('command.run', (_$: unknown, e: { command: string }) => {
    events.push(`command ${e.command}`)
    return { text: '' }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('config.list', () => ({ value: [] }))
  on('turn.start', (_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('ui.render', ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })
  await $.command.run({ command: 'mod-manager' } as never)
  const ui = (await $.ui.mount({ plugin: 'mod-manager', surface: 'terminal', component: 'Pane', requestId: 'manager', props: { title: 'Mods', isFocused: false, bodyColumns: columns, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} } } as never)) as any
  return { ui, files, events, versions, stop: () => ui.unmount() }
}

// The version and the font are read beside the first draw, so a check waits for them to land.
const eventually = async <T,>(ui: any, look: () => Promise<T>) => {
  for (let tries = 0; tries < 100; tries++) {
    await ui.redraw()
    const found = await look()
    if (found) return found
    await sleep(20)
  }
  return look()
}

const click = (ui: any, key: string, y = 0) => ui.pointer({ in: key, type: 'down', button: 'left', x: 1, y })

const hover = (ui: any, key: string, y = 0) => ui.pointer({ in: key, type: 'move', x: 12, y })

const drawn = async (ui: any, key?: string) => JSON.stringify(await ui.drawn(key ? { in: key } : undefined))

const indexOfRow = async (ui: any, name: string) => {
  const rows = ((await ui.find({ type: 'Client', key: 'list-installed' }))?.props.props.rows ?? []) as { index: number; name: string }[]
  return rows.find(row => row.name === name)!.index
}

const settled = async (events: string[], last: string) => {
  for (let waited = 0; waited < 4000 && !events.includes(last); waited += 20) await sleep(20)
}

test('pane: not installed section lists only mods with no copy, and a tick plans its install', async ($, on) => {
  const { ui, events, stop } = await mount($, on)
  expect(await ui.find({ type: 'Text', text: /^Not installed$/ })).toBeDefined()
  const list = await drawn(ui, 'list-install')
  expect(list).toContain('Newmod')
  expect(list).toContain('Newicons')
  expect(list).toContain('newmod listed')
  // Installed, switched off and folder copies never offer an install.
  for (const name of ['Onmod', 'Offmod', 'Upmod', 'Foldermod']) expect(list).not.toContain(name)
  expect(list).toContain('"○"')
  expect(list).toContain('" Add"')
  // The one update is ticked from the start, so it is the only pending line.
  expect(await drawn(ui, 'manager-apply')).toContain(' Apply 1 ')

  await click(ui, 'list-install', 0)
  expect(await drawn(ui, 'list-install')).toContain('"●"')
  expect(await ui.find({ type: 'Text', text: 'Install Newmod 2.0.0' })).toBeDefined()
  expect(await drawn(ui, 'manager-apply')).toContain(' Apply 2 ')
  await click(ui, 'list-install', 0)
  expect(await drawn(ui, 'manager-apply')).toContain(' Apply 1 ')
  expect(events).toEqual([])
  await stop()
})

test('pane: only an update shows beside the version, in accent; the switch alone says on or off', async ($, on) => {
  const { ui, stop } = await mount($, on)
  const installed = await drawn(ui, 'list-installed')
  expect(installed).toMatch(new RegExp(`"color":"${THEME.accent}"[^]*?"update 2.0.0"`))
  expect(installed).not.toContain('"off"')
  expect(installed).not.toContain('"on"')
  expect(await drawn(ui, 'list-dir')).not.toContain('"on"')
  await stop()
})

test('pane: nerd font line shows without a Nerd Font and links to the downloads, and goes with one', async ($, on) => {
  const missing = await mount($, on)
  const line = await eventually(missing.ui, () => missing.ui.find({ type: 'Text', text: /No Nerd Font found · / }))
  expect(JSON.stringify(line)).toContain('No Nerd Font found')
  const link = await missing.ui.find({ type: 'Link' })
  expect(link?.props.href).toBe('https://www.nerdfonts.com/font-downloads')
  expect(link?.props.label).toBe('Get one')
  await missing.stop()
})

test('pane: nerd font line is gone once the terminal font is a Nerd Font', async ($, on) => {
  const found = await mount($, on, { env: { WT_SESSION: 'x', LOCALAPPDATA: '/l' }, extra: { [WT_SETTINGS]: '{ "profiles": { "defaults": { "font": { "face": "FiraCode Nerd Font" } } } }' } })
  expect(await eventually(found.ui, () => found.ui.find({ type: 'Text', text: /^Nerd Font found$/ }))).toBeDefined()
  expect(await found.ui.find({ type: 'Text', text: /No Nerd Font found · / })).toBeUndefined()
  await found.stop()
})

test('pane: updates card lists each lagging mod ticked, with the auto-update line and the /plugin hint', async ($, on) => {
  const { ui, stop } = await mount($, on)
  expect(await ui.find({ type: 'Text', text: /^Updates$/ })).toBeDefined()
  const list = await drawn(ui, 'list-update')
  expect(list).toContain('Upmod')
  expect(list).toContain('1.9.9 → 2.0.0')
  expect(list).toContain('"●"')
  expect(list).toContain('" Update"')
  expect(await ui.find({ type: 'Text', text: 'Auto-update is off by default for this marketplace' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Marketplaces tab, then claude-mods' })).toBeDefined()
  // Ticked by default, so the update is already a pending line.
  expect(await ui.find({ type: 'Text', text: 'Update Upmod 1.9.9 → 2.0.0' })).toBeDefined()
  await click(ui, 'list-update', 0)
  expect(await drawn(ui, 'list-update')).toContain('"○"')
  expect(await ui.find({ key: 'sec-apply' })).toBeUndefined()
  await stop()
})

test('pane: updates card says every mod is up to date when none lags', async ($, on) => {
  const { ui, stop } = await mount($, on, { extra: { '/cache/upmod/.claude-plugin/plugin.json': JSON.stringify({ name: 'upmod', description: 'upmod does a thing', version: '2.0.0' }) } })
  expect(await ui.find({ type: 'Text', text: 'Every mod from the marketplace is up to date' })).toBeDefined()
  expect(await ui.find({ type: 'Client', key: 'list-update' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Auto-update is off by default for this marketplace' })).toBeDefined()
  await stop()
})

test('pane: open /plugin runs the command on a press, and holds while Claude works', async ($, on) => {
  const { ui, events, stop } = await mount($, on)
  expect(await ui.find({ type: 'Button', key: 'open-plugin' })).toBeDefined()
  await ui.press({ key: 'open-plugin' })
  await settled(events, 'command plugin')
  expect(events).toContain('command plugin')
  // Its tip rides in the pane footer, revealed by the pill's hover group.
  expect(await ui.find({ type: 'Text', text: / · opens \/plugin to set auto-update$/ })).toBeDefined()

  await $.turn.start({ turnId: 't1' } as never)
  await ui.redraw()
  expect(await ui.find({ type: 'Button', key: 'open-plugin' })).toBeUndefined()
  // The instruction stays whole on its row; the busy note gets a line of its own under it.
  expect((await ui.find({ key: 'updates-auto-row' }))?.props.flexDirection).toBe('row')
  expect(await ui.find({ type: 'Text', text: 'Marketplaces tab, then claude-mods' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Claude is working, Open /plugin is available once it is idle' })).toBeDefined()
  await stop()
})

test('apply: plan lines in order, toggles then installs then updates, and the run follows them', async ($, on) => {
  const { ui, events, stop } = await mount($, on)
  await ui.post({ type: 'toggle', index: await indexOfRow(ui, 'Offmod') }, { in: 'list-installed' })
  await click(ui, 'list-install', 0)
  await click(ui, 'list-install', 1)
  const pane = await drawn(ui)
  const at = (line: string) => pane.indexOf(line)
  expect(at('Turn on Offmod')).toBeGreaterThan(-1)
  expect(at('Turn on Offmod')).toBeLessThan(at('Install Newmod 2.0.0'))
  expect(at('Install Newmod 2.0.0')).toBeLessThan(at('Install Newicons 2.0.0'))
  expect(at('Install Newicons 2.0.0')).toBeLessThan(at('Update Upmod 1.9.9 → 2.0.0'))
  expect(await drawn(ui, 'manager-apply')).toContain(' Apply 4 ')

  await click(ui, 'manager-apply')
  await settled(events, 'command reload-plugins')
  // The settings.json toggle is written first, then each CLI step in the plan's order, then the reload.
  expect(events).toEqual(['write settings', 'claude plugin install newmod@claude-mods --scope user', 'claude plugin install newicons@claude-mods --scope user', 'claude plugin update upmod@claude-mods', 'command reload-plugins'])
  await stop()
})

test('apply: icons config only where declared', { options: { icons: 'nerd' } }, async ($, on) => {
  const { ui, events, stop } = await mount($, on)
  await click(ui, 'list-install', 0)
  await click(ui, 'list-install', 1)
  expect(await ui.find({ type: 'Text', text: 'Install Newicons 2.0.0 with icons nerd' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Install Newmod 2.0.0' })).toBeDefined()
  await click(ui, 'manager-apply')
  await settled(events, 'command reload-plugins')
  expect(events).toContain('claude plugin install newicons@claude-mods --scope user --config icons=nerd')
  expect(events).toContain('claude plugin install newmod@claude-mods --scope user')
  await stop()
})

test('apply: an auto icons setting adds no config to any install', async ($, on) => {
  const { ui, events, stop } = await mount($, on)
  await click(ui, 'list-install', 1)
  await click(ui, 'manager-apply')
  await settled(events, 'command reload-plugins')
  expect(events).toContain('claude plugin install newicons@claude-mods --scope user')
  expect(events.some(line => line.includes('--config'))).toBe(false)
  await stop()
})

test('apply: a folder copy never gets an install or an update line', async ($, on) => {
  const { ui, stop } = await mount($, on)
  const pane = await drawn(ui)
  expect(pane).not.toContain('Install Foldermod')
  expect(pane).not.toContain('Update Foldermod')
  await stop()
})

test('apply: checked list shows the version, the marketplace and the font, a miss in warn', async ($, on) => {
  const { ui, versions, stop } = await mount($, on)
  await click(ui, 'list-install', 0)
  expect(await eventually(ui, () => ui.find({ type: 'Text', text: 'Claude Code 2.1.291' }))).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Marketplace claude-mods' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Checked' })).toBeDefined()
  // The font is not a Nerd Font here: a warn-colored miss, not an error.
  const miss = await eventually(ui, () => ui.find({ type: 'Text', text: 'No Nerd Font found, icons stay plain' }))
  expect(miss).toBeDefined()
  const warn = await ui.find({ type: 'Text', text: ' warn ' })
  expect(warn?.props.color).toBe(THEME.warn)
  expect(warn?.props.backgroundColor).toBe(mix(THEME.warn, cardFill(), 0.85))
  expect((await ui.find({ type: 'Text', text: ' ok ' }))?.props.color).toBe(THEME.ok)
  expect(await ui.find({ key: 'sec-about' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^About to$/ })).toBeDefined()
  // Read once per pane open, however often the pane redraws.
  await ui.redraw()
  await ui.redraw()
  expect(versions.count).toBe(1)
  await stop()
})

test('apply: checked list says when the version could not be read', async ($, on) => {
  const { ui, stop } = await mount($, on, { version: { exitCode: 1, stdout: '' } })
  await click(ui, 'list-install', 0)
  expect(await eventually(ui, () => ui.find({ type: 'Text', text: 'Claude Code version not read' }))).toBeDefined()
  await stop()
})

test('apply: lines never cut, a long line wraps whole at a narrow width', { options: { icons: 'nerd' } }, async ($, on) => {
  const { ui, stop } = await mount($, on, { catalog: [...CATALOG, LONG], columns: 40 })
  const rows = ((await ui.find({ type: 'Client', key: 'list-install' }))?.props.props.rows ?? []) as { key: string; name: string }[]
  await click(ui, 'list-install', rows.findIndex(row => row.key === `cat:${LONG}`))
  const line = await ui.find({ type: 'Text', text: /^Install A Very Long Mod Name That Would Never Fit In One Pane Row 2\.0\.0 with icons nerd$/ })
  expect(line).toBeDefined()
  expect(line?.props.wrap).toBe('wrap')
  expect(JSON.stringify(await ui.find({ key: 'apply-lines' }))).not.toContain('…')
  expect(JSON.stringify(await ui.find({ key: 'apply-lines' }))).not.toContain('truncate')
  await stop()
})

test('apply: a failed install is a toast and the rest still run', async ($, on) => {
  const { ui, events, stop } = await mount($, on, { failing: 'install newmod' })
  const band = await $.ui.mount({ plugin: 'mod-manager', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 80, scroll: { offset: 0, bodyRows: 12 }, view: {} } } as never)
  await click(ui, 'list-install', 0)
  await click(ui, 'list-install', 1)
  await click(ui, 'manager-apply')
  await settled(events, 'command reload-plugins')
  expect(events).toContain('claude plugin install newicons@claude-mods --scope user')
  expect(events).toContain('claude plugin update upmod@claude-mods')
  // The toast splits at its first ": ": a bold title and a muted detail.
  expect(await eventually(band, () => band.find({ type: 'Text', text: 'Install of Newmod failed' }))).toBeDefined()
  expect(await band.find({ type: 'Text', text: 'boom' })).toBeDefined()
  await band.unmount()
  await stop()
})

test('apply: held while Claude works, and a tick or toggle is ignored while it runs', async ($, on) => {
  const { ui, events, stop } = await mount($, on)
  await click(ui, 'list-install', 0)
  await $.turn.start({ turnId: 't1' } as never)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /^Apply 2 · Claude is working, available once it is idle$/ })).toBeDefined()
  expect(await ui.find({ type: 'Client', key: 'manager-apply' })).toBeUndefined()
  expect(events).toEqual([])
  await stop()
})

test('pane: setup sections in nerd and safe, nerd draws icons and caps', { options: { icons: 'nerd' } }, async ($, on) => {
  const { ui, stop } = await mount($, on)
  await click(ui, 'list-install', 0)
  const pane = await drawn(ui)
  for (const code of [0xf019, 0xf031, 0xf0aa, 0xf00c]) expect(pane).toContain(String.fromCodePoint(code))
  expect(pane).toContain(String.fromCodePoint(0xe0b6))
  expect(await drawn(ui, 'list-update')).toContain(String.fromCodePoint(0xf061))
  expect(await ui.find({ key: 'sec-install' })).toBeDefined()
  expect(await ui.find({ key: 'sec-updates' })).toBeDefined()
  expect(await ui.find({ key: 'sec-apply' })).toBeDefined()
  await stop()
})

test('pane: setup sections in nerd and safe, safe draws plain headings and common glyphs', { options: { icons: 'safe' } }, async ($, on) => {
  const { ui, stop } = await mount($, on)
  await click(ui, 'list-install', 0)
  const pane = await drawn(ui)
  for (const title of ['Not installed', 'Updates', 'About to', 'Checked']) expect(await ui.find({ type: 'Text', text: new RegExp(`^${title}$`) })).toBeDefined()
  expect(await drawn(ui, 'list-update')).toContain('1.9.9 → 2.0.0')
  // No private-use code point and no pill cap anywhere: safe mode draws on any font.
  expect([...pane].some(char => (char.codePointAt(0) ?? 0) >= 0xe000 && (char.codePointAt(0) ?? 0) <= 0xf8ff)).toBe(false)
  expect(pane).not.toContain(String.fromCodePoint(0xf0aa))
  await stop()
})

test('pane: new controls post tips in the footer, and clear them on leave', async ($, on) => {
  const { ui, stop } = await mount($, on)
  await hover(ui, 'list-install', 0)
  expect(await ui.find({ type: 'Text', text: ' Newmod' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: / · ticks this mod to install it$/ })).toBeDefined()
  await ui.pointer({ in: 'list-install', type: 'leave', x: 0, y: 0 })
  expect(await ui.find({ type: 'Text', text: / · ticks this mod to install it$/ })).toBeUndefined()

  await hover(ui, 'list-update', 0)
  expect(await ui.find({ type: 'Text', text: ' Upmod' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: / · ticks or unticks this update$/ })).toBeDefined()
  await ui.pointer({ in: 'list-update', type: 'leave', x: 0, y: 0 })

  await ui.pointer({ in: 'manager-apply', type: 'move', x: 1, y: 0 })
  expect(await ui.find({ type: 'Text', text: / · runs every line above, then reloads$/ })).toBeDefined()
  await ui.pointer({ in: 'manager-apply', type: 'leave', x: 0, y: 0 })
  expect(await ui.find({ type: 'Text', text: / · runs every line above, then reloads$/ })).toBeUndefined()
  await stop()
})

test('apply: its tip goes with the card, and the note says the reload is done', async ($, on) => {
  const { ui, events, stop } = await mount($, on)
  // A click lands with the pointer still on the pill, so no leave ever clears the tip it posted.
  await ui.pointer({ in: 'manager-apply', type: 'move', x: 1, y: 0 })
  expect(await ui.find({ type: 'Text', text: / · runs every line above, then reloads$/ })).toBeDefined()
  await click(ui, 'manager-apply')
  await settled(events, 'command reload-plugins')
  expect(await eventually(ui, () => ui.find({ type: 'Text', text: /Applied 1, plugins reloaded/ }))).toBeDefined()
  expect(await ui.find({ type: 'Text', text: / · runs every line above, then reloads$/ })).toBeUndefined()
  await stop()
})

test('pane: a narrow pane cuts the detail of a tick row, never its pill', { options: { icons: 'nerd' } }, async ($, on) => {
  const { ui, stop } = await mount($, on, { columns: 36 })
  await click(ui, 'list-install', 0)
  // The kit draws no layout, so the check is the rule itself: only the detail may shrink.
  type Node = { type: string; props?: Record<string, unknown>; children?: Node[] }
  const rows = ((await ui.drawn({ in: 'list-install' })) as Node).children!
  for (const row of rows) {
    const squeezable = row.children!.filter(part => !String(part.props?.key ?? '').endsWith('-detail') && (part.type !== 'Box' || part.props?.flexShrink !== 0))
    expect(squeezable).toEqual([])
  }
  await stop()
})

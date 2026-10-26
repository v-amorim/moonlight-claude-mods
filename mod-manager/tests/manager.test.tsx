// mod-manager / tests/manager.test.tsx, by v-amorim
// Tests mod discovery, feature listing and enabling or disabling mods in settings.
import { expect, mock, test } from 'claude-code/testing'

import { discover, featuresOf, setEnabled, type Io } from '../hooks/registry'
import { cardFill } from '../hooks/look'
import { MARK, THEME } from '../hooks/theme'

const SETTINGS = {
  $schema: 'https://example.test/schema.json',
  env: { KEEP: '1', CLAUDE_CODE_PLUGIN_DIRS: '~/.claude/mods/alpha' },
  enabledPlugins: { 'inst@m': true, 'other@m': false },
  model: 'x',
}

// The host's Mounted type lacks pointer and post.
const withPointer = <T,>(m: T) => m as T & { pointer(e: object): Promise<unknown>; post(message: object, target: object): Promise<unknown> }

// The kit's types declare no timer globals, yet the runtime has them.
declare const setTimeout: (handler: (value: unknown) => void, ms: number) => unknown

const manifest = (name: string) => JSON.stringify({ name, description: `${name} does a thing`, version: '1.0.0' })
const hooks = JSON.stringify({ modules: ['./register.tsx'] })
const source = "on('tool.call', async () => {})\non('ui.render', { component: 'AbovePrompt' }, async () => {})\n$.ui.status('x')\n$.command.register({ name: 'mod-beta', description: 'b' })"

const disk = (overrides: Record<string, string> = {}) => {
  const files: Record<string, string> = {
    '/h/.claude/settings.json': JSON.stringify(SETTINGS, null, 2) + '\n',
    '/h/.claude/plugins/installed_plugins.json': JSON.stringify({
      plugins: {
        'inst@m': [{ scope: 'user', installPath: '\\cache\\inst' }],
        'plain@m': [{ scope: 'user', installPath: '\\cache\\plain' }],
      },
    }),
    '/h/.claude/mods/alpha/.claude-plugin/plugin.json': manifest('alpha'),
    '/h/.claude/mods/alpha/hooks/hooks.json': hooks,
    '/h/.claude/mods/alpha/hooks/register.tsx': source,
    '/h/.claude/mods/alpha/showcase.json': JSON.stringify({
      tagline: 'Alpha tagline',
      features: [{ title: 'Count', detail: 'Counts things.' }],
    }),
    '/h/.claude/mods/beta/.claude-plugin/plugin.json': manifest('beta'),
    '/h/.claude/mods/beta/hooks/hooks.json': hooks,
    '/h/.claude/mods/beta/hooks/register.tsx': source,
    '/cache/inst/.claude-plugin/plugin.json': manifest('inst'),
    '/cache/inst/hooks/hooks.json': hooks,
    '/cache/inst/hooks/register.tsx': source,
    '/cache/plain/.claude-plugin/plugin.json': manifest('plain'),
    ...overrides,
  }
  const io: Io = {
    read: async path => {
      if (!(path in files)) throw new Error(`ENOENT ${path}`)
      return files[path]!
    },
    write: async (path, text) => void (files[path] = text),
    list: async path => {
      if (path !== '/h/.claude/mods') throw new Error('ENOENT')
      return [
        { name: 'alpha', kind: 'dir' },
        { name: 'beta', kind: 'dir' },
        { name: 'notes.md', kind: 'file' },
      ]
    },
    home: async () => '/h',
    config: async () => '/h/.claude',
  }
  return { io, files }
}

const byName = async (io: Io, name: string) => (await discover(io)).find(mod => mod.name === name)!

test('discovery finds dir and installed mods with their facts', async () => {
  const { io } = disk()
  const found = await discover(io)

  expect(found.map(mod => mod.name)).toEqual(['alpha', 'beta', 'inst'])
  const alpha = found[0]!
  expect(alpha).toMatchObject({ description: 'alpha does a thing', version: '1.0.0', source: 'dir', enabled: true })
  expect(found[1]!.enabled).toBe(false)
  expect(found[2]).toMatchObject({ source: 'installed', enabled: true, id: 'inst@m' })
})

test('a mod folder installed from the local marketplace shows once, as the installed entry, among your own', async () => {
  const { io } = disk({
    'C:/H/.claude/settings.json': JSON.stringify(SETTINGS),
    'C:/H/.claude/plugins/installed_plugins.json': JSON.stringify({
      plugins: {
        // The real record: a cache path, though the plugin loads in place from the marketplace folder.
        'beta@claude-mods': [{ scope: 'user', installPath: 'C:\\H\\.claude\\plugins\\cache\\claude-mods\\beta\\0.1.0' }],
        'inst@m': [{ scope: 'user', installPath: '\\cache\\inst' }],
      },
    }),
    'C:/H/.claude/plugins/known_marketplaces.json': JSON.stringify({ 'claude-mods': { source: { source: 'directory', path: 'C:\\H\\.claude\\mods' } } }),
    'C:/H/.claude/mods/beta/.claude-plugin/plugin.json': manifest('beta'),
    'C:/H/.claude/mods/beta/hooks/hooks.json': hooks,
    'C:/H/.claude/mods/beta/hooks/register.tsx': source,
  })
  io.home = async () => 'C:/H'
  io.config = async () => 'C:/H/.claude'
  io.list = async path => {
    if (path !== 'C:/H/.claude/mods') throw new Error('ENOENT')
    return [{ name: 'beta', kind: 'dir' }]
  }
  const found = (await discover(io)).filter(mod => mod.name === 'beta')
  expect(found.length).toBe(1)
  expect(found[0]).toMatchObject({ source: 'installed', id: 'beta@claude-mods', isOwn: true })
})

test('a listed mod folder also installed, switched off, from the local marketplace shows once, as the folder that loads', async () => {
  const { io } = disk({
    'C:/H/.claude/settings.json': JSON.stringify({ ...SETTINGS, env: { CLAUDE_CODE_PLUGIN_DIRS: '~/.claude/mods/beta' }, enabledPlugins: { 'beta@claude-mods': false } }),
    'C:/H/.claude/plugins/installed_plugins.json': JSON.stringify({
      plugins: { 'beta@claude-mods': [{ scope: 'user', installPath: 'C:\\H\\.claude\\plugins\\cache\\claude-mods\\beta\\0.1.0' }] },
    }),
    'C:/H/.claude/plugins/known_marketplaces.json': JSON.stringify({ 'claude-mods': { source: { source: 'directory', path: 'C:\\H\\.claude\\mods' } } }),
    'C:/H/.claude/mods/beta/.claude-plugin/plugin.json': manifest('beta'),
    'C:/H/.claude/mods/beta/hooks/hooks.json': hooks,
    'C:/H/.claude/mods/beta/hooks/register.tsx': source,
  })
  io.home = async () => 'C:/H'
  io.config = async () => 'C:/H/.claude'
  io.list = async path => {
    if (path !== 'C:/H/.claude/mods') throw new Error('ENOENT')
    return [{ name: 'beta', kind: 'dir' }]
  }
  const found = (await discover(io)).filter(mod => mod.name === 'beta')
  expect(found.length).toBe(1)
  expect(found[0]).toMatchObject({ source: 'dir', enabled: true, isOwn: true })
})

test('skips plugins without a hooks module', async () => {
  const { io } = disk()

  expect((await discover(io)).some(mod => mod.name === 'plain')).toBe(false)
})

test('toggle installed edits only enabledPlugins and backs up first', async () => {
  const { io, files } = disk()
  const original = files['/h/.claude/settings.json']!

  expect(await setEnabled(io, await byName(io, 'inst'), false)).toEqual({ ok: true })

  const after = JSON.parse(files['/h/.claude/settings.json']!)
  expect(after.enabledPlugins).toEqual({ 'inst@m': false, 'other@m': false })
  expect(after.env).toEqual(SETTINGS.env)
  expect(after.model).toBe('x')
  expect(files['/h/.claude/settings.json.mod-manager.bak']).toBe(original)
  expect((await byName(io, 'inst')).enabled).toBe(false)
})

test('toggle dir flips <name>@inline and lists a new folder only once', async () => {
  const { io, files } = disk()
  const settings = () => JSON.parse(files['/h/.claude/settings.json']!)

  // A listed mod toggles in place, so /reload-plugins applies it.
  expect(await setEnabled(io, await byName(io, 'alpha'), false)).toEqual({ ok: true, needsRestart: false })
  expect(settings().enabledPlugins['alpha@inline']).toBe(false)
  expect(settings().env).toEqual(SETTINGS.env)
  expect((await byName(io, 'alpha')).enabled).toBe(false)

  expect(await setEnabled(io, await byName(io, 'alpha'), true)).toEqual({ ok: true, needsRestart: false })
  expect((await byName(io, 'alpha')).enabled).toBe(true)

  // A folder not yet listed joins the list, which only a restart reads.
  expect(await setEnabled(io, await byName(io, 'beta'), true)).toEqual({ ok: true, needsRestart: true })
  expect(settings().env.CLAUDE_CODE_PLUGIN_DIRS).toBe('~/.claude/mods/alpha:~/.claude/mods/beta')
  expect(settings().enabledPlugins['beta@inline']).toBe(true)
  expect(settings().env.KEEP).toBe('1')
})

test('safety: refuses itself, invalid JSON and leaves the file alone', async () => {
  const { io, files } = disk()
  const self = { ...(await byName(io, 'alpha')), name: 'mod-manager' }
  expect(await setEnabled(io, self, false)).toMatchObject({ ok: false })

  const broken = disk({ '/h/.claude/settings.json': '{ not json' })
  const outcome = await setEnabled(broken.io, await byName(io, 'alpha'), false)
  expect(outcome).toMatchObject({ ok: false })
  expect(broken.files['/h/.claude/settings.json']).toBe('{ not json')
  expect(Object.keys(broken.files).some(path => path.endsWith('.bak'))).toBe(false)
  expect(Object.keys(files).some(path => path.endsWith('.bak'))).toBe(false)
})

test('a second toggle keeps the first backup', async () => {
  const { io, files } = disk()
  const original = files['/h/.claude/settings.json']!
  await setEnabled(io, await byName(io, 'inst'), false)
  await setEnabled(io, await byName(io, 'inst'), true)
  expect(files['/h/.claude/settings.json.mod-manager.bak']).toBe(original)
})

test('an install record that is not a list is skipped instead of throwing', async () => {
  const { io } = disk({ '/h/.claude/plugins/installed_plugins.json': JSON.stringify({ plugins: { 'bad@m': { scope: 'user' }, 'inst@m': [{ scope: 'user', installPath: '\\cache\\inst' }] } }) })
  expect((await discover(io)).map(mod => mod.name)).toEqual(['alpha', 'beta', 'inst'])
})

test('plugin dirs from the process environment join the ones in settings', async () => {
  const { io } = disk()
  io.pluginDirs = async () => '~/.claude/mods/beta'
  const found = await discover(io)
  expect(found.find(mod => mod.name === 'beta')).toMatchObject({ source: 'dir', enabled: true })
  expect(found.find(mod => mod.name === 'alpha')).toMatchObject({ enabled: true })
})

test('with a config dir set, discovery and toggles stay inside it and leave ~/.claude alone', async () => {
  const { io, files } = disk({
    '/cfg/settings.json': JSON.stringify({ enabledPlugins: {} }, null, 2) + '\n',
    '/cfg/plugins/installed_plugins.json': JSON.stringify({ plugins: { 'cfginst@m': [{ scope: 'user', installPath: '/cache/inst' }] } }),
    '/cfg/mods/gamma/.claude-plugin/plugin.json': manifest('gamma'),
    '/cfg/mods/gamma/hooks/hooks.json': hooks,
    '/cfg/mods/gamma/hooks/register.tsx': source,
  })
  io.config = async () => '/cfg'
  io.list = async path => {
    if (path !== '/cfg/mods') throw new Error('ENOENT')
    return [{ name: 'gamma', kind: 'dir' }]
  }
  const homeSettings = files['/h/.claude/settings.json']!

  const found = await discover(io)
  expect(found.map(mod => mod.name)).toEqual(['gamma', 'inst'])
  expect(found[0]).toMatchObject({ source: 'dir', isOwn: true, root: '/cfg/mods/gamma' })

  expect(await setEnabled(io, found[0]!, true)).toEqual({ ok: true, needsRestart: true })
  expect(JSON.parse(files['/cfg/settings.json']!).env.CLAUDE_CODE_PLUGIN_DIRS).toBe('/cfg/mods/gamma')
  expect(files['/cfg/settings.json.mod-manager.bak']).toBeDefined()
  expect(files['/h/.claude/settings.json']).toBe(homeSettings)
  expect(files['/h/.claude/settings.json.mod-manager.bak']).toBeUndefined()
})

test('the pane reads and writes under CLAUDE_CONFIG_DIR when it is set, else under ~/.claude', async ($, on) => {
  const { files } = disk({
    '/cfg/settings.json': JSON.stringify({ env: { CLAUDE_CODE_PLUGIN_DIRS: '/cfg/mods/gamma' }, enabledPlugins: {} }, null, 2) + '\n',
    '/cfg/mods/gamma/.claude-plugin/plugin.json': manifest('gamma'),
    '/cfg/mods/gamma/hooks/hooks.json': hooks,
    '/cfg/mods/gamma/hooks/register.tsx': source,
  })
  const homeSettings = files['/h/.claude/settings.json']!
  on('fs.read', (_$, e) => {
    const path = neutral(e.path)
    if (!(path in files)) throw new Error('ENOENT')
    return { value: files[path]! }
  })
  on('fs.write', (_$, e) => {
    files[neutral(e.path)] = e.text
    return { value: undefined }
  })
  on('fs.list', (_$, e) => {
    if (neutral(e.path) !== '/cfg/mods') throw new Error('ENOENT')
    return { value: [{ name: 'gamma', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] }
  })
  on('env.get', (_$, e) => ({ value: e.name === 'USERPROFILE' ? '/h' : e.name === 'CLAUDE_CONFIG_DIR' ? '/cfg' : undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('config.list', () => ({ value: [] }))
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })
  await $.command.run({ command: 'mod-manager' } as never)
  const ui = withPointer(await $.ui.mount({
    plugin: 'mod-manager',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'manager',
    props: { title: 'Mods', isFocused: true, bodyColumns: 80, placement: 'above', scroll: { offset: 0, bodyRows: 20 }, view: {} },
  } as never))

  expect(await ui.find({ type: 'Text', text: /^Yours$/ })).toBeDefined()
  await ui.pointer({ in: 'list-dir', type: 'down', button: 'left', x: 1, y: 0 })
  await ui.pointer({ in: 'manager-apply', type: 'down', button: 'left', x: 1, y: 0 })
  for (let waited = 0; waited < 3000 && JSON.parse(files['/cfg/settings.json']!).enabledPlugins['gamma@inline'] === undefined; waited += 20) await new Promise(resolve => setTimeout(resolve, 20))
  expect(JSON.parse(files['/cfg/settings.json']!).enabledPlugins['gamma@inline']).toBe(false)
  expect(files['/h/.claude/settings.json']).toBe(homeSettings)
  await ui.unmount()
})

test('showcase uses showcase.json, else derives from the hooks source', async () => {
  const { io } = disk()
  const alpha = await byName(io, 'alpha')
  expect(featuresOf(alpha)).toEqual([{ title: 'Count', detail: 'Counts things.' }])

  const beta = await byName(io, 'beta')
  expect(beta.events).toEqual(['tool.call', 'ui.render:AbovePrompt'])
  expect(beta.commands).toEqual(['mod-beta'])
  expect(featuresOf(beta).map(feature => feature.title)).toEqual(['tool.call', 'ui.render:AbovePrompt'])
  expect(featuresOf(beta)[0]!.detail).toContain('tool call')
})

// The engine rewrites paths in the host's style, so compare on a neutral form.
const neutral = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

test('toggles wait for Apply, a reopen drops them, and Apply writes both to settings.json', async ($, on) => {
  const { files } = disk()
  const settingsPath = '/h/.claude/settings.json'
  on('fs.read', async (_$, e) => {
    const path = neutral(e.path)
    if (!(path in files)) throw new Error('ENOENT')
    // A slow disk widens the window where two read-edit-writes would cross.
    await new Promise(resolve => setTimeout(resolve, 5))
    return { value: files[path]! }
  })
  on('fs.write', (_$, e) => {
    files[neutral(e.path)] = e.text
    return { value: undefined }
  })
  on('fs.list', () => ({
    value: [
      { name: 'alpha', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
      { name: 'beta', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
    ],
  }))
  on('env.get', (_$, e) => ({ value: e.name === 'USERPROFILE' ? '/h' : undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('config.list', () => ({ value: [] }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>base</Text>
  })
  await $.command.run({ command: 'mod-manager' } as never)
  const ui = withPointer(await $.ui.mount({
    plugin: 'mod-manager',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'manager',
    props: { title: 'Mods', isFocused: true, bodyColumns: 80, placement: 'above', scroll: { offset: 0, bodyRows: 20 }, view: {} },
  } as never))
  const list = await ui.find({ type: 'Client', key: 'list-dir' })
  const rows = (list?.props.props as { rows?: { index: number; name: string }[] } | undefined)?.rows ?? []
  const indexOf = (name: string) => rows.find(row => row.name === name)!.index
  const untouched = files[settingsPath]
  await ui.post({ type: 'toggle', index: indexOf('Alpha') }, { in: 'list-dir' })
  expect(await ui.find({ type: 'Text', text: 'Turn off Alpha' })).toBeDefined()
  await $.command.run({ command: 'mod-manager' } as never)
  await ui.redraw()
  expect(await ui.find({ key: 'sec-apply' })).toBeUndefined()

  await ui.post({ type: 'toggle', index: indexOf('Beta') }, { in: 'list-dir' })
  await ui.post({ type: 'toggle', index: indexOf('Alpha') }, { in: 'list-dir' })
  expect(files[settingsPath]).toBe(untouched)
  await ui.pointer({ in: 'manager-apply', type: 'down', button: 'left', x: 1, y: 0 })
  // The file's tests run side by side, so the writes are awaited rather than given a fixed time.
  for (let waited = 0; waited < 3000 && JSON.parse(files[settingsPath]!).enabledPlugins?.['alpha@inline'] === undefined; waited += 20) await new Promise(resolve => setTimeout(resolve, 20))
  const settings = JSON.parse(files[settingsPath]!)
  expect(String(settings.env.CLAUDE_CODE_PLUGIN_DIRS)).toContain('beta')
  expect(settings.enabledPlugins['alpha@inline']).toBe(false)
  await ui.unmount()
})

test('pane lists mods on the terminal and a toggle press plans the change', async ($, on) => {
  const { files } = disk()
  const settingsPath = '/h/.claude/settings.json'
  on('fs.read', (_$, e) => {
    const path = neutral(e.path)
    if (!(path in files)) throw new Error('ENOENT')
    return { value: files[path]! }
  })
  on('fs.write', (_$, e) => {
    files[neutral(e.path)] = e.text
    return { value: undefined }
  })
  on('fs.list', () => ({
    value: [
      { name: 'alpha', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
      { name: 'beta', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
    ],
  }))
  on('env.get', (_$, e) => ({ value: e.name === 'USERPROFILE' ? '/h' : undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('config.list', () => ({ value: [] }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>base</Text>
  })

  await $.command.run({ command: 'mod-manager' } as never)

  const ui = withPointer(await $.ui.mount({
    plugin: 'mod-manager',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'manager',
    props: { title: 'Mods', isFocused: true, bodyColumns: 80, placement: 'above', scroll: { offset: 0, bodyRows: 20 }, view: {} },
  } as never))

  const dirs = () => String(JSON.parse(files[settingsPath]!).env.CLAUDE_CODE_PLUGIN_DIRS)
  expect(JSON.stringify(await ui.drawn({ in: 'manager-tab' }))).toContain('3')
  // The count beside the tab is muted text, not a pill.
  expect(await ui.find({ type: 'Text', text: '2 on' })).toBeDefined()
  // Rows group by source, and nothing toggled yet means nothing to reload.
  expect(await ui.find({ type: 'Text', text: /^Yours$/ })).toBeDefined()
  // The row reads only the readable name; the hover card names the folder.
  expect(JSON.stringify(await ui.drawn({ in: 'list-dir' }))).not.toContain('" alpha"')
  expect(await ui.find({ type: 'Text', text: /^Installed$/ })).toBeDefined()
  expect(await ui.find({ key: 'sec-apply' })).toBeUndefined()

  // The switch pill at the row's start toggles; the rest of the row opens the mod. settings.json waits for Apply.
  await ui.pointer({ in: 'list-dir', type: 'down', button: 'left', x: 1, y: 1 })
  expect(dirs()).not.toContain('beta')
  await ui.pointer({ in: 'list-dir', type: 'down', button: 'left', x: 1, y: 0 })
  expect(JSON.parse(files[settingsPath]!).enabledPlugins?.['alpha@inline']).toBeUndefined()
  // An off switch draws its line in trackOff after the knob.
  expect(JSON.stringify(await ui.drawn({ in: 'list-dir' }))).toContain(THEME.trackOff)
  expect(await ui.find({ type: 'Text', text: 'Turn on Beta' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Turn off Alpha' })).toBeDefined()
  expect(JSON.stringify(await ui.drawn({ in: 'manager-apply' }))).toContain(' Apply 2 ')
  expect(JSON.stringify(await ui.find({ key: 'manager-apply-pill' }))).toContain(THEME.surface3)
  // Toggling alpha back leaves one change pending.
  await ui.pointer({ in: 'list-dir', type: 'down', button: 'left', x: 1, y: 0 })
  expect(JSON.stringify(await ui.drawn({ in: 'manager-apply' }))).toContain(' Apply 1 ')
  // While Claude works the reload would only queue as a prompt, so it waits.
  await $.turn.start({ turnId: 't1' } as never)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: / Claude is working, available once it is idle$/ })).toBeDefined()
  // The last toggle left the pointer on alpha's row, so its card shows; leaving the list hides it, hovering again shows it.
  expect(await ui.find({ type: 'Text', text: /alpha does a thing/ })).toBeDefined()
  await ui.pointer({ in: 'list-dir', type: 'leave', x: 0, y: 0 })
  expect(await ui.find({ key: 'hover-card' })).toBeUndefined()
  // The card keeps its place above the list with a hint, so the list never jumps.
  expect(await ui.find({ type: 'Text', text: 'Point at a mod to read what it does' })).toBeDefined()
  expect(JSON.stringify(await ui.drawn())).toContain('"top":3')
  await ui.pointer({ in: 'list-dir', type: 'move', x: 12, y: 0 })
  expect(await ui.find({ type: 'Text', text: 'alpha does a thing' })).toBeDefined()
  expect(await ui.find({ key: 'hover-card' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ` ${MARK.sep} alpha` })).toBeDefined()
  // The control under the pointer names itself in the pane footer: the name part opens, the switch part toggles.
  expect(await ui.find({ type: 'Text', text: / · opens this mod's page and settings$/ })).toBeDefined()
  await ui.pointer({ in: 'list-dir', type: 'move', x: 1, y: 0 })
  expect(await ui.find({ type: 'Text', text: / · turns this mod on or off$/ })).toBeDefined()
  await ui.pointer({ in: 'manager-tab', type: 'move', x: 1, y: 0 })
  expect(await ui.find({ type: 'Text', text: / · shows the list of mods$/ })).toBeDefined()
  await ui.pointer({ in: 'manager-tab', type: 'leave', x: 0, y: 0 })
  expect(await ui.find({ type: 'Text', text: / · shows the list of mods$/ })).toBeUndefined()
  await ui.pointer({ in: 'list-dir', type: 'leave', x: 0, y: 0 })
  expect(await ui.find({ key: 'hover-card' })).toBeUndefined()

  // A click on a name opens that mod's page as a second tab, and the Mods tab returns to the list.
  await ui.pointer({ in: 'list-dir', type: 'down', button: 'left', x: 12, y: 1 })
  expect(await ui.find({ type: 'Text', text: /beta does a thing/ })).toBeDefined()
  expect(JSON.stringify(await ui.drawn({ in: 'manager-page' }))).toContain('Beta')
  await ui.pointer({ in: 'manager-tab', type: 'down', button: 'left', x: 1, y: 0 })
  expect(await ui.find({ type: 'Text', text: '3 on' })).toBeDefined()
  await ui.unmount()
})

test('a feature line too long for the page is cut until Show all wraps every line, and Show less cuts them again', async ($, on) => {
  const long = 'Counts things in a sentence long enough that no eighty column page could ever hold it on one row of the card.'
  const { files } = disk({
    '/h/.claude/mods/alpha/showcase.json': JSON.stringify({ features: [{ title: 'Count', detail: long }, { title: 'Short', detail: 'Fits.' }] }),
  })
  on('fs.read', (_$, e) => {
    const path = neutral(e.path)
    if (!(path in files)) throw new Error('ENOENT')
    return { value: files[path]! }
  })
  on('fs.list', () => ({ value: [{ name: 'alpha', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] }))
  on('env.get', (_$, e) => ({ value: e.name === 'USERPROFILE' ? '/h' : undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('config.list', () => ({ value: [] }))
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })

  await $.command.run({ command: 'mod-manager' } as never)
  const ui = withPointer(await $.ui.mount({
    plugin: 'mod-manager',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'manager',
    props: { title: 'Mods', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  } as never))
  await ui.pointer({ in: 'list-dir', type: 'down', button: 'left', x: 12, y: 0 })

  // Closed, a feature is one cut row, "Name · text".
  const cut = async () => (await ui.find({ type: 'Text', text: `${MARK.sep} ${long}` }))?.props.wrap
  expect(await cut()).toBe('truncate-end')
  expect(JSON.stringify(await ui.drawn({ in: 'manager-features' }))).toContain('Show all')
  // The expand standard: the arrow in accent, a muted label on the card's fill, no pill, at the last feature row's right end.
  const toggle = (await ui.find({ type: 'Client', key: 'manager-features' }))?.props.props as Record<string, unknown>
  expect(toggle.lead).toBe('▾')
  expect(toggle.leadColor).toBe(THEME.accent)
  expect(toggle.idle).toBe(THEME.muted)
  expect(toggle.label).toBe('Show all')
  expect(await ui.find({ key: 'features-more-pill' })).toBeUndefined()
  expect(JSON.stringify(await ui.find({ key: 'features-last' }))).toContain('"key":"features-more"')
  await ui.pointer({ in: 'manager-features', type: 'down', button: 'left', x: 1, y: 0 })
  expect(((await ui.find({ type: 'Client', key: 'manager-features' }))?.props.props as Record<string, unknown>).lead).toBe('▴')
  // Open, the name has its own row, its text sits under it two cells in and wraps there, and a blank row parts the features.
  expect((await ui.find({ type: 'Text', text: long }))?.props.wrap).toBe('wrap')
  expect(await ui.find({ type: 'Text', text: `${MARK.sep} ${long}` })).toBeUndefined()
  const name = await ui.find({ type: 'Text', text: 'Count' })
  expect(name?.props.bold).toBe(true)
  expect(name?.props.color).toBe(THEME.onSurface)
  expect((await ui.find({ key: 'feature-0-detail' }))?.props.paddingLeft).toBe(2)
  expect((await ui.find({ key: 'feature-1-detail' }))?.props.paddingLeft).toBe(2)
  expect((await ui.find({ key: 'feature-0' }))?.props.marginTop).toBe(0)
  expect((await ui.find({ key: 'feature-1' }))?.props.marginTop).toBe(1)
  expect(JSON.stringify(await ui.drawn({ in: 'manager-features' }))).toContain('Show less')
  await ui.pointer({ in: 'manager-features', type: 'down', button: 'left', x: 1, y: 0 })
  expect(await cut()).toBe('truncate-end')
  await ui.unmount()
})

test('a page whose feature lines all fit draws no Show all', async ($, on) => {
  const { files } = disk()
  on('fs.read', (_$, e) => {
    const path = neutral(e.path)
    if (!(path in files)) throw new Error('ENOENT')
    return { value: files[path]! }
  })
  on('fs.list', () => ({ value: [{ name: 'alpha', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] }))
  on('env.get', (_$, e) => ({ value: e.name === 'USERPROFILE' ? '/h' : undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('config.list', () => ({ value: [] }))
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })
  await $.command.run({ command: 'mod-manager' } as never)
  const ui = withPointer(await $.ui.mount({ plugin: 'mod-manager', surface: 'terminal', component: 'Pane', requestId: 'manager', props: { title: 'Mods', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } } as never))
  await ui.pointer({ in: 'list-dir', type: 'down', button: 'left', x: 12, y: 0 })
  expect(await ui.find({ type: 'Client', key: 'manager-features' })).toBeUndefined()
  await ui.unmount()
})

test("a mod page shows a number with its title's unit and steps it inside the range its plugin.json declares", async ($, on) => {
  const { files } = disk({
    '/h/.claude/mods/alpha/.claude-plugin/plugin.json': JSON.stringify({ name: 'alpha', description: 'alpha does a thing', version: '1.0.0', userConfig: { mark: { type: 'number', title: 'Mark (tokens)', description: 'When', default: 400_000, min: 50_000, max: 1_000_000 } } }),
  })
  const saved: unknown[] = []
  on('fs.read', (_$, e) => {
    const path = neutral(e.path)
    if (!(path in files)) throw new Error('ENOENT')
    return { value: files[path]! }
  })
  on('fs.list', () => ({ value: [{ name: 'alpha', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] }))
  on('env.get', (_$, e) => ({ value: e.name === 'USERPROFILE' ? '/h' : undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('config.list', () => ({ value: [{ key: 'alpha.mark', label: 'Mark (tokens)', description: 'When', kind: 'number', value: 400_000, provider: { kind: 'plugin', name: 'alpha' }, isLocked: false }] as never }))
  on('config.set', (_$, e) => {
    saved.push([e.key, e.value])
    return { value: e.value }
  })
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })

  await $.command.run({ command: 'mod-manager' } as never)
  const ui = withPointer(await $.ui.mount({
    plugin: 'mod-manager',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'manager',
    props: { title: 'Mods', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  } as never))
  await ui.pointer({ in: 'list-dir', type: 'down', button: 'left', x: 12, y: 0 })

  expect(await ui.find({ type: 'Text', text: /^Mark$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ ?400K tokens ?$/ })).toBeDefined()
  await ui.pointer({ in: 'setting-0-up', type: 'down', button: 'left', x: 1, y: 0 })
  expect(saved).toEqual([['alpha.mark', 450_000]])
  await ui.unmount()
})

test('a mod page changes its settings, runs its actions, and holds them while Claude works', async ($, on) => {
  const { files } = disk({
    '/h/.claude/mods/alpha/showcase.json': JSON.stringify({
      tagline: 'Alpha tagline',
      actions: [{ label: 'Say hi', command: 'alpha', args: 'hi' }],
      previews: { loud: { false: { nerd: [{ spans: [{ text: 'quiet example' }] }], safe: [{ spans: [{ text: 'quiet example' }] }] } } },
    }),
    '/h/.claude/mods/alpha/.claude-plugin/plugin.json': JSON.stringify({ name: 'alpha', description: 'alpha does a thing', version: '1.0.0', userConfig: { loud: { type: 'boolean', title: 'Loud', description: 'Shouts', default: false } } }),
  })
  const saved: unknown[] = []
  const ran: string[] = []
  on('fs.read', (_$, e) => {
    const path = neutral(e.path)
    if (!(path in files)) throw new Error('ENOENT')
    return { value: files[path]! }
  })
  on('fs.list', () => ({ value: [{ name: 'alpha', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] }))
  on('env.get', (_$, e) => ({ value: e.name === 'USERPROFILE' ? '/h' : undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('config.list', () => ({
    value: [
      { key: 'alpha.loud', label: 'Loud', description: 'Shouts', kind: 'boolean', value: false, provider: { kind: 'plugin', name: 'alpha' }, isLocked: false },
      { key: 'other.loud', label: 'Not alpha', kind: 'boolean', value: true, provider: { kind: 'plugin', name: 'other' }, isLocked: false },
    ] as never,
  }))
  on('config.set', (_$, e) => {
    saved.push([e.key, e.value])
    return { value: e.value }
  })
  on('command.run', (_$, e) => {
    ran.push(`${e.command} ${e.args}`)
    return { text: '' }
  })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })

  await $.command.run({ command: 'mod-manager' } as never)
  const ui = withPointer(await $.ui.mount({
    plugin: 'mod-manager',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'manager',
    props: { title: 'Mods', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  } as never))
  // A mod that declares settings carries the gear in the list; a mod without settings does not.
  const listed = JSON.stringify(await ui.drawn({ in: 'list-dir' }))
  expect(listed).toContain('⊛')
  expect(listed.split('⊛').length).toBe(2)
  await ui.pointer({ in: 'list-dir', type: 'down', button: 'left', x: 12, y: 0 })

  // Only alpha's own rows show, and a click saves through /config.
  expect(await ui.find({ type: 'Text', text: /^Loud$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Not alpha$/ })).toBeUndefined()
  // The example card for the current value comes from the mod's showcase.json, as in its own panel.
  expect(await ui.find({ type: 'Text', text: /^quiet example$/ })).toBeDefined()
  await ui.pointer({ in: 'setting-0-flip', type: 'down', button: 'left', x: 1, y: 0 })
  expect(saved).toEqual([['alpha.loud', true]])
  expect(await ui.find({ type: 'Text', text: /Loud saved/ })).toBeDefined()

  await ui.press({ key: 'action-0' })
  expect(ran).toEqual(['alpha hi'])

  // Another mod's command would only queue mid-turn, so its action waits.
  await $.turn.start({ turnId: 't1' } as never)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /Say hi · available once Claude is idle/ })).toBeDefined()
  await ui.unmount()
})

test('a text setting its mod edits in its own panel gets an open pill that runs the mod command; other text settings keep the /config note', async ($, on) => {
  const { files } = disk({
    '/h/.claude/mods/alpha/.claude-plugin/plugin.json': JSON.stringify({ name: 'alpha', description: 'alpha does a thing', version: '1.0.0', userConfig: {} }),
    '/h/.claude/mods/alpha/showcase.json': JSON.stringify({ editors: ['theme'] }),
  })
  const ran: string[] = []
  on('fs.read', (_$, e) => {
    const path = neutral(e.path)
    if (!(path in files)) throw new Error('ENOENT')
    return { value: files[path]! }
  })
  on('fs.list', () => ({ value: [{ name: 'alpha', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] }))
  on('env.get', (_$, e) => ({ value: e.name === 'USERPROFILE' ? '/h' : undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('config.list', () => ({
    value: [
      { key: 'alpha.theme', label: 'Theme', description: 'Picked in a panel', kind: 'text', value: 'Dark', provider: { kind: 'plugin', name: 'alpha' }, isLocked: false },
      { key: 'alpha.name', label: 'Name', description: 'Plain text', kind: 'text', value: 'x', provider: { kind: 'plugin', name: 'alpha' }, isLocked: false },
    ] as never,
  }))
  on('command.run', (_$, e) => {
    ran.push(`${e.command} ${e.args}`)
    return { text: '' }
  })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })

  await $.command.run({ command: 'mod-manager' } as never)
  const ui = withPointer(await $.ui.mount({
    plugin: 'mod-manager',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'manager',
    props: { title: 'Mods', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  } as never))
  await ui.pointer({ in: 'list-dir', type: 'down', button: 'left', x: 12, y: 0 })

  expect(await ui.find({ type: 'Text', text: /Open in Alpha settings/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Text', text: /Open in Alpha settings/ })).length).toBe(1)
  expect(await ui.find({ type: 'Text', text: /^Picked in a panel$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Plain text · edit it in \/config/ })).toBeDefined()
  await ui.press({ key: 'setting-editor-0' })
  expect(ran).toEqual(['alpha settings'])

  // Another mod's command would only queue mid-turn, so the pill waits.
  await $.turn.start({ turnId: 't1' } as never)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /Open in Alpha settings/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Picked in a panel · available once Claude is idle/ })).toBeDefined()
  await ui.unmount()
})

test('the command toggles: it opens a closed pane and closes an open one', async ($, on) => {
  let open: string[] = []
  const calls: string[] = []
  on('fs.read', () => {
    throw new Error('ENOENT')
  })
  on('fs.list', () => ({ value: [] }))
  on('env.get', () => ({ value: '/h' }))
  on('ui.panes', () => ({ value: open.map(id => ({ id, isPlaced: true })) as never }))
  on('ui.open', (_$, e) => {
    calls.push(`open ${e.id}`)
    open = [e.id]
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_$, e) => {
    calls.push(`close ${e.id}`)
    open = []
    return { value: undefined }
  })

  await $.command.run({ command: 'mod-manager' } as never)
  await $.command.run({ command: 'mod-manager' } as never)
  expect(calls).toEqual(['open manager', 'close manager'])
})

test('its footer entry opens the pane on a press and closes it on the next', async ($, on) => {
  const opened: string[] = []
  on('fs.read', () => {
    throw new Error('ENOENT')
  })
  on('fs.list', () => ({ value: [] }))
  on('env.get', () => ({ value: '/h' }))
  on('ui.panes', () => ({ value: opened.filter(id => !opened.includes(`close ${id}`)).map(id => ({ id, isPlaced: true })) as never }))
  on('ui.close', (_$, e) => {
    opened.push(`close ${e.id}`)
    return { value: undefined }
  })
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>other mod</Text>
  })
  const band = {
    plugin: 'mod-manager',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 80, scroll: { offset: 0, bodyRows: 6 }, view: {} },
  } as const

  const idle = await $.ui.mount(band)
  expect(await idle.find({ type: 'Text', text: 'other mod' })).toBeDefined()
  await idle.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'menu-entry-manager' })
  expect(opened).toEqual(['manager'])
  await idle.unmount()

  const busy = await $.ui.mount(band)
  await busy.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'menu-entry-manager' })
  expect(opened).toEqual(['manager', 'close manager'])
  await busy.unmount()
})

test('a pill tip whose entry was redrawn while hovered clears after 5 s with no newer hover', async ($, on) => {
  const clock = mock.clock(on)
  on('fs.read', () => {
    throw new Error('ENOENT')
  })
  on('fs.list', () => ({ value: [] }))
  on('env.get', () => ({ value: '/h' }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>other mod</Text>
  })
  const band = {
    plugin: 'mod-manager',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 80, scroll: { offset: 0, bodyRows: 6 }, view: {} },
  } as const
  const shows = async (ui: { drawn(): Promise<unknown> }) => JSON.stringify(await ui.drawn()).includes('turn each mod on or off')
  // Live, a band redraw mid-turn replaced the hovered entry, so its own quiet timer, and the leave, never came.
  const first = withPointer(await $.ui.mount(band))
  await first.pointer({ type: 'move', x: 1, y: 0, in: 'menu-entry-manager' })
  await first.unmount()
  const showsNow = async () => {
    const ui = await $.ui.mount(band)
    const shown = await shows(ui)
    await ui.unmount()
    return shown
  }
  expect(await showsNow()).toBe(true)
  await clock.advance(4000)
  expect(await showsNow()).toBe(true)
  await clock.advance(1000)
  expect(await showsNow()).toBe(false)
})

const iconsPane = async ($: any, on: any) => {
  const { files } = disk()
  on('fs.read', (_$: unknown, e: { path: string }) => {
    const path = neutral(e.path)
    if (!(path in files)) throw new Error('ENOENT')
    return { value: files[path]! }
  })
  on('fs.list', () => ({ value: [{ name: 'alpha', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] }))
  on('env.get', (_$: unknown, e: { name: string }) => ({ value: e.name === 'USERPROFILE' ? '/h' : undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('config.list', () => ({ value: [] }))
  on('ui.render', ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })
  await $.command.run({ command: 'mod-manager' } as never)
  const ui = await $.ui.mount({
    plugin: 'mod-manager',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'manager',
    props: { title: 'Mods', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  } as never)
  await ui.pointer({ in: 'list-dir', type: 'down', button: 'left', x: 12, y: 0 })
  return ui
}

test('the icons switch shows Mixed when mods differ, and one click sets every mod, this one last', async ($, on) => {
  const { files } = disk()
  // Values the engine hands out come back frozen, so the rows are rebuilt from this map on every list.
  const values: Record<string, string> = { 'mod-manager.icons': 'auto', 'mod-alpha.icons': 'auto', 'mod-beta.icons': 'nerd' }
  const rows = () => Object.entries(values).map(([key, value]) => ({ key, label: 'Icons', kind: 'select', value, options: ['auto', 'nerd', 'safe'], description: 'd' }))
  const saved: string[] = []
  on('fs.read', (_$: unknown, e: { path: string }) => {
    const path = neutral(e.path)
    if (!(path in files)) throw new Error('ENOENT')
    return { value: files[path]! }
  })
  on('fs.list', () => ({ value: [{ name: 'alpha', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] }))
  on('env.get', (_$: unknown, e: { name: string }) => ({ value: e.name === 'USERPROFILE' ? '/h' : undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('config.list', () => ({ value: rows() as never }))
  on('config.set', ((_$: unknown, e: { key: string; value: string }) => {
    saved.push(e.key)
    values[e.key] = e.value
    return { value: e.value }
  }) as never)
  on('ui.render', ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })
  await $.command.run({ command: 'mod-manager' } as never)
  const ui = withPointer(await $.ui.mount({
    plugin: 'mod-manager',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'manager',
    props: { title: 'Mods', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  } as never))
  expect(await ui.find({ type: 'Text', text: /· Mixed$/ })).toBeDefined()
  // The switch sits in its own setting card: the label, the bar, and what it does.
  expect(await ui.find({ type: 'Text', text: /^Sets every mod's icons at once/ })).toBeDefined()

  // One track, no rails, and every option keeps its own padded hit area.
  expect(await ui.find({ key: 'icons-bar' })).toBeDefined()
  expect(await ui.find({ key: 'icons-rail-1' })).toBeUndefined()
  expect(JSON.stringify(await ui.drawn({ in: 'icons-nerd' }))).toContain(' Nerd ')

  await ui.pointer({ in: 'icons-nerd', type: 'down', button: 'left', x: 1, y: 0 })
  await ui.redraw()
  // Only the mods not already on Nerd change, and this mod's own setting goes last since saving it reloads this mod.
  expect(saved).toEqual(['mod-alpha.icons', 'mod-manager.icons'])
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /· Mixed$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Icons set to Nerd in 2 mods/ })).toBeDefined()
  await ui.unmount()
})

test('the icons switch skips a mod whose icons field is not the standard set', async ($, on) => {
  const { files } = disk()
  const values: Record<string, string> = { 'mod-manager.icons': 'auto', 'mod-alpha.icons': 'auto', 'mod-odd.icons': 'auto' }
  const optionsOf = (key: string) => (key === 'mod-odd.icons' ? ['auto', 'plain'] : ['auto', 'nerd', 'safe'])
  const rows = () => Object.entries(values).map(([key, value]) => ({ key, label: 'Icons', kind: 'select', value, options: optionsOf(key), description: 'd' }))
  const saved: string[] = []
  on('fs.read', (_$: unknown, e: { path: string }) => {
    const path = neutral(e.path)
    if (!(path in files)) throw new Error('ENOENT')
    return { value: files[path]! }
  })
  on('fs.list', () => ({ value: [{ name: 'alpha', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] }))
  on('env.get', (_$: unknown, e: { name: string }) => ({ value: e.name === 'USERPROFILE' ? '/h' : undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('config.list', () => ({ value: rows() as never }))
  on('config.set', ((_$: unknown, e: { key: string; value: string }) => {
    saved.push(e.key)
    values[e.key] = e.value
    return { value: e.value }
  }) as never)
  on('ui.render', ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })
  await $.command.run({ command: 'mod-manager' } as never)
  const ui = withPointer(await $.ui.mount({
    plugin: 'mod-manager',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'manager',
    props: { title: 'Mods', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  } as never))
  await ui.pointer({ in: 'icons-nerd', type: 'down', button: 'left', x: 1, y: 0 })
  await ui.redraw()
  expect(saved).toEqual(['mod-alpha.icons', 'mod-manager.icons'])
  await ui.unmount()
})

const PILL_CAP = String.fromCodePoint(0xe0b6)

test('icons=nerd draws Nerd controls and pill headings', { options: { icons: 'nerd' } }, async ($, on) => {
  const ui = await iconsPane($, on)
  expect(await ui.find({ type: 'Text', text: PILL_CAP })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Features$/ })).toBeDefined()
  expect(await ui.find({ key: 'features-edge' })).toBeDefined()
  await ui.pointer({ in: 'manager-tab', type: 'down', button: 'left', x: 1, y: 0 })
  expect(JSON.stringify(await ui.drawn({ in: 'list-dir' }))).toContain(PILL_CAP)
  await ui.unmount()
})

test('icons=safe keeps the common Unicode glyphs and plain headings', { options: { icons: 'safe' } }, async ($, on) => {
  const ui = await iconsPane($, on)
  expect(await ui.find({ type: 'Text', text: PILL_CAP })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Features$/ })).toBeDefined()
  expect(await ui.find({ key: 'features-edge' })).toBeDefined()
  await ui.pointer({ in: 'manager-tab', type: 'down', button: 'left', x: 1, y: 0 })
  const rows = JSON.stringify(await ui.drawn({ in: 'list-dir' }))
  expect(rows).toContain('━━')
  expect(rows).not.toContain(PILL_CAP)
  await ui.unmount()
})

const SUMMARY = 'Calls a model every sixth step. The `Check while Claude works` setting turns it off.'
const PLAIN = SUMMARY.replace(/`/g, '')

test('discovery reads only the summary of a showcase cost, and a mod without one has none', async () => {
  const { io } = disk({
    '/h/.claude/mods/alpha/showcase.json': JSON.stringify({ cost: { summary: SUMMARY, readme: ['More detail.'] } }),
    '/h/.claude/mods/beta/showcase.json': JSON.stringify({ cost: { readme: ['No summary.'] } }),
  })
  expect((await byName(io, 'alpha')).showcase?.cost).toEqual({ summary: SUMMARY })
  expect((await byName(io, 'beta')).showcase?.cost).toBeUndefined()
  expect((await byName(io, 'inst')).showcase).toBeNull()
})

const costPane = async ($: any, on: any, costs = true, extra: object = {}) => {
  const { files } = disk({
    ...(costs ? { '/h/.claude/mods/alpha/showcase.json': JSON.stringify({ cost: { summary: SUMMARY } }) } : {}),
    '/h/.claude/mods/alpha/.claude-plugin/plugin.json': JSON.stringify({ ...JSON.parse(manifest('alpha')), ...extra }),
  })
  on('fs.read', (_$: unknown, e: { path: string }) => {
    const path = neutral(e.path)
    if (!(path in files)) throw new Error('ENOENT')
    return { value: files[path]! }
  })
  on('fs.list', () => ({ value: ['alpha', 'beta'].map(name => ({ name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false })) }))
  on('env.get', (_$: unknown, e: { name: string }) => ({ value: e.name === 'USERPROFILE' ? '/h' : undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('config.list', () => ({ value: [] }))
  on('ui.render', ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })
  await $.command.run({ command: 'mod-manager' } as never)
  return withPointer(await $.ui.mount({
    plugin: 'mod-manager',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'manager',
    props: { title: 'Mods', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  } as never))
}

test('a row with a cost draws the cost pill beside its version and a row without draws a blank, the columns still lined up', { options: { icons: 'safe' } }, async ($, on) => {
  const ui = await costPane($, on)
  const rows = JSON.stringify(await ui.drawn({ in: 'list-dir' }))
  expect(rows).toContain('"key":"cost-0"')
  expect(rows).not.toContain('"key":"cost-1"')
  expect(rows).toContain(`"color":"${THEME.secondary}","backgroundColor":"${THEME.surface3}","bold":true},"children":[" $ "]`)
  // The blank is as wide as the pill, so the version column holds.
  expect(rows).toContain('"key":"cost-1-cell","flexShrink":0,"paddingLeft":1},"children":[{"type":"Text","children":["   "]')
  expect(rows.indexOf('"cost-0-cell"')).toBeLessThan(rows.indexOf('"row-0-version"'))
  expect(rows.indexOf('"row-0-gap"')).toBeLessThan(rows.indexOf('"cost-0-cell"'))
  await ui.unmount()
})

test('a mod with settings gets a neutral gear pill the size of the cost pill, after it', { options: { icons: 'nerd' } }, async ($, on) => {
  const ui = await costPane($, on, true, { userConfig: { level: { type: 'number', title: 'Level', default: 1 } } })
  const rows = JSON.stringify(await ui.drawn({ in: 'list-dir' }))
  expect(rows).toContain(`"color":"${THEME.secondary}","backgroundColor":"${THEME.surface3}","bold":true},"children":["${String.fromCodePoint(0xf0493)}"]`)
  expect(rows.indexOf('"cost-0-cell"')).toBeLessThan(rows.indexOf('"gear-0-cell"'))
  expect(rows).toContain('"key":"gear-1-cell"')
  await ui.unmount()
})

test('the version keeps a gap and the row draws no folder column', { options: { icons: 'safe' } }, async ($, on) => {
  const ui = await costPane($, on)
  const rows = JSON.stringify(await ui.drawn({ in: 'list-dir' }))
  expect(rows).toContain('"key":"row-0-version","flexShrink":0,"paddingLeft":1')
  expect(rows).not.toMatch(/"children":\[" mod-[\w-]+"\]/)
  await ui.unmount()
})

test('with no cost in any mod the list draws no pill and no blank', { options: { icons: 'safe' } }, async ($, on) => {
  const ui = await costPane($, on, false)
  expect(JSON.stringify(await ui.drawn({ in: 'list-dir' }))).not.toContain('cost-')
  await ui.unmount()
})

test('hovering the cost pill shows its summary in the pane footer, and the name still shows its own tip', { options: { icons: 'safe' } }, async ($, on) => {
  const ui = await costPane($, on)
  // The pill sits right: the width less the version and its gap, less the pill's own cells.
  await (ui as any).resize({ columns: 60, rows: 2, in: 'list-dir' })
  await ui.pointer({ in: 'list-dir', type: 'move', x: 60 - 6 - 3 + 1, y: 0 })
  expect(await ui.find({ type: 'Text', text: ' Costs' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ` · calls a model and spends tokens, its page says how to turn it off` })).toBeDefined()
  await ui.pointer({ in: 'list-dir', type: 'move', x: 10, y: 0 })
  expect(await ui.find({ type: 'Text', text: ` · calls a model and spends tokens, its page says how to turn it off` })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: / · opens this mod's page and settings$/ })).toBeDefined()
  await ui.unmount()
})

test('safe mode draws the cost pill with $ and a space each side, no caps', { options: { icons: 'safe' } }, async ($, on) => {
  const ui = await costPane($, on)
  const rows = JSON.stringify(await ui.drawn({ in: 'list-dir' }))
  expect(rows).toContain('" $ "')
  expect(rows).not.toContain(String.fromCodePoint(0xe0b6))
  await ui.unmount()
})

test('nerd mode draws the cost pill as a dollar glyph between rounded caps', { options: { icons: 'nerd' } }, async ($, on) => {
  const ui = await costPane($, on)
  const rows = JSON.stringify(await ui.drawn({ in: 'list-dir' }))
  expect(rows).toContain(String.fromCodePoint(0xf155))
  expect(rows).toContain(String.fromCodePoint(0xe0b6))
  await ui.unmount()
})

test('a mod page draws a Costs card under the header only when the mod has a summary', { options: { icons: 'safe' } }, async ($, on) => {
  const ui = await costPane($, on)
  await ui.pointer({ in: 'list-dir', type: 'down', button: 'left', x: 10, y: 0 })
  const card = await ui.find({ key: 'page-cost' })
  expect(card?.props.borderStyle).toBe('round')
  expect(card?.props.borderColor).toBe(THEME.border)
  expect(card?.props.backgroundColor).toBe(cardFill())
  expect(card?.props.paddingX).toBe(1)
  // The title sits in the top edge, not in a heading row inside the card.
  expect((await ui.find({ type: 'Text', text: 'Costs' }))?.props.bold).toBe(true)
  expect(await ui.find({ key: 'page-cost-head' })).toBeUndefined()
  expect(await ui.find({ key: 'page-cost-edge' })).toBeDefined()
  const summary = await ui.find({ type: 'Text', text: PLAIN })
  expect(summary?.props.color).toBe(THEME.muted)
  expect(summary?.props.wrap).toBe('wrap')
  // A setting's name, in backticks in the summary, stands out in the accent color without them.
  expect((await ui.findAll({ type: 'Text', text: 'Check while Claude works' })).map((node: any) => node.props.color)).toContain(THEME.accent)
  expect(await ui.find({ type: 'Text', text: /`/ })).toBeUndefined()
  expect(await ui.find({ key: 'page-cost-pill' })).toBeDefined()
  await ui.pointer({ in: 'manager-tab', type: 'down', button: 'left', x: 1, y: 0 })
  await ui.pointer({ in: 'list-dir', type: 'down', button: 'left', x: 10, y: 1 })
  expect(await ui.find({ key: 'page-cost' })).toBeUndefined()
  await ui.unmount()
})

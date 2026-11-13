// mod-manager / tests/narrow.test.tsx, by v-amorim: the list keeps one row per mod when the pane is too narrow for every column
import { expect, test } from 'claude-code/testing'

const withPointer = <T,>(m: T) => m as T & { pointer(e: object): Promise<unknown> }

const neutral = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

const LONG = 'mod-desktop-status-line'

test('a pane Claude Code will not place in a narrow window says how to open it anyway', async ($, on) => {
  on('fs.read', () => {
    throw new Error('ENOENT')
  })
  on('fs.list', () => ({ value: [] }))
  on('env.get', (_$, e) => ({ value: e.name === 'USERPROFILE' ? '/h' : undefined }))
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'unasked below 110 columns (105 now)' } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })
  const band = await $.ui.mount({ plugin: 'mod-manager', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 12, bodyColumns: 80, scroll: { offset: 0, bodyRows: 12 }, view: {} } } as never)
  await $.command.run({ command: 'mod-manager' } as never)
  await band.redraw()
  expect(await band.find({ type: 'Text', text: /Window too narrow for Mods\. Type \/mod-manager to open it anyway\./ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /unasked/ })).toBeUndefined()
  await band.unmount()
})

test('a narrow pane cuts the commands, never wraps a switch or a cost pill', { options: { icons: 'nerd' } }, async ($, on) => {
  const mod = (name: string) => ({
    [`/h/.claude/mods/${name}/.claude-plugin/plugin.json`]: JSON.stringify({ name, description: `${name} does a thing`, version: '0.1.0' }),
    [`/h/.claude/mods/${name}/hooks/hooks.json`]: JSON.stringify({ modules: ['./register.tsx'] }),
    [`/h/.claude/mods/${name}/hooks/register.tsx`]: `$.command.register({ name: '${name}-extra', description: 'x' })`,
  })
  const files: Record<string, string> = {
    '/h/.claude/settings.json': JSON.stringify({ env: { CLAUDE_CODE_PLUGIN_DIRS: `~/.claude/mods/mod-blast-radius;~/.claude/mods/${LONG}` }, enabledPlugins: { [`${LONG}@inline`]: false } }, null, 2) + '\n',
    ...mod('mod-blast-radius'),
    ...mod(LONG),
    '/h/.claude/mods/mod-blast-radius/showcase.json': JSON.stringify({ cost: { summary: 'Costs tokens.' } }),
  }
  on('fs.read', (_$, e) => {
    const path = neutral(e.path)
    if (!(path in files)) throw new Error('ENOENT')
    return { value: files[path]! }
  })
  on('fs.list', () => ({ value: ['mod-blast-radius', LONG].map(name => ({ name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false })) }))
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
    props: { title: 'Mods', isFocused: false, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  } as never))
  // The kit draws no layout, so the check is the rule itself: a bare Text in the row, or a Box that may shrink, is what wrapped.
  type Node = { type: string; props?: Record<string, unknown>; children?: Node[] }
  const rows = ((await ui.drawn({ in: 'list-dir' })) as unknown as Node).children!
  expect(rows.length).toBe(2)
  for (const row of rows) {
    const squeezable = row.children!.filter(part => {
      const key = String(part.props?.key ?? '')
      if (/-(commands|gap)$/.test(key)) return false
      return part.type !== 'Box' || part.props?.flexShrink !== 0
    })
    expect(squeezable).toEqual([])
  }
  await ui.unmount()
})

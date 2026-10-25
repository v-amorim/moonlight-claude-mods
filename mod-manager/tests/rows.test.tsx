// mod-manager / tests/rows.test.tsx, by v-amorim: row hover, the shared card, the Apply pill and the pane frame
import { expect, test } from 'claude-code/testing'

import { mix, THEME } from '../hooks/theme'

const neutral = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
const manifest = (name: string) => JSON.stringify({ name, description: `${name} does a thing`, version: '1.0.0' })
const files: Record<string, string> = {
  '/h/.claude/settings.json': JSON.stringify({ env: { CLAUDE_CODE_PLUGIN_DIRS: '~/.claude/mods/alpha' }, enabledPlugins: {} }),
  '/h/.claude/plugins/installed_plugins.json': JSON.stringify({ plugins: {} }),
  '/h/.claude/mods/alpha/.claude-plugin/plugin.json': manifest('alpha'),
  '/h/.claude/mods/alpha/hooks/hooks.json': JSON.stringify({ modules: ['./register.tsx'] }),
  '/h/.claude/mods/alpha/hooks/register.tsx': "on('tool.call', async () => {})",
}

const mount = async ($: any, on: any) => {
  on('fs.read', (_$: unknown, e: { path: string }) => {
    const path = neutral(e.path)
    if (!(path in files)) throw new Error('ENOENT')
    return { value: files[path]! }
  })
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    files[neutral(e.path)] = e.text
    return { value: undefined }
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
  return $.ui.mount({ plugin: 'mod-manager', surface: 'terminal', component: 'Pane', requestId: 'manager', props: { title: 'Mods', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } } as never) as Promise<any>
}

test('the row under the pointer draws a lifted background with accent text, and the lift leaves with the pointer', { options: { animations: false } }, async ($, on) => {
  const ui = await mount($, on)
  const rest = JSON.stringify(await ui.drawn({ in: 'list-dir' }))
  expect(rest).not.toContain(THEME.lifted)
  await ui.pointer({ in: 'list-dir', type: 'move', x: 12, y: 0 })
  const lit = JSON.stringify(await ui.drawn({ in: 'list-dir' }))
  expect(lit).toContain(THEME.lifted)
  expect(lit).toContain(THEME.accent)
  await ui.pointer({ in: 'list-dir', type: 'leave', x: 0, y: 0 })
  expect(JSON.stringify(await ui.drawn({ in: 'list-dir' }))).not.toContain(THEME.lifted)
  await ui.unmount()
})

test('the hover card is the shared sticky card with no strip, a neutral border, a tinted fill and the painted gap row', async ($, on) => {
  const ui = await mount($, on)
  expect(await ui.find({ key: 'card-wrap' })).toBeDefined()
  expect(await ui.find({ key: 'card-strip' })).toBeUndefined()
  const card = await ui.find({ key: 'card' })
  expect(card?.props.borderColor).toBe(THEME.border)
  expect(card?.props.backgroundColor).toBe(mix(THEME.surface1, THEME.accent, 0.06))
  expect((await ui.find({ key: 'card-gap' }))?.props.backgroundColor).toBe(THEME.bg)
  expect((await ui.find({ key: 'card-space' }))?.props.height).toBe(4)
  await ui.unmount()
})

test('the pane root is painted bg and the footer space never shrinks', async ($, on) => {
  const ui = await mount($, on)
  expect((await ui.find({ key: 'footer-space' }))?.props.flexShrink).toBe(0)
  expect(JSON.stringify(await ui.drawn())).toContain(`"backgroundColor":"${THEME.bg}"`)
  await ui.unmount()
})

test('the Apply pill leads with the go subpill, not the title chevron', async ($, on) => {
  const ui = await mount($, on)
  await ui.pointer({ in: 'list-dir', type: 'down', button: 'left', x: 1, y: 0 })
  const apply = JSON.stringify(await ui.drawn({ in: 'manager-apply' }))
  expect(apply).toContain('↵')
  expect(apply).not.toContain('▸')
  await ui.unmount()
})

test('the menu entry keeps its gear when mod-menu says labels never', { options: { icons: 'nerd' } }, async ($, on) => {
  on('fs.read', () => {
    throw new Error('ENOENT')
  })
  on('fs.list', () => ({ value: [] }))
  on('env.get', () => ({ value: '/h' }))
  on('ui.panes', () => ({ value: [] }))
  on('state.get', (_$: unknown, e: { key: string }) => ({ value: { value: e.key === 'labels' ? 'never' : undefined } }) as never)
  on('ui.render', ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>other mod</Text>
  })
  const band = await $.ui.mount({ plugin: 'mod-manager', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 80, scroll: { offset: 0, bodyRows: 6 }, view: {} } } as never)
  expect(JSON.stringify(await band.drawn({ in: 'menu-entry-manager' }))).toContain(String.fromCodePoint(0xf0493))
  await band.unmount()
})

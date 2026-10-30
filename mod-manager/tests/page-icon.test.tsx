// mod-manager / tests/page-icon.test.tsx, by v-amorim: a mod page's own icon (a file of its own, the manager keeps its mod list per file)
import { expect, test } from 'claude-code/testing'

const neutral = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

test("a mod page draws the mod's own icon on its tab and About card, not the generic mod icon", { options: { icons: 'nerd' } }, async ($, on) => {
  const generic = String.fromCodePoint(0xf12e)
  const own = String.fromCodePoint(0xf03d7)
  const files: Record<string, string> = {
    '/h/.claude/settings.json': '{}\n',
    '/h/.claude/plugins/installed_plugins.json': JSON.stringify({ plugins: {} }),
    '/h/.claude/mods/mod-wrap-up/hooks/hooks.json': JSON.stringify({ modules: ['./register.tsx'] }),
    '/h/.claude/mods/mod-wrap-up/hooks/register.tsx': "on('tool.call', async () => {})",
    '/h/.claude/mods/mod-wrap-up/.claude-plugin/plugin.json':JSON.stringify({ name: 'mod-wrap-up', description: 'Wraps up', version: '1.0.0' }),
  }
  on('fs.read', (_$, e) => {
    const path = neutral(e.path)
    if (!(path in files)) throw new Error('ENOENT')
    return { value: files[path]! }
  })
  on('fs.list', () => ({ value: [{ name: 'mod-wrap-up', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] }))
  on('env.get', (_$, e) => ({ value: e.name === 'USERPROFILE' ? '/h' : undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('config.list', () => ({ value: [] }))
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })

  await $.command.run({ command: 'mod-manager' } as never)
  const ui = await $.ui.mount({ plugin: 'mod-manager', surface: 'terminal', component: 'Pane', requestId: 'manager', props: { title: 'Mods', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } } as never)
  await (ui as unknown as { pointer(e: object): Promise<unknown> }).pointer({ in: 'list-dir', type: 'down', button: 'left', x: 12, y: 0 })

  const tab = JSON.stringify(await ui.drawn({ in: 'manager-page' }))
  expect(tab).toContain(own)
  expect(tab).not.toContain(generic)
  const about = JSON.stringify(await ui.find({ key: 'page-about-edge' }))
  expect(about).toContain(own)
  expect(about).not.toContain(generic)
  await ui.unmount()
})

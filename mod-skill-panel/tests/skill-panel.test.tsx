// mod-skill-panel / tests/skill-panel.test.tsx, by v-amorim
// Tests skill tags and grouping, agents tab, command toggle, settings pill, tips and waiting card.
import { expect, mock, test, type TestBody } from 'claude-code/testing'

import { lookFor } from '../hooks/look'
import style from '../hooks/style'
import { decodeAll, MARK, THEME } from '../hooks/theme'
import { groupSkills, markDescription, paintsDescriptions, readFrontmatter, swatchFor } from '../hooks/tags'

type Pointer = { pointer: (event: object) => Promise<unknown> }
// The host types leave `pointer` off a mounted UI.
const pointing = <T extends object>(ui: T) => ui as T & Pointer

// A drive path the engine took for relative comes back with the plugin's folder in front, so the fixtures read it from the drive letter on.
const neutral = (path: string) => path.replace(/\\/g, '/').replace(/^.*?(?=[A-Za-z]:\/)/, '').replace(/^[A-Za-z]:/, '')

const FILES: Record<string, string> = {
  '/h/.claude/skills/plain/SKILL.md': '---\nname: plain\ndescription: x\n---\nbody',
  '/h/.claude/skills/rev/SKILL.md': '---\nname: rev\ncolor-tag: Review\n---\nbody',
  '/h/.claude/skills/secret/SKILL.md': '---\nname: secret\ndescription: hidden one\ndisable-model-invocation: true\n---\nbody',
  '/h/.claude/agents/finder.md': '---\nname: finder\ndescription: Finds things\nmodel: haiku\ntools: Read, Grep\n---\nbody',
  '/h/.claude/agents/helper.md': '---\nname: helper\ndescription: Helps\n---\nbody',
}

type On = Parameters<TestBody>[1]

const stubSkills = (on: On) => {
  on('env.get', (_$, e) => ({ value: e.name === 'USERPROFILE' ? '/h' : undefined }))
  on('fs.list', (_$, e) => ({
    value: neutral(e.path).endsWith('/agents') ? [
      { name: 'finder.md', kind: 'file', size: 0, mtimeMs: 0, isLink: false },
      { name: 'helper.md', kind: 'file', size: 0, mtimeMs: 0, isLink: false },
    ] : neutral(e.path).endsWith('/mods') ? [{ name: 'mod-manager', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] : [
      { name: 'plain', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
      { name: 'rev', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
      { name: 'secret', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
      { name: 'README.md', kind: 'file', size: 0, mtimeMs: 0, isLink: false },
    ],
  }))
  on('fs.read', (_$, e) => {
    const path = neutral(e.path)
    if (!(path in FILES)) throw new Error('ENOENT')
    return { value: FILES[path]! }
  })
}

const stubSession = (on: On) => {
  on('session.start', () => ({ cwd: '/h' }))
  on('command.register', () => ({ value: { command: 'mod-skill-panel' } }))
  on('ui.panes', () => ({ value: [] }))
}

test('tags: default personal, explicit tag, unknown fallback, malformed skipped', () => {
  expect(readFrontmatter(FILES['/h/.claude/skills/plain/SKILL.md']!)).toEqual({ name: 'plain', tag: 'personal', description: 'x', hidden: false })
  expect(readFrontmatter('---\r\nname: "quoted"\r\ncolor-tag: tool \r\n---\r\n')).toEqual({ name: 'quoted', tag: 'tool', hidden: false })
  expect(readFrontmatter('no frontmatter here')).toBeNull()
  expect(readFrontmatter(FILES['/h/.claude/skills/secret/SKILL.md']!)?.hidden).toBe(true)
  // Slash-only: the model may not call it, but the person types it, so the panel still lists it.
  expect(readFrontmatter('---\nname: sync\ndisable-model-invocation: true\nuser-invocable: true\n---\n')?.hidden).toBe(false)
  expect(swatchFor('nope')).toEqual(swatchFor('personal'))
  const plain = markDescription('Does X', 'review', { nerd: false, colored: false })
  expect(plain.startsWith('[∴ review]')).toBe(true)
  expect(plain).not.toContain('\x1b')
  expect(plain.endsWith(' Does X')).toBe(true)
  const pill = markDescription('Does X', 'review', { nerd: false, colored: true })
  // The neutral Badge: surface-3 fill, the tag's hue only in the dot, the name muted.
  expect(pill).toContain('\x1b[48;2;37;42;66m\x1b[38;2;209;168;255m ●\x1b[38;2;155;163;196m review ')
  expect(pill.endsWith(' Does X')).toBe(true)
  expect(markDescription('Does X', 'review', { nerd: true, colored: true })).toContain(String.fromCodePoint(0xe0b6))})

test('the pill draws up to the last release seen coloring the typeahead, the plain badge after it or when unknown', () => {
  expect(paintsDescriptions('2.1.289')).toBe(true)
  expect(paintsDescriptions('2.1.288')).toBe(true)
  expect(paintsDescriptions('2.0.999')).toBe(true)
  expect(paintsDescriptions('2.1.290')).toBe(false)
  expect(paintsDescriptions('2.1.312')).toBe(false)
  expect(paintsDescriptions('3.0.0')).toBe(false)
  expect(paintsDescriptions('2.1.289-dev.20260920.t101500.sha1a2b3c4')).toBe(true)
  expect(paintsDescriptions(undefined)).toBe(false)
  expect(paintsDescriptions('nightly')).toBe(false)
})

test('describe marks personal skills and leaves other commands alone', async ($, on) => {
  stubSkills(on)
  on('command.describe', (_$, e) => ({ description: e.description, argumentHint: e.argumentHint, isHidden: e.isHidden }))
  stubSession(on)
  on('ui.invalidate', () => ({ value: undefined }))

  await $.session.start({ cwd: '/h' } as never)

  const describe = (command: string, plugin = 'engine') =>
    $.command.describe({
      command,
      description: 'Does X',
      isHidden: false,
      immediate: false,
      provider: { plugin, tier: plugin === 'engine' ? 'core' : 'user' },
    } as never)

  expect((await describe('mod-manager', 'mod-manager')).description).toMatch(/^\[\+ mods\]/)
  expect((await describe('mod-manager', 'mod-manager@inline')).description).toMatch(/^\[\+ mods\]/)
  // Installed from the marketplace, a mod has no folder under ~/.claude/mods.
  expect((await describe('mod-wrap-up', 'mod-wrap-up@claude-mods')).description).toMatch(/^\[\+ mods\]/)
  expect((await describe('other', 'someone-elses-plugin')).description).toBe('Does X')

  expect((await describe('plain')).description).toMatch(/^\[● personal\]/)
  expect((await describe('rev')).description).toMatch(/^\[∴ review\]/)
  expect((await describe('help')).description).toBe('Does X')
})

test('groups: fixed tag order, untagged last, names sorted, unknown tags fold into untagged', () => {
  const groups = groupSkills([
    { name: 'zeta', tag: 'personal', description: '', hidden: false },
    { name: 'tidy', tag: 'writing', description: '', hidden: false },
    { name: 'execute', tag: 'router', description: '', hidden: false },
    { name: 'deliver', tag: 'router', description: '', hidden: false },
    { name: 'odd', tag: 'nonsense', description: '', hidden: false },
  ])
  expect(groups.map(group => group.tag)).toEqual(['router', 'writing', 'personal'])
  expect(groups[0]!.skills.map(skill => skill.name)).toEqual(['deliver', 'execute'])
  expect(groups[2]!.skills.map(skill => skill.name)).toEqual(['odd', 'zeta'])
})

test('panel lists skill groups and a press fills the prompt', async ($, on) => {
  stubSkills(on)
  stubSession(on)
  let box = 'please '
  on('prompt.read', () => ({ value: { text: box, cursor: box.length } }))
  on('prompt.fill', (_$, e) => {
    box = e.mode === 'append' ? box + e.text : e.text
    return { isFilled: true }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })

  await $.session.start({ cwd: '/h' } as never)
  await $.command.run({ command: 'mod-skill-panel' } as never)

  const ui = await $.ui.mount({
    plugin: 'mod-skill-panel',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'skill-panel',
    props: { title: 'Skills', isFocused: true, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  } as never)

  const tab = JSON.stringify(await ui.drawn({ in: 'skills-tab' }))
  expect(tab).toContain(' Skills ')
  expect(tab).toContain('2')

  // One row per tag: its pill, then its chips; the card shows the first skill.
  const cloud = JSON.stringify(await ui.drawn({ in: 'skills-cloud' }))
  expect(cloud).toContain(`"children":["${MARK.stopOpen}"]`)
  expect(cloud).toContain('" review"')
  expect(cloud).toContain('rev')
  expect(cloud).toContain('plain')
  expect(await ui.find({ type: 'Text', text: '/rev' })).toBeDefined()

  // Row 1 is the rule between the groups; nothing on it reacts.
  await pointing(ui).pointer({ in: 'skills-cloud', type: 'down', button: 'left', x: 16, y: 1 })
  expect(box).toBe('please ')
  expect(JSON.stringify(await ui.drawn({ in: 'skills-cloud' }))).toContain('─')

  expect(await ui.find({ key: 'card-edge' })).toBeDefined()
  expect(await ui.find({ key: 'card-icon' })).toBeUndefined()
  // Pointing at a chip shows it in the card and adds nothing.
  await pointing(ui).pointer({ in: 'skills-cloud', type: 'move', x: 16, y: 2 })
  expect(await ui.find({ type: 'Text', text: '/plain' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'x' })).toBeDefined()
  expect(box).toBe('please ')

  // A click on a chip adds it; a repeat is skipped.
  await pointing(ui).pointer({ in: 'skills-cloud', type: 'down', button: 'left', x: 16, y: 0 })
  await pointing(ui).pointer({ in: 'skills-cloud', type: 'down', button: 'left', x: 16, y: 2 })
  await pointing(ui).pointer({ in: 'skills-cloud', type: 'down', button: 'left', x: 16, y: 0 })
  expect(box).toBe('please /rev /plain ')
  await ui.unmount()
})

test('the agents tab groups agents by model and a click mentions one in the prompt', async ($, on) => {
  stubSkills(on)
  stubSession(on)
  let box = ''
  on('prompt.read', () => ({ value: { text: box, cursor: box.length } }))
  on('prompt.fill', (_$, e) => {
    box = e.mode === 'append' ? box + e.text : e.text
    return { isFilled: true }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('state.set', () => ({ value: undefined }) as never)

  await $.session.start({ cwd: '/h' } as never)
  const ui = await $.ui.mount({ plugin: 'mod-skill-panel', surface: 'terminal', component: 'Pane', requestId: 'skill-panel', props: { title: 'Skills', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } } as never)
  expect(JSON.stringify(await ui.drawn({ in: 'skills-agents' }))).toContain('2')
  await pointing(ui).pointer({ in: 'skills-agents', type: 'down', button: 'left', x: 1, y: 0 })

  // haiku before inherit; an agent without a model is "inherit", one without tools gets every tool.
  const cloud = JSON.stringify(await ui.drawn({ in: 'agents-cloud' }))
  expect(cloud.indexOf('haiku')).toBeLessThan(cloud.indexOf('inherit'))
  expect(await ui.find({ type: 'Text', text: '@agent-finder' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '· 2 tools' })).toBeDefined()

  await pointing(ui).pointer({ in: 'agents-cloud', type: 'down', button: 'left', x: 16, y: 2 })
  expect(box).toBe('@agent-helper ')
  await ui.unmount()
})

test("the agents tab adds the project's agents, which win over a same-named one of the person's", async ($, on) => {
  const files: Record<string, string> = {
    ...FILES,
    '/p/.claude/agents/finder.md': '---\nname: finder\ndescription: The project finder\nmodel: sonnet\n---\nbody',
    '/p/.claude/agents/local.md': '---\nname: local\ndescription: Only here\n---\nbody',
  }
  const file = (name: string) => ({ name, kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false })
  on('env.get', (_$, e) => ({ value: e.name === 'USERPROFILE' ? '/h' : undefined }))
  on('fs.list', (_$, e) => {
    const path = neutral(e.path)
    if (path === '/h/.claude/agents') return { value: [file('finder.md'), file('helper.md')] }
    if (path === '/p/.claude/agents') return { value: [file('finder.md'), file('local.md')] }
    return { value: [] }
  })
  on('fs.read', (_$, e) => {
    const path = neutral(e.path)
    if (!(path in files)) throw new Error('ENOENT')
    return { value: files[path]! }
  })
  stubSession(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('state.set', () => ({ value: undefined }) as never)

  await $.session.start({ cwd: 'C:\\p' } as never)
  const ui = await $.ui.mount({ plugin: 'mod-skill-panel', surface: 'terminal', component: 'Pane', requestId: 'skill-panel', props: { title: 'Skills', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } } as never)
  expect(JSON.stringify(await ui.drawn({ in: 'skills-agents' }))).toContain('3')
  await pointing(ui).pointer({ in: 'skills-agents', type: 'down', button: 'left', x: 1, y: 0 })
  const cloud = JSON.stringify(await ui.drawn({ in: 'agents-cloud' }))
  expect(cloud).toContain('local')
  expect(cloud).toContain('sonnet')
  expect(cloud).not.toContain('haiku')
  await ui.unmount()
})

const readPaths = async ($: Parameters<TestBody>[0], on: On, config: string | undefined) => {
  const listed: string[] = []
  const dir = (name: string) => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })
  on('env.get', (_$, e) => ({ value: e.name === 'USERPROFILE' ? '/h' : e.name === 'CLAUDE_CONFIG_DIR' ? config : undefined }))
  on('fs.list', (_$, e) => {
    listed.push(neutral(e.path))
    return { value: neutral(e.path).endsWith('/skills') ? [dir('cfgskill')] : [] }
  })
  on('fs.read', () => ({ value: '---\nname: cfgskill\ndescription: x\n---\nbody' }))
  stubSession(on)
  await $.session.start({ cwd: 'C:\\p' } as never)
  return listed
}

test('with CLAUDE_CONFIG_DIR set, skills, agents and mods are read under it and not under ~/.claude', async ($, on) => {
  const listed = await readPaths($, on, '/cfg')
  expect(listed).toContain('/cfg/skills')
  expect(listed).toContain('/cfg/agents')
  expect(listed).toContain('/cfg/mods')
  expect(listed.some(path => path.startsWith('/h/'))).toBe(false)
  // The project's own agents stay where the project keeps them.
  expect(listed).toContain('/p/.claude/agents')
})

test('without CLAUDE_CONFIG_DIR, skills, agents and mods are read under ~/.claude', async ($, on) => {
  const listed = await readPaths($, on, undefined)
  expect(listed).toEqual(['/h/.claude/skills', '/p/.claude/skills', '/h/.claude/agents', '/p/.claude/agents', '/h/.claude/mods'])
})

test("the skills list adds the project's skills, which win over a same-named one of the person's", async ($, on) => {
  const files: Record<string, string> = {
    '/h/.claude/skills/same/SKILL.md': '---\nname: same\ndescription: Personal one\n---\n',
    '/p/.claude/skills/same/SKILL.md': '---\nname: same\ndescription: Project one\n---\n',
    '/p/.claude/skills/only/SKILL.md': '---\nname: only\ndescription: Only here\n---\n',
  }
  const dir = (name: string) => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })
  on('env.get', (_$, e) => ({ value: e.name === 'USERPROFILE' ? '/h' : undefined }))
  on('fs.list', (_$, e) => {
    const path = neutral(e.path)
    if (path === '/h/.claude/skills') return { value: [dir('same')] }
    if (path === '/p/.claude/skills') return { value: [dir('same'), dir('only')] }
    return { value: [] }
  })
  on('fs.read', (_$, e) => {
    const path = neutral(e.path)
    if (!(path in files)) throw new Error('ENOENT')
    return { value: files[path]! }
  })
  stubSession(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('state.set', () => ({ value: undefined }) as never)

  await $.session.start({ cwd: 'C:\\p' } as never)
  const ui = await $.ui.mount({ plugin: 'mod-skill-panel', surface: 'terminal', component: 'Pane', requestId: 'skill-panel', props: { title: 'Skills', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } } as never)
  const cloud = JSON.stringify(await ui.drawn({ in: 'skills-cloud' }))
  expect(cloud).toContain('only')
  expect(cloud.match(/same/g)).toHaveLength(1)
  await ui.unmount()
})

test('with no agents the panel names the folders it checked, under the config dir when set', async ($, on) => {
  const dir = (name: string) => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })
  on('env.get', (_$, e) => ({ value: e.name === 'USERPROFILE' ? '/h' : e.name === 'CLAUDE_CONFIG_DIR' ? '/cfg' : undefined }))
  on('fs.list', () => ({ value: [dir('x')].slice(1) }))
  on('fs.read', () => ({ value: '' }))
  stubSession(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('state.set', () => ({ value: undefined }) as never)

  await $.session.start({ cwd: 'C:\\p' } as never)
  const ui = await $.ui.mount({ plugin: 'mod-skill-panel', surface: 'terminal', component: 'Pane', requestId: 'skill-panel', props: { title: 'Skills', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } } as never)
  await pointing(ui).pointer({ in: 'skills-agents', type: 'down', button: 'left', x: 1, y: 0 })
  expect(await ui.find({ type: 'Text', text: 'No agents in /cfg/agents or C:/p/.claude/agents yet.' })).toBeDefined()
  await ui.unmount()
})

test('with no skills the Skills tab says how to add one', async ($, on) => {
  on('env.get', (_$, e) => ({ value: e.name === 'USERPROFILE' ? '/h' : undefined }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', () => ({ value: '' }))
  stubSession(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('state.set', () => ({ value: undefined }) as never)

  await $.session.start({ cwd: 'C:\\p' } as never)
  const ui = await $.ui.mount({ plugin: 'mod-skill-panel', surface: 'terminal', component: 'Pane', requestId: 'skill-panel', props: { title: 'Skills', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } } as never)
  expect(await ui.find({ type: 'Text', text: 'No skills yet. Add one at ~/.claude/skills/<name>/SKILL.md' })).toBeDefined()
  expect(await ui.find({ type: 'Client', key: 'skills-cloud' })).toBeUndefined()
  await ui.unmount()
})

test('the command toggles: it opens a closed pane and closes an open one', async ($, on) => {
  let open: string[] = []
  const calls: string[] = []
  on('ui.panes', () => ({ value: open.map(id => ({ id, isPlaced: true })) as never }))
  on('ui.open', (_$, e) => {
    calls.push(`open ${e.id}`)
    open = [e.id]
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_$, e) => {
    calls.push(`close ${e.id}`)
    open = []
    return { value: undefined } as never
  })

  await $.command.run({ command: 'mod-skill-panel' } as never)
  await $.command.run({ command: 'mod-skill-panel' } as never)
  expect(calls).toEqual(['open skill-panel', 'close skill-panel'])
})

const skillsPane = async ($: any, on: any) => {
  stubSkills(on)
  on('ui.panes', () => ({ value: [] }))
  return $.ui.mount({ plugin: 'mod-skill-panel', surface: 'terminal', component: 'Pane', requestId: 'skill-panel', props: { title: 'Skills', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } } as never)
}

test('icons=nerd draws the settings pill with the Nerd gear', { options: { icons: 'nerd' } }, async ($, on) => {
  const ui = await skillsPane($, on)
  expect(JSON.stringify(await ui.drawn({ in: 'skills-settings' }))).toContain(String.fromCodePoint(0xf0493))
  await ui.unmount()
})

test('icons=safe draws the settings pill with the plain gear', { options: { icons: 'safe' } }, async ($, on) => {
  const ui = await skillsPane($, on)
  const pill = JSON.stringify(await ui.drawn({ in: 'skills-settings' }))
  expect(pill).toContain('⊛')
  expect(pill).not.toContain(String.fromCodePoint(0xf0493))
  await ui.unmount()
})

test('the title tabs swap the sidebar and its settings, and a settings pill saves its value', async ($, on) => {
  stubSkills(on)
  let open: string[] = []
  const calls: string[] = []
  on('ui.panes', () => ({ value: open.map(id => ({ id, isPlaced: true })) as never }))
  on('ui.open', (_$, e) => {
    calls.push(`open ${e.id}`)
    open = [e.id]
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_$, e) => {
    calls.push(`close ${e.id}`)
    open = open.filter(id => id !== e.id)
    return { value: undefined } as never
  })
  on('config.list', () => ({ value: [{ key: 'mod-skill-panel.animations', label: 'Animations', kind: 'boolean', value: true, description: 'd' }] }) as never)
  const saved: unknown[] = []
  on('config.set', (_$, e) => {
    saved.push([e.key, e.value])
    return { value: e.value } as never
  })
  const pane = (requestId: string) =>
    ({ plugin: 'mod-skill-panel', surface: 'terminal', component: 'Pane', requestId, props: { title: 'Skills', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } }) as never

  await $.command.run({ command: 'mod-skill-panel' } as never)
  const ui = await $.ui.mount(pane('skill-panel'))
  // The open tab does nothing.
  await pointing(ui).pointer({ in: 'skills-tab', type: 'down', button: 'left', x: 1, y: 0 })
  expect(calls).toEqual(['open skill-panel'])
  await pointing(ui).pointer({ in: 'skills-settings', type: 'down', button: 'left', x: 1, y: 0 })
  expect(calls).toEqual(['open skill-panel', 'close skill-panel', 'open skill-panel-settings'])
  await ui.unmount()

  const settings = await $.ui.mount(pane('skill-panel-settings'))
  expect(await settings.find({ type: 'Text', text: 'Animations' })).toBeDefined()
  await pointing(settings).pointer({ in: 'setting-0-flip', type: 'down', button: 'left', x: 1, y: 0 })
  expect(saved).toEqual([['mod-skill-panel.animations', false]])
  await pointing(settings).pointer({ in: 'skills-tab', type: 'down', button: 'left', x: 1, y: 0 })
  expect(calls.slice(-2)).toEqual(['close skill-panel-settings', 'open skill-panel'])
  await settings.unmount()
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
    return { value: undefined } as never
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
    plugin: 'mod-skill-panel',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 80, scroll: { offset: 0, bodyRows: 6 }, view: {} },
  } as const

  const idle = await $.ui.mount(band)
  expect(await idle.find({ type: 'Text', text: 'other mod' })).toBeDefined()
  await pointing(idle).pointer({ type: 'move', x: 1, y: 0, in: 'menu-entry-skills' })
  expect(await idle.find({ type: 'Text', text: 'Skills:', bold: true } as never)).toBeDefined()
  expect(await idle.find({ type: 'Text', text: /^ browse your skills/ })).toBeDefined()
  await pointing(idle).pointer({ type: 'leave', x: 0, y: 0, in: 'menu-entry-skills' })
  expect(await idle.find({ type: 'Text', text: 'Skills:' })).toBeUndefined()
  await pointing(idle).pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'menu-entry-skills' })
  expect(opened).toEqual(['skill-panel'])
  await idle.unmount()

  const busy = await $.ui.mount(band)
  await pointing(busy).pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'menu-entry-skills' })
  expect(opened).toEqual(['skill-panel', 'close skill-panel'])
  await busy.unmount()
})

test('a pane that waits says why in a wrapped card above the row, not in Claude Code toast box', async ($, on) => {
  const engineToasts: string[] = []
  on('fs.read', () => {
    throw new Error('ENOENT')
  })
  on('env.get', () => ({ value: '/h' }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'unasked below 144 columns (99 now)' } }))
  on('ui.toast', (_$, e) => {
    engineToasts.push(e.text)
    return { value: undefined }
  })
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>other mod</Text>
  })
  const clock = mock.clock(on)
  const band = await $.ui.mount({
    plugin: 'mod-skill-panel',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 80, scroll: { offset: 0, bodyRows: 12 }, view: {} },
  })

  await pointing(band).pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'menu-entry-skills' })
  expect(await band.find({ type: 'Text', text: 'Skills panel waiting' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /unasked below 144 columns \(99 now\)/ })).toBeDefined()
  expect(engineToasts).toEqual([])
  // Hovering the × leaves the card; a click on it dismisses.
  await pointing(band).pointer({ type: 'move', x: 0, y: 0, in: 'toast-skills-1' })
  expect(await band.find({ type: 'Text', text: 'Dismiss:' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /^Skills panel waiting/ })).toBeDefined()
  await pointing(band).pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'toast-skills-1' })
  expect(await band.find({ type: 'Text', text: /^Skills panel waiting/ })).toBeUndefined()

  // A second one leaves on its own after the timeout.
  await pointing(band).pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'menu-entry-skills' })
  expect(await band.find({ type: 'Text', text: /^Skills panel waiting/ })).toBeDefined()
  await clock.advance(4000)
  expect(await band.find({ type: 'Text', text: /^Skills panel waiting/ })).toBeUndefined()
  await band.unmount()
})

test('its entry shimmers from the click until the pane draws', async ($, on) => {
  const opened: string[] = []
  on('fs.read', () => {
    throw new Error('ENOENT')
  })
  on('fs.list', () => ({ value: [] }))
  on('env.get', () => ({ value: '/h' }))
  on('ui.panes', () => ({ value: opened.map(id => ({ id, isPlaced: true })) as never }))
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>other mod</Text>
  })
  const clock = mock.clock(on)
  const band = await $.ui.mount({
    plugin: 'mod-skill-panel',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 80, scroll: { offset: 0, bodyRows: 6 }, view: {} },
  })
  // At rest the label is one Text; shimmering, each character is its own Text in the wave's colors.
  const letters = async () => JSON.stringify(await band.drawn({ in: 'menu-entry-skills' })).split('"type":"Text"').length - 1
  expect(await letters()).toBe(1)

  await pointing(band).pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'menu-entry-skills' })
  expect(await letters()).toBe(' Skills '.length)

  const pane = await $.ui.mount({ plugin: 'mod-skill-panel', surface: 'terminal', component: 'Pane', requestId: 'skill-panel', props: { scroll: { offset: 0, bodyRows: 20 }, bodyColumns: 60 } } as never)
  await clock.advance(1500)
  expect(await letters()).toBe(1)
  await pane.unmount()
  await band.unmount()
})

test('its entry joins the row another panel opened, above the hint line', async ($, on) => {
  on('ui.panes', () => ({ value: [] }))
  on('ui.render', () => ({
    type: 'Box',
    props: { key: 'menu-rows', flexDirection: 'column' },
    children: [
      { type: 'Box', props: { key: 'menu-row', flexDirection: 'row' }, children: [{ type: 'Text', props: {}, children: ['Mods'] }] },
      { type: 'Text', props: {}, children: ['? for shortcuts'] },
    ],
  }) as never)

  const ui = await $.ui.mount({
    plugin: 'mod-skill-panel',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 80, scroll: { offset: 0, bodyRows: 6 }, view: {} },
  } as never)
  const tree = (await ui.drawn()) as { children: { children: unknown[] }[] }
  // The hint, the tip row (kept while empty) and the pill row.
  expect(tree.children.length).toBe(3)
  expect(JSON.stringify(tree.children[2])).toMatch(/Skills.*Mods/)
  expect(JSON.stringify(tree.children[0])).toContain('? for shortcuts')
  await ui.unmount()
})

test('a hovered tab or chip puts its tip in the pane footer, and leaving clears it', async ($, on) => {
  on('session.start', () => ({ cwd: '/h' }))
  on('command.register', () => ({ value: { command: 'mod-skill-panel' } }))
  on('state.set', () => ({ value: undefined }) as never)
  const ui = await skillsPane($, on)
  await $.session.start({ cwd: '/h' } as never)
  expect(await ui.find({ type: 'Text', text: /^ · / })).toBeUndefined()
  await ui.pointer({ in: 'skills-agents', type: 'move', x: 1, y: 0 })
  expect(await ui.find({ type: 'Text', text: ' · lists your agents' })).toBeDefined()
  await ui.pointer({ in: 'skills-agents', type: 'leave', x: 0, y: 0 })
  expect(await ui.find({ type: 'Text', text: / · lists/ })).toBeUndefined()
  await ui.pointer({ in: 'skills-cloud', type: 'move', x: 16, y: 2 })
  expect(await ui.find({ type: 'Text', text: ' · adds /plain to the prompt' })).toBeDefined()
  await ui.unmount()
})

const ready = async ($: any, on: any) => {
  on('session.start', () => ({ cwd: '/h' }))
  on('command.register', () => ({ value: { command: 'mod-skill-panel' } }))
  on('state.set', () => ({ value: undefined }) as never)
  const ui = pointing(await skillsPane($, on))
  await $.session.start({ cwd: '/h' } as never)
  return ui
}

const withPrompt = (on: any) => {
  let box = ''
  on('prompt.read', () => ({ value: { text: box, cursor: box.length } }))
  on('prompt.fill', (_$: unknown, e: { mode: string; text: string }) => {
    box = e.mode === 'append' ? box + e.text : e.text
    return { isFilled: true }
  })
}

test('a hovered chip lifts and turns accent; once the pointer leaves, only the selected chip stays accent and bold', { options: { animations: false } }, async ($, on) => {
  on('session.start', () => ({ cwd: '/h' }))
  on('command.register', () => ({ value: { command: 'mod-skill-panel' } }))
  const ui = pointing(await skillsPane($, on))
  await $.session.start({ cwd: '/h' } as never)
  expect(JSON.stringify(await ui.drawn({ in: 'skills-cloud' }))).not.toContain(THEME.lifted)
  await ui.pointer({ in: 'skills-cloud', type: 'move', x: 16, y: 2 })
  const hover = JSON.stringify(await ui.drawn({ in: 'skills-cloud' }))
  expect(hover).toContain(THEME.lifted)
  await ui.pointer({ in: 'skills-cloud', type: 'leave', x: 0, y: 0 })
  const rest = JSON.stringify(await ui.drawn({ in: 'skills-cloud' }))
  expect(rest).not.toContain(THEME.lifted)
  expect(rest).toContain(`"color":"${THEME.accent}","bold":true},"children":["plain"`)
  expect(rest).toContain(`"bold":false},"children":["rev"`)
  await ui.unmount()
})

test('a tag pill lights on hover and its tip reaches the footer', { options: { animations: false } }, async ($, on) => {
  on('session.start', () => ({ cwd: '/h' }))
  on('command.register', () => ({ value: { command: 'mod-skill-panel' } }))
  const ui = pointing(await skillsPane($, on))
  await $.session.start({ cwd: '/h' } as never)
  await ui.pointer({ in: 'skills-cloud', type: 'move', x: 5, y: 0 })
  expect(JSON.stringify(await ui.drawn({ in: 'skills-cloud' }))).toContain(THEME.lifted)
  expect(await ui.find({ type: 'Text', text: ' · 1 in this group' })).toBeDefined()
  await ui.pointer({ in: 'skills-cloud', type: 'leave', x: 0, y: 0 })
  expect(await ui.find({ type: 'Text', text: ' · 1 in this group' })).toBeUndefined()
  await ui.unmount()
})

test('on Nerd a tag pill is a capped neutral badge led by its hue dot, with no icon subpill', { options: { icons: 'nerd' } }, async ($, on) => {
  const ui = await ready($, on)
  const drawn = JSON.stringify(await ui.drawn({ in: 'skills-cloud' }))
  expect(drawn).not.toContain(`"key":"tag-0-icon"`)
  expect(drawn).toContain(String.fromCodePoint(0xe0b6))
  expect(drawn).toContain(`"children":["${MARK.stopOpen}"]`)
  expect(drawn).toContain(`"backgroundColor":"${THEME.surface3}"`)
  await ui.unmount()
})

test('the group rule is drawn in the border color', async ($, on) => {
  const ui = await ready($, on)
  expect(JSON.stringify(await ui.drawn({ in: 'skills-cloud' }))).toContain(`"color":"${THEME.border}"},"children":["──`)
  await ui.unmount()
})

test('the skills status line draws the Nerd mark after a click, like the settings pane', { options: { icons: 'nerd' } }, async ($, on) => {
  withPrompt(on)
  const ui = await ready($, on)
  await ui.pointer({ in: 'skills-cloud', type: 'down', button: 'left', x: 16, y: 0 })
  expect(await ui.find({ type: 'Text', text: `${lookFor(true).glyph.ok} Added /rev` })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: `${MARK.ok} Added /rev` })).toBeUndefined()
  await ui.unmount()
})

test('a band tip whose entry was redrawn while hovered clears after 5 s with no newer hover', async ($, on) => {
  on('ui.panes', () => ({ value: [] }))
  on('ui.render', ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>other mod</Text>
  })
  const clock = mock.clock(on)
  const band = { plugin: 'mod-skill-panel', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 80, scroll: { offset: 0, bodyRows: 6 }, view: {} } } as const
  // Live, a band redraw mid-turn replaced the hovered entry, so its own quiet timer, and the leave, never came.
  const first = await $.ui.mount(band)
  await pointing(first).pointer({ type: 'move', x: 1, y: 0, in: 'menu-entry-skills' })
  await first.unmount()
  // The pill's tip text also sits in the Client props, so only the tip row's Text says whether it shows.
  const showsNow = async () => {
    const ui = await $.ui.mount(band)
    const shown = (await ui.find({ type: 'Text', text: /^ browse your skills/ })) !== undefined
    await ui.unmount()
    return shown
  }
  expect(await showsNow()).toBe(true)
  await clock.advance(4000)
  expect(await showsNow()).toBe(true)
  await clock.advance(1000)
  expect(await showsNow()).toBe(false)
})

test('both panes paint the root bg and keep the footer space from shrinking', async ($, on) => {
  on('config.list', () => ({ value: [] }))
  const ui = await skillsPane($, on)
  expect((await ui.find({ key: 'footer-space' }))?.props.flexShrink).toBe(0)
  expect(JSON.stringify(await ui.drawn())).toContain(`"backgroundColor":"${THEME.bg}"`)
  await ui.unmount()
  const settings = await $.ui.mount({ plugin: 'mod-skill-panel', surface: 'terminal', component: 'Pane', requestId: 'skill-panel-settings', props: { title: 'Settings', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } } as never)
  expect((await settings.find({ key: 'footer-space' }))?.props.flexShrink).toBe(0)
  expect(JSON.stringify(await settings.drawn())).toContain(`"backgroundColor":"${THEME.bg}"`)
  await settings.unmount()
})

test('the menu entry drops its label when mod-menu says labels never, on Nerd only', { options: { icons: 'nerd' } }, async ($, on) => {
  on('ui.panes', () => ({ value: [] }))
  on('state.get', (_$: unknown, e: { key: string }) => ({ value: { value: e.key === 'labels' ? 'never' : undefined } }) as never)
  on('ui.render', ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>other mod</Text>
  })
  const band = { plugin: 'mod-skill-panel', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 80, scroll: { offset: 0, bodyRows: 6 }, view: {} } } as const
  const ui = await $.ui.mount(band as never)
  const entry = JSON.stringify(await ui.drawn({ in: 'menu-entry-skills' }))
  expect(entry).not.toContain('Skills')
  expect(entry).toContain(decodeAll((style.glyphs.nerd.icon as Record<string, string>)['menu-skills']!))
  await ui.unmount()
})

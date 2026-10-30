// mod-prompts / tests/prompts.test.tsx, by v-amorim
// Tests prompt extraction, timeline paging, jump targets, settings tabs, icon modes and prompt cards.
import { expect, mock, test } from 'claude-code/testing'

import { parseRow, promptsOf, targetOf } from '../hooks/prompts'
import { THEME } from '../hooks/theme'

const pointer = (ui: object, event: object) => (ui as { pointer: (event: object) => Promise<void> }).pointer(event)
const ID = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`
const user = (n: number, parent: number | null, content: unknown, extra: object = {}) =>
  JSON.stringify({ type: 'user', uuid: ID(n), parentUuid: parent === null ? null : ID(parent), timestamp: '2026-10-03T11:58:00Z', message: { role: 'user', content }, ...extra })
const reply = (n: number, parent: number) => JSON.stringify({ type: 'assistant', uuid: ID(n), parentUuid: ID(parent), message: { role: 'assistant', content: [] } })

// One kept prompt, a rewound one, a slash command, a tool result, a hook wrapper, a queued prompt and a second kept prompt.
const TRANSCRIPT = [
  user(1, null, 'first prompt'),
  reply(2, 1),
  user(3, 2, 'abandoned by rewind'),
  user(4, 2, '/mod-menu'),
  reply(5, 4),
  user(6, 5, [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }]),
  user(7, 6, '<system-reminder>noise</system-reminder>'),
  JSON.stringify({ type: 'attachment', uuid: ID(8), parentUuid: ID(7), attachment: { type: 'queued_command', prompt: 'typed mid turn' } }),
  user(9, 8, [{ type: 'text', text: 'second prompt' }]),
  // The second prompt's turn: two tool calls, an edit that changed three lines, a failed write, and its length.
  JSON.stringify({ type: 'assistant', uuid: ID(10), parentUuid: ID(9), message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a' }, { type: 'tool_use', id: 'b' }] } }),
  user(11, 10, [{ type: 'tool_result', tool_use_id: 'a', content: 'ok' }], { toolUseResult: { type: 'update', structuredPatch: [{ lines: [' same', '+new', '+newer', '-old'] }] } }),
  user(12, 11, [{ type: 'tool_result', tool_use_id: 'b', content: 'denied', is_error: true }], { toolUseResult: { type: 'create', content: 'a\nb\nc' } }),
  JSON.stringify({ type: 'system', subtype: 'turn_duration', durationMs: 23400, uuid: ID(13), parentUuid: ID(12) }),
  '{"torn',
].join('\n')

test('prompts are the live branch, without commands, tool results, wrappers or rewound rows', () => {
  const rows = TRANSCRIPT.split('\n').flatMap(line => parseRow(line) ?? [])
  expect(promptsOf(rows).map(prompt => prompt.text)).toEqual(['first prompt', 'typed mid turn', 'second prompt'])
  expect(promptsOf(rows)[0]!.id).toBe(ID(1))
  // The failed write counts no lines.
  expect(promptsOf(rows)[2]).toMatchObject({ tools: 2, added: 2, removed: 1, durationMs: 23400 })
})

test('the timeline lists prompts and the turn of the open one, a click opens a stop, and jump scrolls', async ($, on) => {
  const scrolled: string[] = []
  const spawned: string[] = []
  const neutral = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
  on('session.start', () => ({ cwd: '/w' }))
  on('command.register', () => ({ value: { command: 'mod-prompts' } }))
  on('store.keys', () => ({ value: [] }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: TRANSCRIPT.length, mtimeMs: 0, isLink: false } }))
  on('fs.read', (_$, e) => {
    if (neutral(e.path).endsWith('/bridge/s1.jsonl')) return { value: `${JSON.stringify({ session_id: 's1', transcript_path: '/t/s1.jsonl', hook_event_name: 'SessionStart', source: 'startup' })}\n` }
    spawned.push(neutral(e.path))
    return { value: TRANSCRIPT }
  })
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.focus', () => ({ value: { isFocused: true } } as never))
  on('ui.scroll', (_$, e) => {
    scrolled.push(String((e as { to?: { requestId?: string } }).to?.requestId))
    return { value: {} } as never
  })
  mock.env(on, { USERPROFILE: '/home/u' })
  const clock = mock.clock(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>base</Text>
  })

  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true } as never)
  await clock.advance(250)
  await $.command.run({ command: 'mod-prompts' } as never)

  // Claude Code draws the first prompt's row under a split-row id that keeps the uuid's first four groups.
  const row = await $.ui.mount({ plugin: 'mod-prompts', surface: 'terminal', component: 'UserMessage', requestId: `${ID(1).slice(0, 24)}000000000007`, props: { text: 'first prompt', origin: { kind: 'composer' } } } as never)

  const ui = await $.ui.mount({
    plugin: 'mod-prompts',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'prompts',
    props: { title: 'Prompts', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
  } as never)
  expect(spawned).toEqual(['/t/s1.jsonl'])
  expect(JSON.stringify(await ui.drawn({ in: 'prompts-tab' }))).toContain('3')
  // The last prompt opens first: its stop, then its turn as pills.
  const lineOf = async (stop: number) => JSON.stringify(await ui.drawn({ in: `timeline-${stop}` }))
  expect(await lineOf(2)).toContain(' second prompt')
  expect(await ui.find({ type: 'Text', text: '23s' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '2 tools' })).toBeDefined()
  // The card's number sits in its top edge, not in a row inside it.
  expect(await ui.find({ key: 'card-edge' })).toBeDefined()
  expect(await ui.find({ key: 'card-number' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '#3' })).toBeDefined()
  // A stop shows the clock time its prompt was sent; the queued fixture row has no timestamp, so it shows none.
  const sent = new Date('2026-10-03T11:58:00Z')
  const hhmm = `${String(sent.getHours()).padStart(2, '0')}:${String(sent.getMinutes()).padStart(2, '0')}`
  expect([await lineOf(0), await lineOf(1), await lineOf(2)].join('').split(`${hhmm} `).length - 1).toBe(2)

  // The open row keeps surface-3 and primary-70; every other row's text is muted, never onSurface.
  expect(await lineOf(2)).toContain(`"color":"${THEME.ok}","bold":true`)
  expect(await lineOf(2)).toContain(THEME.surface3)
  for (const rest of [0, 1]) {
    expect(await lineOf(rest)).toContain(`"color":"${THEME.muted}"`)
    expect(await lineOf(rest)).not.toContain(THEME.onSurface)
    expect(await lineOf(rest)).not.toContain(THEME.surface3)
  }
  // A row's ↗ chip is hidden until the pointer is on its row.
  expect(JSON.stringify(await ui.drawn())).toContain('"key":"stop-jump-1-reveal","position":"absolute","top":0,"right":0,"display":"none"},"hover":{"scope":"stop-row-1","display":"flex"}')

  // A hovered stop or tab puts its tip in the pane footer; leaving clears it.
  // The engine lights a row through its row's hover scope, so a leave event lost under the chip cannot leave it lit.
  expect(await lineOf(0)).toContain(`"hover":{"scope":"stop-row-0","backgroundColor":"${THEME.lifted}"}`)
  await pointer(ui, { in: 'timeline-0', type: 'move', x: 8, y: 0 })
  expect(await lineOf(0)).not.toContain(`"props":{"key":"stop-0","flexDirection":"row","backgroundColor":"${THEME.lifted}"`)
  expect(await ui.find({ type: 'Text', text: ' · shows this prompt in full' })).toBeDefined()
  await pointer(ui, { in: 'timeline-0', type: 'leave', x: 0, y: 0 })
  expect(await ui.find({ type: 'Text', text: ' · shows this prompt in full' })).toBeUndefined()
  await pointer(ui, { in: 'prompts-settings', type: 'move', x: 1, y: 0 })
  expect(await ui.find({ type: 'Text', text: ' · opens this mod\'s settings' })).toBeDefined()
  await pointer(ui, { in: 'prompts-settings', type: 'leave', x: 0, y: 0 })

  // A click on a stop opens it, and the stops after it move under its details; the jump Button scrolls.
  await pointer(ui, { in: 'timeline-0', type: 'down', button: 'left', x: 8, y: 0 })
  expect(await lineOf(0)).toContain(' first prompt')
  expect(await lineOf(2)).toContain('second prompt')
  // Safe mode pads the jump glyph inside its pill, since it has no rounded caps.
  expect(await ui.find({ type: 'Button', text: ' ↗ ' })).toBeDefined()
  expect(JSON.stringify(await ui.drawn())).toContain('stop-jump-0-box-rest')
  // The chip shown under the pointer names the jump.
  expect(await ui.find({ type: 'Button', text: ' ↗ Jump ' })).toBeDefined()
  expect(JSON.stringify(await ui.drawn())).toContain('scrolls the transcript to this prompt')
  expect(((await ui.drawn()) as { props: { backgroundColor?: string } }).props.backgroundColor).toBe(THEME.bg)
  await ui.press({ key: 'stop-jump-0' })
  // The kit answers no ui.scroll, so the press shows its refusal; targetOf is checked on its own below.
  expect(await ui.find({ type: 'Text', text: /no implementation for ui.scroll/ })).toBeDefined()
  await ui.unmount()
  await row.unmount()

  // Scrolled down, the card stays at the top of the view.
  const scrolledPane = await $.ui.mount({
    plugin: 'mod-prompts',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'prompts',
    props: { title: 'Prompts', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 12, bodyRows: 20 }, view: {} },
  } as never)
  expect(JSON.stringify(await scrolledPane.drawn())).toContain('"top":12')
  expect(await scrolledPane.find({ type: 'Text', text: 'first prompt' })).toBeDefined()
  await scrolledPane.unmount()

  // A prompt sent later joins the list as its row draws, and the transcript is not read again.
  // The prompt typed mid turn is drawn under an id that is not the file's; drawn again, it stays listed once.
  for (const n of [70, 71]) {
    const redrawn = await $.ui.mount({ plugin: 'mod-prompts', surface: 'terminal', component: 'UserMessage', requestId: ID(n), props: { text: 'typed mid turn', origin: { kind: 'composer' } } } as never)
    await redrawn.unmount()
  }
  const later = await $.ui.mount({ plugin: 'mod-prompts', surface: 'terminal', component: 'UserMessage', requestId: ID(42), props: { text: 'later prompt', origin: { kind: 'composer' } } } as never)
  await later.unmount()
  const reopened = await $.ui.mount({
    plugin: 'mod-prompts',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'prompts',
    props: { title: 'Prompts', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
  } as never)
  expect(JSON.stringify(await reopened.drawn({ in: 'prompts-tab' }))).toContain('4')
  expect(spawned).toEqual(['/t/s1.jsonl'])
  await reopened.unmount()
})

test('a long session pages by 100, each row its own timeline Client, with the pager buttons in fixed places', async ($, on) => {
  const many = Array.from({ length: 342 }, (_, n) => user(n + 1, n === 0 ? null : n, `prompt number ${n + 1} with a few more words to make the row long enough`)).join('\n')
  on('store.get', () => ({ value: '/t/long.jsonl' }))
  on('store.set', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's2' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: many.length, mtimeMs: 0, isLink: false } }))
  on('fs.read', () => ({ value: `${many}\n` }))
  on('ui.panes', () => ({ value: [] }))
  mock.env(on, {})
  mock.clock(on)
  const ui = await $.ui.mount({ plugin: 'mod-prompts', surface: 'terminal', component: 'Pane', requestId: 'prompts', props: { title: 'Prompts', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } } as never)
  expect(JSON.stringify(await ui.drawn({ in: 'prompts-tab' }))).toContain('342')
  // The newest prompt is open, so the last page shows. Prev and Next sit side by side before the page text, and both stay drawn, so the text never moves them.
  expect(await ui.find({ type: 'Text', text: 'Page 4 of 4 · 301–342' })).toBeDefined()
  expect(JSON.stringify(await ui.drawn({ in: 'timeline-300' }))).toContain('prompt number 301 ')
  expect(JSON.stringify(await ui.drawn())).toContain('prompt number 342')
  expect(JSON.stringify(await ui.drawn())).not.toContain('prompt number 300 ')
  const last = JSON.stringify(await ui.drawn())
  expect(last.indexOf('prompts-page-prev')).toBeGreaterThan(-1)
  expect(last.indexOf('prompts-page-next')).toBeGreaterThan(last.indexOf('prompts-page-prev'))
  expect(last.indexOf('Page 4 of 4')).toBeGreaterThan(last.indexOf('prompts-page-next'))
  // Prev goes back a page; the open prompt's details stay off it.
  await pointer(ui, { in: 'prompts-page-prev', type: 'down', button: 'left', x: 1, y: 0 })
  expect(await ui.find({ type: 'Text', text: 'Page 3 of 4 · 201–300' })).toBeDefined()
  expect(JSON.stringify(await ui.drawn({ in: 'timeline-200' }))).toContain('prompt number 201 ')
  expect(JSON.stringify(await ui.drawn())).not.toContain('timeline-after')
  // Scrolled down, the pager stays at the top of the view with the card.
  await ui.unmount()
  const scrolled = await $.ui.mount({ plugin: 'mod-prompts', surface: 'terminal', component: 'Pane', requestId: 'prompts', props: { title: 'Prompts', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 90, bodyRows: 40 }, view: {} } } as never)
  const card = JSON.stringify(await scrolled.drawn())
  expect(card).toContain('"top":90')
  expect(card.indexOf('Page 3 of 4')).toBeGreaterThan(card.indexOf('"top":90'))
  await scrolled.unmount()
})

test('a jump targets the id the row was drawn under, else the uuid', () => {
  const drawn = new Map([[ID(1).slice(0, 24), `${ID(1).slice(0, 24)}000000000007`]])
  expect(targetOf(drawn, ID(1))).toBe(`${ID(1).slice(0, 24)}000000000007`)
  expect(targetOf(drawn, ID(2))).toBe(ID(2))
})

test('the title tabs swap the sidebar and its settings', async ($, on) => {
  const opened: string[] = []
  on('store.get', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 0, mtimeMs: 0, isLink: false } }))
  on('fs.read', () => ({ value: '' }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('config.list', () => ({ value: [{ key: 'mod-prompts.animations', label: 'Animations', kind: 'boolean', value: true, description: 'Entries shimmer while they wait. Off, everything draws still' }] }) as never)
  on('fs.list', () => ({ value: [] }))
  mock.env(on, {})
  mock.clock(on)
  const pane = (requestId: string) =>
    ({ plugin: 'mod-prompts', surface: 'terminal', component: 'Pane', requestId, props: { title: 'Prompts', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} } }) as never

  const ui = await $.ui.mount(pane('prompts'))
  await pointer(ui, { in: 'prompts-settings', type: 'down', button: 'left', x: 1, y: 0 })
  expect(opened).toEqual(['prompts-settings'])
  await ui.unmount()

  const settings = await $.ui.mount(pane('prompts-settings'))
  expect(JSON.stringify(await settings.drawn({ in: 'setting-name-0' }))).toContain(' Animations ')
  // A settings control's tip is its description's first sentence, led by a lowercase letter.
  await pointer(settings, { in: 'setting-0-flip', type: 'move', x: 1, y: 0 })
  expect(await settings.find({ type: 'Text', text: ' · entries shimmer while they wait' })).toBeDefined()
  await pointer(settings, { in: 'prompts-tab', type: 'down', button: 'left', x: 1, y: 0 })
  expect(opened).toEqual(['prompts-settings', 'prompts'])
  await settings.unmount()
})

// The sidebar with nothing in the transcript, enough to draw the title row's settings pill.
async function emptyPane($: any, on: any) {
  on('store.get', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 0, mtimeMs: 0, isLink: false } }))
  on('fs.read', () => ({ value: '' }))
  on('fs.list', () => ({ value: [] }))
  on('ui.panes', () => ({ value: [] }))
  mock.env(on, {})
  mock.clock(on)
  return $.ui.mount({ plugin: 'mod-prompts', surface: 'terminal', component: 'Pane', requestId: 'prompts', props: { title: 'Prompts', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} } } as never)
}

test('icons=nerd draws the settings pill with the Nerd gear', { options: { icons: 'nerd' } }, async ($, on) => {
  const ui = await emptyPane($, on)
  expect(JSON.stringify(await ui.drawn({ in: 'prompts-settings' }))).toContain(String.fromCodePoint(0xf0493))
  await ui.unmount()
})

test('icons=safe draws the settings pill with the plain gear', { options: { icons: 'safe' } }, async ($, on) => {
  const ui = await emptyPane($, on)
  const pill = JSON.stringify(await ui.drawn({ in: 'prompts-settings' }))
  expect(pill).toContain('⊛')
  expect(pill).not.toContain(String.fromCodePoint(0xf0493))
  await ui.unmount()
})

test('mod-menu labels never leaves the band entry as its icon alone', { options: { icons: 'nerd' } }, async ($, on) => {
  on('state.get', (_$, e) => ({ value: { value: e.plugin === 'mod-menu' && e.key === 'labels' ? 'never' : undefined } }) as never)
  on('ui.panes', () => ({ value: [] }))
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>other mod</Text>
  })
  mock.env(on, {})
  mock.clock(on)
  const band = await $.ui.mount({ plugin: 'mod-prompts', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} } } as never)
  const entry = JSON.stringify(await band.drawn({ in: 'menu-entry-prompts' }))
  expect(entry).toContain('"backgroundColor"')
  expect(entry).not.toContain('Prompts')
  await band.unmount()
})

test('a band tip whose entry was redrawn while hovered clears after 5 s with no newer hover', async ($, on) => {
  on('ui.panes', () => ({ value: [] }))
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>other mod</Text>
  })
  mock.env(on, {})
  const clock = mock.clock(on)
  const band = { plugin: 'mod-prompts', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} } } as const
  // Live, a band redraw mid-turn replaced the hovered entry, so its own quiet timer, and the leave, never came.
  const first = await $.ui.mount(band as never)
  await pointer(first, { type: 'move', x: 1, y: 0, in: 'menu-entry-prompts' })
  await first.unmount()
  // The pill's tip text also sits in the Client props, so only the tip row's Text says whether it shows.
  const showsNow = async () => {
    const ui = await $.ui.mount(band as never)
    const shown = (await ui.find({ type: 'Text', text: /every prompt this session/ })) !== undefined
    await ui.unmount()
    return shown
  }
  expect(await showsNow()).toBe(true)
  await clock.advance(4000)
  expect(await showsNow()).toBe(true)
  await clock.advance(1000)
  expect(await showsNow()).toBe(false)
})

const parseAll = (lines: string[]) => lines.flatMap(line => parseRow(line) ?? [])
const calls = (n: number, parent: number, count: number) =>
  JSON.stringify({ type: 'assistant', uuid: ID(n), parentUuid: ID(parent), message: { role: 'assistant', content: Array.from({ length: count }, (_, call) => ({ type: 'tool_use', id: `t${n}-${call}` })) } })

test('a meta queued prompt, a compact summary and an interrupted prompt take no number, so the next prompt is the second', () => {
  const rows = parseAll([
    user(1, null, 'first prompt'),
    JSON.stringify({ type: 'attachment', uuid: ID(2), parentUuid: ID(1), attachment: { type: 'queued_command', prompt: 'a note the hook queued', isMeta: true } }),
    user(3, 2, 'summary of the earlier turns', { isCompactSummary: true }),
    user(4, 3, '[Request interrupted by user]'),
    user(5, 4, 'second prompt'),
  ])
  expect(promptsOf(rows).map(prompt => prompt.text)).toEqual(['first prompt', 'second prompt'])
})

test('a subagent report opens a turn that is no prompt, so the calls after it count to no prompt', () => {
  const listed = promptsOf(parseAll([
    user(1, null, 'first prompt'),
    calls(2, 1, 2),
    user(3, 2, 'report from the subagent', { isMeta: true, origin: { kind: 'peer' } }),
    calls(4, 3, 1),
  ]))
  expect(listed.map(prompt => prompt.text)).toEqual(['first prompt'])
  expect(listed[0]).toMatchObject({ tools: 2 })
})

test('the live branch follows parents through main rows only, and steps past a subagent parent to the main row before, as turns.ts does', () => {
  const subagent = JSON.stringify({ type: 'user', isSidechain: true, uuid: ID(20), parentUuid: ID(1), message: { role: 'user', content: 'subagent text' } })
  const listed = promptsOf(parseAll([user(1, null, 'first prompt'), subagent, user(21, 20, 'second prompt')]))
  expect(listed.map(prompt => prompt.text)).toEqual(['first prompt', 'second prompt'])
})

// A session whose transcript is `rows`, one row per line as Claude Code writes it, with the pane closed until the mod opens it.
function session(on: any, rows: string) {
  const transcript = `${rows}\n`
  on('store.get', () => ({ value: '/t/s3.jsonl' }))
  on('store.set', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's3' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: transcript.length, mtimeMs: 0, isLink: false } }))
  on('fs.read', () => ({ value: transcript }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.render', ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })
  mock.env(on, {})
  return mock.clock(on)
}

// A composer prompt drawn under `requestId`, then unmounted as the row scrolls away.
async function sent($: any, requestId: string, text: string) {
  const row = await $.ui.mount({ plugin: 'mod-prompts', surface: 'terminal', component: 'UserMessage', requestId, props: { text, origin: { kind: 'composer' } } } as never)
  await row.unmount()
}

const paneOf = ($: any) =>
  $.ui.mount({ plugin: 'mod-prompts', surface: 'terminal', component: 'Pane', requestId: 'prompts', props: { title: 'Prompts', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } } as never)

test('a prompt sent again with the same text is listed again', async ($, on) => {
  session(on, [user(1, null, 'continue'), reply(2, 1)].join('\n'))
  await $.command.run({ command: 'mod-prompts' } as never)
  await sent($, ID(50), 'continue')
  await sent($, ID(51), 'continue')
  await $.command.run({ command: 'mod-prompts' } as never)
  const ui = await paneOf($)
  const rows = await Promise.all([0, 1, 2].map(n => ui.drawn({ in: `timeline-${n}` })))
  expect(rows.map(row => JSON.stringify(row).includes(' continue'))).toEqual([true, true, true])
  expect(await ui.find({ key: 'stop-row-3' })).toBeUndefined()
  await ui.unmount()
})

test('a placeholder draw lists no prompt, and the uuid draw that follows lists it once', async ($, on) => {
  const clock = session(on, user(1, null, '/mod-menu'))
  await $.command.run({ command: 'mod-prompts' } as never)
  await sent($, 'placeholder', 'fresh prompt')
  const empty = await paneOf($)
  expect(await empty.find({ type: 'Text', text: 'No prompts yet.' })).toBeDefined()
  await empty.unmount()
  await sent($, ID(60), 'fresh prompt')
  await clock.settle()
  const ui = await paneOf($)
  expect(JSON.stringify(await ui.drawn({ in: 'timeline-0' }))).toContain(' fresh prompt')
  expect(await ui.find({ key: 'stop-row-1' })).toBeUndefined()
  await ui.unmount()
})

test('a card that cuts a long prompt pins the expand control right on its last text row, and a click opens and closes the whole prompt', { options: { icons: 'safe' } }, async ($, on) => {
  session(on, user(1, null, `${'word '.repeat(119)}last`))
  await $.command.run({ command: 'mod-prompts' } as never)
  const ui = await paneOf($)
  const control = `prompts-more:${ID(1)}`
  const words = (node: unknown): string => (typeof node === 'string' ? node : Array.isArray(node) ? node.map(words).join('') : node ? words((node as { children?: unknown }).children) : '')
  expect(await ui.find({ key: 'card-row-gap' })).toBeDefined()
  expect(await ui.find({ key: 'card-row-text' })).toBeDefined()
  expect(words(await ui.drawn({ in: control }))).toBe(' ▾ 5 more lines ')
  expect(await ui.find({ type: 'Text', text: /last/ })).toBeUndefined()
  await pointer(ui, { in: control, type: 'down', button: 'left', x: 1, y: 0 })
  expect(words(await ui.drawn({ in: control }))).toBe(' ▴ Show less ')
  expect(await ui.find({ type: 'Text', text: /last/ })).toBeDefined()
  await pointer(ui, { in: control, type: 'down', button: 'left', x: 1, y: 0 })
  expect(words(await ui.drawn({ in: control }))).toBe(' ▾ 5 more lines ')
  expect(await ui.find({ type: 'Text', text: /last/ })).toBeUndefined()
  await ui.unmount()
})

test('an opened card keeps its pager in view', { options: { icons: 'safe' } }, async ($, on) => {
  const many = Array.from({ length: 342 }, (_, n) => user(n + 1, n === 0 ? null : n, n === 341 ? 'word '.repeat(120).trim() : `prompt ${n + 1}`)).join('\n')
  session(on, many)
  await $.command.run({ command: 'mod-prompts' } as never)
  const ui = await paneOf($)
  await pointer(ui, { in: `prompts-more:${ID(342)}`, type: 'down', button: 'left', x: 1, y: 0 })
  expect(await ui.find({ key: 'pager' })).toBeDefined()
  expect(await ui.find({ key: 'prompts-page-next' })).toBeDefined()
  await ui.unmount()
})

test('icons=nerd draws the expand control with the Nerd arrow', { options: { icons: 'nerd' } }, async ($, on) => {
  session(on, user(1, null, 'word '.repeat(120).trim()))
  await $.command.run({ command: 'mod-prompts' } as never)
  const ui = await paneOf($)
  expect(JSON.stringify(await ui.drawn({ in: `prompts-more:${ID(1)}` }))).toContain(String.fromCodePoint(0xf0d7))
  await ui.unmount()
})

test('a card that holds its whole prompt has no count', async ($, on) => {
  session(on, user(1, null, 'first prompt'))
  await $.command.run({ command: 'mod-prompts' } as never)
  const ui = await paneOf($)
  expect(await ui.find({ type: 'Text', text: /more lines/ })).toBeUndefined()
  await ui.unmount()
})

// One process that switches sessions; each session's transcript sits under its store key.
// isBig: the file reads as past one fs.read's 4 MiB, so the host refuses fs.read and tail.ts's process reads it; reads: each process read's start.
function sessions(on: any, files: Record<string, string>) {
  const w = { session: 'a', files, isOpen: false, isBig: false, reads: [] as number[] }
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: e.key.startsWith('transcript:') ? `/t/${e.key.slice('transcript:'.length)}.jsonl` : undefined }))
  on('store.set', () => ({ value: undefined }))
  on('session.id', () => ({ value: w.session }))
  const idOf = (path: string) => path.replace(/\\/g, '/').match(/\/([^/]+)\.jsonl$/)?.[1] ?? ''
  on('fs.stat', (_$: unknown, e: { path: string }) => ({ value: { kind: 'file', size: w.isBig ? 5 * 1024 * 1024 : new TextEncoder().encode(w.files[idOf(e.path)] ?? '').length, mtimeMs: 0, isLink: false } }))
  on('fs.read', (_$: unknown, e: { path: string }) => {
    if (w.isBig) throw new Error('over 4 MiB')
    return { value: w.files[idOf(e.path)] ?? '' }
  })
  on('process.run', (_$: unknown, e: { argv: string[] }) => {
    const from = Number(e.argv[e.argv.length - 2]) - 1
    w.reads.push(from)
    return { value: { exitCode: 0, stdout: btoaBytes(new TextEncoder().encode(w.files[idOf(e.argv[e.argv.length - 3]!)] ?? '').subarray(from)), stderr: '' } }
  })
  on('ui.panes', () => ({ value: w.isOpen ? [{ id: 'prompts', isPlaced: true }] as never : [] }))
  on('ui.open', () => {
    w.isOpen = true
    return { value: { isPlaced: true } }
  })
  on('turn.complete', () => ({ text: '' }))
  on('session.end', (_$: unknown, e: { sessionId: string }) => ({ sessionId: e.sessionId }))
  on('ui.render', ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })
  mock.env(on, {})
  return { w, clock: mock.clock(on) }
}

test('a resume to another session and back lists each session\'s own prompts, and /clear lists none of the old ones', async ($, on) => {
  const { w, clock } = sessions(on, { a: `${user(1, null, 'alpha prompt')}\n`, b: `${user(11, null, 'beta prompt')}\n` })
  const listed = async () => {
    await clock.settle()
    const ui = await paneOf($)
    await clock.settle()
    const drawn = JSON.stringify(await ui.drawn())
    await ui.unmount()
    return drawn
  }
  expect(await listed()).toContain('alpha prompt')
  for (const [to, shown, gone] of [['b', 'beta prompt', 'alpha prompt'], ['a', 'alpha prompt', 'beta prompt']] as const) {
    await $.session.end({ reason: 'resume', sessionId: w.session, resume: {} } as never)
    w.session = to
    const drawn = await listed()
    expect(drawn).toContain(shown)
    expect(drawn).not.toContain(gone)
  }
  await $.session.end({ reason: 'clear', sessionId: 'a', resume: {} } as never)
  w.session = 'c'
  expect(await listed()).not.toContain('alpha prompt')
})

test('a turn that ends with the pane open reads only the bytes after what was fed', async ($, on) => {
  const { w, clock } = sessions(on, { a: `${user(1, null, 'first prompt é')}\n` })
  await $.command.run({ command: 'mod-prompts' } as never)
  const fed = new TextEncoder().encode(w.files.a!).length
  w.files.a += `${user(2, 1, 'second prompt')}\n`
  w.isBig = true
  await $.turn.complete({ turnId: 't1', reason: 'answer', answer: 'ok', isAborted: false } as never)
  await clock.settle()
  expect(w.reads[0]).toBe(fed)
  const ui = await paneOf($)
  expect(JSON.stringify(await ui.drawn())).toContain('second prompt')
  await ui.unmount()
})

const DIGITS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const btoaBytes = (bytes: Uint8Array) => {
  let out = ''
  for (let at = 0; at < bytes.length; at += 3) {
    const n = (bytes[at]! << 16) | ((bytes[at + 1] ?? 0) << 8) | (bytes[at + 2] ?? 0)
    out += DIGITS[n >> 18]! + DIGITS[(n >> 12) & 63]! + (at + 1 < bytes.length ? DIGITS[(n >> 6) & 63]! : '=') + (at + 2 < bytes.length ? DIGITS[n & 63]! : '=')
  }
  return out
}

test('a turn that ends while the pane is open reads an unchanged transcript no more', async ($, on) => {
  const transcript = `${user(1, null, 'first prompt')}\n${reply(2, 1)}\n`
  let isOpen = false
  let reads = 0
  on('store.get', () => ({ value: '/t/s3.jsonl' }))
  on('store.set', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's3' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: transcript.length, mtimeMs: 0, isLink: false } }))
  on('fs.read', () => {
    reads += 1
    return { value: transcript }
  })
  on('ui.panes', () => ({ value: isOpen ? [{ id: 'prompts', isPlaced: true }] as never : [] }))
  on('ui.open', () => {
    isOpen = true
    return { value: { isPlaced: true } }
  })
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })
  mock.env(on, {})
  const clock = mock.clock(on)
  await $.command.run({ command: 'mod-prompts' } as never)
  expect(reads).toBe(1)
  await $.turn.complete({ turnId: 't1', reason: 'answer', answer: 'ok', isAborted: false } as never)
  await clock.settle()
  expect(reads).toBe(1)
})

// The test host turns a POSIX path into a Windows one, so paths are compared without a drive letter.
const plain = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

// No transcript is known, so opening the sidebar looks for the session's file and lists the projects folder.
async function listedFolders($: any, on: any, env: Record<string, string>) {
  const listed: string[] = []
  on('store.get', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 0, mtimeMs: 0, isLink: false } }))
  on('fs.read', () => ({ value: '' }))
  on('fs.list', (_$: unknown, e: { path: string }) => {
    listed.push(plain(e.path))
    return { value: [] }
  })
  on('ui.panes', () => ({ value: [] }))
  mock.env(on, env)
  mock.clock(on)
  const ui = await $.ui.mount({ plugin: 'mod-prompts', surface: 'terminal', component: 'Pane', requestId: 'prompts', props: { title: 'Prompts', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} } } as never)
  await ui.unmount()
  return listed
}

test('the transcript is looked up under CLAUDE_CONFIG_DIR when set', async ($, on) => {
  expect(await listedFolders($, on, { USERPROFILE: '/home/u', CLAUDE_CONFIG_DIR: '/cfg/' })).toContain('/cfg/projects')
})

test('without CLAUDE_CONFIG_DIR the transcript is looked up under ~/.claude',async ($, on) => {
  expect(await listedFolders($, on, { USERPROFILE: '/home/u' })).toContain('/home/u/.claude/projects')
})

test('a transcript that cannot be read says so instead of "No prompts yet."', async ($, on) => {
  on('store.get', () => ({ value: { path: '/t/s3.jsonl', at: 0 } }))
  on('store.set', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's3' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 100, mtimeMs: 0, isLink: false } }))
  on('fs.read', () => {
    throw new Error('unreadable')
  })
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.render', ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })
  mock.env(on, {})
  mock.clock(on)
  await $.command.run({ command: 'mod-prompts' } as never)
  const ui = await paneOf($)
  const shown = JSON.stringify(await ui.drawn())
  // The test engine words a throwing handler itself, so only the lead and that a reason follows it are fixed.
  expect(shown).toMatch(/Can't read this session's transcript: \S/)
  expect(await ui.find({ type: 'Text', text: 'No prompts yet.' })).toBeUndefined()
  await ui.unmount()
})

test('an empty transcript file is a legitimately empty session: "No prompts yet.", no error', async ($, on) => {
  on('store.get', () => ({ value: { path: '/t/s4.jsonl', at: 0 } }))
  on('store.set', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's4' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 0, mtimeMs: 0, isLink: false } }))
  on('fs.read', () => ({ value: '' }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.render', ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })
  mock.env(on, {})
  mock.clock(on)
  await $.command.run({ command: 'mod-prompts' } as never)
  const ui = await paneOf($)
  expect(await ui.find({ type: 'Text', text: 'No prompts yet.' })).toBeDefined()
  expect(JSON.stringify(await ui.drawn())).not.toContain("Can't read")
  await ui.unmount()
})

test('transcript paths untouched for 30 days are deleted at session start, a bare path from an older version gets an age', async ($, on) => {
  const now = Date.UTC(2026, 9, 5, 16, 52)
  const day = 24 * 60 * 60 * 1000
  const store = new Map<string, unknown>([
    ['transcript:stale', { path: '/t/old.jsonl', at: now - 31 * day }],
    ['transcript:fresh', { path: '/t/new.jsonl', at: now - 29 * day }],
    ['transcript:bare', '/t/bare.jsonl'],
    ['other', 'kept'],
  ])
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', (_$, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('session.start', () => ({ cwd: '/w' }))
  on('command.register', () => ({ value: { command: 'mod-prompts' } }))
  on('ui.panes', () => ({ value: [] }))
  mock.env(on, {})
  mock.clock(on, { now })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true } as never)
  expect(store.has('transcript:stale')).toBe(false)
  expect(store.get('transcript:fresh')).toEqual({ path: '/t/new.jsonl', at: now - 29 * day })
  expect(store.get('transcript:bare')).toEqual({ path: '/t/bare.jsonl', at: now })
  expect(store.get('other')).toBe('kept')
})

test('a store that fails on the transcript path still lets the session start and the list load', async ($, on) => {
  on('session.start', () => ({ cwd: '/w' }))
  on('command.register', () => ({ value: { command: 'mod-prompts' } }))
  on('store.keys', () => ({ value: [] }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => {
    throw new Error('store unavailable')
  })
  on('session.id', () => ({ value: 's1' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: TRANSCRIPT.length, mtimeMs: 0, isLink: false } }))
  on('fs.read', (_$, e) => ({ value: e.path.replace(/\\/g, '/').endsWith('/bridge/s1.jsonl') ? `${JSON.stringify({ session_id: 's1', transcript_path: '/t/s1.jsonl', hook_event_name: 'SessionStart', source: 'startup' })}\n` : TRANSCRIPT }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  mock.env(on, { USERPROFILE: '/home/u' })
  const clock = mock.clock(on)
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })

  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true } as never)
  await clock.advance(250)
  await $.command.run({ command: 'mod-prompts' } as never)
  const ui = await $.ui.mount({ plugin: 'mod-prompts', surface: 'terminal', component: 'Pane', requestId: 'prompts', props: { title: 'Prompts', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} } } as never)
  expect(JSON.stringify(await ui.drawn({ in: 'prompts-tab' }))).toContain('3')
  await ui.unmount()
})

test('the hint draws in the pinned footer and the empty list is a titled box, not a line under the tabs', async ($, on) => {
  const ui = await emptyPane($, on)
  expect(await ui.find({ key: 'status-line' })).toBeUndefined()
  expect(JSON.stringify(await ui.find({ key: 'pane-footer' }))).toContain('Click a prompt to open it')
  expect(await ui.find({ key: 'footer-status' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'This session' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'No prompts yet.' })).toBeDefined()
  expect(JSON.stringify(await ui.drawn({ in: 'prompts-settings' }))).not.toContain(THEME.ok)
  await ui.unmount()
})

test('the Settings view draws the gear active, its hint in the footer and the mod name in the card title', async ($, on) => {
  on('config.list', () => ({ value: [{ key: 'mod-prompts.animations', label: 'Animations', kind: 'boolean', value: true, description: 'd' }] }) as never)
  on('store.get', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 0, mtimeMs: 0, isLink: false } }))
  on('fs.read', () => ({ value: '' }))
  on('fs.list', () => ({ value: [] }))
  on('ui.panes', () => ({ value: [] }))
  mock.env(on, {})
  mock.clock(on)
  const settings = await $.ui.mount({ plugin: 'mod-prompts', surface: 'terminal', component: 'Pane', requestId: 'prompts-settings', props: { title: 'Settings', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} } } as never)
  const gear = JSON.stringify(await settings.drawn({ in: 'prompts-settings' }))
  expect(gear).toContain(THEME.ok)
  expect(gear).toContain(THEME.lifted)
  expect(await settings.find({ key: 'status-line' })).toBeUndefined()
  expect(JSON.stringify(await settings.find({ key: 'pane-footer' }))).toContain('Click a setting to change it')
  expect(JSON.stringify(await settings.drawn())).toContain('mod-prompts')
  await settings.unmount()
})

// mod-transcript / tests/drawing.test.tsx, by v-amorim
// Tests how finished turns, edits and diffs are drawn from transcript rows.
import { expect, mock, test } from 'claude-code/testing'

import Chips from '../hooks/chips'
import Copy from '../hooks/copy'
import Dot from '../hooks/dot'
import Fold from '../hooks/fold'
import { mix, THEME } from '../hooks/theme'
import { feed, reading, sessionStarted } from './bridge-feed'

const ID = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`
const row = (n: number, type: string, extra: object) => JSON.stringify({ type, uuid: ID(n), parentUuid: n > 1 ? ID(n - 1) : null, ...extra })
const said = (n: number, content: unknown[]) => row(n, 'assistant', { message: { role: 'assistant', content } })
const answered = (n: number, id: string, extra: object = {}) => row(n, 'user', { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] }, ...extra })

// One finished turn that edits a file; its diff has an indented line.
const EDIT_TURN = [
  row(1, 'user', { message: { role: 'user', content: 'edit it' } }),
  said(2, [{ type: 'tool_use', id: 'toolu_e', name: 'Edit', input: { file_path: '/repo/a.ts' } }]),
  answered(3, 'toolu_e', { toolUseResult: { structuredPatch: [{ lines: [' keep', '+    indented()', '-old'] }] } }),
  said(4, [{ type: 'text', text: 'Done.' }]),
  row(5, 'system', { subtype: 'turn_duration', durationMs: 1000 }),
  row(6, 'user', { message: { role: 'user', content: 'next' } }),
].join('\n') + '\n'

// Two finished turns that each edit a file, so each has its own head to open.
const TWO_TURNS = [
  row(1, 'user', { message: { role: 'user', content: 'first' } }),
  said(2, [{ type: 'tool_use', id: 'toolu_a', name: 'Edit', input: { file_path: '/repo/a.ts' } }]),
  answered(3, 'toolu_a', { toolUseResult: { structuredPatch: [] } }),
  said(4, [{ type: 'text', text: 'one' }]),
  row(5, 'system', { subtype: 'turn_duration', durationMs: 1000 }),
  row(6, 'user', { message: { role: 'user', content: 'second' } }),
  said(7, [{ type: 'tool_use', id: 'toolu_b', name: 'Edit', input: { file_path: '/repo/b.ts' } }]),
  answered(8, 'toolu_b', { toolUseResult: { structuredPatch: [] } }),
  said(9, [{ type: 'text', text: 'two' }]),
  row(10, 'system', { subtype: 'turn_duration', durationMs: 1000 }),
  row(11, 'user', { message: { role: 'user', content: 'third' } }),
].join('\n') + '\n'

// Mounts rows the way the engine draws them, once the transcript `text` is read.
async function open($: any, on: any, text = '', reads: () => string = () => text) {
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: text.length, mtimeMs: 0, isLink: false } }))
  on('fs.read', reading(() => ({ value: reads() })))
  const clock = mock.clock(on)
  on('session.start', () => ({ cwd: '/w' }))
  mock.env(on, { USERPROFILE: '/home' })
  on('ui.render', ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>{`base ${e.component}`}</Text>
  })
  await sessionStarted($, clock, 's1', '/t/s1.jsonl', 'startup')
  const mount = (component: string, requestId: string, props: object, columns = 120) =>
    $.ui.mount({ plugin: 'mod-transcript', surface: 'terminal', component, requestId, viewport: { columns, rows: 40 }, props } as never)
  // A hook event, as the command hook writes it into the bridge file.
  return Object.assign(mount, { hook: (record: Record<string, unknown>) => feed($, clock, { session_id: 's1', ...record }) })
}

const prompt = (text: string, isExpanded = false) => ({ text, origin: { kind: 'composer' }, isExpanded })

const textOf = (node: any): string => (typeof node === 'string' ? node : Array.isArray(node) ? node.map(textOf).join('') : node ? textOf(node.children) : '')

// The words a label Client drew; a row's fold labels are Clients, since a Button posts no tip.
const labelText = async (ui: any, key: string) => textOf(await ui.drawn({ in: key }))

// A click on a fold label, which posts the fold the hooks module answers.
const clickLabel = (ui: any, key: string) => ui.pointer({ in: key, type: 'down', button: 'left', x: 1, y: 0 })

test('the ctrl+o view draws every row as the engine does, so the mod steps aside', { options: { expand_live: false } }, async ($, on) => {
  const mount = await open($, on, EDIT_TURN)
  const head = await mount('UserMessage', ID(1), prompt('edit it', true))
  expect(await head.find({ type: 'Text', text: 'base UserMessage' })).toBeDefined()
  expect(await head.find({ key: 'toggle-turn-colored' })).toBeUndefined()
})

test('while a subagent transcript is on screen its rows draw as the engine draws them and join no main turn', async ($, on) => {
  const mount = await open($, on, EDIT_TURN)
  const band = (agentId?: string) => mount('AbovePrompt', 'band', { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: agentId ? { agentId } : {} })
  await (await band('a1')).unmount()
  const subPrompt = await mount('UserMessage', ID(50), prompt('the brief'))
  expect(await subPrompt.find({ type: 'Text', text: 'base UserMessage' })).toBeDefined()
  const subCall = await mount('ToolUse', 'toolu_sub', { tool_use_id: 'toolu_sub', tool: 'Read', input: { file_path: '/repo/x.ts' }, isRunning: false, isErrored: false, isInterrupted: false, output: {} })
  expect(await subCall.find({ type: 'Text', text: 'base ToolUse' })).toBeDefined()
  await (await band()).unmount()
  const head = await mount('UserMessage', ID(1), prompt('edit it'))
  expect(await labelText(head, 'toggle-turn-colored')).toMatch(/^1 tool/)
})

test('the normal view still folds the finished turn under its prompt', async ($, on) => {
  const mount = await open($, on, EDIT_TURN)
  const head = await mount('UserMessage', ID(1), prompt('edit it'))
  expect(await labelText(head, 'toggle-turn-colored')).toMatch(/^1 tool/)
})

test('a prompt a plugin sends opens a turn of its own, so its reply leaves the earlier turn folded under its head', async ($, on) => {
  const mount = await open($, on, EDIT_TURN.split('\n').slice(0, 5).join('\n') + '\n')
  await mount('UserMessage', ID(6), { text: 'check this note', origin: { kind: 'plugin', name: 'mod-heads-up' }, isExpanded: false })
  await (await mount('AssistantMessage', ID(7), { text: 'It holds.' })).unmount()
  const head = await mount('UserMessage', ID(1), prompt('edit it'))
  expect(await labelText(head, 'toggle-turn-colored')).toMatch(/^1 tool/)
})

test('a typed prompt is lifted over the margin Claude Code adds, and a plugin\'s prompt, drawn with none, is not', async ($, on) => {
  const mount = await open($, on)
  const liftOf = async (ui: any) => (await ui.find({ key: 'toggle-prompt-lift' }))?.props.marginTop
  expect(await liftOf(await mount('UserMessage', ID(6), prompt('edit it')))).toBe(-1)
  expect(await liftOf(await mount('UserMessage', ID(8), { text: 'check this note', origin: { kind: 'plugin', name: 'mod-heads-up' }, isExpanded: false }))).toBe(0)
})

test('a call refused by a hook draws neutral with "declined", not in the failure color', { options: { expand_live: false } }, async ($, on) => {
  const mount = await open($, on)
  await mount.hook({ hook_event_name: 'PermissionDenied', tool_name: 'WebFetch', tool_input: {}, tool_use_id: 'toolu_web', reason: 'blocked' })
  const tool = await mount('ToolUse', 'toolu_web', { tool_use_id: 'toolu_web', tool: 'WebFetch', input: { url: 'https://example.com' }, isRunning: false, isErrored: true, isInterrupted: false, output: 'blocked' })
  expect((await tool.find({ type: 'Client', key: 'toggle-tool-chip' }))?.props.props.color).toBe(THEME.muted)
  expect(await labelText(tool, 'toggle-tool-colored')).toMatch(/declined/)
})

test('a failed call that no hook refused stays in the failure color', { options: { expand_live: false } }, async ($, on) => {
  const mount = await open($, on)
  const tool = await mount('ToolUse', 'toolu_web', { tool_use_id: 'toolu_web', tool: 'WebFetch', input: { url: 'https://example.com' }, isRunning: false, isErrored: true, isInterrupted: false, output: 'boom' })
  expect((await tool.find({ type: 'Client', key: 'toggle-tool-chip' }))?.props.props.color).toBe(THEME.alert)
  expect(await labelText(tool, 'toggle-tool-colored')).not.toMatch(/declined/)
})

test('a timed-out call says so after its name, and its name is cut to leave the words room', { options: { expand_live: false } }, async ($, on) => {
  const mount = await open($, on)
  const tool = await mount('ToolUse', 'toolu_web', { tool_use_id: 'toolu_web', tool: 'WebFetch', input: { url: 'https://example.com/a/very/long/path/that/goes/on/and/on/and/on' }, isRunning: false, isErrored: false, isInterrupted: false, output: { timedOutAfterMs: 120000 } }, 60)
  expect(await labelText(tool, 'toggle-tool-colored')).toMatch(/^WebFetch\(https.*… · timed out$/)
})

test('a call that ran in the background says so, and an interrupted one says interrupted', { options: { expand_live: false } }, async ($, on) => {
  const mount = await open($, on)
  const background = await mount('ToolUse', 'toolu_bg', { tool_use_id: 'toolu_bg', tool: 'WebFetch', input: { url: 'https://example.com' }, isRunning: false, isErrored: false, isInterrupted: false, output: { backgroundTaskId: 'b1' } })
  expect(await labelText(background, 'toggle-tool-colored')).toMatch(/· background/)
  const cut = await mount('ToolUse', 'toolu_cut', { tool_use_id: 'toolu_cut', tool: 'WebFetch', input: { url: 'https://example.com' }, isRunning: false, isErrored: true, isInterrupted: true, output: 'cut' })
  expect(await labelText(cut, 'toggle-tool-colored')).toMatch(/· interrupted/)
})

test('AskUserQuestion folds to one line per question: its answer, or that it asked', { options: { expand_live: false } }, async ($, on) => {
  const mount = await open($, on)
  const ask = await mount('ToolUse', 'toolu_ask', {
    tool_use_id: 'toolu_ask',
    tool: 'AskUserQuestion',
    input: { questions: [{ question: 'Which db?' }, { question: 'Ship now?' }] },
    isRunning: false,
    isErrored: false,
    isInterrupted: false,
    output: { questions: [], answers: { 'Which db?': 'Postgres' } },
  })
  expect(await ask.find({ type: 'Text', text: /Which db\? .* Postgres/ })).toBeDefined()
  expect(await ask.find({ type: 'Text', text: /Asked you: Ship now\?/ })).toBeDefined()
})

test('AskUserQuestion draws its question lines with the safe mark in safe mode', { options: { expand_live: false, icons: 'safe' } }, async ($, on) => {
  const mount = await open($, on)
  const ask = await mount('ToolUse', 'toolu_ask', { tool_use_id: 'toolu_ask', tool: 'AskUserQuestion', input: { questions: [{ question: 'Which db?' }] }, isRunning: false, isErrored: false, isInterrupted: false, output: { answers: { 'Which db?': 'Postgres' } } })
  expect(await ask.find({ type: 'Text', text: '? Which db? ▸ Postgres' })).toBeDefined()
})

test('AskUserQuestion draws its question lines with the Nerd search glyph in Nerd mode', { options: { expand_live: false, icons: 'nerd' } }, async ($, on) => {
  const mount = await open($, on)
  const ask = await mount('ToolUse', 'toolu_ask', { tool_use_id: 'toolu_ask', tool: 'AskUserQuestion', input: { questions: [{ question: 'Which db?' }] }, isRunning: false, isErrored: false, isInterrupted: false, output: { answers: { 'Which db?': 'Postgres' } } })
  expect(JSON.stringify(await ask.drawn())).toContain(String.fromCodePoint(0xf002))
})

test('an API error the engine retries ends the reply as one muted line, not a warning', async ($, on) => {
  const mount = await open($, on)
  await mount.hook({ hook_event_name: 'StopFailure', error: 'rate_limit', error_details: 'retry in 20s', last_assistant_message: 'API Error: Rate limit reached' })
  const reply = await mount('AssistantMessage', ID(7), { text: 'API Error: Rate limit reached', isFirstOfReply: true })
  expect(await reply.find({ type: 'Text', text: /rate limit reached · Claude Code retries · retry in 20s/ })).toBeDefined()
  expect((await reply.find({ type: 'Text', text: /rate limit reached/ }))?.props.color).toBe(THEME.muted)
})

test('a reply naming hex colors gets a strip of colored squares under it, and one naming none stays as drawn', async ($, on) => {
  const mount = await open($, on)
  const reply = await mount('AssistantMessage', ID(7), { text: 'Low is `#ACB9E6` and max is #FF6F7A.', isFirstOfReply: true })
  expect(await reply.find({ type: 'Text', text: 'base AssistantMessage' })).toBeDefined()
  const squares = await reply.findAll({ type: 'Text', text: '●' })
  expect(squares.map((square: any) => square.props.color).filter(Boolean)).toEqual(['#ACB9E6', '#FF6F7A'])
  expect(await reply.find({ type: 'Text', text: ' #FF6F7A' })).toBeDefined()
  const plain = await mount('AssistantMessage', ID(8), { text: 'See prompt #229.', isFirstOfReply: true })
  expect(await plain.find({ type: 'Text', text: '●' })).toBeUndefined()
})

const TABLE_REPLY = 'Here is where each mod draws:\n\n| Mod | Surface | Rows |\n| --- | --- | ---: |\n| `blast-radius` | band + pane | 42 |\n| file-tree | pane | 318 |\n\nThe transcript is the busiest.'

test('a reply table draws caps headers in the dim colour, hairlines between rows, no sides, and numbers aligned right', async ($, on) => {
  const mount = await open($, on)
  const reply = await mount('AssistantMessage', ID(7), { text: TABLE_REPLY, isFirstOfReply: true })
  expect(await reply.find({ type: 'Text', text: 'base AssistantMessage' })).toBeUndefined()
  const drawn = JSON.stringify(await reply.drawn())
  expect(drawn).toContain('MOD')
  expect((await reply.find({ type: 'Text', text: /^SURFACE/ }))?.props.color).toBe('#7E86A4')
  expect((await reply.findAll({ type: 'Text', text: /^blast-radius$/ })).some((cell: any) => cell.props.bold === true)).toBe(true)
  expect((await reply.findAll({ type: 'Text', text: 'blast-radius' })).some((cell: any) => cell.props.color === THEME.accent)).toBe(true)
  expect(await reply.find({ type: 'Text', text: /^ {2}42$/ })).toBeDefined()
  expect(await reply.find({ type: 'Text', text: /^─+$/ })).toBeDefined()
  expect(drawn).not.toContain('|')
  expect(await reply.find({ type: 'Markdown', props: { text: 'The transcript is the busiest.' } } as never)).toBeDefined()
})

test('a reply table wider than the bubble goes back to Claude Code\'s own table', async ($, on) => {
  const mount = await open($, on)
  const wide = `| ${'a'.repeat(60)} | ${'b'.repeat(60)} |\n| --- | --- |\n| x | y |`
  const reply = await mount('AssistantMessage', ID(7), { text: wide, isFirstOfReply: true }, 100)
  expect(await reply.find({ type: 'Text', text: 'base AssistantMessage' })).toBeDefined()
})

test('an API error that needs the person is one red line that says so', async ($, on) => {
  const mount = await open($, on)
  await mount.hook({ hook_event_name: 'StopFailure', error: 'billing_error', last_assistant_message: 'API Error: Billing' })
  const reply = await mount('AssistantMessage', ID(7), { text: 'API Error: Billing', isFirstOfReply: true })
  expect(await reply.find({ type: 'Text', text: /billing problem · you must act/ })).toBeDefined()
  expect((await reply.find({ type: 'Text', text: /billing problem/ }))?.props.color).toBe(THEME.alert)
})

test('a subagent report draws a head line with its fields, and a card whose body stops at six lines after the head\'s summary', { options: { expand_live: false, icons: 'safe' } }, async ($, on) => {
  const mount = await open($, on)
  const report = await mount('UserMessage', ID(20), {
    text: 'Found it\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9',
    origin: { kind: 'task-notification' },
    isExpanded: false,
    task: { id: 'a1', status: 'completed', type: 'local_agent', durationMs: 122000, toolUseId: 'toolu_agent' },
    from: { name: 'researcher' },
  })
  expect(await report.find({ type: 'Text', text: /researcher · completed · 2m 2s · Found it/ })).toBeDefined()
  expect(await report.find({ type: 'Text', text: 'task a1' })).toBeDefined()
  expect(await report.find({ type: 'Text', text: /^Found it$/ })).toBeUndefined()
  expect(await report.find({ type: 'Text', text: 'l7' })).toBeDefined()
  expect(await report.find({ type: 'Text', text: 'l8' })).toBeUndefined()
  // The control sits on the last text row: the line, a spacer, then the arrow and its muted label.
  const control = 'toggle-more-report:00000020-0000-4000-8000-000000000000'
  expect(await report.find({ key: 'toggle-report-more-gap' })).toBeDefined()
  expect(await report.find({ key: 'toggle-report-more-body' })).toBeDefined()
  expect((await report.findAll({ key: 'toggle-report-more' }))).toHaveLength(1)
  expect(await labelText(report, control)).toBe(' ▾ 2 more lines ')
  await clickLabel(report, control)
  expect(await report.find({ type: 'Text', text: 'l9' })).toBeDefined()
  expect(await labelText(report, control)).toBe(' ▴ Show less ')
  await clickLabel(report, control)
  expect(await report.find({ type: 'Text', text: 'l9' })).toBeUndefined()
  expect(await labelText(report, control)).toBe(' ▾ 2 more lines ')
})

const LONG_OUTPUT_TURN = [
  row(1, 'user', { message: { role: 'user', content: 'list it' } }),
  said(2, [{ type: 'tool_use', id: 'toolu_l', name: 'Write', input: { file_path: '/repo/a.txt', content: Array.from({ length: 11 }, (_, n) => `out ${n}`).join('\n') } }]),
  answered(3, 'toolu_l', { toolUseResult: {} }),
  said(4, [{ type: 'text', text: 'Done.' }]),
  row(5, 'system', { subtype: 'turn_duration', durationMs: 1000 }),
  row(6, 'user', { message: { role: 'user', content: 'next' } }),
].join('\n') + '\n'

test('an open call\'s preview pins the expand control at the right of its last row, and a click shows every line', { options: { expand_live: false, icons: 'safe' } }, async ($, on) => {
  const mount = await open($, on, LONG_OUTPUT_TURN)
  const head = await mount('UserMessage', ID(1), prompt('list it'))
  await clickLabel(head, 'toggle-turn-colored')
  await head.pointer({ in: 'toggle-chips-line', type: 'down', button: 'left', x: 1, y: 0 })
  await clickLabel(head, 'toggle-call-0-colored')
  const control = 'toggle-more-preview:toolu_l'
  expect(await head.find({ key: 'more-row-toolu_l-gap' })).toBeDefined()
  expect(await head.find({ type: 'Text', text: 'out 7' })).toBeDefined()
  expect(await head.find({ type: 'Text', text: 'out 8' })).toBeUndefined()
  expect(await labelText(head, control)).toBe(' ▾ 3 more lines ')
  await clickLabel(head, control)
  expect(await head.find({ type: 'Text', text: 'out 10' })).toBeDefined()
  expect(await labelText(head, control)).toBe(' ▴ Show less ')
  await clickLabel(head, control)
  expect(await head.find({ type: 'Text', text: 'out 8' })).toBeUndefined()
})

const turnWriting = (lines: string[]) => [
  row(1, 'user', { message: { role: 'user', content: 'list it' } }),
  said(2, [{ type: 'tool_use', id: 'toolu_l', name: 'Write', input: { file_path: '/repo/a.txt', content: lines.join('\n') } }]),
  answered(3, 'toolu_l', { toolUseResult: {} }),
  said(4, [{ type: 'text', text: 'Done.' }]),
  row(5, 'system', { subtype: 'turn_duration', durationMs: 1000 }),
  row(6, 'user', { message: { role: 'user', content: 'next' } }),
].join('\n') + '\n'

const openPreview = async ($: any, on: any, lines: string[]) => {
  const mount = await open($, on, turnWriting(lines))
  const head = await mount('UserMessage', ID(1), prompt('list it'))
  await clickLabel(head, 'toggle-turn-colored')
  await head.pointer({ in: 'toggle-chips-line', type: 'down', button: 'left', x: 1, y: 0 })
  await clickLabel(head, 'toggle-call-0-colored')
  return head
}
const previewWraps = async (head: any) => (await head.findAll({ type: 'Text' })).filter((node: any) => /^\+ row\d+ w/.test(textOf(node))).map((node: any) => node.props.wrap)
const WIDE = (n: number) => Array.from({ length: n }, (_, at) => `row${at} ${'w'.repeat(300)}`)

test('a few short preview lines show no control', { options: { expand_live: false, icons: 'safe' } }, async ($, on) => {
  const head = await openPreview($, on, ['out 0', 'out 1'])
  expect(await head.find({ type: 'Text', text: 'out 1' })).toBeDefined()
  expect(await head.find({ key: 'more-row-toolu_l-gap' })).toBeUndefined()
})

for (const icons of ['safe', 'nerd'] as const) {
  test(`icons=${icons}: a few long preview lines show Show all, which wraps each line in full and Show less cuts it again`, { options: { expand_live: false, icons } }, async ($, on) => {
    const head = await openPreview($, on, WIDE(3))
    const control = 'toggle-more-preview:toolu_l'
    expect(await head.find({ key: 'more-row-toolu_l-gap' })).toBeDefined()
    expect(await labelText(head, control)).toBe(icons === 'safe' ? ' ▾ Show all ' : ` ${String.fromCodePoint(0xf0d7)} Show all `)
    expect(await previewWraps(head)).toEqual(['truncate-end', 'truncate-end', 'truncate-end'])
    await clickLabel(head, control)
    expect(await labelText(head, control)).toBe(icons === 'safe' ? ' ▴ Show less ' : ` ${String.fromCodePoint(0xf0d8)} Show less `)
    expect(await previewWraps(head)).toEqual(['wrap', 'wrap', 'wrap'])
    const full = (await head.findAll({ type: 'Text' })).map((node: any) => textOf(node)).join('\n')
    expect(full).toContain('w'.repeat(300))
    expect(full).not.toContain('…')
    await clickLabel(head, control)
    expect(await previewWraps(head)).toEqual(['truncate-end', 'truncate-end', 'truncate-end'])
  })
}

test('a long preview of long lines keeps "N more lines" on its control and wraps every line when open', { options: { expand_live: false, icons: 'safe' } }, async ($, on) => {
  const head = await openPreview($, on, WIDE(11))
  const control = 'toggle-more-preview:toolu_l'
  expect(await labelText(head, control)).toBe(' ▾ 3 more lines ')
  await clickLabel(head, control)
  expect(await labelText(head, control)).toBe(' ▴ Show less ')
  const wraps = await previewWraps(head)
  expect(wraps).toHaveLength(11)
  expect(new Set(wraps)).toEqual(new Set(['wrap']))
})

test('a message from another session wraps its long paragraphs in full instead of cutting them', async ($, on) => {
  const mount = await open($, on)
  const long = `Budget your time ${'so the report lands early '.repeat(12)}and say what you skipped.`
  const message = await mount('UserMessage', ID(23), { text: `Deadline at 18:00.\n${long}`, origin: { kind: 'peer' }, isExpanded: false, from: { name: 'claude-67' } })
  const drawn = (await message.findAll({ type: 'Text' })).map((node: any) => textOf(node)).join('\n')
  expect(drawn).toContain('and say what you skipped.')
  expect(drawn).not.toContain('…')
})

test('a notice its head line shows whole draws no card, so its task and tool ids alone never repeat it', async ($, on) => {
  const mount = await open($, on)
  const notice = await mount('UserMessage', ID(22), { text: 'Background command "Render the reel" completed (exit code 0)', origin: { kind: 'task-notification' }, isExpanded: false, task: { id: 'b5', status: 'completed', toolUseId: 'toolu_render' } })
  expect(await notice.find({ type: 'Text', text: /b5 · completed · Background command "Render the reel"/ })).toBeDefined()
  expect(await notice.find({ type: 'Text', text: 'task b5' })).toBeUndefined()
  expect(await notice.find({ type: 'Text', text: /toolu_render/ })).toBeUndefined()
})

test('a summary too long for the head stays in the card', async ($, on) => {
  const mount = await open($, on)
  const long = `Background shell command ${'x'.repeat(200)}`
  const report = await mount('UserMessage', ID(21), { text: long, origin: { kind: 'task-notification' }, isExpanded: false, task: { id: 'b1', status: 'stopped' } })
  expect(await report.find({ type: 'Text', text: /^Background shell command$/ })).toBeDefined()
  expect(await report.find({ type: 'Text', text: /^x+$/ })).toBeDefined()
  expect(await report.find({ type: 'Text', text: /stopped · Background shell command/ })).toBeDefined()
})

// A subagent's hand-back, sent from task a2, and the notice that task a2 finished in 15m 52s.
const HANDBACK = { text: 'Spike and checks: ctrl+o works\nl2', origin: { kind: 'peer', senderTaskId: 'a2' }, from: { name: 'general-purpose' }, isExpanded: false }
const NOTICE = { text: 'Agent "Live checks" finished', origin: { kind: 'task-notification' }, task: { id: 'a2', status: 'completed', durationMs: 952121 }, isExpanded: false }

const REPORT_TURN = [
  row(1, 'user', { message: { role: 'user', content: 'first' } }),
  row(2, 'user', { isMeta: true, origin: { kind: 'peer' }, message: { role: 'user', content: 'Another Claude session sent a message: report' } }),
  said(3, [{ type: 'text', text: 'Noted.' }]),
]
const LATEST_REPORT = REPORT_TURN.join('\n') + '\n'
const OLD_REPORT = [...REPORT_TURN, row(4, 'user', { message: { role: 'user', content: 'second' } })].join('\n') + '\n'

test('a report drawn before its notice takes the notice status and time, and the notice then draws nothing', async ($, on) => {
  const mount = await open($, on)
  const report = await mount('UserMessage', ID(20), HANDBACK)
  expect(await report.find({ type: 'Text', text: /general-purpose · Spike and checks/ })).toBeDefined()
  const notice = await mount('UserMessage', ID(21), NOTICE)
  expect(await notice.find({ type: 'Text', text: /Agent "Live checks" finished/ })).toBeUndefined()
  expect(await report.find({ type: 'Text', text: /general-purpose · completed · 15m 52s · Spike and checks: ctrl\+o works$/ })).toBeDefined()
})

test('a notice drawn before its report draws nothing once the report comes, and the report takes its status and time', async ($, on) => {
  const mount = await open($, on)
  const notice = await mount('UserMessage', ID(21), NOTICE)
  expect(await notice.find({ type: 'Text', text: /Agent "Live checks" finished/ })).toBeDefined()
  const report = await mount('UserMessage', ID(20), HANDBACK)
  expect(await report.find({ type: 'Text', text: /general-purpose · completed · 15m 52s · Spike and checks/ })).toBeDefined()
  expect(await notice.find({ type: 'Text', text: /Agent "Live checks" finished/ })).toBeUndefined()
})

test('a notice with no report keeps its line', async ($, on) => {
  const mount = await open($, on)
  const notice = await mount('UserMessage', ID(21), NOTICE)
  expect(await notice.find({ type: 'Text', text: /a2 · completed · 15m 52s · Agent "Live checks" finished/ })).toBeDefined()
})

test('an old report draws only its head line', async ($, on) => {
  const mount = await open($, on, OLD_REPORT)
  const report = await mount('UserMessage', ID(2), HANDBACK)
  expect(await labelText(report, 'toggle-report-fold-colored')).toMatch(/general-purpose · Spike and checks/)
  expect(await report.find({ type: 'Text', text: /l2/ })).toBeUndefined()
})

test('a click on an old report head opens its body, and a second click folds it again', async ($, on) => {
  const mount = await open($, on, OLD_REPORT)
  const report = await mount('UserMessage', ID(2), HANDBACK)
  await clickLabel(report, 'toggle-report-fold-colored')
  expect(await report.find({ type: 'Text', text: /l2/ })).toBeDefined()
  await clickLabel(report, 'toggle-report-fold-colored')
  expect(await report.find({ type: 'Text', text: /l2/ })).toBeUndefined()
})

test('the latest report stays open until the next prompt', async ($, on) => {
  const mount = await open($, on, LATEST_REPORT)
  const report = await mount('UserMessage', ID(2), HANDBACK)
  expect(await report.find({ type: 'Text', text: /l2/ })).toBeDefined()
})

test('with fold_turns off, an old report stays open', { options: { fold_turns: false } }, async ($, on) => {
  const mount = await open($, on, OLD_REPORT)
  const report = await mount('UserMessage', ID(2), HANDBACK)
  expect(await report.find({ type: 'Text', text: /l2/ })).toBeDefined()
})

test('a notice that comes after a folded report shows its status and time in the report head', async ($, on) => {
  const mount = await open($, on, OLD_REPORT)
  const report = await mount('UserMessage', ID(2), HANDBACK)
  await mount('UserMessage', ID(21), NOTICE)
  expect(await labelText(report, 'toggle-report-fold-colored')).toMatch(/general-purpose · completed · 15m 52s/)
})

test('a diff preview keeps the indentation of its lines', async ($, on) => {
  const mount = await open($, on, EDIT_TURN)
  const head = await mount('UserMessage', ID(1), prompt('edit it'))
  await clickLabel(head, 'toggle-turn-colored')
  await head.pointer({ in: 'toggle-chips-line', type: 'down', button: 'left', x: 1, y: 0 })
  await clickLabel(head, 'toggle-call-0-colored')
  expect(await head.find({ type: 'Text', text: /\+ {5}indented\(\)/ })).toBeDefined()
})

test('turn.complete hands the turn on before it reads the session messages', async ($, on) => {
  const order: string[] = []
  on('session.messages', () => {
    order.push('messages')
    return { value: [] }
  })
  on('turn.complete', () => {
    order.push('next')
    return { text: '' }
  })
  await open($, on, EDIT_TURN)
  await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false } as never)
  expect(order).toEqual(['next', 'messages'])
})

test('a transcript read that failed is read again on the next turn', async ($, on) => {
  let reads = 0
  on('turn.complete', () => ({ text: '' }))
  on('process.spawn', async function* () {
    throw new Error('cat failed')
  })
  await open($, on, EDIT_TURN, () => {
    reads += 1
    return reads === 1 ? '' : EDIT_TURN
  })
  expect(reads).toBe(1)
  await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false } as never)
  expect(reads).toBe(2)
})

test('a turn cancelled before any reply still closes its card under the head', async ($, on) => {
  const mount = await open($, on, [
    row(1, 'user', { message: { role: 'user', content: 'run it' } }),
    said(2, [{ type: 'tool_use', id: 'toolu_s', name: 'Bash', input: { command: 'sleep 40' } }]),
    row(3, 'user', { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_s', content: 'Interrupted', is_error: true }] } }),
    row(4, 'user', { message: { role: 'user', content: '[Request interrupted by user for tool use]' } }),
    row(5, 'user', { message: { role: 'user', content: 'after' } }),
  ].join('\n') + '\n')
  const head = await mount('UserMessage', ID(1), prompt('run it'))
  expect(await labelText(head, 'toggle-turn-colored')).toMatch(/^1 tool/)
  expect(await head.find({ key: 'toggle-head-frame-bottom' })).toBeDefined()
})

test('a turn with a reply leaves the closing to the reply row', async ($, on) => {
  const mount = await open($, on, EDIT_TURN)
  const head = await mount('UserMessage', ID(1), prompt('edit it'))
  expect(await labelText(head, 'toggle-turn-colored')).toMatch(/^1 tool/)
  expect(await head.find({ key: 'toggle-head-frame-bottom' })).toBeUndefined()
})

// A stand-in surface that counts running timers, since a long session mounts a fold and a copy pill per turn.
function fakeSurface() {
  const running = new Set<() => void>()
  let pointer: (event: any) => void = () => {}
  const surface: any = {
    elements: { Box: (props: any) => props, Text: (props: any) => props },
    state: undefined,
    columns: 30,
    setState: (state: any) => (surface.state = state),
    every: (_ms: number, fn: () => void) => {
      running.add(fn)
      return () => running.delete(fn)
    },
    onPointer: (handler: (event: any) => void) => (pointer = handler),
    post: () => {},
  }
  return { surface, running, point: (event: object) => pointer(event), tick: () => [...running].forEach(fn => fn()) }
}

test('a pill at rest runs no timer: fold and copy pills tick only while hovered or fading', () => {
  const fold = fakeSurface()
  const foldProps = { kind: 'turns', id: 't', color: THEME.muted, isOpen: false, nerd: false, still: false, glyphs: { open: '−', closed: '+' } } as never
  Fold(foldProps, fold.surface)
  expect(fold.running.size).toBe(0)
  fold.point({ type: 'move', x: 0, y: 0 })
  Fold(foldProps, fold.surface)
  expect(fold.running.size).toBe(1)
  fold.point({ type: 'leave', x: 0, y: 0 })
  for (let n = 0; n < 5; n++) fold.tick()
  expect(fold.running.size).toBe(0)

  const copy = fakeSurface()
  const copyProps = { id: 't', choices: [{ what: 'text', label: 'text' }], icon: 'c', copied: 'copied {what}', bg: THEME.surface2, nerd: false, lead: { char: '─', color: THEME.border } } as never
  Copy(copyProps, copy.surface)
  expect(copy.running.size).toBe(0)
  copy.point({ type: 'move', x: 29, y: 0 })
  Copy(copyProps, copy.surface)
  expect(copy.running.size).toBe(1)
  copy.point({ type: 'leave', x: 0, y: 0 })
  copy.tick()
  expect(copy.running.size).toBe(0)
})

const kindChips = (still: boolean) => ({
  id: 't',
  nerd: false,
  still,
  chips: [
    { kind: 'edit', mark: '±', label: 'Edited', count: 1, added: 0, removed: 0, isOpen: true },
    { kind: 'read', mark: '≡', label: 'Read', count: 2, added: 0, removed: 0, isOpen: false },
  ],
}) as never

test('a kind chip lights its label under the pointer, keeps its tip, and fades back; the open chip is surface3, never lifted', () => {
  const line = fakeSurface()
  const posts: any[] = []
  line.surface.post = (data: any) => posts.push(data)
  const props = kindChips(false)
  const drawn = () => JSON.stringify(Chips(props, line.surface))
  const rest = drawn()
  expect(rest).not.toContain(THEME.lifted)
  expect(rest).toContain(`"backgroundColor":"${THEME.surface3}"`)
  expect(rest).toContain(`"backgroundColor":"${THEME.surface2}"`)
  expect(rest).not.toContain(`"color":"${THEME.accent}"`)

  line.point({ type: 'move', x: 20, y: 0 })
  expect(drawn()).toContain(`"color":"${THEME.accent}"`)
  expect(posts).toEqual([{ type: 'tip', id: 'chip-t', glyph: '', label: 'Read', text: 'shows the files Claude read' }])

  line.point({ type: 'leave', x: 20, y: 0 })
  line.tick()
  expect(drawn()).toContain(`"color":"${mix(THEME.muted, THEME.accent, 0.5)}"`)
  line.tick()
  expect(drawn()).not.toContain(`"color":"${THEME.accent}"`)
  line.tick()
  expect(line.running.size).toBe(0)
  expect(posts.at(-1)).toEqual({ type: 'tip', id: null })
})

test('with animations off a kind chip, the fold chip and the running dot switch at once and never blink', () => {
  const line = fakeSurface()
  const props = kindChips(true)
  Chips(props, line.surface)
  line.point({ type: 'move', x: 20, y: 0 })
  expect(JSON.stringify(Chips(props, line.surface))).toContain(`"color":"${THEME.accent}"`)
  line.point({ type: 'leave', x: 20, y: 0 })
  expect(JSON.stringify(Chips(props, line.surface))).not.toContain(`"color":"${THEME.accent}"`)

  const fold = fakeSurface()
  const foldProps = { kind: 'turns', id: 't', color: THEME.muted, isOpen: false, nerd: false, still: true, glyphs: { open: '−', closed: '+' } } as never
  Fold(foldProps, fold.surface)
  fold.point({ type: 'move', x: 0, y: 0 })
  expect(JSON.stringify(Fold(foldProps, fold.surface))).toContain(`"color":"${THEME.accent}"`)
  fold.point({ type: 'leave', x: 0, y: 0 })
  expect(JSON.stringify(Fold(foldProps, fold.surface))).not.toContain(`"color":"${THEME.accent}"`)

  const dot = fakeSurface()
  Dot({ color: THEME.accent, dim: THEME.border, still: true }, dot.surface)
  expect(dot.running.size).toBe(0)
  const blinking = fakeSurface()
  Dot({ color: THEME.accent, dim: THEME.border, still: false }, blinking.surface)
  expect(blinking.running.size).toBe(1)
})

test('the fold chip is a surface3 pill whose mark takes its color at rest and accent under the pointer', () => {
  const chip = fakeSurface()
  const props = { kind: 'tools', id: 't', color: THEME.alert, isOpen: true, nerd: false, still: false, glyphs: { open: '−', closed: '+' } } as never
  const rest = JSON.stringify(Fold(props, chip.surface))
  expect(rest).toContain(`"backgroundColor":"${THEME.surface3}"`)
  expect(rest).toContain(`"color":"${THEME.alert}"`)
  expect(rest).toContain('−')
  chip.point({ type: 'move', x: 0, y: 0 })
  expect(JSON.stringify(Fold(props, chip.surface))).toContain(`"color":"${THEME.accent}"`)
})

test('two turns opened at once both stay open', async ($, on) => {
  const mount = await open($, on, TWO_TURNS)
  const first = await mount('UserMessage', ID(1), prompt('first'))
  const second = await mount('UserMessage', ID(6), prompt('second'))
  await Promise.all([clickLabel(first, 'toggle-turn-colored'), clickLabel(second, 'toggle-turn-colored')])
  expect((await first.find({ type: 'Client', key: 'toggle-turn-chip' }))?.props.props.isOpen).toBe(true)
  expect((await second.find({ type: 'Client', key: 'toggle-turn-chip' }))?.props.props.isOpen).toBe(true)
})

// mod-transcript / tests/drawing.test.tsx, by v-amorim
// Tests how finished turns, edits and diffs are drawn from transcript rows.
import { expect, mock, test } from 'claude-code/testing'

import { cells } from '../hooks/cells'
import Chips from '../hooks/chips'
import Copy from '../hooks/copy'
import Dot from '../hooks/dot'
import Fold from '../hooks/fold'
import { shownWidth } from '../hooks/prose'
import { CAPS, mix, SYNTAX, THEME } from '../hooks/theme'
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
// `files` are the paths that exist under the session folder /w and home /home; any other path there is missing, as a reply's path usually is.
async function open($: any, on: any, text = '', reads: () => string = () => text, editor: Record<string, string> = {}, files: string[] = []) {
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.stat', (_$: unknown, e: { path: string }) => {
    // Windows puts a drive in front of the path the mod asked for.
    const path = String(e.path).replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
    if (/^\/(w|home)\//.test(path) && !files.includes(path)) throw new Error('ENOENT')
    return { value: { kind: 'file', size: text.length, mtimeMs: 0, isLink: false } }
  })
  // `editor` holds the files of a VS Code install, by path; any other path reads as the transcript.
  const inEditor = (path: string) => Object.keys(editor).find(file => String(path).replace(/\\/g, '/').endsWith(file))
  on('fs.read', reading((_$: unknown, e: { path: string }) => ({ value: inEditor(e.path) ? editor[inEditor(e.path)!]! : reads() })))
  if (Object.keys(editor).length) {
    on('fs.list', (_$: unknown, e: { path: string }) => {
      const base = String(e.path).replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
      const names = Object.keys(editor).filter(file => file.startsWith(`${base}/`)).map(file => file.slice(base.length + 1).split('/')[0]!)
      if (!names.length) throw new Error('missing')
      return { value: [...new Set(names)].map(name => ({ name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false })) }
    })
  }
  const clock = mock.clock(on)
  on('session.start', () => ({ cwd: '/w' }))
  on('session.cwd', () => ({ value: '/w' }))
  // What each component's `ui.resolve` gave for Link when it drew.
  const linked: Record<string, string> = {}
  mock.env(on, { USERPROFILE: '/home', APPDATA: '/home/AppData/Roaming' })
  on('ui.render', ($$: any, e: any) => {
    const { Text, Link } = $$.ui.resolve(e)
    linked[e.component] = typeof Link
    return <Text>{`base ${e.component}`}</Text>
  })
  await sessionStarted($, clock, 's1', '/t/s1.jsonl', 'startup')
  const mount = (component: string, requestId: string, props: object, columns = 120) =>
    $.ui.mount({ plugin: 'mod-transcript', surface: 'terminal', component, requestId, viewport: { columns, rows: 40 }, props } as never)
  // A hook event, as the command hook writes it into the bridge file.
  return Object.assign(mount, { linked, hook: (record: Record<string, unknown>) => feed($, clock, { session_id: 's1', ...record }) })
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

test('a hex color in a sentence shows as its pill where it is written, with no strip, and a reply naming none stays as drawn', async ($, on) => {
  const mount = await open($, on)
  const reply = await mount('AssistantMessage', ID(7), { text: 'Low is `#ACB9E6` and max is #FF6F7A.', isFirstOfReply: true })
  expect(await reply.find({ type: 'Text', text: 'base AssistantMessage' })).toBeUndefined()
  expect(await reply.find({ key: 'toggle-colors' })).toBeUndefined()
  const squares = await reply.findAll({ type: 'Text', text: '●' })
  expect(squares.map((square: any) => square.props.color).filter(Boolean)).toEqual(['#ACB9E6', '#FF6F7A'])
  expect(await reply.find({ type: 'Text', text: ' #FF6F7A' })).toBeDefined()
  expect(JSON.stringify(await reply.drawn())).toMatch(/Low is [^]*#ACB9E6[^]* and max is [^]*#FF6F7A[^]*\./)
  const plain = await mount('AssistantMessage', ID(8), { text: 'See prompt #229.', isFirstOfReply: true })
  expect(await plain.find({ type: 'Text', text: 'base AssistantMessage' })).toBeDefined()
  expect(await plain.find({ type: 'Text', text: '●' })).toBeUndefined()
})

test('a reply that puts one color per line keeps each on its own row', async ($, on) => {
  const mount = await open($, on)
  const reply = await mount('AssistantMessage', ID(7), { text: 'low #ACB9E6\nhigh #EA98EE\nmax #FF6F7A80', isFirstOfReply: true })
  const rows = (await reply.find({ key: 'toggle-prose-0' })) as { children: unknown[] }
  expect(rows.children.length).toBe(3)
})

test('a hex color in a block the mod leaves to Claude Code, such as a level-4 heading, stays in the strip; one in a table cell is a pill in the cell', async ($, on) => {
  const mount = await open($, on)
  const heading = await mount('AssistantMessage', ID(7), { text: '#### Accent #7386D0\n\nPlain words.', isFirstOfReply: true })
  expect(await heading.find({ type: 'Text', text: 'base AssistantMessage' })).toBeDefined()
  expect(await heading.find({ key: 'toggle-colors' })).toBeDefined()
  const table = await mount('AssistantMessage', ID(8), { text: '| Role | Color |\n| --- | --- |\n| accent | #7386D0 |', isFirstOfReply: true })
  expect(await table.find({ key: 'toggle-colors' })).toBeUndefined()
  expect((await table.findAll({ type: 'Text', text: '●' })).some((square: any) => square.props.color === '#7386D0')).toBe(true)
})

const TABLE_REPLY = 'Here is where each mod draws:\n\n| Mod | Surface | Rows |\n| --- | --- | ---: |\n| `blast-radius` | band + pane | 42 |\n| file-tree | pane | 318 |\n\nThe transcript is the busiest.'

test('a reply table draws caps headers in the dim colour, hairlines between rows, no sides, and numbers aligned right', async ($, on) => {
  const mount = await open($, on)
  const reply = await mount('AssistantMessage', ID(7), { text: TABLE_REPLY, isFirstOfReply: true })
  expect(await reply.find({ type: 'Text', text: 'base AssistantMessage' })).toBeUndefined()
  const drawn = JSON.stringify(await reply.drawn())
  expect(drawn).toContain('MOD')
  expect((await reply.find({ type: 'Text', text: /^SURFACE/ }))?.props.color).toBe('#7E86A4')
  expect((await reply.findAll({ type: 'Text', text: /^\s*blast-radius\s*$/ })).some((cell: any) => cell.props.bold === true)).toBe(true)
  expect((await reply.findAll({ type: 'Text', text: /^\s*blast-radius\s*$/ })).some((cell: any) => cell.props.color === THEME.ok && cell.props.backgroundColor === THEME.surface3)).toBe(true)
  expect(await reply.find({ type: 'Text', text: /^ {2}42$/ })).toBeDefined()
  expect(await reply.find({ type: 'Text', text: /^─+┼─+┼─+$/ })).toBeDefined()
  expect((await reply.findAll({ type: 'Text', text: ' │ ' })).filter((bar: any) => bar.props?.color).map((bar: any) => bar.props.color)).toEqual(Array(6).fill(THEME.border))
  expect(drawn).not.toContain('|')
  expect(await reply.find({ type: 'Markdown', props: { text: 'The transcript is the busiest.' } } as never)).toBeDefined()
})

test('a reply table that cannot fit even with every column at its narrowest goes back to Claude Code\'s own table', async ($, on) => {
  const mount = await open($, on)
  const cols = Array.from({ length: 12 }, (_, k) => `word${k}`)
  const wide = `| ${cols.join(' | ')} |\n| ${cols.map(() => '---').join(' | ')} |\n| ${cols.join(' | ')} |`
  const reply = await mount('AssistantMessage', ID(7), { text: wide, isFirstOfReply: true }, 40)
  expect(await reply.find({ type: 'Text', text: 'base AssistantMessage' })).toBeDefined()
})

// The text of each line a table drew, rules included, in order.
const tableLines = async (reply: any, at = 0) => {
  const table = (await reply.find({ key: `toggle-table-${at}` })) as any
  return (table.children as any[]).flat(Infinity).map(line => textOf(line) as string)
}
const isRule = (line: string) => /^─+(┼─+)*$/.test(line)
// The lines of each row, header first, split at the hairlines.
const rowsOf = (lines: string[]) => lines.reduce<string[][]>((rows, line) => (isRule(line) ? [...rows, []] : (rows.at(-1)!.push(line), rows)), [[]])
const PROSE = 'Draws every row as one line, wraps a long sentence onto as many lines as it needs, and keeps its pills whole.'
const LONG = `| Name | Kind | Rows | Notes |\n| --- | --- | ---: | --- |\n| alpha | pane | 42 | ${PROSE} ${PROSE} |\n| beta | band | 7 | short |`

test('a table with sentence-long cells keeps the mod\'s look at 120 columns, shrinking the widest column, and every line fits', async ($, on) => {
  const reply = await replyOf($, on, LONG)
  expect(await reply.find({ type: 'Text', text: 'base AssistantMessage' })).toBeUndefined()
  const lines = await tableLines(reply)
  expect(lines.length).toBeGreaterThan(5)
  for (const line of lines) expect(cells(line)).toBeLessThanOrEqual(108)
  expect(lines[0]).toMatch(/^NAME\s+│\s+KIND\s+│\s+ROWS\s+│\s+NOTES\s*$/)
})

test('a long cell wraps and its row grows to the tallest cell, with the bars on every line and one hairline between rows', async ($, on) => {
  const reply = await replyOf($, on, LONG)
  const lines = await tableLines(reply)
  const [head, alpha, beta] = rowsOf(lines)
  expect(lines.filter(isRule)).toHaveLength(2)
  expect(lines.filter(isRule).every(rule => /^─+┼─+┼─+┼─+$/.test(rule))).toBe(true)
  expect(head).toHaveLength(1)
  expect(alpha!.length).toBeGreaterThan(2)
  expect(beta).toHaveLength(1)
  for (const line of lines.filter(line => !isRule(line))) expect(line.match(/│/g)).toHaveLength(3)
})

test('the bold first column and the right-aligned numbers hold on every wrapped line', async ($, on) => {
  const reply = await replyOf($, on, LONG)
  expect(((await textsOf(reply, /^alpha\s*$/)) as any[]).every(cell => cell.props.bold === true)).toBe(true)
  const numbers = rowsOf(await tableLines(reply))[1]!.map(line => line.split('│')[2]!)
  expect(new Set(numbers.map(cell => cell.length)).size).toBe(1)
  expect(numbers.filter(cell => cell.trim())).toHaveLength(1)
  expect(numbers[0]!.endsWith('42 ')).toBe(true)
  expect(numbers.slice(1).every(cell => cell.trim() === '')).toBe(true)
})

test('a hex code, inline code and a link inside a wrapped cell stay whole, and the hex code is not in the strip', async ($, on) => {
  const note = `${PROSE} The accent is #7386D0 and run \`just test --all\` then see [the docs](https://example.com/docs) ${PROSE}`
  const reply = await replyOf($, on, `| Role | Note |\n| --- | --- |\n| accent | ${note} |`, 60)
  expect(await reply.find({ type: 'Text', text: 'base AssistantMessage' })).toBeUndefined()
  expect(await reply.find({ key: 'toggle-colors' })).toBeUndefined()
  expect((await reply.findAll({ type: 'Text', text: '●' })).some((square: any) => square.props.color === '#7386D0')).toBe(true)
  expect(await textsOf(reply, /^\s*just test --all\s*$/)).toHaveLength(1)
  expect(((await reply.findAll({ type: 'Link' })) as any[]).map(link => link.props.href)).toEqual(['https://example.com/docs'])
  expect(await textsOf(reply, /^\s*the docs\s*$/)).toHaveLength(1)
})

test('a header word is never split, and a column shrinks no narrower than its longest unbreakable token', async ($, on) => {
  const prose = 'word '.repeat(60)
  const reply = await replyOf($, on, `| Configuration | Notes |\n| --- | --- |\n| a | ${prose} |`, 60)
  const lines = await tableLines(reply)
  expect(lines[0]).toMatch(/^CONFIGURATION\s+│\s+NOTES\s*$/)
  for (const line of lines) expect(cells(line)).toBeLessThanOrEqual(54)
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
  // sourcery skip: generators-should-yield
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
  Dot({ color: THEME.accent, still: true }, dot.surface)
  expect(dot.running.size).toBe(0)
  const blinking = fakeSurface()
  Dot({ color: THEME.accent, still: false }, blinking.surface)
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

// A reply drawn in the mod's own look, the engine's markdown standing in for what it leaves.
const replyOf = async ($: any, on: any, body: string, columns = 120, files: string[] = []) => {
  const mount = await open($, on, '', undefined, {}, files)
  return mount('AssistantMessage', ID(7), { text: body, isFirstOfReply: true }, columns)
}
// The innermost Texts that match: a Text around them matches too, with none of their props.
const textsOf = async (ui: any, text: string | RegExp) => ((await ui.findAll({ type: 'Text', text })) as any[]).filter(node => !JSON.stringify(node.children ?? []).includes('"type":"Text"'))

for (const icons of ['safe', 'nerd'] as const) {
  test(`icons=${icons}: inline code is a surface3 pill with primary-70 text, caps or one padding cell, and a hex code stays a hex pill`, { options: { icons } }, async ($, on) => {
    const reply = await replyOf($, on, 'Run `just test` and see `#ACB9E6` or #FF6F7A.')
    const code = (await textsOf(reply, /^\s*just test\s*$/))[0]
    expect(code.props.color).toBe(THEME.ok)
    expect(code.props.backgroundColor).toBe(THEME.surface3)
    expect(textOf(code)).toBe(icons === 'safe' ? ' just test ' : 'just test')
    expect((await textsOf(reply, CAPS.left)).some((cap: any) => cap.props.color === THEME.surface3)).toBe(icons === 'nerd')
    expect((await textsOf(reply, /#ACB9E6/)).some((hex: any) => hex.props.backgroundColor === THEME.surface3 && hex.props.color === THEME.ok)).toBe(false)
    expect((await reply.findAll({ type: 'Text', text: '●' })).map((square: any) => square.props.color)).toContain('#ACB9E6')
  })
}

test('shownWidth counts the two cells a code pill adds, but not for a code span that holds a hex pill', () => {
  expect(shownWidth('a `bc` d')).toBe('a bc d'.length + 2)
  expect(shownWidth('see `#ACB9E6`')).toBe('see #ACB9E6'.length + 4)
})

const VSCODE_ICON = String.fromCodePoint(0xf0a1e)
const GLOBE_ICON = String.fromCodePoint(0xf0ac)
// A heading makes the reply the mod's own, so its paragraphs draw as pills.
const LINKED = '## Where\n\nIt lives in `src/a.ts:12:3` and not in `src/gone.ts`, see [the post](https://example.com/p) or https://example.com/q.'

for (const icons of ['safe', 'nerd'] as const) {
  test(`icons=${icons}: a path that exists is one Link pill to VS Code with its icon leading in Nerd mode; a path that does not stays a code pill`, { options: { icons } }, async ($, on) => {
    const reply = await replyOf($, on, LINKED, 120, ['/w/src/a.ts'])
    await reply.redraw()
    const links = (await reply.findAll({ type: 'Link' })) as any[]
    const path = links.find(link => String(link.props.href).startsWith('vscode://'))
    expect(path.props.href).toBe('vscode://file/w/src/a.ts:12:3')
    expect(textOf(path)).toBe(icons === 'nerd' ? `${CAPS.left}${VSCODE_ICON} src/a.ts:12:3${CAPS.right}` : ' src/a.ts:12:3 ')
    const name = (await textsOf(reply, 'src/a.ts:12:3'))[0]
    expect(name.props).toMatchObject({ color: THEME.secondary, underline: true })
    expect((await textsOf(reply, new RegExp(VSCODE_ICON))).map((icon: any) => icon.props.color)).toEqual(icons === 'nerd' ? [THEME.secondary] : [])
    expect(JSON.stringify(path)).toContain(THEME.surface3)
    const gone = (await textsOf(reply, /src\/gone\.ts/))[0]
    expect(gone.props).toMatchObject({ color: THEME.ok, backgroundColor: THEME.surface3 })
    expect(gone.props.underline).toBeUndefined()
  })

  test(`icons=${icons}: a web link, written as markdown or bare, is a Link pill with the globe leading in Nerd mode`, { options: { icons } }, async ($, on) => {
    const reply = await replyOf($, on, LINKED)
    const links = (await reply.findAll({ type: 'Link' })) as any[]
    expect(links.map(link => link.props.href)).toEqual(['https://example.com/p', 'https://example.com/q'])
    expect(textOf(links[0])).toBe(icons === 'nerd' ? `${CAPS.left}${GLOBE_ICON} the post${CAPS.right}` : ' the post ')
    expect((await textsOf(reply, 'the post'))[0].props).toMatchObject({ color: THEME.secondary, underline: true })
    expect((await textsOf(reply, new RegExp(GLOBE_ICON))).map((icon: any) => icon.props.color)).toEqual(icons === 'nerd' ? [THEME.secondary, THEME.secondary] : [])
  })
}

test('a path becomes a link only once its stat answers, so the first draw never waits on the disk', async ($, on) => {
  const reply = await replyOf($, on, '## Where\n\nIt lives in `src/a.ts`.', 120, ['/w/src/a.ts'])
  expect(await textsOf(reply, /src\/a\.ts/)).toHaveLength(1)
  await reply.redraw()
  expect(await reply.findAll({ type: 'Link' })).toHaveLength(1)
})

test('a reply that only names a path draws it as a link once the path exists', async ($, on) => {
  const reply = await replyOf($, on, 'Edited `src/a.ts`.', 120, ['/w/src/a.ts'])
  await reply.redraw()
  expect(((await reply.findAll({ type: 'Link' })) as any[]).map(link => link.props.href)).toEqual(['vscode://file/w/src/a.ts'])
})

test('a reply that names a path which does not exist stays Claude Code\'s', async ($, on) => {
  const reply = await replyOf($, on, 'Edited `src/gone.ts`.')
  await reply.redraw()
  expect(await reply.find({ type: 'Text', text: 'base AssistantMessage' })).toBeDefined()
})

test('a relative path resolves against the session folder, ~ against home, and a bare path that exists links too', async ($, on) => {
  const reply = await replyOf($, on, 'See ./b.ts, `~/notes.md` and src/missing.ts.', 120, ['/w/b.ts', '/home/notes.md'])
  await reply.redraw()
  expect(((await reply.findAll({ type: 'Link' })) as any[]).map(link => link.props.href)).toEqual(['vscode://file/w/b.ts', 'vscode://file/home/notes.md'])
})

test('a link inside a table body cell is drawn, and the column is as wide as the pill', async ($, on) => {
  const reply = await replyOf($, on, '| File | Note |\n|---|---|\n| `src/a.ts` | see [docs](https://example.com) |', 120, ['/w/src/a.ts'])
  await reply.redraw()
  expect(((await reply.findAll({ type: 'Link' })) as any[]).map(link => link.props.href)).toEqual(['vscode://file/w/src/a.ts', 'https://example.com'])
})

test('Link is in the elements AssistantMessage and the tool rows draw with', async ($, on) => {
  const mount = await open($, on)
  await (await mount('AssistantMessage', ID(7), { text: 'Done.', isFirstOfReply: true })).unmount()
  await mount('ToolUse', 'toolu_x', { tool_use_id: 'toolu_x', tool: 'Read', input: { file_path: '/repo/x.ts' }, isRunning: true, isErrored: false, isInterrupted: false, output: {} })
  await mount('ToolResult', 'toolu_x', { tool_use_id: 'toolu_x', tool: 'Read', input: { file_path: '/repo/x.ts' }, output: {} })
  await mount('ToolGroup', 'group', { calls: [{ tool_use_id: 'toolu_x', tool: 'Read', input: { file_path: '/repo/x.ts' }, isRunning: true, output: {} }] })
  expect(mount.linked).toMatchObject({ AssistantMessage: 'function', ToolUse: 'function', ToolResult: 'function' })
})

test('shownWidth counts the cells a link pill adds, the code pill\'s two already counted, in each icon mode', () => {
  const open = (token: string) => (token.startsWith('src/') ? `vscode://file/w/${token}` : undefined)
  const fake = (nerd: boolean) => ({ colors: new Map(), nerd, links: { Link: (props: any) => props, open } })
  expect(shownWidth('see `src/a.ts`', fake(true))).toBe('see src/a.ts'.length + 4)
  expect(shownWidth('see `src/a.ts`', fake(false))).toBe('see src/a.ts'.length + 2)
  expect(shownWidth('see `other`', fake(true))).toBe('see other'.length + 2)
  expect(shownWidth('[post](https://e.com) and https://e.com/q and src/b.ts', fake(true))).toBe('post and https://e.com/q and src/b.ts'.length + 12)
  expect(shownWidth('[post](https://e.com) and https://e.com/q and src/b.ts', fake(false))).toBe('post and https://e.com/q and src/b.ts'.length + 6)
  expect(shownWidth('see `src/a.ts`')).toBe('see src/a.ts'.length + 2)
})

test('a reply with only inline code and links stays Claude Code\'s', async ($, on) => {
  const reply = await replyOf($, on, 'Run `just test`, see [the post](https://example.com).')
  expect(await reply.find({ type: 'Text', text: 'base AssistantMessage' })).toBeDefined()
})

test('a link is secondary text, underlined', async ($, on) => {
  const reply = await replyOf($, on, 'See [the post](https://example.com) for #FF6F7A.')
  const link = (await textsOf(reply, 'the post'))[0]
  expect(link.props.color).toBe(THEME.secondary)
  expect(link.props.underline).toBe(true)
})

const CODE_REPLY = 'Here is the helper:\n\n```ts\nexport function total(items) {\n  return items.length\n}\n```\n\nDone.'
const CODE_ID = `${ID(7)}:1`

for (const icons of ['safe', 'nerd'] as const) {
  test(`icons=${icons}: a fenced block is a round card with the language on its edge, dim line numbers, a hairline and a copy pill that copies the block`, { options: { icons } }, async ($, on) => {
    const copied: string[] = []
    on('ui.copy', (_$: unknown, e: { text: string }) => {
      copied.push(e.text)
      return { value: { isCopied: true } }
    })
    const reply = await replyOf($, on, CODE_REPLY)
    expect(await reply.find({ type: 'Text', text: 'base AssistantMessage' })).toBeUndefined()
    expect((await textsOf(reply, / TS /))[0].props.color).toBe('#7E86A4')
    expect(textOf(await reply.find({ key: 'toggle-code-1-top' }))).toMatch(/^╭─ TS ─+.*─╮$/)
    // The run is drawn longer than the card, so the tag must not shrink: live it lost its last letter to an ellipsis ("T…").
    expect((await reply.find({ key: 'toggle-code-1-tag' }))?.props.flexShrink).toBe(0)
    expect((await reply.find({ key: 'toggle-code-1-run' }))?.props).toMatchObject({ height: 1, overflow: 'hidden' })
    expect((await textsOf(reply, '3'))[0].props.color).toBe('#7E86A4')
    expect((await textsOf(reply, ' │ ')).every((bar: any) => bar.props.color === THEME.border)).toBe(true)
    const line = await reply.find({ key: 'toggle-code-1-row-1-0-in' })
    expect(textOf(line)).toMatch(/2 │   return items\.length$/)
    // The palette colors a ts block until a VS Code theme resolves: the keyword in the command color, the rest in the property and surface colors.
    expect((await textsOf(reply, 'return'))[0].props.color).toBe(SYNTAX.command)
    expect((await textsOf(reply, 'length'))[0].props.color).toBe(SYNTAX.variable)
    expect((await reply.find({ key: 'toggle-code-1-row-0-0-in' }))?.props.backgroundColor).toBe(THEME.surface1)
    expect(JSON.stringify(await reply.drawn())).toMatch(/╰─{112}╯/)
    expect((await textsOf(reply, CAPS.left)).some((cap: any) => cap.props.color === THEME.surface3)).toBe(icons === 'nerd')
    const pill = await reply.find({ type: 'Client', key: `toggle-copy-code-pill-${CODE_ID}` })
    expect(pill.props.props).toMatchObject({ label: 'copy', bg: THEME.surface3, lead: icons === 'safe' ? '⧉' : String.fromCodePoint(0xf018f), tip: { label: 'Copy code' } })
    await clickLabel(reply, `toggle-copy-code-pill-${CODE_ID}`)
    expect(copied).toEqual(['export function total(items) {\n  return items.length\n}'])
    // The pill itself says it copied: a toast would add a band card and push the prompt down.
    const after = await reply.find({ type: 'Client', key: `toggle-copy-code-pill-${CODE_ID}` })
    expect(after.props.props).toMatchObject({ label: 'copied code', idle: THEME.muted })
  })
}

test('a code line wider than the card wraps under the code column, not under the gutter', async ($, on) => {
  const reply = await replyOf($, on, `\`\`\`\n${'x'.repeat(130)}\n\`\`\``)
  const rows = (await textsOf(reply, /^x+$/)).map((row: any) => textOf(row).length)
  expect(rows).toEqual([106, 24])
  expect(await textsOf(reply, '1')).toHaveLength(1)
})

test('what a fence holds is never read as a table, heading or callout', async ($, on) => {
  const reply = await replyOf($, on, '```md\n# Not a heading\n> **Note:** not a callout\n| a | b |\n| --- | --- |\n| 1 | 2 |\n```')
  expect(await reply.find({ key: 'toggle-code-0' })).toBeDefined()
  expect(await reply.find({ key: 'toggle-heading-0' })).toBeUndefined()
  expect(await reply.find({ key: 'toggle-callout-0' })).toBeUndefined()
  expect(await reply.find({ key: 'toggle-table-0' })).toBeUndefined()
  expect(textOf(await reply.find({ key: 'toggle-code-0-row-0-0-in' }))).toMatch(/1 │ # Not a heading$/)
  expect(textOf(await reply.find({ key: 'toggle-code-0-row-2-0-in' }))).toMatch(/3 │ \| a \| b \|$/)
})

test('a diff fence draws the code card tagged DIFF, + and − in the gutter, add and delete rows washed', async ($, on) => {
  const reply = await replyOf($, on, '```diff\n function total(items) {\n-  return items.length\n+  return items.reduce((sum, item) => sum + item.price, 0)\n }\n```')
  expect(await textsOf(reply, / DIFF /)).toHaveLength(1)
  expect((await textsOf(reply, '− '))[0].props.color).toBe(THEME.alert)
  expect((await textsOf(reply, '+ '))[0].props.color).toBe(THEME.good)
  expect((await reply.find({ key: 'toggle-code-0-row-1-0-in' }))?.props.backgroundColor).toBe(mix(THEME.surface1, THEME.alert, 0.22))
  expect((await reply.find({ key: 'toggle-code-0-row-2-0-in' }))?.props.backgroundColor).toBe(mix(THEME.surface1, THEME.good, 0.16))
  expect((await reply.find({ key: 'toggle-code-0-row-0-0-in' }))?.props.backgroundColor).toBe(THEME.surface1)
  expect(await textsOf(reply, '  return items.length')).toHaveLength(1)
})

// A VS Code install whose settings name the theme "Night"; its keywords are bold red and its strings green.
const EXTENSION = '/home/.vscode/extensions/acme.night-1.0.0'
const NIGHT: Record<string, string> = {
  '/home/AppData/Roaming/Code/User/settings.json': '{\n  // "workbench.colorTheme": "Day",\n  "workbench.colorTheme": "Night",\n}',
  [`${EXTENSION}/package.json`]: JSON.stringify({ contributes: { themes: [{ label: 'Night', path: './themes/night.json' }, { label: 'Day', path: './themes/day.json' }] } }),
  [`${EXTENSION}/themes/night.json`]: JSON.stringify({
    colors: { 'editor.foreground': '#101010' },
    tokenColors: [
      { scope: 'keyword', settings: { foreground: '#AA0000', fontStyle: 'bold' } },
      { scope: 'storage', settings: { foreground: '#AA0001' } },
      { scope: 'string', settings: { foreground: '#00AA00' } },
      { scope: 'entity.name.function', settings: { foreground: '#0000AA' } },
    ],
  }),
  [`${EXTENSION}/themes/day.json`]: JSON.stringify({ colors: { 'editor.foreground': '#FFFFFF' }, tokenColors: [{ scope: 'keyword', settings: { foreground: '#777777' } }] }),
}

// The first mount draws the palette and starts the theme search; the second finds the theme in.
const secondReply = async (mount: any, ids: string[]) => {
  await mount('AssistantMessage', ids[0], { text: CODE_REPLY, isFirstOfReply: true })
  return mount('AssistantMessage', ids[1], { text: CODE_REPLY, isFirstOfReply: true })
}

test('a ts fence takes its colors from the VS Code theme named in the editor settings', async ($, on) => {
  const reply = await secondReply(await open($, on, '', () => '', NIGHT), [ID(7), ID(8)])
  const word = (await textsOf(reply, 'return'))[0]
  expect(word.props).toMatchObject({ color: '#AA0000', bold: true })
  expect((await textsOf(reply, 'function'))[0].props.color).toBe('#AA0001')
  expect((await textsOf(reply, 'total'))[0].props.color).toBe('#0000AA')
  expect((await textsOf(reply, '('))[0].props.color).toBe('#101010')
})

test('the code_theme setting names a theme of its own, and an empty one follows the editor', { options: { code_theme: 'Day' } }, async ($, on) => {
  const reply = await secondReply(await open($, on, '', () => '', NIGHT), [ID(7), ID(8)])
  expect((await textsOf(reply, 'return'))[0].props.color).toBe('#777777')
})

test('a code_theme no extension contributes leaves the mod\'s own colors', { options: { code_theme: 'Nope' } }, async ($, on) => {
  const reply = await secondReply(await open($, on, '', () => '', NIGHT), [ID(7), ID(8)])
  expect((await textsOf(reply, 'return'))[0].props.color).toBe(SYNTAX.command)
})

test('an editor with no theme on disk leaves the mod\'s own colors', async ($, on) => {
  const reply = await secondReply(await open($, on), [ID(7), ID(8)])
  expect((await textsOf(reply, 'return'))[0].props.color).toBe(SYNTAX.command)
})

test('a fence in a language the mod has no grammar for stays the surface color', async ($, on) => {
  const reply = await replyOf($, on, '```cobol\nMOVE 1 TO X\n```')
  expect((await textsOf(reply, 'MOVE 1 TO X'))[0].props.color).toBe(THEME.onSurface)
})

// A finished turn that reads a file: the result is cat -n numbered.
const READ_TURN = [
  row(1, 'user', { message: { role: 'user', content: 'read it' } }),
  said(2, [{ type: 'tool_use', id: 'toolu_r', name: 'Read', input: { file_path: '/repo/a.ts' } }]),
  row(3, 'user', { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_r', content: '     1→export function total() {\n     2→  return "x"\n     3→}' }] }, toolUseResult: { file: { content: 'export function total() {\n  return "x"\n}' } } }),
  said(4, [{ type: 'text', text: 'Done.' }]),
  row(5, 'system', { subtype: 'turn_duration', durationMs: 1000 }),
  row(6, 'user', { message: { role: 'user', content: 'next' } }),
].join('\n') + '\n'

test('a Read preview colors the file by its extension from the VS Code theme and keeps the line numbers muted', async ($, on) => {
  const mount = await open($, on, READ_TURN, () => READ_TURN, NIGHT)
  const head = await mount('UserMessage', ID(1), prompt('read it'))
  await clickLabel(head, 'toggle-turn-colored')
  await head.pointer({ in: 'toggle-chips-line', type: 'down', button: 'left', x: 1, y: 0 })
  await clickLabel(head, 'toggle-call-0-colored')
  expect((await textsOf(head, 'return'))[0].props).toMatchObject({ color: '#AA0000', bold: true })
  expect((await textsOf(head, '"x"'))[0].props.color).toBe('#00AA00')
  expect((await textsOf(head, /^\s+1→$/))[0].props.color).toBe(THEME.muted)
})

test('a Read preview of a file type with no grammar stays muted', async ($, on) => {
  const turn = READ_TURN.replace('/repo/a.ts', '/repo/a.txt')
  const mount = await open($, on, turn, () => turn, NIGHT)
  const head = await mount('UserMessage', ID(1), prompt('read it'))
  await clickLabel(head, 'toggle-turn-colored')
  await head.pointer({ in: 'toggle-chips-line', type: 'down', button: 'left', x: 1, y: 0 })
  await clickLabel(head, 'toggle-call-0-colored')
  expect((await textsOf(head, /return "x"/))[0].props.color).toBe(THEME.muted)
})

test('a heading is dim caps on a hairline to the reply width, and a code span in it keeps its case', async ($, on) => {
  const reply = await replyOf($, on, '## What changed with `Code` now\nTwo mods.')
  expect((await reply.findAll({ type: 'Text', text: /WHAT CHANGED WITH/ })).some((title: any) => title.props.color === '#7E86A4')).toBe(true)
  expect(await textsOf(reply, /^\s*Code\s*$/)).toHaveLength(1)
  expect(await textsOf(reply, /CODE/)).toHaveLength(0)
  const rule = (await textsOf(reply, /^ ─+$/))[0]
  expect(rule.props.color).toBe(THEME.border)
  // The rule is drawn long and clipped by its box, so it fills the row and never ends in an ellipsis; the title never shrinks.
  expect((await reply.find({ key: 'toggle-heading-0-rule' }))?.props).toMatchObject({ flexGrow: 1, height: 1, overflow: 'hidden' })
  expect((await reply.find({ key: 'toggle-heading-0-title' }))?.props.flexShrink).toBe(0)
  expect(textOf(rule).length).toBeGreaterThan(114 - shownWidth('WHAT CHANGED WITH `Code` NOW'))
  expect(await reply.find({ type: 'Markdown', props: { text: 'Two mods.' } } as never)).toBeDefined()
})

test('callouts draw a surface1 card with a tinted square tag, the bold title and the muted detail; a warning edges in alert; a plain quote stays Claude Code\'s', async ($, on) => {
  const reply = await replyOf($, on, 'Before you push:\n\n> **Note:** the release posts are in ~/release-posts.md\n\n> [!WARNING]\n> a force push is blocked\n\n> [!TIP]\n> try `just test`\n\n> just a quote')
  const note = await reply.find({ key: 'toggle-callout-1' })
  expect(note.props).toMatchObject({ borderStyle: 'round', borderColor: THEME.border, backgroundColor: THEME.surface1 })
  expect((await textsOf(reply, ' i '))[0].props).toMatchObject({ color: THEME.accent, backgroundColor: mix(THEME.surface1, THEME.accent, 0.15) })
  expect((await textsOf(reply, 'Note'))[0].props.bold).toBe(true)
  expect(await textsOf(reply, /the release posts are in/)).toHaveLength(1)
  const warning = await reply.find({ key: 'toggle-callout-2' })
  expect(warning.props.borderColor).toBe(mix(THEME.bg, THEME.alert, 0.33))
  expect((await textsOf(reply, ' ! '))[0].props).toMatchObject({ color: THEME.alert, backgroundColor: mix(THEME.surface1, THEME.alert, 0.15) })
  expect(await textsOf(reply, 'Warning')).toHaveLength(1)
  expect(await textsOf(reply, /a force push is blocked/)).toHaveLength(1)
  expect(await textsOf(reply, 'Tip')).toHaveLength(1)
  expect((await reply.find({ key: 'toggle-callout-3' }))?.props.borderColor).toBe(THEME.border)
  expect(await reply.find({ type: 'Markdown', props: { text: '> just a quote' } } as never)).toBeDefined()
})

for (const icons of ['safe', 'nerd'] as const) {
  test(`icons=${icons}: task items draw a checkbox in accent and mute the done ones`, { options: { icons } }, async ($, on) => {
    const reply = await replyOf($, on, 'Where we are:\n- [x] Restyle the mods\n- [ ] Phase 4')
    const done = icons === 'safe' ? '[x] ' : `${String.fromCodePoint(0xf14a)} `
    const open = icons === 'safe' ? '[ ] ' : `${String.fromCodePoint(0xf096)} `
    expect((await textsOf(reply, done))[0].props.color).toBe(THEME.accent)
    expect((await textsOf(reply, open))[0].props.color).toBe(THEME.accent)
    expect((await reply.findAll({ type: 'Text', text: 'Restyle the mods' })).some((item: any) => item.props.color === THEME.muted)).toBe(true)
    expect((await reply.findAll({ type: 'Text', text: 'Phase 4' })).some((item: any) => item.props.color === THEME.muted)).toBe(false)
    expect(JSON.stringify(await reply.drawn())).not.toContain('- [')
  })
}

test('a table cell that is only a status word becomes a square tag tinted at 15% over the cell; elsewhere the word stays plain', async ($, on) => {
  const reply = await replyOf($, on, '| Check | Status |\n| --- | --- |\n| tests | PASS |\n| lint | fail |\n| types | Skipped |\n| docs | blocked |')
  const tint = (hue: string) => mix(THEME.bg, hue, 0.15)
  expect((await textsOf(reply, ' PASS '))[0].props).toMatchObject({ color: THEME.good, backgroundColor: tint(THEME.good) })
  expect((await textsOf(reply, ' fail '))[0].props).toMatchObject({ color: THEME.alert, backgroundColor: tint(THEME.alert) })
  expect((await textsOf(reply, ' Skipped '))[0].props).toMatchObject({ color: THEME.warn, backgroundColor: tint(THEME.warn) })
  expect(await textsOf(reply, / blocked /)).toHaveLength(0)
})

test('a status word outside a table is not tagged', async ($, on) => {
  const reply = await replyOf($, on, 'It will pass #FF6F7A.')
  expect(await textsOf(reply, / pass /)).toHaveLength(0)
})

test('a code block past the cap shows its last rows and a control that shows all and back', { options: { icons: 'safe' } }, async ($, on) => {
  const lines = Array.from({ length: 15 }, (_, n) => `line ${n + 1}`).join('\n')
  const reply = await replyOf($, on, `\`\`\`log\n${lines}\n\`\`\``)
  const control = `toggle-more-code:${ID(7)}:0`
  expect(await textsOf(reply, /^line 3$/)).toHaveLength(0)
  expect(await textsOf(reply, /^line 4$/)).toHaveLength(1)
  expect(await textsOf(reply, /^line 15$/)).toHaveLength(1)
  expect(await labelText(reply, control)).toBe(' ▾ 3 more lines ')
  expect((await reply.find({ type: 'Client', key: control })).props.props.leadColor).toBe(THEME.accent)
  await clickLabel(reply, control)
  expect(await textsOf(reply, /^line 1$/)).toHaveLength(1)
  expect(await labelText(reply, control)).toBe(' ▴ Show less ')
  await clickLabel(reply, control)
  expect(await textsOf(reply, /^line 1$/)).toHaveLength(0)
  expect(await labelText(reply, control)).toBe(' ▾ 3 more lines ')
})

test('a short code block shows no expand control', async ($, on) => {
  const reply = await replyOf($, on, '```log\nline 1\nline 2\n```')
  expect(await reply.find({ key: `toggle-more-code:${ID(7)}:0` })).toBeUndefined()
})

// The open result of a file tool, mounted with no turn behind it so it draws live.
const resultOf = async ($: any, on: any, tool: string, output: unknown, extra: object = {}) => {
  const mount = await open($, on)
  return mount('ToolResult', 'toolu_f', { tool_use_id: 'toolu_f', tool, output, isErrored: false, ...extra })
}
const VS_ICON = String.fromCodePoint(0xf0a1e)
const CARD = 'toggle-result-card'
const EDIT_OUTPUT = { filePath: '/w/src/a.ts', structuredPatch: [{ oldStart: 10, oldLines: 4, newStart: 10, newLines: 5, lines: [' const keep = 1', '-const a = "x"', '+const a = "y"', '+const b = 2', ' tail()'] }] }

for (const icons of ['safe', 'nerd'] as const) {
  test(`icons=${icons}: an Edit result is a card with the language, a VS Code link pill to the first changed line, a copy pill, marks, washes and theme colors`, { options: { icons } }, async ($, on) => {
    const copied: string[] = []
    on('ui.copy', (_$: unknown, e: { text: string }) => {
      copied.push(e.text)
      return { value: { isCopied: true } }
    })
    const result = await resultOf($, on, 'Edit', EDIT_OUTPUT)
    expect(await result.find({ type: 'Text', text: 'base ToolResult' })).toBeUndefined()
    expect(textOf(await result.find({ key: `${CARD}-top` }))).toMatch(/^╭─ TS · /)
    expect((await textsOf(result, / TS /))[0].props.color).toBe('#7E86A4')
    expect((await textsOf(result, /^· $/))[0].props.color).toBe('#3B446A')
    const link = (await result.findAll({ type: 'Link' })) as any[]
    expect(link.map(each => each.props.href)).toEqual(['vscode://file/w/src/a.ts:11'])
    expect(textOf(link[0])).toBe(icons === 'nerd' ? `${CAPS.left}${VS_ICON} src/a.ts:11${CAPS.right}` : ' src/a.ts:11 ')
    expect((await textsOf(result, 'src/a.ts:11'))[0].props).toMatchObject({ color: THEME.secondary, underline: true })
    expect((await textsOf(result, new RegExp(VS_ICON))).map((icon: any) => icon.props.color)).toEqual(icons === 'nerd' ? [THEME.secondary] : [])
    expect((await result.find({ key: `${CARD}-row-0-0-in` }))?.props.backgroundColor).toBe(THEME.surface1)
    expect((await result.find({ key: `${CARD}-row-1-0-in` }))?.props.backgroundColor).toBe(mix(THEME.surface1, THEME.alert, 0.22))
    expect((await result.find({ key: `${CARD}-row-2-0-in` }))?.props.backgroundColor).toBe(mix(THEME.surface1, THEME.good, 0.16))
    expect((await result.find({ key: `${CARD}-row-3-0-in` }))?.props.backgroundColor).toBe(mix(THEME.surface1, THEME.good, 0.16))
    expect((await textsOf(result, ' − '))[0].props.color).toBe(THEME.alert)
    expect((await textsOf(result, ' + ')).map((mark: any) => mark.props.color)).toEqual([THEME.good, THEME.good])
    expect(textOf(await result.find({ key: `${CARD}-row-1-0-in` }))).toBe('11 − │ const a = "x"')
    expect(textOf(await result.find({ key: `${CARD}-row-2-0-in` }))).toBe('11 + │ const a = "y"')
    expect(textOf(await result.find({ key: `${CARD}-row-4-0-in` }))).toBe('13   │ tail()')
    expect((await textsOf(result, /^│ $/)).every((bar: any) => bar.props.color === THEME.border)).toBe(true)
    expect((await textsOf(result, 'const'))[0].props.color).toBe(SYNTAX.command)
    const pill = await result.find({ type: 'Client', key: 'toggle-copy-code-pill-result:toolu_f' })
    expect(pill.props.props).toMatchObject({ label: 'copy', lead: icons === 'safe' ? '⧉' : String.fromCodePoint(0xf018f) })
    await clickLabel(result, 'toggle-copy-code-pill-result:toolu_f')
    expect(copied).toEqual(['const keep = 1\nconst a = "y"\nconst b = 2\ntail()'])
  })
}

test('a removed quote colors no other line: the old and new sides are tokenized apart', async ($, on) => {
  const result = await resultOf($, on, 'Edit', { filePath: '/w/a.ts', structuredPatch: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: ['-const s = "open', '+const s = 1', ' const t = 2'] }] })
  expect((await textsOf(result, 'const')).map((word: any) => word.props.color)).toEqual([SYNTAX.command, SYNTAX.command, SYNTAX.command])
  const added = (await result.find({ key: `${CARD}-row-1-0-in` })) as any
  expect(added.children[0].children.at(-1).props.color).toBe(SYNTAX.number)
  expect((await textsOf(result, /^ s $/)).map((name: any) => name.props.color)).toEqual([THEME.onSurface, THEME.onSurface])
})

test('a MultiEdit result with two hunks draws a dim gap row between them', async ($, on) => {
  const result = await resultOf($, on, 'MultiEdit', {
    filePath: '/w/src/a.ts',
    structuredPatch: [
      { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-const a = 1', '+const a = 2'] },
      { oldStart: 40, oldLines: 1, newStart: 40, newLines: 1, lines: ['-const b = 1', '+const b = 2'] },
    ],
  })
  const gap = await textsOf(result, /⋯/)
  expect(gap).toHaveLength(1)
  expect(gap[0].props.color).toBe('#7E86A4')
  expect(textOf(await result.find({ key: `${CARD}-row-2-in` }))).toBe(' ⋯')
  expect(textOf(await result.find({ key: `${CARD}-row-3-0-in` }))).toBe('40 − │ const b = 1')
  expect(((await result.findAll({ type: 'Link' })) as any[]).map(link => link.props.href)).toEqual(['vscode://file/w/src/a.ts:1'])
})

test('a Write of a new file is every line added, numbered from 1', async ($, on) => {
  const result = await resultOf($, on, 'Write', { type: 'create', filePath: '/w/notes.md', content: 'one\ntwo\n', structuredPatch: [], originalFile: null })
  expect(await textsOf(result, ' + ')).toHaveLength(2)
  expect(await textsOf(result, ' − ')).toHaveLength(0)
  expect((await result.find({ key: `${CARD}-row-1-0-in` }))?.props.backgroundColor).toBe(mix(THEME.surface1, THEME.good, 0.16))
  expect(textOf(await result.find({ key: `${CARD}-row-1-0-in` }))).toBe('2 + │ two')
  expect(((await result.findAll({ type: 'Link' })) as any[]).map(link => link.props.href)).toEqual(['vscode://file/w/notes.md:1'])
  expect(await textsOf(result, / MD /)).toHaveLength(1)
})

test('a Read result is a code card from its first line: numbers, no marks, a link to that line', async ($, on) => {
  const result = await resultOf($, on, 'Read', { type: 'text', file: { filePath: '/w/src/a.ts', content: 'export const a = 1\nexport const b = 2', numLines: 2, startLine: 5, totalLines: 9 } })
  expect(textOf(await result.find({ key: `${CARD}-row-0-0-in` }))).toBe('5   │ export const a = 1')
  expect(textOf(await result.find({ key: `${CARD}-row-1-0-in` }))).toBe('6   │ export const b = 2')
  expect((await result.find({ key: `${CARD}-row-0-0-in` }))?.props.backgroundColor).toBe(THEME.surface1)
  expect(await textsOf(result, / [+−] /)).toHaveLength(0)
  expect(((await result.findAll({ type: 'Link' })) as any[]).map(link => link.props.href)).toEqual(['vscode://file/w/src/a.ts:5'])
})

test('a result past the cap shows its first rows and an expand control', { options: { icons: 'safe' } }, async ($, on) => {
  const content = Array.from({ length: 15 }, (_, n) => `line ${n + 1}`).join('\n')
  const result = await resultOf($, on, 'Read', { type: 'text', file: { filePath: '/w/a.log', content, numLines: 15, startLine: 1, totalLines: 15 } })
  const control = 'toggle-more-code:result:toolu_f'
  expect(await textsOf(result, /^line 12$/)).toHaveLength(1)
  expect(await textsOf(result, /^line 13$/)).toHaveLength(0)
  expect(await labelText(result, control)).toBe(' ▾ 3 more lines ')
  await clickLabel(result, control)
  expect(await textsOf(result, /^line 15$/)).toHaveLength(1)
  expect(await labelText(result, control)).toBe(' ▴ Show less ')
})

const FALLBACKS: [string, string, unknown, object][] = [
  ['an errored result', 'Edit', EDIT_OUTPUT, { isErrored: true }],
  ['a result with no structuredPatch', 'Edit', { filePath: '/w/src/a.ts' }, {}],
  ['a shapeless output', 'Edit', 'Updated', {}],
  ['a malformed hunk', 'Edit', { filePath: '/w/src/a.ts', structuredPatch: [{ oldStart: 1, lines: 'x' }] }, {}],
  ['an update with an empty patch', 'Write', { type: 'update', filePath: '/w/src/a.ts', content: 'x', structuredPatch: [], originalFile: null }, {}],
  ['an edit held for review', 'Edit', { ...EDIT_OUTPUT, staged: true }, {}],
  ['a Read of an image', 'Read', { type: 'image', file: { base64: '' } }, {}],
  ['a Read with no content', 'Read', { type: 'text', file: { filePath: '/w/a.ts', content: '' } }, {}],
  ['another tool', 'Grep', EDIT_OUTPUT, {}],
]

for (const [name, tool, output, extra] of FALLBACKS) {
  test(`${name} falls back to Claude Code's drawing`, async ($, on) => {
    const result = await resultOf($, on, tool, output, extra)
    expect(await result.find({ type: 'Text', text: 'base ToolResult' })).toBeDefined()
    expect(await result.find({ key: CARD })).toBeUndefined()
  })
}

// A finished turn whose one call carries the given result record, opened through its head, chip and call line.
const openCall = async ($: any, on: any, tool: string, input: object, output: object) => {
  const turn = [
    row(1, 'user', { message: { role: 'user', content: 'go' } }),
    said(2, [{ type: 'tool_use', id: 'toolu_c', name: tool, input }]),
    answered(3, 'toolu_c', { toolUseResult: output }),
    said(4, [{ type: 'text', text: 'Done.' }]),
    row(5, 'system', { subtype: 'turn_duration', durationMs: 1000 }),
    row(6, 'user', { message: { role: 'user', content: 'next' } }),
  ].join('\n') + '\n'
  const mount = await open($, on, turn)
  const head = await mount('UserMessage', ID(1), prompt('go'))
  await clickLabel(head, 'toggle-turn-colored')
  await head.pointer({ in: 'toggle-chips-line', type: 'down', button: 'left', x: 1, y: 0 })
  await clickLabel(head, 'toggle-call-0-colored')
  return head
}
const CALL_CARD = 'toggle-call-card'

for (const icons of ['safe', 'nerd'] as const) {
  test(`icons=${icons}: an opened Edit call in a finished turn draws the card with its link, copy pill and numbered rows`, { options: { expand_live: false, icons } }, async ($, on) => {
    const head = await openCall($, on, 'Edit', { file_path: '/w/src/a.ts' }, EDIT_OUTPUT)
    expect(textOf(await head.find({ key: `${CALL_CARD}-top` }))).toMatch(/^╭─ TS · /)
    expect(((await head.findAll({ type: 'Link' })) as any[]).map(link => link.props.href)).toEqual(['vscode://file/w/src/a.ts:11'])
    expect(textOf(await head.find({ key: `${CALL_CARD}-row-1-0-in` }))).toBe('11 − │ const a = "x"')
    expect(textOf(await head.find({ key: `${CALL_CARD}-row-2-0-in` }))).toBe('11 + │ const a = "y"')
    const pill = await head.find({ type: 'Client', key: 'toggle-copy-code-pill-call:toolu_c' })
    expect(pill.props.props).toMatchObject({ label: 'copy', lead: icons === 'safe' ? '⧉' : String.fromCodePoint(0xf018f) })
    const inner = (await head.find({ key: `${CALL_CARD}-row-0-0-in` })) as any
    // The viewport less the row's margin, the picked bar and its padding, the turn card's edge and the preview's own padding.
    expect(inner.props.width + 2).toBe(120 - 6 - 8)
    // Live, a top row left to fill a wider preview pushed the ╮ past the rails onto a row of its own.
    expect((await head.find({ key: `${CALL_CARD}-top` }))?.props.width).toBe(inner.props.width + 2)
    expect((await head.find({ key: `${CALL_CARD}-corner` }))?.props.flexShrink).toBe(0)
  })
}

test('an opened Edit call whose record has no structuredPatch keeps the old preview', { options: { expand_live: false } }, async ($, on) => {
  const head = await openCall($, on, 'Edit', { file_path: '/w/src/a.ts' }, { filePath: '/w/src/a.ts' })
  expect(await head.find({ key: CALL_CARD })).toBeUndefined()
  expect(await head.find({ key: `${CALL_CARD}-top` })).toBeUndefined()
  expect(await head.find({ key: 'toggle-call-0-preview' })).toBeDefined()
})

test('an opened Read call draws the code card from its first line', { options: { expand_live: false } }, async ($, on) => {
  const head = await openCall($, on, 'Read', { file_path: '/w/src/a.ts' }, { type: 'text', file: { filePath: '/w/src/a.ts', content: 'export const a = 1\nexport const b = 2', numLines: 2, startLine: 5, totalLines: 9 } })
  expect(textOf(await head.find({ key: `${CALL_CARD}-row-0-0-in` }))).toBe('5   │ export const a = 1')
  expect(((await head.findAll({ type: 'Link' })) as any[]).map(link => link.props.href)).toEqual(['vscode://file/w/src/a.ts:5'])
})

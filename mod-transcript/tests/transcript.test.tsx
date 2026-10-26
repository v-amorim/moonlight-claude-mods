// mod-transcript / tests/transcript.test.tsx, by v-amorim
// Tests turn building, timing, previews, row keys and copy choices from a transcript.
import { expect, mock, test } from 'claude-code/testing'

import { cells } from '../hooks/cells'
import { copyChoices, copyText } from '../hooks/clip'
import { mix, THEME, WASH } from '../hooks/theme'
import { callTime, commandOf, elapsed, previewOf, rowKey, timeOfDay, turnLine, TurnLog } from '../hooks/turns'
import { reading, sessionStarted } from './bridge-feed'

const ID = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`
const row = (n: number, type: string, extra: object) => JSON.stringify({ type, uuid: ID(n), parentUuid: n > 1 ? ID(n - 1) : null, ...extra })
const said = (n: number, content: unknown[]) => row(n, 'assistant', { message: { role: 'assistant', content } })
const PATCH = [{ lines: [' keep', '-old', '+new', '+added'] }]

// One turn that edits a file and runs a skill, then a second prompt still running.
const TRANSCRIPT = [
  row(1, 'user', { message: { role: 'user', content: 'fix the bug' } }),
  said(2, [{ type: 'text', text: 'Looking.' }]),
  said(3, [{ type: 'thinking', thinking: 'which file?' }, { type: 'tool_use', id: 'toolu_edit', name: 'Edit', input: { file_path: 'C:\\repo\\hooks\\a.ts' } }]),
  row(4, 'user', { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_edit', content: 'ok' }] }, toolUseResult: { structuredPatch: PATCH } }),
  said(5, [{ type: 'tool_use', id: 'toolu_skill', name: 'Skill', input: { skill: 'tidy' } }]),
  row(6, 'user', { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_skill', content: 'ok' }] } }),
  said(7, [{ type: 'text', text: 'Fixed.' }]),
  row(8, 'system', { subtype: 'turn_duration', durationMs: 64000 }),
  row(9, 'user', { message: { role: 'user', content: '<system-reminder>noise</system-reminder>' } }),
  row(10, 'user', { message: { role: 'user', content: 'now the docs' } }),
  '{"torn',
].join('\n')

// The open turn's chip line, drawn by its Client, and a click at a cell of it.
const chipsOf = async (ui: any) => JSON.stringify(await ui.drawn({ in: 'toggle-chips-line' }))
const pick = (ui: any, x: number) => ui.pointer({ in: 'toggle-chips-line', type: 'down', button: 'left', x, y: 0 })
// The host's Mounted type omits pointer, which the harness serves.
const pointerOn = <T extends object>(ui: T, event: object) => (ui as T & { pointer: (e: object) => Promise<unknown> }).pointer(event)
// The head's fold pill is a Client, so its + or − is the isOpen it was handed.
const isChipOpen = async (ui: any) => (await ui.find({ type: 'Client', key: 'toggle-turn-chip' }))?.props.props?.isOpen

const textOf = (node: any): string => (typeof node === 'string' ? node : Array.isArray(node) ? node.map(textOf).join('') : node ? textOf(node.children) : '')
// The words a fold label Client drew, and a click on one: a Button posts no tip, so the labels are Clients.
const labelText = async (ui: any, key: string) => textOf(await ui.drawn({ in: key }))
const clickLabel = (ui: any, key: string) => ui.pointer({ in: key, type: 'down', button: 'left', x: 1, y: 0 })

const logOf = (text: string) => {
  const log = new TurnLog()
  for (const line of text.split('\n')) log.feed(line)
  return log
}

test('the transcript splits into turns at each prompt, with tools, diff counts, reply and time', () => {
  const log = logOf(TRANSCRIPT)
  expect(log.turns.map(turn => turn.prompt)).toEqual([ID(1), ID(10)])
  const [first] = log.turns
  expect(turnLine(first!)).toBe('2 tools · Edit(hooks/a.ts) · Skill(tidy)')
  expect([first!.tools[0]!.added, first!.tools[0]!.removed, first!.durationMs]).toEqual([2, 1, 64000])
  expect(first!.reply).toBe(rowKey(ID(7)))
  expect(log.turnOf('toolu_edit')).toBe(first)
  expect(log.turnOf(`${ID(2).slice(0, 24)}000000000003`)).toBe(first)
  expect(log.turnAt(ID(10))).toBe(log.turns[1])
})

test('a call drawn before its input streams in gets the input later, and never shows empty parentheses', () => {
  const log = logOf(TRANSCRIPT)
  const last = log.turns[log.turns.length - 1]!
  log.claimCall('toolu_live', 'Edit', {}, true, undefined)
  expect(turnLine(last)).toBe('1 tool · Edit')
  expect(turnLine(last)).not.toContain('Edit()')
  log.claimCall('toolu_live', 'Edit', { file_path: '/w/hooks/b.ts', old_string: 'a', new_string: 'b' }, true, undefined)
  expect(turnLine(last)).toContain('Edit(hooks/b.ts)')
})

test("a background agent's call stays out of the main turn, whether its row draws before or after the call is known as the agent's", () => {
  const log = logOf(TRANSCRIPT)
  const last = log.turns[log.turns.length - 1]!
  log.claimCall('toolu_main', 'Bash', { command: 'git status' }, false, {})
  log.claimCall('toolu_early', 'Write', { file_path: '/w/hooks/ledger.ts', content: 'a\nb' }, false, {})
  log.dropForeign('toolu_early')
  log.dropForeign('toolu_late')
  log.claimCall('toolu_late', 'Edit', { file_path: '/w/hooks/text.ts', old_string: 'a', new_string: 'b' }, false, {})
  expect(last.tools.map(call => call.id)).toEqual(['toolu_main'])
  expect(log.turnOf('toolu_early')).toBeUndefined()
  expect(log.callOf('toolu_late')).toBeUndefined()
})

test('a call first seen finished shows no time, and a later output with the patch fills in its counts', () => {
  const log = new TurnLog()
  log.claim(ID(50), 'prompt')
  log.claimCall('toolu_g', 'Edit', { file_path: '/a.ts' }, false, {})
  expect(callTime(log.callOf('toolu_g'))).toBe('')
  log.claimCall('toolu_g', 'Edit', { file_path: '/a.ts' }, false, { structuredPatch: PATCH })
  expect([log.callOf('toolu_g')!.added, log.callOf('toolu_g')!.removed]).toEqual([2, 1])
})

test('a background agent call read from the transcript previews that it runs in the background', () => {
  const log = logOf(
    [
      row(1, 'user', { message: { role: 'user', content: 'research it' } }),
      said(2, [{ type: 'tool_use', id: 'toolu_bg', name: 'Agent', input: { description: 'Research launch posts', prompt: 'p' } }]),
      row(3, 'user', {
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_bg', content: [{ type: 'text', text: 'Async agent launched successfully.' }] }] },
        toolUseResult: { isAsync: true, status: 'async_launched', agentId: 'a1', description: 'Research launch posts', prompt: 'p' },
      }),
    ].join('\n') + '\n',
  )
  expect(log.callOf('toolu_bg')!.preview!.lines.map(line => line.text)).toEqual(['Running in the background, its report arrives as a message'])
})

test('an opened call previews its diff, a new file, or the start of its result', () => {
  const edit = previewOf('Edit', {}, { structuredPatch: PATCH }, 'The file was updated')
  expect(edit.lines.map(line => `${line.kind}:${line.text}`)).toEqual(['same:keep', 'del:old', 'add:new', 'add:added'])
  expect(previewOf('Write', { content: 'a\nb' }, {}, '').lines.map(line => line.kind)).toEqual(['add', 'add'])
  const long = previewOf('Bash', {}, {}, Array.from({ length: 20 }, (_, n) => `line ${n}`).join('\n'))
  expect([long.lines.length, long.more, long.lines[0]!.text]).toEqual([8, 12, 'line 0'])
  // Drawn before the transcript has the result, a call reads its row's output.
  expect(previewOf('Bash', {}, { stdout: 'built\n', stderr: '' }, '').lines).toEqual([{ text: 'built', kind: 'out' }])
})

test('a drawn call whose output has none of the usual fields previews its own text fields', () => {
  const texts = (output: unknown) => previewOf('X', {}, output, '').lines.map(line => line.text)
  expect(texts({ listing: 'This session is claude-67\n\nPeer sessions (1)' })).toEqual(['This session is claude-67', '', 'Peer sessions (1)'])
  expect(texts({ success: true, message: 'sent to reviewer-2' })).toEqual(['sent to reviewer-2'])
  expect(texts({ matches: ['SendMessage'], query: 'select:SendMessage', total_deferred_tools: 134 })).toEqual(['SendMessage', 'select:SendMessage'])
  expect(texts([{ type: 'text', text: 'from an MCP tool' }])).toEqual(['from an MCP tool'])
  expect(texts({ stdout: 'built', note: 'not shown' })).toEqual(['built'])
})

test('a failed Write counts no lines, read from the transcript or drawn', () => {
  const content = 'line one\nline two\nline three'
  const log = new TurnLog()
  for (const line of [
    row(1, 'user', { message: { role: 'user', content: 'write it' } }),
    said(2, [{ type: 'tool_use', id: 'toolu_bad', name: 'Write', input: { file_path: '/a.ts', content } }]),
    row(3, 'user', { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_bad', content: 'File has not been read yet', is_error: true }] } }),
    said(4, [{ type: 'tool_use', id: 'toolu_good', name: 'Write', input: { file_path: '/b.ts', content } }]),
    row(5, 'user', { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_good', content: 'ok' }] } }),
  ]) log.feed(line)
  expect([log.callOf('toolu_bad')!.added, log.callOf('toolu_good')!.added]).toEqual([0, 3])

  log.claimCall('toolu_drawn', 'Write', { file_path: '/c.ts', content }, false, {}, true)
  expect(log.callOf('toolu_drawn')!.added).toBe(0)
})

test('calls drawn live learn the thinking before them from the session messages; text and results end a thought', () => {
  const log = new TurnLog()
  log.claim(ID(40), 'prompt')
  for (const id of ['toolu_x', 'toolu_y', 'toolu_z']) log.claimCall(id, 'Read', {}, false, {})
  log.learnThoughts([
    { role: 'user', content: [{ type: 'text', text: 'go' }] },
    { role: 'assistant', content: [{ type: 'thinking', thinking: 'read x first' }, { type: 'tool_use', id: 'toolu_x' }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_x' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'now y' }, { type: 'tool_use', id: 'toolu_y' }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_y' }] },
    { role: 'assistant', content: [{ type: 'redacted_thinking', data: '…' }, { type: 'tool_use', id: 'toolu_z' }] },
  ])
  expect(log.callOf('toolu_x')?.thought).toBe('read x first')
  expect(log.callOf('toolu_y')?.thought).toBeUndefined()
  expect(log.callOf('toolu_z')?.thought).toBe('')
})

test('times: a prompt keeps when it was sent, a call its start and how long it took', () => {
  const at = (s: string) => ({ timestamp: `2026-10-03T14:${s}.000Z` })
  const log = logOf([
    row(1, 'user', { message: { role: 'user', content: 'run the tests' }, ...at('32:00') }),
    row(2, 'assistant', { message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_bash', name: 'Bash', input: { command: 'claude plugin test .' } }] }, ...at('32:05') }),
    row(3, 'user', { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_bash', content: 'ok' }] }, ...at('32:46') }),
  ].join('\n'))
  expect(log.turns[0]!.at).toBe(Date.parse('2026-10-03T14:32:00.000Z'))
  expect(callTime(log.callOf('toolu_bash'))).toBe(`${timeOfDay(Date.parse('2026-10-03T14:32:05.000Z'))} · 41s`)
  expect([elapsed(400), elapsed(41_000), elapsed(372_000), elapsed(3_780_000)]).toEqual(['0.4s', '41s', '6m 12s', '1h 3m'])
  expect(callTime({ id: 'x', name: 'Bash', input: {}, added: 0, removed: 0, startedAt: 1 })).toBe('')
})

const TIMED = [
  row(1, 'user', { message: { role: 'user', content: 'run the tests' }, timestamp: '2026-10-03T14:32:00.000Z' }),
  row(2, 'assistant', { message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_bash', name: 'Bash', input: { command: 'claude plugin test .' } }] }, timestamp: '2026-10-03T14:32:05.000Z' }),
  row(3, 'user', { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_bash', content: 'ok' }] }, timestamp: '2026-10-03T14:32:46.000Z' }),
  said(4, [{ type: 'text', text: 'Done.' }]),
  row(5, 'system', { subtype: 'turn_duration', durationMs: 47000 }),
  // The next prompt is what folds the turn before it.
  row(6, 'user', { message: { role: 'user', content: 'now the docs' }, timestamp: '2026-10-03T14:34:00.000Z' }),
].join('\n') + '\n'

// isLive writes the transcript after the session starts, so its last turn counts as still running.
async function mountTimed($: any, on: any, text = TIMED, isLive = false, startsTurn = true) {
  let written = isLive ? '' : text
  on('turn.start', (_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: written.length, mtimeMs: 0, isLink: false } }))
  on('fs.read', reading(() => ({ value: written })))
  const clock = mock.clock(on)
  on('session.start', (_$: unknown, e: unknown) => e)
  on('command.register', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  mock.env(on, { USERPROFILE: '/home' })
  on('ui.render', ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>{`base ${e.component}`}</Text>
  })
  await sessionStarted($, clock, 's1', '/t/s1.jsonl', 'startup')
  written = text
  if (isLive && startsTurn) await $.turn.start({ turnId: 't1' } as never)
  // A reload fires session.start, not turn.start.
  if (isLive && !startsTurn) await $.session.start({ cwd: '/w' } as never)
  const mount = (component: string, requestId: string, props: object) =>
    $.ui.mount({ plugin: 'mod-transcript', surface: 'terminal', component, requestId, viewport: { columns: 120, rows: 40 }, props } as never)
  return {
    mount,
    prompt: await mount('UserMessage', ID(1), { text: 'run the tests', origin: { kind: 'composer' }, isExpanded: false }),
    tool: await mount('ToolUse', 'toolu_bash', { tool_use_id: 'toolu_bash', tool: 'Bash', input: { command: 'claude plugin test .' }, isRunning: false, isErrored: false, isInterrupted: false, output: {} }),
  }
}

test('an opened SendMessage shows the message it sent above what came back', async ($, on) => {
  const sent = TIMED.replace(
    /\{"type":"tool_use","id":"toolu_bash","name":"Bash","input":\{"command":"claude plugin test \."\}\}/,
    JSON.stringify({ type: 'tool_use', id: 'toolu_bash', name: 'SendMessage', input: { to: 'reviewer-2', message: 'Deadline at 18:00.\nSend what you have by 17:50.' } }),
  )
  const { prompt } = await mountTimed($, on, sent)
  await clickLabel(prompt, 'toggle-turn-colored')
  await pick(prompt, 1)
  await prompt.pointer({ in: 'toggle-call-0-colored', type: 'down', button: 'left', x: 1, y: 0 })
  expect(await prompt.find({ type: 'Text', text: 'Deadline at 18:00.' })).toBeDefined()
  expect(await prompt.find({ type: 'Text', text: 'Send what you have by 17:50.' })).toBeDefined()
  expect(await prompt.find({ type: 'Text', text: /^ok$/ })).toBeDefined()
})

test('the prompt row shows when it was sent, the head how long the turn took, and a picked chip how long each call took', async ($, on) => {
  const { prompt, tool } = await mountTimed($, on)
  expect(await prompt.find({ type: 'Text', text: `${timeOfDay(Date.parse('2026-10-03T14:32:00.000Z'))} ` })).toBeDefined()
  expect(await prompt.find({ type: 'Text', text: 'took 47s ' })).toBeDefined()
  // The finished turn starts folded; its chip line shows under the head once it opens, and the tool row itself draws nothing.
  await clickLabel(prompt, 'toggle-turn-colored')
  expect(await chipsOf(prompt)).toContain('Ran')
  expect(await tool.find({ type: 'Text' })).toBeUndefined()
  expect(await prompt.find({ type: 'Text', text: '41s ' })).toBeUndefined()
  await pick(prompt, 1)
  expect(await prompt.find({ key: 'toggle-call-0-colored' })).toBeDefined()
  expect(await prompt.find({ type: 'Text', text: '41s ' })).toBeDefined()
  // A click on a call's line opens it: what the call gave back shows under the line, the tool row stays hidden, and a second click closes it.
  await prompt.pointer({ in: 'toggle-call-0-colored', type: 'down', button: 'left', x: 1, y: 0 })
  expect(await prompt.find({ type: 'Text', text: /^ok$/ })).toBeDefined()
  expect(await prompt.find({ type: 'Text', text: '$ ' })).toBeDefined()
  expect(await prompt.find({ type: 'Text', text: ' test .' })).toBeDefined()
  expect(await tool.find({ type: 'Text' })).toBeUndefined()
  await prompt.pointer({ in: 'toggle-call-0-colored', type: 'down', button: 'left', x: 1, y: 0 })
  expect(await prompt.find({ type: 'Text', text: /^ok$/ })).toBeUndefined()
  // A second click on the open chip closes it.
  await pick(prompt, 1)
  expect(await prompt.find({ key: 'toggle-call-0-colored' })).toBeUndefined()
})

// The same turn still running: no turn_duration row yet, and Claude is working.
const LIVE = TIMED.split('\n').slice(0, 4).join('\n')

test('the running turn shows its tool rows in full, then folds once it ends', async ($, on) => {
  const { tool } = await mountTimed($, on, LIVE, true)
  expect(await tool.find({ key: 'bash-row' })).toBeDefined()
  expect(await tool.find({ key: 'toggle-tool-colored' })).toBeUndefined()
  // The mod draws the Bash row itself: the command word bold blue, a plain word in the text color.
  const word = await tool.find({ type: 'Text', text: /^claude$/ })
  expect(word?.props).toMatchObject({ color: '#7386D0', bold: true })
  expect((await tool.find({ type: 'Text', text: /^\.$/ }))?.props.color).toBe('#EEEEFA')
})

test('a mod reload mid-turn misses turn.start and still shows the running turn in full', async ($, on) => {
  const { tool } = await mountTimed($, on, LIVE, true, false)
  expect(await tool.find({ key: 'bash-row' })).toBeDefined()
})

test('a tool row drawn before the transcript holds it counts as the running turn and shows in full', async ($, on) => {
  const { tool } = await mountTimed($, on, TIMED.split('\n').slice(0, 1).join('\n'), true)
  expect(await tool.find({ key: 'bash-row' })).toBeDefined()
})

test('a finished turn stays open until the next prompt', async ($, on) => {
  // Its turn_duration row is read, so the turn has ended; only the next prompt folds it.
  const { tool } = await mountTimed($, on, TIMED.split('\n').slice(0, 5).join('\n') + '\n')
  expect(await tool.find({ key: 'bash-row' })).toBeDefined()
})

test('with expand_live off, the running turn folds its finished tool rows at once', { options: { expand_live: false } }, async ($, on) => {
  const { tool } = await mountTimed($, on, LIVE, true)
  expect(await tool.find({ key: 'toggle-tool-colored' })).toBeDefined()
  // The folded line keeps the command's colors inside `Bash(…)`.
  expect(JSON.stringify(await tool.drawn({ in: 'toggle-tool-colored' }))).toContain('#7386D0')
})

test('a head with wide count and time pills cuts its label to the room left, so the line stays one row', { options: { icons: 'nerd' } }, async ($, on) => {
  const many = [
    row(1, 'user', { message: { role: 'user', content: 'refactor everything' } }),
    ...Array.from({ length: 12 }, (_, k) => [
      said(2 + 2 * k, [{ type: 'tool_use', id: `toolu_w${k}`, name: 'Edit', input: { file_path: `/repo/src/a-rather-long-module-name-${k}.ts` } }]),
      row(3 + 2 * k, 'user', { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_w${k}`, content: 'ok' }] }, toolUseResult: { structuredPatch: [{ lines: Array.from({ length: 80 }, () => '+x').concat(Array.from({ length: 15 }, () => '-y')) }] } }),
    ]).flat(),
    said(26, [{ type: 'text', text: 'Done.' }]),
    row(27, 'system', { subtype: 'turn_duration', durationMs: 2442000 }),
    row(28, 'user', { message: { role: 'user', content: 'next' } }),
  ].join('\n') + '\n'
  const { prompt } = await mountTimed($, on, many)
  const label = await labelText(prompt, 'toggle-turn-colored')
  const pills = cells('+960 −180') + 2 + 1 + cells('took 40m 42s') + 3 + 1
  // The row's columns, less what widthOf keeps back and the head's chrome around the label.
  expect(cells(label)).toBeLessThanOrEqual(120 - 6 - 12 - pills)
  expect(label.endsWith('…')).toBe(true)
})

test('icons=nerd draws the times as rounded pills', { options: { icons: 'nerd' } }, async ($, on) => {
  const { prompt, tool } = await mountTimed($, on)
  const drawn = JSON.stringify(await prompt.drawn())
  expect(drawn).toContain(String.fromCodePoint(0xe0b6))
  // The time's column carries the prompt's background down a wrapped prompt, and the pill a lighter one so it still shows.
  expect(drawn).toMatch(/"key":"toggle-prompt-time-col"[^}]*"backgroundColor":"#1C2033"/)
  expect(drawn).toMatch(/"key":"toggle-prompt-time-body","height":1,"backgroundColor":"#252A42"/)
  // Pills stay one row whatever the line's height, so a taller line never paints their fill on the row below.
  expect(drawn).toMatch(/"key":"toggle-head-time","flexDirection":"row","flexShrink":0,"height":1,"alignSelf":"flex-start"/)
  expect(await prompt.find({ type: 'Text', text: timeOfDay(Date.parse('2026-10-03T14:32:00.000Z')) })).toBeDefined()
  await clickLabel(prompt, 'toggle-turn-colored')
  await pick(prompt, 1)
  expect(await prompt.find({ type: 'Text', text: '41s' })).toBeDefined()
  expect(await tool.find({ type: 'Text' })).toBeUndefined()
})

test('an open call line draws like an On switch (ok text on ok washed into the surface) and the open chip lights nothing lifted', { options: { icons: 'nerd' } }, async ($, on) => {
  const { prompt } = await mountTimed($, on)
  await clickLabel(prompt, 'toggle-turn-colored')
  await pick(prompt, 1)
  const closed = JSON.stringify(await prompt.drawn())
  expect(closed).not.toContain(mix(THEME.ok, THEME.surface1, WASH))
  await clickLabel(prompt, 'toggle-call-0-colored')
  const drawn = JSON.stringify(await prompt.drawn())
  expect(drawn).toContain(`"key":"toggle-call-0-pick","flexShrink":1,"backgroundColor":"${mix(THEME.ok, THEME.surface1, WASH)}"`)
  const parts = (await prompt.find({ type: 'Client', key: 'toggle-call-0-colored' }))?.props.props.parts as { color?: string }[]
  expect(parts.every(part => part.color === THEME.ok)).toBe(true)
  expect(drawn).toMatch(/"key":"toggle-call-0-time-body","height":1,"backgroundColor":"#252A42"/)
  expect(drawn).not.toContain(THEME.lifted)
  expect(await chipsOf(prompt)).not.toContain(THEME.lifted)
})

test('with animations off every animated Client is drawn still, and by default none is', { options: { animations: false } }, async ($, on) => {
  const { mount, prompt } = await mountTimed($, on)
  const running = await mount('ToolUse', 'toolu_run', { tool_use_id: 'toolu_run', tool: 'Bash', input: { command: 'sleep 5' }, isRunning: true, isErrored: false, isInterrupted: false, output: {} })
  expect((await prompt.find({ type: 'Client', key: 'toggle-turn-chip' }))?.props.props.still).toBe(true)
  expect((await running.find({ type: 'Client', key: 'bash-dot' }))?.props.props.still).toBe(true)
  await clickLabel(prompt, 'toggle-turn-colored')
  expect((await prompt.find({ type: 'Client', key: 'toggle-chips-line' }))?.props.props.still).toBe(true)
})

test('with animations on, the fold chip, the kind chips and the running dot animate', async ($, on) => {
  const { mount, prompt } = await mountTimed($, on)
  const running = await mount('ToolUse', 'toolu_run', { tool_use_id: 'toolu_run', tool: 'Bash', input: { command: 'sleep 5' }, isRunning: true, isErrored: false, isInterrupted: false, output: {} })
  expect((await prompt.find({ type: 'Client', key: 'toggle-turn-chip' }))?.props.props.still).toBe(false)
  expect((await running.find({ type: 'Client', key: 'bash-dot' }))?.props.props.still).toBe(false)
  await clickLabel(prompt, 'toggle-turn-colored')
  expect((await prompt.find({ type: 'Client', key: 'toggle-chips-line' }))?.props.props.still).toBe(false)
})

test('icons=safe draws the times as plain muted text, with no Nerd caps', { options: { icons: 'safe' } }, async ($, on) => {
  const { prompt } = await mountTimed($, on)
  const drawn = JSON.stringify(await prompt.drawn())
  expect(drawn).not.toContain(String.fromCodePoint(0xe0b6))
  expect(await prompt.find({ type: 'Text', text: `${timeOfDay(Date.parse('2026-10-03T14:32:00.000Z'))} ` })).toBeDefined()
})

test('with timestamps off, rows show no times', { options: { timestamps: false } }, async ($, on) => {
  const { prompt, tool } = await mountTimed($, on)
  expect(await prompt.find({ type: 'Text', text: /^\d\d:\d\d $/ })).toBeUndefined()
  await clickLabel(prompt, 'toggle-turn-colored')
  await pick(prompt, 1)
  expect(await prompt.find({ key: 'toggle-call-0-colored' })).toBeDefined()
  expect(await prompt.find({ type: 'Text', text: /41s/ })).toBeUndefined()
  expect(await tool.find({ type: 'Text' })).toBeUndefined()
})

test('a subagent report opens its own turn, so the prompt keeps its own reply; a mid-turn report does not', () => {
  const log = logOf([
    row(1, 'user', { message: { role: 'user', content: 'plan the layout' } }),
    said(2, [{ type: 'text', text: 'Here is the layout.' }]),
    row(3, 'user', { isMeta: true, origin: { kind: 'peer' }, message: { role: 'user', content: 'Another Claude session sent a message: report' } }),
    said(4, [{ type: 'text', text: 'Collision Guard is done.' }]),
    row(5, 'attachment', { attachment: { type: 'queued_command', prompt: '<agent-message from="a1">report</agent-message>', isMeta: true } }),
    said(6, [{ type: 'text', text: 'Noted.' }]),
  ].join('\n'))
  expect(log.turns.map(turn => turn.prompt)).toEqual([ID(1), ID(3)])
  expect(log.turns[0]!.reply).toBe(rowKey(ID(2)))
  expect(log.turns[1]!.reply).toBe(rowKey(ID(6)))
})

// The same finished turn as the engine holds it in memory, then a second prompt whose reply repeats a word of the first turn.
const MESSAGES = [
  { role: 'user', text: 'fix the bug', toolUses: [] },
  { role: 'assistant', text: 'Looking.', toolUses: [] },
  { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'toolu_edit', tool: 'Edit', input: { file_path: 'C:\\repo\\hooks\\a.ts' }, result: { structuredPatch: PATCH } }] },
  { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'toolu_edit', text: 'ok', isError: false }] },
  { role: 'assistant', text: 'Fixed.', toolUses: [] },
  { role: 'user', text: 'now the docs', toolUses: [] },
  { role: 'assistant', text: 'ok', toolUses: [] },
] as const

test('before the transcript is read, turns come from the session messages and rows join them by id, text or draw order', () => {
  const log = TurnLog.fromMessages(MESSAGES)
  expect(log.turns.length).toBe(2)
  expect(log.turns[0]!.tools.map(call => [call.name, call.added, call.removed])).toEqual([['Edit', 2, 1]])

  log.adopt(ID(1), 'prompt', 'fix the bug')
  expect(log.turnAt(ID(1))).toBe(log.turns[0])
  log.adopt(ID(2), 'text', 'Looking.')
  expect(log.turnOf(ID(2))).toBe(log.turns[0])
  expect(log.turns[0]!.reply).toBeUndefined()
  // A tool row is found by its id; a row with nothing to match joins the turn drawn just before it.
  log.follow('toolu_edit')
  log.adoptNear(`collapsed-${ID(30)}`)
  expect(log.turnOf(ID(30))).toBe(log.turns[0])
  log.adopt(ID(7), 'text', 'Fixed.')
  expect(log.turns[0]!.reply).toBe(rowKey(ID(7)))

  // "ok" is also inside "Looking.", yet rows draw in order, so it lands in the turn after the last match.
  log.adopt(ID(10), 'prompt', 'now the docs')
  log.adopt(ID(11), 'text', 'ok')
  expect(log.turnOf(ID(11))).toBe(log.turns[1])
})

test('a table too wide for the mod even at its narrowest goes to Claude Code and drops the bubble padding, since Claude Code sizes it to the whole terminal', async ($, on) => {
  const heads = Array.from({ length: 12 }, (_, k) => `column-${k}-name`)
  const table = `Two ways:\n\n| ${heads.join(' | ')} |\n| ${heads.map(() => '---').join(' | ')} |\n| ${heads.join(' | ')} |`
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('session.messages', () => ({ value: [{ role: 'user', text: 'compare them', toolUses: [] }, { role: 'assistant', text: table, toolUses: [] }, { role: 'assistant', text: 'Plain text.', toolUses: [] }] }))
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>{`base ${e.component}`}</Text>
  })
  const mount = (component: string, requestId: string, props: object) =>
    $.ui.mount({ plugin: 'mod-transcript', surface: 'terminal', component, requestId, viewport: { columns: 120, rows: 40 }, props } as never)
  await mount('UserMessage', ID(1), { text: 'compare them', origin: { kind: 'composer' }, isExpanded: false })
  const withTable = await mount('AssistantMessage', ID(2), { text: table })
  const plain = await mount('AssistantMessage', ID(3), { text: 'Plain text.' })
  expect((await withTable.find({ key: 'toggle-bubble-body' }))?.props.paddingX).toBe(0)
  expect((await plain.find({ key: 'toggle-bubble-body' }))?.props.paddingX).toBe(1)
})

test('rows drawn before the transcript is read already fold, so none changes height once it is read', async ($, on) => {
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('session.messages', () => ({ value: MESSAGES as never }))
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>{`base ${e.component}`}</Text>
  })
  const mount = (component: string, requestId: string, props: object) =>
    $.ui.mount({ plugin: 'mod-transcript', surface: 'terminal', component, requestId, viewport: { columns: 120, rows: 40 }, props } as never)

  const prompt = await mount('UserMessage', ID(1), { text: 'fix the bug', origin: { kind: 'composer' }, isExpanded: false })
  const step = await mount('AssistantMessage', ID(2), { text: 'Looking.' })
  const edit = await mount('ToolUse', 'toolu_edit', { tool_use_id: 'toolu_edit', tool: 'Edit', input: { file_path: 'C:\\repo\\hooks\\a.ts' }, isRunning: false, isErrored: false, isInterrupted: false, output: {} })
  const reply = await mount('AssistantMessage', ID(7), { text: 'Fixed.' })
  await mount('UserMessage', ID(10), { text: 'now the docs', origin: { kind: 'composer' }, isExpanded: false })

  // The messages already hold the next prompt, so even the first draw folds the finished turn and keeps its reply.
  expect(await labelText(prompt, 'toggle-turn-colored')).toMatch(/^1 tool/)
  expect(await step.find({ type: 'Text' })).toBeUndefined()
  expect(await edit.find({ key: 'toggle-tool-colored' })).toBeUndefined()
  expect(await reply.find({ type: 'Text', text: 'base AssistantMessage' })).toBeDefined()
  // No time yet, but its space is kept, so the prompt wraps the same once the time arrives.
  expect(await prompt.find({ key: 'toggle-prompt-time-col' })).toBeDefined()
})

test('the transcript is read once, and once more for its unfinished last line; rows drawn later join their turn and fold at the next prompt', async ($, on) => {
  let reads = 0
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: TRANSCRIPT.length, mtimeMs: 0, isLink: false } }))
  // Only the named file holds the transcript: the read session.start makes before its SessionStart arrives finds nothing.
  on('fs.read', reading((_$: unknown, e: { path: string }) => {
    if (e.path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '') !== '/t/s1.jsonl') throw new Error('ENOENT')
    reads += 1
    return { value: TRANSCRIPT }
  }))
  on('turn.start', (_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  const clock = mock.clock(on)
  mock.env(on, { USERPROFILE: '/home' })
  on('session.start', () => ({ cwd: '/w' }))
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>{`base ${e.component}`}</Text>
  })
  await sessionStarted($, clock, 's1', '/t/s1.jsonl', 'startup')
  // A compact keeps the same transcript, so it is not read again.
  await sessionStarted($, clock, 's1', '/t/s1.jsonl', 'compact')
  const mount = (component: string, requestId: string, props: object) =>
    $.ui.mount({ plugin: 'mod-transcript', surface: 'terminal', component, requestId, viewport: { columns: 120, rows: 40 }, props } as never)
  const toolProps = { tool_use_id: 'toolu_new', tool: 'Bash', input: { command: 'ls' }, isRunning: false, isErrored: false, isInterrupted: false, output: {} }

  // The transcript never sees this turn; its rows are claimed as they draw, and the latest turn stays open.
  await $.turn.start({ turnId: 't2' } as never)
  const fresh = await mount('UserMessage', ID(20), { text: 'list the files', origin: { kind: 'composer' }, isExpanded: false })
  const tool = await mount('ToolUse', 'toolu_new', toolProps)
  await $.turn.complete({ turnId: 't2', reason: 'answer', answer: 'ok', isAborted: false } as never)
  expect(await tool.find({ key: 'bash-row' })).toBeDefined()
  // Rows draw in no fixed order, so the prompt opens Claude's bubble and the duration line closes it; no row in between does.
  const took = await mount('TurnDuration', ID(22), { durationMs: 3000 })
  expect(await fresh.find({ key: 'toggle-bubble-open-edge' })).toBeDefined()
  expect(await took.find({ key: 'toggle-bubble-close-edge' })).toBeDefined()
  expect(await tool.find({ key: 'toggle-bubble-bottom-edge' })).toBeUndefined()
  await fresh.unmount()
  await tool.unmount()
  await took.unmount()

  // The next prompt folds it: its row draws nothing, and its prompt carries the fold line.
  await mount('UserMessage', ID(21), { text: 'and the docs', origin: { kind: 'composer' }, isExpanded: false })
  const folded = await mount('ToolUse', 'toolu_new', toolProps)
  expect(await folded.find({ type: 'Text' })).toBeUndefined()
  const head = await mount('UserMessage', ID(20), { text: 'list the files', origin: { kind: 'composer' }, isExpanded: false })
  expect(await labelText(head, 'toggle-turn-colored')).toMatch(/^1 tool$/)
  // The torn last line of the file is read again at the turn's end, then dropped as it is not JSON.
  expect(reads).toBe(2)
})

test('a new session, whose transcript is not written yet, folds its turns; a group claims calls that draw no rows of their own', async ($, on) => {
  // Only session.start arrives, before the transcript file exists.
  on('store.get', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's2' }))
  on('env.get', () => ({ value: undefined }))
  on('fs.list', () => ({ value: [] }))
  on('command.register', () => ({ value: undefined } as never))
  on('ui.panes', () => ({ value: [] }))
  on('session.start', () => ({ cwd: '/w' }))
  const clock = mock.clock(on)
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>{e.component === 'ToolGroup' ? 'Thought for 6s, ran 2 shell commands' : `base ${e.component}`}</Text>
  })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true } as never)

  const mount = (component: string, requestId: string, props: object) =>
    $.ui.mount({ plugin: 'mod-transcript', surface: 'terminal', component, requestId, viewport: { columns: 120, rows: 40 }, props } as never)
  const shell = (id: string) => ({ tool_use_id: id, tool: 'Bash', input: { command: 'ls' }, isRunning: false, isErrored: false, isInterrupted: false, output: {} })
  const live = [
    await mount('UserMessage', ID(30), { text: 'list the files', origin: { kind: 'composer' }, isExpanded: false }),
    await mount('ToolGroup', 'collapsed-toolu_a', { calls: [shell('toolu_a'), shell('toolu_b')], isActive: false, isExpanded: false }),
    await mount('ToolGroup', `collapsed-${ID(32)}`, { calls: [], isActive: false, isExpanded: false }),
    await mount('TurnDuration', ID(33), { word: 'Cooked', durationMs: 12000 }),
  ]
  for (const ui of live) await ui.unmount()

  await mount('UserMessage', ID(31), { text: 'and the docs', origin: { kind: 'composer' }, isExpanded: false })
  const head = await mount('UserMessage', ID(30), { text: 'list the files', origin: { kind: 'composer' }, isExpanded: false })
  const group = await mount('ToolGroup', 'collapsed-toolu_a', { calls: [shell('toolu_a'), shell('toolu_b')], isActive: false, isExpanded: false })
  expect(await labelText(head, 'toggle-turn-colored')).toMatch(/^2 tools$/)
  // The live turn's duration comes from its own duration line, since the transcript was never read for it.
  expect(await head.find({ type: 'Text', text: '12s ' })).toBeDefined()
  expect(await group.find({ type: 'Text' })).toBeUndefined()
  // A group of thinking alone belongs to the turn too: it never draws outside the card, folded or open.
  const thinking = await mount('ToolGroup', `collapsed-${ID(32)}`, { calls: [], isActive: false, isExpanded: false })
  expect(await thinking.find({ type: 'Text' })).toBeUndefined()
  await clickLabel(head, 'toggle-turn-colored')
  expect(await chipsOf(head)).toMatch(/Ran .*"2"/)
  expect(await thinking.find({ type: 'Text' })).toBeUndefined()
  expect(await group.find({ type: 'Text' })).toBeUndefined()
})

test('a finished turn folds under its prompt, keeps its reply, and a click unfolds it', async ($, on) => {
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: TRANSCRIPT.length, mtimeMs: 0, isLink: false } }))
  on('fs.read', reading(() => ({ value: TRANSCRIPT })))
  const clock = mock.clock(on)
  mock.env(on, { USERPROFILE: '/home' })
  on('session.start', () => ({ cwd: '/w' }))
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>{`base ${e.component}`}</Text>
  })

  await sessionStarted($, clock, 's1', '/t/s1.jsonl', 'startup')

  const mount = (component: string, requestId: string, props: object) =>
    $.ui.mount({ plugin: 'mod-transcript', surface: 'terminal', component, requestId, viewport: { columns: 120, rows: 40 }, props } as never)
  const prompt = await mount('UserMessage', ID(1), { text: 'fix the bug', origin: { kind: 'composer' }, isExpanded: false })
  const step = await mount('AssistantMessage', ID(2), { text: 'Looking.', isFirstOfReply: true })
  const reply = await mount('AssistantMessage', ID(7), { text: 'Fixed.', isFirstOfReply: false })
  const edit = await mount('ToolUse', 'toolu_edit', { tool_use_id: 'toolu_edit', tool: 'Edit', input: { file_path: '/repo/hooks/a.ts' }, isRunning: false, isErrored: false, isInterrupted: false, output: { structuredPatch: PATCH } })
  const result = await mount('ToolResult', 'toolu_edit', { tool_use_id: 'toolu_edit', tool: 'Edit', output: { structuredPatch: PATCH }, isErrored: false })

  // Folded: the prompt and its summary line, the reply; the step, the tool row and its result draw nothing.
  expect(await prompt.find({ type: 'Text', text: 'base UserMessage' })).toBeDefined()
  expect(await labelText(prompt, 'toggle-turn-colored')).toBe('2 tools · Edit(hooks/a.ts) · Skill(tidy)')
  expect(await isChipOpen(prompt)).toBe(false)
  expect(await reply.find({ type: 'Text', text: 'base AssistantMessage' })).toBeDefined()
  // One bubble: the head under the prompt opens it, the reply closes it.
  expect(await prompt.find({ key: 'toggle-head-frame-top-edge' })).toBeDefined()
  expect(await reply.find({ key: 'toggle-bubble-top-edge' })).toBeUndefined()
  expect(await reply.find({ key: 'toggle-bubble-bottom-edge' })).toBeDefined()
  expect(await step.find({ type: 'Text' })).toBeUndefined()
  expect(await edit.find({ key: 'toggle-tool-colored' })).toBeUndefined()
  expect(await result.find({ type: 'Text' })).toBeUndefined()

  // Unfolded: the step draws again in the card; the head lists the work by kind, so the tool row and result draw nothing.
  await clickLabel(prompt, 'toggle-turn-colored')
  expect(await isChipOpen(prompt)).toBe(true)
  expect(await step.find({ type: 'Text', text: 'base AssistantMessage' })).toBeDefined()
  // Unfolded rows sit in the turn's card; the reply stays outside it.
  expect(await step.find({ key: 'toggle-card-bar' })).toBeDefined()
  expect(await reply.find({ key: 'toggle-card-bar' })).toBeUndefined()
  expect(await chipsOf(prompt)).toContain('Edited')
  expect(await chipsOf(prompt)).toContain('Other')
  // The head carries the turn's counts and how long it took, each a pill.
  expect(await prompt.find({ type: 'Text', text: /^\+2$/ })).toBeDefined()
  expect(await prompt.find({ type: 'Text', text: /^ \u22121$/ })).toBeDefined()
  expect(await prompt.find({ type: 'Text', text: '1m 4s ' })).toBeDefined()
  expect(await edit.find({ type: 'Text' })).toBeUndefined()
  expect(await result.find({ type: 'Text' })).toBeUndefined()

  // A click on a chip lists its calls under the line; Thought comes first, so Edited starts at cell 16.
  expect(await prompt.find({ key: 'toggle-call-0-colored' })).toBeUndefined()
  await pick(prompt, 17)
  expect(await labelText(prompt, 'toggle-call-0-colored')).toMatch(/ Edit\(hooks\/a\.ts\) $/)

  // A click on the card's strip folds the turn back.
  await pointerOn(step, { in: 'toggle-card-strip', type: 'down', button: 'left', x: 0, y: 0 })
  expect(await isChipOpen(prompt)).toBe(false)
  expect(await step.find({ type: 'Text' })).toBeUndefined()

  for (const ui of [prompt, step, reply, edit, result]) await ui.unmount()
})

test('an open turn shows a chip per kind in order of first use, Thought first, one open at a time', async ($, on) => {
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: TRANSCRIPT.length, mtimeMs: 0, isLink: false } }))
  on('fs.read', reading(() => ({ value: TRANSCRIPT })))
  const clock = mock.clock(on)
  mock.env(on, { USERPROFILE: '/home' })
  on('session.start', () => ({ cwd: '/w' }))
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>{e.component === 'ToolGroup' ? 'Thought for 56s, read 1 file, edited 1 file' : `base ${e.component}`}</Text>
  })
  await sessionStarted($, clock, 's1', '/t/s1.jsonl', 'startup')

  const mount = (component: string, requestId: string, props: object) =>
    $.ui.mount({ plugin: 'mod-transcript', surface: 'terminal', component, requestId, viewport: { columns: 120, rows: 40 }, props } as never)
  const prompt = await mount('UserMessage', ID(1), { text: 'fix the bug', origin: { kind: 'composer' }, isExpanded: false })
  const calls = [
    { tool_use_id: 'toolu_edit', tool: 'Edit', input: { file_path: '/repo/hooks/a.ts' }, isRunning: false, isErrored: false, isInterrupted: false, output: { structuredPatch: PATCH } },
    { tool_use_id: 'toolu_read', tool: 'Read', input: { file_path: '/repo/hooks/b.ts' }, isRunning: false, isErrored: false, isInterrupted: false, output: {} },
  ]
  const group = await mount('ToolGroup', 'toolu_edit', { calls, isActive: false, isExpanded: false })

  // Folded or open, the group itself draws nothing: the head lists the turn's work.
  expect(await group.find({ type: 'Text' })).toBeUndefined()
  await clickLabel(prompt, 'toggle-turn-colored')
  expect(await group.find({ type: 'Text' })).toBeUndefined()
  // Thought first, then each kind in the order the turn first used it: the edit came before the skill.
  const line = await chipsOf(prompt)
  expect([line.indexOf('Thought '), line.indexOf('Edited '), line.indexOf('Other ')].every((at, n, all) => at >= 0 && (n === 0 || at > all[n - 1]!))).toBe(true)

  // The transcript has a thinking block before the edit; its time lives only in Claude Code's sealed drawing.
  expect(await prompt.find({ type: 'Text', text: 'which file?' })).toBeUndefined()
  await pick(prompt, 1)
  expect(await prompt.find({ type: 'Text', text: 'which file?' })).toBeDefined()
  // One chip open at a time: picking Edited closes Thought.
  await pick(prompt, 17)
  expect(await prompt.find({ type: 'Text', text: 'which file?' })).toBeUndefined()
  expect(await labelText(prompt, 'toggle-call-0-colored')).toMatch(/ Edit\(hooks\/a\.ts\) $/)
  expect(await prompt.find({ key: 'toggle-call-1-colored' })).toBeUndefined()
  for (const ui of [prompt, group]) await ui.unmount()
})

test('with fold_turns off, finished turns start open and the line folds them', { options: { fold_turns: false } }, async ($, on) => {
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: TRANSCRIPT.length, mtimeMs: 0, isLink: false } }))
  on('fs.read', reading(() => ({ value: TRANSCRIPT })))
  const clock = mock.clock(on)
  mock.env(on, { USERPROFILE: '/home' })
  on('session.start', () => ({ cwd: '/w' }))
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>{`base ${e.component}`}</Text>
  })

  await sessionStarted($, clock, 's1', '/t/s1.jsonl', 'startup')

  const mount = (component: string, requestId: string, props: object) =>
    $.ui.mount({ plugin: 'mod-transcript', surface: 'terminal', component, requestId, viewport: { columns: 120, rows: 40 }, props } as never)
  const prompt = await mount('UserMessage', ID(1), { text: 'fix the bug', origin: { kind: 'composer' }, isExpanded: false })
  const step = await mount('AssistantMessage', ID(2), { text: 'Looking.', isFirstOfReply: true })

  expect(await isChipOpen(prompt)).toBe(true)
  expect(await step.find({ type: 'Text', text: 'base AssistantMessage' })).toBeDefined()

  await clickLabel(prompt, 'toggle-turn-colored')
  expect(await isChipOpen(prompt)).toBe(false)
  expect(await step.find({ type: 'Text' })).toBeUndefined()

  for (const ui of [prompt, step]) await ui.unmount()
})

test('/mod-transcript settings opens its own panel: a click saves a setting, an action runs, and actions wait while Claude works', async ($, on) => {
  const saved: unknown[] = []
  const ran: string[] = []
  const ROWS = [
    { key: 'mod-transcript.fold_turns', label: 'Fold finished turns', description: 'Starts folded', kind: 'boolean', value: true, provider: { kind: 'plugin', name: 'mod-transcript' }, isLocked: false },
  ]
  on('store.get', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 0, mtimeMs: 0, isLink: false } }))
  on('fs.read', (_$, e) =>
    String(e.path).endsWith('showcase.json') ? { value: JSON.stringify({
            actions: [{ label: 'Say hi', command: 'other', args: 'hi' }, { label: 'Fold all', command: 'mod-transcript' }],
            previews: { fold_turns: { true: { nerd: [{ spans: [{ text: ' 2 tools · Edit', color: 'muted' }] }, { spans: [{ text: '● Fixed.' }] }], safe: [{ spans: [{ text: ' 2 tools · Edit', color: 'muted' }] }, { spans: [{ text: '● Fixed.' }] }] } } },
          }) } : { value: '' },
  )
  on('fs.list', () => ({ value: [] }))
  on('env.get', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('config.list', () => ({ value: ROWS as never }))
  on('config.set', (_$, e) => {
    saved.push([e.key, e.value])
    return { value: e.value }
  })
  on('command.run', (_$, e) => {
    ran.push(`${e.command} ${e.args}`)
    return { text: '' }
  })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  const clock = mock.clock(on)
  on('session.start', () => ({ cwd: '/w' }))

  await $.command.run({ command: 'mod-transcript', args: 'settings' } as never)
  const ui = await $.ui.mount({
    plugin: 'mod-transcript',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'toggle-settings',
    props: { title: 'mod-transcript', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
  } as never)
  expect(await ui.find({ type: 'Text', text: /^Fold finished turns$/ })).toBeDefined()
  expect(JSON.stringify(await ui.drawn())).toMatch(/"flexDirection":"column","paddingX":1,"backgroundColor":"#0D0E17","minHeight":20/)
  // A Button posts no tip, so each action's tip waits hidden in the footer for its pill's hover.
  expect(await ui.find({ key: 'footer-reveal-0' })).toBeDefined()
  expect(JSON.stringify(await ui.drawn())).toContain('"still":false')
  expect(JSON.stringify(await ui.drawn({ in: 'setting-0-flip' }))).toContain('━━')
  // The example card shows the folded turn this value draws: the prompt, its + line, the reply.
  expect(await ui.find({ key: 'setting-preview-0' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ 2 tools · Edit$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^● Fixed.$/ })).toBeDefined()

  await pointerOn(ui, { in: 'setting-0-flip', type: 'down', button: 'left', x: 1, y: 0 })
  expect(saved).toEqual([['mod-transcript.fold_turns', false]])

  await ui.press({ key: 'action-0' })
  expect(ran).toEqual(['other hi'])
  // Its own command skips $.command.run, which never reaches the calling plugin, and answers in the status line.
  await ui.press({ key: 'action-1' })
  expect(ran).toEqual(['other hi'])
  expect(await ui.find({ type: 'Text', text: /every finished turn/ })).toBeDefined()

  await $.turn.start({ turnId: 't1', prompt: 'x' } as never)
  await ui.redraw()
  expect(await ui.find({ type: 'Button', text: /Say hi/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Say hi · available once Claude is idle/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /Fold all/ })).toBeDefined()
  await ui.unmount()
})

// A turn that edits and answers with code, then a turn that only answers; both ended.
const COPYING = [
  row(1, 'user', { message: { role: 'user', content: 'fix the bug\nplease' } }),
  said(2, [{ type: 'tool_use', id: 'toolu_fix', name: 'Edit', input: { file_path: '/repo/a.js' } }]),
  row(3, 'user', { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_fix', content: 'ok' }] }, toolUseResult: { structuredPatch: PATCH } }),
  said(4, [{ type: 'text', text: 'Fixed:\n\n```js\nconst a = 1\n```' }]),
  row(5, 'system', { subtype: 'turn_duration', durationMs: 3000 }),
  row(6, 'user', { message: { role: 'user', content: 'thanks' } }),
  said(7, [{ type: 'text', text: 'You are welcome.' }]),
  row(8, 'system', { subtype: 'turn_duration', durationMs: 1000 }),
].join('\n')

test('copy: each turn keeps its reply, and a reply offers only the choices it holds', () => {
  const [first, second] = logOf(COPYING).turns
  expect(first!.replyText).toBe('Fixed:\n\n```js\nconst a = 1\n```')
  expect(copyChoices(first!.replyText)).toEqual(['reply', 'code', 'text'])
  expect(copyText(first!.replyText!, 'code')).toBe('const a = 1')
  // Plain prose has no marks to drop, so text would copy the same thing and is left out.
  expect(copyChoices(second!.replyText)).toEqual(['reply'])
  expect(copyChoices(undefined)).toEqual([])
})

const RICH = [
  '## Result',
  '',
  'The **fix** is in `src/cart.js:12`, see [the docs](https://example.com/docs).',
  '',
  '- one item',
  '- [x] done item',
  '',
  '| Name | Count |',
  '|:-----|------:|',
  '| apples | 3 |',
  '| kiwi | 12 |',
  '',
  '```sh',
  'npm test -- --grep "a|b" ~/x/y.md',
  '```',
].join('\n')

test('copy: text drops the marks, table rebuilds clean markdown, links list URLs and paths, code stays as written', () => {
  expect(copyChoices(RICH)).toEqual(['reply', 'code', 'text', 'table', 'links'])
  expect(copyText(RICH, 'text')).toBe(
    ['Result', '', 'The fix is in src/cart.js:12, see the docs (https://example.com/docs).', '', '• one item', '• done item', '', '| Name | Count |', '|:-----|------:|', '| apples | 3 |', '| kiwi | 12 |', '', 'npm test -- --grep "a|b" ~/x/y.md'].join('\n'),
  )
  expect(copyText(RICH, 'table')).toBe(['| Name   | Count |', '| :----- | ----: |', '| apples |     3 |', '| kiwi   |    12 |'].join('\n'))
  // A pipe inside a code block is not a table, and a path inside one is not a link.
  expect(copyText(RICH, 'links')).toBe('https://example.com/docs\nsrc/cart.js:12')
  expect(copyText(RICH, 'code')).toBe('npm test -- --grep "a|b" ~/x/y.md')
})

async function mountCopying($: any, on: any, copied: string[]) {
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: COPYING.length, mtimeMs: 0, isLink: false } }))
  on('fs.read', reading(() => ({ value: COPYING })))
  on('ui.copy', (_$: unknown, e: { text: string }) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })
  const clock = mock.clock(on)
  mock.env(on, { USERPROFILE: '/home' })
  on('session.start', () => ({ cwd: '/w' }))
  on('ui.render', ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>{`base ${e.component}`}</Text>
  })
  await sessionStarted($, clock, 's1', '/t/s1.jsonl', 'startup')
  const mount = (component: string, requestId: string, props: object) =>
    $.ui.mount({ plugin: 'mod-transcript', surface: 'terminal', component, requestId, viewport: { columns: 120, rows: 40 }, props } as never)
  return {
    prompt: await mount('UserMessage', ID(1), { text: 'fix the bug\nplease', origin: { kind: 'composer' }, isExpanded: false }),
    reply: await mount('AssistantMessage', ID(4), { text: 'Fixed:\n\n```js\nconst a = 1\n```', isFirstOfReply: true }),
    thanks: await mount('UserMessage', ID(6), { text: 'thanks', origin: { kind: 'composer' }, isExpanded: false }),
    welcome: await mount('AssistantMessage', ID(7), { text: 'You are welcome.', isFirstOfReply: true }),
    took: await mount('TurnDuration', ID(8), { durationMs: 1000 }),
  }
}

const pillOf = async (ui: any) => JSON.stringify(await ui.drawn({ in: 'toggle-copy-pill' }))
const point = (ui: any, type: string, x: number) => ui.pointer({ in: 'toggle-copy-pill', type, button: 'left', x, y: 0 })
// The pill sits at the right end of its Client; the cells before it are its lead.
const leadOf = async (ui: any) => String((await ui.drawn({ in: 'toggle-copy-pill' })).children[0].children[0]).length

test('the copy pill opens on hover, and a click on a choice copies it', async ($, on) => {
  const copied: string[] = []
  const { prompt, reply, thanks, welcome, took } = await mountCopying($, on, copied)
  // The pill sits in the reply's bottom edge, under the newest output; the head carries none.
  expect(await prompt.find({ key: 'toggle-copy-pill' })).toBeUndefined()
  expect(await reply.find({ key: 'toggle-bubble-bottom-end-edge' })).toBeDefined()
  // At rest only the icon after the edge's line; without a Nerd Font it is the one-cell stand-in.
  expect(await pillOf(reply)).toContain('⧉')
  expect(await pillOf(reply)).toContain('──')
  expect(await pillOf(reply)).not.toContain('reply')
  // A move over the line leaves it shut; one on the icon opens it, the choices left of it: " reply ", " code ", " text ".
  const shut = await leadOf(reply)
  await point(reply, 'move', shut - 5)
  expect(await pillOf(reply)).not.toContain(' code ')
  await point(reply, 'move', shut + 1)
  expect(await pillOf(reply)).toContain(' code ')
  const open = await leadOf(reply)
  await point(reply, 'move', open + 8)
  await point(reply, 'down', open + 8)
  expect(copied).toEqual(['const a = 1'])
  expect(await pillOf(reply)).toContain('copied code')
  // The newest turn stays open until the next prompt; the line closing its bubble carries the pill once it ended.
  expect(await welcome.find({ key: 'toggle-copy-pill' })).toBeUndefined()
  expect(await pillOf(took)).toContain('⧉')
  for (const ui of [prompt, reply, thanks, welcome, took]) await ui.unmount()
})

test('icons=nerd draws the copy pill with the Nerd copy glyph and rounded caps', { options: { icons: 'nerd' } }, async ($, on) => {
  const { prompt, reply, thanks, welcome, took } = await mountCopying($, on, [])
  expect(await pillOf(reply)).toContain('\u{F018F}')
  expect(await pillOf(reply)).not.toContain('⧉')
  for (const ui of [prompt, reply, thanks, welcome, took]) await ui.unmount()
})

test('the copy pill sits on surface3 with its icon as a washed subpill, in Nerd and in safe mode', async ($, on) => {
  const wash = mix(THEME.accent, THEME.surface3, WASH)
  const { prompt, reply, thanks, welcome, took } = await mountCopying($, on, [])
  expect((await reply.find({ key: 'toggle-copy-pill' }))?.props.props.bg).toBe(THEME.surface3)
  const safe = JSON.stringify(await reply.drawn({ in: 'toggle-copy-pill' }))
  expect(safe).toContain(`"backgroundColor":"${wash}"`)
  expect(safe).toContain(' ⧉ ')
  expect(safe).not.toContain(THEME.surface2)
  for (const ui of [prompt, reply, thanks, welcome, took]) await ui.unmount()
})

test('icons=nerd draws the copy icon as a rounded subpill washed from accent', { options: { icons: 'nerd' } }, async ($, on) => {
  const wash = mix(THEME.accent, THEME.surface3, WASH)
  const { prompt, reply, thanks, welcome, took } = await mountCopying($, on, [])
  const nerd = JSON.stringify(await reply.drawn({ in: 'toggle-copy-pill' }))
  expect(nerd).toContain(`"color":"${wash}","backgroundColor":"${THEME.surface3}"`)
  expect(nerd).toContain('\u{F018F}')
  expect(nerd).not.toContain(' \u{F018F} ')
  for (const ui of [prompt, reply, thanks, welcome, took]) await ui.unmount()
})

test('with copy_pill off, the reply keeps a plain bottom edge', { options: { copy_pill: false } }, async ($, on) => {
  const { prompt, reply, thanks, welcome, took } = await mountCopying($, on, [])
  expect(await reply.find({ key: 'toggle-copy-pill' })).toBeUndefined()
  expect(await reply.find({ key: 'toggle-bubble-bottom-edge' })).toBeDefined()
  expect(await took.find({ key: 'toggle-copy-pill' })).toBeUndefined()
  for (const ui of [prompt, reply, thanks, welcome, took]) await ui.unmount()
})

test('hovering a copy choice or the fold chip shows its tip in the band tip row, and leaving clears it', async ($, on) => {
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: COPYING.length, mtimeMs: 0, isLink: false } }))
  on('fs.read', reading(() => ({ value: COPYING })))
  const clock = mock.clock(on)
  mock.env(on, { USERPROFILE: '/home' })
  on('session.start', () => ({ cwd: '/w' }))
  on('ui.render', ($$: any, e: any) => {
    const { Box, Text } = $$.ui.resolve(e)
    if (e.component === 'AbovePrompt') return <Box key="menu-rows" flexDirection="column"><Box key="menu-row" flexDirection="row"><Text key="pill">Files</Text></Box></Box>
    return <Text>{`base ${e.component}`}</Text>
  })
  await sessionStarted($, clock, 's1', '/t/s1.jsonl', 'startup')
  const mount = (component: string, requestId: string, props: object) =>
    $.ui.mount({ plugin: 'mod-transcript', surface: 'terminal', component, requestId, viewport: { columns: 120, rows: 40 }, props } as never)
  const band = await $.ui.mount({ plugin: 'mod-transcript', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} } } as never)
  const prompt = await mount('UserMessage', ID(1), { text: 'fix the bug\nplease', origin: { kind: 'composer' }, isExpanded: false })
  const reply = await mount('AssistantMessage', ID(4), { text: 'Fixed:\n\n```js\nconst a = 1\n```', isFirstOfReply: true })
  const tip = async () => (await band.find({ type: 'Text', text: /copies|folds or unfolds/ }))?.text
  expect(await tip()).toBeUndefined()
  const shut = await leadOf(reply)
  await pointerOn(reply, { in: 'toggle-copy-pill', type: 'move', button: 'left', x: shut + 1, y: 0 })
  expect(await tip()).toBe(' copies this reply')
  const open = await leadOf(reply)
  await pointerOn(reply, { in: 'toggle-copy-pill', type: 'move', button: 'left', x: open + 8, y: 0 })
  expect(await tip()).toBe(' copies the code blocks')
  await pointerOn(reply, { in: 'toggle-copy-pill', type: 'leave', button: 'left', x: 0, y: 0 })
  expect(await tip()).toBeUndefined()
  await pointerOn(prompt, { in: 'toggle-turn-chip', type: 'enter', button: 'left', x: 1, y: 0 })
  expect(await tip()).toBe(' folds or unfolds this turn')
  await pointerOn(prompt, { in: 'toggle-turn-chip', type: 'leave', button: 'left', x: 1, y: 0 })
  expect(await tip()).toBeUndefined()
  for (const ui of [band, prompt, reply]) await ui.unmount()
})

test('this mod draws its own toasts as cards in the band, the × shows its tip, and a click on it dismisses the card', async ($, on) => {
  on('store.get', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 0, mtimeMs: 0, isLink: false } }))
  on('fs.read', reading(() => ({ value: '' })))
  on('fs.list', () => ({ value: [] }))
  on('env.get', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'too narrow' } }))
  const clock = mock.clock(on)
  on('session.start', () => ({ cwd: '/w' }))
  on('ui.render', ($$: any, e: any) => {
    const { Box, Text } = $$.ui.resolve(e)
    if (e.component === 'AbovePrompt') return <Box key="menu-rows" flexDirection="column"><Box key="menu-row" flexDirection="row"><Text key="pill">Files</Text></Box></Box>
    return <Text>{`base ${e.component}`}</Text>
  })
  const band = await $.ui.mount({ plugin: 'mod-transcript', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} } } as never)
  const toast = () => band.find({ type: 'Text', text: 'Settings panel waiting' })
  expect(await toast()).toBeUndefined()

  await $.command.run({ command: 'mod-transcript', args: 'settings' } as never)
  expect(await toast()).toBeDefined()
  expect(await band.find({ key: 'toast-transcript-1' })).toBeDefined()

  await pointerOn(band, { in: 'toast-transcript-1', type: 'enter', button: 'left', x: 1, y: 0 })
  expect((await band.find({ type: 'Text', text: /hides this message/ }))?.text).toBe(' hides this message')
  await pointerOn(band, { in: 'toast-transcript-1', type: 'down', button: 'left', x: 1, y: 0 })
  expect(await toast()).toBeUndefined()
  await band.unmount()
})

// Prompts 1 and 2, a subagent report that opens a turn without being a prompt, a rewound branch, then prompt 3 on the live branch.
const NUMBERED = [
  row(1, 'user', { message: { role: 'user', content: 'first' } }),
  said(2, [{ type: 'text', text: 'One.' }]),
  row(3, 'user', { message: { role: 'user', content: 'second' } }),
  row(4, 'user', { isMeta: true, origin: { kind: 'peer' }, message: { role: 'user', content: 'report' } }),
  row(5, 'user', { message: { role: 'user', content: '/clear' } }),
  JSON.stringify({ type: 'user', uuid: ID(6), parentUuid: ID(2), message: { role: 'user', content: 'abandoned' } }),
  JSON.stringify({ type: 'user', uuid: ID(7), parentUuid: ID(4), message: { role: 'user', content: 'third' } }),
].join('\n') + '\n'

test('a row whose parent Claude Code never wrote joins the chain through the row before it, so the earlier prompts keep their numbers', () => {
  const log = logOf(
    [
      row(1, 'user', { message: { role: 'user', content: 'first' } }),
      said(2, [{ type: 'text', text: 'One.' }]),
      JSON.stringify({ type: 'user', uuid: ID(4), parentUuid: ID(3), message: { role: 'user', content: 'second' } }),
    ].join('\n') + '\n',
  )
  expect(log.turns.map(turn => log.numberOf(turn))).toEqual([1, 2])
})

test('a prompt\x27s number is its place among the live prompts, as the Prompts panel counts them', () => {
  const log = logOf(NUMBERED)
  expect(log.turns.map(turn => log.numberOf(turn))).toEqual([1, 2, undefined, undefined, 3])
  // row 6 hangs off row 2, so rewinding past row 3 dropped it; row 7 continues the live chain.
  expect(log.turns.map(turn => turn.prompt)).toEqual([ID(1), ID(3), ID(4), ID(6), ID(7)])
})

const mountNumbered = async ($: any, on: any, requestId: string, text: string) => {
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: NUMBERED.length, mtimeMs: 0, isLink: false } }))
  on('fs.read', reading(() => ({ value: NUMBERED })))
  const clock = mock.clock(on)
  on('session.start', (_$: unknown, e: unknown) => e)
  on('command.register', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  mock.env(on, { USERPROFILE: '/home' })
  on('ui.render', ($$: any, e: any) => {
    const { Box, Text } = $$.ui.resolve(e)
    if (e.component === 'AbovePrompt') return <Box key="menu-rows" flexDirection="column"><Box key="menu-row" flexDirection="row"><Text key="pill">Files</Text></Box></Box>
    return <Text>{`base ${e.component}`}</Text>
  })
  await sessionStarted($, clock, 's1', '/t/s1.jsonl', 'startup')
  return $.ui.mount({ plugin: 'mod-transcript', surface: 'terminal', component: 'UserMessage', requestId, viewport: { columns: 120, rows: 40 }, props: { text, origin: { kind: 'composer' }, isExpanded: false } } as never)
}

test('icons=nerd draws #N in a rounded pill beside the Nth prompt', { options: { icons: 'nerd' } }, async ($, on) => {
  const second = await mountNumbered($, on, ID(3), 'second')
  const drawn = JSON.stringify(await second.drawn({ in: 'toggle-prompt-number' }))
  expect(drawn).toContain('#2')
  expect(drawn).toContain(String.fromCodePoint(0xe0b6))
  expect(drawn).not.toContain(' #2 ')
})

test('icons=safe draws #N padded, with no Nerd caps', { options: { icons: 'safe' } }, async ($, on) => {
  const third = await mountNumbered($, on, ID(7), 'third')
  const drawn = JSON.stringify(await third.drawn({ in: 'toggle-prompt-number' }))
  expect(drawn).toContain(' #3 ')
  expect(drawn).not.toContain(String.fromCodePoint(0xe0b6))
})

test('with prompt_numbers off, no number and no reserved cells', { options: { prompt_numbers: false } }, async ($, on) => {
  const first = await mountNumbered($, on, ID(1), 'first')
  expect(await first.find({ key: 'toggle-prompt-gutter' })).toBeUndefined()
  expect(await first.find({ key: 'toggle-prompt-number' })).toBeUndefined()
})

test('pointing at the number shows its tip in the band tip row, and leaving clears it', async ($, on) => {
  const first = await mountNumbered($, on, ID(1), 'first')
  const band = await $.ui.mount({ plugin: 'mod-transcript', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} } } as never)
  const tip = async () => (await band.find({ type: 'Text', text: /of the session/ }))?.text
  expect(await tip()).toBeUndefined()
  await first.pointer({ in: 'toggle-prompt-number', type: 'enter', button: 'left', x: 1, y: 1 })
  expect(await tip()).toBe(' prompt 1 of the session')
  expect(await band.find({ type: 'Text', text: /Prompt #1/ })).toBeDefined()
  await first.pointer({ in: 'toggle-prompt-number', type: 'leave', button: 'left', x: 1, y: 1 })
  expect(await tip()).toBeUndefined()
})

test('in a fresh session the first prompt is #1 although Claude Code draws it first under a placeholder id', () => {
  const log = new TurnLog()
  log.claim('placeholder', 'prompt')
  log.claim(ID(1), 'prompt')
  log.claim('placeholder', 'prompt')
  expect(log.turns.map(turn => log.numberOf(turn))).toEqual([1])
  log.claim('placeholder', 'prompt')
  log.claim(ID(3), 'prompt')
  expect(log.turns.map(turn => log.numberOf(turn))).toEqual([1, 2])
})

test('a guessed prompt is not adopted by the placeholder row', () => {
  const log = TurnLog.fromMessages([{ role: 'user', text: 'first', toolUses: [] }])
  log.adopt('placeholder', 'prompt', 'first')
  log.adopt(ID(1), 'prompt', 'first')
  expect(log.turns.map(turn => turn.prompt)).toEqual([ID(1)])
})

const LAUNCH = { isAsync: true, status: 'async_launched', agentId: 'a1', description: 'Research launch posts', prompt: 'p' }

test('a background agent drawn live previews that it runs in the background, not "No output"', () => {
  const log = new TurnLog()
  log.claim(ID(60), 'prompt')
  log.claimCall('toolu_live_bg', 'Agent', { description: 'Research launch posts' }, false, LAUNCH)
  expect(log.callOf('toolu_live_bg')!.preview!.lines.map(line => line.text)).toEqual(['Running in the background, its report arrives as a message'])
})

// A prompt sent mid-turn with an image, as Claude Code stores it: a queued_command whose prompt is content blocks.
const QUEUED_IMAGE = (n: number, text: string) =>
  row(n, 'attachment', { attachment: { type: 'queued_command', prompt: [{ type: 'text', text }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBOR' } }], commandMode: 'prompt', origin: { kind: 'human' } } })

test('a prompt sent mid-turn with an image takes its own place and number, and its row drawn under another id joins that turn', () => {
  const log = logOf([
    row(1, 'user', { message: { role: 'user', content: 'commit it all' } }),
    said(2, [{ type: 'text', text: 'Committing.' }]),
    QUEUED_IMAGE(3, '[Image #1] the header still overlaps here?'),
    said(4, [{ type: 'text', text: 'Fixed.' }]),
    row(5, 'user', { message: { role: 'user', content: 'push the branch' } }),
  ].join('\n') + '\n')
  expect(log.turns.map(turn => log.numberOf(turn))).toEqual([1, 2, 3])
  // The engine draws the queued prompt under an id of its own.
  log.claim('drawn-queued-row', 'prompt', Date.now(), false, '[Image #1] the header still overlaps here?')
  expect(log.turns).toHaveLength(3)
  expect(log.turnAt('drawn-queued-row')).toBe(log.turns[1])
  expect(log.numberOf(log.turnAt('drawn-queued-row')!)).toBe(2)
})

// As Claude Code 2.1.296 writes a prompt typed while a turn ran: queue-operation rows with no uuid, then a plain user row once dequeued.
test('a prompt drawn while queued, under one id or two, keeps one turn and its number once its plain row lands', () => {
  const B = 'Run git --version and node --version, then reply: main-done.'
  const log = logOf([
    row(1, 'user', { message: { role: 'user', content: 'launch the agent' }, origin: { kind: 'human' } }),
    said(2, [{ type: 'tool_use', id: 'toolu_agent', name: 'Agent', input: { description: 'Write files' } }]),
    JSON.stringify({ type: 'queue-operation', operation: 'enqueue', content: B }),
  ].join('\n'))
  log.claim('drawn-queued', 'prompt', Date.now(), false, B)
  log.claim('drawn-dequeued', 'prompt', Date.now(), false, B)
  for (const line of [
    JSON.stringify({ type: 'queue-operation', operation: 'dequeue' }),
    row(3, 'user', { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_agent', content: 'launched' }] } }),
    row(4, 'user', { message: { role: 'user', content: B }, origin: { kind: 'human' } }),
    said(5, [{ type: 'text', text: 'main-done' }]),
  ])
    log.feed(line)
  expect(log.turns.filter(turn => !turn.isReport)).toHaveLength(2)
  expect(log.turns.map(turn => log.numberOf(turn))).toEqual([1, 2])
  expect(log.turnAt('drawn-queued')).toBe(log.turns[1])
  expect(log.turnAt('drawn-dequeued')).toBe(log.turns[1])
  expect(log.turnAt(ID(4))).toBe(log.turns[1])
  expect(log.turns[1]!.reply).toBe(rowKey(ID(5)))
})

test('the same words sent again later still open a turn of their own', () => {
  const log = logOf(row(1, 'user', { message: { role: 'user', content: 'yes' } }))
  log.claim('drawn-again', 'prompt', Date.now(), false, 'yes')
  log.feed(row(2, 'user', { message: { role: 'user', content: 'yes' } }))
  expect(log.turns.map(turn => log.numberOf(turn))).toEqual([1, 2])
})

// A skill command as Claude Code 2.1.300 stores it: a string of command tags with a promptId, then a meta row holding the skill body.
const SKILL_ROW = (n: number, args: string) =>
  row(n, 'user', {
    message: { role: 'user', content: `<command-message>execute</command-message>\n<command-name>/execute</command-name>\n<command-args>${args}</command-args>` },
    origin: { kind: 'human' },
    promptId: 'p-skill',
    turnPosition: { promptIndex: 2 },
  })

// A local command (/clear) stores a caveat, the command row with no promptId, and its output.
const CLEAR_ROWS = (n: number) => [
  row(n, 'user', { isMeta: true, message: { role: 'user', content: '<local-command-caveat>Caveat: the messages below were generated by the user</local-command-caveat>' } }),
  row(n + 1, 'user', { origin: { kind: 'human' }, message: { role: 'user', content: '<command-name>/clear</command-name>\n<command-message>clear</command-message>\n<command-args></command-args>' } }),
  row(n + 2, 'user', { message: { role: 'user', content: '<local-command-stdout></local-command-stdout>' } }),
]

const SKILLED = [
  row(1, 'user', { message: { role: 'user', content: 'first' }, origin: { kind: 'human' }, promptId: 'p-first' }),
  said(2, [{ type: 'text', text: 'One.' }]),
  SKILL_ROW(3, 'fix it'),
  row(4, 'user', { isMeta: true, message: { role: 'user', content: [{ type: 'text', text: 'Skill body.' }] } }),
  said(5, [{ type: 'tool_use', id: 'toolu_skill_read', name: 'Read', input: { file_path: '/w/a.ts' } }]),
  row(6, 'user', { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_skill_read', content: 'ok' }] } }),
  said(7, [{ type: 'text', text: 'Done.' }]),
  ...CLEAR_ROWS(8),
].join('\n') + '\n'

test('a skill command opens a numbered turn of its own with its tools, and a local command opens none', () => {
  const log = logOf(SKILLED)
  expect(log.turns.map(turn => log.numberOf(turn))).toEqual([1, 2])
  expect(log.turns[1]!.command).toBe('/execute fix it')
  expect(log.turns[0]!.tools).toHaveLength(0)
  expect(log.turns[1]!.tools.map(call => call.id)).toEqual(['toolu_skill_read'])
  expect(log.turns[1]!.reply).toBe(rowKey(ID(7)))
  expect(log.turns.filter(turn => turn.command)).toHaveLength(1)
})

test('a skill command without args reads as the bare command', () => {
  expect(commandOf('<command-message>execute</command-message>\n<command-name>/execute</command-name>\n<command-args></command-args>')).toBe('/execute')
  expect(commandOf('run the tests')).toBeUndefined()
})

test('a skill turn started before the transcript holds its row keeps its tools, and the row adopts it', () => {
  const log = logOf(row(1, 'user', { message: { role: 'user', content: 'first' }, promptId: 'p-first' }))
  log.claimCommand('/execute fix it')
  log.claimCommand('/execute fix it')
  log.claimCall('toolu_live', 'Read', { file_path: '/w/a.ts' }, true, undefined)
  expect(log.turns).toHaveLength(2)
  expect(log.turns[1]!.tools.map(call => call.id)).toEqual(['toolu_live'])
  expect(log.numberOf(log.turns[1]!)).toBe(2)
  log.feed(SKILL_ROW(2, 'fix it'))
  expect(log.turns).toHaveLength(2)
  expect(log.turns[1]!.prompt).toBe(ID(2))
})

test('the tool rows of a finished skill turn fold to their own lines, since its row has no head to unfold them', async ($, on) => {
  const text = [
    row(1, 'user', { message: { role: 'user', content: 'run the tests' }, promptId: 'p-first' }),
    said(2, [{ type: 'text', text: 'One.' }]),
    SKILL_ROW(3, 'fix it'),
    row(4, 'assistant', { message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_bash', name: 'Bash', input: { command: 'claude plugin test .' } }] } }),
    row(5, 'user', { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_bash', content: 'ok' }] } }),
    said(6, [{ type: 'text', text: 'Done.' }]),
    row(7, 'user', { message: { role: 'user', content: 'now the docs' }, promptId: 'p-third' }),
  ].join('\n') + '\n'
  const { tool } = await mountTimed($, on, text)
  expect(await tool.find({ key: 'toggle-tool-plain' })).toBeDefined()
})

test('a background agent drawn before its input streams in takes its name from the launch result', () => {
  const log = new TurnLog()
  log.claim(ID(61), 'prompt')
  log.claimCall('toolu_live_name', 'Agent', {}, false, LAUNCH)
  expect(turnLine(log.turns[log.turns.length - 1]!)).toBe('1 tool · Agent(Research launch posts)')
})

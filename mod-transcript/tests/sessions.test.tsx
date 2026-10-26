// mod-transcript / tests/sessions.test.tsx, by v-amorim
// Tests that each session draws its own turns across /resume, /clear, fork, rewritten files and large transcripts.
import { expect, mock, test } from 'claude-code/testing'

import { TurnLog } from '../hooks/turns'
import { reading, sessionStarted } from './bridge-feed'

// The kit's types declare no timer globals, yet the runtime has them.
declare const setTimeout: (handler: (value: unknown) => void, ms: number) => unknown

const ID = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`
const row = (n: number, type: string, extra: object, parent: string | null = ID(n - 1)) => JSON.stringify({ type, uuid: ID(n), parentUuid: parent, ...extra })
const asked = (n: number, text: string, parent: string | null = ID(n - 1)) => row(n, 'user', { message: { role: 'user', content: text } }, parent)
const said = (n: number, content: unknown[]) => row(n, 'assistant', { message: { role: 'assistant', content } })
const answered = (n: number, id: string) => row(n, 'user', { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } })
const took = (n: number) => row(n, 'system', { subtype: 'turn_duration', durationMs: 1000 })
const file = (rows: string[]) => rows.join('\n') + '\n'

// Session A: two prompts, the second with one edit.
const A = file([
  asked(101, 'alpha one', null),
  said(102, [{ type: 'text', text: 'A one.' }]),
  took(103),
  asked(104, 'alpha two'),
  said(105, [{ type: 'tool_use', id: 'toolu_a', name: 'Edit', input: { file_path: '/repo/a.ts' } }]),
  answered(106, 'toolu_a'),
  said(107, [{ type: 'text', text: 'A two.' }]),
  took(108),
])

// Session B: three prompts, the second with two calls.
const B = file([
  asked(201, 'beta one', null),
  said(202, [{ type: 'text', text: 'B one.' }]),
  took(203),
  asked(204, 'beta two'),
  said(205, [{ type: 'tool_use', id: 'toolu_b1', name: 'Bash', input: { command: 'ls' } }]),
  answered(206, 'toolu_b1'),
  said(207, [{ type: 'tool_use', id: 'toolu_b2', name: 'Read', input: { file_path: '/repo/b.ts' } }]),
  answered(208, 'toolu_b2'),
  said(209, [{ type: 'text', text: 'B two.' }]),
  took(210),
  asked(211, 'beta three'),
  said(212, [{ type: 'text', text: 'B three.' }]),
  took(213),
])

const DIGITS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const base64 = (bytes: Uint8Array) => {
  let out = ''
  for (let at = 0; at < bytes.length; at += 3) {
    const [a, b = 0, c = 0] = [bytes[at]!, bytes[at + 1], bytes[at + 2]]
    const n = (a << 16) | (b << 8) | c
    out += DIGITS[n >> 18]! + DIGITS[(n >> 12) & 63]! + (at + 1 < bytes.length ? DIGITS[(n >> 6) & 63]! : '=') + (at + 2 < bytes.length ? DIGITS[n & 63]! : '=')
  }
  return out
}
const byteLength = (text: string) => new TextEncoder().encode(text).length

// held: a read of that path waits until the promise settles.
type World = { files: Record<string, string>; store: Map<string, unknown>; session: string; readFails?: boolean; storeFails?: boolean; now?: number; spawned?: string[][]; configDir?: string; held?: { path: string; until: Promise<void> } }

// One process that can switch sessions; files and the store are shared, as two windows share them.
function world($: any, on: any, init: Partial<World> = {}) {
  const w: World = { files: { '/t/a.jsonl': A, '/t/b.jsonl': B }, store: new Map(), session: 'a', spawned: [], ...init }
  // The host hands the mocks absolute native paths, so `/t/a.jsonl` arrives as `C:\t\a.jsonl` on Windows.
  const plain = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
  const fileAt = (path: string) => w.files[plain(path)]
  on('session.id', () => ({ value: w.session }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: w.store.get(e.key) }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    if (w.storeFails) throw new Error('store unavailable')
    w.store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...w.store.keys()] }))
  on('store.delete', (_$: unknown, e: { key: string }) => {
    w.store.delete(e.key)
    return { value: undefined }
  })
  on('fs.stat', (_$: unknown, e: { path: string }) => {
    const text = fileAt(e.path)
    if (text === undefined) throw new Error('ENOENT')
    return { value: { kind: 'file', size: text.length, mtimeMs: 0, isLink: false } }
  })
  on('fs.read', reading(async (_$: unknown, e: { path: string }) => {
    const text = fileAt(e.path) ?? ''
    // The host rejects a read over 4 MiB.
    if (w.readFails || text.length > 4 * 1024 * 1024) throw new Error('too big')
    if (w.held && plain(e.path) === w.held.path) await w.held.until
    return { value: text }
  }))
  // tail.ts's POSIX form: sh -c '...' sh <path> <from + 1> <length>, answered as base64.
  on('process.run', (_$: unknown, e: { argv: string[] }) => {
    w.spawned!.push([...e.argv])
    const [path, from, length] = e.argv.slice(-3)
    const bytes = new TextEncoder().encode(fileAt(path!) ?? '').subarray(Number(from) - 1, Number(from) - 1 + Number(length))
    return { value: { exitCode: 0, stdout: base64(bytes), stderr: '' } }
  })
  on('process.spawn', async function* (_$: unknown, e: { argv: string[] }) {
    w.spawned!.push([...e.argv])
    yield { stream: 'stdout', text: fileAt(e.argv[e.argv.length - 1]!) ?? '' }
    return { value: { code: 0, signal: null } }
  })
  on('env.get', (_$: unknown, e: { name: string }) => ({ value: e.name === 'USERPROFILE' ? '/home' : e.name === 'CLAUDE_CONFIG_DIR' ? w.configDir : undefined }))
  on('fs.list', (_$: unknown, e: { path: string }) => ({ value: plain(e.path) === `${w.configDir?.replace(/\/$/, '') ?? '/home/.claude'}/projects` ? [{ name: 'proj', kind: 'dir' }] : [] }))
  on('fs.exists', (_$: unknown, e: { path: string }) => ({ value: fileAt(e.path) !== undefined }))
  on('session.messages', () => ({ value: [] }))
  on('session.start', () => ({ cwd: '/w' }))
  on('command.register', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('turn.complete', () => ({ text: '' }))
  on('session.end', (_$: unknown, e: { sessionId: string }) => ({ sessionId: e.sessionId }))
  on('ui.render', ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>{`base ${e.component}`}</Text>
  })
  const clock = w.now === undefined ? mock.clock(on) : mock.clock(on, { now: w.now })
  // A row drawn again replaces its earlier instance, as a redraw does.
  const mounted = new Map<string, any>()
  // A /resume or /clear replaces the whole message list, so the old session's rows unmount.
  const switchTo = async (session: string, isEnded = true) => {
    if (session === w.session) return
    if (isEnded) await $.session.end({ reason: 'resume', sessionId: w.session, resume: {} } as never)
    for (const ui of mounted.values()) await ui.unmount()
    mounted.clear()
    w.session = session
  }
  const start = async (session: string, path: string, source: string) => {
    await switchTo(session)
    await sessionStarted($, clock, session, path, source)
  }
  const mount = async (component: string, requestId: string, props: object) => {
    await mounted.get(requestId)?.unmount()
    const ui = await $.ui.mount({ plugin: 'mod-transcript', surface: 'terminal', component, requestId, viewport: { columns: 120, rows: 40 }, props } as never)
    mounted.set(requestId, ui)
    return ui
  }
  const prompt = (n: number, text: string) => mount('UserMessage', ID(n), { text, origin: { kind: 'composer' }, isExpanded: false })
  const reply = (n: number, text: string) => mount('AssistantMessage', ID(n), { text })
  return { w, clock, start, switchTo, mount, prompt, reply }
}

const numberOf = async (ui: any) => JSON.stringify(await ui.drawn({ in: 'toggle-prompt-number' })).match(/" ?#(\d+) ?"/)?.[1]

test('a resume to another session and back draws the shown session\'s own numbers, card and reply', async ($, on) => {
  const { start, prompt, reply } = world($, on)
  await start('a', '/t/a.jsonl', 'startup')
  expect(await numberOf(await prompt(104, 'alpha two'))).toBe('2')

  await start('b', '/t/b.jsonl', 'resume')
  expect(await numberOf(await prompt(211, 'beta three'))).toBe('3')

  await start('a', '/t/a.jsonl', 'resume')
  // The next prompt sent in A is A's third, not B's fourth.
  expect(await numberOf(await prompt(109, 'alpha three'))).toBe('3')
  const head = await prompt(104, 'alpha two')
  expect(await numberOf(head)).toBe('2')
  // A's one edit, not B's two calls.
  expect(JSON.stringify(await head.drawn({ in: 'toggle-turn-colored' }))).toMatch(/1 tool · Edit/)
  expect(await (await reply(107, 'A two.')).find({ type: 'Text', text: 'base AssistantMessage' })).toBeDefined()
})

test('rows drawn before the new session\'s SessionStart never join the old log, and a missing SessionStart still reads the new transcript', async ($, on) => {
  const { w, clock, start, switchTo, prompt } = world($, on)
  await start('a', '/t/a.jsonl', 'startup')
  w.store.set('transcript:b', '/t/b.jsonl')
  // The resumed session's rows draw first; its SessionStart never comes.
  await switchTo('b')
  await prompt(211, 'beta three')
  await clock.settle()
  expect(await numberOf(await prompt(211, 'beta three'))).toBe('3')
  expect(await numberOf(await prompt(201, 'beta one'))).toBe('1')

  // Back in A, B's rows are gone from the log.
  await switchTo('a')
  await prompt(104, 'alpha two')
  await clock.settle()
  expect(await numberOf(await prompt(104, 'alpha two'))).toBe('2')
  expect(await numberOf(await prompt(109, 'alpha three'))).toBe('3')
})

test('a read still running when the session switches is dropped, never fed into the new session\'s log', async ($, on) => {
  const { w, start, prompt } = world($, on)
  // A longer than B, so a stale read of A would feed A's tail past what B fed.
  const more = Array.from({ length: 12 }, (_, k) => [asked(130 + 2 * k, `alpha more ${k}`), said(131 + 2 * k, [{ type: 'text', text: 'More.' }])]).flat()
  w.files['/t/a.jsonl'] = A + file(more) + '{"torn'
  await start('a', '/t/a.jsonl', 'startup')
  let release = () => {}
  w.held = { path: '/t/a.jsonl', until: new Promise<void>(resolve => (release = resolve)) }
  // The turn's end reads A again for its unfinished line, and that read is slow.
  const ending = $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false } as never)
  const switching = start('b', '/t/b.jsonl', 'resume')
  release()
  await Promise.all([ending, switching])
  expect(await numberOf(await prompt(211, 'beta three'))).toBe('3')
  expect(await numberOf(await prompt(214, 'beta four'))).toBe('4')
})

test('with no session.end, a row still notices a new session id within the check interval', async ($, on) => {
  const { w, clock, start, switchTo, prompt } = world($, on)
  await start('a', '/t/a.jsonl', 'startup')
  w.store.set('transcript:b', '/t/b.jsonl')
  await prompt(104, 'alpha two')
  await switchTo('b', false)
  await new Promise(resolve => setTimeout(resolve, 600))
  await prompt(211, 'beta three')
  await clock.settle()
  expect(await numberOf(await prompt(211, 'beta three'))).toBe('3')
})

test('/clear starts an empty log: the first prompt is #1 and no old turn folds under it', async ($, on) => {
  const { start, prompt, mount } = world($, on)
  await start('a', '/t/a.jsonl', 'startup')
  await prompt(104, 'alpha two')
  await start('c', '/t/c.jsonl', 'clear')
  const first = await prompt(301, 'gamma one')
  expect(await numberOf(first)).toBe('1')
  // A tool row of the new session joins its turn and draws live, not under an A head.
  const tool = await mount('ToolUse', 'toolu_c', { tool_use_id: 'toolu_c', tool: 'Bash', input: { command: 'ls' }, isRunning: false, isErrored: false, isInterrupted: false, output: {} })
  expect(await tool.find({ key: 'bash-row' })).toBeDefined()
})

test('a fork reads its new transcript whole, copied rows included', async ($, on) => {
  const { w, start, prompt } = world($, on)
  await start('a', '/t/a.jsonl', 'startup')
  w.files['/t/f.jsonl'] = A + file([asked(120, 'forked one', ID(108)), said(121, [{ type: 'text', text: 'F.' }])])
  await start('f', '/t/f.jsonl', 'fork')
  expect(await numberOf(await prompt(104, 'alpha two'))).toBe('2')
  expect(await numberOf(await prompt(120, 'forked one'))).toBe('3')
})

test('a transcript that shrank since the last read is read again from its start', async ($, on) => {
  const { w, start, prompt } = world($, on)
  // An unfinished last line makes the next turn read the file again.
  w.files['/t/a.jsonl'] = B + '{"torn'
  await start('a', '/t/a.jsonl', 'startup')
  expect(await numberOf(await prompt(211, 'beta three'))).toBe('3')
  w.files['/t/a.jsonl'] = A
  await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false } as never)
  // Fed on top of B, A's second prompt would have been claimed as B's fourth.
  expect(await numberOf(await prompt(104, 'alpha two'))).toBe('2')
})

test('a transcript too big for one read comes through the process fallback and still builds turns', async ($, on) => {
  const { w, start, prompt } = world($, on, { readFails: true })
  await start('a', '/t/a.jsonl', 'startup')
  expect(w.spawned).toEqual([['cat', '/t/a.jsonl']])
  expect(await numberOf(await prompt(104, 'alpha two'))).toBe('2')
})

test('a long session\'s file is streamed once, and a later read takes only the bytes after what was fed', async ($, on) => {
  const { w, start, prompt } = world($, on)
  // A filler row past one fs.read's 4 MiB, with a character that takes two bytes, so bytes and characters part ways.
  const filler = JSON.stringify({ type: 'cost-state', note: 'é'.repeat(10) + 'x'.repeat(4.5 * 1024 * 1024) })
  w.files['/t/a.jsonl'] = filler + '\n' + A + '{"torn'
  await start('a', '/t/a.jsonl', 'startup')
  expect(w.spawned).toEqual([['cat', '/t/a.jsonl']])
  expect(await numberOf(await prompt(104, 'alpha two'))).toBe('2')
  w.files['/t/a.jsonl'] = filler + '\n' + A + file([asked(109, 'alpha three'), said(110, [{ type: 'text', text: 'A three.' }])])
  await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false } as never)
  const fed = byteLength(filler + '\n' + A)
  expect(w.spawned!.slice(1).map(argv => Number(argv[argv.length - 2]) - 1)).toEqual([fed])
  expect(await numberOf(await prompt(109, 'alpha three'))).toBe('3')
  expect(await numberOf(await prompt(104, 'alpha two'))).toBe('2')
})

test('an interrupted turn keeps its calls, and the interruption takes no number', () => {
  const log = new TurnLog()
  for (const line of [
    asked(1, 'run it', null),
    said(2, [{ type: 'tool_use', id: 'toolu_i', name: 'Bash', input: { command: 'sleep 9' } }]),
    row(3, 'user', { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_i', content: 'interrupted', is_error: true }] } }),
    asked(4, '[Request interrupted by user for tool use]'),
    asked(5, 'try again'),
  ]) log.feed(line)
  expect(log.turns.map(turn => log.numberOf(turn))).toEqual([1, 2])
  expect(log.turns[0]!.tools.map(call => call.id)).toEqual(['toolu_i'])
})

test('another session\'s stored transcript never draws here: a reload finds this session\'s own file by its id', async ($, on) => {
  const { w, clock, prompt } = world($, on, { files: { '/home/.claude/projects/proj/a.jsonl': A, '/t/b.jsonl': B } })
  // Another window stored its own session's path.
  w.store.set('transcript:b', '/t/b.jsonl')
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true } as never)
  await clock.settle()
  expect(await numberOf(await prompt(104, 'alpha two'))).toBe('2')
  expect(await numberOf(await prompt(109, 'alpha three'))).toBe('3')
})

// The test above is the unset case: with no CLAUDE_CONFIG_DIR the file is found under ~/.claude.
test('a set CLAUDE_CONFIG_DIR is where a reload finds this session\'s file', async ($, on) => {
  const { clock, prompt } = world($, on, { configDir: '/cfg/', files: { '/cfg/projects/proj/a.jsonl': A, '/home/.claude/projects/proj/a.jsonl': B } })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true } as never)
  await clock.settle()
  expect(await numberOf(await prompt(104, 'alpha two'))).toBe('2')
})

test('a store that fails on the transcript path still lets the session load its numbers', async ($, on) => {
  const { w, start, prompt } = world($, on)
  w.storeFails = true
  await start('a', '/t/a.jsonl', 'startup')
  expect(await numberOf(await prompt(104, 'alpha two'))).toBe('2')
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
  world($, on, { store, now })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true } as never)
  expect(store.has('transcript:stale')).toBe(false)
  expect(store.get('transcript:fresh')).toEqual({ path: '/t/new.jsonl', at: now - 29 * day })
  expect(store.get('transcript:bare')).toEqual({ path: '/t/bare.jsonl', at: expect.any(Number) })
  expect(store.get('other')).toBe('kept')
})

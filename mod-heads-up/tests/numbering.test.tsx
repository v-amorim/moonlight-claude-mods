// mod-heads-up / tests/numbering.test.tsx, by v-amorim
// Tests prompt numbering across a transcript branch as the panel shows it.
import { expect, mock, test as kitTest, type TestRest } from 'claude-code/testing'

// The side check is opt-in, so these tests turn it on unless a test sets its own value.
const test = (name: string, ...rest: TestRest) => {
  const [settings, body] = rest.length === 1 ? [{}, rest[0]] : rest
  return kitTest(name, { ...settings, options: { enabled: true, ...settings.options } }, body)
}

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const TRANSCRIPT = '/home/u/.claude/projects/p/s1.jsonl'

const user = (n: number, parent: number | null, text: string) =>
  JSON.stringify({ type: 'user', uuid: ID(n), parentUuid: parent === null ? null : ID(parent), message: { role: 'user', content: text } })
const said = (n: number, parent: number, text: string) =>
  JSON.stringify({ type: 'assistant', uuid: ID(n), parentUuid: ID(parent), message: { role: 'assistant', content: [{ type: 'text', text }] } })

// Row 1 is the first prompt. Row 3 is a prompt /rewind dropped: rows 5 and 6 continue from row 2, not from row 4.
const TRANSCRIPT_TEXT = [
  user(1, null, 'Refactor the parser'),
  said(2, 1, 'Done.'),
  user(3, 2, 'Add tests'),
  said(4, 3, 'Tests added.'),
  user(5, 2, 'Use the other approach'),
  said(6, 5, 'Switched.'),
].join('\n') + '\n'

const FULL = [
  'learn: The main agent cached /ask, so one-off questions now cost more.',
  'tag: Heads up',
  'title: One-off /ask questions cost more',
  'explain:',
  '- /ask takes a quick side question.',
  '- Watch how often people ask follow-ups.',
].join('\n')

const answered = (text: string) => ({ isAnswered: true, text, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })

// The transcript is what the file read returns; isBig makes it past 4 MiB, so fs.read refuses and the mod streams it.
function setup(on: any, isBig = false, configDir?: string) {
  const runs: string[][] = []
  const listed: string[] = []
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 8, 9, 0) })
  const store = new Map<string, unknown>()
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: store.get(e.key) }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('session.id', () => ({ value: 's1' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('prompt.submit', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('model.fork', () => ({ value: answered(FULL) }))
  on('state.get', () => ({ value: { value: undefined } }))
  on('state.set', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined }))
  on('config.list', () => ({ value: [] }))
  on('ui.panes', () => ({ value: [] }))
  on('env.get', (_$: unknown, e: { name: string }) => ({ value: e.name === 'USERPROFILE' ? '/home/u' : e.name === 'CLAUDE_CONFIG_DIR' ? configDir : undefined }))
  on('fs.list', (_$: unknown, e: { path: string }) => {
    listed.push(e.path)
    return { value: [{ name: 'p', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] }
  })
  on('fs.exists', () => ({ value: true }))
  const bytes = new TextEncoder().encode(TRANSCRIPT_TEXT).length
  on('fs.stat', () => ({ value: { kind: 'file', size: isBig ? bytes + 5 * 1024 * 1024 : bytes, mtimeMs: 0, isLink: false } }))
  const bridge = { text: '' }
  on('session.start', () => ({ cwd: '/w' }))
  on('fs.read', (_$: unknown, e: { as?: string; path: string }) => {
    if (e.path.replace(/\\/g, '/').endsWith('/mod-heads-up/bridge/s1.jsonl')) return { value: bridge.text }
    if (isBig) throw new Error('over 4 MiB')
    return { value: e.as === 'bytes' ? { base64: btoa(TRANSCRIPT_TEXT) } : TRANSCRIPT_TEXT }
  })
  on('process.spawn', async function* () {
    yield { stream: 'stdout', text: TRANSCRIPT_TEXT }
    return { value: { code: 0, signal: null } }
  })
  // What lies past the streamed text reads as nothing yet.
  on('process.run', (_$: unknown, e: { argv: string[] }) => {
    runs.push(e.argv)
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  // sourcery skip: generators-should-yield
  on('turn.step', async function* (_$: unknown, e: { turnId: string; index: number }) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use', usage: null }
  })
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`base ${e.component}`}</Text>
  })
  return { clock, store, runs, listed, bridge }
}

async function step($: any, index: number, extra: object = {}) {
  const stream = $.turn.step({ turnId: 't1', index, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1, ...extra })
  while ((await stream.next()).done !== true);
}

// The composer draws a prompt under a placeholder id as it is sent, then under its uuid.
const draw = ($: any, requestId: string, text: string) =>
  $.ui.mount({ plugin: 'mod-heads-up', surface: 'terminal', component: 'UserMessage', requestId, viewport: { columns: 100, rows: 30 }, props: { text, origin: { kind: 'composer' }, isExpanded: true } } as never)

const notesOf = (store: Map<string, unknown>) => (store.get('notes:s1') as { notes: { turn: number; prompt: string }[] }).notes.map(note => [note.turn, note.prompt])

// The mod loaded after the session began (no SessionStart reached it), so it finds the transcript by its name.
test('a note takes the number its prompt has on the live branch: a prompt before load, a rewind, a cancelled prompt and a placeholder do not shift it', async ($, on) => {
  const { clock, store } = setup(on)
  await $.prompt.submit({ text: 'Add tests' } as never)
  await $.prompt.submit({ text: 'Use the other approach' } as never)
  await $.prompt.submit({ text: 'Also check the docs' } as never)
  await draw($, 'placeholder', 'Also check the docs')
  await draw($, ID(7), 'Also check the docs')
  await $.prompt.submit({ text: 'Never mind' } as never)
  await step($, 6)
  await clock.settle()
  expect(notesOf(store)).toEqual([[3, 'Also check the docs']])
})

test('a long session\'s transcript is streamed once, not read 2 MiB at a time, and numbers the same', async ($, on) => {
  const { clock, store, runs } = setup(on, true)
  await $.prompt.submit({ text: 'Add tests' } as never)
  await $.prompt.submit({ text: 'Use the other approach' } as never)
  await $.prompt.submit({ text: 'Also check the docs' } as never)
  await draw($, ID(7), 'Also check the docs')
  await step($, 6)
  await clock.settle()
  expect(notesOf(store)).toEqual([[3, 'Also check the docs']])
  // One range read past the streamed bytes, which finds nothing new.
  expect(runs.length).toBe(1)
})

test('the same note when the session start named the transcript', async ($, on) => {
  const { clock, store, bridge } = setup(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true } as never)
  bridge.text = `${JSON.stringify({ session_id: 's1', transcript_path: TRANSCRIPT, source: 'startup', hook_event_name: 'SessionStart', cwd: '/w' })}\n`
  await clock.advance(250)
  await $.prompt.submit({ text: 'Add tests' } as never)
  await $.prompt.submit({ text: 'Use the other approach' } as never)
  await $.prompt.submit({ text: 'Also check the docs' } as never)
  await draw($, 'placeholder', 'Also check the docs')
  await draw($, ID(7), 'Also check the docs')
  await $.prompt.submit({ text: 'Never mind' } as never)
  await step($, 6)
  await clock.settle()
  expect(notesOf(store)).toEqual([[3, 'Also check the docs']])
})

// The test host turns a POSIX path into a Windows one, so paths are compared without a drive letter.
const plain = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

// A step that adds a note reads the transcript, so it shows the folder the mod lists.
test('the transcript is looked up under CLAUDE_CONFIG_DIR when set', async ($, on) => {
  const { clock, listed } = setup(on, false, '/cfg/')
  await $.prompt.submit({ text: 'Add tests' } as never)
  await $.prompt.submit({ text: 'Use the other approach' } as never)
  await $.prompt.submit({ text: 'Also check the docs' } as never)
  await draw($, ID(7), 'Also check the docs')
  await step($, 6)
  await clock.settle()
  expect(listed.map(plain)).toContain('/cfg/projects')
})

test('without CLAUDE_CONFIG_DIR the transcript is looked up under ~/.claude as before', async ($, on) => {
  const { clock, listed } = setup(on)
  await $.prompt.submit({ text: 'Add tests' } as never)
  await $.prompt.submit({ text: 'Use the other approach' } as never)
  await $.prompt.submit({ text: 'Also check the docs' } as never)
  await draw($, ID(7), 'Also check the docs')
  await step($, 6)
  await clock.settle()
  expect(listed.map(plain)).toContain('/home/u/.claude/projects')
})

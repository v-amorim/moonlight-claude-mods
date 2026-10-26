// mod-heads-up / tests/session-start.test.tsx, by v-amorim: how the prompt numbers get their transcript.
import { expect, mock, test as kitTest } from 'claude-code/testing'

const test = ((name: string, body: any) => kitTest(name, { options: { enabled: true } }, body)) as typeof kitTest

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const user = (n: number, parent: number | null, text: string) =>
  JSON.stringify({ type: 'user', uuid: ID(n), parentUuid: parent === null ? null : ID(parent), message: { role: 'user', content: text } })
const said = (n: number, parent: number, text: string) =>
  JSON.stringify({ type: 'assistant', uuid: ID(n), parentUuid: ID(parent), message: { role: 'assistant', content: [{ type: 'text', text }] } })
const FILE = [user(1, null, 'Refactor the parser'), said(2, 1, 'Done.'), user(3, 2, 'Add tests'), said(4, 3, 'Tests added.')].join('\n') + '\n'
const FOUND = '/home/u/.claude/projects/proj/s1.jsonl'
const NAMED = '/t/named.jsonl'
const BRIDGE_FILE = '/home/u/.claude/mods-data/mod-heads-up/bridge/s1.jsonl'
const plain = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
const answered = (text: string) => ({ isAnswered: true, text, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })
const FULL = ['learn: x', 'tag: Heads up', 'title: t', 'explain:', '- y.'].join('\n')

// Only `transcriptAt` holds the transcript; any other path reads as missing.
function host(on: any, transcriptAt: string) {
  const bridge = { text: '' }
  const stored = new Map<string, unknown>()
  const reads: string[] = []
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 8, 9, 0) })
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: stored.get(e.key) }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    stored.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...stored.keys()] }))
  on('store.delete', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's1' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.start', () => ({ cwd: '/w' }))
  on('session.end', (_$: unknown, e: { sessionId: string }) => ({ sessionId: e.sessionId }))
  on('prompt.submit', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('model.fork', () => ({ value: answered(FULL) }))
  on('state.get', () => ({ value: { value: undefined } }))
  on('state.set', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined }))
  on('config.list', () => ({ value: [] }))
  on('ui.panes', () => ({ value: [] }))
  mock.env(on, { USERPROFILE: '/home/u' })
  on('fs.list', () => ({ value: [{ name: 'proj', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] }))
  on('fs.exists', (_$: unknown, e: { path: string }) => ({ value: plain(e.path) === FOUND && transcriptAt === FOUND }))
  on('fs.stat', (_$: unknown, e: { path: string }) => ({ value: { kind: 'file', size: plain(e.path) === transcriptAt ? new TextEncoder().encode(FILE).length : 0, mtimeMs: 0, isLink: false } }))
  on('fs.read', (_$: unknown, e: { path: string; as?: string }) => {
    const path = plain(e.path)
    if (path === BRIDGE_FILE) return { value: bridge.text }
    reads.push(path)
    if (path !== transcriptAt) throw new Error('missing')
    return { value: e.as === 'bytes' ? { base64: btoa(FILE) } : FILE }
  })
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }))
  // sourcery skip: generators-should-yield
  on('turn.step', async function* (_$: unknown, e: { turnId: string; index: number }) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use', usage: null }
  })
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`base ${e.component}`}</Text>
  })
  return { stored, reads, clock, bridge }
}

const draw = ($: any, requestId: string, text: string) =>
  $.ui.mount({ plugin: 'mod-heads-up', surface: 'terminal', component: 'UserMessage', requestId, viewport: { columns: 100, rows: 30 }, props: { text, origin: { kind: 'composer' }, isExpanded: true } } as never)

async function step($: any, index: number) {
  const stream = $.turn.step({ turnId: 't1', index, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1 })
  while ((await stream.next()).done !== true);
}

const notesOf = (stored: Map<string, unknown>) => (stored.get('notes:s1') as { notes: { turn: number; prompt: string }[] }).notes.map(note => [note.turn, note.prompt])

// Sends the second prompt and runs a side check: its note carries the number the transcript gives the prompt.
async function numbered($: any, clock: { settle: () => Promise<void> }) {
  await $.prompt.submit({ text: 'Add tests' } as never)
  await $.prompt.submit({ text: 'Also check the docs' } as never)
  await draw($, ID(5), 'Also check the docs')
  await step($, 6)
  await clock.settle()
}

test('no SessionStart: the transcript is found by session id under the projects folder and the note is numbered from it', async ($, on) => {
  const { stored, reads, clock } = host(on, FOUND)
  await numbered($, clock)
  expect(reads).toContain(FOUND)
  expect(notesOf(stored)).toEqual([[3, 'Also check the docs']])
  expect(stored.has('transcript:s1')).toBe(false)
})

test('a SessionStart names the transcript: the path is stored under transcript:<id> and the note is numbered from it', async ($, on) => {
  const { stored, reads, clock, bridge } = host(on, NAMED)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true } as never)
  bridge.text = `${JSON.stringify({ session_id: 's1', transcript_path: NAMED, source: 'startup', hook_event_name: 'SessionStart', cwd: '/w' })}\n`
  await clock.advance(250)
  await numbered($, clock)
  expect(stored.get('transcript:s1')).toMatchObject({ path: NAMED, at: expect.any(Number) })
  expect(reads).toContain(NAMED)
  expect(notesOf(stored)).toEqual([[3, 'Also check the docs']])
})

test('a session.end delivers a SessionStart record the poll has not read yet', async ($, on) => {
  const { stored, clock, bridge } = host(on, NAMED)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true } as never)
  bridge.text = `${JSON.stringify({ session_id: 's1', transcript_path: NAMED, hook_event_name: 'SessionStart' })}\n`
  await $.session.end({ sessionId: 's1' } as never)
  await clock.settle()
  expect(stored.get('transcript:s1')).toMatchObject({ path: NAMED })
})

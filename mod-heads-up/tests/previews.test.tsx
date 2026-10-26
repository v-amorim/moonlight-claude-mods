// mod-heads-up / tests/previews.test.tsx, by v-amorim
import { mock, test as kitTest, type TestRest } from 'claude-code/testing'

// The side check is opt-in, so these tests turn it on unless a test sets its own value.
const test = (name: string, ...rest: TestRest) => {
  const [settings, body] = rest.length === 1 ? [{}, rest[0]] : rest
  return kitTest(name, { ...settings, options: { enabled: true, ...settings.options } }, body)
}

import { capture, expectPreview, written } from './previews-kit'
import { snapshot } from './previews.snapshot'

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 56, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const

const LEARN = 'The main agent cached /ask, so one-off questions cost more.'
const NOTE = `learn: ${LEARN}\ntag: Heads up\ntitle: One-off /ask questions cost more\nexplain:\n- /ask takes a quick side question.`
const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const encoder = new TextEncoder()
const base64Of = (bytes: Uint8Array) => btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''))
const TRANSCRIPT = `${JSON.stringify({ type: 'user', uuid: 'p0', parentUuid: null, message: { role: 'user', content: 'Add follow-ups to /ask' } })}\n`

// Stubs what the mod touches, then runs a check that flags the note.
async function card($: any, on: any) {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 5, 16, 52) })
  const store = new Map<string, unknown>([['transcript:s1', '/t/s1.jsonl']])
  const states = new Map<string, unknown>()
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: store.get(e.key) }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.delete', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's1' }))
  on('session.start', () => ({ cwd: '/w' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.messages', () => ({ value: [{ role: 'user', text: 'Add follow-ups to /ask', toolUses: [] }] }))
  on('model.fork', () => ({ value: { isAnswered: true, text: NOTE, usage } }))
  on('model.complete', () => ({ value: { isAnswered: true, text: NOTE, usage } }))
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.submit', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.panes', () => ({ value: [] }))
  on('state.get', (_$: unknown, e: { plugin: string; key: string }) => ({ value: { value: states.get(`${e.plugin}.${e.key}`) } }))
  on('state.set', (_$: unknown, e: { plugin: string; key: string; value: unknown }) => {
    states.set(`${e.plugin}.${e.key}`, e.value)
    return { value: undefined }
  })
  on('command.register', () => ({ value: undefined }))
  on('config.list', () => ({ value: [] }))
  on('fs.stat', (_$: unknown, e: { path: string }) => (e.path.endsWith('s1.jsonl') ? { value: { kind: 'file', size: encoder.encode(TRANSCRIPT).length, mtimeMs: 0, isLink: false } } : { deny: 'no file' }))
  on('fs.read', (_$: unknown, e: { path: string; as?: string }) => {
    if (!e.path.endsWith('s1.jsonl')) return { deny: 'no file' }
    return e.as === 'bytes' ? { value: { base64: base64Of(encoder.encode(TRANSCRIPT)) } } : { value: TRANSCRIPT }
  })
  on('process.run', (_$: unknown, e: { argv: string[] }) => {
    const from = Number(e.argv[5]) - 1
    return { value: { exitCode: 0, stdout: base64Of(encoder.encode(TRANSCRIPT).subarray(from, from + Number(e.argv[6]))), stderr: '' } }
  })
  // sourcery skip: generators-should-yield
  on('turn.step', async function* (_$: unknown, e: { turnId: string; index: number }) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use', usage: null }
  })
  on('ui.render', ($: any, e: unknown) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="base">base</Text>
  })
  await $.prompt.submit({ text: 'Add follow-ups to /ask' })
  const stream = $.turn.step({ turnId: 't1', index: 6, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1 })
  while ((await stream.next()).done !== true);
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'mod-heads-up', surface: 'terminal', ...BAND })
  const root = await ui.find({ key: 'headsup-card' })
  const got = await capture(root, key => ui.drawn({ in: key }))
  await ui.unmount()
  return got
}

for (const mode of ['nerd', 'safe'] as const) {
  test(`enabled=true example is the real card (${mode})`, { options: { icons: mode } }, async ($, on) => {
    expectPreview(snapshot, 'enabled', 'true', mode, await card($, on))
  })

  test(`enabled=false example is its written line (${mode})`, { options: { icons: mode } }, async () => {
    expectPreview(snapshot, 'enabled', 'false', mode, written([{ text: 'No checks, no extra requests', color: 'muted' }]))
  })
}

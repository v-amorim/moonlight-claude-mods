// mod-heads-up / tests/heads-up.test.tsx, by v-amorim
// Tests the panel above the prompt: rendering, pill, pane and note cards.
import { expect, mock, test as kitTest, type TestRest } from 'claude-code/testing'

// The side check is opt-in, so these tests turn it on unless a test sets its own value.
const test = (name: string, ...rest: TestRest) => {
  const [settings, body] = rest.length === 1 ? [{}, rest[0]] : rest
  return kitTest(name, { ...settings, options: { enabled: true, ...settings.options } }, body)
}

import Row from '../hooks/timeline'

// The host test types ship no DOM or node globals.
declare const setTimeout: (handler: (value: unknown) => void, ms: number) => unknown

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const

const PANE_PROPS = { title: 'Heads up', isFocused: false, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} }

const FULL_LEARN = 'The main agent cached /ask, so one-off questions now cost more.'
const FULL = [
  `learn: ${FULL_LEARN}`,
  'tag: Heads up',
  'title: One-off /ask questions cost more',
  'explain:',
  '- /ask takes a quick side question.',
  '- Watch how often people ask follow-ups.',
].join('\n')
// The same finding in other words: its topic words all appear in FULL_LEARN's.
const REWORDED = 'One-off /ask questions cost more because the main agent cached them.'
const OTHER_TOPIC = 'Each upload retries five times at once, so a slow server gets hammered.'
const about = (learn: string) => FULL.replace(FULL_LEARN, learn)

const answered = (text: string) => ({ isAnswered: true, text, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })

const TRANSCRIPT = '/t/s1.jsonl'
// The engine answers a path in its own form (C:\t\s1.jsonl on Windows), so the file is matched by its name.
const isTranscript = (path: string) => path.endsWith('s1.jsonl')
// One user row per prompt, each the child of the row before, as Claude Code writes them.
const transcriptFor = (prompts: string[]) =>
  prompts.map((text, index) => JSON.stringify({ type: 'user', uuid: `p${index}`, parentUuid: index ? `p${index - 1}` : null, message: { role: 'user', content: text } })).join('\n') + '\n'
// The file and process reads answer bytes as base64, which the test runtime encodes with btoa.
const encoder = new TextEncoder()
const base64Of = (bytes: Uint8Array) => btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''))

type Setup = { reply?: () => unknown; below?: (elements: any) => unknown; isUnplaced?: boolean; gate?: Promise<unknown>; oversize?: boolean; session?: { id: string }; cwd?: { dir: string }; drop?: string }

// Stubs everything the mod touches. `forks` and `completes` record what the model was asked, `store` what the mod saved, `reads` and `runs` the file and process calls, and the transcript holds each prompt the test sent. `gate` holds every read of a session's notes until it resolves; `oversize` makes the file read past 4 MiB, as the engine refuses it.
function setup(on: any, { reply = () => answered(FULL), below, isUnplaced, gate, oversize = false, session = { id: 's1' }, cwd = { dir: '/w' }, drop }: Setup = {}) {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 5, 16, 52) })
  const store = new Map<string, unknown>([['transcript:s1', TRANSCRIPT], ['transcript:s2', TRANSCRIPT]])
  const sent: string[] = []
  const forks: string[] = []
  const completes: { model: string; effort?: string; prompt: string }[] = []
  const fills: { text: string; mode?: string }[] = []
  const states = new Map<string, unknown>()
  const reads: { path: string; as?: string }[] = []
  const runs: string[][] = []
  let panes: { id: string; isPlaced: boolean }[] = []
  let draft = ''
  const transcript = () => transcriptFor(sent)
  on('store.get', async (_$: unknown, e: { key: string }) => {
    if (gate && e.key.startsWith('notes:')) await gate
    return { value: store.get(e.key) }
  })
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.delete', (_$: unknown, e: { key: string }) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('session.id', () => ({ value: session.id }))
  on('session.cwd', () => ({ value: cwd.dir }))
  on('session.start', () => ({ cwd: '/w' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.messages', () => ({ value: [{ role: 'user', text: 'Add follow-ups to /ask', toolUses: [] }] }))
  on('model.fork', async (_$: unknown, e: { prompt: string }) => {
    forks.push(e.prompt)
    return { value: await reply() }
  })
  on('model.complete', async (_$: unknown, e: { model: string; effort?: string; prompt: string }) => {
    completes.push({ model: e.model, effort: e.effort, prompt: e.prompt })
    return { value: await reply() }
  })
  on('prompt.read', () => ({ value: { text: draft, cursor: draft.length } }))
  on('prompt.fill', (_$: unknown, e: { text: string; mode?: string }) => {
    fills.push({ text: e.text, mode: e.mode })
    return { isFilled: true }
  })
  on('prompt.submit', (_$: unknown, e: { text: string }) => {
    if (drop && e.text.startsWith('A heads-up note')) return { drop }
    sent.push(e.text)
    return { text: e.text }
  })
  on('ui.panes', () => ({ value: panes }))
  on('ui.open', (_$: unknown, e: { id: string }) => {
    if (isUnplaced) return { value: { isPlaced: false, reason: 'too narrow' } }
    panes = [...panes.filter(pane => pane.id !== e.id), { id: e.id, isPlaced: true }]
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_$: unknown, e: { id: string }) => {
    panes = panes.filter(pane => pane.id !== e.id)
    return { value: undefined }
  })
  on('state.get', (_$: unknown, e: { plugin: string; key: string }) => ({ value: { value: states.get(`${e.plugin}.${e.key}`) } }))
  on('state.set', (_$: unknown, e: { plugin: string; key: string; value: unknown }) => {
    states.set(`${e.plugin}.${e.key}`, e.value)
    return { value: undefined }
  })
  on('command.register', () => ({ value: undefined }))
  on('config.list', () => ({ value: [] }))
  on('fs.stat', (_$: unknown, e: { path: string }) => (isTranscript(e.path) ? { value: { kind: 'file', size: encoder.encode(transcript()).length, mtimeMs: 0, isLink: false } } : { deny: 'no file' }))
  on('fs.read', (_$: unknown, e: { path: string; as?: string }) => {
    reads.push({ path: e.path, as: e.as })
    if (!isTranscript(e.path)) return { deny: 'no file' }
    if (e.as !== 'bytes') return { value: transcript() }
    if (oversize) return { deny: 'the file is over 4 MiB' }
    return { value: { base64: base64Of(encoder.encode(transcript())) } }
  })
  // The POSIX form of a read from an offset: sh -c script sh path, from plus one, length.
  on('process.run', (_$: unknown, e: { argv: string[] }) => {
    runs.push(e.argv)
    const from = Number(e.argv[5]) - 1
    const slice = encoder.encode(transcript()).subarray(from, from + Number(e.argv[6]))
    return { value: { exitCode: 0, stdout: base64Of(slice), stderr: '' } }
  })
  // sourcery skip: generators-should-yield
  on('turn.step', async function* (_$: unknown, e: { turnId: string; index: number }) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use', usage: null }
  })
  on('ui.render', ($: any, e: unknown) => {
    const elements = $.ui.resolve(e)
    return below ? below(elements) : <elements.Text key="base">base</elements.Text>
  })
  return { clock, store, forks, completes, fills, sent, states, reads, runs, panes: () => panes, setDraft: (text: string) => (draft = text) }
}

async function step($: any, index: number, extra: object = {}) {
  const stream = $.turn.step({ turnId: 't1', index, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1, ...extra })
  while ((await stream.next()).done !== true);
}

const band = ($: any) => $.ui.mount({ plugin: 'mod-heads-up', surface: 'terminal', ...BAND })
const pane = ($: any) => $.ui.mount({ plugin: 'mod-heads-up', surface: 'terminal', component: 'Pane', requestId: 'headsup', props: PANE_PROPS })
const click = (ui: any, key: string) => ui.pointer({ in: key, type: 'down', button: 'left', x: 4, y: 0 })
const drawn = async (ui: any, key: string) => JSON.stringify(await ui.drawn({ in: key }).catch(() => null))

// A finding on the card: a prompt sent, then the sixth step of its turn.
async function finding($: any, clock: any, turnId = 't1') {
  await $.prompt.submit({ text: 'Add follow-ups to /ask' } as never)
  await step($, 6, { turnId })
  await clock.settle()
}

test('a check runs on the sixth main step only, once per turn, and never for a subagent', async ($, on) => {
  const { clock, forks } = setup(on, { reply: () => answered('learn: none') })
  for (const index of [0, 1, 2, 3, 4, 5]) await step($, index)
  await clock.settle()
  expect(forks.length).toBe(0)
  await step($, 6)
  await clock.settle()
  expect(forks.length).toBe(1)
  await step($, 12)
  await clock.settle()
  expect(forks.length).toBe(1)
  await step($, 6, { turnId: 't2', agentId: 'agent-1' })
  await clock.settle()
  expect(forks.length).toBe(1)
  await step($, 6, { turnId: 't2' })
  await clock.settle()
  expect(forks.length).toBe(2)
  const ui = await band($)
  expect(await ui.find({ key: 'headsup-card' })).toBeUndefined()
  await ui.unmount()
})

test('a headless session never checks: no fork, no completion, until a session that is interactive', async ($, on) => {
  const { clock, forks, completes } = setup(on)
  await $.session.start({ cwd: '/w', surface: null, isInteractive: false } as never)
  await finding($, clock)
  expect(forks.length + completes.length).toBe(0)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true } as never)
  await step($, 6, { turnId: 't2' })
  await clock.settle()
  expect(forks.length).toBe(1)
})

test('the entry shimmers while the check runs, then the card shows the note above next steps with an unread count', async ($, on) => {
  let release = (_: unknown) => {}
  const pending = new Promise(resolve => (release = resolve))
  const { clock } = setup(on, {
    reply: () => pending,
    below: ({ Box, Text }: any) => (
      <Box key="menu-rows" flexDirection="column">
        <Box key="nextsteps-rows"><Text>Run the full suite</Text></Box>
        <Box key="menu-row" flexDirection="row"><Text key="pill">Files</Text></Box>
      </Box>
    ),
  })
  await finding($, clock)
  const ui = await band($)
  expect(JSON.stringify(await ui.find({ key: 'menu-entry-headsup' }))).toContain('"isBusy":true')
  release(answered(FULL))
  await clock.settle()
  const tree = JSON.stringify(await ui.drawn())
  expect(tree).toContain('The main agent cached /ask')
  expect(tree.indexOf('headsup-card') < tree.indexOf('nextsteps-rows')).toBe(true)
  // One pill row: the card joins the shared row instead of wrapping it.
  expect(tree.split('"menu-rows"').length - 1).toBe(1)
  const entry = JSON.stringify(await ui.find({ key: 'menu-entry-headsup' }))
  expect(entry).toContain('"isBusy":false')
  expect(entry).toContain('"text":"1"')
  expect(await drawn(ui, 'headsup-card-open')).toContain('Open')
  await ui.unmount()
})

for (const [verdict, isShown] of [['drop', false], ['keep', true]] as const) {
  test(`when the main turn moves on while the check runs, a recheck answering ${verdict} ${isShown ? 'shows' : 'drops'} the note`, async ($, on) => {
    let release = (_: unknown) => {}
    const first = new Promise(resolve => (release = resolve))
    let calls = 0
    const { clock, forks } = setup(on, { reply: () => (calls++ === 0 ? first : answered(verdict)) })
    await $.prompt.submit({ text: 'Add follow-ups to /ask' } as never)
    await step($, 6)
    await clock.settle()
    // The main agent takes another step before the check answers.
    await step($, 7)
    release(answered(FULL))
    await clock.settle()
    expect(forks.length).toBe(2)
    expect(forks[1]).toContain('keep or drop')
    const ui = await band($)
    expect(Boolean(await ui.find({ key: 'headsup-card' }))).toBe(isShown)
    await ui.unmount()
  })
}

test('with no newer step there is no recheck', async ($, on) => {
  const { clock, forks } = setup(on)
  await finding($, clock)
  expect(forks.length).toBe(1)
})

test('above medium effort the check goes to the session model at medium with the packed conversation', async ($, on) => {
  const { clock, forks, completes } = setup(on)
  await $.prompt.submit({ text: 'Add follow-ups to /ask' } as never)
  await step($, 6, { effort: 'high' })
  await clock.settle()
  expect(forks.length).toBe(0)
  expect(completes.length).toBe(1)
  expect(completes[0]).toMatchObject({ model: 'claude-opus-5-5', effort: 'medium' })
  expect(completes[0]!.prompt).toContain('Person: Add follow-ups to /ask')
})

test('with nothing to fork yet the check falls back to the uncached route', async ($, on) => {
  let calls = 0
  const { clock, completes } = setup(on, { reply: () => (calls++ === 0 ? { isAnswered: false, reason: 'nothing-to-fork' } : answered(FULL)) })
  await finding($, clock)
  expect(completes.length).toBe(1)
  const ui = await band($)
  expect(await ui.find({ key: 'headsup-card' })).toBeDefined()
  await ui.unmount()
})

test('a failed side call raises one "Side check unavailable" toast per session, with the reason', async ($, on) => {
  const notes: string[] = []
  on('ui.toast', (_$: unknown, e: { text: string }) => {
    notes.push(e.text)
    return { value: undefined }
  })
  let calls = 0
  const { clock } = setup(on, {
    reply: () => {
      if (calls++ > 0) throw new Error('blocked by your organization')
      return { isAnswered: false, reason: 'api-error', status: 403, error: 'permission_denied' }
    },
  })
  await finding($, clock)
  await step($, 6, { turnId: 't2' })
  await clock.settle()
  expect(calls).toBe(2)
  expect(notes).toEqual(['Side check unavailable: permission denied 403'])
})

test('a thrown side call names its message, and an empty reply raises nothing', async ($, on) => {
  const notes: string[] = []
  on('ui.toast', (_$: unknown, e: { text: string }) => {
    notes.push(e.text)
    return { value: undefined }
  })
  let mode = 'empty'
  const { clock } = setup(on, {
    reply: () => {
      if (mode === 'throw') throw new Error('blocked by your organization')
      return { isAnswered: false, reason: 'empty-reply' }
    },
  })
  await finding($, clock)
  expect(notes).toEqual([])
  mode = 'throw'
  await step($, 6, { turnId: 't2' })
  await clock.settle()
  // The test engine words a throwing handler itself, so only the lead and the one-notification rule are fixed.
  expect(notes).toHaveLength(1)
  expect(notes[0]).toMatch(/^Side check unavailable: \S/)
})

test('Got it in the panel stores the topic, closes the card and reads the note, and the next check is told to skip it', async ($, on) => {
  const { clock, store, forks } = setup(on)
  await finding($, clock)
  const ui = await band($)
  await click(ui, 'headsup-card-open')
  await clock.settle()
  await ui.unmount()
  const panel = await pane($)
  const id = String(JSON.stringify(await panel.drawn()).match(/"id":"headsup-understood-([^"]+)"/)?.[1])
  await click(panel, `headsup-understood-${id}`)
  await clock.settle()
  expect(store.get('known:/w')).toEqual(['One-off /ask questions cost more'])
  expect(store.has('known')).toBe(false)
  await panel.unmount()
  await step($, 6, { turnId: 't2' })
  await clock.settle()
  expect(forks[1]).toContain('- One-off /ask questions cost more')
  const again = await band($)
  expect(await again.find({ key: 'headsup-card' })).toBeUndefined()
  await again.unmount()
})

test('a reworded repeat of a note already shown is not shown again', async ($, on) => {
  let learn = FULL_LEARN
  const { clock, forks } = setup(on, { reply: () => answered(about(learn)) })
  await finding($, clock)
  await $.prompt.submit({ text: 'next' } as never)
  await $.prompt.submit({ text: 'and next' } as never)
  learn = REWORDED
  await step($, 6, { turnId: 't2' })
  await clock.settle()
  expect(forks.length).toBe(2)
  const ui = await band($)
  expect(await ui.find({ key: 'headsup-card' })).toBeUndefined()
  await ui.unmount()
  const panel = await pane($)
  expect(JSON.stringify(await panel.drawn()).match(/"key":"headsup-note-/g)?.length).toBe(1)
  await panel.unmount()
})

test('seen topics are stored under their session; the known topics under their project', async ($, on) => {
  const { clock, store } = setup(on)
  await finding($, clock)
  expect(store.get('seen:s1')).toEqual([FULL_LEARN])
  expect(store.has('seen')).toBe(false)
})

test('a topic marked known in one project is not known in another', async ($, on) => {
  const cwd = { dir: '/w' }
  const session = { id: 's1' }
  const { clock, store, forks } = setup(on, { cwd, session })
  store.set('known:/w', ['Topic from the first project'])
  await finding($, clock)
  expect(forks[0]).toContain('- Topic from the first project')
  cwd.dir = '/other'
  session.id = 's2'
  await step($, 6, { turnId: 't2' })
  await clock.settle()
  expect(forks[1]).not.toContain('Topic from the first project')
})

test('transcript paths untouched for 30 days are deleted at session start, newer and older-format ones stay', async ($, on) => {
  const { store } = setup(on)
  const now = Date.UTC(2026, 9, 5, 16, 52)
  const day = 24 * 60 * 60 * 1000
  store.set('transcript:stale', { path: '/t/old.jsonl', at: now - 31 * day })
  store.set('transcript:fresh', { path: '/t/new.jsonl', at: now - 29 * day })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true } as never)
  expect(store.has('transcript:stale')).toBe(false)
  expect(store.get('transcript:fresh')).toEqual({ path: '/t/new.jsonl', at: now - 29 * day })
  expect(store.get('transcript:s1')).toEqual({ path: '/t/s1.jsonl', at: expect.any(Number) })
})

test('a fork that never answers is cut after two minutes and the next turn checks again', async ($, on) => {
  const never = new Promise(() => {})
  let answers = 0
  const { clock, forks } = setup(on, { reply: () => (answers++ === 0 ? never : answered('learn: none')) })
  await $.prompt.submit({ text: 'Add follow-ups to /ask' } as never)
  await step($, 6)
  await clock.settle()
  expect(forks.length).toBe(1)
  await clock.advance(120_000)
  await step($, 6, { turnId: 't2' })
  await clock.settle()
  expect(forks.length).toBe(2)
})

test('a /resume or /clear starts the next session\'s check counters over', async ($, on) => {
  const session = { id: 's1' }
  const { clock, forks } = setup(on, { session, reply: () => answered('learn: none') })
  await step($, 6)
  await clock.settle()
  expect(forks.length).toBe(1)
  session.id = 's2'
  const panel = await pane($)
  await clock.settle()
  await panel.unmount()
  await step($, 6)
  await clock.settle()
  expect(forks.length).toBe(2)
})

test('the store keeps the notes and seen topics of the 40 most recent sessions, and deletes the rest', async ($, on) => {
  const { store } = setup(on)
  const older = Array.from({ length: 40 }, (_, index) => `old-${index}`)
  store.set('sessions', older)
  for (const session of older) {
    store.set(`notes:${session}`, { notes: [], card: null, since: 0, checked: null })
    store.set(`seen:${session}`, [])
  }
  const ui = await band($)
  await ui.unmount()
  expect(store.get('sessions')).toEqual([...older.slice(1), 's1'])
  expect(store.has('notes:old-0')).toBe(false)
  expect(store.has('seen:old-0')).toBe(false)
  expect(store.has('notes:old-1')).toBe(true)
})

test('the pane says when the last check ran: no check yet, then the turn it read and whether it flagged a note', async ($, on) => {
  let answer = 'learn: none'
  const { clock } = setup(on, { reply: () => answered(answer) })
  const panel = await pane($)
  expect(JSON.stringify(await panel.drawn())).toContain('No check yet')
  await finding($, clock)
  expect(JSON.stringify(await panel.drawn())).toContain('Last check: turn 1, under a minute ago. Nothing to flag.')
  answer = FULL
  await $.prompt.submit({ text: 'and next' } as never)
  await step($, 6, { turnId: 't2' })
  await clock.settle()
  expect(JSON.stringify(await panel.drawn())).toContain('Last check: turn 2, under a minute ago. Flagged a note.')
  await panel.unmount()
})

test('two hooks that ask at once share one load, so the second reads the notes the first loads', async ($, on) => {
  let open = (_: unknown) => {}
  const gate = new Promise(resolve => (open = resolve))
  const { store } = setup(on, { gate })
  store.set('notes:s1', {
    notes: [{ id: 'n1-1', turn: 1, prompt: 'Add follow-ups to /ask', at: 1, isRead: false, learn: FULL_LEARN, tag: 'Heads up', title: 'One-off /ask questions cost more', body: ['/ask takes a quick side question.'] }],
    card: null,
    since: 0,
    checked: null,
  })
  const bandMounting = band($)
  const paneMounting = pane($)
  await new Promise(resolve => setTimeout(resolve, 50))
  open(undefined)
  const ui = await bandMounting
  const panel = await paneMounting
  expect(JSON.stringify(await panel.drawn())).toContain('The main agent cached /a')
  await ui.unmount()
  await panel.unmount()
})

test('the timeline dot marks what is unread: a filled badge-blue dot, and a read note goes back to the muted or selected look', async ($, on) => {
  const { store } = setup(on)
  const note = (n: number, isRead: boolean) => ({ id: `n${n}-${n}`, turn: n, prompt: `prompt ${n}`, at: n, isRead, learn: `learn ${n}`, tag: 'Heads up', title: `title ${n}`, body: [`body ${n}`] })
  store.set('notes:s1', { notes: [note(1, true), note(2, false), note(3, false)], card: null, since: 0, checked: null })
  const panel = await pane($)
  const dot = async (n: number) => {
    const row = (await panel.find({ key: `headsup-note-n${n}-${n}` })) as { props: { props: { mark: string; isUnread: boolean; isSelected: boolean } } }
    const { mark, isUnread, isSelected } = row.props.props
    return [mark.trim(), isUnread, isSelected]
  }
  expect(await dot(1)).toEqual(['○', false, false])
  expect(await dot(2)).toEqual(['●', true, false])
  expect(await dot(3)).toEqual(['●', true, true])
  await click(panel, 'headsup-note-n2-2')
  expect(await dot(2)).toEqual(['●', false, true])
  expect(await dot(3)).toEqual(['●', true, false])
  await panel.unmount()
})

test('the card has three unnumbered actions on a row under the note: Open, Ask Claude, Dismiss', async ($, on) => {
  const { clock } = setup(on)
  await finding($, clock)
  const ui = await band($)
  const tree = JSON.stringify(await ui.drawn())
  const ids = [...tree.matchAll(/"id":"(headsup-card-[a-z]+)"/g)].map(each => each[1])
  expect([...new Set(ids.filter(id => id !== 'headsup-card-tag'))].sort()).toEqual(['headsup-card-chat', 'headsup-card-dismiss', 'headsup-card-open'])
  expect(tree).not.toContain('Know this')
  expect(tree.indexOf('"headsup-card-text"') < tree.indexOf('"headsup-card-keys"')).toBe(true)
  expect(await ui.find({ key: 'headsup-card-line' })).toBeUndefined()
  for (const [id, label] of [['open', 'Open'], ['chat', 'Ask Claude'], ['dismiss', 'Dismiss']] as const) {
    expect(await drawn(ui, `headsup-card-${id}`)).toContain(label)
    expect(await drawn(ui, `headsup-card-${id}`)).not.toMatch(/"[123]"/)
    expect(await ui.find({ key: `headsup-card-${id}-hotkey` })).toBeUndefined()
  }
  await ui.unmount()
})

test('Ask Claude on the card sends the note to Claude, closes the card and reads the note', async ($, on) => {
  const { clock, sent } = setup(on)
  await finding($, clock)
  const ui = await band($)
  expect(JSON.stringify(await ui.find({ key: 'menu-entry-headsup' }))).toContain('"text":"1"')
  await click(ui, 'headsup-card-chat')
  await clock.settle()
  expect(sent.slice(1)).toHaveLength(1)
  expect(sent[1]).toMatch(/^A heads-up note/)
  expect(await ui.find({ key: 'headsup-card' })).toBeUndefined()
  expect(JSON.stringify(await ui.find({ key: 'menu-entry-headsup' }))).not.toContain('"text":"1"')
  await ui.unmount()
})

test('an open note has Got it, Ask Claude and Reword, the summary once, and the three rewordings only after Reword', async ($, on) => {
  const { clock } = setup(on)
  await finding($, clock)
  const ui = await band($)
  await click(ui, 'headsup-card-open')
  await clock.settle()
  await ui.unmount()
  const panel = await pane($)
  const tree = JSON.stringify(await panel.drawn())
  const ids = [...tree.matchAll(/"id":"(headsup-(?:understood|chat|reword|redo-[a-z]+)-[^"]+)"/g)].map(each => each[1]!.replace(/-n1-.*$/, ''))
  expect([...new Set(ids)].sort()).toEqual(['headsup-chat', 'headsup-reword', 'headsup-understood'])
  expect(tree.split('"key":"summary-').length - 1).toBe(1)
  const id = String(tree.match(/"id":"headsup-reword-([^"]+)"/)?.[1])
  await click(panel, `headsup-reword-${id}`)
  await clock.settle()
  const after = JSON.stringify(await panel.drawn())
  for (const direction of ['simpler', 'less', 'more']) expect(after).toContain(`headsup-redo-${direction}-${id}`)
  await panel.unmount()
})

test('the panel shows the newest note in a card over a timeline of every note, a click on a row selects it, and Got it reads it', async ($, on) => {
  const { clock, states } = setup(on)
  await finding($, clock)
  const panel = await pane($)
  const shown = JSON.stringify(await panel.drawn())
  const id = String(shown.match(/"id":"headsup-note-([^"]+)"/)?.[1])
  const card = JSON.stringify(await panel.find({ key: 'note-card' }))
  expect(card).toContain('#1')
  expect(card).toContain('Watch how often people ask follow-ups.')
  expect(shown.split('"key":"note-row-').length - 1).toBe(1)
  expect(shown).toContain('Heads up')
  const bar = JSON.stringify(await panel.find({ key: 'headsup-actions' }))
  expect(JSON.stringify(await panel.find({ key: 'note-card' }))).toContain('headsup-actions')
  for (const action of ['understood', 'chat', 'reword']) expect(bar).toContain(`headsup-${action}-${id}`)
  await click(panel, `headsup-note-${id}`)
  await clock.settle()
  expect(states.get('mod-heads-up.open')).toEqual([id])
  expect(JSON.stringify(await panel.find({ key: 'note-card' }))).toContain('Watch how often people ask follow-ups.')
  await click(panel, `headsup-understood-${id}`)
  await clock.settle()
  expect(states.get('mod-heads-up.open')).toEqual([])
  const ui = await band($)
  expect(JSON.stringify(await ui.find({ key: 'menu-entry-headsup' }))).not.toContain('"badge"')
  await ui.unmount()
  await panel.unmount()
})

test('the X on the panel card hides it and keeps the timeline, and a click on a row shows the card again', async ($, on) => {
  const { clock } = setup(on)
  await finding($, clock)
  const panel = await pane($)
  const id = String(JSON.stringify(await panel.drawn()).match(/"id":"headsup-note-([^"]+)"/)?.[1])
  expect(JSON.stringify(await panel.find({ key: 'note-card-block' }))).toContain('"id":"headsup-close"')
  await click(panel, 'headsup-close')
  await clock.settle()
  const closed = JSON.stringify(await panel.drawn())
  expect(closed).not.toContain('"key":"note-card"')
  expect(closed).toContain(`"key":"note-row-${id}"`)
  expect(closed).not.toContain('No notes yet')
  await click(panel, `headsup-note-${id}`)
  await clock.settle()
  expect(JSON.stringify(await panel.find({ key: 'note-card' }))).toContain('Watch how often people ask follow-ups.')
  await panel.unmount()
})

test('a card closed in one session shows again after a /resume away and back', async ($, on) => {
  const session = { id: 's1' }
  const { clock } = setup(on, { session })
  await finding($, clock)
  let panel = await pane($)
  await click(panel, 'headsup-close')
  await clock.settle()
  expect(JSON.stringify(await panel.drawn())).not.toContain('"key":"note-card"')
  await panel.unmount()
  for (const id of ['s2', 's1']) {
    session.id = id
    panel = await pane($)
    await clock.settle()
    await panel.unmount()
  }
  panel = await pane($)
  expect(JSON.stringify(await panel.drawn())).toContain('"key":"note-card"')
  await panel.unmount()
})

test('the card keeps the three buttons in one row, and Reword puts its three choices in that same row', async ($, on) => {
  const { clock } = setup(on)
  await finding($, clock)
  const panel = await pane($)
  const id = String(JSON.stringify(await panel.drawn()).match(/"id":"headsup-note-([^"]+)"/)?.[1])
  const before = JSON.stringify(await panel.find({ key: 'headsup-actions' }))
  expect(before).not.toContain('headsup-redo-')
  await click(panel, `headsup-reword-${id}`)
  await clock.settle()
  const after = JSON.stringify(await panel.find({ key: 'headsup-actions' }))
  for (const direction of ['simpler', 'less', 'more']) expect(after).toContain(`headsup-redo-${direction}-${id}`)
  expect(after).toContain(`headsup-reword-${id}`)
  expect(JSON.stringify(await panel.drawn()).split('"key":"headsup-actions"').length - 1).toBe(1)
  await panel.unmount()
})

test('hovering a note header posts its tip into the footer', async ($, on) => {
  const { clock } = setup(on)
  await finding($, clock)
  const panel = await pane($)
  const id = String(JSON.stringify(await panel.drawn()).match(/"id":"headsup-note-([^"]+)"/)?.[1])
  await panel.pointer({ in: `headsup-note-${id}`, type: 'move', x: 1, y: 0 })
  await clock.settle()
  const footer = JSON.stringify(await panel.find({ key: 'pane-footer' }))
  expect(footer).toContain('Open note')
  expect(footer).toContain('shows this note in the card')
  await panel.unmount()
})

test('a hovered pane control posts its tip into the footer, and the card and the pill show theirs in the band tip row', async ($, on) => {
  const { clock } = setup(on)
  await finding($, clock)
  const ui = await band($)
  await ui.pointer({ in: 'headsup-card-dismiss', type: 'move', x: 1, y: 0 })
  await clock.settle()
  expect(JSON.stringify(await ui.drawn())).toContain('Dismiss:')
  await ui.pointer({ in: 'menu-entry-headsup', type: 'move', x: 1, y: 0 })
  await clock.settle()
  expect(JSON.stringify(await ui.drawn())).toContain('notes on things you should know')
  await click(ui, 'headsup-card-open')
  await clock.settle()
  await ui.unmount()
  const panel = await pane($)
  expect(JSON.stringify(await panel.find({ key: 'pane-footer' }))).not.toContain('Ask Claude')
  const id = String(JSON.stringify(await panel.drawn()).match(/"id":"headsup-chat-([^"]+)"/)?.[1])
  await panel.pointer({ in: `headsup-chat-${id}`, type: 'move', x: 1, y: 0 })
  await clock.settle()
  const hovered = JSON.stringify(await panel.find({ key: 'pane-footer' }))
  expect(hovered).toContain('Ask Claude')
  expect(hovered).toContain('sends this note to Claude to check')
  await panel.pointer({ in: 'headsup-settings', type: 'move', x: 1, y: 0 })
  await clock.settle()
  expect(JSON.stringify(await panel.find({ key: 'pane-footer' }))).toContain('opens this mod')
  await panel.unmount()
})

test('the card clears after two prompts, or at once on ×, and stays in the panel', async ($, on) => {
  const topics = [FULL_LEARN, OTHER_TOPIC]
  let n = 0
  const { clock } = setup(on, { reply: () => answered(about(topics[n++] ?? FULL_LEARN)) })
  await finding($, clock)
  await $.prompt.submit({ text: 'next' } as never)
  let ui = await band($)
  expect(await ui.find({ key: 'headsup-card' })).toBeDefined()
  await ui.unmount()
  await $.prompt.submit({ text: 'and next' } as never)
  ui = await band($)
  expect(await ui.find({ key: 'headsup-card' })).toBeUndefined()
  await ui.unmount()

  await step($, 6, { turnId: 't2' })
  await clock.settle()
  ui = await band($)
  await click(ui, 'headsup-card-dismiss')
  await clock.settle()
  expect(await ui.find({ key: 'headsup-card' })).toBeUndefined()
  // Dismissed reads it; the first note, cleared by prompts, stays unread.
  expect(JSON.stringify(await ui.find({ key: 'menu-entry-headsup' }))).toContain('"text":"1"')
  await ui.unmount()
  const panel = await pane($)
  expect(JSON.stringify(await panel.drawn()).match(/"key":"headsup-note-/g)?.length).toBe(2)
  await panel.unmount()
})

test('a dropped Ask Claude toasts the reason and puts the note in the prompt box, after any draft', async ($, on) => {
  const { clock, fills, sent, setDraft } = setup(on, { drop: 'a Stop stands' })
  await finding($, clock)
  const ui = await band($)
  await click(ui, 'headsup-card-open')
  await clock.settle()
  await ui.unmount()
  const panel = await pane($)
  const id = String(JSON.stringify(await panel.drawn()).match(/"id":"headsup-chat-([^"]+)"/)?.[1])
  await click(panel, `headsup-chat-${id}`)
  await clock.settle()
  expect(sent.slice(1)).toEqual([])
  expect(fills).toHaveLength(1)
  expect(fills[0]).toMatchObject({ mode: 'replace' })
  expect(fills[0]!.text).toMatch(/^A heads-up note/)
  const cards = await band($)
  const drawn = JSON.stringify(await cards.drawn())
  expect(drawn).toContain('Ask Claude was not sent (a Stop stands), so the note is in the prompt box')
  expect(drawn).toContain(' press Enter to send it')
  await cards.unmount()
  setDraft('my reverted prompt')
  await click(panel, `headsup-chat-${id}`)
  expect(fills[1]).toMatchObject({ mode: 'append' })
  expect(fills[1]!.text).toMatch(/^\nA heads-up note/)
  await panel.unmount()
})

test('a note with a bullet wider than the card cuts it to one row with Show all, which shows it in full', async ($, on) => {
  const long = 'The next npm run render gives you the quiet mix again, and the loudness pass has to run once more after it.'
  const { clock } = setup(on, { reply: () => answered(FULL.replace('- /ask takes a quick side question.', `- ${long}`)) })
  await finding($, clock)
  const ui = await band($)
  await click(ui, 'headsup-card-open')
  await clock.settle()
  await ui.unmount()
  const panel = await pane($)
  const tree = JSON.stringify(await panel.drawn())
  const id = String(tree.match(/"id":"headsup-more-([^"]+)"/)?.[1])
  expect(tree).toContain(`"wrap":"truncate-end"},"children":["• ${long}"]`)
  // The expand standard: on the action row, after a spacer, the arrow before a muted label.
  const actions = JSON.stringify(await panel.find({ key: 'headsup-actions' }))
  expect(actions).toMatch(/headsup-more-gap.*"label":"Show all","lead":"▾"/)
  await click(panel, `headsup-more-${id}`)
  await clock.settle()
  const open = JSON.stringify(await panel.drawn())
  expect(JSON.stringify(await panel.find({ key: 'headsup-actions' }))).toMatch(/"label":"Show less","lead":"▴"/)
  expect(open).toContain(`"wrap":"wrap"},"children":["${long}"]`)
  await panel.unmount()
})

test('a short note shows no Show all', async ($, on) => {
  const { clock } = setup(on)
  await finding($, clock)
  const ui = await band($)
  await click(ui, 'headsup-card-open')
  await clock.settle()
  await ui.unmount()
  const panel = await pane($)
  expect(JSON.stringify(await panel.drawn())).not.toContain('headsup-more-')
  await panel.unmount()
})

test('Open opens the panel on that note: its turn, the explanation, Chat sends the note, Simpler words rewrites it, ↗ scrolls', async ($, on) => {
  let rewritten = false
  const { clock, panes, fills, sent, forks, states } = setup(on, { reply: () => answered(rewritten ? 'title: Plainer\nexplain:\n- in short words' : FULL) })
  await $.ui.mount({ plugin: 'mod-heads-up', surface: 'terminal', component: 'UserMessage', requestId: 'row-1', props: { text: 'Add follow-ups to /ask', origin: { kind: 'composer' } } } as never)
  await finding($, clock)
  const ui = await band($)
  await click(ui, 'headsup-card-open')
  await clock.settle()
  expect(panes().map(each => each.id)).toEqual(['headsup'])
  expect(states.get('mod-heads-up.pane')).toBe(true)
  expect(JSON.stringify(await ui.find({ key: 'menu-entry-headsup' }))).not.toContain('"badge"')
  expect(await ui.find({ key: 'headsup-card' })).toBeUndefined()
  await ui.unmount()

  const panel = await pane($)
  const tree = JSON.stringify(await panel.drawn())
  expect(tree).toContain('#1')
  expect(tree).toContain('One-off /ask questions cost more')
  expect(tree).toContain('Watch how often people ask follow-ups.')

  const id = String(tree.match(/"id":"headsup-understood-([^"]+)"/)?.[1])
  await click(panel, `headsup-chat-${id}`)
  expect(fills).toEqual([])
  expect(sent.slice(1)).toEqual(['A heads-up note (a side model\'s summary, not something you said) claims: "The main agent cached /ask, so one-off questions now cost more." Check it against this session and tell me if it holds.'])

  rewritten = true
  await click(panel, `headsup-reword-${id}`)
  await clock.settle()
  await click(panel, `headsup-redo-simpler-${id}`)
  await clock.settle()
  expect(forks.at(-1)).toContain('more plainly')
  const after = JSON.stringify(await panel.drawn())
  expect(after).toContain('Plainer')
  expect(after).toContain('in short words')

  // The kit answers no ui.scroll, so a found row shows the kit's refusal; a row never drawn would say it is not on screen.
  await panel.press({ key: `note-jump-${id}` })
  await clock.settle()
  expect(await panel.find({ type: 'Text', text: /ui\.scroll/ })).toBeDefined()
  expect(await panel.find({ type: 'Text', text: /not on screen/ })).toBeUndefined()
  await panel.unmount()
})

test('a note keeps the row of its own prompt, so its jump does not reach a later copy of the same text', async ($, on) => {
  const topics = [FULL_LEARN, OTHER_TOPIC]
  let n = 0
  const { clock, store } = setup(on, { reply: () => answered(about(topics[n++] ?? FULL_LEARN)) })
  const row = (requestId: string) => $.ui.mount({ plugin: 'mod-heads-up', surface: 'terminal', component: 'UserMessage', requestId, props: { text: 'Add follow-ups to /ask', origin: { kind: 'composer' } } } as never)
  await $.prompt.submit({ text: 'Add follow-ups to /ask' } as never)
  await row('p0')
  await step($, 6, { turnId: 't1' })
  await clock.settle()
  await $.prompt.submit({ text: 'next' } as never)
  await $.prompt.submit({ text: 'and next' } as never)
  await $.prompt.submit({ text: 'Add follow-ups to /ask' } as never)
  await row('p3')
  await step($, 6, { turnId: 't2' })
  await clock.settle()
  const stored = (store.get('notes:s1') as { notes: { turn: number; promptId?: string }[] }).notes
  expect(stored.map(note => [note.turn, note.promptId])).toEqual([[1, 'p0'], [4, 'p3']])
  const panel = await pane($)
  const first = JSON.stringify(await panel.drawn()).match(/note-jump-(n1-\d+)/)?.[1]
  expect(first).toBeDefined()
  await panel.press({ key: `note-jump-${first}` })
  await clock.settle()
  expect(await panel.find({ type: 'Text', text: /ui.scroll/ })).toBeDefined()
  await panel.unmount()
})

test('the panel contract: the command toggles the panel and the settings, and the pane state follows', async ($, on) => {
  const { panes, states } = setup(on)
  await $.command.run({ command: 'mod-heads-up', args: '' } as never)
  expect(panes().map(each => each.id)).toEqual(['headsup'])
  await $.command.run({ command: 'mod-heads-up', args: '' } as never)
  expect(panes()).toEqual([])
  expect(states.get('mod-heads-up.pane')).toBe(false)

  await $.command.run({ command: 'mod-heads-up', args: 'settings' } as never)
  expect(panes().map(each => each.id)).toEqual(['headsup-settings'])
  expect(states.get('mod-heads-up.pane')).toBe(true)
  await $.command.run({ command: 'mod-heads-up', args: 'settings' } as never)
  expect(panes()).toEqual([])
  expect(states.get('mod-heads-up.pane')).toBe(false)
})

test('enabled off makes no model call; forget empties the known topics', { options: { enabled: false } }, async ($, on) => {
  const { clock, store, forks, completes } = setup(on)
  store.set('known:/w', ['A topic'])
  await finding($, clock)
  expect(forks.length + completes.length).toBe(0)
  await $.command.run({ command: 'mod-heads-up', args: 'forget' } as never)
  expect(store.get('known:/w')).toEqual([])
})

kitTest('with the setting untouched, the side check is off and makes no model call', async ($, on) => {
  const { clock, forks, completes } = setup(on)
  await finding($, clock)
  expect(forks.length + completes.length).toBe(0)
})

test('a check reads only the bytes the transcript gained since the last check', async ($, on) => {
  const { clock, reads, runs } = setup(on, { reply: () => answered('learn: none') })
  await $.prompt.submit({ text: 'Add follow-ups to /ask' } as never)
  const gainedFrom = encoder.encode(transcriptFor(['Add follow-ups to /ask'])).length
  await step($, 6)
  await clock.settle()
  expect(reads.filter(each => each.as === 'bytes').length).toBe(1)
  await $.prompt.submit({ text: 'and next' } as never)
  await step($, 6, { turnId: 't2' })
  await clock.settle()
  expect(reads.filter(each => each.as === 'bytes').length).toBe(1)
  expect(runs.length).toBe(1)
  expect(runs[0]![5]).toBe(String(gainedFrom + 1))
})

test('a transcript over 4 MiB is still numbered, its bytes read through a process', async ($, on) => {
  const { clock, runs } = setup(on, { oversize: true })
  await finding($, clock)
  const panel = await pane($)
  expect(JSON.stringify(await panel.drawn())).toContain('#1')
  expect(runs.length).toBeGreaterThan(0)
  await panel.unmount()
})

test('icons=safe draws the plain close mark and bracket-free subpills', { options: { icons: 'safe' } }, async ($, on) => {
  const { clock } = setup(on)
  await finding($, clock)
  const ui = await band($)
  expect(await drawn(ui, 'headsup-card-dismiss')).toContain('×')
  expect(await drawn(ui, 'headsup-card-open')).toContain('↵')
  expect(await drawn(ui, 'headsup-card-open')).not.toContain('[↵]')
  await ui.unmount()
})

test('icons=nerd draws the Nerd close glyph', { options: { icons: 'nerd' } }, async ($, on) => {
  const { clock } = setup(on)
  await finding($, clock)
  const ui = await band($)
  const close = await drawn(ui, 'headsup-card-dismiss')
  expect(close).toContain(String.fromCodePoint(0xf00d))
  expect(close).not.toContain('×')
  await ui.unmount()
})

test('hovering a toast × shows its tip in the band tip row', async ($, on) => {
  setup(on, { isUnplaced: true })
  const ui = await band($)
  await click(ui, 'menu-entry-headsup')
  await ui.pointer({ in: 'toast-headsup-1', type: 'move', x: 0, y: 0 })
  expect(JSON.stringify(await ui.drawn())).toContain('Dismiss:')
  await ui.unmount()
})

test('a band tip whose entry was redrawn while hovered clears after 5 s with no newer hover', async ($, on) => {
  const { clock } = setup(on, { isUnplaced: true })
  // Live, a band redraw mid-turn replaced the hovered entry, so its own quiet timer, and the leave, never came.
  const first = await band($)
  await first.pointer({ in: 'menu-entry-headsup', type: 'move', x: 1, y: 0 })
  await first.unmount()
  const showsNow = async () => {
    const ui = await band($)
    const shown = (await ui.find({ type: 'Text', text: /notes on things you should know/ })) !== undefined
    await ui.unmount()
    return shown
  }
  expect(await showsNow()).toBe(true)
  await clock.advance(4000)
  expect(await showsNow()).toBe(true)
  await clock.advance(1000)
  expect(await showsNow()).toBe(false)
})

const LIFTED = '#2F3654'
const CARD_FILL = '#1a1e30'
const ACCENT = '#7386D0'

const seedNotes = (store: Map<string, unknown>, count = 3) => {
  const note = (n: number, isRead: boolean) => ({ id: `n${n}-${n}`, turn: n, prompt: `prompt ${n}`, at: n, isRead, learn: `learn ${n}`, tag: 'Heads up', title: `title ${n}`, body: [`body ${n}`] })
  store.set('notes:s1', { notes: Array.from({ length: count }, (_, at) => note(at + 1, at === 0)), card: null, since: 0, checked: null })
}

// A mock Client surface whose elements return their props, so a test reads the colors a row drew.
function rowSurface() {
  const running = new Set<() => void>()
  let pointer: (event: any) => void = () => {}
  const surface: any = {
    elements: { Box: (props: any) => props, Text: (props: any) => props },
    state: undefined,
    setState: (state: any) => (surface.state = state),
    every: (_ms: number, fn: () => void) => {
      running.add(fn)
      return () => running.delete(fn)
    },
    onPointer: (handler: (event: any) => void) => (pointer = handler),
    post: () => {},
  }
  const props = { id: 'headsup-note-a', time: ' 10:00 ', mark: ' ●', summary: ' learn ', isSelected: false, isUnread: true, tip: { glyph: '>', label: 'Open note', text: 't' } }
  return { running, surface, props, send: (event: any) => pointer(event), bg: (row: any) => row.backgroundColor as string }
}

test('the pointer lights a whole timeline row, lifted with accent text, and the light fades out in steps', () => {
  const { running, surface, props, send, bg } = rowSurface()
  expect(bg(Row(props, surface))).toBe(CARD_FILL)
  send({ type: 'enter', x: 3, y: 0 })
  const lit: any = Row(props, surface)
  expect(bg(lit)).toBe(LIFTED)
  expect(lit.children.map((part: any) => part.color)).toEqual([ACCENT, ACCENT, ACCENT])
  send({ type: 'leave', x: 0, y: 0 })
  expect(bg(Row(props, surface))).toBe(LIFTED)
  ;[...running].forEach(fn => fn())
  const mid = bg(Row(props, surface))
  expect([LIFTED, CARD_FILL]).not.toContain(mid)
  ;[...running].forEach(fn => fn())
  expect(bg(Row(props, surface))).toBe(CARD_FILL)
  expect(running.size).toBe(0)
})

test('with animations off a timeline row goes back to rest at once', { options: { animations: false } }, async ($, on) => {
  const { store } = setup(on)
  seedNotes(store)
  const panel = await pane($)
  const row = 'headsup-note-n1-1'
  await panel.pointer({ in: row, type: 'enter', x: 3, y: 0 })
  expect(await drawn(panel, row)).toContain(LIFTED)
  await panel.pointer({ in: row, type: 'leave', x: 0, y: 0 })
  expect(await drawn(panel, row)).not.toContain(LIFTED)
  await panel.unmount()
})

test('the selected timeline row is accent and bold, the others are not bold', async ($, on) => {
  const { store } = setup(on)
  seedNotes(store)
  const panel = await pane($)
  const selected = await drawn(panel, 'headsup-note-n3-3')
  expect(selected).toContain('"bold":true')
  expect(selected).toContain(ACCENT)
  expect(await drawn(panel, 'headsup-note-n1-1')).not.toContain('"bold":true')
  await panel.unmount()
})

test('the note card text has a minimum height that a long note can grow past, and the timeline has no rail rows between notes', async ($, on) => {
  const { store } = setup(on)
  seedNotes(store)
  const panel = await pane($)
  const text = (await panel.find({ key: 'note-card-text' })) as { props: { height?: number; minHeight?: number; overflow?: string } }
  expect(text.props.minHeight).toBeGreaterThan(0)
  expect(text.props.height).toBeUndefined()
  expect(text.props.overflow).toBeUndefined()
  expect(await panel.find({ type: 'Text', text: /^ +│$/ })).toBeUndefined()
  await panel.unmount()
})

test('each jump pill has its tip as a footer reveal tied to its hover group', async ($, on) => {
  const { store } = setup(on)
  seedNotes(store, 2)
  const panel = await pane($)
  expect(JSON.stringify(await panel.drawn())).toContain('"scope":"note-jump-box-n1-1"')
  expect(await panel.find({ type: 'Text', text: /scrolls the chat to this turn/ })).toBeDefined()
  expect(await panel.find({ type: 'Text', text: /Jump to turn/ })).toBeDefined()
  await panel.unmount()
})

test('mod-menu labels never hides the pill label on Nerd and keeps the icon', { options: { icons: 'nerd' } }, async ($, on) => {
  const { states } = setup(on)
  states.set('mod-menu.labels', 'never')
  const ui = await band($)
  const entry = await drawn(ui, 'menu-entry-headsup')
  expect(entry).not.toContain('Heads up')
  await ui.unmount()
})

const SPEND = 'C:/cfg/mods-data/mod-heads-up/spend.json'
function spendWorld(on: any, failWrite = false) {
  const world = setup(on, { reply: () => ({ isAnswered: true, text: 'learn: none', usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5, cache_creation_input_tokens: 7 } }) })
  const writes: { path: string; text: string }[] = []
  on('env.get', (_$: unknown, e: { name: string }) => ({ value: e.name === 'CLAUDE_CONFIG_DIR' ? 'C:\\cfg' : undefined }))
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    if (failWrite) throw new Error('disk full')
    writes.push({ path: e.path.replace(/\\/g, '/').replace(/^.*?(?=[A-Za-z]:\/)/, ''), text: e.text })
    return { value: undefined }
  })
  return { ...world, writes }
}

test('a check result adds its usage to spend.json under today and the session model', async ($, on) => {
  const { clock, writes } = spendWorld(on)
  await step($, 6)
  await clock.settle()
  expect(writes.length).toBe(1)
  expect(writes[0]!.path).toBe(SPEND)
  const day = Object.values(JSON.parse(writes[0]!.text).days)[0] as Record<string, unknown>
  expect(day['claude-opus-5-5']).toEqual({ calls: 1, input: 100, output: 20, cacheRead: 5, cacheWrite: 7 })
})

test('a spend.json write that fails is ignored and the check still finishes', async ($, on) => {
  const { clock, forks } = spendWorld(on, true)
  await step($, 6)
  await clock.settle()
  expect(forks.length).toBe(1)
})

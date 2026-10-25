// mod-wrap-up / tests/wrap-up.test.tsx, by v-amorim
// Tests handoff prompt building, word clamping, thread parsing and the wrap-up band's drawing.
import { expect, mock, test } from 'claude-code/testing'

import { buildPrompt, clampWords, compactNote, isFresh, parseNames, parseThreads, scopeNote, skillBody } from '../hooks/handoff'
import { CAPS, THEME } from '../hooks/theme'
import Choice from '../hooks/choice'
import { showNumber, stepNumber, stepOf } from '../hooks/settings'
declare const setTimeout: (run: (value: unknown) => void, ms: number) => unknown

const SKILL = '---\nname: session-handoff\ndescription: x\n---\n\n# session-handoff\n\nWrite one message.'
const USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const BAND = (isWorking = false) =>
  ({
    plugin: 'mod-wrap-up',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking, maxRows: 6, bodyColumns: 80, scroll: { offset: 0, bodyRows: 6 }, view: {} },
  }) as const

// Stubs every op the flow reaches and records the order they were called in.
// threads is Haiku's reply for the picker. The kit answers no $.ui.ask, so a picker that gets that far sees it dismissed.
function world(on: any, fork: unknown, runClear: ($: any, e: { command: string }) => unknown = () => ({ text: '' }), messages: unknown[] = [], threads: unknown = answered, fillThrows = false, fillFailsFirst = 0) {
  const calls: string[] = []
  const filled: string[] = []
  const forks: string[] = []
  const toasts: string[] = []
  const completes: string[] = []
  const renames: string[] = []
  on('ui.toast', (_$: unknown, e: { text: string }) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('session.messages', () => ({ value: messages }))
  on('model.complete', (_$: unknown, e: { prompt: string; model: string }) => {
    if (e.model === 'haiku') {
      calls.push('threads')
      return { value: threads }
    }
    completes.push(e.prompt)
    calls.push('complete')
    return { value: answered }
  })
  on('fs.read', (_$: unknown, e: { path: string }) => {
    const path = e.path.replace(/\\/g, '/')
    if (path.endsWith('/showcase.json')) return { value: JSON.stringify({ actions: [{ label: 'Open the handoff card', command: 'mod-wrap-up' }] }) }
    return { value: path.endsWith('skills/session-handoff/SKILL.md') ? SKILL : '' }
  })
  on('model.fork', (_$: unknown, e: { prompt: string }) => {
    forks.push(e.prompt)
    calls.push('fork')
    return { value: fork }
  })
  on('command.run', (_$: any, e: { command: string; args?: string }) => {
    calls.push(`run:${e.command}`)
    if (e.command === 'rename') renames.push(e.args ?? '')
    return runClear(_$, e)
  })
  on('prompt.fill', (_$: unknown, e: { text: string }) => {
    calls.push('fill')
    if (fillThrows) throw new Error('prompt is gone')
    if (calls.filter(call => call === 'fill').length <= fillFailsFirst) return { isFilled: false }
    filled.push(e.text)
    return { isFilled: true }
  })
  on('ui.render', ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text key="base">idle</Text>
  })
  on('session.end', (_$: unknown, e: { sessionId: string }) => ({ sessionId: e.sessionId }))
  const clock = mock.clock(on)
  mock.store(on)
  mock.env(on, {})
  return { calls, filled, forks, toasts, completes, renames, clock }
}

const answered = { isAnswered: true, text: '  Goal: ship it.  ', usage: USAGE }

type Band = { pointer: (event: never) => Promise<void>; drawn: (scope: { in: string }) => Promise<unknown> }

// Entries are Clients: a click is a pointer down, and a label is what the Client drew.
const click = (band: Band, key: string) => band.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: key } as never)
const label = async (band: Band, key: string) => JSON.stringify(await band.drawn({ in: key }))

// The pill is one Client: ` Wrap up ` (cells 0 to 8), ` Handoff ` (9 to 17), ` Compact ` (18 to 26); Nerd adds the pill's left cap and a cap cell each side of an option.
const OPTION_X = { safe: { handoff: 12, compact: 22 }, nerd: { handoff: 15, compact: 25 } }
const choose = (band: Band, option: 'handoff' | 'compact', icons: 'safe' | 'nerd' = 'safe') =>
  band.pointer({ type: 'down', x: OPTION_X[icons][option], y: 0, button: 'left', in: 'wrap-up-entry' } as never)

async function handOff(band: Band) {
  await click(band, 'wrap-up-entry')
  await choose(band, 'handoff')
  await click(band, 'wrap-up-go')
}

test('the prompt is the skill body with the cap, and bad caps fall back', () => {
  expect(skillBody(SKILL)).toBe('# session-handoff\n\nWrite one message.')
  expect(buildPrompt(SKILL, 250)).toContain('The cap for this run is 250 words')
  expect(buildPrompt(SKILL, 250)).not.toContain('description: x')
  expect([clampWords(undefined), clampWords(5), clampWords(99999), clampWords(300)]).toEqual([400, 100, 2000, 300])
  expect(isFresh({ text: 'a', at: 0 }, 1000)).toBe(true)
  expect(isFresh({ text: 'a', at: 0 }, 999999)).toBe(false)
})

test('the idle pill reads Wrap up; the pointer opens Handoff and Compact and lights the one under it, as the menu entries do', async ($, on) => {
  const w = world(on, answered)
  const band = await $.ui.mount(BAND())
  expect(await label(band, 'wrap-up-entry')).toContain(' Wrap up ')
  expect(await label(band, 'wrap-up-entry')).not.toContain(' Handoff ')

  await band.pointer({ type: 'move', x: 1, y: 0, in: 'wrap-up-entry' } as never)
  expect(await label(band, 'wrap-up-entry')).toContain(' Handoff ')
  expect(await label(band, 'wrap-up-entry')).toContain(' Compact ')
  expect(await label(band, 'wrap-up-entry')).not.toContain(THEME.lifted)

  await band.pointer({ type: 'move', x: OPTION_X.safe.compact, y: 0, in: 'wrap-up-entry' } as never)
  const drawn: { children: { children: { props: { color: string }; children: string[] }[] }[] } = await band.drawn({ in: 'wrap-up-entry' }) as never
  const lit = drawn.children.flatMap(child => child.children ?? []).filter(text => text.props?.color === THEME.accent)
  expect(lit.map(text => text.children.join(''))).toEqual([' Compact '])
  expect(await label(band, 'wrap-up-entry')).not.toContain(THEME.lifted)

  await band.pointer({ type: 'leave', x: 0, y: 0, in: 'wrap-up-entry' } as never)
  expect(await label(band, 'wrap-up-entry')).not.toContain(' Handoff ')
  expect(w.calls).toEqual([])
  await band.unmount()
})

test('Cancel closes the card and runs nothing', async ($, on) => {
  const w = world(on, answered)
  const band = await $.ui.mount(BAND())
  await click(band, 'wrap-up-entry')
  await choose(band, 'handoff')
  expect(await band.find({ key: 'wrap-up-card' })).toBeDefined()
  await click(band, 'wrap-up-cancel')
  expect(await band.find({ key: 'wrap-up-card' })).toBeUndefined()
  expect(await band.find({ key: 'wrap-up-entry' })).toBeDefined()
  expect(w.calls).toEqual([])
  await band.unmount()
})

test('Handoff forks, clears, then fills the handoff without sending it', async ($, on) => {
  const w = world(on, answered)
  const band = await $.ui.mount(BAND())
  await handOff(band)

  expect(w.calls).toEqual(['fork', 'run:clear', 'fill'])
  expect(w.forks[0]).toContain('The cap for this run is 400 words')
  expect(w.forks[0]).toContain('Write one message.')
  expect(w.filled).toEqual(['Goal: ship it.'])
  expect(await band.find({ key: 'wrap-up-entry' })).toBeDefined()
  await band.unmount()
})

test('an empty session stops before the clear and says why in a card, not the pill row', async ($, on) => {
  const w = world(on, { isAnswered: false, reason: 'nothing-to-fork' })
  const band = await $.ui.mount(BAND())
  await handOff(band)

  expect(w.calls).toEqual(['fork'])
  expect(w.toasts).toEqual([])
  expect(await band.find({ type: 'Text', text: 'Nothing to hand off yet, send a message first' })).toBeDefined()
  await w.clock.advance(4000)
  expect(await band.find({ type: 'Text', text: /hand off yet/ })).toBeUndefined()
  expect(await band.find({ key: 'wrap-up-entry' })).toBeDefined()
  await band.unmount()
})

test('a resumed session with nothing to fork summarizes the transcript instead', async ($, on) => {
  const resumed = [
    { role: 'user', text: 'fix the build', toolUses: [] },
    { role: 'assistant', text: 'Looking.', toolUses: [{ tool_use_id: 't', tool: 'Bash', input: { command: 'npm   run build' } }] },
  ]
  const w = world(on, { isAnswered: false, reason: 'nothing-to-fork' }, undefined, resumed)
  const band = await $.ui.mount(BAND())
  await handOff(band)

  // Haiku's reply is no thread list, so nothing is asked and everything carries over.
  expect(w.calls).toEqual(['threads', 'fork', 'complete', 'run:clear', 'fill'])
  expect(w.completes[0]).toContain('USER: fix the build')
  expect(w.completes[0]).toContain('[Bash: npm run build]')
  expect(w.completes[0]).toContain('The cap for this run is 400 words')
  expect(w.filled).toEqual(['Goal: ship it.'])
  await band.unmount()
})

const SESSION = [{ role: 'user', text: 'fix the build, then the docs', toolUses: [] }]
const THREADS = {
  isAnswered: true,
  usage: USAGE,
  text: '{"threads":[{"label":"Build fix","detail":"The failing build and its cause."},{"label":"Docs, rewrite","detail":"The README rewrite."},{"label":"Deploy","detail":"The deploy plan for Friday."}]}',
}

const ALL_ALSO = { files: true, decisions: true, tasks: true, errors: true }

test('the picks become the handoff scope and the /compact text', () => {
  const threads = parseThreads(THREADS.text)
  // Labels lose their commas, so a list of them still reads as one item each.
  expect(threads.map(thread => thread.label)).toEqual(['Build fix', 'Docs rewrite', 'Deploy'])
  expect(parseThreads('{"threads":[{"label":"Only one","detail":"x"}]}')).toEqual([])
  expect(parseThreads('not json')).toEqual([])

  const kept = [threads[0]!, threads[2]!]
  const also = { ...ALL_ALSO, errors: false }
  const scope = scopeNote(threads, kept, also)
  expect(scope).toContain('Carry over only these threads of the session:\n- Build fix: The failing build and its cause.\n- Deploy: The deploy plan for Friday.')
  expect(scope).toContain('Leave out everything about:\n- Docs rewrite: The README rewrite.')
  expect(scope).toContain('Also leave out the errors seen and how they were fixed.')
  expect(scopeNote(threads, threads, ALL_ALSO)).toBe('')

  expect(compactNote(threads, kept, also)).toBe('Focus on Build fix and Deploy. Keep the files in play, the decisions made and the open tasks. Leave out Docs rewrite.')
  expect(compactNote(threads, threads, { files: true, decisions: false, tasks: false, errors: false })).toBe('Keep the files in play.')
  expect(compactNote([], [], { files: false, decisions: false, tasks: false, errors: false })).toBe('')
})

test('Compact reads the threads into the card; a click drops one and the go fills /compact for review', async ($, on) => {
  const w = world(on, answered, undefined, SESSION, THREADS)
  const band = await $.ui.mount(BAND())
  await click(band, 'wrap-up-entry')
  await choose(band, 'compact')
  await w.clock.advance(10)

  expect(await label(band, 'wrap-up-thread-1')).toContain(' Docs rewrite ')
  expect(await band.find({ type: 'Text', text: '/compact ' })).toBeDefined()
  await click(band, 'wrap-up-thread-1')
  expect(await band.find({ type: 'Text', text: 'Focus on Build fix and Deploy. Keep the files in play, the decisions made and the open tasks. Leave out Docs rewrite.' })).toBeDefined()

  await click(band, 'wrap-up-go')
  expect(w.calls).toEqual(['threads', 'fill'])
  expect(w.filled).toEqual(['/compact Focus on Build fix and Deploy. Keep the files in play, the decisions made and the open tasks. Leave out Docs rewrite.'])
  expect(await band.find({ key: 'wrap-up-card' })).toBeUndefined()
  await band.unmount()
})

test('Handoff carries the dropped threads into the fork prompt; switching modes keeps the picks', async ($, on) => {
  const w = world(on, answered, undefined, SESSION, THREADS)
  const band = await $.ui.mount(BAND())
  await click(band, 'wrap-up-entry')
  await choose(band, 'compact')
  await w.clock.advance(10)
  await click(band, 'wrap-up-thread-1')
  await choose(band, 'handoff')
  expect(await band.find({ type: 'Text', text: /^Writes a handoff/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: '/compact ' })).toBeUndefined()

  await click(band, 'wrap-up-go')
  expect(w.calls).toEqual(['threads', 'fork', 'run:clear', 'fill'])
  expect(w.forks[0]).toContain('Leave out everything about:\n- Docs rewrite: The README rewrite.')
  await band.unmount()
})

test('pick_threads off reads no threads and keeps everything', { options: { pick_threads: false } }, async ($, on) => {
  const w = world(on, answered, undefined, SESSION, THREADS)
  const band = await $.ui.mount(BAND())
  await click(band, 'wrap-up-entry')
  await choose(band, 'handoff')
  expect(await band.find({ type: 'Text', text: 'Threads' })).toBeUndefined()
  await click(band, 'wrap-up-go')

  // The read still runs, for the names.
  expect(w.calls).toEqual(['threads', 'fork', 'run:clear', 'fill'])
  expect(w.forks[0]).not.toContain('Carry over only')
  await band.unmount()
})

const NAMED = {
  isAnswered: true,
  usage: USAGE,
  text: '{"threads":[{"label":"Build fix","detail":"The failing build."},{"label":"Deploy","detail":"The deploy plan."}],"names":{"this":"EP-1 build fix","next":"EP-2 deploy"}}',
}

test('names are trimmed, one past 16 characters is cut at its last separator, and one with no separator to cut at or missing is no name', () => {
  expect(parseNames(NAMED.text)).toEqual({ this: 'EP-1 build fix', next: 'EP-2 deploy' })
  expect(parseNames('{"names":{"this":"  EP-1   fix ","next":"EP-2 a name far too long"}}')).toEqual({ this: 'EP-1 fix', next: 'EP-2 a name far' })
  expect(parseNames('{"names":{"this":"EP-12 build -- deploy","next":"averyveryverylongword"}}')).toEqual({ this: 'EP-12 build', next: '' })
  expect(parseNames('{"threads":[]}')).toEqual({ this: '', next: '' })
  expect(parseNames('not json')).toEqual({ this: '', next: '' })
})

test('Handoff shows both names; Go renames this session, clears, then renames the fresh one before the fill', { options: { icons: 'safe' } }, async ($, on) => {
  const w = world(on, answered, undefined, SESSION, NAMED)
  const band = await $.ui.mount(BAND())
  await click(band, 'wrap-up-entry')
  await choose(band, 'handoff')
  await w.clock.advance(10)

  expect(await band.find({ type: 'Text', text: 'RENAME' })).toBeDefined()
  expect(await label(band, 'wrap-up-name-this')).toContain(' EP-1 build fix ')
  expect(await label(band, 'wrap-up-name-next')).toContain(' EP-2 deploy ')
  expect(await band.find({ type: 'Text', text: '· this session' })).toBeDefined()
  await band.pointer({ type: 'move', x: 1, y: 0, in: 'wrap-up-name-this' } as never)
  expect(await band.find({ type: 'Text', text: ' renames this session before the clear, click to skip' })).toBeDefined()

  await click(band, 'wrap-up-go')
  expect(w.calls).toEqual(['threads', 'fork', 'run:rename', 'run:clear', 'run:rename', 'fill'])
  expect(w.renames).toEqual(['EP-1 build fix', 'EP-1 build fix <- EP-2 deploy'])
  expect(w.filled).toEqual(['Goal: ship it.'])
  await band.unmount()
})

test('a name clicked off is skipped, and Compact shows no names', { options: { icons: 'safe' } }, async ($, on) => {
  const w = world(on, answered, undefined, SESSION, NAMED)
  const band = await $.ui.mount(BAND())
  await click(band, 'wrap-up-entry')
  await choose(band, 'compact')
  await w.clock.advance(10)
  expect(await band.find({ key: 'wrap-up-names' })).toBeUndefined()

  await choose(band, 'handoff')
  expect(await label(band, 'wrap-up-name-this')).toContain('●')
  await click(band, 'wrap-up-name-this')
  expect(await label(band, 'wrap-up-name-this')).toContain('○')
  await click(band, 'wrap-up-go')
  expect(w.calls).toEqual(['threads', 'fork', 'run:clear', 'run:rename', 'fill'])
  expect(w.renames).toEqual(['EP-2 deploy'])
  await band.unmount()
})

test('a refused /rename still clears and fills, and the toast names the line to type', { options: { icons: 'safe' } }, async ($, on) => {
  const w = world(on, answered, (_$, e) => {
    if (e.command === 'rename') throw new Error('unknown command')
    return { text: '' }
  }, SESSION, NAMED)
  const band = await $.ui.mount(BAND())
  await click(band, 'wrap-up-entry')
  await choose(band, 'handoff')
  await w.clock.advance(10)
  await click(band, 'wrap-up-go')

  expect(w.filled).toEqual(['Goal: ship it.'])
  expect(await band.find({ type: 'Text', text: /Could not rename the earlier session to EP-1 build fix/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /type \/rename EP-1 build fix <- EP-2 deploy/ })).toBeDefined()
  await band.unmount()
})

test('a session with no names says so on the card and renames nothing', { options: { icons: 'safe' } }, async ($, on) => {
  const w = world(on, answered, undefined, SESSION, THREADS)
  const band = await $.ui.mount(BAND())
  await click(band, 'wrap-up-entry')
  await choose(band, 'handoff')
  await w.clock.advance(10)
  expect(await band.find({ type: 'Text', text: 'No names proposed, nothing is renamed' })).toBeDefined()
  await click(band, 'wrap-up-go')
  expect(w.renames).toEqual([])
  await band.unmount()
})

test('while Claude works the pill stays muted and a click explains in a card', async ($, on) => {
  const w = world(on, answered)
  on('turn.start', (_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  await $.turn.start({ turnId: 't1' } as never)
  const band = await $.ui.mount(BAND(true))
  expect(await label(band, 'wrap-up-entry')).toContain(THEME.muted)
  await click(band, 'wrap-up-entry')

  expect(w.toasts).toEqual([])
  expect(await band.find({ type: 'Text', text: 'Claude is working, Wrap up is available once it is idle' })).toBeDefined()
  expect(await label(band, 'wrap-up-entry')).not.toContain(' Handoff ')
  expect(w.calls).toEqual([])
  await band.unmount()
})

test('a refused /clear falls back to /clear in the composer and keeps the handoff waiting', async ($, on) => {
  const w = world(on, answered, () => {
    throw new Error('unknown command')
  })
  const band = await $.ui.mount(BAND())
  await handOff(band)

  expect(w.filled).toEqual(['/clear'])
  expect(await band.find({ type: 'Text', text: /^Could not run \/clear/ })).toBeDefined()

  // The person runs /clear: session.end carries the waiting handoff over.
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: {} } as never)
  await w.clock.advance(400)
  expect(w.filled).toEqual(['/clear', 'Goal: ship it.'])
  await band.unmount()
})

test('a fill that throws after the clear is a "not filled" card, never an unhandled error', async ($, on) => {
  const w = world(on, answered, () => ({ text: '' }), [], answered, true)
  const band = await $.ui.mount(BAND())
  await handOff(band)

  expect(w.filled).toEqual([])
  expect(await band.find({ type: 'Text', text: 'Cleared, but the handoff could not be filled in' })).toBeDefined()
  await band.unmount()
})

test('a /clear whose session.end already filled the prompt gives no false "cleared, not filled" warning', async ($, on) => {
  // The command's first retries fail, then session.end's later fill lands before the command's next try finds the handoff gone.
  const w = world(on, answered, async () => {
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: {} } as never)
    return { text: '' }
  }, [], answered, false, 2)
  const band = await $.ui.mount(BAND())
  const done = handOff(band)
  for (let step = 0; step < 15; step++) await w.clock.advance(100)
  await done

  expect(w.filled).toEqual(['Goal: ship it.'])
  expect(await band.find({ type: 'Text', text: /could not be filled in/ })).toBeUndefined()
  await band.unmount()
})

test('the typed command opens the card, in Compact mode with `compact`', async ($, on) => {
  const w = world(on, answered)
  const done = await $.command.run({ command: 'mod-wrap-up', args: 'compact' } as never)
  expect(done.text).toBe('Pick what carries over above the prompt')
  const band = await $.ui.mount(BAND())
  expect(await label(band, 'wrap-up-entry')).toContain(THEME.lifted)
  expect(await label(band, 'wrap-up-go')).toContain(' Fill prompt ')
  expect(await label(band, 'wrap-up-go')).toContain('" ↵ "')
  expect(await label(band, 'wrap-up-go')).toContain(THEME.surface3)
  expect(await label(band, 'wrap-up-go')).not.toContain(THEME.lifted)
  expect(await label(band, 'wrap-up-cancel')).toContain(THEME.surface3)
  expect(await band.find({ type: 'Text', text: 'THREADS' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: 'ALSO KEEP' })).toBeDefined()
  expect(w.calls).toEqual([])
  await band.unmount()
})

test('on auto the saved icons draw while the font is read beside session.start, which never waits on it', async ($, on) => {
  const saved: Record<string, unknown> = { 'look-nerd': true }
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: saved[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    saved[e.key] = e.value
    return { value: undefined }
  })
  mock.env(on, { WT_SESSION: '1', LOCALAPPDATA: 'C:/L' })
  let release = () => {}
  const gate = new Promise<void>(resolve => (release = resolve))
  on('fs.read', async () => {
    await gate
    return { value: '{ "font": { "face": "Cascadia Mono" } }' }
  })
  on('ui.render', ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text key="base">idle</Text>
  })
  on('session.start', () => ({ cwd: '/w' }))
  on('command.register', () => ({ value: { command: 'mod-wrap-up' } }))
  on('ui.panes', () => ({ value: [] }))
  on('state.set', () => ({ value: undefined }) as never)

  // The font read is still held here, so a session.start that waited on it would never return.
  await $.session.start({ cwd: '/w' } as never)
  const band = await $.ui.mount(BAND())
  expect(await label(band, 'wrap-up-entry')).toContain(CAPS.left)

  release()
  for (let tries = 0; tries < 50 && saved['look-nerd'] !== false; tries++) await new Promise(resolve => setTimeout(resolve, 5))
  expect(saved['look-nerd']).toBe(false)
  expect(await label(band, 'wrap-up-entry')).not.toContain(CAPS.left)
  await band.unmount()
})

test('icons=nerd cuts the pill to its archive icon when the row is wider than the band', { options: { icons: 'nerd' } }, async ($, on) => {
  world(on, answered)
  const narrow = BAND()
  const band = await $.ui.mount({ ...narrow, props: { ...narrow.props, bodyColumns: 6 } } as never)
  expect(await label(band, 'wrap-up-entry')).toContain(`" ${String.fromCodePoint(0xf187)} "`)
  await band.unmount()
})

const narrowBand = async ($: any, isWorking = false) => {
  const base = BAND(isWorking)
  return $.ui.mount({ ...base, props: { ...base.props, bodyColumns: 6 } } as never)
}

test('a pill cut to its icon does not expand on hover, and the hover still posts the head tip', { options: { icons: 'nerd' } }, async ($, on) => {
  world(on, answered)
  const band = await narrowBand($)
  await band.pointer({ type: 'move', x: 1, y: 0, in: 'wrap-up-entry' } as never)
  expect(await label(band, 'wrap-up-entry')).not.toContain(' Handoff ')
  expect(await band.find({ type: 'Text', text: ' offers to hand off to a fresh session, or compact this one' })).toBeDefined()
  expect(await band.find({ key: 'wrap-up-menu' })).toBeUndefined()
  await band.unmount()
})

test('a band tip whose entry was redrawn while hovered clears after 5 s with no newer hover', async ($, on) => {
  const w = world(on, answered)
  // Live, a band redraw mid-turn replaced the hovered entry, so its own quiet timer, and the leave, never came.
  const first = await $.ui.mount(BAND())
  await first.pointer({ type: 'move', x: 1, y: 0, in: 'wrap-up-entry' } as never)
  await first.unmount()
  // The pill's tip text also sits in the Client props, so only the tip row's Text says whether it shows.
  const showsNow = async () => {
    const band = await $.ui.mount(BAND())
    const shown = (await band.find({ type: 'Text', text: /offers to hand off to a fresh session/ })) !== undefined
    await band.unmount()
    return shown
  }
  expect(await showsNow()).toBe(true)
  await w.clock.advance(4000)
  expect(await showsNow()).toBe(true)
  await w.clock.advance(1000)
  expect(await showsNow()).toBe(false)
})

test('a click on the icon pill opens the choices card above the row; a choice runs as before and closes it', { options: { icons: 'nerd' } }, async ($, on) => {
  world(on, answered)
  const band = await narrowBand($)
  await click(band, 'wrap-up-entry')
  expect(await band.find({ key: 'wrap-up-menu' })).toBeDefined()
  for (const id of ['wrap-up-handoff', 'wrap-up-compact', 'wrap-up-auto', 'wrap-up-menu-close']) expect(await band.find({ key: id })).toBeDefined()
  expect(await band.find({ type: 'Text', text: 'Wrap up:' })).toBeDefined()
  await band.pointer({ type: 'move', x: 1, y: 0, in: 'wrap-up-compact' } as never)
  expect(await band.find({ type: 'Text', text: ' opens the pick card to fill a /compact' })).toBeDefined()
  await click(band, 'wrap-up-compact')
  expect(await band.find({ key: 'wrap-up-menu' })).toBeUndefined()
  expect(await band.find({ key: 'wrap-up-card' })).toBeDefined()
  await band.unmount()
})

test('the x closes the choices card and runs nothing', { options: { icons: 'nerd' } }, async ($, on) => {
  const w = world(on, answered)
  const band = await narrowBand($)
  await click(band, 'wrap-up-entry')
  await click(band, 'wrap-up-menu-close')
  expect(await band.find({ key: 'wrap-up-menu' })).toBeUndefined()
  expect(await band.find({ key: 'wrap-up-card' })).toBeUndefined()
  expect(w.calls).toEqual([])
  await click(band, 'wrap-up-entry')
  await click(band, 'wrap-up-entry')
  expect(await band.find({ key: 'wrap-up-menu' })).toBeUndefined()
  await band.unmount()
})

test('while Claude works the icon pill opens no choices card, a click explains', { options: { icons: 'nerd' } }, async ($, on) => {
  const w = world(on, answered)
  on('turn.start', (_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  await $.turn.start({ turnId: 't1' } as never)
  const band = await narrowBand($, true)
  await click(band, 'wrap-up-entry')
  expect(await band.find({ key: 'wrap-up-menu' })).toBeUndefined()
  expect(await band.find({ type: 'Text', text: 'Claude is working, Wrap up is available once it is idle' })).toBeDefined()
  expect(w.calls).toEqual([])
  await band.unmount()
})

test('with full labels a click on the head and hover still expand inline, never the card', { options: { icons: 'nerd' } }, async ($, on) => {
  world(on, answered)
  const band = await $.ui.mount(BAND())
  await band.pointer({ type: 'move', x: 1, y: 0, in: 'wrap-up-entry' } as never)
  expect(await label(band, 'wrap-up-entry')).toContain(' Handoff ')
  await click(band, 'wrap-up-entry')
  expect(await band.find({ key: 'wrap-up-menu' })).toBeUndefined()
  await band.unmount()
})

test('labels never draws the archive icon alone, and labels always keeps the label however narrow', { options: { icons: 'nerd' } }, async ($, on) => {
  world(on, answered)
  let labels = 'never'
  on('state.get', (_$: unknown, e: { plugin: string; key: string }) => ({ value: { value: e.plugin === 'mod-menu' && e.key === 'labels' ? labels : undefined } }))
  const band = await $.ui.mount(BAND())
  expect(await label(band, 'wrap-up-entry')).toContain(`" ${String.fromCodePoint(0xf187)} "`)
  await band.unmount()
  labels = 'always'
  const narrow = BAND()
  const wide = await $.ui.mount({ ...narrow, props: { ...narrow.props, bodyColumns: 6 } } as never)
  expect(await label(wide, 'wrap-up-entry')).toContain('" Wrap up "')
  await wide.unmount()
})

test('icons=nerd keeps the Wrap up labels plain, with no icon', { options: { icons: 'nerd' } }, async ($, on) => {
  world(on, answered)
  const band = await $.ui.mount(BAND())
  expect(await label(band, 'wrap-up-entry')).toContain('" Wrap up "')
  await click(band, 'wrap-up-entry')
  expect(await label(band, 'wrap-up-entry')).toContain(' Handoff ')
  // The right cap is the pill's last cell: cap, ` Wrap up `, two options of 11 cells, so x 32. The options stay open on it.
  await band.pointer({ type: 'move', x: 32, y: 0, in: 'wrap-up-entry' } as never)
  expect(await label(band, 'wrap-up-entry')).toContain(' Handoff ')
  expect(await label(band, 'wrap-up-entry')).toContain(CAPS.right)
  await choose(band, 'handoff', 'nerd')
  expect(await band.find({ type: 'Text', text: 'THREADS' })).toBeDefined()
  expect(await label(band, 'wrap-up-go')).toContain(`"${String.fromCodePoint(0xf054)}"`)
  await band.unmount()
})

test('icons=safe draws plain labels', { options: { icons: 'safe' } }, async ($, on) => {
  world(on, answered)
  const band = await $.ui.mount(BAND())
  expect(await label(band, 'wrap-up-entry')).toContain('" Wrap up "')
  await click(band, 'wrap-up-entry')
  expect(await label(band, 'wrap-up-entry')).toContain(' Handoff ')
  await band.unmount()
})

test('max_words reaches the fork prompt', { options: { max_words: 250 } }, async ($, on) => {
  const w = world(on, answered)
  const band = await $.ui.mount(BAND())
  await handOff(band)
  expect(w.forks[0]).toContain('The cap for this run is 250 words')
  await band.unmount()
})

test('the settings pane draws its title, status line and settings', { options: { icons: 'safe' } }, async ($, on) => {
  world(on, answered)
  on('config.list', () => ({ value: [{ key: 'mod-wrap-up.max_words', label: 'Handoff length', value: 400, kind: 'number', description: 'cap' }] }) as never)
  const pane = await $.ui.mount({
    plugin: 'mod-wrap-up',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'wrap-up',
    props: { scroll: { offset: 0, bodyRows: 20 }, bodyColumns: 80 },
  } as never)
  expect(JSON.stringify(await pane.drawn({ in: 'mod-wrap-up-settings-tab' }))).toMatch(/Wrap up [^]*"#3B446A"[^]*·[^]* Settings/)
  expect(await pane.find({ type: 'Text', text: /Click a setting to change it/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'Handoff length' })).toBeDefined()
  await pane.unmount()
})

test('number settings read with their unit, and a click moves them by a useful step', { options: { icons: 'safe' } }, async ($, on) => {
  world(on, answered)
  // As plugin.json declares them; a test cannot import the manifest.
  const fields = {
    max_words: { title: 'Handoff length (words)' },
    auto_every: { title: 'Update every (turns)', min: 1, max: 50 },
    compact_at: { title: 'Hand off at (%)', min: 50, max: 95 },
    compact_at_tokens: { title: 'Hand off at (tokens)', min: 50_000, max: 1_000_000 },
  }
  const row = (field: keyof typeof fields, value: number) => ({ key: `mod-wrap-up.${field}`, label: fields[field].title, value, kind: 'number', description: 'd' })
  on('config.list', () => ({ value: [row('max_words', 400), row('auto_every', 1), row('compact_at', 65), row('compact_at_tokens', 400_000)] }) as never)
  const pane = await $.ui.mount({ plugin: 'mod-wrap-up', surface: 'terminal', component: 'Pane', requestId: 'wrap-up', props: { scroll: { offset: 0, bodyRows: 40 }, bodyColumns: 80 } } as never)
  for (const shown of ['Handoff length', '400 words', 'Update every', '1 turn', 'Hand off at', '65%', '400K tokens']) expect(await pane.find({ type: 'Text', text: shown })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'Handoff length (words)' })).toBeUndefined()
  await pane.unmount()

  // The step comes from the range plugin.json declares, about twenty clicks end to end, and stays inside it.
  expect([stepOf(fields.max_words), stepOf(fields.auto_every), stepOf(fields.compact_at), stepOf(fields.compact_at_tokens), stepOf()]).toEqual([1, 2, 2, 50_000, 1])
  expect([stepNumber(400_000, 1, fields.compact_at_tokens), stepNumber(50_000, -1, fields.compact_at_tokens), stepNumber(1_000_000, 1, fields.compact_at_tokens)]).toEqual([450_000, 50_000, 1_000_000])
  expect([stepNumber(400, 1, fields.max_words), stepNumber(400, -1, fields.max_words), stepNumber(3, -1)]).toEqual([401, 399, 2])
  expect([showNumber(2_000_000, 'tokens'), showNumber(1, 'minutes'), showNumber(12_345, 'tokens'), showNumber(5, '')]).toEqual(['2M tokens', '1 minute', '12345 tokens', '5'])
})

test('the pill offers Auto with an off switch, its tip says what is set now, and a click turns auto compact on', { options: { icons: 'safe', auto_handoff: true } }, async ($, on) => {
  world(on, answered)
  const saved: unknown[] = []
  on('config.set', (_$: unknown, e: { key: string; value: unknown }) => {
    saved.push([e.key, e.value])
    return { value: e.value }
  })
  const band = await $.ui.mount(BAND())
  await band.pointer({ type: 'move', x: 1, y: 0, in: 'wrap-up-entry' } as never)
  expect(JSON.stringify(await band.drawn({ in: 'wrap-up-entry' }))).toContain(' Auto ')
  expect(await label(band, 'wrap-up-entry')).not.toContain(THEME.lifted)
  await band.pointer({ type: 'move', x: 31, y: 0, in: 'wrap-up-entry' } as never)
  expect(await band.find({ type: 'Text', text: ' off, click to hand off between turns at 400K tokens or 65%' })).toBeDefined()
  await band.pointer({ type: 'down', x: 31, y: 0, button: 'left', in: 'wrap-up-entry' } as never)
  expect(saved).toEqual([['mod-wrap-up.auto_compact', true]])
  await band.unmount()
})

test('with auto compact on, the switch shows on and its tip names the marks it compacts at', { options: { icons: 'safe', auto_handoff: true, auto_compact: true, compact_at: 70, compact_at_tokens: 300_000 } }, async ($, on) => {
  world(on, answered)
  const band = await $.ui.mount(BAND())
  await band.pointer({ type: 'move', x: 1, y: 0, in: 'wrap-up-entry' } as never)
  expect(JSON.stringify(await band.drawn({ in: 'wrap-up-entry' }))).toContain(' Auto ')
  expect(await label(band, 'wrap-up-entry')).toContain(THEME.lifted)
  await band.pointer({ type: 'move', x: 31, y: 0, in: 'wrap-up-entry' } as never)
  expect(await band.find({ type: 'Text', text: ' on, counts down 5 s then clears with the handoff at 300K tokens or 70%, click to turn off' })).toBeDefined()
  await band.unmount()
})

test('a hovered pill part and card control show their tip in the tip row, and clear on leave', { options: { icons: 'safe' } }, async ($, on) => {
  world(on, answered)
  const band = await $.ui.mount(BAND())
  // The idle head does nothing when clicked, so its tip says what the pill offers.
  await band.pointer({ type: 'move', x: 1, y: 0, in: 'wrap-up-entry' } as never)
  expect(await band.find({ type: 'Text', text: ' offers to hand off to a fresh session, or compact this one' })).toBeDefined()
  await band.pointer({ type: 'move', x: OPTION_X.safe.compact, y: 0, in: 'wrap-up-entry' } as never)
  expect(await band.find({ type: 'Text', text: ' opens the pick card to fill a /compact' })).toBeDefined()
  await band.pointer({ type: 'leave', x: 0, y: 0, in: 'wrap-up-entry' } as never)
  expect(await band.find({ type: 'Text', text: ' opens the pick card to fill a /compact' })).toBeUndefined()
  await click(band, 'wrap-up-entry')
  await choose(band, 'handoff')
  await band.pointer({ type: 'move', x: 1, y: 0, in: 'wrap-up-go' } as never)
  expect(await band.find({ type: 'Text', text: ' writes the handoff and starts a fresh session' })).toBeDefined()
  await band.pointer({ type: 'leave', x: 0, y: 0, in: 'wrap-up-go' } as never)
  expect(await band.find({ type: 'Text', text: ' writes the handoff and starts a fresh session' })).toBeUndefined()
  await band.unmount()
})

test('the settings pane footer shows the tip of the hovered tab', { options: { icons: 'safe' } }, async ($, on) => {
  world(on, answered)
  on('config.list', () => ({ value: [] }))
  const pane: Awaited<ReturnType<typeof $.ui.mount>> & Pick<Band, 'pointer'> = await $.ui.mount({ plugin: 'mod-wrap-up', surface: 'terminal', component: 'Pane', requestId: 'wrap-up', props: { scroll: { offset: 0, bodyRows: 20 }, bodyColumns: 80 } } as never) as never
  await pane.pointer({ in: 'mod-wrap-up-settings-tab', type: 'move', x: 1, y: 0 } as never)
  expect(await pane.find({ type: 'Text', text: " · shows this mod's settings" })).toBeDefined()
  await pane.pointer({ in: 'mod-wrap-up-settings-tab', type: 'leave', x: 0, y: 0 } as never)
  expect(await pane.find({ type: 'Text', text: " · shows this mod's settings" })).toBeUndefined()
  await pane.unmount()
})

test('the open wrap-up pill draws its options in a track after the head, one rail between neighbours, and a click lands on the option drawn there', () => {
  const posted: any[] = []
  let pointer: (event: any) => void = () => {}
  const surface: any = {
    elements: { Box: (props: any) => props, Text: (props: any) => props },
    state: undefined,
    setState: (state: any) => (surface.state = state),
    every: () => () => {},
    onPointer: (handler: (event: any) => void) => (pointer = handler),
    post: (message: any) => posted.push(message),
  }
  const tip = { glyph: '', label: '', text: '' }
  const props = { id: 'wrap', label: 'Wrap up', options: [{ id: 'handoff', label: 'Handoff' }, { id: 'compact', label: 'Compact' }], mode: null, bg: THEME.surface2, nerd: true, isIdle: true, tips: [tip, tip, tip] }
  const textOf = (node: any): string => {
    if (typeof node === 'string') return node
    if (Array.isArray(node)) return node.map(textOf).join('')
    if (node && typeof node === 'object') return textOf(node.props?.children ?? node.children ?? '')
    return ''
  }
  Choice(props, surface)
  pointer({ type: 'move', x: 1, y: 0 })
  const drawn = textOf(Choice(props, surface)).slice(1, -1)
  expect(drawn).toBe(' Wrap up ' + CAPS.right + ' ' + CAPS.left + ' Handoff │ Compact ')
  pointer({ type: 'down', button: 'left', x: 1 + drawn.indexOf('Compact'), y: 0 })
  expect(posted.at(-1)).toEqual({ type: 'menu-entry', id: 'compact' })
})

test('the wrap-up pill at rest runs no timer; a hover watches until the pointer leaves', () => {
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
  const tip = { glyph: '', label: '', text: '' }
  const props = { id: 'wrap', label: 'Wrap up', options: [{ id: 'go', label: 'Go' }], mode: null, bg: THEME.surface2, nerd: false, isIdle: true, tips: [tip, tip] }
  Choice(props, surface)
  expect(running.size).toBe(0)
  pointer({ type: 'move', x: 1, y: 0 })
  expect(running.size).toBe(1)
  pointer({ type: 'leave', x: 1, y: 0 })
  ;[...running].forEach(fn => fn())
  expect(running.size).toBe(0)
})

// A mock Client surface whose elements return their props, so a test can walk the drawn tree.
function choiceSurface() {
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
  const tip = { glyph: '', label: '', text: '' }
  const props = { id: 'wrap', label: 'Wrap up', options: [{ id: 'go', label: 'Go' }], mode: null, bg: THEME.surface2, nerd: false, isIdle: true, tips: [tip, tip] }
  const colorOf = (node: any, key: string): string | undefined => {
    if (!node || typeof node !== 'object') return undefined
    if (node.key === key) return node.color
    const kids = Array.isArray(node.children) ? node.children : node.children ? [node.children] : []
    for (const kid of kids) {
      const found = colorOf(kid, key)
      if (found) return found
    }
    return undefined
  }
  return { running, surface, props, send: (event: any) => pointer(event), colorOf }
}

test('an option fades out step by step after the pointer leaves it, and the ticker stops at rest', () => {
  const { running, surface, props, send, colorOf } = choiceSurface()
  Choice(props, surface)
  send({ type: 'move', x: 1, y: 0 })
  Choice(props, surface)
  send({ type: 'move', x: 12, y: 0 })
  expect(colorOf(Choice(props, surface), 'go-label')).toBe(THEME.accent)
  send({ type: 'move', x: 1, y: 0 })
  expect(running.size).toBe(2)
  ;[...running].forEach(fn => fn())
  const half = colorOf(Choice(props, surface), 'go-label')
  expect(half).not.toBe(THEME.accent)
  expect(half).not.toBe(THEME.muted)
  ;[...running].forEach(fn => fn())
  expect(colorOf(Choice(props, surface), 'go-label')).toBe(THEME.muted)
  expect(running.size).toBe(1)
})

test('with animations off the option color switches at once and no fade ticker starts', () => {
  const { running, surface, props, send, colorOf } = choiceSurface()
  const still = { ...props, still: true }
  Choice(still, surface)
  send({ type: 'move', x: 1, y: 0 })
  Choice(still, surface)
  send({ type: 'move', x: 12, y: 0 })
  expect(colorOf(Choice(still, surface), 'go-label')).toBe(THEME.accent)
  send({ type: 'move', x: 1, y: 0 })
  expect(colorOf(Choice(still, surface), 'go-label')).toBe(THEME.muted)
  expect(running.size).toBe(1)
})

test('the card is one card: Threads and Also keep are flat groups, each toggle a pill led by its mark', { options: { icons: 'safe' } }, async ($, on) => {
  const w = world(on, answered, undefined, SESSION, THREADS)
  const band = await $.ui.mount(BAND())
  await click(band, 'wrap-up-entry')
  await choose(band, 'compact')
  await w.clock.advance(10)

  const group = (await band.find({ key: 'wrap-up-threads' })) as { props: { borderStyle?: string } }
  expect(group.props.borderStyle).toBeUndefined()
  expect(((await band.find({ key: 'wrap-up-also' })) as { props: { borderStyle?: string } }).props.borderStyle).toBeUndefined()
  expect(((await band.find({ key: 'wrap-up-card' })) as { props: { borderStyle?: string } }).props.borderStyle).toBe('round')

  expect(await label(band, 'wrap-up-thread-1')).toContain('●')
  expect(await label(band, 'wrap-up-thread-1')).toContain(THEME.surface3)
  await click(band, 'wrap-up-thread-1')
  expect(await label(band, 'wrap-up-thread-1')).toContain('○')
  expect(await label(band, 'wrap-up-thread-1')).toContain(THEME.surface2)
  expect(await label(band, 'wrap-up-also-files')).toContain('●')
  await band.unmount()
})

test('with the menu hidden the open card still draws above the rest', async ($, on) => {
  world(on, answered)
  on('state.get', (_$: unknown, e: { plugin: string }) => ({ value: { value: e.plugin === 'mod-menu' ? true : undefined } }))
  await $.command.run({ command: 'mod-wrap-up', args: 'compact' } as never)
  const band = await $.ui.mount(BAND())
  expect(await band.find({ key: 'wrap-up-card' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: 'idle' })).toBeDefined()
  await band.unmount()
})

test('the settings action is local, so it stays live while Claude works', { options: { icons: 'safe' } }, async ($, on) => {
  world(on, answered)
  on('turn.start', (_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('config.list', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('state.set', () => ({ value: undefined }) as never)
  await $.command.run({ command: 'mod-wrap-up', args: 'settings' } as never)
  await $.turn.start({ turnId: 't1' } as never)
  const pane = await $.ui.mount({ plugin: 'mod-wrap-up', surface: 'terminal', component: 'Pane', requestId: 'wrap-up', props: { scroll: { offset: 0, bodyRows: 40 }, bodyColumns: 80 } } as never)
  expect(await pane.find({ type: 'Button', text: /Open the handoff card/ })).toBeDefined()
  await pane.unmount()
})

// mod-prompts / tests/chain.test.tsx, by v-amorim
// Tests the Chain tab: finding this session's mod-wrap-up chain, reading its titles, and resuming a session in a new window.
import { expect, mock, test } from 'claude-code/testing'

import { chainOf, factsOf, namesPrompt, parseProposals, resumeArgv, rowTitle, whenOf } from '../hooks/chain'
import { scanTail } from '../hooks/tail'
import { THEME } from '../hooks/theme'

declare const setTimeout: (handler: (value?: unknown) => void, ms: number) => unknown

const pointer = (ui: object, event: object) => (ui as { pointer: (event: object) => Promise<void> }).pointer(event)
const titleRow = (title: string, sessionId: string) => JSON.stringify({ type: 'custom-title', customTitle: title, sessionId })
const userRow = (cwd: string, sessionId: string) => JSON.stringify({ type: 'user', cwd, sessionId, message: { role: 'user', content: 'hi' } })

test('a transcript gives its own latest title and folder, skipping rows a resume copied from another session', () => {
  const text = [userRow('C:/old', 's1'), titleRow('jellyfin #1: first', 's1'), userRow('C:/work', 's1'), titleRow('jellyfin #2: copied', 's9'), titleRow('jellyfin #1: fix', 's1'), '{"torn'].join('\n')
  expect(factsOf(text, 's1')).toEqual({ title: 'jellyfin #1: fix', cwd: 'C:/work' })
  expect(factsOf('', 's1')).toEqual({ title: '', cwd: '' })
  // A later chunk only fills what an earlier one left empty.
  expect(factsOf(userRow('C:/else', 's1'), 's1', { title: 'kept', cwd: '' })).toEqual({ title: 'kept', cwd: 'C:/else' })
})

test('past one fs.read the title and folder come from the file\'s last chunks, across a line cut by a chunk start', async () => {
  const filler = `${JSON.stringify({ type: 'user', text: 'x'.repeat(5 * 1024 * 1024) })}\n`
  const file = new TextEncoder().encode(`${userRow('C:/work', 's1')}\n${filler}${titleRow('jellyfin #3: mock', 's1')}\n`)
  let facts = { title: '', cwd: '' }
  await scanTail(file.length, 4, async (from, length) => file.slice(from, from + length), text => {
    facts = factsOf(text, 's1', facts)
    return facts.title && facts.cwd ? true : undefined
  })
  expect(facts).toEqual({ title: 'jellyfin #3: mock', cwd: 'C:/work' })
})

test('the newest ledger listing the session names its chain; none lists it, no chain', () => {
  const old = { sessions: ['a', 's1'], updatedAt: 1 }
  const fresh = { sessions: ['a', 's1', 'b'], updatedAt: 2 }
  expect(chainOf([old, null, fresh], 's1')).toEqual(['a', 's1', 'b'])
  expect(chainOf([old], 'zz')).toEqual([])
})

test('a chain row names everything after the topic and shows the clock for today, the month and day before', () => {
  expect(rowTitle('moonlight #23: mods · pick e fold')).toBe('#23 mods · pick e fold')
  expect(rowTitle('moonlight: batch')).toBe('batch')
  expect(rowTitle('no topic here')).toBe('no topic here')
  const now = new Date(2026, 9, 30, 18, 30).getTime()
  expect(whenOf(new Date(2026, 9, 30, 9, 5).getTime(), now)).toBe('09:05')
  expect(whenOf(new Date(2026, 9, 28, 9, 5).getTime(), now)).toBe('10-28')
  expect(whenOf(0, now)).toBe('')
})

test('the window clears what a Claude child inherits before it resumes', () => {
  expect(resumeArgv('s0', 'C:/work')).toEqual(['wt.exe', '-w', 'new', '-d', 'C:/work', 'cmd', '/c', 'set CLAUDE_CODE_CHILD_SESSION=& set MSYS_NO_PATHCONV=& claude --resume s0'])
})

const CONFIG = 'C:/Users/me/.claude'
// The engine hands paths to these fakes with backslashes.
const slashed = (path: string) => path.split('\\').join('/')
function chainWorld(on: any, ledger: object | null) {
  const opened: string[] = []
  const runs: string[][] = []
  const transcripts: Record<string, string> = {
    [`${CONFIG}/projects/p/s0.jsonl`]: [userRow('C:/work/old', 's0'), titleRow('jellyfin #1: fix', 's0')].join('\n'),
    [`${CONFIG}/projects/p/s1.jsonl`]: [userRow('C:/work', 's1'), titleRow('jellyfin #2: tema', 's1')].join('\n'),
  }
  on('store.get', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: 'C:/work' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 0, mtimeMs: 0, isLink: false } }))
  on('fs.exists', (_$: unknown, e: { path: string }) => ({ value: slashed(e.path) in transcripts }))
  on('fs.list', (_$: unknown, e: { path: string }) => ({
    value: slashed(e.path).endsWith('/chains') && ledger ? [{ name: 'c1.json', kind: 'file', size: 1, mtimeMs: 0, isLink: false }] : slashed(e.path).endsWith('/projects') ? [{ name: 'p', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] : [],
  }))
  on('fs.read', (_$: unknown, e: { path: string }) => ({ value: slashed(e.path).endsWith('/c1.json') ? JSON.stringify(ledger) : (transcripts[slashed(e.path)] ?? '') }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', (_$: unknown, e: { id: string }) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('process.run', (_$: unknown, e: { argv: string[] }) => {
    runs.push(e.argv)
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  const asked: string[] = []
  const renames: string[] = []
  on('model.complete', (_$: unknown, e: { model: string; prompt: string }) => {
    asked.push(e.model)
    return { value: { isAnswered: true, text: JSON.stringify({ topic: 'mods', works: ['tema modern', 'tv layout'] }) } }
  })
  on('command.run', (_$: unknown, e: { command: string; args?: string }) => {
    if (e.command === 'rename') renames.push(e.args ?? '')
    return { text: '' }
  })
  mock.env(on, { USERPROFILE: 'C:\\Users\\me' })
  mock.clock(on)
  return { opened, runs, asked, renames }
}

const pane = (requestId: string) =>
  ({ plugin: 'mod-prompts', surface: 'terminal', component: 'Pane', requestId, props: { title: 'Prompts', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} } }) as never

// The chain is read in the background; a few turns of the event loop let it land and redraw.
const settle = () => new Promise(resolve => setTimeout(resolve, 20))

test('a session in a chain gets a Chain tab that lists it oldest first and opens the earlier one in a new window', async ($, on) => {
  const { opened, runs } = chainWorld(on, { version: 1, sessions: ['s0', 's1'], updatedAt: 5 })
  const prompts = await $.ui.mount(pane('prompts'))
  await settle()
  expect(JSON.stringify(await prompts.drawn({ in: 'prompts-chain-tab' }))).toContain('2')
  await pointer(prompts, { in: 'prompts-chain-tab', type: 'down', button: 'left', x: 1, y: 0 })
  expect(opened).toEqual(['prompts-chain'])
  await prompts.unmount()

  const chain = await $.ui.mount(pane('prompts-chain'))
  await settle()
  const drawn = JSON.stringify(await chain.drawn())
  // Each row is `#hop work`, everything after the topic; the topic titles the box, with the count as its hint.
  const current = JSON.stringify(await chain.drawn({ in: 'chain-stop-s1' }))
  const earlier = JSON.stringify(await chain.drawn({ in: 'chain-stop-s0' }))
  expect(current).toContain('#2 tema')
  expect(earlier).toContain('#1 fix')
  expect(drawn.indexOf('chain-stop-s0')).toBeLessThan(drawn.indexOf('chain-stop-s1'))
  expect(drawn).toContain('"children":["jellyfin"]')
  expect(drawn).toContain('2 sessions')
  expect(drawn).not.toContain('newest first')
  expect(await chain.find({ type: 'Text', text: /^this session$/ })).toBeUndefined()
  // The current session is bold primary-70 with no fill; the rest are muted and not bold.
  expect(current).toContain(`"color":"${THEME.ok}","bold":true`)
  expect(current).not.toContain(THEME.surface3)
  expect(earlier).toContain(`"color":"${THEME.muted}"`)
  expect(earlier).not.toContain('"bold":true')
  expect(earlier).not.toContain(THEME.onSurface)
  // The ↗ chip is hidden until the pointer is on the row.
  expect(drawn).toContain('"key":"chain-open-s0-reveal","position":"absolute","top":0,"right":0,"display":"none"},"hover":{"scope":"chain-row-s0","display":"flex"}')
  expect(drawn).toContain(' ↗ Open ')
  // Only the earlier session has an Open button.
  expect(drawn).not.toContain('chain-open-s1')
  await chain.press({ key: 'chain-open-s0' })
  expect(runs).toContainEqual(resumeArgv('s0', 'C:/work/old'))
  expect(await chain.find({ type: 'Text', text: /Opened jellyfin #1: fix in a new window/ })).toBeDefined()
  await chain.unmount()
})

test('off a chain the Chain tab shows this session\'s name and renames it to a name Haiku proposed', async ($, on) => {
  const { asked, renames } = chainWorld(on, null)
  const prompts = await $.ui.mount(pane('prompts'))
  await settle()
  expect(JSON.stringify(await prompts.drawn())).toContain('prompts-chain-tab')
  await prompts.unmount()

  const chain = await $.ui.mount(pane('prompts-chain'))
  await settle()
  expect(await chain.find({ type: 'Text', text: 'Not part of a handoff chain yet.' })).toBeDefined()
  expect(JSON.stringify(await chain.drawn())).toContain('jellyfin #2: tema')
  expect(asked).toEqual(['haiku'])
  expect(await chain.find({ type: 'Button', text: ' jellyfin #1: tema modern ' })).toBeDefined()
  await chain.press({ key: 'chain-name-1' })
  expect(renames).toEqual(['jellyfin #1: tv layout'])
  expect(await chain.find({ type: 'Text', text: /Renamed to jellyfin #1: tv layout/ })).toBeDefined()
  // Other names asks Haiku again.
  await chain.press({ key: 'chain-more-names' })
  await settle()
  expect(asked).toEqual(['haiku', 'haiku'])
  await chain.unmount()
})

test('proposals become `topic #1: work` titles, cut to fit, without colons or hashes in the topic, at most three and none twice', () => {
  const reply = JSON.stringify({ topic: 'mod:wrap#up', works: ['a work name far too long', 'a work name far too long', '', 'b', 'c', 'd'] })
  expect(parseProposals(reply)).toEqual(['mod wrap up #1: a work name far', 'mod wrap up #1: b', 'mod wrap up #1: c'])
  expect(parseProposals('not json')).toEqual([])
  // A topic the current name carries wins, and a name with no hop comes first with #1 added.
  expect(parseProposals(reply, 'wrap-up: chain topics')).toEqual(['wrap-up #1: chain topics', 'wrap-up #1: a work name far', 'wrap-up #1: b'])
  expect(parseProposals(JSON.stringify({ topic: 'x', works: ['tabs'] }), 'wrap-up #1: tabs')).toEqual([])
  expect(parseProposals('', 'wrap-up: chain topics')).toEqual(['wrap-up #1: chain topics'])
  // Haiku sees the folder and the current name, and the newest prompts fit the budget; older ones drop first.
  const prompt = namesPrompt(['old prompt', 'new prompt'], { title: 'wrap-up: chain topics', folder: '.claude/mods' }, 12)
  expect(prompt).toContain('working folder: .claude/mods')
  expect(prompt).toContain('current name: wrap-up: chain topics')
  expect(prompt).toContain('- new prompt')
  expect(prompt).not.toContain('old prompt')
  expect(prompt).not.toContain('jellyfin')
})

test('session names are asked for in English even when the prompts are in another language', () => {
  const prompt = namesPrompt(['corrige o login'], { title: '', folder: '' })
  expect(prompt).toContain('Write both in English, even when the prompts are in another language.')
  expect(prompt).not.toContain('in the language the user writes in')
})

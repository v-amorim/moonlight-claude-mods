// mod-collision-guard / tests/collision-guard.test.tsx, by v-amorim
// Tests conflict detection across sessions, the time window, the hold card and its answers, and clearing edits.
import { expect, mock, test } from 'claude-code/testing'

import { cleanReason, findConflict, shortPath, splitPath, titleOf, vscodeHref } from '../hooks/guard'

const PLUGIN = 'mod-collision-guard'
const NOW = 1_800_000_000_000
const MIN = 60000
const DIR = '/h/.claude/mods-data/mod-collision-guard/sessions'
const FILE = '/work/app.ts'
const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 24, bodyColumns: 80, scroll: { offset: 0, bodyRows: 12 }, view: {} } } as const
const REASON = 'guard-reason'

declare const setTimeout: (run: (value?: unknown) => void, ms: number) => unknown
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// The engine rewrites paths in the host's style, so compare on a neutral form.
const neutral = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

const edit = (session: string, minutesAgo: number, path = FILE, prompt?: number) => JSON.stringify([{ path, session, at: NOW - minutesAgo * MIN, ...(prompt === undefined ? {} : { prompt }) }])

type Setup = { cwd?: string; configDir?: string; throws?: boolean; surfaces?: string[]; answer?: string; sizes?: Record<string, number> }

// An in-memory disk, the session id, the clock, a waiter that counts its waits, and a bottom tool.call that runs edits.
function world(on: any, given: Record<string, string>, setup: Setup = {}) {
  // Each test writes to its own disk, so a shared fixture never carries one test's records into the next.
  const files = { ...given }
  const asked: { question: string; options: string[] }[] = []
  const ran: string[] = []
  const mtimes: Record<string, number> = {}
  const listed: string[] = []
  const writes: string[] = []
  const seen = { pauses: 0 }
  on('fs.read', (_$: unknown, e: { path: string }) => {
    const path = neutral(e.path)
    if (path.endsWith('/showcase.json')) return { value: JSON.stringify({ actions: [{ label: "Forget this session's recorded edits", command: 'mod-collision-guard', args: 'clear' }] }) }
    if (!(path in files)) throw new Error('ENOENT')
    return { value: files[path]! }
  })
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    writes.push(neutral(e.path))
    files[neutral(e.path)] = e.text
    return { value: undefined }
  })
  on('fs.list', (_$: unknown, e: { path: string }) => {
    const dir = neutral(e.path).replace(/\/$/, '')
    listed.push(dir)
    const kinds = new Map<string, string>()
    for (const path of Object.keys(files).filter(each => each.startsWith(`${dir}/`))) {
      const [first, ...rest] = path.slice(dir.length + 1).split('/')
      kinds.set(first!, rest.length ? 'dir' : 'file')
    }
    // A folder holding no file does not exist yet, as on a clean profile.
    if (kinds.size === 0) throw new Error('ENOENT')
    return { value: [...kinds].map(([name, kind]) => ({ name, kind, size: 0, mtimeMs: mtimes[`${dir}/${name}`] ?? 0, isLink: false })) }
  })
  on('fs.stat', (_$: unknown, e: { path: string }) => {
    const path = neutral(e.path)
    if (!(path in files)) throw new Error('ENOENT')
    return { value: { kind: 'file', size: setup.sizes?.[path] ?? files[path]!.length, mtimeMs: 0, isLink: false } }
  })
  // /work is a git repo; /scratch is not.
  on('fs.exists', (_$: unknown, e: { path: string }) => ({ value: neutral(e.path) === '/work/.git' }))
  on('env.get', (_$: unknown, e: { name: string }) => {
    if (setup.throws) throw new Error('env is gone')
    return { value: e.name === 'USERPROFILE' ? '/h' : e.name === 'CLAUDE_CONFIG_DIR' ? setup.configDir : undefined }
  })
  on('session.id', () => ({ value: 'mine' }))
  on('session.cwd', () => ({ value: setup.cwd ?? '/work' }))
  on('session.turns', () => ({ value: 7 }))
  on('session.surfaces', () => ({ value: setup.surfaces ?? ['terminal'] }))
  on('process.run', async () => {
    seen.pauses++
    await sleep(5)
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  const clock = mock.clock(on, { now: NOW })
  on('tool.call', (_$: unknown, e: any) => {
    if (e.tool === 'AskUserQuestion') {
      const [q] = e.questions
      asked.push({ question: q.question, options: q.options.map((o: { label: string }) => o.label) })
      return { result: { answers: { [q.question]: setup.answer ?? 'Proceed' } } }
    }
    ran.push(`${e.tool} ${e.file_path ?? e.notebook_path}`)
    return { result: { text: 'ok' } }
  })
  return { files, asked, ran, clock, mtimes, listed, writes, seen }
}

const call = ($: any, tool = 'Edit', path = FILE) => $.tool.call(tool === 'NotebookEdit' ? { tool, notebook_path: path, new_source: 'x' } : { tool, file_path: path, old_string: 'a', new_string: 'b', content: 'b' })

const denied = (result: any) => String(result?.deny ?? result?.text ?? JSON.stringify(result))

// The hold is live once its first wait for an answer has started.
const holding = async (w: { seen: { pauses: number } }) => {
  for (let tries = 0; tries < 300 && w.seen.pauses === 0; tries++) await sleep(10)
  expect(w.seen.pauses).toBeGreaterThan(0)
}

const click = (band: any, key: string) => band.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: key })
const textOf = async (band: any, pattern: RegExp) => (await band.find({ type: 'Text', text: pattern }))?.text as string | undefined

// Holds an edit on a collision and hands over the band with the card on it; the test answers the hold.
async function held($: any, on: any, files: Record<string, string>, setup: Setup = {}, path = FILE, band: typeof BAND = BAND) {
  const w = world(on, files, setup)
  on('ui.render', ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text key="base">base</Text>
  })
  const pending = call($, 'Edit', path)
  await holding(w)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...band })
  return { w, pending, ui }
}

const OTHER = { [`${DIR}/other.json`]: edit('other', 4, FILE, 12) }

test('no conflict passes through, asks nothing, and records the edit with its prompt number', async ($, on) => {
  const w = world(on, {})
  await call($)
  expect(w.asked).toEqual([])
  expect(w.seen.pauses).toBe(0)
  expect(w.ran).toEqual([`Edit ${FILE}`])
  expect(JSON.parse(w.files[`${DIR}/mine.json`]!)[0]).toMatchObject({ path: FILE, session: 'mine', at: NOW, prompt: 7 })
})

test('own-session edits never trigger', async ($, on) => {
  const w = world(on, { [`${DIR}/mine.json`]: edit('mine', 1) })
  await call($)
  await call($, 'Write')
  expect(w.seen.pauses).toBe(0)
  expect(w.ran).toHaveLength(2)
})

test('another session editing a different file does not trigger', async ($, on) => {
  const w = world(on, { [`${DIR}/other.json`]: edit('other', 1, '/work/other.ts') })
  await call($)
  expect(w.seen.pauses).toBe(0)
})

for (const mode of ['nerd', 'safe'] as const) {
  test(`the card draws the title, who edited, the file link and the actions in order (${mode})`, { options: { icons: mode } }, async ($, on) => {
    const { pending, ui } = await held($, on, { ...OTHER, [`${DIR}/third.json`]: edit('third', 9), [`${DIR}/fourth.json`]: edit('fourth', 6) })
    expect(await textOf(ui, /^Paused$/)).toBeDefined()
    expect(await textOf(ui, /^ collision guard$/)).toBeDefined()
    expect(await textOf(ui, /^Another open session edited this file:$/)).toBeDefined()
    // The newest edit names the session, here the one 4 minutes ago; the older two are counted.
    const name = (await ui.find({ type: 'Text', text: /^other$/ })) as { props: { bold?: boolean } }
    expect(name.props.bold).toBe(true)
    expect(await textOf(ui, /#12/)).toBe(mode === 'nerd' ? '#12' : ' #12 ')
    expect(await textOf(ui, /^\+2 more sessions$/)).toBeDefined()
    expect(await textOf(ui, /^4 min ago/)).toMatch(/^4 min ago · \d\d:\d\d$/)

    const tree = JSON.stringify(await ui.drawn())
    expect(tree).toContain('"href":"vscode://file/work/app.ts"')
    expect(tree).toContain('app.ts')
    // The VS Code icon and the rounded caps are Nerd only; safe pads by one cell.
    expect(tree.includes(String.fromCodePoint(0xf0a1e))).toBe(mode === 'nerd')
    expect(tree.includes(String.fromCodePoint(0xe0b6))).toBe(mode === 'nerd')
    // The path is underlined in secondary, on the pill's surface3 body.
    expect(tree).toContain('"color":"#B9C6F5","underline":true')
    expect(tree).toContain('"backgroundColor":"#252A42"')

    const at = (key: string) => tree.indexOf(key)
    expect(at('guard-cancel-pad')).toBeGreaterThan(-1)
    expect(at('guard-cancel-pad')).toBeLessThan(at('guard-worktree-pad'))
    expect(at('guard-worktree-pad')).toBeLessThan(at('guard-proceed-pad'))
    for (const digit of ['1', '2', '3']) expect(tree).toContain(`"subLead":"${digit}"`)
    expect(await ui.find({ key: 'guard-reason' })).toBeUndefined()

    await click(ui, 'guard-proceed')
    await pending
    await ui.unmount()
  })
}

test('splitPath splits relative to the session folder, at its root, outside it, and on Windows paths', () => {
  expect(splitPath('/work/src/cart.js', '/work', 60)).toEqual({ folder: 'src/', name: 'cart.js' })
  expect(splitPath('/work/cart.js', '/work/', 60)).toEqual({ folder: '', name: 'cart.js' })
  expect(splitPath('/other/lib/cart.js', '/work', 60)).toEqual({ folder: '/other/lib/', name: 'cart.js' })
  expect(splitPath('/workshop/cart.js', '/work', 60)).toEqual({ folder: '/workshop/', name: 'cart.js' })
  expect(splitPath('C:\\demo\\src\\cart.js', 'c:\\DEMO', 60)).toEqual({ folder: 'src/', name: 'cart.js' })
  expect(splitPath('C:\\x\\y\\cart.js', 'C:\\demo', 60)).toEqual({ folder: 'C:/x/y/', name: 'cart.js' })
  expect(splitPath('/work/app.ts', undefined, 60)).toEqual({ folder: '/work/', name: 'app.ts' })
  expect(splitPath('/other/a/very/long/folder/chain/app.ts', '/work', 20)).toEqual({ folder: '/other/…/', name: 'app.ts' })
})

for (const mode of ['nerd', 'safe'] as const) {
  test(`the file link shows the path relative to the session folder, folder dim and name bright (${mode})`, { options: { icons: mode } }, async ($, on) => {
    const { pending, ui } = await held($, on, { [`${DIR}/other.json`]: edit('other', 4, '/work/src/cart.js') }, {}, '/work/src/cart.js')
    const tree = JSON.stringify(await ui.drawn())
    const dim = tree.indexOf('"color":"#9BA3C4","underline":true')
    const bright = tree.indexOf('"color":"#B9C6F5","underline":true')
    expect(dim).toBeGreaterThan(-1)
    expect(dim).toBeLessThan(bright)
    expect(tree.slice(dim, bright)).toContain('src/')
    expect(tree.slice(bright)).toContain('cart.js')
    expect(tree).toContain('"href":"vscode://file/work/src/cart.js"')
    expect(tree.includes(String.fromCodePoint(0xf0a1e))).toBe(mode === 'nerd')
    await click(ui, 'guard-proceed')
    await pending
    await ui.unmount()
  })
}

test('a file at the session folder root has no dim folder run', async ($, on) => {
  const { pending, ui } = await held($, on, OTHER)
  expect(JSON.stringify(await ui.drawn())).not.toContain('"color":"#9BA3C4","underline":true')
  await click(ui, 'guard-proceed')
  await pending
  await ui.unmount()
})

test('a file outside the session folder keeps its absolute folder, dim', async ($, on) => {
  const { pending, ui } = await held($, on, { [`${DIR}/other.json`]: edit('other', 4, '/elsewhere/app.ts') }, {}, '/elsewhere/app.ts')
  const tree = JSON.stringify(await ui.drawn())
  expect(tree).toContain('"color":"#9BA3C4","underline":true')
  expect(tree).toContain('"/elsewhere/"')
  await click(ui, 'guard-proceed')
  await pending
  await ui.unmount()
})

test('one other session draws no "more sessions" line',async ($, on) => {
  const { pending, ui } = await held($, on, OTHER)
  expect(await textOf(ui, /more session/)).toBeUndefined()
  await click(ui, 'guard-proceed')
  await pending
  await ui.unmount()
})

test('a session with no prompt number on record draws no #N, and the name falls back to a short id', async ($, on) => {
  const { pending, ui } = await held($, on, { [`${DIR}/0123456789abcdef.json`]: JSON.stringify([{ path: FILE, session: '0123456789abcdef', at: NOW - 2 * MIN }]) })
  expect(await textOf(ui, /^01234567$/)).toBeDefined()
  expect(await textOf(ui, /#/)).toBeUndefined()
  await click(ui, 'guard-proceed')
  await pending
  await ui.unmount()
})

test('the other session\'s /rename title replaces its id once its transcript is read', async ($, on) => {
  const transcript = ['{"type":"custom-title","customTitle":"first name","sessionId":"other"}', '{"type":"user"}', '{"type":"custom-title","customTitle":"hook \\"guard\\"","sessionId":"other"}'].join('\n')
  const { pending, ui } = await held($, on, { ...OTHER, '/h/.claude/projects/p1/other.jsonl': transcript, '/h/.claude/projects/p1/mine.jsonl': '{}' })
  for (let tries = 0; tries < 100 && !(await textOf(ui, /^hook "guard"$/)); tries++) {
    await sleep(10)
    await ui.redraw()
  }
  expect(await textOf(ui, /^hook "guard"$/)).toBeDefined()
  expect(await textOf(ui, /^other$/)).toBeUndefined()
  await click(ui, 'guard-proceed')
  await pending
  await ui.unmount()
})

test('a transcript that is too large is never read, and the short id stays', async ($, on) => {
  const transcript = '/h/.claude/projects/p1/other.jsonl'
  const { w, pending, ui } = await held($, on, { ...OTHER, [transcript]: '{"type":"custom-title","customTitle":"big","sessionId":"other"}' }, { sizes: { [transcript]: 70_000_000 } })
  await sleep(50)
  await ui.redraw()
  expect(w.seen.pauses).toBeGreaterThan(0)
  expect(await textOf(ui, /^big$/)).toBeUndefined()
  expect(await textOf(ui, /^other$/)).toBeDefined()
  await click(ui, 'guard-proceed')
  await pending
  await ui.unmount()
})

test('outside a git repo the card offers no worktree, and Proceed is 2', async ($, on) => {
  const { pending, ui } = await held($, on, { [`${DIR}/other.json`]: edit('other', 4, '/scratch/notes.ts') }, {}, '/scratch/notes.ts')
  const tree = JSON.stringify(await ui.drawn())
  expect(tree).not.toContain('guard-worktree')
  expect(tree).toContain('"subLead":"2"')
  expect(tree).not.toContain('"subLead":"3"')
  expect(await textOf(ui, /Move to a worktree/)).toBeUndefined()
  await ui.press({ key: 'guard-proceed-hotkey' })
  await pending
  await ui.unmount()
})

test('a corrupt log file is ignored and never blocks the edit', async ($, on) => {
  const w = world(on, { [`${DIR}/other.json`]: '{ not json', [`${DIR}/mine.json`]: '][' })
  await call($)
  expect(w.ran).toEqual([`Edit ${FILE}`])
})

test('NotebookEdit and Windows spellings of the path collide too', async ($, on) => {
  const { pending, ui } = await held($, on, { [`${DIR}/other.json`]: edit('other', 2, 'C:\\Work\\Nb.ipynb') }, {}, 'c:/work/nb.ipynb')
  expect(await textOf(ui, /^Paused$/)).toBeDefined()
  await click(ui, 'guard-proceed')
  await pending
  await ui.unmount()
})

test('a git-bash /c/ path collides with the same C:/ path', async ($, on) => {
  const { pending, ui } = await held($, on, { [`${DIR}/other.json`]: edit('other', 2, 'C:/Work/app.ts') }, {}, '/c/work/app.ts')
  expect(await textOf(ui, /^Paused$/)).toBeDefined()
  await click(ui, 'guard-proceed')
  await pending
  await ui.unmount()
})

test('the call stays held until the person answers: no timeout, and the edit has not run', async ($, on) => {
  const { w, pending, ui } = await held($, on, OTHER)
  let isDone = false
  void pending.then(() => (isDone = true))
  await w.clock.advance(11 * MIN)
  await sleep(80)
  expect(isDone).toBe(false)
  expect(w.ran).toEqual([])
  await click(ui, 'guard-proceed')
  await pending
  expect(w.ran).toEqual([`Edit ${FILE}`])
  await ui.unmount()
})

test('while held the card is the only row besides the pills, and it goes when the call is answered', async ($, on) => {
  const { pending, ui } = await held($, on, OTHER)
  expect(await textOf(ui, /^base$/)).toBeUndefined()
  await click(ui, 'guard-proceed')
  await pending
  await ui.redraw()
  expect(await textOf(ui, /^Paused$/)).toBeUndefined()
  expect(await textOf(ui, /^base$/)).toBeDefined()
  await ui.unmount()
})

test('a click on Proceed runs the edit and records it', async ($, on) => {
  const { w, pending, ui } = await held($, on, OTHER)
  await click(ui, 'guard-proceed')
  await pending
  expect(w.ran).toEqual([`Edit ${FILE}`])
  expect(JSON.parse(w.files[`${DIR}/mine.json`]!)).toHaveLength(1)
  await ui.unmount()
})

test('digits answer the hold: 3 proceeds with a worktree offered', async ($, on) => {
  const { w, pending, ui } = await held($, on, OTHER)
  await ui.press({ key: 'guard-proceed-hotkey' })
  await pending
  expect(w.ran).toEqual([`Edit ${FILE}`])
  await ui.unmount()
})

test('digit 2 denies with an EnterWorktree instruction, and the edit does not run', async ($, on) => {
  const { w, pending, ui } = await held($, on, OTHER)
  await ui.press({ key: 'guard-worktree-hotkey' })
  const result = await pending
  expect(w.ran).toEqual([])
  expect(denied(result)).toMatch(/EnterWorktree/)
  expect(denied(result)).toMatch(/redo this edit there/)
  await ui.unmount()
})

test('a click on the worktree entry denies the same way', async ($, on) => {
  const { pending, ui } = await held($, on, OTHER)
  await click(ui, 'guard-worktree')
  expect(denied(await pending)).toMatch(/EnterWorktree/)
  await ui.unmount()
})

// Cancel asks why first: a click opens the field in place of the actions, and Enter on it ends the hold.
async function asking($: any, on: any) {
  const made = await held($, on, OTHER)
  await click(made.ui, 'guard-cancel')
  return made
}

test('Cancel opens the reason field in place of the actions, with its hints', async ($, on) => {
  const { w, pending, ui } = await asking($, on)
  expect(await ui.find({ key: REASON })).toBeDefined()
  expect(JSON.stringify(await ui.drawn())).toContain('Why? Enter sends, Enter alone skips')
  for (const key of ['guard-cancel', 'guard-worktree', 'guard-proceed', 'guard-cancel-hotkey', 'guard-worktree-hotkey', 'guard-proceed-hotkey']) expect(await ui.find({ key })).toBeUndefined()
  const hints = JSON.stringify(await ui.drawn())
  expect(hints).toContain('"label":"skip"')
  expect(hints).toContain('"subLead":"Enter"')
  expect(hints).toContain('"label":"back to the choices"')
  expect(hints).toContain('"subLead":"Esc"')
  // The head and the file stay above the field.
  expect(await textOf(ui, /^Another open session/)).toBeDefined()
  expect(w.ran).toEqual([])
  await ui.input({ key: REASON, text: '', kind: 'submit' })
  await pending
  await ui.unmount()
})

test('Enter alone sends today\'s plain cancel message', async ($, on) => {
  const { w, pending, ui } = await asking($, on)
  await ui.input({ key: REASON, text: '   ', kind: 'submit' })
  const result = await pending
  expect(w.ran).toEqual([])
  expect(w.files[`${DIR}/mine.json`]).toBeUndefined()
  expect(denied(result)).toBe(`The user cancelled this edit of ${FILE} because another open session is editing it. Do not retry it; ask what to do instead.`)
  await ui.unmount()
})

test('a typed reason arrives quoted on one line, with its quotes escaped', async ($, on) => {
  const { pending, ui } = await asking($, on)
  await ui.input({ key: REASON, text: 'wrong file, it is "b.ts"', kind: 'change' })
  await ui.redraw()
  expect(JSON.stringify(await ui.drawn())).toContain('"label":"send"')
  await ui.input({ key: REASON, text: 'wrong file, it is "b.ts"', kind: 'submit' })
  const result = denied(await pending)
  expect(result).toContain('and said why: "wrong file, it is \\"b.ts\\""')
  expect(result).toContain('Do not retry it')
  await ui.unmount()
})

test('a long or multi-line reason is flattened, stripped of control characters and cut at 300', async ($, on) => {
  const { pending, ui } = await asking($, on)
  await ui.input({ key: REASON, text: `first line\n\n  second\tline\u0007 ${'x'.repeat(400)}`, kind: 'submit' })
  const said = /said why: "(.*)"\. Do not/.exec(denied(await pending))![1]!
  expect(said.startsWith('first line second line xxx')).toBe(true)
  expect(said).not.toMatch(/[\n\t\u0007]/)
  expect(said.endsWith('...')).toBe(true)
  expect([...said].length).toBe(303)
  await ui.unmount()
})

test('Esc back returns to the choices and decides nothing', async ($, on) => {
  const { w, pending, ui } = await asking($, on)
  await ui.input({ key: REASON, text: 'half a thought', kind: 'change' })
  await click(ui, 'guard-reason-back')
  expect(await ui.find({ key: REASON })).toBeUndefined()
  for (const key of ['guard-cancel', 'guard-worktree', 'guard-proceed']) expect(await ui.find({ key })).toBeDefined()
  let isDone = false
  void pending.then(() => (isDone = true))
  await sleep(60)
  expect(isDone).toBe(false)
  expect(w.ran).toEqual([])
  await click(ui, 'guard-proceed')
  await pending
  expect(w.ran).toEqual([`Edit ${FILE}`])
  await ui.unmount()
})

test('digits typed in the reason field neither proceed nor cancel the hold', async ($, on) => {
  const { w, pending, ui } = await asking($, on)
  await ui.input({ key: REASON, text: '1 or 3', kind: 'change' })
  await ui.redraw()
  expect(await ui.find({ key: REASON })).toBeDefined()
  let isDone = false
  void pending.then(() => (isDone = true))
  await sleep(60)
  expect(isDone).toBe(false)
  expect(w.ran).toEqual([])
  await ui.input({ key: REASON, text: '1 or 3', kind: 'submit' })
  expect(denied(await pending)).toContain('said why: "1 or 3"')
  await ui.unmount()
})

test('Cancel with the send button of the field also ends the hold with the draft', async ($, on) => {
  const { pending, ui } = await asking($, on)
  await ui.input({ key: REASON, text: 'later', kind: 'change' })
  await ui.redraw()
  await click(ui, 'guard-reason-send')
  expect(denied(await pending)).toContain('said why: "later"')
  await ui.unmount()
})

test('after Proceed, later edits of that file run without a hold', async ($, on) => {
  const { w, pending, ui } = await held($, on, OTHER)
  await click(ui, 'guard-proceed')
  await pending
  const { pauses } = w.seen
  w.clock.advance(5 * MIN)
  await call($, 'Write')
  expect(w.seen.pauses).toBe(pauses)
  expect(w.ran).toHaveLength(2)
  await ui.unmount()
})

test('after Proceed, a newer edit by the other session holds again', async ($, on) => {
  const { w, pending, ui } = await held($, on, OTHER)
  await click(ui, 'guard-proceed')
  await pending
  w.files[`${DIR}/other.json`] = JSON.stringify([{ path: FILE, session: 'other', at: NOW + MIN }])
  w.clock.advance(2 * MIN)
  const again = call($)
  const before = w.seen.pauses
  for (let tries = 0; tries < 300 && w.seen.pauses === before; tries++) await sleep(10)
  expect(w.seen.pauses).toBeGreaterThan(before)
  await ui.redraw()
  expect(await textOf(ui, /^Paused$/)).toBeDefined()
  await click(ui, 'guard-proceed')
  await again
  await ui.unmount()
})

test('a -p run has nobody to ask, so a collision lets the edit through', async ($, on) => {
  const w = world(on, OTHER, { surfaces: [] })
  on('session.start', () => ({ cwd: '/w' }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.panes', () => ({ value: [] }) as never)
  await $.session.start({ cwd: '/w', surface: null, isInteractive: false } as never)
  await call($)
  expect(w.seen.pauses).toBe(0)
  expect(w.asked).toEqual([])
  expect(w.ran).toEqual([`Edit ${FILE}`])
})

test('with no surface that draws the band, the same choices ask in the host dialog', { options: { icons: 'safe' } }, async ($, on) => {
  const w = world(on, OTHER, { surfaces: ['vscode'], answer: 'Cancel' })
  const result = await call($)
  expect(w.seen.pauses).toBe(0)
  expect(w.asked).toHaveLength(1)
  expect(w.asked[0]!.options).toEqual(['Proceed', 'Move to a worktree', 'Cancel'])
  expect(w.ran).toEqual([])
  expect(denied(result)).toMatch(/cancelled/)
})

test('a session file not written inside the window is never read', async ($, on) => {
  const w = world(on, { [`${DIR}/other.json`]: edit('other', 4) })
  w.mtimes[`${DIR}/other.json`] = NOW - 40 * MIN
  await call($)
  expect(w.seen.pauses).toBe(0)
})

test('a failed check draws the same card with only Cancel and Proceed, and Cancel refuses it', async ($, on) => {
  const { w, pending, ui } = await held($, on, {}, { throws: true })
  expect(await textOf(ui, /^Paused$/)).toBeDefined()
  expect(await textOf(ui, /^Could not check other sessions, so this edit waits for you\.$/)).toBeDefined()
  expect(await textOf(ui, /^Another open session/)).toBeUndefined()
  const tree = JSON.stringify(await ui.drawn())
  expect(tree).toContain('"href":"vscode://file/work/app.ts"')
  expect(tree).not.toContain('guard-worktree')
  expect(tree).toContain('"subLead":"1"')
  expect(tree).toContain('"subLead":"2"')
  expect(tree).not.toContain('"subLead":"3"')
  expect(tree.indexOf('guard-cancel-pad')).toBeLessThan(tree.indexOf('guard-proceed-pad'))
  await click(ui, 'guard-cancel')
  await ui.input({ key: REASON, text: '', kind: 'submit' })
  const result = await pending
  expect(w.ran).toEqual([])
  expect(denied(result)).toMatch(/could not check \/work\/app\.ts/)
  expect(denied(result)).toMatch(/did not run/)
  await ui.unmount()
})

test('after a failed check, Proceed runs the edit', async ($, on) => {
  const { w, pending, ui } = await held($, on, {}, { throws: true })
  await ui.press({ key: 'guard-proceed-hotkey' })
  await pending
  expect(w.ran).toEqual([`Edit ${FILE}`])
  await ui.unmount()
})

test('a failed check with nobody to ask refuses the edit', async ($, on) => {
  const w = world(on, {}, { throws: true, surfaces: ['vscode'], answer: 'Cancel' })
  const result = await call($)
  expect(w.ran).toEqual([])
  expect(denied(result)).toMatch(/did not run/)
})

test('the session log lives under CLAUDE_CONFIG_DIR when it is set', async ($, on) => {
  const dir = '/cfg/mods-data/mod-collision-guard/sessions'
  const { w, pending, ui } = await held($, on, { [`${dir}/other.json`]: edit('other', 4) }, { configDir: '/cfg/' })
  await click(ui, 'guard-proceed')
  await pending
  expect(JSON.parse(w.files[`${dir}/mine.json`]!)[0]).toMatchObject({ path: FILE, session: 'mine' })
  expect(w.files[`${DIR}/mine.json`]).toBeUndefined()
  await ui.unmount()
})

test('old entries are ignored', async ($, on) => {
  const w = world(on, { [`${DIR}/other.json`]: edit('other', 31) })
  await call($)
  expect(w.seen.pauses).toBe(0)
  expect(w.ran).toHaveLength(1)
})

test('window_minutes widens the window', { options: { window_minutes: 60 } }, async ($, on) => {
  const { pending, ui } = await held($, on, { [`${DIR}/other.json`]: edit('other', 45) })
  expect(await textOf(ui, /^Paused$/)).toBeDefined()
  await click(ui, 'guard-proceed')
  await pending
  await ui.unmount()
})

test('enabled=false never holds but still records', { options: { enabled: false } }, async ($, on) => {
  const w = world(on, { [`${DIR}/other.json`]: edit('other', 1) })
  await call($)
  expect(w.seen.pauses).toBe(0)
  expect(JSON.parse(w.files[`${DIR}/mine.json`]!)).toHaveLength(1)
})

test('recording prunes own entries older than the window', async ($, on) => {
  const w = world(on, { [`${DIR}/mine.json`]: edit('mine', 90, '/work/old.ts') })
  await call($)
  expect(JSON.parse(w.files[`${DIR}/mine.json`]!).map((item: { path: string }) => item.path)).toEqual([FILE])
})

test('session.end empties the session log, and clear does the same on request', async ($, on) => {
  const w = world(on, {})
  on('command.register', () => ({ value: undefined }) as never)
  on('session.end', () => ({ sessionId: 'mine' }))
  await call($)
  expect(JSON.parse(w.files[`${DIR}/mine.json`]!)).toHaveLength(1)
  await $.session.end({ sessionId: 'mine' } as never)
  expect(w.files[`${DIR}/mine.json`]).toBe('[]')

  await call($)
  await $.command.run({ command: 'mod-collision-guard', args: 'clear' } as never)
  expect(w.files[`${DIR}/mine.json`]).toBe('[]')
})

test('the status reply says it is watching, and not when the guard is off', async ($, on) => {
  world(on, {})
  on('command.register', () => ({ value: undefined }) as never)
  const reply = JSON.stringify(await $.command.run({ command: 'mod-collision-guard', args: '' } as never))
  expect(reply).toContain('Watching for edits from other sessions')
  expect(reply).toContain('On, 30 min window')
})

test('with the guard off the status reply does not claim to watch', { options: { enabled: false } }, async ($, on) => {
  world(on, {})
  const reply = JSON.stringify(await $.command.run({ command: 'mod-collision-guard', args: '' } as never))
  expect(reply).not.toContain('Watching')
  expect(reply).toContain('Off, 30 min window')
})

test('on a clean profile the sessions folder is missing: the check finds nothing, the edit runs, and the first record writes into the folder', async ($, on) => {
  const w = world(on, {})
  await call($)
  expect(w.listed).toEqual([DIR])
  expect(w.seen.pauses).toBe(0)
  expect(w.ran).toEqual([`Edit ${FILE}`])
  expect(w.writes).toEqual([`${DIR}/mine.json`])
})

test('findConflict counts the other sessions that edited the file too, and the log keeps the prompt number', async () => {
  const files: Record<string, string> = {
    [`${DIR}/a.json`]: edit('a', 5, FILE, 3),
    [`${DIR}/b.json`]: edit('b', 2, FILE, 12),
    [`${DIR}/c.json`]: edit('c', 8, '/work/else.ts'),
    [`${DIR}/mine.json`]: edit('mine', 1),
  }
  const io = {
    read: async (path: string) => files[path.replace(`${DIR}/`, `${DIR}/`)] ?? '',
    write: async () => undefined,
    list: async () => Object.keys(files).map(path => ({ name: path.slice(DIR.length + 1), kind: 'file', mtimeMs: 0 })),
  }
  const found = await findConflict(io, DIR, 'mine', FILE, NOW, 30 * MIN)
  expect(found).toMatchObject({ session: 'b', prompt: 12, more: 1 })
})

test('reason, link and title helpers', () => {
  expect(cleanReason('  a "b"\n c ')).toBe('a \\"b\\" c')
  expect([...cleanReason('x'.repeat(500))]).toHaveLength(303)
  expect(vscodeHref('C:\\Users\\me\\a b#1.ts')).toBe('vscode://file/C:/Users/me/a%20b%231.ts')
  expect(vscodeHref('/work/app.ts')).toBe('vscode://file/work/app.ts')
  expect(vscodeHref('/c/work/app.ts')).toBe('vscode://file/c:/work/app.ts')
  expect(shortPath('/work/app.ts', 40)).toBe('/work/app.ts')
  expect(shortPath('/work/a/very/long/folder/chain/app.ts', 20)).toBe('/work/…/app.ts')
  expect(titleOf('{"type":"custom-title","customTitle":"one"}\n{"type":"custom-title","customTitle":"two"}')).toBe('two')
  expect(titleOf('{"type":"user"}')).toBeUndefined()
})

const paneOf = async ($: any, on: any) => {
  world(on, {})
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('config.list', () => ({
    value: [{ key: 'mod-collision-guard.enabled', label: 'Guard edits', description: 'd', kind: 'boolean', value: true, isLocked: false }],
  }))
  on('ui.render', ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })
  await $.command.run({ command: 'mod-collision-guard', args: 'settings' })

  return $.ui.mount({
    plugin: 'mod-collision-guard',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'collision-guard',
    props: { title: 'Collision Guard', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  } as never)
}

const PILL_CAP = new RegExp(String.fromCodePoint(0xe0b6))

test('its settings pane draws the heading, a setting and the action', async ($, on) => {
  const ui = await paneOf($, on)
  expect(JSON.stringify(await ui.drawn({ in: 'mod-collision-guard-settings-tab' }))).toMatch(/Collision guard [^]*"#3B446A"[^]*·[^]* Settings/)
  expect(await ui.find({ type: 'Text', text: /^Guard edits$/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /Forget this session's recorded edits/ })).toBeDefined()
  await ui.unmount()
})

test('icons=nerd draws Nerd controls and pill headings', { options: { icons: 'nerd' } }, async ($, on) => {
  const ui = await paneOf($, on)
  // On/off is a switch track with a knob, the same in both modes.
  expect(JSON.stringify(await ui.drawn({ in: 'setting-0-flip' }))).toContain('━━')
  expect(await ui.find({ type: 'Text', text: PILL_CAP })).toBeDefined()
  await ui.unmount()
})

test('icons=safe keeps the common Unicode glyphs and plain headings', { options: { icons: 'safe' } }, async ($, on) => {
  const ui = await paneOf($, on)
  // The switch is the same in safe mode; only the rounded caps drop.
  expect(JSON.stringify(await ui.drawn({ in: 'setting-0-flip' }))).toContain('━━')
  expect(await ui.find({ type: 'Text', text: PILL_CAP })).toBeUndefined()
  await ui.unmount()
})

test('a control tip posted to the mod reaches the pane footer, and clears on leave', async ($, on) => {
  const ui = await paneOf($, on)
  expect(await ui.find({ type: 'Text', text: /Shows this view/ })).toBeUndefined()
  await ui.post({ type: 'tip', id: 'x', glyph: '>', label: 'Guard edits', text: 'Shows this view' }, { in: 'setting-0-flip' })
  expect((await ui.find({ type: 'Text', text: /Shows this view/ }))?.text).toContain('Shows this view')
  await ui.post({ type: 'tip', id: null }, { in: 'setting-0-flip' })
  expect(await ui.find({ type: 'Text', text: /Shows this view/ })).toBeUndefined()
  await ui.unmount()
})

test('a hovered card control shows its tip in the band tip row, and the tip clears on leave', async ($, on) => {
  const { pending, ui } = await held($, on, OTHER)
  await ui.post({ type: 'tip', id: 'guard-cancel', glyph: '1', label: 'Cancel', text: 'stops this edit and lets you say why' }, { in: 'guard-cancel' })
  expect(await ui.find({ type: 'Text', text: 'Cancel:' })).toBeDefined()
  await ui.post({ type: 'tip', id: null }, { in: 'guard-cancel' })
  expect(await ui.find({ type: 'Text', text: 'Cancel:' })).toBeUndefined()
  await ui.pointer({ type: 'move', x: 1, y: 0, in: 'guard-proceed' })
  expect(JSON.stringify(await ui.drawn())).toContain('lets this edit run')
  await click(ui, 'guard-proceed')
  await pending
  await ui.unmount()
})

test('a band tip whose entry was redrawn while hovered clears after 5 s with no newer hover', async ($, on) => {
  const { w, pending, ui } = await held($, on, OTHER)
  // Live, a band redraw mid-turn replaced the hovered entry, so its own quiet timer, and the leave, never came.
  await ui.pointer({ type: 'enter', x: 1, y: 0, in: 'guard-proceed' })
  await ui.unmount()
  const showsNow = async () => {
    const fresh = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
    const shown = (await textOf(fresh, /lets this edit run/)) !== undefined
    await fresh.unmount()
    return shown
  }
  expect(await showsNow()).toBe(true)
  await w.clock.advance(4000)
  expect(await showsNow()).toBe(true)
  await w.clock.advance(1000)
  expect(await showsNow()).toBe(false)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  await click(band, 'guard-proceed')
  await pending
  await band.unmount()
})

test('a pause raises one notification naming the file, and a refused one does not break the hold', async ($, on) => {
  const notes: { text: string; title?: string }[] = []
  on('ui.notify', (_$: unknown, e: { text: string; title?: string }) => {
    notes.push(e)
    throw new Error('refused')
  })
  const { w, pending, ui } = await held($, on, OTHER)
  await sleep(60)
  expect(notes).toHaveLength(1)
  expect(notes[0]!.text).toContain('app.ts')
  expect(notes[0]!.text).not.toContain('/work/')
  await click(ui, 'guard-proceed')
  await pending
  expect(notes).toHaveLength(1)
  expect(w.ran).toEqual([`Edit ${FILE}`])
  await ui.unmount()
})

type Pointer = { pointer: (event: object) => Promise<unknown> }
const pointing = <T extends object>(ui: T) => ui as T & Pointer

const bandOf = async ($: any, on: any) => {
  const { clock } = world(on, {})
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'too narrow' } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.render', ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>other mod</Text>
  })
  const ui = await $.ui.mount({
    plugin: 'mod-collision-guard',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 80, scroll: { offset: 0, bodyRows: 12 }, view: {} },
  } as never)
  return { ui, clock }
}

test('a toast draws as a band card, shows its dismiss tip, and a click removes it', async ($, on) => {
  const { ui } = await bandOf($, on)
  await $.command.run({ command: 'mod-collision-guard', args: 'settings' } as never)
  expect(await ui.find({ type: 'Text', text: /^Settings panel waiting/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'other mod' })).toBeDefined()
  await pointing(ui).pointer({ type: 'move', x: 0, y: 0, in: 'toast-collisionguard-1' })
  expect(await ui.find({ type: 'Text', text: 'Dismiss:' })).toBeDefined()
  await pointing(ui).pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'toast-collisionguard-1' })
  expect(await ui.find({ type: 'Text', text: /^Settings panel waiting/ })).toBeUndefined()
  await ui.unmount()
})

test('a toast leaves on its own after the timeout', async ($, on) => {
  const { ui, clock } = await bandOf($, on)
  await $.command.run({ command: 'mod-collision-guard', args: 'settings' } as never)
  expect(await ui.find({ type: 'Text', text: /^Settings panel waiting/ })).toBeDefined()
  await clock.advance(4000)
  expect(await ui.find({ type: 'Text', text: /^Settings panel waiting/ })).toBeUndefined()
  await ui.unmount()
})

test('animations off still draws the settings pane', { options: { animations: false } }, async ($, on) => {
  const ui = await paneOf($, on)
  expect(JSON.stringify(await ui.drawn({ in: 'mod-collision-guard-settings-tab' }))).toContain('Settings')
  await ui.unmount()
})

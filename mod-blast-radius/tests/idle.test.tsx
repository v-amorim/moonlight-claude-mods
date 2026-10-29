// mod-blast-radius / tests/idle.test.tsx, by v-amorim: idle timeout, waiting chip, stored answer
import { expect, mock, test } from 'claude-code/testing'
import { countdownOf, countdownParts } from '../hooks/countdown'
import text from '../hooks/text'
import { THEME } from '../hooks/theme'

const PLUGIN = 'mod-blast-radius'
const bandOf = (bodyColumns = 100) =>
  ({ component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 24, bodyColumns, scroll: { offset: 0, bodyRows: 6 }, view: {} } }) as const
const BAND = bandOf()
const COMMAND = 'rm -rf build'
const MINUTE = 60 * 1000
const FILES: Record<string, { kind: 'file' | 'dir'; size: number }> = {
  'C:/w/build': { kind: 'dir', size: 0 },
  'C:/w/build/a.js': { kind: 'file', size: 2048 },
  'C:/w/build/b.js': { kind: 'file', size: 1024 },
}
declare const setTimeout: (run: (value?: unknown) => void, ms: number) => unknown
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const asGiven = (path: string) => path.replace(/\\/g, '/').replace(/^.*?(?=[A-Za-z]:\/)/, '')

// Everything the engine would answer; `labels` is mod-menu's pill-label mode.
function world(on: (event: string, handler: (...args: any[]) => unknown) => void, labels?: string, verdict = 'allow') {
  const seen = { ran: 0, argv: [] as string[], sent: [] as string[] }
  const clock = mock.clock(on as never)
  on('prompt.submit', (_$: unknown, e: { text: string }) => {
    seen.sent.push(e.text)
    return { text: e.text }
  })
  on('session.cwd', () => ({ value: 'C:/w' }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('env.get', (_$: unknown, e: { name: string }) => ({ value: e.name === 'OS' ? 'Windows_NT' : e.name === 'USERPROFILE' ? 'C:\\Users\\me' : undefined }))
  on('fs.stat', (_$: unknown, e: { path: string }) => {
    const node = FILES[asGiven(e.path)]
    if (!node) throw new Error('ENOENT')
    return { value: { ...node, mtimeMs: 0, isLink: false } }
  })
  on('fs.read', () => {
    throw new Error('ENOENT')
  })
  on('fs.list', (_$: unknown, e: { path: string }) => {
    const prefix = `${asGiven(e.path).replace(/\/$/, '')}/`
    const names = Object.entries(FILES).filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
    return { value: names.map(([path, node]) => ({ name: path.slice(prefix.length), kind: node.kind, size: node.size, mtimeMs: 0, isLink: false })) }
  })
  on('process.run', async (_$: unknown, e: { argv: string[] }) => {
    seen.argv.push(e.argv.join(' '))
    if (e.argv[0] === 'git') return { value: { exitCode: 128, stdout: '', stderr: 'fatal: not a git repository' } }
    await sleep(5)
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('ui.toast', () => ({ value: {} }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: {} }))
  on('state.set', () => ({ value: { isSet: true, version: 1 } }))
  on('state.get', (_$: unknown, e: { plugin?: string; key?: string }) => ({ value: { value: e.plugin === 'mod-menu' && e.key === 'labels' ? labels : undefined } }))
  on('config.list', () => ({ value: [] }))
  on('session.end', (_$: unknown, e: { sessionId: string }) => ({ sessionId: e.sessionId }))
  on('tool.check', () => ({ decision: verdict, ...(verdict === 'ask' ? { reason: 'Claude Code asks' } : {}) }))
  on('tool.call', () => {
    seen.ran++
    return { result: { text: 'ran' } }
  })
  on('ui.render', ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text key="base">base</Text>
  })
  return { seen, clock }
}

const click = (band: any, key: string) => band.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: key })
type Drawn = { type: string; props: Record<string, any>; children?: unknown[] }
const labelNode = (node: Drawn): Drawn | undefined => {
  if (node.props?.key === 'sub-lead' || node.props?.key === 'keycap' || node.props?.key === 'badge' || node.props?.key === 'lead') return undefined
  if (node.type === 'Text') return node
  for (const child of node.children ?? []) {
    const found = child && typeof child === 'object' ? labelNode(child as Drawn) : undefined
    if (found) return found
  }
  return undefined
}
const labelOf = async (band: any, key: string): Promise<string | undefined> => labelNode(await band.drawn({ in: key }))?.children?.join('')
// Every word an entry draws, its icon first.
const words = (node: unknown): string => (typeof node === 'string' ? node : Array.isArray(node) ? node.map(words).join('') : node ? words((node as { children?: unknown }).children) : '')
const colorOfWords = (node: unknown, spoken: string): string | undefined => {
  if (!node || typeof node !== 'object') return undefined
  const found = node as Drawn
  if (found.type === 'Text' && words(found).includes(spoken)) return found.props.color
  for (const child of found.children ?? []) {
    const color = colorOfWords(child, spoken)
    if (color) return color
  }
  return undefined
}
const wordsOf = async (band: any, key: string) => words(await band.drawn({ in: key }))
const textOf = async (band: any, pattern: RegExp) => (await band.find({ type: 'Text', text: pattern }))?.text as string | undefined

const holding = async (seen: { argv: string[] }) => {
  for (let tries = 0; tries < 200 && seen.argv.length === 0; tries++) await sleep(10)
  expect(seen.argv.length).toBeGreaterThan(0)
}

// Starts a hold, lets the idle time pass, and returns the refused call's result.
async function timeOut($: any, clock: { advance: (ms: number) => Promise<void> }, seen: { argv: string[] }, command = COMMAND, minutes = 10) {
  const call = $.tool.call({ tool: 'Bash', command })
  await holding(seen)
  await clock.advance(minutes * MINUTE)
  return JSON.stringify(await call)
}

const IDLE = { options: { idle: '10 min' } }

test('with the idle timeout Off, a card waits past any time and no chip shows', { options: { idle: 'Off' } }, async ($, on) => {
  const { seen, clock } = world(on)
  let isDone = false
  const call = $.tool.call({ tool: 'Bash', command: COMMAND }).then(result => {
    isDone = true
    return result
  })
  await holding(seen)
  await clock.advance(60 * MINUTE)
  await sleep(80)
  expect(isDone).toBe(false)

  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await band.find({ key: 'blast-wait' })).toBeUndefined()
  await click(band, 'blast-run')
  await call
  await band.unmount()
  expect(seen.ran).toBe(1)
})

test('a 2 min timeout waits through 1:59 and refuses the call at 2:00', { options: { idle: '2 min' } }, async ($, on) => {
  const { seen, clock } = world(on)
  const call = $.tool.call({ tool: 'Bash', command: COMMAND })
  await holding(seen)
  await clock.advance(2 * MINUTE - 1000)
  let isDone = false
  void call.then(() => (isDone = true))
  await sleep(60)
  expect(isDone).toBe(false)
  await clock.advance(1000)
  expect(((await call) as { deny: string }).deny).toMatch(/did not answer for 2 minutes/)
  expect(seen.ran).toBe(0)
})

test('a card nobody answers for the set time refuses the call with the idle words and never runs it', IDLE, async ($, on) => {
  const { seen, clock } = world(on)
  const call = $.tool.call({ tool: 'Bash', command: COMMAND })
  await holding(seen)

  // One minute short of the limit: still waiting.
  await clock.advance(9 * MINUTE)
  await sleep(60)
  let isDone = false
  void call.then(() => (isDone = true))
  await sleep(40)
  expect(isDone).toBe(false)

  await clock.advance(MINUTE)
  const result = (await call) as { deny: string }
  expect(seen.ran).toBe(0)
  expect(result.deny).toBe(
    'Blast radius held this command and the user did not answer for 10 minutes. The command did not run. Do not rephrase it to try again: a changed command opens a new card. Carry on with any work that does not need it; if there is none, tell the user the command is waiting for them to run or cancel from the chip, and stop.',
  )
  expect(result.deny).not.toMatch(/do not retry/i)
})

test('using the card restarts the idle time', IDLE, async ($, on) => {
  const { seen, clock } = world(on)
  const call = $.tool.call({ tool: 'Bash', command: COMMAND })
  await holding(seen)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  await clock.advance(9 * MINUTE)
  await click(band, 'blast-cancel')
  await clock.advance(9 * MINUTE)
  await sleep(80)
  let isDone = false
  void call.then(() => (isDone = true))
  await sleep(40)
  expect(isDone).toBe(false)
  await band.input({ key: 'blast-reason', text: '', kind: 'submit' })
  await call
  await band.unmount()
})

for (const [icons, glyph] of [['nerd', String.fromCodePoint(0xea6c)], ['safe', '!']] as const) {
  test(`icons=${icons}: after a timeout the chip ends the pill row with the icon and Approve 1 command`, { options: { idle: '10 min', icons } }, async ($, on) => {
    const { seen, clock } = world(on)
    await timeOut($, clock, seen)
    const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })

    expect(await wordsOf(band, 'blast-wait')).toBe(` ${glyph} Approve 1 command `)
    // Alert red icon, the words in on-surface, on a surface-3 pill.
    expect(colorOfWords(await band.drawn({ in: 'blast-wait' }), 'Approve 1 command')).toBe(THEME.onSurface)
    const tree = JSON.stringify(await band.drawn({ in: 'blast-wait' }))
    expect(tree).toContain(THEME.alert)
    expect(tree).toContain(THEME.surface3)
    expect(JSON.stringify(await band.drawn())).toContain('blast-wait-pill')
    await band.unmount()
  })
}

test('the chip sits at the right end of the row, after the other pills, and is still', IDLE, async ($, on) => {
  const { seen, clock } = world(on)
  await timeOut($, clock, seen)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  const tree = JSON.stringify(await band.drawn())
  expect(tree.indexOf('blast-wait-pill')).toBeGreaterThan(tree.indexOf('base') - 1)
  expect(tree).not.toContain('"isBusy":true')
  expect(tree).not.toContain('"spinner":true')
  await band.unmount()
})

test('a second waiting command raises the count', { options: { idle: '10 min', icons: 'safe' } }, async ($, on) => {
  const { seen, clock } = world(on)
  await timeOut($, clock, seen)
  seen.argv.length = 0
  await timeOut($, clock, seen, 'rm -rf build/a.js')
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await wordsOf(band, 'blast-wait')).toBe(' ! Approve 2 commands ')
  await band.unmount()
})

test('with pill labels off the chip shows only the icon and the count', { options: { idle: '10 min', icons: 'safe' } }, async ($, on) => {
  const { seen, clock } = world(on, 'never')
  await timeOut($, clock, seen)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await wordsOf(band, 'blast-wait')).toBe(' ! 1 ')
  expect(await textOf(band, /Approve/)).toBeUndefined()
  await band.unmount()
})

test('a row too narrow for the words cuts the chip to the icon and the count', { options: { idle: '10 min', icons: 'safe' } }, async ($, on) => {
  const { seen, clock } = world(on)
  await timeOut($, clock, seen)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...bandOf(12) })
  expect(await wordsOf(band, 'blast-wait')).toBe(' ! 1 ')
  expect(await textOf(band, /Approve/)).toBeUndefined()
  await band.unmount()
})

test('hovering the chip posts its tip', IDLE, async ($, on) => {
  const { seen, clock } = world(on)
  await timeOut($, clock, seen)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  await band.pointer({ type: 'enter', x: 1, y: 0, in: 'blast-wait' })
  await band.redraw()
  expect(await textOf(band, /opens the card for rm -rf build again/)).toBeDefined()
  expect(await textOf(band, /^Approve 1 command:/)).toBeDefined()
  await band.unmount()
})

test('a click reopens the card; Run is stored and the next identical call passes with no card, then the chip is gone', IDLE, async ($, on) => {
  const { seen, clock } = world(on)
  await timeOut($, clock, seen)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })

  await click(band, 'blast-wait')
  expect(await labelOf(band, 'blast-cancel')).toBe(' Cancel ')
  expect(await labelOf(band, 'blast-details')).toBe(' Details ')
  expect(await labelOf(band, 'blast-run')).toBe(' Delete 2 files ')
  expect(seen.ran).toBe(0)

  await click(band, 'blast-run')
  await band.redraw()
  // Answered, but not used yet: the card is gone, the chip stays.
  expect(await band.find({ key: 'blast-run' })).toBeUndefined()
  expect(await band.find({ key: 'blast-wait' })).toBeDefined()

  seen.argv.length = 0
  const result = await $.tool.call({ tool: 'Bash', command: COMMAND })
  expect(JSON.stringify(result)).toContain('ran')
  expect(seen.ran).toBe(1)
  // No new hold: the call never reached the preview.
  expect(seen.argv).toEqual([])
  await band.redraw()
  expect(await band.find({ key: 'blast-wait' })).toBeUndefined()

  // The stored answer is used up: the same command held again.
  const again = $.tool.call({ tool: 'Bash', command: COMMAND })
  await holding(seen)
  await click(band, 'blast-cancel')
  await band.input({ key: 'blast-reason', text: '', kind: 'submit' })
  await again
  await band.unmount()
})

test('a stored Cancel with a reason refuses the next identical call with that reason, then the chip is gone', IDLE, async ($, on) => {
  const { seen, clock } = world(on)
  await timeOut($, clock, seen)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  await click(band, 'blast-wait')
  await click(band, 'blast-cancel')
  await band.input({ key: 'blast-reason', text: 'wrong folder', kind: 'submit' })
  await band.redraw()
  expect(await band.find({ key: 'blast-wait' })).toBeDefined()

  seen.argv.length = 0
  const result = JSON.stringify(await $.tool.call({ tool: 'Bash', command: COMMAND }))
  expect(seen.ran).toBe(0)
  expect(result).toContain('the user cancelled and said why: \\"wrong folder\\"')
  expect(result).toContain('Reason: Recursive deletion')
  expect(seen.argv).toEqual([])
  await band.redraw()
  expect(await band.find({ key: 'blast-wait' })).toBeUndefined()
  await band.unmount()
})

test('a stored answer matches the exact command text only', IDLE, async ($, on) => {
  const { seen, clock } = world(on)
  await timeOut($, clock, seen)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  await click(band, 'blast-wait')
  await click(band, 'blast-run')

  seen.argv.length = 0
  const other = $.tool.call({ tool: 'Bash', command: 'rm -rf build/a.js' })
  await holding(seen)
  expect(seen.ran).toBe(0)
  await click(band, 'blast-cancel')
  await band.input({ key: 'blast-reason', text: '', kind: 'submit' })
  await other
  expect(await band.find({ key: 'blast-wait' })).toBeDefined()
  await band.unmount()
})

test('asked again before any click, the command gets a fresh card and the chip goes', IDLE, async ($, on) => {
  const { seen, clock } = world(on)
  await timeOut($, clock, seen)
  seen.argv.length = 0
  const call = $.tool.call({ tool: 'Bash', command: COMMAND })
  await holding(seen)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await band.find({ key: 'blast-wait' })).toBeUndefined()
  expect(await labelOf(band, 'blast-run')).toBe(' Delete 2 files ')
  await click(band, 'blast-run')
  await call
  expect(seen.ran).toBe(1)
  await band.unmount()
})

// ---- an answered command: the quiet chip and the nudge ----

test('the chip counts only the unanswered commands', { options: { idle: '10 min', icons: 'safe' } }, async ($, on) => {
  const { seen, clock } = world(on)
  await timeOut($, clock, seen)
  seen.argv.length = 0
  await timeOut($, clock, seen, 'rm -rf build/a.js')
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await wordsOf(band, 'blast-wait')).toBe(' ! Approve 2 commands ')
  await click(band, 'blast-wait')
  await click(band, 'blast-run')
  await band.redraw()
  expect(await wordsOf(band, 'blast-wait')).toBe(' ! Approve 1 command ')
  await band.unmount()
})

for (const [icons, glyph] of [['nerd', String.fromCodePoint(0xeab2)], ['safe', '✓']] as const) {
  test(`icons=${icons}: once every command is answered the chip is quiet: a check, muted words, surface-3`, { options: { idle: '10 min', icons } }, async ($, on) => {
    const { seen, clock } = world(on)
    await timeOut($, clock, seen)
    const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
    await click(band, 'blast-wait')
    await click(band, 'blast-run')
    await band.unmount()
    // A fresh mount: the pointer rests nowhere, so no hover tint.
    const quiet = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
    expect(await wordsOf(quiet, 'blast-wait')).toBe(` ${glyph} Approved · waiting for Claude `)
    const tree = await quiet.drawn({ in: 'blast-wait' })
    expect(colorOfWords(tree, 'Approved')).toBe(THEME.muted)
    expect(JSON.stringify(tree)).toContain(THEME.good)
    expect(JSON.stringify(tree)).toContain(THEME.surface3)
    expect(JSON.stringify(tree)).not.toContain(THEME.alert)
    await quiet.unmount()
  })
}

test('several answered Runs read "2 approved"', { options: { idle: '10 min', icons: 'safe' } }, async ($, on) => {
  const { seen, clock } = world(on)
  await timeOut($, clock, seen)
  seen.argv.length = 0
  await timeOut($, clock, seen, 'rm -rf build/a.js')
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  await click(band, 'blast-wait')
  await click(band, 'blast-run')
  await click(band, 'blast-wait')
  await click(band, 'blast-run')
  await band.redraw()
  expect(await wordsOf(band, 'blast-wait')).toBe(' ✓ 2 approved · waiting for Claude ')
  await band.unmount()
})

test('a Cancel among the answers words the chip "answered", which stays true', { options: { idle: '10 min', icons: 'safe' } }, async ($, on) => {
  const { seen, clock } = world(on)
  await timeOut($, clock, seen)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  await click(band, 'blast-wait')
  await click(band, 'blast-cancel')
  await band.input({ key: 'blast-reason', text: '', kind: 'submit' })
  await band.redraw()
  expect(await wordsOf(band, 'blast-wait')).toBe(' ✓ Answered · waiting for Claude ')
  await click(band, 'blast-wait')
  await band.redraw()
  expect(await textOf(band, /Answered\. Claude is told when it asks for it again\./)).toBeDefined()
  await band.unmount()
})

test('a click on the quiet chip toasts and opens no card; its hover tip says the same', { options: { idle: '10 min', icons: 'safe' } }, async ($, on) => {
  const { seen, clock } = world(on)
  await timeOut($, clock, seen)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  await click(band, 'blast-wait')
  await click(band, 'blast-run')
  await band.unmount()

  const quiet = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  await quiet.pointer({ type: 'enter', x: 1, y: 0, in: 'blast-wait' })
  await quiet.redraw()
  expect(await textOf(quiet, /^Approved · waiting for Claude:/)).toBeDefined()
  expect(await textOf(quiet, /Approved\. It runs when Claude asks for it again\./)).toBeDefined()
  await quiet.pointer({ type: 'leave', x: 1, y: 0, in: 'blast-wait' })

  await click(quiet, 'blast-wait')
  await quiet.redraw()
  expect(await quiet.find({ key: 'blast-run' })).toBeUndefined()
  expect(await quiet.find({ key: 'blast-cancel' })).toBeUndefined()
  expect(await textOf(quiet, /Approved\. It runs when Claude asks for it again\./)).toBeDefined()
  await quiet.unmount()
})

const nudgeFor = (command: string) =>
  `The user approved a command blast-radius held earlier. If it is still needed, run it again exactly as written below, so the stored approval applies. If it is no longer needed, because it was done another way or superseded, say so and do not run it.\n\n\`\`\`\n${command}\n\`\`\``

test('Run on a reopened card nudges the session once, with the exact command in a code block', IDLE, async ($, on) => {
  const { seen, clock } = world(on)
  await timeOut($, clock, seen, 'rm -rf   build\n')
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(seen.sent).toEqual([])
  await click(band, 'blast-wait')
  expect(seen.sent).toEqual([])
  await click(band, 'blast-run')
  await sleep(20)
  expect(seen.sent).toEqual([nudgeFor('rm -rf   build')])
  await band.unmount()
})

test('a command longer than 80 characters reaches the nudge whole, and retried from it the stored Run applies', IDLE, async ($, on) => {
  const { seen, clock } = world(on)
  const long = `rm -rf ${'build/'.repeat(20)}cache\n`
  expect(long.trimEnd().length).toBeGreaterThan(80)
  await timeOut($, clock, seen, long)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  await click(band, 'blast-wait')
  await click(band, 'blast-run')
  await sleep(20)
  expect(seen.sent).toEqual([nudgeFor(long.trimEnd())])
  expect(seen.sent[0]).not.toMatch(/\.\.\./)
  await $.tool.call({ tool: 'Bash', command: long.trimEnd() })
  expect(seen.ran).toBe(1)
  await band.unmount()
})

test('Cancel on a reopened card sends no nudge', IDLE, async ($, on) => {
  const { seen, clock } = world(on)
  await timeOut($, clock, seen)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  await click(band, 'blast-wait')
  await click(band, 'blast-cancel')
  await band.input({ key: 'blast-reason', text: 'no', kind: 'submit' })
  await sleep(20)
  expect(seen.sent).toEqual([])
  await band.unmount()
})

test('the retry applies the stored Run at once and the chip is gone', IDLE, async ($, on) => {
  const { seen, clock } = world(on)
  await timeOut($, clock, seen)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  await click(band, 'blast-wait')
  await click(band, 'blast-run')
  await sleep(20)
  expect(seen.sent.length).toBe(1)
  expect(await band.find({ key: 'blast-wait' })).toBeDefined()
  await $.tool.call({ tool: 'Bash', command: COMMAND })
  expect(seen.ran).toBe(1)
  await band.redraw()
  expect(await band.find({ key: 'blast-wait' })).toBeUndefined()
  await band.unmount()
})

test('a chip click while another card is up toasts and changes nothing', IDLE, async ($, on) => {
  const { seen, clock } = world(on)
  await timeOut($, clock, seen)
  seen.argv.length = 0
  const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build/b.js' })
  await holding(seen)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  await click(band, 'blast-wait')
  expect(await textOf(band, new RegExp(text.waiting.busy))).toBeDefined()
  await click(band, 'blast-run')
  await call
  await band.unmount()
})

test('with the idle timeout Off, a Bash permission ask stays Claude Code\'s own prompt: no card, verdict unchanged', { options: { idle: 'Off' } }, async ($, on) => {
  const { seen } = world(on, undefined, 'ask')
  const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'npm publish' } })
  expect(verdict).toMatchObject({ decision: 'ask', reason: 'Claude Code asks' })
  const risky = await $.tool.check({ tool: 'Bash', input: { command: COMMAND } })
  expect(risky).toMatchObject({ decision: 'ask', reason: 'Claude Code asks' })
  expect(seen.argv).toEqual([])
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await band.find({ key: 'blast-run' })).toBeUndefined()
  await band.unmount()
})

// The approval lives only in memory: a file any tool can write must never vouch for a Run.
test('a Run pressed on the card writes no file', async ($, on) => {
  const { seen } = world(on)
  const writes: string[] = []
  on('fs.write', (_$: unknown, e: { path: string }) => {
    writes.push(asGiven(e.path))
    return { value: undefined }
  })
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  const ran = $.tool.call({ tool: 'Bash', command: COMMAND })
  await holding(seen)
  await click(band, 'blast-run')
  await ran
  await band.unmount()
  expect(writes).toEqual([])
})

// ---- the idle countdown on the card's top edge ----

const SECOND = 1000
const EDGE_TEXT = /Sets this aside in/
// The edge's three runs: the muted lead, the timed value, the muted clause.
const edgeOf = async (band: any) => {
  const lead = await band.find({ type: 'Text', text: EDGE_TEXT })
  const time = await band.find({ type: 'Text', text: /^(\d+ min|\d+ s)$/ })
  const tail = await band.find({ type: 'Text', text: /Claude keeps going/ })
  return { lead, time, tail }
}
const colorOf = (found: any): string | undefined => found?.props?.color ?? found?.color
// Lets the hold's poll see the clock move.
const settle = async (clock: { advance: (ms: number) => Promise<void> }, ms: number) => {
  await clock.advance(ms)
  await sleep(60)
}

test('countdown: whole minutes rounded up, then seconds, with the tone going warn at 2 min and alert in the last minute', () => {
  const total = 10 * MINUTE
  expect(countdownOf(10 * MINUTE, total)).toEqual({ time: '10 min', color: THEME.onSurface })
  expect(countdownOf(9.5 * MINUTE, total)).toEqual({ time: '10 min', color: THEME.onSurface })
  expect(countdownOf(2 * MINUTE + 1, total)).toEqual({ time: '3 min', color: THEME.onSurface })
  expect(countdownOf(2 * MINUTE, total)).toEqual({ time: '2 min', color: THEME.warn })
  expect(countdownOf(MINUTE + 59 * SECOND, total)).toEqual({ time: '2 min', color: THEME.warn })
  expect(countdownOf(MINUTE, total)).toEqual({ time: '1 min', color: THEME.warn })
  expect(countdownOf(42 * SECOND, total)).toEqual({ time: '42 s', color: THEME.alert })
  expect(countdownOf(41.2 * SECOND, total)).toEqual({ time: '42 s', color: THEME.alert })
  expect(countdownOf(-5, total)).toEqual({ time: '0 s', color: THEME.alert })
})

test('countdown: a short timeout scales its thresholds, so a 2 min one starts calm, warns at half and alerts in the last quarter', () => {
  const total = 2 * MINUTE
  expect(countdownOf(2 * MINUTE, total)).toEqual({ time: '2 min', color: THEME.onSurface })
  expect(countdownOf(61 * SECOND, total)).toEqual({ time: '2 min', color: THEME.onSurface })
  expect(countdownOf(MINUTE, total)).toEqual({ time: '1 min', color: THEME.warn })
  expect(countdownOf(30 * SECOND, total)).toEqual({ time: '30 s', color: THEME.warn })
  expect(countdownOf(29 * SECOND, total)).toEqual({ time: '29 s', color: THEME.alert })
  // 5 min and longer keep the picked 2 min and 1 min marks.
  expect(countdownOf(2 * MINUTE, 5 * MINUTE).color).toBe(THEME.warn)
  expect(countdownOf(59 * SECOND, 5 * MINUTE).color).toBe(THEME.alert)
})

test('countdown: the whole sentence when it fits, then without its clause, then nothing', () => {
  const full = 'Sets this aside in 10 min, Claude keeps going'
  const total = 10 * MINUTE
  expect(countdownParts(10 * MINUTE, full.length + 2, total)).toMatchObject({ lead: 'Sets this aside in ', time: '10 min', tail: ', Claude keeps going' })
  expect(countdownParts(10 * MINUTE, full.length + 1, total)).toMatchObject({ tail: '' })
  expect(countdownParts(10 * MINUTE, 'Sets this aside in 10 min'.length + 2, total)).toMatchObject({ tail: '' })
  expect(countdownParts(10 * MINUTE, 'Sets this aside in 10 min'.length + 1, total)).toBeNull()
})

test('countdown: the card draws it at 9:30 left as 10 min, muted words and an on-surface time', IDLE, async ($, on) => {
  const { seen, clock } = world(on)
  const call = $.tool.call({ tool: 'Bash', command: COMMAND })
  await holding(seen)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  await settle(clock, 30 * SECOND)
  await band.redraw()
  const { lead, time, tail } = await edgeOf(band)
  expect(lead.text).toBe(' Sets this aside in ')
  expect(time.text).toBe('10 min')
  expect(tail.text).toBe(', Claude keeps going ')
  expect([colorOf(lead), colorOf(time), colorOf(tail)]).toEqual([THEME.muted, THEME.onSurface, THEME.muted])
  await click(band, 'blast-run')
  await call
  await band.unmount()
})

test('countdown: 1:59 left reads 2 min in warn, and 0:42 left reads 42 s in alert, the words staying muted', IDLE, async ($, on) => {
  const { seen, clock } = world(on)
  const call = $.tool.call({ tool: 'Bash', command: COMMAND })
  await holding(seen)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  await settle(clock, 8 * MINUTE + 1 * SECOND)
  await band.redraw()
  let edge = await edgeOf(band)
  expect([edge.time.text, colorOf(edge.time), colorOf(edge.lead)]).toEqual(['2 min', THEME.warn, THEME.muted])
  await settle(clock, 77 * SECOND)
  await band.redraw()
  edge = await edgeOf(band)
  expect([edge.time.text, colorOf(edge.time), colorOf(edge.lead), colorOf(edge.tail)]).toEqual(['42 s', THEME.alert, THEME.muted, THEME.muted])
  await click(band, 'blast-run')
  await call
  await band.unmount()
})

test('countdown: with the idle timeout Off the edge draws nothing', { options: { idle: 'Off' } }, async ($, on) => {
  const { seen } = world(on)
  const call = $.tool.call({ tool: 'Bash', command: COMMAND })
  await holding(seen)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await band.find({ type: 'Text', text: EDGE_TEXT })).toBeUndefined()
  await click(band, 'blast-run')
  await call
  await band.unmount()
})

test('countdown: using the card sets it back to the full time', IDLE, async ($, on) => {
  const { seen, clock } = world(on)
  const call = $.tool.call({ tool: 'Bash', command: COMMAND })
  await holding(seen)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  await settle(clock, 9 * MINUTE)
  await band.redraw()
  expect((await edgeOf(band)).time.text).toBe('1 min')
  await click(band, 'blast-cancel')
  await band.redraw()
  const edge = await edgeOf(band)
  expect([edge.time.text, colorOf(edge.time)]).toEqual(['10 min', THEME.onSurface])
  await band.input({ key: 'blast-reason', text: '', kind: 'submit' })
  await call
  await band.unmount()
})

test('countdown: a narrow card drops the clause first, then the whole countdown, and the title stays', IDLE, async ($, on) => {
  const { seen } = world(on)
  const call = $.tool.call({ tool: 'Bash', command: COMMAND })
  await holding(seen)
  let band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...bandOf(60) })
  let edge = await edgeOf(band)
  expect([edge.lead.text, edge.time.text, edge.tail]).toEqual([' Sets this aside in ', '10 min', undefined])
  expect(await band.find({ type: 'Text', text: text.card.title })).toBeDefined()
  await band.unmount()
  band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...bandOf(40) })
  edge = await edgeOf(band)
  expect([edge.lead, edge.time, edge.tail]).toEqual([undefined, undefined, undefined])
  expect(await band.find({ type: 'Text', text: text.card.title })).toBeDefined()
  await click(band, 'blast-run')
  await call
  await band.unmount()
})

test('countdown: redraws once a minute, then once a second in the last minute, and not between', IDLE, async ($, on) => {
  const { seen, clock } = world(on)
  let draws = 0
  on('ui.invalidate', () => {
    draws++
    return { value: undefined }
  })
  const call = $.tool.call({ tool: 'Bash', command: COMMAND })
  await holding(seen)
  const drawsAfter = async (ms: number) => {
    const before = draws
    await settle(clock, ms)
    return draws - before
  }
  // 10 min shows until 9:00 left: half a minute changes nothing, the next half minute shows 9 min.
  expect(await drawsAfter(30 * SECOND)).toBe(0)
  expect(await drawsAfter(30 * SECOND)).toBe(1)
  // Down to 2 min left, one redraw per minute and none between.
  for (let minute = 0; minute < 7; minute++) {
    expect(await drawsAfter(30 * SECOND)).toBe(0)
    expect(await drawsAfter(30 * SECOND)).toBe(1)
  }
  // 2 min shows until 1:00 left.
  expect(await drawsAfter(59 * SECOND)).toBe(0)
  expect(await drawsAfter(1 * SECOND)).toBe(1)
  // Inside the last minute each second is a redraw.
  expect(await drawsAfter(1 * SECOND)).toBe(1)
  expect(await drawsAfter(1 * SECOND)).toBe(1)
  expect(await drawsAfter(0)).toBe(0)
  await clock.advance(MINUTE)
  await call
})

test('the chip goes when the session ends', IDLE, async ($, on) => {
  const { seen, clock } = world(on)
  await timeOut($, clock, seen)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await band.find({ key: 'blast-wait' })).toBeDefined()
  await $.session.end({ reason: 'other', sessionId: 's1', resume: {} } as never)
  await band.redraw()
  expect(await band.find({ key: 'blast-wait' })).toBeUndefined()
  await band.unmount()
})

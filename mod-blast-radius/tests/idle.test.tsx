// mod-blast-radius / tests/idle.test.tsx, by v-amorim: idle timeout, waiting chip, stored answer
import { expect, mock, test } from 'claude-code/testing'
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
  const seen = { ran: 0, argv: [] as string[] }
  const clock = mock.clock(on as never)
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
  if (node.props?.key === 'sub-lead' || node.props?.key === 'badge' || node.props?.key === 'lead') return undefined
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
    "Blast radius held this command and the person did not answer for 10 minutes. The command did not run. Carry on with any work that does not need it, and ask to run it again after the person's next message.",
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
  expect(result).toContain('the person cancelled and said why: \\"wrong folder\\"')
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

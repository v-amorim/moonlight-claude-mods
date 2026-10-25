// mod-blast-radius / tests/hold.test.tsx, by v-amorim
// Tests holding a command, the Haiku prompt and reply parsing, and the settings and details panes.
import { expect, mock, test } from 'claude-code/testing'
import { actionLabels, canOpenDoes, cardRows } from '../hooks/explain'
import { describePrompt, parseDescribed, verdictOf } from '../hooks/haiku'
import text from '../hooks/text'
import { MARK } from '../hooks/theme'

const PLUGIN = 'mod-blast-radius'
const PANE = (requestId: string) =>
  ({
    component: 'Pane',
    requestId,
    props: { title: 'Blast radius', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
  }) as const
const SETTINGS = PANE('blast-radius-settings')
const DETAILS = PANE('blast-radius-list')
const bandOf = (maxRows = 24, bodyColumns = 80) =>
  ({ component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows, bodyColumns, scroll: { offset: 0, bodyRows: 6 }, view: {} } }) as const
const BAND = bandOf()

// What every preview git call must carry, so a repo's own config cannot run code.
const GIT_SAFETY = '--no-optional-locks -c core.fsmonitor=false -c core.hooksPath=/dev/null'

const ASK = '\u26a0\ufe0f Destructive operation detected: Recursive deletion (rm -r/rm -rf)\n\nCommand:\nrm -rf build'
const RULES_PATH = 'C:/Users/me/.claude/mods-data/mod-blast-radius/rules.json'
const LONG = 'C:/Users/me/blast-radius-demonstration-folder/drafts-of-the-quarterly-report/archive'

const FILES: Record<string, { kind: 'file' | 'dir'; size: number }> = {
  'C:/w/build': { kind: 'dir', size: 0 },
  'C:/w/build/a.js': { kind: 'file', size: 2048 },
  'C:/w/build/b.js': { kind: 'file', size: 1024 },
  'C:/Users/me': { kind: 'dir', size: 0 },
  'C:/Users/me/blast-radius-demo': { kind: 'dir', size: 0 },
  'C:/Users/me/blast-radius-demo/drafts': { kind: 'dir', size: 0 },
  'C:/Users/me/blast-radius-demo/drafts/a.txt': { kind: 'file', size: 100 },
  'C:/Users/me/blast-radius-demo/b.txt': { kind: 'file', size: 200 },
  'C:/Users/me/blast-radius-demonstration-folder': { kind: 'dir', size: 0 },
  'C:/Users/me/blast-radius-demonstration-folder/drafts-of-the-quarterly-report': { kind: 'dir', size: 0 },
  [LONG]: { kind: 'dir', size: 0 },
  [`${LONG}/x.txt`]: { kind: 'file', size: 10 },
  [`${LONG}/y.txt`]: { kind: 'file', size: 20 },
}
declare const setTimeout: (run: (value?: unknown) => void, ms: number) => unknown
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
// A drive path the engine took for relative comes back with the plugin's folder in front, so the fixtures read it from the drive letter on.
const asGiven = (path: string) => path.replace(/\\/g, '/').replace(/^.*?(?=[A-Za-z]:\/)/, '')

type World = {
  surfaces?: string[]
  // Waiter programs that are not installed, by name: running one fails.
  missing?: string[]
  failsOnce?: string[]
  rules?: { text: string; mtimeMs: number }
  noCwd?: boolean
  // What the engine's own tool.check says beneath the mod.
  verdict?: string
  verdictReason?: string
  // What git prints, by the command as typed.
  git?: Record<string, string>
  // The pane the engine opens is not placed, so the mod toasts why.
  unplaced?: boolean
  // The person's CLAUDE_CONFIG_DIR, as the engine would hand it over.
  configDir?: string
  // Reading the environment fails, as when the engine is busy shutting down.
  envThrows?: boolean
  // The command itself fails when it runs.
  callThrows?: boolean
  // The mod's own /config rows, as the engine lists them.
  configRows?: Record<string, unknown>[]
}

// Everything the engine would answer, plus a record of what the hold did.
function world(on: (event: string, handler: (...args: any[]) => unknown) => void, setup: World = {}) {
  const seen = { ran: 0, toasts: [] as string[], argv: [] as string[], reads: 0, stats: 0, panes: new Set<string>(), opened: [] as string[], failed: new Set<string>() }
  const rules = { current: setup.rules }
  const clock = mock.clock(on as never)
  on('session.cwd', () => {
    if (setup.noCwd) throw new Error('no cwd')
    return { value: 'C:/w' }
  })
  on('session.surfaces', () => ({ value: setup.surfaces ?? ['terminal'] }))
  on('env.get', (_$: unknown, e: { name: string }) => {
    if (setup.envThrows) throw new Error('env is gone')
    return { value: e.name === 'OS' ? 'Windows_NT' : e.name === 'USERPROFILE' ? 'C:\\Users\\me' : e.name === 'CLAUDE_CONFIG_DIR' ? setup.configDir : undefined }
  })
  const rulesPath = setup.configDir ? `${setup.configDir.replace(/\\/g, '/').replace(/\/$/, '')}/mods-data/mod-blast-radius/rules.json` : RULES_PATH
  on('fs.stat', (_$: unknown, e: { path: string }) => {
    const path = asGiven(e.path)
    if (path === rulesPath) {
      seen.stats++
      if (!rules.current) throw new Error('ENOENT')
      return { value: { kind: 'file', size: 1, mtimeMs: rules.current.mtimeMs, isLink: false } }
    }
    const node = FILES[path]
    if (!node) throw new Error('ENOENT')
    return { value: { ...node, mtimeMs: 0, isLink: false } }
  })
  on('fs.read', (_$: unknown, e: { path: string }) => {
    const path = asGiven(e.path)
    if (path === rulesPath && rules.current) {
      seen.reads++
      return { value: rules.current.text }
    }
    throw new Error('ENOENT')
  })
  on('fs.list', (_$: unknown, e: { path: string }) => {
    const prefix = `${asGiven(e.path).replace(/\/$/, '')}/`
    const names = Object.entries(FILES).filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
    return { value: names.map(([path, node]) => ({ name: path.slice(prefix.length), kind: node.kind, size: node.size, mtimeMs: 0, isLink: false })) }
  })
  on('process.run', async (_$: unknown, e: { argv: string[] }) => {
    seen.argv.push(e.argv.join(' '))
    if (setup.missing?.includes(e.argv[0]!)) throw new Error('cannot start')
    if (setup.failsOnce?.includes(e.argv[0]!) && !seen.failed.has(e.argv[0]!)) {
      seen.failed.add(e.argv[0]!)
      throw new Error('timed out')
    }
    // Nothing answers the reserved address, so a real ping waits its timeout and exits 1.
    if (e.argv[0] === 'ping') {
      await sleep(5)
      return { value: { exitCode: 1, stdout: '', stderr: '' } }
    }
    const typed = e.argv.join(' ').replace(GIT_SAFETY, '').replace('git  ', 'git ')
    const out = e.argv[0] === 'git' ? setup.git?.[typed] : undefined
    if (e.argv[0] === 'git') return { value: out === undefined ? { exitCode: 128, stdout: '', stderr: 'fatal: not a git repository' } : { exitCode: 0, stdout: out, stderr: '' } }
    await sleep(5)
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('ui.toast', (_$: unknown, e: { text?: string; message?: string }) => {
    seen.toasts.push(String(e.text ?? e.message ?? ''))
    return { value: {} }
  })
  on('ui.panes', () => ({ value: [...seen.panes].map(id => ({ id, isPlaced: true })) }))
  on('ui.open', (_$: unknown, e: { id: string }) => {
    if (setup.unplaced) return { value: { isPlaced: false, reason: 'too narrow' } }
    seen.panes.add(e.id)
    seen.opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_$: unknown, e: { id: string }) => {
    seen.panes.delete(e.id)
    return { value: {} }
  })
  on('state.set', () => ({ value: { isSet: true, version: 1 } }))
  on('config.list', () => ({ value: setup.configRows ?? [] }))
  on('tool.check', () => ({ decision: setup.verdict ?? 'allow', ...(setup.verdictReason ? { reason: setup.verdictReason } : {}) }))
  on('tool.call', () => {
    seen.ran++
    if (setup.callThrows) throw new Error('disk full')
    return { result: { text: 'ran' } }
  })
  on('ui.render', ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text key="base">base</Text>
  })
  return { seen, rules, clock }
}

const click = (band: any, key: string) => band.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: key })
// The entry's label Text: the first Text it drew outside its subpill and its badge.
type Drawn = { type: string; props: Record<string, any>; children?: unknown[] }
const labelNode = (node: Drawn): Drawn | undefined => {
  if (node.props?.key === 'sub-lead' || node.props?.key === 'badge') return undefined
  if (node.type === 'Text') return node
  for (const child of node.children ?? []) {
    const found = child && typeof child === 'object' ? labelNode(child as Drawn) : undefined
    if (found) return found
  }
  return undefined
}
const labelOf = async (band: any, key: string): Promise<string> => labelNode(await band.drawn({ in: key }))?.children?.join('') as string
const colorOf = async (band: any, key: string): Promise<string> => labelNode(await band.drawn({ in: key }))?.props.color

// Cancel asks why first: a click opens the field, and Enter on it, empty or not, ends the hold.
const REASON = 'blast-reason'
const endHold = async (band: any, reason = '') => {
  await click(band, 'blast-cancel')
  await band.input({ key: REASON, text: reason, kind: 'submit' })
}

// Answers the hold on screen with Cancel.
const cancel = async ($: any) => {
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  await endHold(band)
  await band.unmount()
}

// The hold is live once its first wait for an answer has started.
const holding = async (seen: { argv: string[] }) => {
  for (let tries = 0; tries < 200 && seen.argv.length === 0; tries++) await sleep(10)
  expect(seen.argv.length).toBeGreaterThan(0)
}

const textOf = async (band: any, pattern: RegExp) => (await band.find({ type: 'Text', text: pattern }))?.text as string | undefined

// Holds a command, mounts the band, and hands it over; the hold ends with Cancel.
async function withCard($: any, on: any, command: string, setup: World, check: (band: any, seen: any) => Promise<void>, band = BAND) {
  const { seen } = world(on, setup)
  const call = $.tool.call({ tool: 'Bash', command })
  await holding(seen)
  const mounted = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...band })
  await check(mounted, seen)
  await endHold(mounted)
  await call
  await mounted.unmount()
}

test('rm card: the heading says what happens, one sentence says what it does, the path carries the figures', async ($, on) => {
  await withCard($, on, 'cd ~ && rm -r blast-radius-demo && ls', {}, async band => {
    expect(await textOf(band, /Delete 2 files/)).toBe('\! Delete 2 files in blast-radius-demo')
    expect(await textOf(band, /Removes the folder/)).toBe('Removes the folder and everything inside it. No undo.')
    expect(await textOf(band, /^~\/blast-radius-demo\//)).toBe('~/blast-radius-demo/   2 files \u00b7 2 folders \u00b7 300 B')
    expect(await labelOf(band, 'blast-cancel')).toBe(' Cancel ')
    expect(await labelOf(band, 'blast-details')).toBe(' Details ')
    expect(await labelOf(band, 'blast-run')).toBe(' Delete 2 files ')
    expect(await textOf(band, /Recursive deletion/)).toBeUndefined()
    // The command lives in Details, never on the card.
    expect(await textOf(band, /cd ~|blast-radius-demo &&|ls$/)).toBeUndefined()
    expect(await textOf(band, /preview/)).toBeUndefined()
  })
})

test('git reset --hard card: discards the changed files in plain words', async ($, on) => {
  const git = { 'git status --porcelain': ' M a.ts\n M b.ts\n?? new.ts\n' }
  await withCard($, on, 'git reset --hard', { git }, async band => {
    expect(await textOf(band, /Discard 2 changed files/)).toBe('\! Discard 2 changed files')
    expect(await textOf(band, /lost for good/)).toBe('Sets files back to the last commit. Uncommitted changes are lost for good.')
    expect(await labelOf(band, 'blast-run')).toBe(' Discard 2 changed files ')
    expect(await textOf(band, /M a\.ts/)).toBe(' M a.ts and 1 more')
  })
})

test('force push card: names the branch it replaces and the commits that are lost', async ($, on) => {
  const git = { 'git rev-parse --verify --quiet origin/main': 'abc\n', 'git log --oneline --no-decorate main..origin/main': 'f00 theirs\nf01 other\n' }
  await withCard($, on, 'git push --force origin main', { git }, async band => {
    expect(await textOf(band, /Force push/)).toBe('\! Force push to origin/main')
    expect(await textOf(band, /Replaces the branch/)).toBe('Replaces the branch on the remote with yours. 2 commits there are lost.')
    expect(await labelOf(band, 'blast-run')).toBe(' Force push to origin/main ')
  })
})

test('other kinds speak plainly: overwrite, drop table, and a check with no preview', async ($, on) => {
  const { seen } = world(on)
  expect(seen.ran).toBe(0)
  const cases: [string, RegExp, string][] = [
    ['make deploy TARGET=prod', /Deploy to production/, ' Deploy to production '],
    ['psql -c "DROP TABLE users"', /Drop table users/, ' Drop table users '],
    ['git stash drop', /Delete stashed changes/, ' Delete stash '],
  ]
  for (const [command, heading, run] of cases) {
    const call = $.tool.call({ tool: 'Bash', command })
    for (let tries = 0; tries < 100 && !(await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND }).then(async band => ((await textOf(band, heading)) ? (await band.unmount(), true) : (await band.unmount(), false)))); tries++) await sleep(10)
    const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
    expect(await labelOf(band, 'blast-run')).toBe(run)
    await endHold(band)
    await call
    await band.unmount()
  }
})

test('Haiku answers only a filled template: long fields and junk are dropped, a wrong step count keeps the rest', () => {
  const good = '{"verb":"Delete the build folder","does":"Removes the build output and everything in it.","undo":"No, rebuild it to get it back.","steps":["Deletes the build folder"],"targets":"the build folder","verdict":"ok","why":"build output can be rebuilt"}'
  expect(parseDescribed(`Sure!\n${good}`, 1)?.verb).toBe('Delete the build folder')
  // Haiku often writes a step for a safe one too, so a wrong count keeps the answer but no steps: the rule's sentences show.
  expect(parseDescribed(good, 2)?.steps).toEqual(['', ''])
  expect(parseDescribed(good.replace('["Deletes the build folder"]', '["Lists the status","Deletes the build folder"]'), 1)?.steps).toEqual([''])
  expect(parseDescribed(good.replace('Delete the build folder', 'x'.repeat(80)), 1)).toBeNull()
  expect(parseDescribed('not json', 1)).toBeNull()
  expect(describePrompt('rm -rf build', 'rule', '', ['rm -rf build'])).toContain('<command>\nrm -rf build\n</command>')
  expect(parseDescribed(good.replace(',"targets":"the build folder"', ''), 1)).toBeNull()
  expect(parseDescribed(good.replace('"verdict":"ok"', '"verdict":"sure"'), 1)?.verdict).toBe('check')
})

test('the rules overrule an ok verdict: nothing measured, or a path outside the working folder', () => {
  const found = parseDescribed(
    '{"verb":"Delete the build folder","does":"Removes the build output.","undo":"No.","steps":["Deletes it"],"targets":"the build folder","verdict":"ok","why":"build output can be rebuilt"}',
    1,
  )!
  const inside = { summary: '', groups: [], note: '', facts: { paths: ['C:/w/build'] } }
  expect(verdictOf(found, inside, 'C:\\w')).toEqual({ isOk: true, why: 'build output can be rebuilt' })
  expect(verdictOf(found, { ...inside, facts: { paths: ['C:/other/build'] } }, 'C:\\w').isOk).toBe(false)
  expect(verdictOf(found, { summary: '', groups: [], note: '', isUnknown: true }, 'C:\\w').isOk).toBe(false)
  expect(verdictOf({ ...found, verdict: 'check' }, inside, 'C:\\w').isOk).toBe(false)
})

test('Haiku words replace the heading and the sentence, while Run keeps the rule wording', { options: { explain: true } }, async ($, on) => {
  const { seen, clock } = world(on)
  const asked: string[] = []
  on('model.complete', ((_$: unknown, e: { model: string; prompt: string }) => {
    asked.push(e.model)
    return { value: { isAnswered: true, usage: {}, text: '{"verb":"Delete the build folder","does":"Removes the build output and everything in it.","undo":"No, rebuild it to get it back.","steps":["Deletes the build folder"],"targets":"the build folder","verdict":"ok","why":"build output can be rebuilt"}' } }
  }) as never)
  const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  await holding(seen)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  // The description runs on a timer after the card is up.
  await clock.advance(1)
  await band.redraw()
  expect(asked).toEqual(['haiku'])
  expect(await textOf(band, /Delete the build folder/)).toBeDefined()
  expect(await textOf(band, /Removes the build output/)).toBeDefined()
  expect(await textOf(band, /Looks OK to run: build output can be rebuilt/)).toBeDefined()
  expect(await labelOf(band, 'blast-run')).toMatch(/Delete/)
  await cancel($)
  await call
  await band.unmount()
})

test('while Haiku writes the card words, a shimmering Explaining shows on the action row', { options: { explain: true } }, async ($, on) => {
  const { seen, clock } = world(on)
  let release = (_: unknown) => {}
  const pending = new Promise(resolve => (release = resolve))
  on('model.complete', (async () => ({ value: await pending })) as never)
  const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  await holding(seen)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  await clock.advance(1)
  await band.redraw()
  expect(await band.find({ key: 'hold-explaining' })).toBeDefined()

  release({ isAnswered: true, usage: {}, text: '{"verb":"Delete the build folder","does":"Removes the build output.","undo":"No.","steps":["Deletes the build folder"],"targets":"the build folder","verdict":"ok","why":"build output can be rebuilt"}' })
  await clock.settle()
  await band.redraw()
  expect(await band.find({ key: 'hold-explaining' })).toBeUndefined()
  expect(await textOf(band, /Delete the build folder/)).toBeDefined()
  await cancel($)
  await call
  await band.unmount()
})

test('a failed Haiku call leaves the rule wording in place, and the verdict points to Details', { options: { explain: true } }, async ($, on) => {
  const { seen, clock } = world(on)
  on('model.complete', (() => ({ value: { isAnswered: false, reason: 'api-error', status: 500, usage: {} } })) as never)
  const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  await holding(seen)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  await clock.advance(1)
  await band.redraw()
  expect(await textOf(band, /Delete/)).toBeDefined()
  expect(await textOf(band, /Open Details to be sure: no explanation came back/)).toBeDefined()
  await cancel($)
  await call
  await band.unmount()
})

test('Run runs the command, and nothing else answers the hold', async ($, on) => {
  const { seen } = world(on)
  const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  await holding(seen)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(seen.ran).toBe(0)
  await click(band, 'blast-run')
  const result = await call
  // The toast is this mod's own card above the row, not Claude Code's box.
  expect(await band.find({ type: 'Text', text: /running it/ })).toBeDefined()
  expect(seen.toasts).toEqual([])
  await band.unmount()

  expect(seen.ran).toBe(1)
  expect(JSON.stringify(result)).toContain('ran')
})

test('a digit typed into the empty prompt answers the hold: 1 cancels, 3 runs', async ($, on) => {
  const { seen } = world(on)
  const first = $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  await holding(seen)
  let band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  await band.press({ key: 'blast-cancel-hotkey' })
  expect(await band.find({ key: REASON })).toBeDefined()
  await band.input({ key: REASON, text: '', kind: 'submit' })
  expect(JSON.stringify(await first)).toContain('pressed Cancel')
  await band.unmount()

  const second = $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  await holding(seen)
  band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  await band.press({ key: 'blast-run-hotkey' })
  await second
  await band.unmount()
  expect(seen.ran).toBe(1)
})

// Holds a command, opens the reason field with Cancel, and hands over the band.
async function asking($: any, on: any) {
  const { seen } = world(on)
  const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  await holding(seen)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  await click(band, 'blast-cancel')
  return { seen, call, band }
}

test('Cancel opens the reason field in place of the actions and draws no hotkey buttons', async ($, on) => {
  const { seen, call, band } = await asking($, on)
  const field = await band.find({ key: REASON })
  expect(field).toBeDefined()
  expect(JSON.stringify(await band.drawn())).toContain('Why? Enter sends, Enter alone skips')
  for (const key of ['blast-cancel', 'blast-details', 'blast-run', 'blast-cancel-hotkey', 'blast-details-hotkey', 'blast-run-hotkey']) expect(await band.find({ key })).toBeUndefined()
  expect(await labelOf(band, 'blast-reason-send')).toBe(' skip ')
  expect(await labelOf(band, 'blast-reason-back')).toBe(' back to the choices ')
  // The head line and the sentence stay above the field.
  expect(await textOf(band, /Delete 2 files/)).toBeDefined()
  expect(await textOf(band, /Removes the folder/)).toBeDefined()
  expect(seen.ran).toBe(0)
  await band.input({ key: REASON, text: '', kind: 'submit' })
  await call
  await band.unmount()
})

test('typing a reason turns skip into send, and Enter with text denies with the quoted reason', async ($, on) => {
  const { seen, call, band } = await asking($, on)
  await band.input({ key: REASON, text: 'wrong folder, it is "dist2"', kind: 'change' })
  await band.redraw()
  expect(await labelOf(band, 'blast-reason-send')).toBe(' send ')
  await band.input({ key: REASON, text: 'wrong folder, it is "dist2"', kind: 'submit' })
  const result = JSON.stringify(await call)
  await band.unmount()

  expect(seen.ran).toBe(0)
  expect(result).toContain('the person cancelled and said why: \\"wrong folder, it is \\\\\\"dist2\\\\\\"\\".')
  expect(result).toContain('Reason: Recursive deletion')
  expect(result).toContain('Do not retry it')
  expect(result).not.toContain('pressed Cancel')
})

test('Enter on an empty field denies as before, with no reason', async ($, on) => {
  const { call, band } = await asking($, on)
  await band.input({ key: REASON, text: '   ', kind: 'submit' })
  const result = JSON.stringify(await call)
  await band.unmount()

  expect(result).toContain('the person pressed Cancel. Reason: Recursive deletion')
  expect(result).not.toContain('said why')
})

test('Esc back returns to the actions and decides nothing', async ($, on) => {
  const { seen, call, band } = await asking($, on)
  await band.input({ key: REASON, text: 'half a thought', kind: 'change' })
  await click(band, 'blast-reason-back')
  expect(await band.find({ key: REASON })).toBeUndefined()
  for (const key of ['blast-cancel', 'blast-details', 'blast-run']) expect(await band.find({ key })).toBeDefined()
  expect(seen.ran).toBe(0)
  let isDone = false
  void call.then(() => (isDone = true))
  await sleep(60)
  expect(isDone).toBe(false)
  await click(band, 'blast-run')
  await call
  await band.unmount()
  expect(seen.ran).toBe(1)
})

test('a long or multi-line reason is flattened, stripped of control characters and cut', async ($, on) => {
  const { call, band } = await asking($, on)
  await band.input({ key: REASON, text: `first line\n\n  second\tline\u0007 ${'x'.repeat(400)}`, kind: 'submit' })
  const result = (await call) as { deny: string }
  await band.unmount()

  const said = /said why: "(.*)"\. Reason:/.exec(result.deny)![1]!
  expect(said.startsWith('first line second line xxx')).toBe(true)
  expect(said).not.toMatch(/[\n\t\u0007]/)
  expect(said.endsWith('...')).toBe(true)
  expect([...said].length).toBeLessThanOrEqual(303)
})

test('digits typed in the reason field neither run nor cancel the hold', async ($, on) => {
  const { seen, call, band } = await asking($, on)
  await band.input({ key: REASON, text: '1 or 3', kind: 'change' })
  await band.redraw()
  expect(await band.find({ key: REASON })).toBeDefined()
  expect(seen.ran).toBe(0)
  let isDone = false
  void call.then(() => (isDone = true))
  await sleep(60)
  expect(isDone).toBe(false)
  await band.input({ key: REASON, text: '1 or 3', kind: 'submit' })
  expect(JSON.stringify(await call)).toContain('said why: \\"1 or 3\\"')
  await band.unmount()
  expect(seen.ran).toBe(0)
})

test('Cancel refuses the call with a reason Claude reads, and the command never runs', async ($, on) => {
  const { seen } = world(on)
  const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  await holding(seen)
  await cancel($)
  const result = JSON.stringify(await call)

  expect(seen.ran).toBe(0)
  expect(result).toContain('the person pressed Cancel')
  expect(result).toContain('Reason: Recursive deletion')
  expect(result).toContain('delete 2 files and 1 folder')
  expect(result).toContain('Do not retry it')
})

test('there is no timeout: the hold outlives ten minutes of clock and ends only on an answer', async ($, on) => {
  const { seen, clock } = world(on)
  let isDone = false
  const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build' }).then(result => {
    isDone = true
    return result
  })
  await holding(seen)

  await clock.advance(11 * 60 * 1000)
  await sleep(80)
  expect(isDone).toBe(false)
  expect(seen.ran).toBe(0)

  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  await click(band, 'blast-run')
  await call
  await band.unmount()
  expect(seen.ran).toBe(1)
})

test('safe commands pass untouched, and so does a loop that writes new text files', async ($, on) => {
  const { seen } = world(on)
  const commands = ['ls -la', 'git status', 'npm test', 'echo hi > fresh.txt', 'rm -rf /tmp/scratch', 'for i in 1 2; do echo "x" > dir/$d-$i.txt; done', 'echo x > $OUT.json', 'echo x > new.json']
  for (const command of commands) await $.tool.call({ tool: 'Bash', command })

  expect(seen.ran).toBe(commands.length)
  expect(seen.argv).toEqual([])
})

test('with enabled off, even rm runs at once', { options: { enabled: false } }, async ($, on) => {
  const { seen } = world(on)
  await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })

  expect(seen.ran).toBe(1)
  expect(seen.argv).toEqual([])
})

test('the pause tries sleep first, then powershell, then ping, and never the hook clock', async ($, on) => {
  const first = world(on)
  const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  await holding(first.seen)
  await sleep(60)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  await click(band, 'blast-run')
  await call
  await band.unmount()

  expect(first.seen.argv.filter(line => !line.startsWith('sleep 0.25'))).toEqual([])
  expect(first.seen.argv.length).toBeGreaterThan(1)
})

test('when sleep is missing the pause falls back to powershell', async ($, on) => {
  const { seen } = world(on, { missing: ['sleep'] })
  const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  await holding(seen)
  await sleep(60)
  await cancel($)
  await call

  expect(seen.argv[0]).toBe('sleep 0.25')
  expect(seen.argv.some(line => line.startsWith('powershell -NoProfile -NonInteractive -Command Start-Sleep -Milliseconds 250'))).toBe(true)
})

test('when sleep and powershell are both missing the pause falls back to ping, whose unanswered exit still counts as a wait', async ($, on) => {
  const { seen } = world(on, { missing: ['sleep', 'powershell'] })
  const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  await holding(seen)
  await sleep(60)
  await cancel($)
  const result = JSON.stringify(await call)

  expect(seen.argv.some(line => line.startsWith('ping -n 1 -w 250'))).toBe(true)
  expect(result).not.toContain('hit an error')
  expect(result).toContain('pressed Cancel')
})

test('a waiter that fails once is tried again on the next hold, so one slow moment never turns the card into a block', async ($, on) => {
  const { seen } = world(on, { failsOnce: ['sleep'] })
  const first = $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  await holding(seen)
  await sleep(60)
  await cancel($)
  await first
  seen.argv.length = 0

  const second = $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  await holding(seen)
  await sleep(60)
  await cancel($)
  const result = JSON.stringify(await second)

  expect(seen.argv.filter(line => !line.startsWith('git'))[0]).toBe('sleep 0.25')
  expect(result).toContain('pressed Cancel')
})

test('the entries carry no glyphs, and Run is red while Cancel and Details are not', async ($, on) => {
  await withCard($, on, 'rm -rf build', {}, async band => {
    expect(await labelOf(band, 'blast-run')).toBe(' Delete 2 files ')
    expect(await colorOf(band, 'blast-run')).toBe('#CA5F71')
    expect(await colorOf(band, 'blast-cancel')).not.toBe('#CA5F71')
    expect(await colorOf(band, 'blast-details')).not.toBe('#CA5F71')
  })
})

test('icons=nerd gives the Details pane a tab chip with the Nerd shell icon', { options: { icons: 'nerd' } }, async ($, on) => {
  const { seen } = world(on)
  const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  await holding(seen)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  // The heading's warning is the one-cell codicon, never the emoji-prone \u26a0.
  expect(await textOf(band, /Delete 2 files/)).toMatch(new RegExp(`^${String.fromCodePoint(0xea6c)} Delete 2 files`))
  await click(band, 'blast-details')
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...DETAILS })
  const title = JSON.stringify(await pane.drawn({ in: 'mod-blast-radius-details-tab' }))
  expect(title).toContain(String.fromCodePoint(0xf120))
  expect(await labelOf(pane, 'mod-blast-radius-details-tab')).toBe(' Details ')
  await pane.unmount()
  await endHold(band)
  await call
  await band.unmount()
})

test('icons=safe gives the Details pane a tab chip with the safe shell mark', { options: { icons: 'safe' } }, async ($, on) => {
  const { seen } = world(on)
  const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  await holding(seen)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  await click(band, 'blast-details')
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...DETAILS })
  const title = JSON.stringify(await pane.drawn({ in: 'mod-blast-radius-details-tab' }))
  expect(title).toContain('" $ "')
  expect(await labelOf(pane, 'mod-blast-radius-details-tab')).toBe(' Details ')
  await pane.unmount()
  await endHold(band)
  await call
  await band.unmount()
})

test('Cancel comes first, Details second, the consequence last, each a numbered pill, and nothing closes the hold', async ($, on) => {
  await withCard($, on, 'rm -rf build', {}, async band => {
    const tree = JSON.stringify(await band.drawn())
    const at = (key: string) => tree.indexOf(key)
    expect(at('blast-cancel-pill')).toBeGreaterThan(-1)
    expect(at('blast-cancel-pill')).toBeLessThan(at('blast-details-pill'))
    expect(at('blast-details-pill')).toBeLessThan(at('blast-run-pill'))
    for (const digit of ['1', '2', '3']) expect(tree).toContain(`"subLead":"${digit}"`)
    // No keycap box of its own and no divider between the pills.
    expect(tree).not.toContain('\u2502')
    expect(tree).not.toContain('blast-cancel-cap')
    expect(await band.find({ type: 'Text', text: /close/i })).toBeUndefined()
  })
})

test('the card shows only while a call is held, and then it is the only row besides the pills', async ($, on) => {
  const { seen } = world(on)
  const idle = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await textOf(idle, /Delete 2 files/)).toBeUndefined()
  expect(await textOf(idle, /^base$/)).toBeDefined()
  await idle.unmount()

  const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  await holding(seen)
  const held = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await textOf(held, /Delete 2 files/)).toBeDefined()
  expect(await textOf(held, /^base$/)).toBeUndefined()
  await click(held, 'blast-run')
  await call
  await held.redraw()
  expect(await textOf(held, /Delete 2 files/)).toBeUndefined()
  expect(await textOf(held, /^base$/)).toBeDefined()
  await held.unmount()
})

test('Details is on every card, even a short one, and opens the read-only pane; a second click closes it', async ($, on) => {
  const { seen } = world(on)
  const call = $.tool.call({ tool: 'Bash', command: 'cd ~ && rm -r blast-radius-demo && ls' })
  await holding(seen)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...bandOf(24, 120) })
  expect(await labelOf(band, 'blast-details')).toBe(' Details ')

  await click(band, 'blast-details')
  expect(seen.opened).toEqual(['blast-radius-list'])
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...DETAILS })
  expect(await labelOf(pane, 'mod-blast-radius-details-tab')).toBe(' Details ')
  expect(await labelOf(pane, 'mod-blast-radius-settings-tab')).toBe(' Settings ')
  expect(await textOf(pane, /^Read only/)).toBe('Read only · answer on the card above the prompt')
  // The command's own card carries no heading.
  expect(await textOf(pane, /What this command does/)).toBeUndefined()
  for (const title of ['What it touches', 'Can it be undone', 'Full command']) expect(await textOf(pane, new RegExp(title))).toBeDefined()
  expect(seen.ran).toBe(0)
  await pane.unmount()

  await click(band, 'blast-details')
  expect(seen.panes.has('blast-radius-list')).toBe(false)
  await click(band, 'blast-details')
  expect(seen.panes.has('blast-radius-list')).toBe(true)
  await endHold(band)
  await call
  await band.unmount()
  expect(seen.panes.has('blast-radius-list')).toBe(false)
})

test('Details sections: each piece of the command, why it was held, what it touches, whether it can be undone, the full command', async ($, on) => {
  const { seen } = world(on)
  const command = 'cd ~ && rm -r blast-radius-demo && ls -d blast-radius-demo'
  const call = $.tool.call({ tool: 'Bash', command })
  await holding(seen)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  await click(band, 'blast-details')
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...DETAILS })

  expect(await textOf(pane, /^and 2 safe steps/)).toBe('and 2 safe steps (cd, ls)')
  expect(await textOf(pane, /safe$/)).toBeUndefined()
  expect(await textOf(pane, /^rm -r blast-radius-demo$/)).toBe('rm -r blast-radius-demo')
  expect(await textOf(pane, /^Deletes the folder/)).toBe('Deletes the folder blast-radius-demo and everything in it')
  expect(await textOf(pane, /^It deletes folders/)).toBeUndefined()
  expect(await textOf(pane, /^Held by: /)).toBe('Held by: Built-in rule (core check)')
  expect(await textOf(pane, /^Would delete/)).toBe('Would delete \u00b7 2 files \u00b7 300 B')
  expect(await textOf(pane, /^~\/blast-radius-demo\/$/)).toBe('~/blast-radius-demo/')
  expect(await textOf(pane, /b\.txt/)).toBe('  b.txt  200 B')
  expect(await textOf(pane, /^No\. Deleted files skip/)).toBe('No. Deleted files skip the trash.')
  expect(await textOf(pane, new RegExp(`^cd ~ && rm -r`))).toBe(command)
  await pane.unmount()
  await endHold(band)
  await call
  await band.unmount()
})

test('Details: a long script is one step, the full command is capped at twelve rows, and the card never shows it', { options: { icons: 'safe' } }, async ($, on) => {
  const script = Array.from({ length: 40 }, (_, index) => `console.log("line ${index}")`).join('\n')
  const command = `cd ~ && node - <<'EOF'\n${script}\nEOF\n && rm -r blast-radius-demo`
  const { seen } = world(on)
  const call = $.tool.call({ tool: 'Bash', command })
  await holding(seen)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await textOf(band, /console\.log|EOF|node -/)).toBeUndefined()
  await click(band, 'blast-details')
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...DETAILS })

  expect(await textOf(pane, /^node runs a 40-line script$/)).toBeDefined()
  expect(await textOf(pane, /^Deletes the folder blast-radius-demo/)).toBeDefined()
  expect(await textOf(pane, /^and 1 safe step \(cd\)$/)).toBe('and 1 safe step (cd)')
  const lines = ((await pane.findAll({ type: 'Text', text: /^console\.log/ })) as unknown[]).length
  expect(lines).toBeLessThanOrEqual(12)
  // The expand control sits on the last command row: the row, a spacer, then the arrow and its muted label.
  expect(await pane.find({ key: 'full-last-gap' })).toBeDefined()
  expect(await pane.find({ key: 'full-last-text' })).toBeDefined()
  const words = (node: unknown): string => (typeof node === 'string' ? node : Array.isArray(node) ? node.map(words).join('') : node ? words((node as { children?: unknown }).children) : '')
  expect(words(await pane.drawn({ in: 'blast-more' }))).toBe(' ▾ 31 more lines ')
  await click(pane, 'blast-more')
  expect(((await pane.findAll({ type: 'Text', text: /^console\.log/ })) as unknown[]).length).toBe(40)
  expect(words(await pane.drawn({ in: 'blast-more' }))).toBe(' ▴ Show less ')
  await click(pane, 'blast-more')
  expect(((await pane.findAll({ type: 'Text', text: /^console\.log/ })) as unknown[]).length).toBeLessThanOrEqual(12)
  expect(words(await pane.drawn({ in: 'blast-more' }))).toBe(' ▾ 31 more lines ')
  await pane.unmount()
  await endHold(band)
  await call
  await band.unmount()
})

test('Details draws the full command in syntax colors, the risky part in alert, and a legend at the foot', async ($, on) => {
  const { seen } = world(on)
  const call = $.tool.call({ tool: 'Bash', command: 'cd ~ && rm -r --force "blast radius" $DIR' })
  await holding(seen)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  await click(band, 'blast-details')
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...DETAILS })

  const colors = new Set(((await pane.findAll({ type: 'Text' })) as { props: { color?: string } }[]).map(found => found.props.color))
  for (const color of ['#7386D0', '#FFAFAF', '#A5CFFF', '#79C0FF', '#CA5F71']) expect(colors.has(color), color).toBe(true)
  const risky = (await pane.findAll({ type: 'Text', text: /^rm$/ })) as { props: { color?: string; bold?: boolean } }[]
  expect(risky.some(found => found.props.color === '#CA5F71' && found.props.bold === true)).toBe(true)
  // Each role is a legend pill in its own color, the risky part in alert, with no `·` between them.
  const legend = (await pane.find({ type: 'Text', text: /^ ?risky part ?$/ })) as { props: { color?: string } }
  expect(legend.props.color).toBe('#CA5F71')
  expect(await textOf(pane, /^ ?--option ?$/)).toBeDefined()
  expect(await textOf(pane, /^command · --option/)).toBeUndefined()
  await pane.unmount()
  await endHold(band)
  await call
  await band.unmount()
})

test('Details names where a rule comes from, for the person\u2019s own rules too', async ($, on) => {
  const text = JSON.stringify([{ pattern: 'terraform\\s+destroy', reason: 'Destroys infrastructure', flags: 'i' }])
  const { seen } = world(on, { rules: { text, mtimeMs: 1 } })
  const call = $.tool.call({ tool: 'Bash', command: 'terraform destroy -auto-approve' })
  await holding(seen)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await textOf(band, /Destroys infrastructure/)).toBe('\! Destroys infrastructure')
  expect(await labelOf(band, 'blast-run')).toBe(' Run anyway ')
  await click(band, 'blast-details')
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...DETAILS })
  expect(await textOf(pane, /^Held by: /)).toBe('Held by: Your rule, from ~/.claude/mods-data/mod-blast-radius/rules.json')
  await pane.unmount()
  await endHold(band)
  await call
  await band.unmount()
})

// Every drawn row has to fit the band: the card gives up rows in a fixed order and never its figures or its actions.
const FIT_CASES: [string, string, World][] = [
  ['rm', `rm -r ${LONG.replace('C:/Users/me', '~')}`, {}],
  ['force push', 'git push --force origin feature/a-very-long-branch-name-for-the-quarterly-report', { git: { 'git rev-parse --verify --quiet origin/feature/a-very-long-branch-name-for-the-quarterly-report': 'x\n', 'git log --oneline --no-decorate feature/a-very-long-branch-name-for-the-quarterly-report..origin/feature/a-very-long-branch-name-for-the-quarterly-report': `${'a'.repeat(90)}\nbbbb two\n` } }],
  ['git reset', 'git reset --hard', { git: { 'git status --porcelain': ` M ${'src/a/very/long/folder/name/'.repeat(3)}file.ts\n M b.ts\n` } }],
]

for (const [name, command, setup] of FIT_CASES) {
  for (const columns of [60, 120]) {
    const width = columns - 4
    test(`fit: the ${name} card at ${columns} columns keeps every row inside the width`, async ($, on) => {
      await withCard($, on, command, setup, async (band, seen) => {
        expect(seen.ran).toBe(0)
        const rows = ((await band.findAll({ type: 'Text' })) as { text: string }[]).filter(row => !row.text.startsWith('▎'))
        for (const row of rows) expect(row.text.length, row.text).toBeLessThanOrEqual(width)
        const labels = [await labelOf(band, 'blast-cancel'), await labelOf(band, 'blast-details'), await labelOf(band, 'blast-run')]
        expect(labels.reduce((sum, label) => sum + label.length, 0) + 6).toBeLessThanOrEqual(width)
        expect(rows.some(row => row.text.startsWith('!'))).toBe(true)
      }, bandOf(24, columns))
    })

    test(`fit: the ${name} card at ${columns} columns and six rows keeps only the heading and the actions`, async ($, on) => {
      await withCard($, on, command, setup, async band => {
        const rows = ((await band.findAll({ type: 'Text' })) as { text: string }[]).filter(row => !row.text.startsWith('▎'))
        for (const row of rows) expect(row.text.length, row.text).toBeLessThanOrEqual(width)
        // The sentence, the paths and the command go to Details; the figures stay in the heading and the Run label. The title sits on the border, not in a row.
        const edge = new Set([`${MARK.rule} `, text.card.title, ` ${text.card.titleHint}`])
        expect(rows.filter(row => !row.text.startsWith('!') && row.text.trim() !== '' && !edge.has(row.text)).map(row => row.text)).toEqual([])
        expect(await labelOf(band, 'blast-run')).toBeTruthy()
      }, bandOf(6, columns))
    })
  }
}

test('fit: a long path is cut in the middle, keeping the first folder and the last name, and its figures stay whole', async ($, on) => {
  await withCard($, on, FIT_CASES[0]![1], {}, async band => {
    const row = await textOf(band, /archive\//)
    expect(row).toContain('\u2026')
    expect(row).toContain('2 files')
    expect(row).toContain('30 B')
    expect(row!.startsWith('~/blast-')).toBe(true)
    expect(row!.length).toBeLessThanOrEqual(56)
  }, bandOf(24, 60))
})

test('fit: a short band drops the command line first, then the second paths, and the heading keeps its counts', async ($, on) => {
  const command = 'cd ~ && rm -r blast-radius-demo blast-radius-demonstration-folder && ls'
  await withCard($, on, command, {}, async band => {
    expect(await textOf(band, /^! /)).toMatch(/^! Delete 4 files/)
    expect(await textOf(band, /^cd ~/)).toBeUndefined()
  }, bandOf(8, 80))
})

test('a preview that cannot be computed still holds, and says so', async ($, on) => {
  await withCard($, on, 'rm -rf build', { noCwd: true }, async band => {
    expect(await textOf(band, /Delete folders/)).toBeDefined()
    expect(await textOf(band, /Can't preview this/)).toBe("Can't preview this before it runs")
  })
})

test('a check without a preview of its own holds and explains itself', async ($, on) => {
  await withCard($, on, 'make deploy TARGET=prod', {}, async band => {
    expect(await textOf(band, /Deploy to production/)).toBe('\! Deploy to production')
    expect(await textOf(band, /real users/)).toBe('Puts a new version live for real users.')
  })
})

test('rules.json adds rules with their own reason, read once per mtime', async ($, on) => {
  const text = JSON.stringify([{ pattern: 'terraform\\s+destroy', reason: 'Destroys infrastructure', flags: 'i' }])
  const { seen, rules } = world(on, { rules: { text, mtimeMs: 1 } })
  const call = $.tool.call({ tool: 'Bash', command: 'Terraform destroy -auto-approve' })
  await holding(seen)
  await cancel($)
  await call

  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Bash', command: 'echo 1' })
  expect(seen.reads).toBe(1)
  expect(seen.stats).toBe(3)

  rules.current = { text: '[]', mtimeMs: 2 }
  await $.tool.call({ tool: 'Bash', command: 'terraform destroy' })
  expect(seen.reads).toBe(2)
  expect(seen.ran).toBe(3)
})

test('a missing rules.json means no extra rules, and the built-in checks still hold', async ($, on) => {
  const { seen } = world(on)
  await $.tool.call({ tool: 'Bash', command: 'terraform destroy' })
  expect(seen.argv).toEqual([])

  const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  await holding(seen)
  await cancel($)
  await call
})

test('a broken rules.json never disables the built-in checks and shows one note in the settings pane', async ($, on) => {
  const { seen } = world(on, { rules: { text: '[{"pattern":"(","reason":"bad"},{"reason":"none"}]', mtimeMs: 1 } })
  const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  await holding(seen)
  await cancel($)
  await call
  expect(seen.ran).toBe(0)

  const settings = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...SETTINGS })
  expect((await settings.find({ type: 'Text', text: /rule 1 skipped/ }))?.text).toContain('(+1 more)')
  expect(await settings.find({ type: 'Text', text: '~/.claude/mods-data/mod-blast-radius/rules.json' })).toBeDefined()
  expect(await settings.find({ type: 'Text', text: /"pattern"/ })).toBeDefined()
  await settings.unmount()
})

test('with no surface that draws, the call is not held: tool.check asks and the hold never opens', async ($, on) => {
  const { seen } = world(on, { surfaces: [] })
  // The kit runs tool.check before the call and treats an ask nobody answers as a denial, so the command never reaches the tool.
  const result = await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  expect(JSON.stringify(result)).toContain('Permission to use Bash has been denied')
  expect(seen.argv).toEqual([])
  expect(seen.ran).toBe(0)

  const risky = await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf build' } })
  expect(risky).toMatchObject({ decision: 'ask', reason: 'Blast radius: Recursive deletion (rm -r/rm -rf)' })
  const safe = await $.tool.check({ tool: 'Bash', input: { command: 'ls' } })
  expect(safe.decision).toBe('allow')
})

const PASS_PLAIN_RM = JSON.stringify([{ pattern: String.raw`^\s*rm(?!.*\s(-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)(\s|$))\s`, reason: 'Decided elsewhere', action: 'pass' }])

test('a pass entry lets a plain rm through with no card, and rm -rf ~ in the same command is still held', async ($, on) => {
  const { seen } = world(on, { rules: { text: PASS_PLAIN_RM, mtimeMs: 1 } })
  await $.tool.call({ tool: 'Bash', command: 'rm a.txt' })
  expect(seen.ran).toBe(1)

  const call = $.tool.call({ tool: 'Bash', command: 'rm a.txt && rm -rf ~' })
  await holding(seen)
  await cancel($)
  await call
  expect(seen.ran).toBe(1)
})

test('with no surface that draws, tool.check follows the pass entry and its safety floor', async ($, on) => {
  world(on, { surfaces: [], rules: { text: PASS_PLAIN_RM, mtimeMs: 1 } })
  expect((await $.tool.check({ tool: 'Bash', input: { command: 'rm a.txt' } })).decision).toBe('allow')
  expect((await $.tool.check({ tool: 'Bash', input: { command: 'rm -r build' } })).decision).toBe('ask')
  expect((await $.tool.check({ tool: 'Bash', input: { command: 'rm ~/*' } })).decision).toBe('ask')
  expect((await $.tool.check({ tool: 'Bash', input: { command: 'rm a.txt && rm -rf ~' } })).decision).toBe('ask')
})

test('an entry with no action holds as before', async ($, on) => {
  const { seen } = world(on, { rules: { text: JSON.stringify([{ pattern: '^rm ', reason: 'Mine' }]), mtimeMs: 1 } })
  const call = $.tool.call({ tool: 'Bash', command: 'rm a.txt' })
  await holding(seen)
  await cancel($)
  await call
})

test('a VS Code or mobile surface alone cannot draw the hold either', async ($, on) => {
  world(on, { surfaces: ['vscode', 'mobile'] })
  const risky = await $.tool.check({ tool: 'Bash', input: { command: 'git reset --hard' } })

  expect(risky.decision).toBe('ask')
})

test('where a surface draws, tool.check leaves the verdict alone', async ($, on) => {
  world(on, { surfaces: ['terminal'] })
  const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf build' } })

  expect(verdict.decision).toBe('allow')
})

// Claude Code shows a settings hook's ask even when a tool.check hook answers allow, so Run never tries to answer it.
test('after Run, another hook’s ask on the call is left to the permission prompt', async ($, on) => {
  const { seen } = world(on, { verdict: 'ask', verdictReason: ASK })
  const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build', tool_use_id: 'tu-1' } as never)
  await holding(seen)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  await click(band, 'blast-run')
  await call
  await band.unmount()

  expect(await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf build' }, tool_use_id: 'tu-1' } as never)).toEqual({ decision: 'ask', reason: ASK })
})

test('the card draws on desktop too, so the hold works there', async ($, on) => {
  const { seen } = world(on)
  const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  await holding(seen)

  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  expect(await textOf(band, /Delete 2 files/)).toBeDefined()
  await click(band, 'blast-run')
  await call
  await band.unmount()
  expect(seen.ran).toBe(1)
})

const stubPills = {
  name: 'stub-pills',
  tier: 'append' as const,
  register: (on: any) => {
    on('ui.render', { component: 'AbovePrompt' }, async ($: any, e: any) => {
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box key="menu-rows" flexDirection="column">
          <Box key="menu-row" flexDirection="row">
            <Box key="menu-group" flexDirection="row">
              <Box key="menu-group-body" flexDirection="row">
                <Text>StubPill</Text>
              </Box>
            </Box>
          </Box>
        </Box>
      )
    })
  },
}

test('the pills other mods draw stay below the card', { plugins: [stubPills] }, async ($, on) => {
  await withCard($, on, 'rm -rf build', {}, async band => {
    expect(await band.find({ type: 'Text', text: 'StubPill' })).toBeDefined()
    const tree = JSON.stringify(await band.drawn())
    expect(tree.indexOf('blast-card')).toBeLessThan(tree.indexOf('StubPill'))
  })
})

test('/mod-blast-radius answers with what it holds', async ($, on) => {
  world(on)
  const result = await $.command.run({ command: 'mod-blast-radius', args: '' } as never)

  expect(JSON.stringify(result)).toContain('Blast radius is on: 22 built-in checks')
})

test('the card: its title in bold alert, a check verdict with an alert mark and muted words', { options: { explain: true } }, async ($, on) => {
  const { seen, clock } = world(on)
  on('model.complete', (() => ({ value: { isAnswered: false, reason: 'api-error', status: 500, usage: {} } })) as never)
  const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  await holding(seen)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  await clock.advance(1)
  await band.redraw()
  const title = (await band.find({ type: 'Text', text: /^! Delete 2 files/ })) as { props: { color?: string; bold?: boolean } }
  expect(title.props).toMatchObject({ color: '#CA5F71', bold: true })
  const mark = (await band.find({ type: 'Text', text: /^!$/ })) as { props: { color?: string; bold?: boolean } }
  expect(mark.props).toMatchObject({ color: '#CA5F71', bold: true })
  const words = (await band.find({ type: 'Text', text: /^ Open Details to be sure/ })) as { props: { color?: string } }
  expect(words.props.color).not.toBe('#CA5F71')
  await cancel($)
  await call
  await band.unmount()
})

test('the Details and Settings tabs swap the panes, each closing the other, and the open tab does nothing', async ($, on) => {
  const { seen } = world(on)
  const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  await holding(seen)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  await click(band, 'blast-details')
  const details = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...DETAILS })
  await click(details, 'mod-blast-radius-details-tab')
  expect([...seen.panes]).toEqual(['blast-radius-list'])
  await click(details, 'mod-blast-radius-settings-tab')
  expect([...seen.panes]).toEqual(['blast-radius-settings'])
  await details.unmount()

  const settings = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...SETTINGS })
  expect(await labelOf(settings, 'mod-blast-radius-details-tab')).toBe(' Details ')
  expect(await labelOf(settings, 'mod-blast-radius-settings-tab')).toBe(' Settings ')
  await click(settings, 'mod-blast-radius-settings-tab')
  expect([...seen.panes]).toEqual(['blast-radius-settings'])
  await click(settings, 'mod-blast-radius-details-tab')
  expect([...seen.panes]).toEqual(['blast-radius-list'])
  await settings.unmount()
  await endHold(band)
  await call
  await band.unmount()
})

test('with nothing held, the Details tab says so in a toast instead of opening an empty pane', async ($, on) => {
  const { seen } = world(on)
  await $.command.run({ command: 'mod-blast-radius', args: 'settings' } as never)
  const settings = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...SETTINGS })
  await click(settings, 'mod-blast-radius-details-tab')
  expect([...seen.panes]).toEqual(['blast-radius-settings'])
  await settings.redraw()
  expect(await settings.find({ type: 'Text', text: /none is held now/ })).toBeUndefined()
  await settings.unmount()
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await band.find({ type: 'Text', text: /none is held now/ })).toBeDefined()
  await band.unmount()
})

test('the full command wraps between words, never inside one', async ($, on) => {
  const { seen } = world(on)
  const command = 'cd "C:/Users/me/AppData/Local/Temp/demo" && git status --short && git reset --hard && head -1 src/cart.js src/format.js'
  const call = $.tool.call({ tool: 'Bash', command })
  await holding(seen)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  await click(band, 'blast-details')
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...{ ...DETAILS, props: { ...DETAILS.props, bodyColumns: 50 } } })
  const rows = ((await pane.findAll({ type: 'Text', text: /^cd "C:|^git |^head |&&$/ })) as { text: string }[]).map(row => row.text)
  const words = command.split(' ')
  for (const row of rows) for (const word of row.split(' ').filter(Boolean)) expect(words, row).toContain(word)
  await pane.unmount()
  await endHold(band)
  await call
  await band.unmount()
})

test('hovering a card button shows its tip in the band tip row, and the Details footer reads the same post', async ($, on) => {
  const { seen } = world(on)
  const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  await holding(seen)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await textOf(band, /stops the command/)).toBeUndefined()
  await band.pointer({ type: 'enter', x: 1, y: 0, in: 'blast-cancel' })
  expect(await textOf(band, /stops the command from running/)).toBe(' stops the command from running')
  await band.pointer({ type: 'leave', x: 1, y: 0, in: 'blast-cancel' })
  expect(await textOf(band, /stops the command/)).toBeUndefined()
  await band.pointer({ type: 'enter', x: 1, y: 0, in: 'blast-details' })
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...DETAILS })
  expect(await textOf(pane, /full breakdown/)).toContain('opens the full breakdown of this command')
  await pane.unmount()
  await endHold(band)
  await call
  await band.unmount()
})

test('a band tip whose entry was redrawn while hovered clears after 5 s with no newer hover', async ($, on) => {
  const { seen, clock } = world(on)
  const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  await holding(seen)
  // Live, a band redraw mid-turn replaced the hovered entry, so its own quiet timer, and the leave, never came.
  const first = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  await first.pointer({ type: 'enter', x: 1, y: 0, in: 'blast-cancel' })
  await first.unmount()
  const showsNow = async () => {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
    const shown = (await textOf(ui, /stops the command from running/)) !== undefined
    await ui.unmount()
    return shown
  }
  expect(await showsNow()).toBe(true)
  await clock.advance(4000)
  expect(await showsNow()).toBe(true)
  await clock.advance(1000)
  expect(await showsNow()).toBe(false)
  await cancel($)
  await call
})

test('a held command raises one notification naming it, and a refused notification leaves the hold intact', async ($, on) => {
  const notes: { text: string; title?: string }[] = []
  on('ui.notify', (_$: unknown, e: { text: string; title?: string }) => {
    notes.push(e)
    throw new Error('refused')
  })
  const command = `rm -rf dist\n   build ${'x'.repeat(120)}`
  await withCard($, on, command, {}, async band => {
    await sleep(20)
    expect(await labelOf(band, "blast-cancel")).toBe(" Cancel ")
  })
  expect(notes).toHaveLength(1)
  expect(notes[0]!.text.length).toBeLessThanOrEqual(110)
  expect(notes[0]!.text).toContain('rm -rf dist build')
  expect(notes[0]!.title).toBe('Blast radius')
})

test('a toast raised during a hold draws above the card', async ($, on) => {
  const { seen } = world(on, { unplaced: true })
  const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  await holding(seen)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  await click(band, 'blast-details')
  expect(await textOf(band, /^List waiting$/)).toBeDefined()
  expect(await textOf(band, /^ too narrow/)).toBeDefined()
  expect(await band.find({ type: 'Text', text: /^!/ })).toBeDefined()
  await click(band, 'toast-blast-1')
  expect(await textOf(band, /^List waiting/)).toBeUndefined()
  await endHold(band)
  await call
  await band.unmount()
})

test('the Settings pane draws a footer that shows the hovered tip', async ($, on) => {
  world(on)
  await $.command.run({ command: 'mod-blast-radius', args: 'settings' } as never)
  const settings = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...SETTINGS })
  expect(await settings.find({ type: 'Text', text: /^─+$/ })).toBeDefined()
  expect(await textOf(settings, /Shows this/)).toBeUndefined()
  await settings.post({ type: 'tip', id: 'x', glyph: '>', label: 'Guard', text: 'Shows this view' }, { in: 'mod-blast-radius-settings-tab' })
  expect(await textOf(settings, /Shows this view/)).toContain('Shows this view')
  await settings.unmount()
})

test('every git call of the preview turns off the repo\u2019s fsmonitor and hooks, so a held command never runs repo code', async ($, on) => {
  const git = { 'git status --porcelain': ' M a.ts\n', 'git diff --shortstat HEAD': ' 1 file changed\n' }
  await withCard($, on, 'git reset --hard main', { git }, async (_band, seen) => {
    const calls = (seen.argv as string[]).filter(line => line.startsWith('git '))
    expect(calls.length).toBeGreaterThanOrEqual(3)
    for (const line of calls) expect(line.startsWith(`git ${GIT_SAFETY} `), line).toBe(true)
  })
})

test('a check that throws lets the command run and toasts once, so one broken rule never blocks every command', async ($, on) => {
  const { seen } = world(on, { envThrows: true })
  const first = JSON.stringify(await $.tool.call({ tool: 'Bash', command: 'ls' }))
  await sleep(20)
  await $.tool.call({ tool: 'Bash', command: 'pwd' })
  await sleep(20)

  expect(seen.ran).toBe(2)
  expect(first).not.toContain('did not run it')
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await band.find({ type: 'Text', text: /the check failed for this command/ })).toBeDefined()
  await band.unmount()
})

test('a throw while holding a risky command still stops it: it is refused, never run unheld', async ($, on) => {
  const { seen } = world(on, { missing: ['sleep', 'powershell', 'ping'] })
  const result = JSON.stringify(await $.tool.call({ tool: 'Bash', command: 'rm -rf build' }))

  expect(seen.ran).toBe(0)
  expect(result).toContain('did not run it')
})

test('an error from an allowed command passes through, never relabeled as a refusal', async ($, on) => {
  world(on, { callThrows: true })
  let message = ''
  try {
    message = JSON.stringify(await $.tool.call({ tool: 'Bash', command: 'ls' }))
  } catch (error) {
    message = String((error as Error).message)
  }

  // A throwing test hook is skipped, so the error that comes back is the engine's own.
  expect(message).toContain('no implementation for tool.call')
  expect(message).not.toContain('did not run it')
})

test('with explain on, Haiku explains the held command and the card waits for it', { options: { explain: true } }, async ($, on) => {
  const { seen, clock } = world(on)
  const asked: string[] = []
  on('model.complete', ((_$: unknown, e: { model: string }) => {
    asked.push(e.model)
    return { value: { isAnswered: false, reason: 'api-error', status: 500, usage: {} } }
  }) as never)
  const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  await holding(seen)
  await clock.advance(1)
  await cancel($)
  await call
  expect(asked).toEqual(['haiku'])
})

const SPEND_PATH = 'C:/cfg/mods-data/mod-blast-radius/spend.json'
async function explainWithSpend($: any, on: any, failWrite: boolean) {
  const { seen, clock } = world(on, { configDir: 'C:\\cfg\\' })
  const writes: { path: string; text: string }[] = []
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    if (failWrite) throw new Error('disk full')
    writes.push({ path: asGiven(e.path), text: e.text })
    return { value: undefined }
  })
  on('model.complete', (() => ({ value: { isAnswered: true, text: 'nothing parseable', usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5, cache_creation_input_tokens: 7 } } })) as never)
  const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  await holding(seen)
  await clock.advance(1)
  await sleep(20)
  await cancel($)
  await call
  return writes
}

test('with explain on, the Haiku reply usage lands in spend.json', { options: { explain: true } }, async ($, on) => {
  const writes = await explainWithSpend($, on, false)
  expect(writes.map(write => write.path)).toEqual([SPEND_PATH])
  const day = Object.values(JSON.parse(writes[0]!.text).days)[0] as Record<string, unknown>
  expect(day.haiku).toEqual({ calls: 1, input: 100, output: 20, cacheRead: 5, cacheWrite: 7 })
})

test('a spend.json write that fails does not stop the held command from being cancelled', { options: { explain: true } }, async ($, on) => {
  const writes = await explainWithSpend($, on, true)
  expect(writes).toEqual([])
})

test('by default (setting untouched) no model is called for a held command', async ($, on) => {
  const { seen, clock } = world(on)
  const asked: string[] = []
  on('model.complete', ((_$: unknown, e: { model: string }) => {
    asked.push(e.model)
    return { value: { isAnswered: false, reason: 'api-error', status: 500, usage: {} } }
  }) as never)
  const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  await holding(seen)
  await clock.advance(1)
  await cancel($)
  await call
  expect(asked).toEqual([])
})

test('with explain off, no model is called and the card keeps the rule wording and the preview', { options: { explain: false } }, async ($, on) => {
  const { seen, clock } = world(on)
  const asked: string[] = []
  on('model.complete', ((_$: unknown, e: { model: string }) => {
    asked.push(e.model)
    return { value: { isAnswered: false, reason: 'api-error', status: 500, usage: {} } }
  }) as never)
  const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  await holding(seen)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  await clock.advance(1)
  await band.redraw()
  expect(asked).toEqual([])
  expect(await textOf(band, /Delete 2 files/)).toBeDefined()
  expect(await textOf(band, /Removes the folder/)).toBeDefined()
  expect(await band.find({ key: 'hold-explaining' })).toBeUndefined()
  expect(await textOf(band, /no explanation came back/)).toBeUndefined()
  await cancel($)
  await call
  await band.unmount()
})

test('rules.json is read from CLAUDE_CONFIG_DIR when it is set', async ($, on) => {
  const text = JSON.stringify([{ pattern: 'terraform\\s+destroy', reason: 'Destroys infrastructure', flags: 'i' }])
  const { seen } = world(on, { configDir: 'C:\\cfg\\', rules: { text, mtimeMs: 1 } })
  const call = $.tool.call({ tool: 'Bash', command: 'terraform destroy -auto-approve' })
  await holding(seen)
  expect(seen.reads).toBe(1)
  await cancel($)
  await call
  expect(seen.ran).toBe(0)
})

test('rules.json stays under the home folder when CLAUDE_CONFIG_DIR is not set', async ($, on) => {
  const text = JSON.stringify([{ pattern: 'terraform\\s+destroy', reason: 'Destroys infrastructure', flags: 'i' }])
  const { seen } = world(on, { rules: { text, mtimeMs: 1 } })
  const call = $.tool.call({ tool: 'Bash', command: 'terraform destroy -auto-approve' })
  await holding(seen)
  expect(seen.reads).toBe(1)
  await cancel($)
  await call
})

test('the card tips carry a bare glyph, with no brackets or padding', { options: { icons: 'safe' } }, async ($, on) => {
  const { seen } = world(on)
  const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  await holding(seen)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  await band.pointer({ type: 'enter', x: 1, y: 0, in: 'blast-cancel' })
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...DETAILS })
  expect(await pane.find({ type: 'Text', text: '×' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '[×]' })).toBeUndefined()
  await pane.unmount()
  await endHold(band)
  await call
  await band.unmount()
})

test('a throw while Haiku writes the card words clears the shimmer and keeps the rule wording', { options: { explain: true } }, async ($, on) => {
  const { seen, clock } = world(on)
  on('model.complete', (() => { throw new Error('model is gone') }) as never)
  const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  await holding(seen)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  await clock.advance(1)
  await clock.settle()
  await band.redraw()
  expect(await band.find({ key: 'hold-explaining' })).toBeUndefined()
  expect(await textOf(band, /Delete/)).toBeDefined()
  await cancel($)
  await call
  await band.unmount()
})

// The kit cannot raise another mod's toast, so the pass-on of those is a live check; this pins that the mod's own are still drawn, each time.
test('the mod’s own toasts are drawn as its cards every time and never reach Claude Code’s box', async ($, on) => {
  const { seen } = world(on)
  await $.command.run({ command: 'mod-blast-radius', args: 'settings' } as never)
  const settings = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...SETTINGS })
  await click(settings, 'mod-blast-radius-details-tab')
  await click(settings, 'mod-blast-radius-details-tab')
  await settings.unmount()
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect((await band.find({ type: 'Text', text: /none is held now/ }))).toBeDefined()
  await band.unmount()
  expect(seen.toasts).toEqual([])
})

// A rule whose reason makes a sentence far longer than two rows at any width the band draws.
const WORDS = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu'
const LONG_RULE = JSON.stringify([{ pattern: '^deploy-it', reason: `${WORDS} ${WORDS} ${WORDS} ZZEND` }])
const LONG_WORLD: World = { rules: { text: LONG_RULE, mtimeMs: 1 } }
const MORE_KEY = 'blast-does-more'
const wordsOf = (node: unknown): string => (typeof node === 'string' ? node : Array.isArray(node) ? node.map(wordsOf).join('') : node ? wordsOf((node as { children?: unknown }).children) : '')
const allText = async (band: any) => ((await band.findAll({ type: 'Text' })) as { text: string }[]).map(row => row.text).join('\n')
// The sentence's rows are the ones made of lowercase words, or starting with the rule's lead-in.
const rowsOfSentence = async (band: any) => ((await band.findAll({ type: 'Text' })) as { text: string }[]).filter(row => /^(Matches your rule|[a-z]+ [a-z]+ [a-z]+)/.test(row.text)).length

for (const [mode, down, up] of [['safe', '▾', '▴'], ['nerd', String.fromCodePoint(0xf0d7), String.fromCodePoint(0xf0d8)]] as const) {
  test(`Show all: a cut sentence shows the control on the action row beside the actions, and it opens and closes the sentence (icons ${mode})`, { options: { icons: mode } }, async ($, on) => {
    await withCard($, on, 'deploy-it now', LONG_WORLD, async band => {
      const tree = JSON.stringify(await band.drawn())
      expect(tree).toContain(MORE_KEY)
      expect(tree).not.toContain('hold-more-own-row')
      // Cancel, Details and the run button come first, the control last, all inside the action row.
      const at = (key: string) => tree.indexOf(key)
      expect(at('hold-actions')).toBeGreaterThan(-1)
      expect(at('hold-actions')).toBeLessThan(at('blast-cancel-pill'))
      expect(at('blast-cancel-pill')).toBeLessThan(at('blast-details-pill'))
      expect(at('blast-details-pill')).toBeLessThan(at('blast-run-pill'))
      expect(at('blast-run-pill')).toBeLessThan(at('hold-more-row'))
      expect(at('hold-more-row')).toBeLessThan(at(`"key":"${MORE_KEY}"`))
      expect(wordsOf(await band.drawn({ in: MORE_KEY }))).toBe(` ${down} Show all `)
      expect(await allText(band)).not.toContain('ZZEND')
      const shut = await rowsOfSentence(band)
      expect(await textOf(band, /…$/)).toMatch(/…$/)

      await click(band, MORE_KEY)
      expect(wordsOf(await band.drawn({ in: MORE_KEY }))).toBe(` ${up} Show less `)
      expect(await allText(band)).toContain('ZZEND')
      expect(await rowsOfSentence(band)).toBeGreaterThan(shut)
      expect(await labelOf(band, 'blast-cancel')).toBe(' Cancel ')
      expect(await labelOf(band, 'blast-details')).toBe(' Details ')
      expect(await labelOf(band, 'blast-run')).toBe(' Run anyway ')

      await click(band, MORE_KEY)
      expect(wordsOf(await band.drawn({ in: MORE_KEY }))).toBe(` ${down} Show all `)
      expect(await allText(band)).not.toContain('ZZEND')
      expect(await rowsOfSentence(band)).toBe(shut)
    }, bandOf(24, 120))
  })
}

test('Show all: a sentence that fits has no control', async ($, on) => {
  await withCard($, on, 'rm -rf build', {}, async band => {
    expect(await band.find({ key: MORE_KEY })).toBeUndefined()
    expect(JSON.stringify(await band.drawn())).not.toContain(MORE_KEY)
  })
})

test('Show all: where the action row has no room beside the actions the control takes a row of its own, bottom right, and the actions stay', async ($, on) => {
  await withCard($, on, 'deploy-it now', LONG_WORLD, async band => {
    const tree = JSON.stringify(await band.drawn())
    expect(tree).toContain('hold-more-own-row')
    expect(tree.indexOf('hold-more-own-row')).toBeGreaterThan(tree.indexOf('blast-run-pill'))
    expect(tree).not.toContain('hold-more-row')
    await click(band, MORE_KEY)
    expect(await allText(band)).toContain('ZZEND')
    const rows = ((await band.findAll({ type: 'Text' })) as { text: string }[]).filter(row => !row.text.startsWith('▎'))
    for (const row of rows) expect(row.text.length, row.text).toBeLessThanOrEqual(56)
    expect(await labelOf(band, 'blast-cancel')).toBe(' Cancel ')
    expect(await labelOf(band, 'blast-run')).toBe(' Run anyway ')
  }, bandOf(24, 60))
})

test('Show all: never shortens the run label to fit beside the actions, the control takes its own row instead', async ($, on) => {
  // What the three actions show with no control at this width.
  const bare = `  ${actionLabels({ run: 'Run anyway' } as never, 60).run} `.trim()
  await withCard($, on, 'deploy-it now', LONG_WORLD, async band => {
    expect((await labelOf(band, 'blast-run')).trim()).toBe(bare)
    expect(bare).toBe('Run anyway')
    const tree = JSON.stringify(await band.drawn())
    expect(tree).toContain('hold-more-own-row')
    expect(tree).not.toContain('hold-more-row')
  }, bandOf(24, 64))
})

test('Show all: the band row budget holds open, the sentence takes what the band gives and no control is offered where it would add nothing', () => {
  const plain = { verb: 'Run it', run: 'Run anyway', does: `${WORDS} ${WORDS} ${WORDS} ZZEND`, undo: 'x' } as never
  const report = { summary: '', groups: [], note: '' } as never
  for (const bodyRows of [1, 2, 3, 5, 10, 30]) {
    const open = cardRows(plain, report, 56, bodyRows, true)
    expect(open.length, `body ${bodyRows}`).toBeLessThanOrEqual(Math.max(1, bodyRows))
    expect(open[0]!.kind).toBe('head')
  }
  expect(cardRows(plain, report, 56, 10, true).filter(row => row.kind === 'does').length).toBeGreaterThan(cardRows(plain, report, 56, 10, false).filter(row => row.kind === 'does').length)
  expect(canOpenDoes(plain, report, 56, 10)).toBe(true)
  expect(canOpenDoes(plain, report, 56, 1)).toBe(false)
  expect(canOpenDoes({ ...(plain as object), does: 'Short.' } as never, report, 56, 10)).toBe(false)
})

test('Show all: a band too short to grow shows no control', async ($, on) => {
  await withCard($, on, 'deploy-it now', LONG_WORLD, async band => {
    expect(await band.find({ key: MORE_KEY })).toBeUndefined()
  }, bandOf(6, 120))
})

test('Show all: the run button answers the hold while the sentence is open', async ($, on) => {
  const { seen } = world(on, LONG_WORLD)
  const call = $.tool.call({ tool: 'Bash', command: 'deploy-it now' })
  await holding(seen)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...bandOf(24, 120) })
  await click(band, MORE_KEY)
  expect(await allText(band)).toContain('ZZEND')
  await click(band, 'blast-run')
  await call
  await band.unmount()
  expect(seen.ran).toBe(1)
})

test('Show all: hovering the control posts its tip', async ($, on) => {
  await withCard($, on, 'deploy-it now', LONG_WORLD, async band => {
    await band.pointer({ type: 'move', x: 1, y: 0, in: MORE_KEY })
    expect(await band.find({ type: 'Text', text: /shows the whole sentence/ })).toBeDefined()
  }, bandOf(24, 120))
})

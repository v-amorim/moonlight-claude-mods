// mod-blast-radius / tests/previews.test.tsx, by v-amorim
import { expect, mock, test } from 'claude-code/testing'

import { capture, EXAMPLE_COLUMNS, expectPreview, written } from './previews-kit'
import { snapshot } from './previews.snapshot'

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
// The card is two cells wider than an example line, for its border.
const CARD_COLUMNS = EXAMPLE_COLUMNS + 2

const ASK = '\u26a0\ufe0f Destructive operation detected: Recursive deletion (rm -r/rm -rf)\n\nCommand:\nrm -rf build'
const RULES_PATH = 'C:/Users/me/.claude/mods-data/mod-blast-radius/rules.json'
const LONG = 'C:/Users/me/blast-radius-demonstration-folder/drafts-of-the-quarterly-report/archive'

const FILES: Record<string, { kind: 'file' | 'dir'; size: number }> = {
  'C:/Users/me/app': { kind: 'dir', size: 0 },
  'C:/Users/me/app/build': { kind: 'dir', size: 0 },
  'C:/Users/me/app/build/cache.db': { kind: 'file', size: 3_250_586 },
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
}

// Everything the engine would answer, plus a record of what the hold did.
function world(on: (event: string, handler: (...args: any[]) => unknown) => void, setup: World = {}) {
  const seen = { ran: 0, toasts: [] as string[], argv: [] as string[], reads: 0, stats: 0, panes: new Set<string>(), opened: [] as string[], failed: new Set<string>() }
  const rules = { current: setup.rules }
  const clock = mock.clock(on as never)
  on('session.cwd', () => {
    if (setup.noCwd) throw new Error('no cwd')
    return { value: 'C:/Users/me/app' }
  })
  on('session.surfaces', () => ({ value: setup.surfaces ?? ['terminal'] }))
  on('env.get', (_$: unknown, e: { name: string }) => ({ value: e.name === 'OS' ? 'Windows_NT' : e.name === 'USERPROFILE' ? 'C:\\Users\\me' : undefined }))
  on('fs.stat', (_$: unknown, e: { path: string }) => {
    const path = asGiven(e.path)
    if (path === RULES_PATH) {
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
    if (path === RULES_PATH && rules.current) {
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
    const typed = e.argv.filter(arg => arg !== '--no-optional-locks').join(' ')
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
  on('config.list', () => ({ value: [] }))
  on('tool.check', () => ({ decision: setup.verdict ?? 'allow', ...(setup.verdictReason ? { reason: setup.verdictReason } : {}) }))
  on('tool.call', () => {
    seen.ran++
    return { result: { text: 'ran' } }
  })
  on('ui.render', ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text key="base">base</Text>
  })
  return { seen, rules, clock }
}

const click = (band: any, key: string) => band.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: key })
// The hold is live once its first wait for an answer has started.
const holding = async (seen: { argv: string[] }) => {
  for (let tries = 0; tries < 200 && seen.argv.length === 0; tries++) await sleep(10)
  expect(seen.argv.length).toBeGreaterThan(0)
}

// The card the band draws while a delete is held, as its heading, sentence, path and action row.
async function heldCard($: any, on: any) {
  const { seen } = world(on)
  const call = $.tool.call({ tool: 'Bash', command: 'rm build/cache.db' })
  await holding(seen)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  const got = await capture(await band.find({ key: 'blast-card-box' }), key => band.drawn({ in: key }), CARD_COLUMNS)
  await band.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'blast-cancel' })
  await band.input({ key: 'blast-reason', text: '', kind: 'submit' })
  await call
  await band.unmount()
  return got
}

for (const mode of ['nerd', 'safe'] as const) {
  test(`enabled=true example is the real card (${mode})`, { options: { icons: mode } }, async ($, on) => {
    expectPreview(snapshot, 'enabled', 'true', mode, await heldCard($, on))
  })

  test(`enabled=false example is its written lines (${mode})`, { options: { icons: mode } }, async () => {
    expectPreview(snapshot, 'enabled', 'false', mode, written([{ text: 'rm build/cache.db' }], [{ text: 'runs at once, nothing is held', color: 'muted' }]))
  })
}

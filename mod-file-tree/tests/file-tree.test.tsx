// mod-file-tree / tests/file-tree.test.tsx, by v-amorim
// Tests the file log: diff lines, relative paths, rows, turn views and transcript parsing.
import { expect, mock, test, type Mounted, type TestBody } from 'claude-code/testing'

import { cells, cut } from '../hooks/cells'
import FileList, { type Row as ListRow } from '../hooks/list'
import { THEME } from '../hooks/theme'
import { TranscriptFiles } from '../hooks/transcript'
import { diffLines, emptyLog, commit, iconOf, relPath, rootOf, rowsOf, touch, turnView } from '../hooks/tree'

type Pointer = { pointer: (event: object) => Promise<unknown> }
// The host types leave `pointer` off a mounted UI.
const pointing = <T extends Mounted>(ui: T) => ui as T & Pointer

const nf = (code: number) => String.fromCodePoint(code)

// The text a node draws, in order; a Client's text lives in its own drawing, so each one is drawn in place.
const drawnText = async (ui: Mounted, node: unknown): Promise<string> => {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return (await Promise.all(node.map(child => drawnText(ui, child)))).join('')
  if (!node || typeof node !== 'object') return ''
  const { type, props, children } = node as { type?: string; props?: { key?: string }; children?: unknown }
  return type === 'Client' && props?.key ? drawnText(ui, await ui.drawn({ in: props.key })) : drawnText(ui, children)
}

const PANE = {
  plugin: 'mod-file-tree',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'filetree',
  props: { title: 'Files', isFocused: true, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as never

const SHELL_DIFF = {
  files: [{ filePath: '/w/hooks/meter.tsx', hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: ['-old', '+new', '+more'] }] }],
  moreFiles: 1,
  changedFiles: ['/w/hooks/meter.tsx', '/w/hooks/levels.ts'],
}

const isTranscript = (path: string) => path.replace(/\\/g, '/').endsWith('/s1.jsonl')

// `transcript.text` is the session's .jsonl, which a test may grow between events.
const stubs = (on: Parameters<TestBody>[1], opened: string[] = [], transcript = { text: '', reads: 0 }, placed: string[] = [], seen: { store?: Map<string, unknown>; now?: number; stateFails?: { left: number }; env?: (name: string) => string | undefined; listed?: string[]; exists?: (path: string) => boolean; readFails?: string; clock?: ReturnType<typeof mock.clock> } = {}) => {
  on('session.cwd', () => ({ value: '/w' }))
  on('session.id', () => ({ value: 's1' }))
  on('env.get', (_$, e) => ({ value: seen.env ? seen.env(e.name) : e.name === 'USERPROFILE' ? '/h' : undefined }))
  const { store } = seen
  on('store.get', (_$, e) => ({ value: store?.get(e.key) }))
  on('store.set', (_$, e) => {
    store?.set(e.key, e.value)
    return { value: undefined }
  })
  if (store) {
    on('store.keys', () => ({ value: [...store.keys()] }))
    on('store.delete', (_$, e) => {
      store.delete(e.key)
      return { value: undefined }
    })
  }
  if (seen.stateFails) {
    const fails = seen.stateFails
    on('state.set', () => {
      if (fails.left > 0) {
        fails.left -= 1
        throw new Error('state unavailable')
      }
      return { value: undefined } as never
    })
  }
  on('fs.list', (_$, e) => {
    // The kit resolves a path against the drive on Windows.
    seen.listed?.push(e.path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, ''))
    return { value: transcript.text ? [{ name: 'p', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] : [] }
  })
  on('fs.exists', (_$, e) => ({ value: (isTranscript(e.path) && transcript.text !== '') || seen.exists?.(e.path.replace(/\\/g, '/').replace(/^.*?(?=[A-Za-z]:\/)/, '')) === true }))
  on('fs.stat', (_$, e) => ({ value: { kind: 'file', size: isTranscript(e.path) ? transcript.text.length : 0, mtimeMs: 0, isLink: false } }))
  on('fs.read', (_$, e) => {
    if (isTranscript(e.path)) transcript.reads += 1
    if (seen.readFails && isTranscript(e.path)) throw new Error(seen.readFails)
    return { value: isTranscript(e.path) ? transcript.text : 'one\ntwo\nthree\n' }
  })
  on('ui.panes', () => ({ value: placed.map(id => ({ id, isPlaced: true })) }) as never)
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } } as never
  })
  // A shell command answers with the edits Claude Code diffed for it.
  on('tool.call', (_$, e) => ({ result: e.tool === 'Bash' ? { stdout: '', bashEditDiff: SHELL_DIFF } : { text: 'ok' } }) as never)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }) as never)
  on('turn.complete', () => ({ text: '' }))
  seen.clock = seen.now === undefined ? mock.clock(on) : mock.clock(on, { now: seen.now })
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })
}

test('relPath keeps paths inside the working folder relative and others whole', () => {
  expect(relPath('C:\\repo', 'C:\\repo\\src\\a.ts')).toBe('src/a.ts')
  expect(relPath('/w/', '/w/a.ts')).toBe('a.ts')
  expect(relPath('/w', '/x/a.ts')).toBe('/x/a.ts')
})

test('diffLines marks added and removed lines and keeps one line of context', () => {
  const lines = diffLines('a\nb\nc\nd\ne\nf\n', 'a\nb\nC\nd\ne\nf\n')
  expect(lines.filter(line => line.op !== ' ').map(line => `${line.op}${line.t}`)).toEqual(['-c', '+C'])
  expect(lines.some(line => line.op === '~')).toBe(false)
  expect(diffLines('', 'x\ny\n').map(line => line.op)).toEqual(['+', '+'])
})

test('the tree lists folders first, folds one, and hides reads when asked', () => {
  let log = touch(emptyLog(), 'src/a.ts', 'edit')
  log = commit(log, 'src/a.ts', 'Edit', 'edit', '', diffLines('x\n', 'y\nz\n'))
  log = touch(log, 'src/b.ts', 'read')
  log = touch(log, 'top.md', 'new')
  expect(rowsOf(log, [], true).map(row => `${row.depth}${row.isDir ? 'd' : 'f'}:${row.name}`)).toEqual(['0d:src', '1f:a.ts', '1f:b.ts', '0f:top.md'])
  expect(rowsOf(log, ['src'], true).map(row => row.name)).toEqual(['src', 'top.md'])
  expect(rowsOf(log, [], false).map(row => row.name)).toEqual(['src', 'a.ts', 'top.md'])
  expect(log.files.find(file => file.path === 'src/a.ts')).toMatchObject({ add: 2, del: 1, kind: 'edit' })
})

test('cut counts wide characters as two cells and never splits one', () => {
  expect(cells('設定メモ.md')).toBe(11)
  expect(cut('設定メモ.md', 11)).toBe('設定メモ.md')
  expect(cut('設定メモ.md', 7)).toBe('設定メ…')
  expect(cut('設定メモ.md', 6)).toBe('設定…')
})

test('a wide file name keeps its whole name when the row has the cells for it', async ($, on) => {
  stubs(on)
  await $.tool.call({ tool: 'Read', file_path: '/w/設定メモ.md' } as never)
  const ui = await $.ui.mount(PANE)
  expect(JSON.stringify(await ui.drawn({ in: 'list-0' }))).toContain('"設定メモ.md"')
  await ui.unmount()
})

test('a wide file name too long for its cells is cut on a cell boundary', async ($, on) => {
  stubs(on)
  await $.tool.call({ tool: 'Read', file_path: '/w/設定メモ設定メモ.md' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/w/設定メモ.md' } as never)
  // Narrow pane: the rows get 20 cells, the open mark takes 4 of them, so a name gets 15.
  const narrow = { ...(PANE as object), props: { ...(PANE as { props: object }).props, bodyColumns: 24 } } as never
  const ui = await $.ui.mount(narrow)
  const drawn = JSON.stringify(await ui.drawn({ in: 'list-0' }))
  expect(drawn).toContain('"設定メモ設定メ…"')
  expect(drawn).not.toContain('設定メモ設定メモ')
  expect(drawn).toContain('"設定メモ.md"')
  await ui.unmount()
})

test('the tree starts at the shared folder and merges single-folder chains, like VS Code', () => {
  let log = touch(emptyLog(), 'C:/Users/A/.claude/projects/p/memory/m.md', 'edit')
  log = touch(log, 'C:/Users/A/.claude/skills/x/refs/r.md', 'new')
  expect(rootOf(log, true)).toBe('C:/Users/A/.claude')
  expect(rowsOf(log, [], true).map(row => `${row.depth}${row.isDir ? 'd' : 'f'}:${row.name}`)).toEqual(['0d:projects/p/memory', '1f:m.md', '0d:skills/x/refs', '1f:r.md'])
  expect(rowsOf(log, ['C:/Users/A/.claude/projects/p/memory'], true).map(row => row.name)).toEqual(['projects/p/memory', 'skills/x/refs', 'r.md'])
  expect([iconOf('a.tsx'), iconOf('b.JSON'), iconOf('LICENSE')]).toEqual(['ext-react', 'ext-json', 'file'])
})

test('tool calls fill the tree live, a click opens the diff in the replay, Prev and Next step', async ($, on) => {
  stubs(on)
  await $.turn.start({ turnId: 't1' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/w/src/a.ts' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/w/src/a.ts', old_string: 'x\n', new_string: 'y\nz\n' } as never)
  await $.tool.call({ tool: 'Write', file_path: '/w/docs/new.md', content: 'hi\n' } as never)

  const ui = await $.ui.mount(PANE)
  expect(JSON.stringify(await ui.drawn({ in: 'filetree-tab' }))).toContain('2')
  expect(JSON.stringify(await ui.drawn({ in: 'working' }))).toContain('Working')
  expect(JSON.stringify(await ui.drawn({ in: 'tab-tree' }))).toContain(' Tree ')
  // The folder without docs/new.md folds; new.md's write landed, so it glows, with no action word and no status letter.
  const drawn = JSON.stringify(await ui.drawn({ in: 'list-0' }))
  expect(drawn).not.toContain('creating')
  expect(drawn).not.toContain('"A"')
  // The glow fades with the clock, so the band is a step short of surface-3 once the test runs slowly.
  expect(drawn).toMatch(/"backgroundColor":"#252a4[0-2]"/)
  expect(drawn).toContain('▸')
  expect(drawn).not.toContain('a.ts')
  // The folded src/ carries a.ts's counts, so folding hides no change.
  expect(drawn).toContain('"+2"')
  expect(drawn).toContain('" −1"')
  // A folder the person opens stays open while Claude works; a second click folds it again.
  await pointing(ui).pointer({ in: 'list-0', type: 'down', button: 'left', x: 3, y: 2 })
  expect(JSON.stringify(await ui.drawn({ in: 'list-0' }))).toContain('a.ts')
  await pointing(ui).pointer({ in: 'list-0', type: 'down', button: 'left', x: 3, y: 2 })
  expect(JSON.stringify(await ui.drawn({ in: 'list-0' }))).not.toContain('a.ts')

  await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false, reason: 'end_turn' } as never)
  const idle = JSON.stringify(await ui.drawn({ in: 'list-0' }))
  expect(idle).toContain('a.ts')
  expect(idle).toContain('+2')
  expect(idle).toContain('▾')
  expect(idle).not.toContain('creating')
  // No letters: the name's color carries the status, and the footer names the colors.
  expect(idle).not.toContain('"M"')
  expect(await ui.find({ type: 'Text', text: /Modified/ })).toBeDefined()

  // A click on the fourth row (docs, new.md, src, a.ts) opens a.ts in the replay.
  const click = (key: string, y = 0) => pointing(ui).pointer({ in: key, type: 'down', button: 'left', x: 2, y })
  await click('list-0', 3)
  const replay = async () => JSON.stringify(await ui.drawn())
  expect(await ui.find({ type: 'Text', text: '1 of 2' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'src/a.ts' })).toBeDefined()
  expect(await replay()).toContain('"x"')
  expect(await replay()).toContain('"y"')
  expect(await replay()).toContain(THEME.addBg)
  expect(await replay()).toContain(THEME.delBg)
  // Prev and Next ride on the section's top edge; the open view's option is a washed ok subpill, as on a settings page.
  expect(JSON.stringify(await ui.find({ key: 'replay-edge-right' }))).toContain('replay-next')
  expect(JSON.stringify(await ui.find({ key: 'tab-replay-chosen' }))).toContain(THEME.lifted)
  await click('replay-next')
  expect(await ui.find({ type: 'Text', text: '2 of 2' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'docs/new.md' })).toBeDefined()
  expect(await replay()).toContain('"hi"')
  await click('replay-prev')
  expect(await ui.find({ type: 'Text', text: '1 of 2' })).toBeDefined()

  // Back in the tree, a click on the src folder's row folds it away.
  await click('tab-tree')
  await pointing(ui).pointer({ in: 'list-0', type: 'down', button: 'left', x: 4, y: 2 })
  expect(JSON.stringify(await ui.drawn({ in: 'list-0' }))).not.toContain('a.ts')
  await ui.unmount()
})

test('Windows paths outside the working folder draw from their shared folder', async ($, on) => {
  stubs(on)
  await $.tool.call({ tool: 'Edit', file_path: 'C:\\Users\\A\\.claude\\projects\\p\\memory\\m.md', old_string: 'a', new_string: 'b' } as never)
  await $.tool.call({ tool: 'Edit', file_path: 'C:\\Users\\A\\.claude\\skills\\x\\refs\\recipes.md', old_string: 'a', new_string: 'b' } as never)
  const ui = await $.ui.mount(PANE)
  expect(JSON.stringify(await ui.drawn({ in: 'filetree-tab' }))).toContain('2')
  const drawn = JSON.stringify(await ui.drawn({ in: 'list-0' }))
  expect(drawn).toContain('projects/p/memory')
  expect(drawn).not.toContain('Users')
  await ui.unmount()
})

test('a read-only file has no diff to replay', async ($, on) => {
  stubs(on)
  await $.tool.call({ tool: 'Read', file_path: '/w/only.md' } as never)
  const ui = await $.ui.mount(PANE)
  await pointing(ui).pointer({ in: 'list-0', type: 'down', button: 'left', x: 2, y: 0 })
  expect(await ui.find({ type: 'Text', text: /only\.md was only read/ })).toBeDefined()
  await ui.unmount()
})

// The commands the mod runs, each answered with the given exit code; `code` is not on PATH here.
const launches = (on: Parameters<TestBody>[1]) => {
  const ran: string[] = []
  on('process.run', (_$, e) => {
    const { argv } = e as unknown as { argv: string[] }
    ran.push(argv.join(' '))
    return { value: { exitCode: argv[0] === 'code' ? 1 : 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never
  })
  return ran
}

test("a file row ends in the open mark; a click on it opens the file instead of the row's diff", async ($, on) => {
  stubs(on)
  const ran = launches(on)
  await $.tool.call({ tool: 'Read', file_path: '/w/only.md' } as never)
  const ui = await $.ui.mount(PANE)
  // Safe mode pads the mark inside its surface-3 pill.
  expect(JSON.stringify(await ui.drawn({ in: 'list-0' }))).toContain(`"backgroundColor":"${THEME.surface3}"},"children":[" ↗ "]`)
  // The pane is 70 columns, the rows 64 cells: the mark is the last one.
  await pointing(ui).pointer({ in: 'list-0', type: 'down', button: 'left', x: 63, y: 0 })
  // VS Code first; without it, the system's opener.
  expect(ran).toEqual(['code /w/only.md', 'open /w/only.md'])
  expect(await ui.find({ type: 'Text', text: /^. Opened only\.md in its default app/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /only\.md was only read/ })).toBeUndefined()
  await ui.unmount()
})

const textOf = (node: unknown): string =>
  typeof node === 'string' ? node : Array.isArray(node) ? node.map(textOf).join('') : node && typeof node === 'object' ? textOf((node as { children?: unknown }).children) : ''

test('a row fills the section exactly: the pane less its padding, the section border and its padding', async ($, on) => {
  stubs(on)
  await $.tool.call({ tool: 'Read', file_path: '/w/guard.py' } as never)
  const ui = await $.ui.mount(PANE)
  // A row one cell too wide makes the host clip the last letter of a long name.
  expect(cells(textOf(await ui.drawn({ in: 'list-0' })))).toBe(64)
  await ui.unmount()
})

test('a hovered row, end mark, bar option or tab puts its tip in the pane footer, and leaving clears it', async ($, on) => {
  stubs(on)
  await $.tool.call({ tool: 'Read', file_path: '/w/only.md' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/w/a.ts', old_string: 'x', new_string: 'y' } as never)
  const ui = await $.ui.mount(PANE)
  const footer = (tip: string) => ui.find({ type: 'Text', text: ` · ${tip}` })
  await pointing(ui).pointer({ in: 'list-0', type: 'move', x: 4, y: 0 })
  expect(await footer('replays the edits on this file')).toBeDefined()
  await pointing(ui).pointer({ in: 'list-0', type: 'move', x: 65, y: 0 })
  expect(await footer('opens this file in VS Code')).toBeDefined()
  await pointing(ui).pointer({ in: 'list-0', type: 'move', x: 4, y: 1 })
  expect(await footer('only read, nothing to replay')).toBeDefined()
  await pointing(ui).pointer({ in: 'list-0', type: 'leave', x: 0, y: 0 })
  expect(await footer('only read, nothing to replay')).toBeUndefined()
  await pointing(ui).pointer({ in: 'scope-session', type: 'move', x: 1, y: 0 })
  expect(await footer('files from the whole session')).toBeDefined()
  await pointing(ui).pointer({ in: 'filetree-settings', type: 'move', x: 1, y: 0 })
  expect(await footer('opens this mod\x27s settings')).toBeDefined()
  await ui.unmount()
})

test('a folder row and the footer open their folder in the file manager; a failed start says why', async ($, on) => {
  stubs(on)
  const ran = launches(on)
  await $.tool.call({ tool: 'Read', file_path: '/w/hooks/a.ts' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/w/src/b.ts' } as never)
  const ui = await $.ui.mount(PANE)
  expect(JSON.stringify(await ui.drawn({ in: 'list-0' }))).toContain(' ⊞')
  await pointing(ui).pointer({ in: 'list-0', type: 'down', button: 'left', x: 65, y: 0 })
  expect(await ui.find({ type: 'Text', text: /^. Opened hooks in the file manager/ })).toBeDefined()
  // A click on the mark opens the folder; it does not fold it.
  expect(JSON.stringify(await ui.drawn({ in: 'list-0' }))).toContain('a.ts')
  // The footer's mark opens the session's own folder.
  await pointing(ui).pointer({ in: 'session-reveal', type: 'down', button: 'left', x: 1, y: 0 })
  expect(ran).toEqual(['open /w/hooks', 'open /w'])
  expect(await ui.find({ type: 'Text', text: /^. Opened w in the file manager/ })).toBeDefined()
  await ui.unmount()
})

test('an opener that cannot start says why in the status line', async ($, on) => {
  stubs(on)
  on('process.run', () => {
    throw new Error('spawn open ENOENT')
  })
  await $.tool.call({ tool: 'Read', file_path: '/w/hooks/a.ts' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/w/src/b.ts' } as never)
  const ui = await $.ui.mount(PANE)
  await pointing(ui).pointer({ in: 'session-reveal', type: 'down', button: 'left', x: 1, y: 0 })
  expect(await ui.find({ type: 'Text', text: /Could not open w: \S/ })).toBeDefined()
  await ui.unmount()
})

test('show_reads off hides files Claude only read', { options: { show_reads: false } }, async ($, on) => {
  stubs(on)
  await $.tool.call({ tool: 'Read', file_path: '/w/only.md' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/w/e.md', old_string: 'a', new_string: 'b' } as never)
  const ui = await $.ui.mount(PANE)
  const drawn = JSON.stringify(await ui.drawn({ in: 'list-0' }))
  expect(drawn).toContain('e.md')
  expect(drawn).not.toContain('only.md')
  await ui.unmount()
})

test('icons=nerd leads the kinds and the title with Nerd icons', { options: { icons: 'nerd' } }, async ($, on) => {
  stubs(on)
  await $.tool.call({ tool: 'Edit', file_path: '/w/e.md', old_string: 'a', new_string: 'b' } as never)
  const ui = await $.ui.mount(PANE)
  expect(JSON.stringify(await ui.drawn({ in: 'filetree-tab' }))).toContain(nf(0xeb86))
  expect(JSON.stringify(await ui.drawn({ in: 'list-0' }))).toContain(`${nf(0xe609)} `)
  // The view bar carries labels only: an icon subpill changed the options' widths and shifted the bar on every switch.
  const replayTab = JSON.stringify(await ui.drawn({ in: 'tab-replay' }))
  // On Nerd an idle option is tight: its caps stand in the padding cells, so it can lift to surface-4 under the pointer.
  expect(replayTab).toContain('["Replay"]')
  expect(replayTab).not.toContain(nf(0xea82))
  const list = JSON.stringify(await ui.drawn({ in: 'list-0' }))
  expect(list).toContain(`"color":"${THEME.accent}","backgroundColor":"${THEME.surface3}"},"children":["↗"]`)
  expect(list).toContain(nf(0xe0b6))
  await ui.unmount()
})

test("icons=nerd keeps the view bar's labels in place whichever option is chosen", { options: { icons: 'nerd' } }, async ($, on) => {
  stubs(on)
  await $.tool.call({ tool: 'Edit', file_path: '/w/e.md', old_string: 'a', new_string: 'b' } as never)
  const ui = await $.ui.mount(PANE)
  const layout = async () => {
    const bar = await drawnText(ui, await ui.find({ key: 'view-bar' }))
    return { replayAt: cells(bar.slice(0, bar.indexOf('Replay'))), width: cells(bar) }
  }
  const onTree = await layout()
  await pointing(ui).pointer({ in: 'tab-replay', type: 'down', button: 'left', x: 2, y: 0 })
  expect(await layout()).toEqual(onTree)
  await ui.unmount()
})

test('a file name takes its status color: added green, modified yellow, read blue', { options: { animations: false } }, async ($, on) => {
  stubs(on)
  await $.tool.call({ tool: 'Write', file_path: '/w/new.md', content: 'hi\n' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/w/e.md', old_string: 'a', new_string: 'b' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/w/r.md' } as never)
  const ui = await $.ui.mount(PANE)
  const drawn = JSON.stringify(await ui.drawn({ in: 'list-0' }))
  expect(drawn).toContain('"color":"#49EF95"},"children":["new.md"]')
  expect(drawn).toContain('"color":"#FFCB6B"},"children":["e.md"]')
  expect(drawn).toContain('"color":"#B9C6F5"},"children":["r.md"]')
  await ui.unmount()
})

test('icons=safe draws no Nerd glyph', { options: { icons: 'safe' } }, async ($, on) => {
  stubs(on)
  await $.tool.call({ tool: 'Edit', file_path: '/w/e.md', old_string: 'a', new_string: 'b' } as never)
  const ui = await $.ui.mount(PANE)
  expect(JSON.stringify(await ui.drawn({ in: 'filetree-tab' }))).toContain('▸')
  expect(JSON.stringify(await ui.drawn({ in: 'list-0' }))).toContain('e.md')
  expect(await ui.find({ type: 'Text', text: /Modified/ })).toBeDefined()
  expect(JSON.stringify(await ui.drawn())).not.toMatch(/[\uE000-\uF8FF\u{F0000}-\u{FFFFD}]/u)
  await ui.unmount()
})

test('the settings pane shows the mod settings and its clear action', async ($, on) => {
  stubs(on)
  on('config.list', () => ({
    value: [
      { key: 'mod-file-tree.show_reads', label: 'Show files Claude only read', kind: 'boolean', value: true, description: 'd' },
    ],
  }) as never)
  await $.tool.call({ tool: 'Edit', file_path: '/w/e.md', old_string: 'a', new_string: 'b' } as never)
  const ui = await $.ui.mount({ ...(PANE as object), requestId: 'filetree-settings' } as never)
  expect(JSON.stringify(await ui.drawn({ in: 'filetree-settings' }))).toContain('Settings')
  expect(await ui.find({ type: 'Text', text: 'Show files Claude only read' })).toBeDefined()
  await ui.unmount()
})

test("icons=nerd keeps a settings choice bar's labels in place whichever option is chosen", { options: { icons: 'nerd' } }, async ($, on) => {
  stubs(on)
  let value = 'one'
  on('config.list', () => ({
    value: [{ key: 'mod-file-tree.sort', label: 'Sort', kind: 'choice', value, options: ['one', 'two', 'three'], description: 'd' }],
  }) as never)
  const layout = async () => {
    const ui = await $.ui.mount({ ...(PANE as object), requestId: 'filetree-settings' } as never)
    const bar = await drawnText(ui, await ui.find({ key: 'setting-0-bar' }))
    await ui.unmount()
    expect(bar).toContain(nf(0xe0b6))
    return { twoAt: cells(bar.slice(0, bar.indexOf('two'))), width: cells(bar) }
  }
  const onOne = await layout()
  value = 'three'
  expect(await layout()).toEqual(onOne)
})

for (const nerd of [false, true]) {
  test(`icons=${nerd ? 'nerd' : 'safe'} draws a settings choice as one track, no rails, and every cell of an option picks it`, { options: { icons: nerd ? 'nerd' : 'safe' } }, async ($, on) => {
    stubs(on)
    const saved: unknown[] = []
    on('config.list', () => ({
      value: [{ key: 'mod-file-tree.sort', label: 'Sort', kind: 'choice', value: 'one', options: ['one', 'two', 'three'], description: 'd' }],
    }) as never)
    on('config.set', ((_$: unknown, e: { value: unknown }) => {
      saved.push(e.value)
      return { value: e.value }
    }) as never)
    const ui = pointing(await $.ui.mount({ ...(PANE as object), requestId: 'filetree-settings' } as never))
    const bar = await drawnText(ui, await ui.find({ key: 'setting-0-bar' }))
    const [left, right] = [nf(0xe0b6), nf(0xe0b4)]
    // On Nerd every option is capped: the chosen one in surface-4, the idle ones in the track's colour until the pointer lifts them.
    expect(bar).toBe(nerd ? `${left}${left}one${right}${left}two${right}${left}three${right}${right}` : '  one  two  three  ')
    // The hit area of an option is the cells its own Client draws, whatever the caps around it.
    for (const [at, word] of ['one', 'two', 'three'].entries()) {
      const width = cells(await drawnText(ui, await ui.find({ key: `setting-0-option-${at}` })))
      expect(width).toBe(word.length + (nerd ? 0 : 2))
      for (const x of [0, width - 1]) await ui.pointer({ in: `setting-0-option-${at}`, type: 'down', button: 'left', x, y: 0 })
    }
    expect(saved).toEqual(['one', 'one', 'two', 'two', 'three', 'three'])
    await ui.unmount()
  })
}

test('the title row pill swaps the panel for its settings and back', async ($, on) => {
  const opened: string[] = []
  stubs(on, opened)
  on('config.list', () => ({ value: [] }) as never)
  const ui = await $.ui.mount(PANE)
  expect(JSON.stringify(await ui.drawn({ in: 'filetree-settings' }))).toContain('Settings')
  await pointing(ui).pointer({ in: 'filetree-settings', type: 'down', button: 'left', x: 1, y: 0 })
  expect(opened).toEqual(['filetree-settings'])
  await ui.unmount()

  const settings = await $.ui.mount({ ...(PANE as object), requestId: 'filetree-settings' } as never)
  expect(JSON.stringify(await settings.drawn({ in: 'filetree-tab' }))).toContain('Files')
  await pointing(settings).pointer({ in: 'filetree-tab', type: 'down', button: 'left', x: 1, y: 0 })
  expect(opened).toEqual(['filetree-settings', 'filetree'])
  await settings.unmount()
})

test('the live action word sits in its own pill', async ($, on) => {
  stubs(on)
  await $.turn.start({ turnId: 't1' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/w/live.ts' } as never)
  const ui = await $.ui.mount(PANE)
  const drawn = JSON.stringify(await ui.drawn({ in: 'list-0' }))
  expect(drawn).toContain('"color":"#B9C6F5","backgroundColor":"#242839"},"children":["reading"]')
  await ui.unmount()
})

test('the Files pill opens the pane from the band', async ($, on) => {
  const opened: string[] = []
  stubs(on, opened)
  on('state.get', () => ({ value: false, version: 0 }) as never)
  const band = await $.ui.mount({
    plugin: 'mod-file-tree',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 80, scroll: { offset: 0, bodyRows: 6 }, view: {} },
  } as never)
  expect(JSON.stringify(await band.drawn({ in: 'menu-entry-filetree' }))).toContain('Files')
  await pointing(band).pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'menu-entry-filetree' } as never)
  expect(opened).toContain('filetree')
  await band.unmount()
})

test('a band tip whose entry was redrawn while hovered clears after 5 s with no newer hover', async ($, on) => {
  const seen: Parameters<typeof stubs>[4] = {}
  stubs(on, [], undefined, [], seen)
  on('state.get', () => ({ value: false, version: 0 }) as never)
  const clock = seen.clock!
  const band = {
    plugin: 'mod-file-tree',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 80, scroll: { offset: 0, bodyRows: 6 }, view: {} },
  } as never
  // Live, a band redraw mid-turn replaced the hovered entry, so its own quiet timer, and the leave, never came.
  const first = await $.ui.mount(band)
  await pointing(first).pointer({ type: 'move', x: 1, y: 0, in: 'menu-entry-filetree' } as never)
  await first.unmount()
  // The pill's tip text also sits in the Client props, so only the tip row's Text says whether it shows.
  const showsNow = async () => {
    const ui = await $.ui.mount(band)
    const shown = (await ui.find({ type: 'Text', text: /what Claude read and changed/ })) !== undefined
    await ui.unmount()
    return shown
  }
  expect(await showsNow()).toBe(true)
  await clock.advance(4000)
  expect(await showsNow()).toBe(true)
  await clock.advance(1000)
  expect(await showsNow()).toBe(false)
})

test('mod-menu labels never leaves the Files entry as its icon alone', { options: { icons: 'nerd' } }, async ($, on) => {
  stubs(on, [])
  on('state.get', (_$, e) => ({ value: { value: e.plugin === 'mod-menu' && e.key === 'labels' ? 'never' : undefined } }) as never)
  const band = await $.ui.mount({
    plugin: 'mod-file-tree',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 80, scroll: { offset: 0, bodyRows: 6 }, view: {} },
  } as never)
  const entry = JSON.stringify(await band.drawn({ in: 'menu-entry-filetree' }))
  expect(entry).toContain('"backgroundColor"')
  expect(entry).not.toContain('Files')
  await band.unmount()
})

test("icons=nerd keeps the band's menu row the same width whether the pane is open or not", { options: { icons: 'nerd' } }, async ($, on) => {
  const placed: string[] = []
  stubs(on, [], undefined, placed)
  on('state.get', () => ({ value: false, version: 0 }) as never)
  const layout = async () => {
    const band = await $.ui.mount({
      plugin: 'mod-file-tree',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 80, scroll: { offset: 0, bodyRows: 6 }, view: {} },
    } as never)
    const row = await drawnText(band, await band.find({ key: 'menu-row' }))
    await band.unmount()
    return { filesAt: cells(row.slice(0, row.indexOf('Files'))), width: cells(row) }
  }
  const closed = await layout()
  placed.push('filetree')
  expect(await layout()).toEqual(closed)
})

// Transcript rows as Claude Code writes them: a prompt, tool uses, and their results with the stored patch.
let uuid = 0
const jrow = (fields: object) => JSON.stringify({ uuid: `u${(uuid += 1)}`, ...fields })
const prompt = (text: string) => jrow({ type: 'user', message: { role: 'user', content: text } })
const use = (id: string, name: string, input: object) => jrow({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } })
const result = (id: string, toolUseResult: object = {}, isError = false) =>
  jrow({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok', is_error: isError }] }, toolUseResult })
const PATCH = { structuredPatch: [{ lines: [' keep', '-old', '+new', '+more'] }] }

const SESSION = [
  prompt('fix the parser'),
  use('t-read', 'Read', { file_path: 'C:\\repo\\src\\a.ts' }),
  result('t-read'),
  use('t-edit', 'Edit', { file_path: 'C:\\repo\\src\\a.ts', old_string: 'old', new_string: 'new\nmore' }),
  result('t-edit', PATCH),
  use('t-bad', 'Edit', { file_path: 'C:\\repo\\src\\b.ts', old_string: 'x', new_string: 'y' }),
  result('t-bad', {}, true),
  prompt('now the docs'),
  use('t-write', 'Write', { file_path: 'C:\\repo\\docs\\new.md', content: 'one\ntwo\n' }),
  result('t-write', { type: 'create', content: 'one\ntwo\n' }),
  '',
].join('\n')

test('a prompt sent mid-turn with an image, stored as content blocks, opens a turn; a meta one does not', () => {
  const parsed = new TranscriptFiles('/w')
  const queued = (isMeta: boolean, text: string) => jrow({ type: 'attachment', attachment: { type: 'queued_command', isMeta, prompt: [{ type: 'text', text }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBOR' } }] } })
  for (const line of [prompt('first'), queued(false, '[Image #1] the header'), queued(true, '<task-notification>done</task-notification>')]) parsed.feed(line)
  expect(parsed.log.turn).toBe(2)
})

test('the transcript rebuilds every file and edit: the stored patch, a new file, and no step for a failed edit', () => {
  const parsed = new TranscriptFiles('C:\\repo')
  for (const line of SESSION.split('\n')) if (line) parsed.feed(line)
  const { log } = parsed
  expect(log.turn).toBe(2)
  expect(log.files.map(file => `${file.path}:${file.kind}:+${file.add}-${file.del}`)).toEqual(['src/a.ts:edit:+2-1', 'src/b.ts:edit:+0-0', 'docs/new.md:new:+2-0'])
  expect(log.steps.map(step => `${step.turn} ${step.tool} ${step.path} ${step.note}`)).toEqual(['1 Edit src/a.ts ', '2 Write docs/new.md new file'])
  expect(log.steps[0]!.lines.map(line => `${line.op}${line.t}`)).toEqual([' keep', '-old', '+new', '+more'])
  expect(turnView(log).files.map(file => file.path)).toEqual(['docs/new.md'])
})

test('a subagent\'s edits rebuild into the tree like live ones, and its prompt opens no turn', () => {
  const parsed = new TranscriptFiles('/w')
  const side = (line: string) => JSON.stringify({ ...JSON.parse(line), isSidechain: true })
  for (const line of [prompt('first'), side(prompt('subagent brief')), side(use('t-side', 'Edit', { file_path: '/w/side.ts', old_string: 'a', new_string: 'b' })), side(result('t-side', PATCH))]) parsed.feed(line)
  expect(parsed.log.turn).toBe(1)
  expect(parsed.log.files.map(file => file.path)).toEqual(['side.ts'])
})

test('a MultiEdit call fills the live tree as an edit', async ($, on) => {
  stubs(on)
  await $.tool.call({ tool: 'MultiEdit', file_path: '/w/multi.ts', edits: [{ old_string: 'a', new_string: 'b' }] } as never)
  const ui = await $.ui.mount(PANE)
  expect(JSON.stringify(await ui.drawn({ in: 'list-0' }))).toContain('multi.ts')
  await ui.unmount()
})

test('transcript paths untouched for 30 days are deleted at session start, a bare path from an older version gets an age', async ($, on) => {
  const now = Date.UTC(2026, 9, 5, 16, 52)
  const day = 24 * 60 * 60 * 1000
  const store = new Map<string, unknown>([
    ['transcript:stale', { path: '/t/old.jsonl', at: now - 31 * day }],
    ['transcript:fresh', { path: '/t/new.jsonl', at: now - 29 * day }],
    ['transcript:bare', '/t/bare.jsonl'],
    ['other', 'kept'],
  ])
  stubs(on, [], undefined, [], { store, now })
  on('session.start', () => ({ cwd: '/w' }))
  on('command.register', () => ({ value: { command: 'mod-file-tree' } }))
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true } as never)
  expect(store.has('transcript:stale')).toBe(false)
  expect(store.get('transcript:fresh')).toEqual({ path: '/t/new.jsonl', at: now - 29 * day })
  expect(store.get('transcript:bare')).toEqual({ path: '/t/bare.jsonl', at: expect.any(Number) })
  expect(store.get('other')).toBe('kept')
})

test('a resumed session, with nothing in $.state, shows the files from its transcript', async ($, on) => {
  const transcript = { text: SESSION.replace(/C:\\\\repo/g, '/w'), reads: 0 }
  stubs(on, [], transcript)
  const ui = await $.ui.mount(PANE)
  // This turn is the default view; Session shows the whole transcript.
  expect(JSON.stringify(await ui.drawn({ in: 'list-0' }))).not.toContain('a.ts')
  await pointing(ui).pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'scope-session' } as never)
  const drawn = JSON.stringify(await ui.drawn({ in: 'list-0' }))
  expect(drawn).toContain('a.ts')
  expect(drawn).toContain('new.md')
  expect(drawn).toContain('+2')
  await ui.unmount()
})

test('the transcript is read once; later calls add on top, and the transcript growing does not re-read it', async ($, on) => {
  const transcript = { text: [prompt('first'), use('t-old', 'Edit', { file_path: '/w/old.ts', old_string: 'a', new_string: 'b' }), result('t-old', PATCH), ''].join('\n'), reads: 0 }
  stubs(on, [], transcript)
  await $.turn.start({ turnId: 't1' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/w/fresh.ts', old_string: 'x\n', new_string: 'y\n' } as never)
  transcript.text += [prompt('second'), use('t-fresh', 'Edit', { file_path: '/w/fresh.ts', old_string: 'x\n', new_string: 'y\n' }), result('t-fresh', PATCH), ''].join('\n')
  await $.turn.complete({ turnId: 't1', reason: 'answer', answer: 'ok', isAborted: false } as never)
  expect(transcript.reads).toBe(1)

  const ui = await $.ui.mount(PANE)
  const turn = JSON.stringify(await ui.drawn({ in: 'list-0' }))
  expect(turn).toContain('fresh.ts')
  expect(turn).not.toContain('old.ts')
  await pointing(ui).pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'scope-session' } as never)
  expect(JSON.stringify(await ui.drawn({ in: 'filetree-tab' }))).toContain('2')
  expect(JSON.stringify(await ui.drawn({ in: 'list-0' })).match(/fresh\.ts/g)).toHaveLength(1)
  await ui.unmount()
})

test('a session with many files draws in several lists, and a click in a later one opens the right file', async ($, on) => {
  const reads = Array.from({ length: 150 }, (_, n) => [use(`t-${n}`, 'Read', { file_path: `/w/f${String(n).padStart(3, '0')}.ts` }), result(`t-${n}`)]).flat()
  const transcript = { text: [prompt('read them all'), ...reads, use('t-edit', 'Edit', { file_path: '/w/f145.ts', old_string: 'a', new_string: 'b' }), result('t-edit', PATCH), ''].join('\n'), reads: 0 }
  stubs(on, [], transcript)
  const ui = await $.ui.mount(PANE)
  expect(JSON.stringify(await ui.drawn({ in: 'list-3' }))).toContain('f145.ts')
  // A click reports its row within that list, and the list adds its offset into the whole tree.
  await pointing(ui).pointer({ type: 'down', x: 2, y: 145 - 3 * 40, button: 'left', in: 'list-3' } as never)
  expect(await ui.find({ type: 'Text', text: /Replaying f145\.ts/ })).toBeDefined()
  await ui.unmount()
})

test('a shell command shows the files it changed: diffed ones with their lines, the rest by name', async ($, on) => {
  stubs(on)
  await $.turn.start({ turnId: 't1' } as never)
  await $.tool.call({ tool: 'Bash', command: "node -e \"fs.writeFileSync('hooks/meter.tsx', ...)\"" } as never)
  // Once the turn ends no row shimmers, so each name is one Text again.
  await $.turn.complete({ turnId: 't1', reason: 'answer', answer: 'ok', isAborted: false } as never)
  const ui = await $.ui.mount(PANE)
  const drawn = JSON.stringify(await ui.drawn({ in: 'list-0' }))
  expect(drawn).toContain('meter.tsx')
  expect(drawn).toContain('levels.ts')
  expect(drawn).toContain('"+2"')
  await ui.unmount()

  const parsed = new TranscriptFiles('/w')
  for (const line of [prompt('edit it'), use('t-sh', 'Bash', { command: 'sed -i s/a/b/ x' }), result('t-sh', { stdout: '', bashEditDiff: SHELL_DIFF })]) parsed.feed(line)
  expect(parsed.log.files.map(file => `${file.path}:+${file.add}-${file.del}`)).toEqual(['hooks/meter.tsx:+2-1', 'hooks/levels.ts:+0-0'])
  expect(parsed.log.steps.map(step => `${step.tool} ${step.note}`)).toEqual(['Bash shell', 'Bash shell, no diff kept'])
})

test('the recent view keeps the files of the last N turns, N from the recent_turns setting', { options: { recent_turns: 2 } }, async ($, on) => {
  const transcript = {
    text: [
      prompt('long ago'),
      use('t-1', 'Edit', { file_path: '/w/old.ts', old_string: 'a', new_string: 'b' }),
      result('t-1', PATCH),
      prompt('recent'),
      use('t-2', 'Edit', { file_path: '/w/recent.ts', old_string: 'a', new_string: 'b' }),
      result('t-2', PATCH),
      prompt('now'),
      use('t-3', 'Read', { file_path: '/w/now.ts' }),
      result('t-3'),
      '',
    ].join('\n'),
    reads: 0,
  }
  stubs(on, [], transcript)
  const ui = await $.ui.mount(PANE)
  expect(JSON.stringify(await ui.drawn({ in: 'scope-recent' }))).toContain('Last 2 turns')
  await pointing(ui).pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'scope-recent' } as never)
  const recent = JSON.stringify(await ui.drawn({ in: 'list-0' }))
  expect(recent).toContain('recent.ts')
  expect(recent).toContain('now.ts')
  expect(recent).not.toContain('old.ts')
  await ui.unmount()
})

test('the file Claude is on shimmers: its name draws a letter at a time, in a band that sweeps across', async ($, on) => {
  stubs(on)
  await $.turn.start({ turnId: 't1' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/w/live.ts' } as never)
  const ui = await $.ui.mount(PANE)
  const lettersOf = async () => JSON.stringify(await ui.drawn({ in: 'list-0' })).match(/"children":\["[a-z.]"\]/g)?.length ?? 0
  expect(await lettersOf()).toBe('live.ts'.length)
  // The live row sits on its own band, Moonlight surface-3.
  expect(JSON.stringify(await ui.drawn({ in: 'list-0' }))).toContain('#252A42')
  await $.turn.complete({ turnId: 't1', reason: 'answer', answer: 'ok', isAborted: false } as never)
  expect(await lettersOf()).toBe(0)
  await ui.unmount()
})

test('animations off: the file Claude is on draws whole, without the shimmer', { options: { animations: false } }, async ($, on) => {
  stubs(on)
  await $.turn.start({ turnId: 't1' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/w/live.ts' } as never)
  const ui = await $.ui.mount(PANE)
  const drawn = JSON.stringify(await ui.drawn({ in: 'list-0' }))
  expect(drawn).toContain('"live.ts"')
  expect(drawn).toContain('#252A42')
  await ui.unmount()
})

test('clear hides what came before it, though the transcript still holds it', async ($, on) => {
  const transcript = { text: SESSION.replace(/C:\\\\repo/g, '/w'), reads: 0 }
  stubs(on, [], transcript)
  await $.command.run({ command: 'mod-file-tree', args: 'clear' } as never)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^No files touched yet/ })).toBeDefined()
  await ui.unmount()
})

// One process that switches sessions: each session's transcript is <id>.jsonl in a projects folder; held: a read of it waits until released.
const editOf = (id: string, path: string) => [prompt(`edit ${path}`), use(id, 'Edit', { file_path: path, old_string: 'a', new_string: 'b' }), result(id, PATCH), ''].join('\n')

function sessions(on: Parameters<TestBody>[1], files: Record<string, string>) {
  const w = { session: 'a', files, held: null as Promise<void> | null }
  const idOf = (path: string) => path.replace(/\\/g, '/').match(/\/([^/]+)\.jsonl$/)?.[1] ?? ''
  on('session.cwd', () => ({ value: '/w' }))
  on('session.id', () => ({ value: w.session }))
  on('env.get', (_$, e) => ({ value: e.name === 'USERPROFILE' ? '/h' : undefined }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('fs.list', () => ({ value: [{ name: 'p', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] }))
  on('fs.exists', (_$, e) => ({ value: idOf(e.path) in w.files }))
  on('fs.read', async (_$, e) => {
    // Only the transcript read is slow; the bridge file is a small local read.
    if (w.held && !e.path.replace(/\\/g, '/').includes('/bridge/')) await w.held
    return { value: w.files[idOf(e.path)] ?? '' }
  })
  on('ui.panes', () => ({ value: [] }))
  on('tool.call', () => ({ result: { text: 'ok' } }) as never)
  on('session.start', () => ({ cwd: '/w' }) as never)
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  const clock = mock.clock(on)
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })
  return { w, clock }
}

// The whole session's tree, as the Session scope draws it.
const sessionTree = async (ui: Mounted) => {
  await pointing(ui).pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'scope-session' } as never)
  return JSON.stringify(await ui.drawn({ in: 'list-0' }).catch(() => ''))
}

test('a resume to another session and back shows each session\'s own files, with no SessionStart', async ($, on) => {
  const { w, clock } = sessions(on, { a: editOf('ta', '/w/alpha.ts'), b: editOf('tb', '/w/beta.ts') })
  await $.session.start({ cwd: '/w' } as never)
  let ui = await $.ui.mount(PANE)
  expect(await sessionTree(ui)).toContain('alpha.ts')
  await ui.unmount()

  await $.session.end({ reason: 'resume', sessionId: 'a', resume: {} } as never)
  w.session = 'b'
  ui = await $.ui.mount(PANE)
  await clock.settle()
  const resumed = await sessionTree(ui)
  expect(resumed).toContain('beta.ts')
  expect(resumed).not.toContain('alpha.ts')
  await ui.unmount()

  await $.session.end({ reason: 'resume', sessionId: 'b', resume: {} } as never)
  w.session = 'a'
  ui = await $.ui.mount(PANE)
  await clock.settle()
  const back = await sessionTree(ui)
  expect(back).toContain('alpha.ts')
  expect(back).not.toContain('beta.ts')
  await ui.unmount()
})

test('/clear starts an empty tree: no file of the session before it', async ($, on) => {
  const { w, clock } = sessions(on, { a: editOf('ta', '/w/alpha.ts') })
  await $.session.start({ cwd: '/w' } as never)
  await $.session.end({ reason: 'clear', sessionId: 'a', resume: {} } as never)
  w.session = 'c'
  const ui = await $.ui.mount(PANE)
  await clock.settle()
  expect(await sessionTree(ui)).not.toContain('alpha.ts')
  await ui.unmount()
})

test('a slow transcript read never holds up session.start, and an edit made while it reads is kept', async ($, on) => {
  const { w, clock } = sessions(on, { a: editOf('ta', '/w/alpha.ts') })
  let release = () => {}
  w.held = new Promise<void>(resolve => (release = resolve))
  let isStarted = false
  const starting = $.session.start({ cwd: '/w' } as never).then(() => (isStarted = true))
  await clock.advance(400)
  expect(isStarted).toBe(true)
  await $.tool.call({ tool: 'Edit', file_path: '/w/fresh.ts', old_string: 'x\n', new_string: 'y\n' } as never)
  w.held = null
  release()
  await starting
  await clock.settle()
  const ui = await $.ui.mount(PANE)
  const tree = await sessionTree(ui)
  expect(tree).toContain('alpha.ts')
  expect(tree).toContain('fresh.ts')
  await ui.unmount()
})

// A stand-in surface that counts running timers, since a long tree mounts several lists.
function fakeSurface() {
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
  return { surface, running, point: (event: object) => pointer(event), tick: () => [...running].forEach(fn => fn()) }
}

test('a list at rest runs no timer; a live row moves it until it settles, and a hover fades it out', () => {
  const row = (tone: ListRow['tone']): ListRow => ({ guides: '', mark: '', name: 'a.ts', tone, add: 0, del: 0, status: '', pad: 0, endMark: '', endColor: THEME.pill, tip: '', tipLabel: '', openTip: '' })
  const props = (tone: ListRow['tone']) => ({ rows: [row(tone)], width: 30, glyph: '', openLabel: '' })
  const list = fakeSurface()
  FileList(props('changed'), list.surface)
  expect(list.running.size).toBe(0)
  FileList(props('live'), list.surface)
  // The shimmer's timer and the spinner's own 80 ms one.
  expect(list.running.size).toBe(2)
  FileList(props('changed'), list.surface)
  list.tick()
  expect(list.running.size).toBe(0)
  list.point({ type: 'move', x: 1, y: 0 })
  FileList(props('changed'), list.surface)
  list.point({ type: 'leave', x: 1, y: 0 })
  for (let n = 0; n < 6; n++) list.tick()
  expect(list.running.size).toBe(0)
})

test('session.start registers the command and /mod-file-tree toggles the pane', async ($, on) => {
  const opened: string[] = []
  const registered: string[] = []
  stubs(on, opened)
  on('session.start', () => ({ cwd: '/w' }) as never)
  on('command.register', (_$, e) => {
    registered.push(e.name)
    return { value: undefined } as never
  })
  await $.session.start({ cwd: '/w' } as never)
  expect(registered).toEqual(['mod-file-tree'])
  await $.command.run({ command: 'mod-file-tree', args: 'settings' } as never)
  expect(opened).toEqual(['filetree-settings'])
})

const FOLDERS = async ($: Parameters<TestBody>[0]) => {
  await $.tool.call({ tool: 'Edit', file_path: '/w/src/a.ts', old_string: 'x', new_string: 'y' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/w/src/deep/b.ts', old_string: 'x', new_string: 'y' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/w/docs/c.md', old_string: 'x', new_string: 'y' } as never)
}

test('one toggle at the tree heading row\'s right end folds every folder, then turns into Unfold all and opens them', async ($, on) => {
  stubs(on)
  await FOLDERS($)
  const ui = await $.ui.mount(PANE)
  const head = async () => JSON.stringify(await ui.find({ key: 'tree-edge-right' }))
  // The expand standard: the arrow before a muted label, and only one of the two at a time.
  expect(await head()).toMatch(/"id":"fold-all","label":"Fold all".*"lead":"▴"/)
  expect(await head()).not.toContain('unfold-all')
  const tree = async () => JSON.stringify(await ui.drawn({ in: 'list-0' }))
  const click = (key: string) => pointing(ui).pointer({ in: key, type: 'down', button: 'left', x: 2, y: 0 })
  expect(await tree()).toContain('b.ts')
  await click('fold-all')
  const shut = await tree()
  expect(shut).toContain('src')
  expect(shut).toContain('docs')
  for (const name of ['a.ts', 'deep', 'b.ts', 'c.md']) expect(shut).not.toContain(name)
  expect(await head()).toMatch(/"id":"unfold-all","label":"Unfold all".*"lead":"▾"/)
  expect(await head()).not.toContain('"id":"fold-all"')
  await click('unfold-all')
  const open = await tree()
  for (const name of ['a.ts', 'deep', 'b.ts', 'c.md']) expect(open).toContain(name)
  await ui.unmount()
})

test('Fold all and Unfold all also work while the live fold holds folders shut', async ($, on) => {
  stubs(on)
  await $.turn.start({ turnId: 't1' } as never)
  await FOLDERS($)
  const ui = await $.ui.mount(PANE)
  expect(JSON.stringify(await ui.drawn({ in: 'list-0' }))).not.toContain('a.ts')
  await pointing(ui).pointer({ in: 'unfold-all', type: 'down', button: 'left', x: 2, y: 0 })
  expect(JSON.stringify(await ui.drawn({ in: 'list-0' }))).toContain('a.ts')
  await pointing(ui).pointer({ in: 'fold-all', type: 'down', button: 'left', x: 2, y: 0 })
  expect(JSON.stringify(await ui.drawn({ in: 'list-0' }))).not.toContain('a.ts')
  await ui.unmount()
})

test('the fold toggle shows its tip in the pane footer either way, and draws no Nerd glyph in safe mode', { options: { icons: 'safe' } }, async ($, on) => {
  stubs(on)
  await FOLDERS($)
  const ui = await $.ui.mount(PANE)
  await pointing(ui).pointer({ in: 'fold-all', type: 'move', x: 1, y: 0 })
  expect(await ui.find({ type: 'Text', text: ' · folds every folder in the tree' })).toBeDefined()
  await pointing(ui).pointer({ in: 'fold-all', type: 'down', button: 'left', x: 2, y: 0 })
  await pointing(ui).pointer({ in: 'unfold-all', type: 'move', x: 1, y: 0 })
  expect(await ui.find({ type: 'Text', text: ' · opens every folder in the tree' })).toBeDefined()
  expect(JSON.stringify(await ui.drawn())).not.toMatch(/[\uE000-\uF8FF\u{F0000}-\u{FFFFD}]/u)
  await ui.unmount()
})

test('a click on the fold toggle swaps the footer tip to the control now under the pointer, with no move', async ($, on) => {
  stubs(on)
  await FOLDERS($)
  const ui = await $.ui.mount(PANE)
  await pointing(ui).pointer({ in: 'fold-all', type: 'move', x: 1, y: 0 })
  await pointing(ui).pointer({ in: 'fold-all', type: 'down', button: 'left', x: 2, y: 0 })
  expect(await ui.find({ type: 'Text', text: ' · opens every folder in the tree' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' · folds every folder in the tree' })).toBeUndefined()
  await ui.unmount()
})

test('icons=nerd draws the fold toggle with the caret arrows', { options: { icons: 'nerd' } }, async ($, on) => {
  stubs(on)
  await FOLDERS($)
  const ui = await $.ui.mount(PANE)
  expect(JSON.stringify(await ui.drawn({ in: 'fold-all' }))).toContain(nf(0xf0d8))
  await pointing(ui).pointer({ in: 'fold-all', type: 'down', button: 'left', x: 2, y: 0 })
  expect(JSON.stringify(await ui.drawn({ in: 'unfold-all' }))).toContain(nf(0xf0d7))
  await ui.unmount()
})

test('the open mark lights like a Button pill under the pointer: body accent, glyph inverted, caps accent', { options: { icons: 'nerd' } }, async ($, on) => {
  stubs(on)
  await $.tool.call({ tool: 'Read', file_path: '/w/only.md' } as never)
  const ui = await $.ui.mount(PANE)
  const rest = JSON.stringify(await ui.drawn({ in: 'list-0' }))
  expect(rest).toContain(`"color":"${THEME.accent}","backgroundColor":"${THEME.surface3}"},"children":["↗"]`)
  await pointing(ui).pointer({ in: 'list-0', type: 'move', x: 61, y: 0 })
  const lit = JSON.stringify(await ui.drawn({ in: 'list-0' }))
  expect(lit).toContain(`"color":"${THEME.surface3}","backgroundColor":"${THEME.accent}"},"children":["↗"]`)
  expect(lit).toContain(`"color":"${THEME.accent}"},"children":["${nf(0xe0b6)}"]`)
  await ui.unmount()
})

test('the open mark stays unlit while the pointer is on the row text, and the row lifts instead', async ($, on) => {
  stubs(on)
  await $.tool.call({ tool: 'Read', file_path: '/w/only.md' } as never)
  const ui = await $.ui.mount(PANE)
  await pointing(ui).pointer({ in: 'list-0', type: 'move', x: 4, y: 0 })
  const drawn = JSON.stringify(await ui.drawn({ in: 'list-0' }))
  expect(drawn).not.toContain(`"backgroundColor":"${THEME.accent}"`)
  expect(drawn).toContain(`"backgroundColor":"${THEME.lifted}"`)
  expect(drawn).toContain(`"color":"${THEME.accent}"},"children":["only.md"]`)
  await ui.unmount()
})

test('the open mark fades out in steps after the pointer leaves, and at once with animations off', () => {
  const row: ListRow = { guides: '', mark: '', name: 'a.ts', tone: 'read', add: 0, del: 0, status: '', pad: 0, endMark: '↗', endColor: THEME.accent, tip: '', tipLabel: '', openTip: 't' }
  const props = (still: boolean) => ({ rows: [row], width: 30, glyph: '', openLabel: '', still })
  const list = fakeSurface()
  FileList(props(false), list.surface)
  list.point({ type: 'move', x: 28, y: 0 })
  FileList(props(false), list.surface)
  expect(list.surface.state.marks[0]).toBe(2)
  list.point({ type: 'leave', x: 28, y: 0 })
  expect(list.surface.state.marks[0]).toBe(1)
  list.tick()
  expect(list.surface.state.marks[0]).toBeUndefined()
  list.tick()
  expect(list.running.size).toBe(0)

  const still = fakeSurface()
  FileList(props(true), still.surface)
  still.point({ type: 'move', x: 28, y: 0 })
  expect(still.surface.state.marks[0]).toBe(2)
  still.point({ type: 'leave', x: 28, y: 0 })
  expect(still.surface.state.marks[0]).toBeUndefined()
})

test('a stepper at its edge does not light or post a tip; an enabled one does, in secondary color', async ($, on) => {
  stubs(on)
  await $.tool.call({ tool: 'Edit', file_path: '/w/a.ts', old_string: 'x', new_string: 'y' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/w/b.ts', old_string: 'x', new_string: 'y' } as never)
  const ui = await $.ui.mount(PANE)
  await pointing(ui).pointer({ in: 'tab-replay', type: 'down', button: 'left', x: 2, y: 0 })
  // The replay opens on the latest edit, so Next is at its edge and Prev is not.
  expect(await ui.find({ key: 'replay-next' })).toBeUndefined()
  expect(JSON.stringify(await ui.find({ key: 'replay-next-edge' }))).toContain(`"color":"${THEME.muted}"`)
  expect(JSON.stringify(await ui.drawn({ in: 'replay-prev' }))).toContain(`"color":"${THEME.secondary}"`)
  await pointing(ui).pointer({ in: 'replay-prev', type: 'move', x: 1, y: 0 })
  expect(await ui.find({ type: 'Text', text: ' · goes to the previous edit' })).toBeDefined()
  await pointing(ui).pointer({ in: 'replay-prev', type: 'down', button: 'left', x: 1, y: 0 })
  expect(await ui.find({ key: 'replay-prev' })).toBeUndefined()
  expect(await ui.find({ key: 'replay-next' })).toBeDefined()
  await ui.unmount()
})

test('the legend draws no rule of its own above the footer, and the footer space does not shrink', async ($, on) => {
  stubs(on)
  await $.tool.call({ tool: 'Edit', file_path: '/w/a.ts', old_string: 'x', new_string: 'y' } as never)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ key: 'legend-rule' })).toBeUndefined()
  expect(await ui.find({ key: 'legend-row' })).toBeDefined()
  expect(JSON.stringify(await ui.find({ key: 'footer-space' }))).toContain('"flexShrink":0')
  expect(JSON.stringify(await ui.drawn())).toMatch(/^\{"type":"Box","props":\{[^}]*"backgroundColor":"#/)
  await ui.unmount()
})

// Records each argv the mod runs, as an array, answering with the given exit code per program.
const recorded = (on: Parameters<TestBody>[1], codeOf: (program: string) => number = () => 0) => {
  const ran: string[][] = []
  on('process.run', (_$, e) => {
    const { argv } = e as unknown as { argv: string[] }
    ran.push(argv)
    return { value: { exitCode: codeOf(argv[0]!), stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never
  })
  return ran
}

test('a Windows file name with shell characters never reaches cmd: the opener gets it as one argument', async ($, on) => {
  stubs(on)
  const ran = recorded(on)
  await $.tool.call({ tool: 'Read', file_path: 'C:/w/a&calc %PATH% ^x.txt' } as never)
  const ui = await $.ui.mount(PANE)
  await pointing(ui).pointer({ in: 'list-0', type: 'down', button: 'left', x: 63, y: 0 })
  expect(ran.length).toBeGreaterThan(0)
  for (const argv of ran) expect(['cmd', 'cmd.exe'].includes(argv[0]!.toLowerCase())).toBe(false)
  expect(ran.some(argv => argv.includes('C:\\w\\a&calc %PATH% ^x.txt'))).toBe(true)
  await ui.unmount()
})

test('on Windows VS Code opens by its Code.exe, found by path and run without a shell', async ($, on) => {
  const exe = 'C:/Users/me/AppData/Local/Programs/Microsoft VS Code/Code.exe'
  stubs(on, [], undefined, [], { env: name => (name === 'LOCALAPPDATA' ? 'C:\\Users\\me\\AppData\\Local' : undefined), exists: path => path === exe })
  const ran = recorded(on)
  await $.tool.call({ tool: 'Read', file_path: 'C:/w/a&calc.txt' } as never)
  const ui = await $.ui.mount(PANE)
  await pointing(ui).pointer({ in: 'list-0', type: 'down', button: 'left', x: 63, y: 0 })
  expect(ran).toEqual([[exe.replace(/\//g, '\\'), 'C:\\w\\a&calc.txt']])
  await ui.unmount()
})

test('a script or program with no VS Code to open it opens its folder, so a click never runs it', async ($, on) => {
  stubs(on)
  const ran = recorded(on)
  await $.tool.call({ tool: 'Read', file_path: 'C:/w/tools/build.bat' } as never)
  const ui = await $.ui.mount(PANE)
  await pointing(ui).pointer({ in: 'list-0', type: 'down', button: 'left', x: 63, y: 0 })
  expect(ran).toEqual([['rundll32.exe', 'url.dll,FileProtocolHandler', 'C:\\w\\tools']])
  await ui.unmount()
})

test('a Windows folder opens through the shell handler, never cmd', async ($, on) => {
  stubs(on)
  const ran = recorded(on)
  await $.tool.call({ tool: 'Read', file_path: 'C:/w/a&b/x.ts' } as never)
  await $.tool.call({ tool: 'Read', file_path: 'C:/w/c/y.ts' } as never)
  const ui = await $.ui.mount(PANE)
  await pointing(ui).pointer({ in: 'list-0', type: 'down', button: 'left', x: 65, y: 0 })
  expect(ran).toEqual([['rundll32.exe', 'url.dll,FileProtocolHandler', 'C:\\w\\a&b']])
  await ui.unmount()
})

test('a state write that fails before a call runs does not drop the call from the tree', async ($, on) => {
  stubs(on, [], undefined, [], { stateFails: { left: 1 } })
  await $.tool.call({ tool: 'Write', file_path: '/w/new.md', content: 'hi\n' } as never)
  const ui = await $.ui.mount(PANE)
  const drawn = JSON.stringify(await ui.drawn({ in: 'list-0' }))
  expect(drawn).toContain('new.md')
  expect(drawn).toContain('"+1"')
  await ui.unmount()
})

test('a failed load is not kept: the next tool call reads the transcript again', async ($, on) => {
  const transcript = { text: [prompt('first'), use('t-old', 'Edit', { file_path: '/w/old.ts', old_string: 'a', new_string: 'b' }), result('t-old', PATCH), ''].join('\n'), reads: 0 }
  const flaky = { fail: true }
  stubs(on, [], transcript, [], {
    env: name => {
      if (flaky.fail) throw new Error('env unavailable')
      return name === 'USERPROFILE' ? '/h' : undefined
    },
  })
  await $.tool.call({ tool: 'Read', file_path: '/w/first.ts' } as never)
  flaky.fail = false
  await $.tool.call({ tool: 'Read', file_path: '/w/second.ts' } as never)
  expect(transcript.reads).toBe(1)

  const ui = await $.ui.mount(PANE)
  await pointing(ui).pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'scope-session' } as never)
  const drawn = JSON.stringify(await ui.drawn({ in: 'list-0' }))
  for (const name of ['old.ts', 'first.ts', 'second.ts']) expect(drawn).toContain(name)
  await ui.unmount()
})

test('a transcript that cannot be read says so in the pane instead of "No files touched yet"', async ($, on) => {
  stubs(on, [], { text: [prompt('first'), ''].join('\n'), reads: 0 }, [], { readFails: 'permission denied' })
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^Can't read this session's transcript: \S/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^No files touched yet/ })).toBeUndefined()
  await ui.unmount()
})

test('a session with no transcript yet keeps the plain empty look', async ($, on) => {
  stubs(on, [], { text: '', reads: 0 })
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^No files touched yet/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Can't read/ })).toBeUndefined()
  await ui.unmount()
})

test('CLAUDE_CONFIG_DIR moves the projects folder the transcript is searched in', async ($, on) => {
  const transcript = { text: [prompt('first'), ''].join('\n'), reads: 0 }
  const listed: string[] = []
  stubs(on, [], transcript, [], { listed, env: name => (name === 'CLAUDE_CONFIG_DIR' ? '/cfg' : name === 'USERPROFILE' ? '/h' : undefined) })
  await $.tool.call({ tool: 'Read', file_path: '/w/a.ts' } as never)
  expect(listed).toEqual(['/cfg/projects'])
})

test('without CLAUDE_CONFIG_DIR the projects folder is under the home folder', async ($, on) => {
  const transcript = { text: [prompt('first'), ''].join('\n'), reads: 0 }
  const listed: string[] = []
  stubs(on, [], transcript, [], { listed })
  await $.tool.call({ tool: 'Read', file_path: '/w/a.ts' } as never)
  expect(listed).toEqual(['/h/.claude/projects'])
})

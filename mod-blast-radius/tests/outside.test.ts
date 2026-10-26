// mod-blast-radius / tests/outside.test.ts, by v-amorim
// Tests the checks that let a delete outside the session folder go to the bin: keep entries, the ledger's pending paths, birth times.
import { expect, test } from 'claude-code/testing'

import { approvalKey, approveOutside, birthArgv, compileKeep, isPending, parseBirths, WALK_CAP, type OutsideFs, type Standing } from '../hooks/outside'

const HOME = 'C:/Users/me'
const ROOT = 'C:/work/app'
const STARTED = 1000

type Node = { kind: 'file' | 'dir'; isLink?: boolean; born?: number | null }

// A disk of folders and files, with the birth time of each; a folder's own reads as its oldest entry's.
function disk(nodes: Record<string, Node>, own: { births?: string[][] } = {}): OutsideFs {
  const under = (path: string) => Object.keys(nodes).filter(item => item === path || item.startsWith(`${path}/`))
  return {
    stat: async path => {
      const node = nodes[path]
      if (!node) throw new Error('ENOENT')
      return { kind: node.kind, isLink: node.isLink === true }
    },
    exists: async path => path in nodes,
    list: async path => Object.keys(nodes).filter(item => item.startsWith(`${path}/`) && !item.slice(path.length + 1).includes('/')).map(item => ({ name: item.slice(path.length + 1), kind: nodes[item]!.kind, isLink: nodes[item]!.isLink === true })),
    births: async paths => {
      own.births?.push(paths)
      return paths.map(path => {
        const times = under(path).map(item => nodes[item]!.born)
        return times.length === 0 || times.some(born => typeof born !== 'number') ? null : Math.min(...(times as number[]))
      })
    },
  }
}

const standing = (extra: Partial<Standing> = {}): Standing => ({ startedAt: STARTED, keep: { entries: [] }, pending: undefined, isWindows: true, home: HOME, root: ROOT, ...extra })
const keepOf = (entries: object[]) => compileKeep(JSON.stringify(entries), HOME, true)
const NEW = 2000
const OLD = 500

test('a file born after the session start is approved, one born before is not, and an unreadable birth time is not', async () => {
  const io = disk({ 'C:/x/new.txt': { kind: 'file', born: NEW }, 'C:/x/old.txt': { kind: 'file', born: OLD }, 'C:/x/none.txt': { kind: 'file', born: null } })
  const approved = await approveOutside(['C:/x/new.txt', 'C:/x/old.txt', 'C:/x/none.txt'], standing(), io)
  expect([...approved]).toEqual([approvalKey('C:/x/new.txt', true)])
})

test('the birth time is read once for all targets', async () => {
  const births: string[][] = []
  const io = disk({ 'C:/x/a.txt': { kind: 'file', born: NEW }, 'C:/x/b.txt': { kind: 'file', born: NEW } }, { births })
  await approveOutside(['C:/x/a.txt', 'C:/x/b.txt'], standing(), io)
  expect(births).toEqual([['C:/x/a.txt', 'C:/x/b.txt']])
})

test('a folder holding one old entry is not approved', async () => {
  const io = disk({ 'C:/x/dir': { kind: 'dir', born: NEW }, 'C:/x/dir/a.txt': { kind: 'file', born: NEW }, 'C:/x/dir/b.txt': { kind: 'file', born: OLD } })
  expect((await approveOutside(['C:/x/dir'], standing(), io)).size).toBe(0)
})

test('an unknown session start, a broken keep file and a missing target approve nothing', async () => {
  const io = disk({ 'C:/x/new.txt': { kind: 'file', born: NEW } })
  expect((await approveOutside(['C:/x/new.txt'], standing({ startedAt: null }), io)).size).toBe(0)
  expect((await approveOutside(['C:/x/new.txt'], standing({ keep: null }), io)).size).toBe(0)
  expect((await approveOutside(['C:/x/new.txt'], standing({ keep: keepOf([{ glob: 1 }]) }), io)).size).toBe(0)
  expect((await approveOutside(['C:/x/ghost.txt'], standing(), io)).size).toBe(0)
})

test('a link is never approved', async () => {
  const io = disk({ 'C:/x/link': { kind: 'file', isLink: true, born: NEW } })
  expect((await approveOutside(['C:/x/link'], standing(), io)).size).toBe(0)
})

test('a check that throws leaves the target out instead of failing the command', async () => {
  const io = { ...disk({ 'C:/x/a.txt': { kind: 'file', born: NEW } }), births: async () => Promise.reject(new Error('boom')) }
  expect((await approveOutside(['C:/x/a.txt'], standing(), io)).size).toBe(0)
})

test('the session folder, its parents, home and a drive root are never approved', async () => {
  const io = disk({ 'C:/work': { kind: 'dir', born: NEW }, 'C:/work/app': { kind: 'dir', born: NEW }, 'C:/Users/me': { kind: 'dir', born: NEW }, 'C:/Users': { kind: 'dir', born: NEW }, 'C:': { kind: 'dir', born: NEW } })
  for (const path of ['C:/work', 'C:/work/app', 'C:/Users/me', 'C:/Users', 'C:']) expect((await approveOutside([path], standing(), io)).size).toBe(0)
})

test('the same target spelled in another case is the same target on Windows only', () => {
  expect(approvalKey('C:/X/A.txt', true)).toBe(approvalKey('c:/x/a.TXT', true))
  expect(approvalKey('/X/A.txt', false)).not.toBe(approvalKey('/x/a.txt', false))
})

// ---- keep.json ----

const NODES: Record<string, Node> = {
  'C:/Users/me/.claude/scratch/a/board.json': { kind: 'file', born: NEW },
  'C:/Users/me/.claude/scratch/a/old.txt': { kind: 'file', born: NEW },
  'C:/Users/me/.claude/scratch/b/note.txt': { kind: 'file', born: NEW },
  'C:/Users/me/.claude/scratch/b/board.json': { kind: 'file', born: NEW },
  'C:/Users/me/.claude/scratch/b/picks.json': { kind: 'file', born: NEW },
  'C:/Users/me/.claude/scratch/a': { kind: 'dir', born: NEW },
  'C:/Users/me/.claude/scratch/b': { kind: 'dir', born: NEW },
  'C:/Users/me/.claude/scratch': { kind: 'dir', born: NEW },
  'C:/Users/me/.claude/other.txt': { kind: 'file', born: NEW },
}

const approves = async (path: string, keep: object[]) => (await approveOutside([path], standing({ keep: keepOf(keep) }), disk(NODES))).size === 1

test('keep globs: ~ and $HOME expand, a target inside or equal to a match is kept, case does not matter on Windows', async () => {
  for (const glob of ['~/.claude/scratch/**', '$HOME/.claude/scratch/**', '${HOME}/.claude/scratch/a/**', 'c:\\users\\ME\\.claude\\scratch\\a\\*.txt']) {
    expect(await approves('C:/Users/me/.claude/scratch/a/old.txt', [{ glob, reason: 'x' }])).toBe(false)
  }
  expect(await approves('C:/Users/me/.claude/other.txt', [{ glob: '~/.claude/scratch/**', reason: 'x' }])).toBe(true)
  expect(await approves('C:/Users/me/.claude/scratch/a/old.txt', [{ glob: '~/.claude/scratch/b/**', reason: 'x' }])).toBe(true)
})

test('keep globs: * stays inside one folder, ** crosses folders, and a match keeps what lies inside it', async () => {
  expect(await approves('C:/Users/me/.claude/scratch/a/old.txt', [{ glob: '~/.claude/*', reason: 'x' }])).toBe(false)
  expect(await approves('C:/Users/me/.claude/scratch/a/old.txt', [{ glob: '~/.claude/*.txt', reason: 'x' }])).toBe(true)
  expect(await approves('C:/Users/me/.claude/scratch/a/old.txt', [{ glob: '~/.claude/**/old.txt', reason: 'x' }])).toBe(false)
})

test('keep globs: a folder target is kept when any file under it would match', async () => {
  expect(await approves('C:/Users/me/.claude/scratch', [{ glob: '~/.claude/scratch/a/**', reason: 'x' }])).toBe(false)
  expect(await approves('C:/Users/me/.claude/scratch/b', [{ glob: '~/.claude/scratch/a/**', reason: 'x' }])).toBe(true)
})

test('keep markers: a target inside a folder with the marker and no unless file is kept, above or below', async () => {
  const keep = [{ marker: 'board.json', unless: 'picks.json', reason: 'x' }]
  expect(await approves('C:/Users/me/.claude/scratch/a/old.txt', keep)).toBe(false)
  expect(await approves('C:/Users/me/.claude/scratch/a', keep)).toBe(false)
  expect(await approves('C:/Users/me/.claude/scratch', keep)).toBe(false)
  expect(await approves('C:/Users/me/.claude/scratch/b/note.txt', keep)).toBe(true)
  expect(await approves('C:/Users/me/.claude/scratch/b', keep)).toBe(true)
})

test('keep file: a missing unless means the marker alone keeps, and a bad entry breaks the file', () => {
  expect(keepOf([{ marker: 'board.json' }]).entries).toHaveLength(1)
  for (const text of ['{', '{}', '[1]', '[{}]', '[{"glob":""}]', '[{"marker":"a/b"}]', '[{"marker":"x","unless":3}]']) {
    expect(compileKeep(text, HOME, true).error).toBeDefined()
  }
  expect(compileKeep('[]', HOME, true).error).toBeUndefined()
})

test('a folder walk past the cap keeps the card instead of trusting the rest', async () => {
  const nodes: Record<string, Node> = { 'C:/x/big': { kind: 'dir', born: NEW } }
  for (let at = 0; at <= WALK_CAP; at++) nodes[`C:/x/big/f${at}.txt`] = { kind: 'file', born: NEW }
  const keep = keepOf([{ marker: 'board.json', unless: '', reason: 'x' }])
  expect((await approveOutside(['C:/x/big'], standing({ keep }), disk(nodes))).size).toBe(0)
})

// ---- pending ----

test('pending: a target equal to or holding a pending path fails; a file inside a pending folder, other paths and no state pass', () => {
  const pending = ['C:/Users/me/proj/plan.md', 'C:/Users/me/proj/docs', 'C:/Users/me/.claude']
  expect(isPending('C:/Users/me/proj/plan.md', pending, true, HOME)).toBe(true)
  expect(isPending('C:/Users/me/proj/docs', pending, true, HOME)).toBe(true)
  expect(isPending('C:/Users/me/proj', pending, true, HOME)).toBe(true)
  // A ledger names folders in passing; only keep.json shields a folder's contents.
  expect(isPending('C:/Users/me/proj/docs/a.md', pending, true, HOME)).toBe(false)
  expect(isPending('C:/Users/me/.claude/scratch/yasb-cards/motion/dbg8.txt', pending, true, HOME)).toBe(false)
  expect(isPending('C:/Users/me/other/plan.md', pending, true, HOME)).toBe(false)
  expect(isPending('C:/Users/me/proj/plan.md', undefined, true, HOME)).toBe(false)
  expect(isPending('C:/Users/me/proj/plan.md', [], true, HOME)).toBe(false)
})

test('pending: an entry that is home, above it, or a drive root is ignored, so one broad entry cannot hold every delete', () => {
  for (const broad of ['C:/Users/me', 'c:/users/ME/', 'C:/Users', 'C:/', '/']) expect(isPending('C:/Users/me/x/new.txt', [broad], true, HOME)).toBe(false)
  expect(isPending('C:/Users/me/x/new.txt', ['C:/Users/me', 'C:/Users/me/x/new.txt'], true, HOME)).toBe(true)
})

// ---- the birth process ----

test('the Windows birth read is one PowerShell call that lists every path, quoting an apostrophe', () => {
  const argv = birthArgv(['C:/a/x.txt', "C:/a/it's"], true)
  expect(argv.slice(0, 4)).toEqual(['powershell', '-NoProfile', '-NonInteractive', '-Command'])
  expect(argv[4]).toContain("@('C:/a/x.txt', 'C:/a/it''s')")
  expect(argv[4]).toContain('CreationTimeUtc')
})

test('the other-systems birth read is one sh call with the paths as arguments, caring for macOS and Linux', () => {
  const argv = birthArgv(['/a/x.txt', '/a/y'], false)
  expect(argv.slice(0, 2)).toEqual(['sh', '-c'])
  expect(argv.slice(3)).toEqual(['sh', '/a/x.txt', '/a/y'])
  expect(argv[2]).toContain('stat -f %B')
  expect(argv[2]).toContain('stat -c %W')
})

test('birth output: one number per path, ERR or a wrong count reads as unknown', () => {
  expect(parseBirths('1700000000000\r\nERR\r\n', 2)).toEqual([1700000000000, null])
  expect(parseBirths('1700000000000\n', 2)).toEqual([null, null])
  expect(parseBirths('', 1)).toEqual([null])
  expect(parseBirths('0\n', 1)).toEqual([0])
})

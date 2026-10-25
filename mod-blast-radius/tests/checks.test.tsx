// mod-blast-radius / tests/checks.test.tsx, by v-amorim
// Tests the session's permission checks: watching, settling, masking, keeping, the hold card's count and the Details strip.
import { expect, mock, test } from 'claude-code/testing'
import { isRefusal, mask, summarize, tally, trim, type Check } from '../hooks/checks'
import { THEME } from '../hooks/theme'

const PLUGIN = 'mod-blast-radius'
const PANE = (bodyColumns = 100) =>
  ({ component: 'Pane', requestId: 'blast-radius-list', props: { title: 'Blast radius', isFocused: false, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } }) as const
const bandOf = (bodyColumns = 120) =>
  ({ component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 24, bodyColumns, scroll: { offset: 0, bodyRows: 6 }, view: {} } }) as const

declare const setTimeout: (run: (value?: unknown) => void, ms: number) => unknown
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

type Verdicts = Record<string, 'allow' | 'ask' | 'deny'>
type World = { beneath?: Record<string, unknown>; verdicts?: Verdicts; surfaces?: string[]; answer?: 'allow' | 'deny' | 'none'; callDenies?: boolean }

// The engine beneath the mod: a verdict per tool, a person who answers asks, and a record of what the mod kept.
function world(on: (event: string, handler: (...args: any[]) => unknown) => void, setup: World = {}) {
  const seen = { ran: 0, stored: [] as Check[] }
  mock.clock(on as never)
  on('session.end', (_$: unknown, e: { sessionId: string }) => ({ sessionId: e.sessionId }) as never)
  on('session.cwd', () => ({ value: 'C:/w' }))
  on('session.surfaces', () => ({ value: setup.surfaces ?? ['terminal'] }))
  on('env.get', (_$: unknown, e: { name: string }) => ({ value: e.name === 'OS' ? 'Windows_NT' : undefined }))
  on('fs.stat', () => {
    throw new Error('ENOENT')
  })
  on('fs.read', () => {
    throw new Error('ENOENT')
  })
  on('fs.list', () => ({ value: [] }))
  on('process.run', async () => {
    await sleep(5)
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('ui.toast', () => ({ value: {} }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: {} }))
  on('config.list', () => ({ value: [] }))
  on('state.set', (_$: unknown, e: { key: string; value: unknown }) => {
    if (e.key === 'checks') seen.stored = e.value as Check[]
    return { value: { isSet: true, version: 1 } }
  })
  on('tool.check', (_$: unknown, e: { tool: string }) => ({ decision: setup.verdicts?.[e.tool] ?? 'allow', ...setup.beneath }))
  on('tool.call', () => {
    seen.ran++
    return setup.callDenies ? { deny: 'a hook refused it' } : { result: { text: 'ran' } }
  })
  if (setup.answer !== 'none') {
    on('classic.PermissionRequest', (() => ({
      decision: setup.answer === 'deny' ? { behavior: 'deny', message: "The user doesn't want to proceed with this tool use." } : { behavior: 'allow' },
    })) as never)
  }
  on('ui.render', ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text key="base">base</Text>
  })
  return seen
}

const kept = async (seen: { stored: Check[] }) => {
  await sleep(10)
  return seen.stored
}

const check = ($: any, tool: string, input: unknown, id: string, agentId?: string) => $.tool.check({ tool, input, tool_use_id: id, ...(agentId ? { agentId } : {}) } as never)

test('checks observe: the verdict a check returns is the one next gave, whatever the tool', async ($, on) => {
  const seen = world(on, { verdicts: { Read: 'allow', Write: 'deny', Grep: 'ask' } })
  expect(await check($, 'Read', { file_path: 'a.ts' }, 'r1')).toEqual({ decision: 'allow' })
  expect(await check($, 'Write', { file_path: 'a.ts' }, 'w1')).toEqual({ decision: 'deny' })
  expect(await check($, 'Grep', { pattern: 'x' }, 'g1')).toEqual({ decision: 'ask' })
  expect((await kept(seen)).map(each => each.id)).toEqual(['r1', 'w1', 'g1'])
})

test('checks observe: a reason and a rule that beneath attached come back untouched', async ($, on) => {
  world(on, { verdicts: { Read: 'ask' }, beneath: { reason: 'because', rule: 'Read(*)', hook: 'PreToolUse' } })
  expect(await check($, 'Read', { file_path: 'a.ts' }, 'r1')).toEqual({ decision: 'ask', reason: 'because', rule: 'Read(*)', hook: 'PreToolUse' })
})

test('checks observe: a query with no tool_use_id is answered and not recorded', async ($, on) => {
  const seen = world(on)
  expect((await $.tool.check({ tool: 'Read', input: { file_path: 'a.ts' } })).decision).toBe('allow')
  expect(await kept(seen)).toEqual([])
})

test('checks observe: where nothing can draw, the Bash fallback ask is the verdict and the check waits', async ($, on) => {
  const seen = world(on, { surfaces: [] })
  const verdict = await check($, 'Bash', { command: 'rm -rf build' }, 'b1')
  expect(verdict.decision).toBe('ask')
  expect((await kept(seen))[0]?.verdict).toBe('waiting')
})

test('checks settle: allow is allowed, deny is denied, and an ask waits', async ($, on) => {
  const seen = world(on, { verdicts: { Write: 'deny', Grep: 'ask' } })
  await check($, 'Read', { file_path: 'a.ts' }, 'r1')
  await check($, 'Write', { file_path: 'a.ts' }, 'w1')
  await check($, 'Grep', { pattern: 'x' }, 'g1')
  expect((await kept(seen)).map(each => each.verdict)).toEqual(['allowed', 'denied', 'waiting'])
})

test('checks settle: an ask the person allowed is asked once its call ran', async ($, on) => {
  const seen = world(on, { verdicts: { Edit: 'ask' }, answer: 'allow' })
  await $.tool.call({ tool: 'Edit', file_path: 'a.ts', old_string: 'a', new_string: 'b' } as never)
  expect(seen.ran).toBe(1)
  const [only] = await kept(seen)
  expect(only).toMatchObject({ tool: 'Edit', family: 'file', verdict: 'asked', isAgent: false })
})

test('checks settle: an ask the person refused is denied, and the call never ran', async ($, on) => {
  const seen = world(on, { verdicts: { Write: 'ask' }, answer: 'deny' })
  await $.tool.call({ tool: 'Write', file_path: 'a.ts', content: 'x' } as never)
  expect(seen.ran).toBe(0)
  expect((await kept(seen))[0]?.verdict).toBe('denied')
})

test('checks settle: an ask nobody could answer is denied by the refusal text the call returns', async ($, on) => {
  const seen = world(on, { verdicts: { Read: 'ask' }, answer: 'none' })
  await $.tool.call({ tool: 'Read', file_path: 'a.ts' } as never)
  expect((await kept(seen))[0]?.verdict).toBe('denied')
})

test('checks settle: a deny from a hook beneath refuses the call, and its ask is denied', async ($, on) => {
  const seen = world(on, { verdicts: { Read: 'ask' }, answer: 'allow', callDenies: true })
  const result = await $.tool.call({ tool: 'Read', file_path: 'a.ts' } as never)
  expect(JSON.stringify(result)).toContain('a hook refused it')
  expect((await kept(seen))[0]?.verdict).toBe('denied')
  expect(isRefusal({ deny: 'x' })).toBe(true)
  expect(isRefusal({ isError: true, text: 'ENOENT: no such file' })).toBe(false)
  expect(isRefusal({ text: 'ok' })).toBe(false)
})

test('checks settle: a Blast radius Cancel is a denial', async ($, on) => {
  const seen = world(on)
  const call = $.tool.call({ tool: 'Bash', command: 'make deploy TARGET=prod' })
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...bandOf() })
  for (let tries = 0; tries < 200 && !(await band.find({ key: 'blast-cancel' })); tries++) {
    await sleep(10)
    await band.redraw()
  }
  await band.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'blast-cancel' })
  await band.input({ key: 'blast-reason', text: '', kind: 'submit' })
  await call
  await band.unmount()
  expect(seen.ran).toBe(0)
  expect(await kept(seen)).toMatchObject([{ tool: 'Bash', family: 'shell', verdict: 'denied' }])
})

test('checks settle: a check made inside a subagent says so, and each tool lands in its family', async ($, on) => {
  const seen = world(on)
  await check($, 'Glob', { pattern: '*.ts' }, 'a1', 'agent-1')
  await check($, 'Bash', { command: 'ls' }, 'a2')
  await check($, 'mcp__srv__tool', {}, 'a3')
  const list = await kept(seen)
  expect(list.map(each => [each.family, each.isAgent])).toEqual([['file', true], ['shell', false], ['other', false]])
  expect(tally(list)).toMatchObject({ total: 3, file: 1, shell: 1, other: 1, agent: 1 })
})

test('checks mask: headers, key=value pairs and key shapes lose their secret', () => {
  expect(mask('curl -H "Authorization: Bearer abc123def456" https://x')).toBe('curl -H "Authorization: ****" https://x')
  expect(mask('curl -H "authorization: basic dXNlcjpwYXNz"')).toBe('curl -H "authorization: ****"')
  expect(mask('send Bearer eyJhbGciOi.payload.sig now')).toBe('send Bearer **** now')
  expect(mask('run --token=abc123 --password=hunter2 passwd=x secret=y api_key=z')).toBe('run --token=**** --password=**** passwd=**** secret=**** api_key=****')
  expect(mask('export GITHUB_TOKEN="ghp_abcdefgh12345678"')).toBe('export GITHUB_TOKEN="****"')
})

test('checks mask: every key shape is replaced wherever it stands', () => {
  for (const key of ['sk-ant-abcdefgh12345678', 'ghp_abcdefgh12345678', 'gho_abcdefgh12345678', 'github_pat_abcdefgh12345678', 'AKIAABCDEFGH12345678', 'xoxb-1234-abcdefgh', 'xoxp-1234-abcdefgh']) {
    expect(mask(`echo ${key} done`), key).toBe('echo **** done')
  }
  expect(mask('git status')).toBe('git status')
})

test('checks mask: what is stored is the tool and a short command, masked before it is cut', async ($, on) => {
  const seen = world(on)
  await check($, 'Bash', { command: `curl -H "Authorization: Bearer abcdef1234567890" ${'x'.repeat(200)}` }, 'm1')
  await check($, 'Read', { file_path: 'C:/w/src/a.ts' }, 'm2')
  await check($, 'mcp__srv__tool', { token: 'sk-abcdefgh12345678' }, 'm3')
  const [bash, read, other] = await kept(seen)
  expect(bash!.summary.startsWith('Bash curl -H "Authorization: ****"')).toBe(true)
  expect(bash!.summary.length).toBeLessThanOrEqual('Bash '.length + 80)
  expect(bash!.summary.endsWith('...')).toBe(true)
  expect(JSON.stringify(seen.stored)).not.toContain('abcdef1234567890')
  expect(read!.summary).toBe('Read C:/w/src/a.ts')
  expect(other!.summary).toBe('mcp__srv__tool')
  expect(summarize('Bash', { command: 'a\n  b' })).toBe('Bash a b')
})

test('checks keep: the list is bounded, the oldest settled drop first, and a waiting check never drops', async ($, on) => {
  const seen = world(on, { verdicts: { Grep: 'ask' } })
  await check($, 'Grep', { pattern: 'x' }, 'waits')
  for (let at = 0; at < 205; at++) await check($, 'Read', { file_path: `f${at}` }, `r${at}`)
  const list = await kept(seen)
  expect(list.length).toBe(200)
  expect(list[0]!.id).toBe('waits')
  expect(list[1]!.id).toBe('r6')
  expect(list.at(-1)!.id).toBe('r204')
})

test('checks keep: trim keeps order, drops only what it must, and an all-waiting list may pass the limit', () => {
  const make = (id: string, verdict: Check['verdict']): Check => ({ id, tool: 'Read', family: 'file', summary: 'Read', verdict, isAgent: false, at: 0 })
  expect(trim([make('a', 'allowed'), make('b', 'waiting'), make('c', 'denied'), make('d', 'asked')], 2).map(each => each.id)).toEqual(['b', 'd'])
  expect(trim([make('a', 'waiting'), make('b', 'waiting'), make('c', 'waiting')], 2).length).toBe(3)
})

test('checks keep: a /clear starts the list again', async ($, on) => {
  const seen = world(on)
  await check($, 'Read', { file_path: 'a.ts' }, 'r1')
  expect((await kept(seen)).length).toBe(1)
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: {} } as never)
  expect(await kept(seen)).toEqual([])
  await check($, 'Read', { file_path: 'b.ts' }, 'r2')
  expect((await kept(seen)).map(each => each.id)).toEqual(['r2'])
})

// Fifteen checks, one denied: the card's count.
async function seedFifteen($: any) {
  for (let at = 0; at < 14; at++) await check($, 'Read', { file_path: `f${at}` }, `r${at}`)
  await check($, 'Write', { file_path: 'w' }, 'w1')
}

const countOf = async (band: any) => (await byKey(band, 'hold-count-box'))[0]?.children?.[0] as Node | undefined

const heldCard = async ($: any, on: any, columns: number, check: (band: any) => Promise<void>, seed: (($: any) => Promise<void>) = seedFifteen) => {
  const seen = world(on, { verdicts: { Write: 'deny' } })
  await seed($)
  const call = $.tool.call({ tool: 'Bash', command: 'make deploy TARGET=prod' })
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...bandOf(columns) })
  for (let tries = 0; tries < 200 && !(await band.find({ key: 'blast-run' })); tries++) {
    await sleep(10)
    await band.redraw()
  }
  await check(band)
  await band.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'blast-cancel' })
  await band.input({ key: 'blast-reason', text: '', kind: 'submit' })
  await call
  await band.unmount()
  return seen
}

test('checks card: wide, the action row ends with the muted count and every button keeps its label', async ($, on) => {
  await heldCard($, on, 120, async band => {
    const count = await countOf(band)
    expect(count!.children).toEqual(['this session: 15 checks, 1 denied'])
    expect(count!.props.color).toBe(THEME.muted)
    const tree = JSON.stringify(await band.drawn())
    expect(tree.indexOf('blast-run-pill')).toBeLessThan(tree.indexOf('hold-count-box'))
    for (const key of ['blast-cancel', 'blast-details', 'blast-run']) expect(await band.find({ key })).toBeDefined()
  })
})

test('checks card: one check says check, and the denied count is always shown', async ($, on) => {
  await heldCard($, on, 120, async band => {
    expect((await countOf(band))!.children).toEqual(['this session: 1 check, 0 denied'])
  }, async $$ => void (await check($$, 'Read', { file_path: 'a' }, 'only')))
})

test('checks card: narrow, the count drops first and no button or figure is cut', async ($, on) => {
  await heldCard($, on, 52, async band => {
    expect(await countOf(band)).toBeUndefined()
    for (const key of ['blast-cancel', 'blast-details', 'blast-run']) expect(await band.find({ key })).toBeDefined()
    expect(((await band.find({ type: 'Text', text: /^! Deploy to production/ })) as { text: string } | undefined)?.text).toBe('! Deploy to production')
  })
})

test('checks card: with no check seen yet the row carries no count', async ($, on) => {
  await heldCard($, on, 120, async band => {
    expect(await countOf(band)).toBeUndefined()
  }, async () => undefined)
})

const SEED_EIGHT = async ($: any) => {
  await check($, 'Read', { file_path: 'a' }, 'c1')
  await check($, 'Read', { file_path: 'b' }, 'c2')
  await $.tool.call({ tool: 'Edit', file_path: 'x', old_string: 'a', new_string: 'b' } as never)
  await check($, 'Write', { file_path: 'w' }, 'c4')
  await check($, 'Grep', { pattern: 'p' }, 'c5')
  await check($, 'Glob', { pattern: '*' }, 'c6', 'agent-1')
  await check($, 'Bash', { command: 'ls' }, 'c7')
  await check($, 'mcp__srv__tool', {}, 'c8')
}

const wordsOf = (node: unknown): string => (typeof node === 'string' ? node : Array.isArray(node) ? node.map(wordsOf).join('') : node ? wordsOf((node as { children?: unknown }).children) : '')

type Node = { type: string; props: Record<string, any>; children?: unknown[] }
const allNodes = (node: unknown): Node[] => (node && typeof node === 'object' ? [node as Node, ...((node as Node).children ?? []).flatMap(allNodes)] : [])
const byKey = async (pane: any, key: string | RegExp) => allNodes(await pane.drawn()).filter(each => (typeof key === 'string' ? each.props?.key === key : key.test(String(each.props?.key))))

async function withStrip($: any, on: any, icons: boolean, columns: number, check: (pane: any, cell: string, cross: string) => Promise<void>, seed = SEED_EIGHT) {
  const seen = world(on, { verdicts: { Write: 'deny', Grep: 'ask', Edit: 'ask' }, answer: 'allow' })
  await seed($)
  const call = $.tool.call({ tool: 'Bash', command: 'make deploy TARGET=prod' })
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...bandOf() })
  for (let tries = 0; tries < 200 && !(await band.find({ key: 'blast-details' })); tries++) {
    await sleep(10)
    await band.redraw()
  }
  await band.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'blast-details' })
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE(columns) })
  await check(pane, icons ? String.fromCodePoint(0xf0c8) : '■', icons ? String.fromCodePoint(0xf00d) : '×')
  await pane.unmount()
  await band.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'blast-cancel' })
  await band.input({ key: 'blast-reason', text: '', kind: 'submit' })
  await call
  await band.unmount()
  return seen
}

const stripChecks = async (pane: any, cell: string, cross: string) => {
  expect(wordsOf((await byKey(pane, 'checks-edge'))[0])).toContain('This session')
  expect(wordsOf((await byKey(pane, 'checks-edge'))[0])).toContain(' · 8 permission checks')
  const row = (await byKey(pane, 'checks-row-0'))[0] as { children: { props: { color: string }; children: string[] }[] }
  expect(row.children.map(each => each.children.join(''))).toEqual([cell, cell, cell, cross, cell, cell, cell, cell])
  expect(row.children.map(each => each.props.color)).toEqual([THEME.ok, THEME.ok, THEME.accent, THEME.alert, THEME.warn, THEME.lifted, THEME.ok, THEME.ok])
  expect(wordsOf((await byKey(pane, 'checks-legend'))[0])).toBe(`${cell} 5 allowed  ${cell} 1 asked  ${cross} 1 denied  ${cell} 1 waiting  ${cell} in a subagent`)
  const parts = allNodes((await byKey(pane, 'checks-legend'))[0]).filter(each => each.type === 'Text' && typeof each.children?.[0] === 'string' && /^ (\d|in a)/.test(each.children[0] as string))
  expect(parts.length).toBe(5)
  expect(parts.every(each => each.props.color === THEME.muted)).toBe(true)
  const family = (await byKey(pane, 'checks-families'))[0]!.children![0] as Node
  expect(wordsOf(family)).toBe('file 6 · shell 1 · other 1')
  expect(family.props.color).toBe(THEME.muted)
}

test('checks pane: the strip ends Details with one colored cell per check, a legend and the families (nerd)', { options: { icons: 'nerd' } }, async ($, on) => {
  await withStrip($, on, true, 100, stripChecks)
})

test('checks pane: the strip ends Details with one colored cell per check, a legend and the families (safe)', { options: { icons: 'safe' } }, async ($, on) => {
  await withStrip($, on, false, 100, stripChecks)
})

test('checks pane: a legend leaves out a part with none, keeps denied, and the strip is the last section (safe)', { options: { icons: 'safe' } }, async ($, on) => {
  await withStrip($, on, false, 100, async pane => {
    expect(wordsOf((await byKey(pane, 'checks-legend'))[0])).toBe('■ 2 allowed  × 0 denied')
    const tree = JSON.stringify(await pane.drawn())
    expect(tree.indexOf('legend-row')).toBeLessThan(tree.indexOf('checks-block'))
    expect(tree.indexOf('checks-block')).toBeLessThan(tree.indexOf('footer-space'))
  }, async $$ => {
    await check($$, 'Read', { file_path: 'a' }, 'c1')
    await check($$, 'Read', { file_path: 'b' }, 'c2')
  })
})

test('checks pane: more cells than the pane is wide wrap to more rows and none is cut (nerd)', { options: { icons: 'nerd' } }, async ($, on) => {
  await withStrip($, on, true, 20, async pane => {
    const rows = (await byKey(pane, /^checks-row-/)) as { children: unknown[] }[]
    expect(rows.length).toBe(2)
    expect(rows.reduce((sum, each) => sum + each.children.length, 0)).toBe(23)
    expect(rows[0]!.children.length).toBe(14)
  }, async $$ => {
    for (let at = 0; at < 23; at++) await check($$, 'Read', { file_path: `f${at}` }, `c${at}`)
  })
})

// mod-transcript / tests/mark.test.tsx, by v-amorim
// Tests the characters a hovered copy choice marks in the reply: what is marked is what is copied.
import { expect, mock, test } from 'claude-code/testing'

import { copyText, type CopyChoice } from '../hooks/clip'
import Copy from '../hooks/copy'
import { markPieces, type Piece } from '../hooks/mark'
import { mix, THEME } from '../hooks/theme'
import { reading, sessionStarted } from './bridge-feed'

// The selection fill register.tsx gives what a hovered choice copies.
const MARKED = mix(THEME.accent, THEME.bg, 0.5)

const ID = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`
const row = (n: number, type: string, extra: object) => JSON.stringify({ type, uuid: ID(n), parentUuid: n > 1 ? ID(n - 1) : null, ...extra })
const said = (n: number, content: unknown[]) => row(n, 'assistant', { message: { role: 'assistant', content } })

const REPLY = [
  'Run it from `src/build.ts`, see https://ci.example.dev/run/42 for the log.',
  '',
  '```sh',
  'npm run build && npm test',
  '```',
  '',
  '| Name | Count |',
  '|:-----|------:|',
  '| apples | 3 |',
  '',
  'Nothing else to say.',
].join('\n')

const TRANSCRIPT = [
  row(1, 'user', { message: { role: 'user', content: 'build it' } }),
  said(2, [{ type: 'text', text: REPLY }]),
  row(3, 'system', { subtype: 'turn_duration', durationMs: 3000 }),
  row(4, 'user', { message: { role: 'user', content: 'thanks' } }),
].join('\n') + '\n'

const markedText = (pieces: Piece[] | null) =>
  (pieces ?? []).flatMap(piece => (piece.kind === 'marked' ? piece.parts.filter(part => part.isMarked).map(part => part.text) : piece.isMarked ? [piece.text] : []))

test('marks: each choice marks the characters it copies', () => {
  expect(markedText(markPieces(REPLY, 'code')).join('\n\n')).toBe(copyText(REPLY, 'code'))
  expect(markedText(markPieces(REPLY, 'links'))).toEqual(['src/build.ts', 'https://ci.example.dev/run/42'])
  expect([...markedText(markPieces(REPLY, 'links'))].sort()).toEqual(copyText(REPLY, 'links').split('\n').sort())
  expect(markedText(markPieces(REPLY, 'table'))).toEqual(['| Name | Count |\n|:-----|------:|\n| apples | 3 |'])
  expect(markedText(markPieces(REPLY, 'reply'))).toEqual([REPLY])
  expect(markedText(markPieces('Just **prose**.\n\n- one', 'text'))).toEqual([copyText('Just **prose**.\n\n- one', 'text')])
})

test('marks: the text choice keeps each table drawn as markdown, so the reply keeps its height', () => {
  const text = markPieces(REPLY, 'text')!
  expect(text.map(piece => piece.kind)).toEqual(['marked', 'markdown', 'marked'])
  expect(text[1]).toEqual({ kind: 'markdown', text: '| Name | Count |\n|:-----|------:|\n| apples | 3 |', isMarked: true })
  expect(markedText([text[0]!])[0]).toContain('npm run build && npm test')
  expect(markedText([text[2]!])).toEqual(['Nothing else to say.'])
})

test('marks: the links choice keeps a table drawn as markdown, marked whole when it holds a link', () => {
  const linked = ['| Video | Why |', '| --- | --- |', '| [Talk](https://youtu.be/abc) (40 min) | the plan |'].join('\n')
  const reply = ['Worth watching:', '', linked, '', 'Ask for more.'].join('\n')
  const links = markPieces(reply, 'links')!
  expect(links).toEqual([
    { kind: 'markdown', text: 'Worth watching:' },
    { kind: 'markdown', text: linked, isMarked: true },
    { kind: 'markdown', text: 'Ask for more.' },
  ])
  // A table with no link stays with the unmarked markdown around it.
  expect(markPieces(['| A | B |', '| --- | --- |', '| 1 | 2 |', '', 'See https://x.dev/y'].join('\n'), 'links')!.map(piece => piece.kind)).toEqual(['markdown', 'marked'])
})

test('marks: what a choice leaves stays markdown, in order, and a choice marking nothing draws no pieces', () => {
  const code = markPieces(REPLY, 'code')!
  expect(code.map(piece => piece.kind)).toEqual(['markdown', 'marked', 'markdown'])
  expect(code[0]).toEqual({ kind: 'markdown', text: 'Run it from `src/build.ts`, see https://ci.example.dev/run/42 for the log.' })
  expect(code[2]).toEqual({ kind: 'markdown', text: '| Name | Count |\n|:-----|------:|\n| apples | 3 |\n\nNothing else to say.' })
  const links = markPieces(REPLY, 'links')!
  expect(links.map(piece => piece.kind)).toEqual(['marked', 'markdown'])
  // The whole reply draws as Claude Code draws it, so its fence lines never add rows under the pointer.
  expect(markPieces(REPLY, 'reply')).toEqual([{ kind: 'markdown', text: REPLY, isMarked: true }])
  // A table stays drawn as markdown too: as source text it loses the box Claude Code draws and changes height under the pointer.
  const table = markPieces(REPLY, 'table')!
  expect(table.find(piece => piece.kind === 'markdown' && piece.isMarked)).toEqual({ kind: 'markdown', text: '| Name | Count |\n|:-----|------:|\n| apples | 3 |', isMarked: true })
  expect(table.some(piece => piece.kind === 'marked')).toBe(false)
  expect(links[1]).toEqual({ kind: 'markdown', text: '```sh\nnpm run build && npm test\n```\n\n| Name | Count |\n|:-----|------:|\n| apples | 3 |\n\nNothing else to say.' })
  expect(markPieces('Just prose.', 'code')).toBeNull()
  expect(markPieces('Just prose.', 'table')).toBeNull()
  expect(markPieces('', 'reply')).toBeNull()
})

async function mountReply($: any, on: any) {
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: TRANSCRIPT.length, mtimeMs: 0, isLink: false } }))
  on('fs.read', reading(() => ({ value: TRANSCRIPT })))
  on('ui.copy', () => ({ value: { isCopied: true } }))
  const clock = mock.clock(on)
  mock.env(on, { USERPROFILE: '/home' })
  on('session.start', () => ({ cwd: '/w' }))
  on('ui.render', ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>{`base ${e.component}`}</Text>
  })
  await sessionStarted($, clock, 's1', '/t/s1.jsonl', 'startup')
  const mount = (component: string, requestId: string, props: object) =>
    $.ui.mount({ plugin: 'mod-transcript', surface: 'terminal', component, requestId, viewport: { columns: 120, rows: 40 }, props } as never)
  return {
    prompt: await mount('UserMessage', ID(1), { text: 'build it', origin: { kind: 'composer' }, isExpanded: false }),
    reply: await mount('AssistantMessage', ID(2), { text: REPLY, isFirstOfReply: true }),
    next: await mount('UserMessage', ID(4), { text: 'thanks', origin: { kind: 'composer' }, isExpanded: false }),
  }
}

const CHOICES: CopyChoice[] = ['reply', 'code', 'text', 'table', 'links']
const drawnOf = async (ui: any) => JSON.stringify(await ui.drawn())
const pillOf = async (ui: any) => JSON.stringify(await ui.drawn({ in: 'toggle-copy-pill' }))
const point = (ui: any, type: string, x: number) => ui.pointer({ in: 'toggle-copy-pill', type, button: 'left', x, y: 0 })
const leadOf = async (ui: any) => String((await ui.drawn({ in: 'toggle-copy-pill' })).children[0].children[0]).length

// The cell inside the choice `at` of the open pill; each choice is its label and a space either side.
const cellOf = async (ui: any, at: number) => {
  const lead = await leadOf(ui)
  return lead + CHOICES.slice(0, at).reduce((sum, what) => sum + what.length + 2, 0) + 1
}

for (const icons of ['safe', 'nerd']) {
  test(`hovering a choice marks its characters on the reply row, and leaving restores it (${icons} icons)`, { options: { icons } }, async ($, on) => {
    const { prompt, reply, next } = await mountReply($, on)
    // At rest the row is the mod's own table drawing, and no mark is in it.
    expect(await drawnOf(reply)).toContain('"key":"toggle-tables"')
    expect(await drawnOf(reply)).not.toContain(`"backgroundColor":"${MARKED}"`)
    await point(reply, 'move', (await leadOf(reply)) + 1)
    await point(reply, 'move', await cellOf(reply, 1))
    for (const [at, what] of CHOICES.entries()) {
      await point(reply, 'move', await cellOf(reply, at))
      const drawn = await drawnOf(reply)
      expect(drawn).not.toContain('base AssistantMessage')
      expect(drawn).toContain(MARKED)
      for (const text of markedText(markPieces(REPLY, what))) expect(drawn).toContain(JSON.stringify(text).slice(1, -1))
    }
    // The links choice leaves the code as markdown, which a marked Text would not be.
    expect(await drawnOf(reply)).toContain('Nothing else to say.')
    // What the links choice leaves dims, so the marked characters stand out.
    expect(await drawnOf(reply)).toContain('"dimColor":true')
    // The first block keeps the blank line Claude Code draws above it, so the row keeps its height under the pointer.
    expect(await drawnOf(reply)).toMatch(/"key":"toggle-marked"[^{}]*"marginTop":1|"marginTop":1[^{}]*"key":"toggle-marked"/)
    await point(reply, 'leave', 0)
    expect(await drawnOf(reply)).toContain('"key":"toggle-tables"')
    expect(await drawnOf(reply)).not.toContain(`"backgroundColor":"${MARKED}"`)
    for (const ui of [prompt, reply, next]) await ui.unmount()
  })
}

test('the mark holds while the copied note shows, and goes when the note ends', async ($, on) => {
  const { prompt, reply, next } = await mountReply($, on)
  await point(reply, 'move', (await leadOf(reply)) + 1)
  const at = await cellOf(reply, 1)
  await point(reply, 'move', at)
  await point(reply, 'down', at)
  expect(await pillOf(reply)).toContain('copied code')
  expect(await drawnOf(reply)).toContain('npm run build && npm test')
  expect(await drawnOf(reply)).toContain(MARKED)
  for (const ui of [prompt, reply, next]) await ui.unmount()
})

// A stand-in surface that keeps what the pill posts and runs its timers by hand.
function fakeSurface() {
  const posts: any[] = []
  const timers = new Set<() => void>()
  let pointer: (event: any) => void = () => {}
  const surface: any = {
    elements: { Box: (props: any) => props, Text: (props: any) => props },
    state: undefined,
    columns: 40,
    setState: (state: any) => (surface.state = state),
    every: (_ms: number, fn: () => void) => (timers.add(fn), () => timers.delete(fn)),
    onPointer: (handler: (event: any) => void) => (pointer = handler),
    post: (data: any) => posts.push(data),
  }
  return { surface, posts, point: (event: object) => pointer(event), tick: () => [...timers].forEach(fn => fn()) }
}

const PILL = { id: 't', choices: [{ what: 'reply', label: 'reply' }, { what: 'code', label: 'code' }], icon: 'c', copied: 'copied {what}', bg: THEME.surface2, nerd: false, lead: { char: '─', color: THEME.border } } as never
const hovers = (posts: any[]) => posts.map(post => (post.type === 'copy-hover' ? post : post.mark)).filter(Boolean).map(post => post.what)

test('the pill announces a choice once per change, beside its tip, and clears it when the note ends or the pointer is quiet', () => {
  // The timers read Date.now, which a test cannot move, so a state's times are moved back instead.
  const older = (pill: ReturnType<typeof fakeSurface>, ms: number) => pill.surface.setState({ ...pill.surface.state, at: pill.surface.state.at - ms, noteAt: pill.surface.state.noteAt - ms })
  {
    const pill = fakeSurface()
    Copy(PILL, pill.surface)
    pill.point({ type: 'move', x: 39, y: 0 })
    Copy(PILL, pill.surface)
    // The open pill has the lead 40 - 13 - 3 = 24, then " reply " and " code ".
    pill.point({ type: 'move', x: 32, y: 0 })
    Copy(PILL, pill.surface)
    pill.point({ type: 'move', x: 33, y: 0 })
    expect(hovers(pill.posts)).toEqual(['code'])
    // The choice rides on the tip post of the same event, so no frame drops one of the two.
    expect(pill.posts.filter(post => post.type === 'copy-hover')).toEqual([])
    pill.point({ type: 'down', x: 33, y: 0, button: 'left' })
    expect(pill.posts.at(-1)).toEqual({ type: 'copy', id: 't', what: 'code' })
    older(pill, 1000)
    pill.tick()
    expect(hovers(pill.posts)).toEqual(['code'])
    older(pill, 600)
    pill.tick()
    expect(pill.posts.at(-1)).toEqual({ type: 'copy-hover', id: 't', what: null })

    const quiet = fakeSurface()
    Copy(PILL, quiet.surface)
    quiet.point({ type: 'move', x: 39, y: 0 })
    Copy(PILL, quiet.surface)
    quiet.point({ type: 'move', x: 32, y: 0 })
    older(quiet, 6000)
    quiet.tick()
    expect(quiet.posts.at(-1)).toEqual({ type: 'copy-hover', id: 't', what: null })

    const left = fakeSurface()
    Copy(PILL, left.surface)
    left.point({ type: 'move', x: 39, y: 0 })
    Copy(PILL, left.surface)
    left.point({ type: 'move', x: 32, y: 0 })
    left.point({ type: 'leave', x: 0, y: 0 })
    expect(hovers(left.posts)).toEqual(['code', null])
  }
})

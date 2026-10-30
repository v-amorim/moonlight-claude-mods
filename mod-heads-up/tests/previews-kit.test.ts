// tests/previews-kit.test.ts, by v-amorim: the example layout engine on small trees, so a bad row, rail or overlay fails here and not in a screenshot.
import { expect, test } from 'claude-code/testing'

import { lookFor } from '../hooks/look'
import { openSetting, settingsBody } from '../hooks/settings'
import { capture, EXAMPLE_COLUMNS, expectPreview, written, type Captured } from './previews-kit'

const none = async () => ({ type: 'Text', children: [''] })
const Text = (text: string, props: Record<string, unknown> = {}) => ({ type: 'Text', props, children: [text] })
const Box = (props: Record<string, unknown>, ...children: unknown[]) => ({ type: 'Box', props, children })
const RULE = String.fromCodePoint(0x2500)
const lines = (got: Captured) => got.lines.map(line => line.spans.map(span => span.text).join(''))

// A rail as a bubble draws it: a one-cell Box that holds only an absolute overlay.
const rail = (key: string) => Box({ key, width: 1, flexShrink: 0 }, Box({ position: 'absolute', top: 0, left: 0, width: 1, height: '100%' }, Text('│')))

test('a rail that holds nothing in flow keeps its cell, so every row is as wide as its edges', async () => {
  const width = 20
  const tree = Box({ flexDirection: 'column' }, Text(`╭${RULE.repeat(width - 2)}╮`), Box({ flexDirection: 'row' }, rail('l'), Box({ flexGrow: 1 }, Text('hi')), rail('r')))
  const got = lines(await capture(tree as never, none as never, width))
  expect(got[1]!.length).toBe(width)
  expect(got[1]!.startsWith('│hi')).toBe(true)
  expect(got[1]!.endsWith('│')).toBe(true)
})

test('an absolute wedge replaces the corner of a bubble pushed to the right', async () => {
  const width = 20
  const bubble = Box({ flexDirection: 'column', flexShrink: 1 }, Box({ borderStyle: 'round' }, Text('hi')), Box({ position: 'absolute', top: 0, right: 0 }, Text('◥')))
  const got = lines(await capture(Box({ flexDirection: 'row', justifyContent: 'flex-end' }, bubble) as never, none as never, width))
  expect(got[0]!.length).toBe(width)
  expect(got[0]!.endsWith('◥')).toBe(true)
  expect(got[0]!.trimStart().startsWith('╭')).toBe(true)
  expect(got[1]!.endsWith('│hi│')).toBe(true)
})

test('a row spaced between puts its last cell at the right edge on the same line', async () => {
  const width = 30
  const got = lines(await capture(Box({ flexDirection: 'row', justifyContent: 'space-between' }, Text('first'), Text('×')) as never, none as never, width))
  expect(got.length).toBe(1)
  expect(got[0]!.length).toBe(width)
  expect(got[0]!.endsWith('×')).toBe(true)
})

test('an example wider than a settings card holds is refused', async () => {
  const wide: Captured = { lines: [{ spans: [{ text: 'x'.repeat(EXAMPLE_COLUMNS + 1) }] }] }
  expect(() => expectPreview({}, 'field', 'true', 'safe', wide)).toThrow('draw it narrower')
})

test('a settings card cuts an example line that outgrew a narrow pane instead of wrapping it', () => {
  const els: any = { Box: (props: any) => props, Text: (props: any) => props, Client: (props: any) => props, Button: (props: any) => props }
  const line = { spans: [{ text: 'a line' }] }
  const preview = { nerd: [line], safe: [line] }
  const rows = [{ key: 'mod.flag', label: 'Flag', kind: 'boolean', value: true, description: 'd' }] as never
  openSetting({ ui: { invalidate: () => undefined } }, { type: 'menu-entry', id: 'setting-open:mod.flag' })
  const body = settingsBody(els, lookFor(false), { rows, actions: [], working: false, run: () => undefined, previews: { flag: { true: preview } } })
  const found: any[] = []
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return
    if (typeof node.key === 'string' && node.key.startsWith('line-')) found.push(node)
    for (const child of [node.children ?? []].flat(Infinity)) walk(child)
  }
  walk(body)
  expect(found.length).toBe(1)
  expect(found[0].wrap).toBe('truncate-end')
})

test('a written line wider than an example wraps inside it', async () => {
  const got = lines(written([{ text: 'a long sentence that the host would wrap '.repeat(4) }]))
  expect(got.length).toBeGreaterThan(1)
  expect(got.every(line => line.length <= EXAMPLE_COLUMNS)).toBe(true)
})

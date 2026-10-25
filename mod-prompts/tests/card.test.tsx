// mod-prompts / tests/card.test.tsx, by v-amorim
// Tests the shared sticky card: its painted gap row, its tint and the space it holds.
import { expect, test } from 'claude-code/testing'

import { cardSpace, HEAD_ROWS, stickyCard } from '../hooks/card'
import { mix, THEME } from '../hooks/theme'

const els: any = { Box: (props: any) => props, Text: (props: any) => props }

type Node = { key?: string; children?: Node[]; [prop: string]: any }

const find = (node: Node, key: string): Node | undefined => (node.key === key ? node : (node.children ?? []).map(child => find(child, key)).find(Boolean))

test('the card paints one gap row under itself, so the first list row never touches the border', () => {
  const wrap = stickyCard(els, 0, 40, 6, []) as Node
  expect(wrap.height).toBe(7)
  expect(find(wrap, 'card')!.height).toBe(6)
  const gap = find(wrap, 'card-gap')!
  expect(gap.height).toBe(1)
  expect(gap.backgroundColor).toBe(THEME.bg)
})

test('the space held in the flow covers the card alone; the section under it brings the gap row', () => {
  expect((cardSpace(els, 6) as Node).height).toBe(6)
})

test('the card sticks at the top of the view, below the heading rows', () => {
  expect((stickyCard(els, 0, 40, 6, []) as Node).top).toBe(HEAD_ROWS)
  expect((stickyCard(els, 12, 40, 6, []) as Node).top).toBe(12)
})

test('the card has no left strip, a neutral border and a fill tinted toward its hue, accent by default', () => {
  const plain = find(stickyCard(els, 0, 40, 6, []) as Node, 'card')!
  expect(find(plain, 'card-strip')).toBeUndefined()
  expect(plain.borderColor).toBe(THEME.border)
  expect(plain.backgroundColor).toBe(mix(THEME.surface1, THEME.accent, 0.06))
  expect(find(stickyCard(els, 0, 40, 6, [], THEME.good) as Node, 'card')!.backgroundColor).toBe(mix(THEME.surface1, THEME.good, 0.06))
})

// mod-menu / tests/labels.test.tsx, by v-amorim
// Tests the icon a menu entry leads with and the `labels` mode that can hide its text.
import { expect, test } from 'claude-code/testing'

import { entryCells } from '../hooks/entry'
import { labelsOf, menuEntry, PILL, pillRow, splitRow } from '../hooks/pills'
import style from '../hooks/style'
import { decodeAll, THEME } from '../hooks/theme'

const els: any = { Box: (props: any) => props, Text: (props: any) => props, Client: (props: any) => props }

type Node = { key?: string; props?: Record<string, any>; children?: Node[] }

const entryProps = (node: unknown): Record<string, any> => {
  const found: Node[] = []
  const walk = (value: Node) => {
    if (value.key?.startsWith('menu-entry-')) found.push(value)
    for (const child of value.children ?? []) walk(child)
  }
  walk(node as Node)
  return found[0]!.props!
}

const ids = ['skills', 'prompts', 'filetree', 'progress', 'headsup']
const icon = (id: string) => decodeAll((style.glyphs.nerd.icon as Record<string, string>)[`menu-${id}`]!)

test('on Nerd an entry leads with its bare icon and keeps its label after a gap', () => {
  for (const id of ids) {
    const props = entryProps(menuEntry(els, true, id, { label: 'Name', isOpen: false }))
    expect(props.lead).toBe(icon(id))
    expect(props.label).toBe(' Name')
  }
})

test('labels never leaves the icon alone on Nerd', () => {
  const props = entryProps(menuEntry(els, true, 'skills', { label: 'Skills', isOpen: false, labels: 'never' }))
  expect(props.lead).toBe(icon('skills'))
  expect(props.label).toBe('')
})

test('safe mode has no icon, so labels never still shows the label', () => {
  const props = entryProps(menuEntry(els, false, 'skills', { label: 'Skills', isOpen: false, labels: 'never' }))
  expect(props.lead).toBeUndefined()
  expect(props.label).toBe('Skills')
})

test('an entry with no icon of its own, or a lead the caller set, is left as it was', () => {
  expect(entryProps(menuEntry(els, true, 'manager', { label: 'X', isOpen: false })).lead).toBeUndefined()
  expect(entryProps(menuEntry(els, true, 'skills', { label: 'Skills', isOpen: false, lead: '*' })).label).toBe('Skills')
})

test('the open pane is a lifted pill in primary-70; a closed entry rests on the group fill and lifts under the pointer', () => {
  const open = entryProps(menuEntry(els, true, 'skills', { label: 'Skills', isOpen: true }))
  expect(open.bg).toBe(THEME.lifted)
  expect(open.color).toBe(THEME.ok)
  const closed = entryProps(menuEntry(els, true, 'skills', { label: 'Skills', isOpen: false }))
  expect(closed.bg).toBe(PILL.primary)
  expect(closed.color).toBeUndefined()
  expect(closed.lift).toEqual({ scope: 'menu-closed-skills', bg: THEME.lifted })
})

test('every menu icon is one private-use code point, so it takes one cell', () => {
  for (const id of ids) expect([...icon(id)].length).toBe(1)
})

test('the labels state reads auto unless it says always or never, so a mod works without mod-menu', () => {
  expect(labelsOf('never')).toBe('never')
  expect(labelsOf('always')).toBe('always')
  expect(labelsOf('auto')).toBe('auto')
  expect(labelsOf(undefined)).toBe('auto')
  expect(labelsOf('sometimes')).toBe('auto')
})

// Elements shaped like the engine's: a type, the props with the key, and the children apart.
const real: any = {
  Box: ({ children, ...props }: any) => ({ type: 'Box', props, children: [children].flat() }),
  Text: ({ children, ...props }: any) => ({ type: 'Text', props, children: [children].flat() }),
  Client: (props: any) => ({ type: 'Client', props }),
}

const clients = (node: any): any[] => (node?.type === 'Client' ? [node.props] : (node?.children ?? []).flatMap(clients))
const entriesOf = (node: any) => clients(node).filter(each => each.key?.startsWith('menu-entry-')).map(each => each.props)
const row = (nerd: boolean, labels: 'auto' | 'always', columns: number, extra: unknown[] = []) =>
  pillRow(real, nerd, ['skills', 'prompts', 'headsup'].map(id => menuEntry(real, nerd, id, { label: 'A long name', isOpen: false, labels })), extra, [], null, columns)

test('labels auto keeps every label while the row fits the band', () => {
  for (const entry of entriesOf(row(true, 'auto', 200))) expect(entry.compact).toBe(false)
})

test('labels auto cuts every entry to its icon at once when the row is wider than the band', () => {
  const entries = entriesOf(row(true, 'auto', 30))
  expect(entries).toHaveLength(3)
  for (const entry of entries) expect(entry.compact).toBe(true)
})

test('labels auto counts a Client that says its own cells, and cuts it too', () => {
  const wide = real.Client({ key: 'wide', module: './other.tsx', height: 1, props: { cells: 60, compact: false } })
  const drawn = row(true, 'auto', 70, [wide])
  expect(clients(drawn).find(each => each.key === 'wide').props.compact).toBe(true)
  for (const entry of entriesOf(drawn)) expect(entry.compact).toBe(true)
})

test('a row cut to icons is measured with its labels, so a second pillRow over it keeps it cut', () => {
  const inner = row(true, 'auto', 30)
  const { group, row: rest } = splitRow(inner)
  for (const entry of entriesOf(pillRow(real, true, group, rest, [], null, 30))) expect(entry.compact).toBe(true)
})

test('labels always and safe mode never cut a label, however narrow the band', () => {
  for (const entry of entriesOf(row(true, 'always', 10))) expect(entry.compact).toBeUndefined()
  for (const entry of entriesOf(row(false, 'auto', 10))) expect(entry.compact).toBeUndefined()
})

test('an entry drawn compact shows its lead alone, and its cells count the label it hides', () => {
  const props = { id: 'x', label: ' Skills', isOpen: false, bg: '#000000', lead: 'S', tight: true, nerd: true }
  expect(entryCells({ ...props, compact: true })).toBe(1)
  expect(entryCells({ ...props, compact: false })).toBe(8)
})

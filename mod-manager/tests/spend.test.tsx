// mod-manager / tests/spend.test.tsx, by v-amorim
// Tests side-model spend: pricing, the list tip, the page card, a missing or corrupt file and Reset.
import { expect, mock, test } from 'claude-code/testing'

import { priceOf, PRICES, readSpend, spendLine, summarize } from '../hooks/spend'

const NOW = Date.UTC(2026, 9, 17, 12)
const DAY = 86_400_000
const dayOf = (ago: number) => new Date(NOW - ago * DAY).toISOString().slice(0, 10)
const SPEND_PATH = '/h/.claude/mods-data/alpha/spend.json'

const counts = (calls: number, input: number, output: number, cacheRead = 0, cacheWrite = 0) => ({ calls, input, output, cacheRead, cacheWrite })
const FILE = {
  days: {
    [dayOf(0)]: { haiku: counts(100, 400_000, 30_000, 200_000, 10_000), 'claude-sonnet-5-5': counts(112, 100_000, 11_000) },
    [dayOf(10)]: { haiku: counts(1000, 9_000_000, 9_000_000) },
  },
}
const LINE = 'about $0.37 (710K in · 41K out) · 212 calls · last 7 days'

test('the price table knows aliases, ids with suffixes and dated ids, and not a model it lacks', () => {
  expect(priceOf('haiku')).toBe(PRICES['haiku 5.5'])
  expect(priceOf('sonnet')).toBe(PRICES['sonnet 5.5'])
  expect(priceOf('claude-sonnet-5-5[1m]')).toBe(PRICES['sonnet 5.5'])
  expect(priceOf('claude-haiku-4-5-20251001')).toBe(PRICES['haiku 4.5'])
  expect(priceOf('claude-sonnet-5-20260101')).toBe(PRICES['sonnet 5.0'])
  expect(priceOf('mystery-model')).toBeUndefined()
  expect(priceOf('unknown')).toBeUndefined()
})

test('the line puts dollars first, then tokens, calls and the window, and drops days older than a week', () => {
  expect(spendLine(summarize(FILE, NOW)!)).toBe(LINE)
})

test('one call reads as 1 call, and an unpriced model adds tokens with a plus after the dollars', () => {
  expect(spendLine(summarize({ days: { [dayOf(0)]: { haiku: counts(1, 1000, 0) } } }, NOW)!)).toBe('about <$0.01 (1K in · 0 out) · 1 call · last 7 days')
  const mixed = { days: { [dayOf(1)]: { sonnet: counts(2, 1_000_000, 0), mystery: counts(3, 500, 5) } } }
  expect(spendLine(summarize(mixed, NOW)!)).toBe('about $2.00+ (1M in · 5 out) · 5 calls · last 7 days')
})

test('with no model priced the line has tokens and no dollars', () => {
  expect(spendLine(summarize({ days: { [dayOf(0)]: { mystery: counts(4, 2500, 300) } } }, NOW)!)).toBe('(2.5K in · 300 out) · 4 calls · last 7 days')
})

test('a file with no calls, a wrong shape or bad numbers is no spend', async () => {
  expect(summarize({ days: {} }, NOW)).toBeNull()
  expect(summarize(null, NOW)).toBeNull()
  expect(summarize({ days: [] }, NOW)).toBeNull()
  expect(summarize({ days: { [dayOf(0)]: { haiku: { calls: 'x', input: -5 } } } }, NOW)).toBeNull()
  expect(await readSpend(async () => '{not json', '/h/.claude', 'alpha', NOW)).toBeNull()
  expect(await readSpend(async () => Promise.reject(new Error('ENOENT')), '/h/.claude', 'alpha', NOW)).toBeNull()
})

const neutral = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
const manifest = JSON.stringify({ name: 'alpha', description: 'alpha does a thing', version: '1.0.0' })

async function pane($: any, on: any, spend?: string) {
  const files: Record<string, string> = {
    '/h/.claude/settings.json': JSON.stringify({ env: { CLAUDE_CODE_PLUGIN_DIRS: '~/.claude/mods/alpha' } }),
    '/h/.claude/mods/alpha/.claude-plugin/plugin.json': manifest,
    '/h/.claude/mods/alpha/hooks/hooks.json': JSON.stringify({ modules: ['./register.tsx'] }),
    '/h/.claude/mods/alpha/hooks/register.tsx': "on('tool.call', async () => {})",
    '/h/.claude/mods/alpha/showcase.json': JSON.stringify({ cost: { summary: 'Calls a model.' } }),
    ...(spend === undefined ? {} : { [SPEND_PATH]: spend }),
  }
  mock.clock(on, { now: NOW })
  on('fs.read', (_$: unknown, e: { path: string }) => {
    const path = neutral(e.path)
    if (!(path in files)) throw new Error('ENOENT')
    return { value: files[path]! }
  })
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    files[neutral(e.path)] = e.text
    return { value: undefined }
  })
  on('fs.list', () => ({ value: [{ name: 'alpha', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] }))
  on('env.get', (_$: unknown, e: { name: string }) => ({ value: e.name === 'USERPROFILE' ? '/h' : undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('config.list', () => ({ value: [] }))
  on('ui.render', ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })
  await $.command.run({ command: 'mod-manager' } as never)
  const ui = (await $.ui.mount({
    plugin: 'mod-manager',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'manager',
    props: { title: 'Mods', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  } as never)) as any
  return { ui, files }
}

const openPage = (ui: any) => ui.pointer({ in: 'list-dir', type: 'down', button: 'left', x: 10, y: 0 })
const hoverCost = async (ui: any) => {
  await ui.resize({ columns: 60, rows: 2, in: 'list-dir' })
  await ui.pointer({ in: 'list-dir', type: 'move', x: 60 - (1 + 8) - 3 + 1, y: 0 })
}

test('the cost pill tip leads with the spend line and still says the mod costs', { options: { icons: 'safe' } }, async ($, on) => {
  const { ui } = await pane($, on, JSON.stringify(FILE))
  await hoverCost(ui)
  // The long tip wraps onto the status row: its first words on the tip row, the rest on a second one.
  const tip = JSON.stringify(await ui.find({ key: 'footer-tip' }))
  expect(tip).toContain('"height":2')
  expect(tip).toContain('about $0.37 (710K in ')
  expect(tip).toContain('"children":["model and spends tokens, its page says how to turn it off"]')
  await ui.unmount()
})

test('a missing spend file leaves the tip as it was', { options: { icons: 'safe' } }, async ($, on) => {
  const { ui } = await pane($, on)
  await hoverCost(ui)
  expect(await ui.find({ type: 'Text', text: ' · calls a model and spends tokens, its page says how to turn it off' })).toBeDefined()
  await ui.unmount()
})

test('a corrupt spend file adds nothing to the tip and the card says no calls yet', { options: { icons: 'safe' } }, async ($, on) => {
  const { ui } = await pane($, on, '{"days": {"x"')
  await hoverCost(ui)
  expect(await ui.find({ type: 'Text', text: ' · calls a model and spends tokens, its page says how to turn it off' })).toBeDefined()
  await openPage(ui)
  expect(await ui.find({ type: 'Text', text: 'No side-model calls yet' })).toBeDefined()
  await ui.unmount()
})

test('the page leads its settings with a round Spend card holding the same line and a Reset', { options: { icons: 'safe' } }, async ($, on) => {
  const { ui } = await pane($, on, JSON.stringify(FILE))
  await openPage(ui)
  const card = await ui.find({ key: 'page-spend' })
  expect(card?.props.borderStyle).toBe('round')
  expect(card?.props.backgroundColor).toBeDefined()
  expect((await ui.find({ type: 'Text', text: 'Spend' }))?.props.bold).toBe(true)
  expect(await ui.find({ type: 'Text', text: LINE })).toBeDefined()
  expect(await ui.find({ key: 'page-spend-reset' })).toBeDefined()
  await ui.unmount()
})

test('a mod with no recorded calls shows No side-model calls yet and no Reset', { options: { icons: 'nerd' } }, async ($, on) => {
  const { ui } = await pane($, on, JSON.stringify({ days: {} }))
  await openPage(ui)
  expect(await ui.find({ type: 'Text', text: 'No side-model calls yet' })).toBeDefined()
  expect(await ui.find({ key: 'page-spend-reset' })).toBeUndefined()
  await ui.unmount()
})

test('Reset empties the mod spend file and the card goes back to no calls', { options: { icons: 'safe' } }, async ($, on) => {
  const { ui, files } = await pane($, on, JSON.stringify(FILE))
  await openPage(ui)
  await ui.pointer({ in: 'page-spend-reset', type: 'down', button: 'left', x: 1, y: 0 })
  expect(JSON.parse(files[SPEND_PATH]!)).toEqual({ days: {} })
  expect(await ui.find({ type: 'Text', text: 'No side-model calls yet' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: LINE })).toBeUndefined()
  await ui.unmount()
})

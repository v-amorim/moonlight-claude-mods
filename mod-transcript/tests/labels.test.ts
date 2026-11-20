// mod-transcript / tests/labels.test.ts, by v-amorim
// Tests the label each tool call shows, such as pattern and folder.
import { expect, test } from 'claude-code/testing'

import { toolLabel } from '../hooks/turns'

test('Grep shows its pattern and the folder it searches', () => {
  expect(toolLabel('Grep', { pattern: 'TODO', path: 'C:\\repo\\hooks' }, 0, 0)).toBe('Grep(TODO · repo/hooks)')
  expect(toolLabel('Grep', { pattern: 'TODO' }, 0, 0)).toBe('Grep(TODO)')
})

test('Bash and PowerShell show the first line of their command under their own name', () => {
  expect(toolLabel('Bash', { command: 'ls -la\necho x' }, 0, 0)).toBe('Bash(ls -la)')
  expect(toolLabel('PowerShell', { command: 'Get-ChildItem\nGet-Date' }, 0, 0)).toBe('PowerShell(Get-ChildItem)')
})

test('Glob shows its pattern', () => {
  expect(toolLabel('Glob', { pattern: '**/*.ts' }, 0, 0)).toBe('Glob(**/*.ts)')
})

test('WebFetch shows its URL and WebSearch its query', () => {
  expect(toolLabel('WebFetch', { url: 'https://example.com/a' }, 0, 0)).toBe('WebFetch(https://example.com/a)')
  expect(toolLabel('WebSearch', { query: 'mod transcript' }, 0, 0)).toBe('WebSearch(mod transcript)')
})

test('an MCP tool shows its main text argument, under its full name', () => {
  expect(toolLabel('mcp__github__search_issues', { query: 'bug', page: 2 }, 0, 0)).toBe('mcp__github__search_issues(bug)')
  expect(toolLabel('mcp__shop__find', { id: 'x1', count: 2 }, 0, 0)).toBe('mcp__shop__find(x1)')
})

test('a tool whose input holds no text shows its bare name, never JSON', () => {
  const label = toolLabel('mcp__lab__run', { options: { deep: true }, steps: [1, 2] }, 0, 0)
  expect(label).toBe('mcp__lab__run')
  expect(label).not.toContain('{')
})

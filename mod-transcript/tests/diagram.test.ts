// mod-transcript / tests/diagram.test.ts: the mermaid page and the commands that open it.
import { expect, test } from 'claude-code/testing'

import { diagramPage, isMermaid, openCommands } from '../hooks/diagram'

test('the page carries the chart escaped, mermaid from the CDN and the Moonlight canvas', () => {
  const page = diagramPage('graph TD\n  A-->B["<x> & y"]')
  expect(page).toContain('A--&gt;B["&lt;x&gt; &amp; y"]')
  expect(page).toContain('cdn.jsdelivr.net/npm/mermaid@11')
  expect(page).toContain('"background":"#0D0E17"')
  expect(page).not.toContain('<x>')
})

test('only a mermaid fence gets the diagram pill', () => {
  expect(isMermaid('mermaid')).toBe(true)
  expect(isMermaid('Mermaid')).toBe(true)
  expect(isMermaid('ts')).toBe(false)
})

test('macOS tries Opera GX, then Chrome, before the default browser; Windows uses start', () => {
  expect(openCommands('/h/d.html', false).slice(0, 3)).toEqual([['open', '-a', 'Opera GX', '/h/d.html'], ['open', '-a', 'Google Chrome', '/h/d.html'], ['open', '/h/d.html']])
  expect(openCommands('C:/h/d.html', true)).toEqual([['cmd', '/c', 'start', '""', 'C:/h/d.html']])
})

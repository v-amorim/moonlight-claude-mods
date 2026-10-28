// mod-transcript / hooks/diagram.ts: a mermaid block as a Moonlight browser page, and the commands that open it.

const MERMAID = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs'

const MOONLIGHT = {
  background: '#0D0E17',
  primaryColor: '#1C2033',
  primaryTextColor: '#EEEEFA',
  primaryBorderColor: '#7386D0',
  secondaryColor: '#252A42',
  tertiaryColor: '#141726',
  lineColor: '#9BA3C4',
  textColor: '#EEEEFA',
  noteBkgColor: '#252A42',
  noteTextColor: '#EEEEFA',
  noteBorderColor: '#8A9BE0',
  fontFamily: 'ui-monospace, "JetBrains Mono", monospace',
}

const escape = (code: string) => code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export const isMermaid = (lang: string) => /^mermaid$/i.test(lang)

export function diagramPage(code: string) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Diagram</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:${MOONLIGHT.background};color:${MOONLIGHT.textColor};font-family:${MOONLIGHT.fontFamily}}pre{margin:32px}</style>
</head><body>
<pre class="mermaid">${escape(code)}</pre>
<script type="module">
import mermaid from '${MERMAID}'
mermaid.initialize({ startOnLoad: true, theme: 'base', themeVariables: ${JSON.stringify(MOONLIGHT)} })
</script>
</body></html>
`
}

// Opera GX, then Chrome, where installed; then the system's default browser.
export const openCommands = (file: string, isWindows: boolean): string[][] =>
  isWindows ? [['cmd', '/c', 'start', '""', file]] : [['open', '-a', 'Opera GX', file], ['open', '-a', 'Google Chrome', file], ['open', file], ['xdg-open', file]]

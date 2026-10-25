// tests/grammar.test.ts, by v-amorim: the scopes each language's tokenizer gives, and the colored pieces the highlighter builds from them.
import { expect, test } from 'claude-code/testing'

import { languageOf, languageOfPath, tokenizeCode } from '../hooks/grammar'
import { chunkPieces, cutPieces, diffLanguage, highlight, previewPieces, useTheme } from '../hooks/hilite'
import { SYNTAX, THEME } from '../hooks/theme'
import { buildTheme } from '../hooks/vstheme'

// The scopes (after the source scope) of the token that is exactly `text`, on any line; the first one found.
function scopesOf(language: string, code: string, text: string) {
  for (const line of tokenizeCode(language, code) ?? []) {
    const found = line.find(token => token.text === text)
    if (found) return found.scopes.slice(1).join(' ')
  }
  return undefined
}

test('fence tags and file extensions map to a grammar, and an unknown one to none', () => {
  expect(['ts', 'tsx', 'TypeScript'].map(languageOf)).toEqual(['typescript', 'typescript', 'typescript'])
  expect(['js', 'mjs', 'jsx'].map(languageOf)).toEqual(['javascript', 'javascript', 'javascript'])
  expect(['sh', 'bash', 'zsh', 'shell', 'ps1', 'pwsh'].map(languageOf)).toEqual(['shell', 'shell', 'shell', 'shell', 'powershell', 'powershell'])
  expect(['yml', 'rs', 'golang', 'psql', 'patch', 'md', 'svg'].map(languageOf)).toEqual(['yaml', 'rust', 'go', 'sql', 'diff', 'markdown', 'xml'])
  expect(languageOf('brainfuck')).toBeUndefined()
  expect(languageOf('')).toBeUndefined()
  expect(languageOfPath('/repo/src/app.test.tsx')).toBe('typescript')
  expect(languageOfPath('C:\\x\\Cargo.toml')).toBe('toml')
  expect(languageOfPath('/repo/Makefile')).toBeUndefined()
})

test('a language without a grammar has no tokens', () => {
  expect(tokenizeCode('cobol', 'x')).toBeUndefined()
})

test('every line of every grammar joins back to the code it came from', () => {
  const samples: Record<string, string> = {
    typescript: 'const a = `x ${b}`\n/* c\n*/ foo(1) // z',
    python: 'x = """a\nb"""\n@d\ndef f(): pass',
    shell: 'echo "a\nb" | grep $(x) # c',
    css: 'a { color: red; }\n/* c */',
    html: '<a href="x">y</a>\n<!-- c\n-->',
    yaml: 'a: 1\n- b: "c"',
    sql: "select 'a''b' from t -- c",
  }
  for (const [language, code] of Object.entries(samples)) {
    expect((tokenizeCode(language, code) ?? []).map(line => line.map(token => token.text).join('')).join('\n')).toBe(code)
  }
})

test('typescript: keywords, calls, types, strings and numbers', () => {
  const code = "export async function load(id: string): Promise<User> {\n  const user = await db.find(id, 42)\n  return user ?? null\n}"
  expect(scopesOf('typescript', code, 'export')).toBe('keyword.control.export.ts')
  expect(scopesOf('typescript', code, 'function')).toBe('storage.type.function.ts')
  expect(scopesOf('typescript', code, 'load')).toBe('entity.name.function.ts')
  expect(scopesOf('typescript', code, 'string')).toBe('support.type.primitive.ts')
  expect(scopesOf('typescript', code, 'User')).toBe('entity.name.type.ts')
  expect(scopesOf('typescript', code, 'const')).toBe('storage.type.ts')
  expect(scopesOf('typescript', code, 'find')).toBe('entity.name.function.ts')
  expect(scopesOf('typescript', code, 'db')).toBe('variable.other.readwrite.ts')
  expect(scopesOf('typescript', code, '42')).toBe('constant.numeric.ts')
  expect(scopesOf('typescript', code, 'null')).toBe('constant.language.null.ts')
  expect(scopesOf('typescript', code, '??')).toBe('keyword.operator.logical.ts')
})

test('typescript: a block comment and a template string carry their state across lines', () => {
  const lines = tokenizeCode('typescript', 'a /* one\ntwo */ b\nconst s = `x\n${y}\nz` // c')!
  expect(lines[1]![0]).toMatchObject({ text: 'two ', scopes: ['source.ts', 'comment.block.ts'] })
  expect(lines[1]![lines[1]!.length - 1]).toMatchObject({ text: 'b', scopes: ['source.ts', 'variable.other.readwrite.ts'] })
  expect(lines[2]!.find(token => token.text === 'x')?.scopes).toEqual(['source.ts', 'string.template.ts'])
  expect(lines[3]!.find(token => token.text === 'y')?.scopes).toContain('meta.template.expression.ts')
  expect(lines[4]![0]).toMatchObject({ text: 'z', scopes: ['source.ts', 'string.template.ts'] })
  expect(lines[4]![lines[4]!.length - 1]!.scopes).toEqual(['source.ts', 'comment.line.double-slash.ts'])
})

test('typescript: a soft keyword used as a name stays a name', () => {
  expect(scopesOf('typescript', 'const type = 1', 'type')).toBe('variable.other.readwrite.ts')
  expect(scopesOf('typescript', 'type Row = {}', 'type')).toBe('storage.type.type.ts')
  expect(scopesOf('typescript', 'x.of(1)', 'of')).toBe('entity.name.function.ts')
})

test('javascript names its scopes with .js', () => {
  expect(scopesOf('javascript', 'let n = 1', 'let')).toBe('storage.type.js')
})

test('json: keys and values differ, jsonc keeps comments', () => {
  const code = '{\n  "name": "x", // c\n  "n": [1, true, null]\n}'
  expect(scopesOf('json', code, '"name"')).toBe('support.type.property-name.json string.quoted.double.json')
  expect(scopesOf('json', code, '"x"')).toBe('string.quoted.double.json')
  expect(scopesOf('json', code, '1')).toBe('constant.numeric.json')
  expect(scopesOf('json', code, 'true')).toBe('constant.language.json')
  expect(scopesOf('jsonc', code, '// c')).toBe('comment.line.double-slash.json.comments')
})

test('python: a docstring spans lines, defs, classes, decorators and builtins are named', () => {
  const code = '@cache\nclass Box(Base):\n    """one\n    two"""\n    def get(self, n=0):\n        return len(self.items) # c'
  const lines = tokenizeCode('python', code)!
  expect(lines[3]![0]).toMatchObject({ text: '    two', scopes: ['source.python', 'string.quoted.multi.python'] })
  expect(scopesOf('python', code, '@cache')).toBe('entity.name.function.decorator.python')
  expect(scopesOf('python', code, 'Box')).toBe('entity.name.type.class.python')
  expect(scopesOf('python', code, 'get')).toBe('entity.name.function.python')
  expect(scopesOf('python', code, 'self')).toBe('variable.language.special.self.python')
  expect(scopesOf('python', code, 'len')).toBe('support.function.builtin.python')
  expect(scopesOf('python', code, 'return')).toBe('keyword.control.flow.python')
  expect(scopesOf('python', code, '# c')).toBe('comment.line.number-sign.python')
})

test('shell: the command word, options, variables, strings, redirects and a string over two lines', () => {
  const code = 'sudo git commit -m "a $MSG" > out.txt\nFOO=1 ./run.sh && echo $(date)\nprintf "x\ny"'
  expect(scopesOf('shell', code, 'git')).toBe('entity.name.command.shell')
  expect(scopesOf('shell', code, '-m')).toBe('constant.other.option.shell')
  expect(scopesOf('shell', code, '$MSG')).toBe('string.quoted.double.shell variable.other.normal.shell')
  expect(scopesOf('shell', code, '>')).toBe('keyword.operator.redirect.shell')
  expect(scopesOf('shell', code, 'FOO=1')).toBe('variable.other.assignment.shell')
  expect(scopesOf('shell', code, './run.sh')).toBe('entity.name.command.shell')
  expect(scopesOf('shell', code, 'date')).toBe('string.interpolated.dollar.shell entity.name.command.shell')
  expect(scopesOf('shell', code, 'echo')).toBe('support.function.builtin.shell')
  const lines = tokenizeCode('shell', code)!
  expect(lines[3]![lines[3]!.length - 1]).toMatchObject({ text: '"', scopes: ['source.shell', 'string.quoted.double.shell', 'punctuation.definition.string.end.shell'] })
  expect(lines[3]![lines[3]!.length - 2]).toMatchObject({ text: 'y', scopes: ['source.shell', 'string.quoted.double.shell'] })
})

test('shell: the next line starts a new command', () => {
  expect(scopesOf('shell', 'ls -la\nnpm test', 'npm')).toBe('entity.name.command.shell')
})

test('css: selectors, properties, values, units and a comment over two lines', () => {
  const code = 'a.btn:hover > #x {\n  color: #fff;\n  margin: 0 -2px;\n  /* c\n  d */\n}'
  expect(scopesOf('css', code, 'a')).toBe('entity.name.tag.css')
  expect(scopesOf('css', code, '.btn')).toBe('entity.other.attribute-name.class.css')
  expect(scopesOf('css', code, ':hover')).toBe('entity.other.attribute-name.pseudo-class.css')
  expect(scopesOf('css', code, 'color')).toBe('meta.property-list.css support.type.property-name.css')
  expect(scopesOf('css', code, '#fff')).toBe('meta.property-list.css constant.other.color.rgb-value.css')
  expect(scopesOf('css', code, 'px')).toBe('meta.property-list.css keyword.other.unit.css')
  expect(tokenizeCode('css', code)![4]![0]).toMatchObject({ text: '  d ', scopes: ['source.css', 'meta.property-list.css', 'comment.block.css'] })
})

test('scss takes // comments, css does not', () => {
  expect(scopesOf('scss', '$a: 1; // c', '// c')).toBe('comment.line.double-slash.scss')
  expect(scopesOf('css', 'a { x: y } // c', '// c')).toBeUndefined()
})

test('html: tags, attributes, strings, entities and a comment over two lines', () => {
  const code = '<div class="a" hidden>x &amp; y</div>\n<!-- one\ntwo -->'
  expect(scopesOf('html', code, 'div')).toBe('meta.tag.html entity.name.tag.html')
  expect(scopesOf('html', code, 'class')).toBe('meta.tag.html entity.other.attribute-name.html')
  expect(scopesOf('html', code, 'a')).toBe('meta.tag.html string.quoted.double.html')
  expect(scopesOf('html', code, '&amp;')).toBe('constant.character.entity.html')
  expect(tokenizeCode('html', code)![2]![0]).toMatchObject({ text: 'two ', scopes: ['source.html', 'comment.block.html'] })
  expect(scopesOf('xml', '<a b="1"/>', 'a')).toBe('meta.tag.xml entity.name.tag.xml')
})

test('markdown: headings, lists, emphasis, code spans, links and a fence over lines', () => {
  const code = '# Title\n- **bold** and `code`\n```ts\nconst a = 1\n```\n[site](http://x.y)'
  expect(scopesOf('markdown', code, ' Title')).toBe('markup.heading.markdown entity.name.section.markdown')
  expect(scopesOf('markdown', code, '**bold**')).toBe('markup.bold.markdown')
  expect(scopesOf('markdown', code, '`code`')).toBe('markup.inline.raw.string.markdown')
  expect(scopesOf('markdown', code, 'const a = 1')).toBe('markup.fenced_code.block.markdown')
  expect(scopesOf('markdown', code, 'site')).toBe('string.other.link.title.markdown')
  expect(scopesOf('markdown', code, 'http://x.y')).toBe('markup.underline.link.markdown')
})

test('yaml: keys, strings, booleans, comments and list dashes', () => {
  const code = '# c\nname: "x"\nitems:\n  - on: true\n    n: 3'
  expect(scopesOf('yaml', code, 'name')).toBe('entity.name.tag.yaml')
  expect(scopesOf('yaml', code, '"')).toContain('string.quoted.double.yaml')
  expect(scopesOf('yaml', code, 'true')).toBe('constant.language.yaml')
  expect(scopesOf('yaml', code, '3')).toBe('constant.numeric.yaml')
  expect(scopesOf('yaml', code, '# c')).toBe('comment.line.number-sign.yaml')
})

test('toml: tables, keys, strings, dates, numbers and a multi-line string', () => {
  const code = '[server]\nhost = "a"\nport = 80\nsince = 2020-01-02\nnote = """one\ntwo"""'
  expect(scopesOf('toml', code, 'server')).toBe('entity.name.section.table.toml')
  expect(scopesOf('toml', code, 'host')).toBe('support.type.property-name.toml')
  expect(scopesOf('toml', code, '80')).toBe('constant.numeric.toml')
  expect(scopesOf('toml', code, '2020-01-02')).toBe('constant.numeric.date.toml')
  expect(tokenizeCode('toml', code)![5]![0]).toMatchObject({ text: 'two', scopes: ['source.toml', 'string.quoted.triple.double.toml'] })
})

test('rust: fn, macros, types, lifetimes and a nested-free block comment over lines', () => {
  const code = "fn pick<'a>(v: &'a [u8]) -> Option<Vec<u8>> {\n  println!(\"{}\", v.len()); /* a\n b */\n}"
  expect(scopesOf('rust', code, 'fn')).toBe('storage.type.function.rust')
  expect(scopesOf('rust', code, 'pick')).toBe('entity.name.function.rust')
  expect(scopesOf('rust', code, "'a")).toBe('storage.modifier.lifetime.rust')
  expect(scopesOf('rust', code, 'u8')).toBe('support.type.primitive.rust')
  expect(scopesOf('rust', code, 'Option')).toBe('entity.name.type.rust')
  expect(scopesOf('rust', code, 'println')).toBe('entity.name.function.macro.rust')
  expect(tokenizeCode('rust', code)![2]![0]).toMatchObject({ text: ' b ', scopes: ['source.rust', 'comment.block.rust'] })
})

test('go: func, types, builtins, raw strings over lines', () => {
  const code = 'func (s *Server) Run(n int) error {\n  m := make(map[string]int, n)\n  return nil\n}\nvar q = `a\nb`'
  expect(scopesOf('go', code, 'func')).toBe('storage.type.function.go')
  expect(scopesOf('go', code, 'Run')).toBe('entity.name.function.go')
  expect(scopesOf('go', code, 'int')).toBe('support.type.primitive.go')
  expect(scopesOf('go', code, 'make')).toBe('support.function.builtin.go')
  expect(scopesOf('go', code, ':=')).toBe('keyword.operator.assignment.go')
  expect(scopesOf('go', code, 'nil')).toBe('constant.language.go')
  expect(tokenizeCode('go', code)![5]![0]).toMatchObject({ text: 'b', scopes: ['source.go', 'string.quoted.raw.go'] })
})

test('sql: keywords in any case, table names, functions, strings with doubled quotes and comments', () => {
  const code = "select count(*), u.name from users u\nwhere u.n = 'it''s' ORDER by 1 -- c\n/* a\nb */"
  expect(scopesOf('sql', code, 'select')).toBe('keyword.other.sql')
  expect(scopesOf('sql', code, 'count')).toBe('support.function.sql')
  expect(scopesOf('sql', code, 'users')).toBe('constant.other.table-name.sql')
  expect(scopesOf('sql', code, 'ORDER')).toBe('keyword.other.order.sql')
  expect(scopesOf('sql', code, "''")).toBe('string.quoted.single.sql constant.character.escape.sql')
  expect(scopesOf('sql', code, '-- c')).toBe('comment.line.double-dash.sql')
  expect(tokenizeCode('sql', code)![3]![0]).toMatchObject({ text: 'b ', scopes: ['source.sql', 'comment.block.sql'] })
})

test('diff: headers, hunk ranges, inserted and deleted lines', () => {
  const code = 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new'
  expect(scopesOf('diff', code, '--- a/x')).toBe('meta.diff.header.from-file.diff')
  expect(scopesOf('diff', code, '+++ b/x')).toBe('meta.diff.header.to-file.diff')
  expect(scopesOf('diff', code, '@@ -1 +1 @@')).toBe('meta.diff.range.diff')
  expect(scopesOf('diff', code, '-old')).toBe('markup.deleted.diff')
  expect(scopesOf('diff', code, '+new')).toBe('markup.inserted.diff')
})

test('the diff header names the language of the code under it', () => {
  expect(diffLanguage('--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-x\n+y')).toBe('typescript')
  expect(diffLanguage('diff --git a/lib/x.py b/lib/x.py\n-x')).toBe('python')
  expect(diffLanguage('-x\n+y')).toBeUndefined()
})

const FIXTURE = buildTheme(
  {
    colors: { 'editor.foreground': '#101010' },
    tokenColors: [
      { scope: 'keyword', settings: { foreground: '#AA0000', fontStyle: 'bold' } },
      { scope: 'string', settings: { foreground: '#00AA00' } },
      { scope: 'comment', settings: { foreground: '#0000AA', fontStyle: 'italic' } },
    ],
  },
  'Fixture',
  '/f.json',
)

test('highlight colors each token from the active theme, merges equal neighbours and keeps the text', () => {
  useTheme(FIXTURE)
  try {
    const [line] = highlight('ts', 'return "a b" // c')!
    expect(line).toEqual([
      { text: 'return', color: '#AA0000', bold: true },
      { text: ' ', color: '#101010' },
      { text: '"a b"', color: '#00AA00' },
      { text: ' ', color: '#101010' },
      { text: '// c', color: '#0000AA', italic: true },
    ])
  } finally {
    useTheme(null)
  }
})

test('without a theme the palette colors the code, and an unknown language is left to the caller', () => {
  const [line] = highlight('ts', 'return 1')!
  expect(line!.map(piece => piece.color)).toEqual([SYNTAX.command, THEME.onSurface, SYNTAX.number])
  expect(highlight('cobol', 'MOVE 1 TO X')).toBeUndefined()
  expect(highlight(undefined, 'x')).toBeUndefined()
})

test('switching theme recolors a block already seen', () => {
  const before = highlight('ts', 'return 1')![0]![0]!.color
  useTheme(FIXTURE)
  try {
    expect(highlight('ts', 'return 1')![0]![0]!.color).toBe('#AA0000')
    expect(before).toBe(SYNTAX.command)
  } finally {
    useTheme(null)
  }
})

test('a code line wraps into rows that keep each piece color', () => {
  const rows = chunkPieces([{ text: 'abcd', color: '#111111' }, { text: 'efgh', color: '#222222', bold: true }], 6)
  expect(rows).toEqual([
    [{ text: 'abcd', color: '#111111' }, { text: 'ef', color: '#222222', bold: true }],
    [{ text: 'gh', color: '#222222', bold: true }],
  ])
  expect(chunkPieces([], 5)).toEqual([[]])
})

test('a code line is cut to its width with an ellipsis in the color it cuts', () => {
  expect(cutPieces([{ text: 'abcd', color: '#111111' }, { text: 'efgh', color: '#222222' }], 6)).toEqual([
    { text: 'abcd', color: '#111111' },
    { text: 'e', color: '#222222' },
    { text: '…', color: '#222222' },
  ])
  const short = [{ text: 'ab', color: '#111111' }]
  expect(cutPieces(short, 6)).toBe(short)
})

test('a Read preview keeps its line numbers out of the code, and an unnumbered line stays plain', () => {
  useTheme(FIXTURE)
  try {
    const got = previewPieces('typescript', [{ kind: 'out', text: '     1→return "x"' }, { kind: 'out', text: '[truncated]' }], true)!
    expect(got[0]!.lead).toBe('     1→')
    expect(got[0]!.code[0]).toMatchObject({ text: 'return', color: '#AA0000' })
    expect(got[1]).toBeUndefined()
  } finally {
    useTheme(null)
  }
})

test('an edit preview colors its new side and its old side as separate files', () => {
  useTheme(FIXTURE)
  try {
    const got = previewPieces('typescript', [{ kind: 'del', text: 'const a = "x' }, { kind: 'add', text: 'return 1' }, { kind: 'same', text: 'return "y"' }], false)!
    expect(got.map(line => line?.lead)).toEqual(['- ', '+ ', '  '])
    expect(got[1]!.code[0]).toMatchObject({ text: 'return', color: '#AA0000' })
    expect(got[2]!.code[2]).toMatchObject({ text: '"y"', color: '#00AA00' })
  } finally {
    useTheme(null)
  }
})

test('a preview of an unknown file type has no colors', () => {
  expect(previewPieces(undefined, [{ kind: 'out', text: '1→x' }], true)).toBeUndefined()
})

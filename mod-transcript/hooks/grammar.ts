// mod-transcript / hooks/grammar.ts, by v-amorim: a small regex tokenizer that names each token with the TextMate scopes VS Code grammars use; pure.

// A token's scope stack, outermost first, such as ['source.ts', 'string.quoted.double.ts'].
export type Token = { text: string; scopes: readonly string[] }

type Pick = string | ((match: RegExpExecArray) => string | undefined)
// `scope` may hold several scopes split by spaces; `parts` names each capture group in turn (undefined: the rule's own scope).
type Rule = { re: RegExp; scope?: Pick; parts?: (string | undefined)[]; push?: string; pop?: boolean; to?: string }
// `eol`: the state ends with its line, as a quoted string does; `onEol`: it turns into another at the line's end, as a shell's arguments into the next command.
type State = { scope?: string; eol?: boolean; onEol?: string; rules: Rule[] }
type Grammar = { suffix: string; states: Record<string, State>; start: string }

const rule = (re: RegExp, scope?: Pick, more: Partial<Rule> = {}): Rule => ({
  re: new RegExp(re.source, `y${more.parts ? 'd' : ''}${re.flags.includes('i') ? 'i' : ''}`),
  scope,
  ...more,
})

const interned = new Map<string, readonly string[]>()
const intern = (scopes: string[]) => {
  const key = scopes.join(' ')
  let known = interned.get(key)
  if (!known) interned.set(key, (known = scopes))
  return known
}

// The tokens of each line of `code`; a state that is open at a line's end (a block comment, a template string) carries on into the next.
export function tokenize(grammar: Grammar, code: string): Token[][] {
  const { suffix, states } = grammar
  const spell = (scope: string) => scope.split(' ').map(each => `${each}.${suffix}`)
  const stack = [grammar.start]
  const lines: Token[][] = []
  for (const line of code.split('\n')) {
    const tokens: Token[] = []
    const emit = (text: string, extra: string[]) => {
      if (!text) return
      const scopes = intern([`source.${suffix}`, ...stack.flatMap(name => (states[name]!.scope ? spell(states[name]!.scope!) : [])), ...extra])
      const last = tokens[tokens.length - 1]
      if (last && last.scopes === scopes) tokens[tokens.length - 1] = { text: last.text + text, scopes }
      else tokens.push({ text, scopes })
    }
    let at = 0
    while (at < line.length) {
      const state = states[stack[stack.length - 1]!]!
      let found: { rule: Rule; match: RegExpExecArray } | undefined
      for (const candidate of state.rules) {
        candidate.re.lastIndex = at
        const match = candidate.re.exec(line)
        if (match && match[0]) {
          found = { rule: candidate, match }
          break
        }
      }
      if (!found) {
        const char = String.fromCodePoint(line.codePointAt(at)!)
        emit(char, [])
        at += char.length
        continue
      }
      const { rule: hit, match } = found
      if (hit.push) stack.push(hit.push)
      if (hit.to) stack[stack.length - 1] = hit.to
      const own = typeof hit.scope === 'function' ? hit.scope(match) : hit.scope
      if (hit.parts) {
        const { indices } = match as RegExpExecArray & { indices: [number, number][] }
        let cursor = match.index
        hit.parts.forEach((part, group) => {
          const span = indices[group + 1]
          if (!span) return
          emit(line.slice(cursor, span[0]), own ? spell(own) : [])
          emit(line.slice(span[0], span[1]), [...(own ? spell(own) : []), ...(part ? spell(part) : [])])
          cursor = span[1]
        })
        emit(line.slice(cursor, match.index + match[0].length), own ? spell(own) : [])
      } else emit(match[0], own ? spell(own) : [])
      if (hit.pop && stack.length > 1) stack.pop()
      at += match[0].length
    }
    while (stack.length > 1 && states[stack[stack.length - 1]!]!.eol) stack.pop()
    const { onEol } = states[stack[stack.length - 1]!]!
    if (onEol) stack[stack.length - 1] = onEol
    lines.push(tokens)
  }
  return lines
}

const word = (match: RegExpExecArray) => ({ w: match[0], before: match.input.slice(0, match.index), after: match.input.slice(match.index + match[0].length) })
const isCall = (after: string) => /^\s*(?:<[^()<>]*>)?\(/.test(after)
const isMember = (before: string) => /(?<!\.\.)\.\s*$/.test(before)
const list = (...words: string[]) => new Set(words)
const NUMBER = /\b(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?)n?\b|\.\d[\d_]*\b/

// Line and block comments, shared by the C-like grammars.
const slashComments = (block = true): Rule[] => [
  rule(/\/\/.*/, 'comment.line.double-slash'),
  ...(block ? [rule(/\/\*\*?/, 'punctuation.definition.comment.begin', { push: 'block' })] : []),
]
const blockState: State = { scope: 'comment.block', rules: [rule(/\*\//, 'punctuation.definition.comment.end', { pop: true })] }

// Quoted strings that end with their line.
const quoted = (quote: string, push: string): Rule => rule(new RegExp(quote), 'punctuation.definition.string.begin', { push })
const quotedState = (quote: string, name: string, escape = /\\./): State => ({
  scope: `string.quoted.${name}`,
  eol: true,
  rules: [rule(escape, 'constant.character.escape'), rule(new RegExp(quote), 'punctuation.definition.string.end', { pop: true })],
})

const ECMA_WORDS: Record<string, string> = {}
const into = (scope: string, ...names: string[]) => names.forEach(name => (ECMA_WORDS[name] = scope))
into('keyword.control.conditional', 'if', 'else', 'switch', 'case', 'default')
into('keyword.control.loop', 'for', 'while', 'do')
into('keyword.control.flow', 'return', 'break', 'continue', 'throw', 'await', 'yield')
into('keyword.control.trycatch', 'try', 'catch', 'finally')
into('keyword.control.import', 'import')
into('keyword.control.export', 'export')
into('keyword.control.from', 'from')
into('keyword.control.as', 'as')
into('storage.type', 'const', 'let', 'var')
into('storage.type.function', 'function')
into('storage.type.class', 'class')
into('storage.type.interface', 'interface')
into('storage.type.type', 'type')
into('storage.type.enum', 'enum')
into('storage.type.namespace', 'namespace', 'module')
into('storage.modifier', 'public', 'private', 'protected', 'readonly', 'static', 'abstract', 'declare', 'override', 'extends', 'implements')
into('storage.modifier.async', 'async')
into('keyword.operator.new', 'new')
into('keyword.operator.expression', 'typeof', 'instanceof', 'in', 'of', 'delete', 'void', 'keyof', 'infer', 'is', 'satisfies')
into('constant.language.boolean', 'true', 'false')
into('constant.language.null', 'null')
into('constant.language.undefined', 'undefined')
into('constant.language', 'NaN', 'Infinity')
into('variable.language.this', 'this', 'super')
into('support.type.primitive', 'string', 'number', 'boolean', 'any', 'unknown', 'never', 'object', 'symbol', 'bigint')
into('support.type.object.console', 'console')
const SOFT = list('type', 'of', 'as', 'from', 'declare', 'namespace', 'module', 'async', 'readonly', 'static', 'abstract', 'override', 'is', 'in', 'keyof', 'infer', 'satisfies', 'interface', 'enum')
const BUILTIN_CLASSES = list('Math', 'JSON', 'Object', 'Array', 'Promise', 'Map', 'Set', 'WeakMap', 'Date', 'Error', 'RegExp', 'Number', 'String', 'Boolean', 'Symbol', 'process', 'window', 'document', 'globalThis')

function ecmaWord(match: RegExpExecArray) {
  const { w, before, after } = word(match)
  const call = isCall(after)
  if (isMember(before)) return call ? 'entity.name.function' : 'variable.other.property'
  const declared = /\b(function\*?|class|interface|type|enum|namespace|extends|implements)\s+$/.exec(before)?.[1]
  const keyword = ECMA_WORDS[w]
  const isPlain = SOFT.has(w) && !/^\s+[\w${'"`*(]/.test(after)
  if (keyword && !isPlain) return keyword
  if (declared === 'function') return 'entity.name.function'
  if (declared === 'class') return 'entity.name.type.class'
  if (declared === 'extends' || declared === 'implements') return 'entity.other.inherited-class'
  if (declared) return 'entity.name.type'
  if (BUILTIN_CLASSES.has(w)) return 'support.class.builtin'
  if (/\bnew\s+$/.test(before)) return 'entity.name.type'
  if (call) return 'entity.name.function'
  if (/^[A-Z][A-Za-z0-9]*[a-z]/.test(w)) return 'entity.name.type'
  if (/^[A-Z][A-Z0-9_]+$/.test(w)) return 'variable.other.constant'
  return 'variable.other.readwrite'
}

const ecmaBase = (): Rule[] => [
  ...slashComments(),
  quoted('"', 'dq'),
  quoted("'", 'sq'),
  rule(/`/, 'punctuation.definition.string.begin', { push: 'template' }),
  rule(NUMBER, 'constant.numeric'),
  rule(/@[A-Za-z_$][\w$.]*/, 'entity.name.function.decorator'),
  rule(/[A-Za-z_$][\w$]*/, ecmaWord),
  rule(/=>/, 'storage.type.function.arrow'),
  rule(/===|!==|==|!=|<=|>=|<<|>>>?|[<>]/, 'keyword.operator.comparison'),
  rule(/&&|\|\||\?\?=?|!/, 'keyword.operator.logical'),
  rule(/\+\+|--/, 'keyword.operator.increment'),
  rule(/\.\.\./, 'keyword.operator.spread'),
  rule(/[+\-*/%]=?|\*\*=?/, 'keyword.operator.arithmetic'),
  rule(/=/, 'keyword.operator.assignment'),
  rule(/\?\.?|:/, 'keyword.operator.ternary'),
  rule(/[|&^~]=?/, 'keyword.operator.bitwise'),
  rule(/[{}]/, 'punctuation.definition.block'),
  rule(/[()]/, 'meta.brace.round'),
  rule(/[[\]]/, 'meta.brace.square'),
  rule(/;/, 'punctuation.terminator.statement'),
  rule(/,/, 'punctuation.separator.comma'),
  rule(/\./, 'punctuation.accessor'),
]

function ecma(suffix: string): Grammar {
  const base = ecmaBase()
  const brace = rule(/\{/, 'punctuation.definition.block', { push: 'brace' })
  return {
    suffix,
    start: 'base',
    states: {
      base: { rules: base },
      block: blockState,
      dq: quotedState('"', 'double'),
      sq: quotedState("'", 'single'),
      template: {
        scope: 'string.template',
        rules: [
          rule(/\\./, 'constant.character.escape'),
          rule(/\$\{/, 'punctuation.definition.template-expression.begin', { push: 'expr' }),
          rule(/`/, 'punctuation.definition.string.end', { pop: true }),
        ],
      },
      expr: { scope: 'meta.template.expression', rules: [rule(/\}/, 'punctuation.definition.template-expression.end', { pop: true }), brace, ...base] },
      brace: { rules: [rule(/\}/, 'punctuation.definition.block', { pop: true }), brace, ...base] },
    },
  }
}

const JSON_GRAMMAR = (suffix: string): Grammar => ({
  suffix,
  start: 'base',
  states: {
    base: {
      rules: [
        ...slashComments(),
        rule(/"(?:[^"\\]|\\.)*"(?=\s*:)/, 'support.type.property-name string.quoted.double'),
        rule(/"(?:[^"\\]|\\.)*"/, 'string.quoted.double'),
        rule(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, 'constant.numeric'),
        rule(/\b(?:true|false|null)\b/, 'constant.language'),
        rule(/[{}]/, 'punctuation.definition.dictionary'),
        rule(/[[\]]/, 'punctuation.definition.array'),
        rule(/:/, 'punctuation.separator.dictionary.key-value'),
        rule(/,/, 'punctuation.separator.dictionary.pair'),
      ],
    },
    block: blockState,
  },
})

const PY_WORDS: Record<string, string> = {}
const py = (scope: string, ...names: string[]) => names.forEach(name => (PY_WORDS[name] = scope))
py('keyword.control.flow', 'if', 'elif', 'else', 'for', 'while', 'try', 'except', 'finally', 'with', 'return', 'raise', 'yield', 'break', 'continue', 'pass', 'assert', 'del', 'global', 'nonlocal', 'await', 'match', 'case')
py('keyword.control.import', 'import', 'from', 'as')
py('keyword.operator.logical', 'and', 'or', 'not', 'in', 'is')
py('storage.type.function', 'def')
py('storage.type.class', 'class')
py('storage.type.function.lambda', 'lambda')
py('storage.modifier.async', 'async')
py('constant.language', 'True', 'False', 'None')
py('variable.language.special.self', 'self', 'cls')
py('support.function.builtin', 'print', 'len', 'range', 'int', 'str', 'float', 'list', 'dict', 'set', 'tuple', 'open', 'isinstance', 'enumerate', 'zip', 'map', 'filter', 'sorted', 'sum', 'min', 'max', 'abs', 'bool', 'type', 'super', 'repr', 'input', 'any', 'all', 'getattr', 'setattr', 'hasattr')

function pyWord(match: RegExpExecArray) {
  const { w, before, after } = word(match)
  if (isMember(before)) return isCall(after) ? 'entity.name.function' : 'variable.other.attribute'
  const declared = /\b(def|class)\s+$/.exec(before)?.[1]
  if (declared === 'def') return 'entity.name.function'
  if (declared === 'class') return 'entity.name.type.class'
  if (PY_WORDS[w]) return PY_WORDS[w]
  if (isCall(after)) return /^[A-Z]/.test(w) ? 'entity.name.type' : 'entity.name.function'
  if (/^[A-Z][A-Za-z0-9]*[a-z]/.test(w)) return 'entity.name.type'
  if (/^[A-Z][A-Z0-9_]+$/.test(w)) return 'constant.other.caps'
  return 'variable.other.readwrite'
}

const PY_PREFIX = '(?:[rRbBuU]|[fF][rR]?|[rR][fF])?'
const pyString = (name: string, quote: string): State => ({ scope: `string.quoted.${name}`, rules: [rule(/\\./, 'constant.character.escape'), rule(new RegExp(quote), 'punctuation.definition.string.end', { pop: true })] })

const PYTHON: Grammar = {
  suffix: 'python',
  start: 'base',
  states: {
    base: {
      rules: [
        rule(/#.*/, 'comment.line.number-sign'),
        rule(new RegExp(`${PY_PREFIX}"""`), 'punctuation.definition.string.begin', { push: 'tqd' }),
        rule(new RegExp(`${PY_PREFIX}'''`), 'punctuation.definition.string.begin', { push: 'tqs' }),
        rule(new RegExp(`${PY_PREFIX}"`), 'punctuation.definition.string.begin', { push: 'dq' }),
        rule(new RegExp(`${PY_PREFIX}'`), 'punctuation.definition.string.begin', { push: 'sq' }),
        rule(/@[\w.]+/, 'entity.name.function.decorator'),
        rule(NUMBER, 'constant.numeric'),
        rule(/[A-Za-z_]\w*/, pyWord),
        rule(/->|:=/, 'keyword.operator'),
        rule(/==|!=|<=|>=|<|>/, 'keyword.operator.comparison'),
        rule(/\*\*=?|\/\/=?|[+\-*/%@&|^~]=?|<<|>>/, 'keyword.operator.arithmetic'),
        rule(/=/, 'keyword.operator.assignment'),
        rule(/[()[\]{}]/, 'punctuation.definition.brace'),
        rule(/[:,;]/, 'punctuation.separator'),
        rule(/\./, 'punctuation.accessor'),
      ],
    },
    tqd: { scope: 'string.quoted.multi', rules: [rule(/\\./, 'constant.character.escape'), rule(/"""/, 'punctuation.definition.string.end', { pop: true })] },
    tqs: { scope: 'string.quoted.multi', rules: [rule(/\\./, 'constant.character.escape'), rule(/'''/, 'punctuation.definition.string.end', { pop: true })] },
    dq: { ...pyString('double', '"'), eol: true },
    sq: { ...pyString('single', "'"), eol: true },
  },
}

const VARIABLE = rule(/\$\{[^}]*\}|\$[A-Za-z_]\w*|\$[0-9?#@*!$-]/, 'variable.other.normal')
const SHELL_KEYWORDS = /(?:if|then|else|elif|fi|for|while|until|do|done|case|esac|in|select|function)(?=\s|;|$)/
const SHELL_WRAPPERS = /(?:sudo|env|nice|time|command|nohup|exec|xargs|builtin)(?=\s|$)/
const SHELL_BUILTINS = list('cd', 'echo', 'export', 'source', 'alias', 'unset', 'set', 'read', 'printf', 'test', 'exit', 'return', 'eval', 'shift', 'trap', 'local', 'declare', 'pwd', 'true', 'false', 'wait')

const SHELL_WORD = /[^\s&|;()<>'"$`#{}][^\s&|;()<>'"$`{}]*/

// The two modes of a command line: command position (before the command word) and arguments. A `$(...)` runs the same two modes under its own names, so its `)` can end it.
function shellModes(prefix: string, scope: string | undefined, lead: Rule[]) {
  const [cmd, args] = [`${prefix}cmd`, `${prefix}args`]
  const common: Rule[] = [
    ...lead,
    rule(/#.*/, 'comment.line.number-sign'),
    rule(/\$\(/, 'punctuation.definition.subshell', { push: 'subcmd' }),
    VARIABLE,
    rule(/'/, 'punctuation.definition.string.begin', { push: 'sq' }),
    rule(/"/, 'punctuation.definition.string.begin', { push: 'dq' }),
    rule(/&&|\|\||\||;;|;|&(?!>)/, 'keyword.operator.logical', { to: cmd }),
    rule(/[(){}]/, 'punctuation.section', { to: cmd }),
    rule(/\d?>>?&?\d?|<<?<?|&>>?/, 'keyword.operator.redirect', { to: args }),
  ]
  return {
    [cmd]: {
      scope,
      rules: [
        ...common,
        rule(SHELL_KEYWORDS, 'keyword.control'),
        rule(/[A-Za-z_]\w*=[^\s&|;()<>'"$]*/, 'variable.other.assignment'),
        rule(SHELL_WRAPPERS, 'entity.name.command'),
        rule(/-[^\s&|;()<>'"$]+/, 'constant.other.option'),
        rule(SHELL_WORD, found => (SHELL_BUILTINS.has(found[0]) ? 'support.function.builtin' : 'entity.name.command'), { to: args }),
      ],
    },
    [args]: {
      scope,
      onEol: cmd,
      rules: [...common, rule(/--?[\w-]+/, 'constant.other.option'), rule(/\d+(?:\.\d+)?(?=\s|$|;)/, 'constant.numeric'), rule(SHELL_WORD)],
    },
  }
}

function shell(suffix: string): Grammar {
  const inString: Rule[] = [rule(/\\./, 'constant.character.escape'), rule(/\$\(/, 'punctuation.definition.subshell', { push: 'subcmd' }), VARIABLE]
  return {
    suffix,
    start: 'cmd',
    states: {
      ...shellModes('', undefined, []),
      ...shellModes('sub', 'string.interpolated.dollar', [rule(/\)/, 'punctuation.definition.subshell', { pop: true })]),
      sq: { scope: 'string.quoted.single', rules: [rule(/'/, 'punctuation.definition.string.end', { pop: true })] },
      dq: { scope: 'string.quoted.double', rules: [...inString, rule(/"/, 'punctuation.definition.string.end', { pop: true })] },
    },
  }
}

function css(suffix: string): Grammar {
  const common: Rule[] = [
    rule(/\/\*/, 'punctuation.definition.comment.begin', { push: 'block' }),
    ...(suffix === 'scss' ? [rule(/\/\/.*/, 'comment.line.double-slash')] : []),
    quoted('"', 'dq'),
    quoted("'", 'sq'),
    rule(/@[\w-]+/, 'keyword.control.at-rule'),
    rule(/\{/, 'punctuation.section.property-list.begin', { push: 'decl' }),
  ]
  return {
    suffix,
    start: 'base',
    states: {
      base: {
        rules: [
          ...common,
          rule(/\.[\w-]+/, 'entity.other.attribute-name.class'),
          rule(/#[\w-]+/, 'entity.other.attribute-name.id'),
          rule(/::?[\w-]+/, 'entity.other.attribute-name.pseudo-class'),
          rule(/\[[^\]]*\]/, 'entity.other.attribute-name.attribute'),
          rule(/\$[\w-]+/, 'variable.other'),
          rule(/[A-Za-z][\w-]*/, 'entity.name.tag'),
          rule(/[>+~*,]/, 'keyword.operator.combinator'),
        ],
      },
      decl: {
        scope: 'meta.property-list',
        rules: [
          rule(/\}/, 'punctuation.section.property-list.end', { pop: true }),
          ...common,
          rule(/[\w-]+(?=\s*:(?!:)[^;{}]*(?:[;}]|$))/, 'support.type.property-name'),
          rule(/!important/, 'keyword.other.important'),
          rule(/#[0-9a-fA-F]{3,8}\b/, 'constant.other.color.rgb-value'),
          rule(/(-?\d*\.?\d+)([a-zA-Z%]*)/, undefined, { parts: ['constant.numeric', 'keyword.other.unit'] }),
          rule(/--[\w-]+|\$[\w-]+/, 'variable.other'),
          rule(/[\w-]+(?=\()/, 'support.function'),
          rule(/[A-Za-z][\w-]*/, 'support.constant.property-value'),
          rule(/:/, 'punctuation.separator.key-value'),
          rule(/;/, 'punctuation.terminator.rule'),
        ],
      },
      block: blockState,
      dq: quotedState('"', 'double'),
      sq: quotedState("'", 'single'),
    },
  }
}

function markup(suffix: string): Grammar {
  const attribute = (quote: string, name: string): State => ({ scope: `string.quoted.${name}`, rules: [rule(new RegExp(quote), 'punctuation.definition.string.end', { pop: true })] })
  return {
    suffix,
    start: 'base',
    states: {
      base: {
        rules: [
          rule(/<!--/, 'punctuation.definition.comment.begin', { push: 'block' }),
          rule(/<!\[CDATA\[[\s\S]*?(?:\]\]>|$)/, 'string.unquoted.cdata'),
          rule(/<![A-Za-z][^>]*>|<\?[\s\S]*?(?:\?>|$)/, 'meta.tag.metadata.doctype'),
          rule(/(<\/?)([\w:.-]+)/, undefined, { parts: ['punctuation.definition.tag.begin', 'entity.name.tag'], push: 'tag' }),
          rule(/&[#\w]+;/, 'constant.character.entity'),
        ],
      },
      tag: {
        scope: 'meta.tag',
        rules: [
          rule(/\/?>/, 'punctuation.definition.tag.end', { pop: true }),
          rule(/[\w:.@-]+/, 'entity.other.attribute-name'),
          rule(/=/, 'punctuation.separator.key-value'),
          rule(/"/, 'punctuation.definition.string.begin', { push: 'dqa' }),
          rule(/'/, 'punctuation.definition.string.begin', { push: 'sqa' }),
        ],
      },
      block: { scope: 'comment.block', rules: [rule(/-->/, 'punctuation.definition.comment.end', { pop: true })] },
      dqa: attribute('"', 'double'),
      sqa: attribute("'", 'single'),
    },
  }
}

const MARKDOWN: Grammar = {
  suffix: 'markdown',
  start: 'base',
  states: {
    base: {
      rules: [
        rule(/^\s*(?:```|~~~).*$/, 'punctuation.definition.markdown', { push: 'fence' }),
        rule(/^(#{1,6})(\s.*)$/, 'markup.heading', { parts: ['punctuation.definition.heading', 'entity.name.section'] }),
        rule(/^\s*(?:---+|\*\*\*+|___+)\s*$/, 'meta.separator'),
        rule(/^(\s*>)(.*)$/, undefined, { parts: ['punctuation.definition.quote.begin', 'markup.quote'] }),
        rule(/^\s*(?:[-*+]|\d+[.)])(?=\s)/, 'punctuation.definition.list.begin markup.list'),
        rule(/`[^`\n]+`/, 'markup.inline.raw.string'),
        rule(/\*\*[^*\n]+\*\*|__[^_\n]+__/, 'markup.bold'),
        rule(/\*[^*\n]+\*|(?<![\w])_[^_\n]+_(?![\w])/, 'markup.italic'),
        rule(/~~[^~\n]+~~/, 'markup.strikethrough'),
        rule(/(!?\[)([^\]\n]*)(\]\()([^)\n]*)(\))/, undefined, { parts: ['punctuation.definition.link', 'string.other.link.title', 'punctuation.definition.link', 'markup.underline.link', 'punctuation.definition.link'] }),
        rule(/https?:\/\/[^\s)>]+/, 'markup.underline.link'),
      ],
    },
    fence: { scope: 'markup.fenced_code.block', rules: [rule(/^\s*(?:```|~~~)\s*$/, 'punctuation.definition.markdown', { pop: true })] },
  },
}

const YAML: Grammar = {
  suffix: 'yaml',
  start: 'base',
  states: {
    base: {
      rules: [
        rule(/(?<![^\s])#.*/, 'comment.line.number-sign'),
        rule(/^---|^\.\.\./, 'entity.other.document.begin'),
        rule(/^(\s*(?:-\s+)*)((?:"[^"]*"|'[^']*'|[\w.\/ -]+?))(\s*:)(?=\s|$)/, undefined, { parts: [undefined, 'entity.name.tag', 'punctuation.separator.key-value'] }),
        rule(/-(?=\s)/, 'punctuation.definition.block.sequence.item'),
        rule(/"/, 'punctuation.definition.string.begin', { push: 'dq' }),
        rule(/'/, 'punctuation.definition.string.begin', { push: 'sq' }),
        rule(/\b(?:true|false|yes|no|on|off|null)\b|~(?=\s|$)/i, 'constant.language'),
        rule(/-?\d+(?:\.\d+)?(?=\s|$|,|\])/, 'constant.numeric'),
        rule(/[&*][\w-]+/, 'variable.other.anchor'),
        rule(/![\w!<>.:/-]*/, 'storage.type.tag-handle'),
        rule(/[|>][-+]?(?=\s|$)/, 'keyword.control.flow.block-scalar'),
        rule(/[[\]{},]/, 'punctuation.definition'),
      ],
    },
    dq: quotedState('"', 'double'),
    sq: quotedState("'", 'single'),
  },
}

const TOML: Grammar = {
  suffix: 'toml',
  start: 'base',
  states: {
    base: {
      rules: [
        rule(/#.*/, 'comment.line.number-sign'),
        rule(/^(\s*\[\[?)([^\]]+)(\]\]?)/, undefined, { parts: ['punctuation.definition.table', 'entity.name.section.table', 'punctuation.definition.table'] }),
        rule(/^(\s*[\w."'-]+)(\s*=)/, undefined, { parts: ['support.type.property-name', 'keyword.operator.assignment'] }),
        rule(/"""/, 'punctuation.definition.string.begin', { push: 'tqd' }),
        rule(/'''/, 'punctuation.definition.string.begin', { push: 'tqs' }),
        rule(/"/, 'punctuation.definition.string.begin', { push: 'dq' }),
        rule(/'/, 'punctuation.definition.string.begin', { push: 'sq' }),
        rule(/\d{4}-\d\d-\d\d(?:[Tt ]\d\d:\d\d:\d\d(?:\.\d+)?(?:[Zz]|[+-]\d\d:\d\d)?)?/, 'constant.numeric.date'),
        rule(/\b(?:true|false)\b/, 'constant.language.boolean'),
        rule(/[+-]?(?:0x[\da-fA-F_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?|inf|nan)\b/, 'constant.numeric'),
        rule(/[[\]{},=]/, 'punctuation.separator'),
      ],
    },
    tqd: { scope: 'string.quoted.triple.double', rules: [rule(/\\./, 'constant.character.escape'), rule(/"""/, 'punctuation.definition.string.end', { pop: true })] },
    tqs: { scope: 'string.quoted.triple.single', rules: [rule(/'''/, 'punctuation.definition.string.end', { pop: true })] },
    dq: quotedState('"', 'double'),
    sq: { scope: 'string.quoted.single', eol: true, rules: [rule(/'/, 'punctuation.definition.string.end', { pop: true })] },
  },
}

const RUST_WORDS: Record<string, string> = {}
const rs = (scope: string, ...names: string[]) => names.forEach(name => (RUST_WORDS[name] = scope))
rs('keyword.control', 'if', 'else', 'match', 'for', 'while', 'loop', 'break', 'continue', 'return', 'in')
rs('storage.type.function', 'fn')
rs('storage.type', 'let')
rs('storage.modifier', 'const', 'static', 'mut', 'pub', 'unsafe', 'async', 'move', 'dyn', 'ref', 'extern')
rs('storage.type.struct', 'struct')
rs('storage.type.enum', 'enum')
rs('storage.type.trait', 'trait')
rs('storage.type.impl', 'impl')
rs('storage.type.type', 'type')
rs('storage.type.module', 'mod')
rs('keyword.other', 'use', 'as', 'where', 'await', 'crate')
rs('constant.language.boolean', 'true', 'false')
rs('variable.language.self', 'self', 'Self', 'super')
rs('support.type.primitive', 'i8', 'i16', 'i32', 'i64', 'i128', 'isize', 'u8', 'u16', 'u32', 'u64', 'u128', 'usize', 'f32', 'f64', 'bool', 'char', 'str')

function rustWord(match: RegExpExecArray) {
  const { w, before, after } = word(match)
  if (RUST_WORDS[w]) return RUST_WORDS[w]
  if (/\bfn\s+$/.test(before)) return 'entity.name.function'
  if (/^!(?!=)/.test(after)) return 'entity.name.function.macro'
  if (/\b(?:struct|enum|trait|type|impl|mod)\s+$/.test(before) || /^[A-Z][A-Za-z0-9]*[a-z]/.test(w)) return 'entity.name.type'
  if (isCall(after)) return 'entity.name.function'
  if (/^[A-Z][A-Z0-9_]+$/.test(w)) return 'variable.other.constant'
  if (isMember(before)) return 'variable.other.member'
  return 'variable.other.readwrite'
}

const RUST: Grammar = {
  suffix: 'rust',
  start: 'base',
  states: {
    base: {
      rules: [
        rule(/\/\/.*/, 'comment.line.double-slash'),
        rule(/\/\*/, 'punctuation.definition.comment.begin', { push: 'block' }),
        rule(/"/, 'punctuation.definition.string.begin', { push: 'dq' }),
        rule(/b?'(?:\\.[^']*|[^'\\])'/, 'string.quoted.single.char'),
        rule(/'[A-Za-z_]\w*/, 'storage.modifier.lifetime'),
        rule(/#!?\[[^\]]*\]/, 'meta.attribute'),
        rule(/\b\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?(?:[iu](?:8|16|32|64|128|size)|f32|f64)?\b|\b0[xXbBoO][\da-fA-F_]+\b/, 'constant.numeric'),
        rule(/[A-Za-z_]\w*/, rustWord),
        rule(/::/, 'punctuation.separator.namespace'),
        rule(/=>|->/, 'keyword.operator'),
        rule(/==|!=|<=|>=|&&|\|\||[<>]/, 'keyword.operator.comparison'),
        rule(/[+\-*/%&|^!]=?|<<|>>|\.\.=?/, 'keyword.operator.arithmetic'),
        rule(/=/, 'keyword.operator.assignment'),
        rule(/[{}()[\]]/, 'punctuation.brace'),
        rule(/[;,:]/, 'punctuation.separator'),
        rule(/\./, 'punctuation.accessor'),
      ],
    },
    block: blockState,
    dq: { scope: 'string.quoted.double', rules: [rule(/\\./, 'constant.character.escape'), rule(/"/, 'punctuation.definition.string.end', { pop: true })] },
  },
}

const GO_WORDS: Record<string, string> = {}
const go = (scope: string, ...names: string[]) => names.forEach(name => (GO_WORDS[name] = scope))
go('keyword.control', 'if', 'else', 'for', 'range', 'switch', 'case', 'default', 'break', 'continue', 'return', 'goto', 'select', 'fallthrough', 'go', 'defer')
go('storage.type.function', 'func')
go('storage.type', 'var', 'const', 'type', 'struct', 'interface', 'map', 'chan')
go('keyword.package', 'package', 'import')
go('constant.language', 'true', 'false', 'nil', 'iota')
go('support.type.primitive', 'int', 'int8', 'int16', 'int32', 'int64', 'uint', 'uint8', 'uint16', 'uint32', 'uint64', 'uintptr', 'float32', 'float64', 'string', 'bool', 'byte', 'rune', 'error', 'any', 'complex64', 'complex128')
go('support.function.builtin', 'make', 'len', 'cap', 'append', 'copy', 'delete', 'new', 'panic', 'recover', 'print', 'println', 'close')

function goWord(match: RegExpExecArray) {
  const { w, before, after } = word(match)
  if (isMember(before)) return isCall(after) ? 'entity.name.function' : 'variable.other.property'
  if (GO_WORDS[w]) return GO_WORDS[w]
  if (/\bfunc\s+(?:\([^)]*\)\s*)?$/.test(before)) return 'entity.name.function'
  if (/\btype\s+$/.test(before)) return 'entity.name.type'
  if (isCall(after)) return 'entity.name.function'
  if (/^[A-Z][A-Za-z0-9]*[a-z]/.test(w)) return 'entity.name.type'
  return 'variable.other.readwrite'
}

const GO: Grammar = {
  suffix: 'go',
  start: 'base',
  states: {
    base: {
      rules: [
        ...slashComments(),
        quoted('"', 'dq'),
        rule(/`/, 'punctuation.definition.string.begin', { push: 'raw' }),
        rule(/'(?:\\.[^']*|[^'\\])'/, 'string.quoted.rune'),
        rule(NUMBER, 'constant.numeric'),
        rule(/[A-Za-z_]\w*/, goWord),
        rule(/:=|<-/, 'keyword.operator.assignment'),
        rule(/==|!=|<=|>=|&&|\|\||[<>]/, 'keyword.operator.comparison'),
        rule(/\+\+|--/, 'keyword.operator.increment'),
        rule(/\.\.\./, 'keyword.operator.ellipsis'),
        rule(/[+\-*/%&|^!]=?|<<|>>|&\^/, 'keyword.operator.arithmetic'),
        rule(/=/, 'keyword.operator.assignment'),
        rule(/[{}()[\]]/, 'punctuation.definition.brace'),
        rule(/[;,:]/, 'punctuation.separator'),
        rule(/\./, 'punctuation.accessor'),
      ],
    },
    block: blockState,
    dq: quotedState('"', 'double'),
    raw: { scope: 'string.quoted.raw', rules: [rule(/`/, 'punctuation.definition.string.end', { pop: true })] },
  },
}

const SQL_WORDS: Record<string, string> = {}
const sql = (scope: string, ...names: string[]) => names.forEach(name => (SQL_WORDS[name] = scope))
sql('keyword.other', 'select', 'from', 'where', 'group', 'having', 'join', 'left', 'right', 'inner', 'outer', 'full', 'cross', 'on', 'as', 'limit', 'offset', 'union', 'all', 'distinct', 'insert', 'into', 'values', 'update', 'set', 'delete', 'create', 'alter', 'drop', 'table', 'index', 'view', 'primary', 'key', 'foreign', 'references', 'default', 'unique', 'case', 'when', 'then', 'else', 'end', 'with', 'returning', 'if', 'exists', 'using', 'over', 'partition', 'begin', 'commit', 'rollback')
sql('keyword.other.order', 'order', 'by', 'asc', 'desc')
sql('keyword.operator.logical', 'and', 'or', 'not', 'in', 'is', 'like', 'ilike', 'between')
sql('constant.language', 'null', 'true', 'false')
sql('storage.type', 'int', 'integer', 'bigint', 'smallint', 'varchar', 'char', 'text', 'boolean', 'timestamp', 'timestamptz', 'date', 'time', 'numeric', 'decimal', 'serial', 'uuid', 'json', 'jsonb', 'float', 'double')

function sqlWord(match: RegExpExecArray) {
  const { w, before, after } = word(match)
  const kind = SQL_WORDS[w.toLowerCase()]
  if (kind && !isMember(before)) return kind
  if (isCall(after)) return 'support.function'
  if (/\b(?:from|join|into|update|table)\s+$/i.test(before)) return 'constant.other.table-name'
  return 'variable.other'
}

const SQL: Grammar = {
  suffix: 'sql',
  start: 'base',
  states: {
    base: {
      rules: [
        rule(/--.*/, 'comment.line.double-dash'),
        rule(/\/\*/, 'punctuation.definition.comment.begin', { push: 'block' }),
        rule(/'/, 'punctuation.definition.string.begin', { push: 'sq' }),
        rule(/"[^"]*"|`[^`]*`/, 'string.quoted.other'),
        rule(NUMBER, 'constant.numeric'),
        rule(/[A-Za-z_]\w*/, sqlWord),
        rule(/<>|<=|>=|!=|[=<>]/, 'keyword.operator.comparison'),
        rule(/[+\-*/%|]+/, 'keyword.operator.arithmetic'),
        rule(/[(),;.]/, 'punctuation.separator'),
      ],
    },
    block: blockState,
    sq: { scope: 'string.quoted.single', rules: [rule(/''/, 'constant.character.escape'), rule(/'/, 'punctuation.definition.string.end', { pop: true })] },
  },
}

const DIFF: Grammar = {
  suffix: 'diff',
  start: 'base',
  states: {
    base: {
      rules: [
        rule(/^\+\+\+.*/, 'meta.diff.header.to-file'),
        rule(/^---.*/, 'meta.diff.header.from-file'),
        rule(/^(?:diff |index |new file|deleted file|similarity|rename ).*/, 'meta.diff.header'),
        rule(/^@@.*?@@/, 'meta.diff.range'),
        rule(/^\+.*/, 'markup.inserted'),
        rule(/^-.*/, 'markup.deleted'),
        rule(/^!.*/, 'markup.changed'),
      ],
    },
  },
}

const GRAMMARS: Record<string, () => Grammar> = {
  typescript: () => ecma('ts'),
  javascript: () => ecma('js'),
  json: () => JSON_GRAMMAR('json'),
  jsonc: () => JSON_GRAMMAR('json.comments'),
  python: () => PYTHON,
  shell: () => shell('shell'),
  powershell: () => shell('powershell'),
  css: () => css('css'),
  scss: () => css('scss'),
  html: () => markup('html'),
  xml: () => markup('xml'),
  markdown: () => MARKDOWN,
  yaml: () => YAML,
  toml: () => TOML,
  rust: () => RUST,
  go: () => GO,
  sql: () => SQL,
  diff: () => DIFF,
}

const TAGS: Record<string, string[]> = {
  typescript: ['ts', 'tsx', 'typescript', 'mts', 'cts'],
  javascript: ['js', 'jsx', 'javascript', 'mjs', 'cjs', 'node'],
  json: ['json'],
  jsonc: ['jsonc', 'json5'],
  python: ['py', 'python', 'python3', 'pyi'],
  shell: ['sh', 'bash', 'shell', 'zsh', 'console', 'shellscript'],
  powershell: ['ps1', 'psm1', 'pwsh', 'powershell'],
  css: ['css', 'less'],
  scss: ['scss', 'sass'],
  html: ['html', 'htm', 'xhtml', 'vue', 'svelte'],
  xml: ['xml', 'svg', 'xsd', 'plist'],
  markdown: ['md', 'markdown', 'mdx'],
  yaml: ['yml', 'yaml'],
  toml: ['toml'],
  rust: ['rs', 'rust'],
  go: ['go', 'golang'],
  sql: ['sql', 'psql', 'mysql', 'pgsql', 'postgres', 'postgresql'],
  diff: ['diff', 'patch'],
}

const BY_TAG = new Map(Object.entries(TAGS).flatMap(([name, tags]) => tags.map(tag => [tag, name] as const)))

// The grammar a fence tag or a file extension names; undefined for a language the mod has no grammar for.
export const languageOf = (tag: string) => BY_TAG.get(tag.trim().toLowerCase().replace(/^\./, ''))

export const languageOfPath = (path: string) => {
  const name = path.split(/[\\/]/).pop() ?? ''
  const dot = name.lastIndexOf('.')
  return dot > 0 ? languageOf(name.slice(dot + 1)) : undefined
}

const built = new Map<string, Grammar>()

// Every line of `code` as tokens, or undefined when `language` has no grammar.
export function tokenizeCode(language: string, code: string): Token[][] | undefined {
  const make = GRAMMARS[language]
  if (!make) return undefined
  let grammar = built.get(language)
  if (!grammar) built.set(language, (grammar = make()))
  return tokenize(grammar, code)
}

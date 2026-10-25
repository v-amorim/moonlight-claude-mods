// mod-blast-radius / hooks/risk.ts, by v-amorim
// Pure matcher: which Bash commands are risky. No engine calls, so tests feed it plain strings.
import words from './text'
import { fill } from './theme'

export type RiskKind =
  | 'rm'
  | 'mv'
  | 'chmod'
  | 'find-delete'
  | 'redirect'
  | 'sql'
  | 'git-reset'
  | 'git-clean'
  | 'git-checkout'
  | 'git-push-force'
  | 'git-branch-delete'
  | 'rule'

export type Risk = {
  kind: RiskKind
  label: string
  // Why it is held, in the words the person reads.
  reason: string
  // Path operands (rm, chmod, find roots, mv sources) or branch names (git branch -D).
  targets: string[]
  // Arguments after the git subcommand, or the redirect target for kind redirect.
  args: string[]
  // Folder an earlier `cd` or `git -C` moved to, relative to the session folder; null means the session folder.
  dir: string | null
  dest?: string
  statements?: string[]
  pattern?: string
  // A built-in check already covers it: it only lends its operands to the preview.
  isPreviewOnly?: boolean
  // The matcher itself failed, so the command is held without a verdict.
  isError?: boolean
  // Where the rule comes from: the built-in checks, this mod's own extras (the default), the person's rules.json, or an error.
  source?: 'hook' | 'blast' | 'rules' | 'error'
}

// action pass: a matching step skips the checks and the hold rules, unless a critical check marks it.
export type UserRule = { re: RegExp; reason: string; action?: 'pass' }

type Redirect = { target: string; append: boolean }
type Segment = { words: string[]; redirects: Redirect[] }

// Splits a command line into simple commands, honoring quotes, and records output redirects.
export function split(command: string): Segment[] {
  const segments: Segment[] = []
  let words: string[] = []
  let redirects: Redirect[] = []
  let word = ''
  let has = false
  let pending: { append: boolean; isOutput: boolean } | null = null

  const endWord = () => {
    if (!has) return
    if (pending) {
      if (pending.isOutput) redirects.push({ target: word, append: pending.append })
      pending = null
    } else words.push(word)
    word = ''
    has = false
  }
  const endSegment = () => {
    endWord()
    if (words.length || redirects.length) segments.push({ words, redirects })
    words = []
    redirects = []
  }
  const marker = (text: string) => {
    endSegment()
    segments.push({ words: [text], redirects: [] })
  }

  for (let i = 0; i < command.length; i++) {
    const c = command[i]!
    if (c === "'") {
      const end = command.indexOf("'", i + 1)
      const stop = end < 0 ? command.length : end
      word += command.slice(i + 1, stop)
      has = true
      i = stop
    } else if (c === '"') {
      i++
      for (; i < command.length && command[i] !== '"'; i++) {
        if (command[i] === '\\' && i + 1 < command.length && /["\\$`]/.test(command[i + 1]!)) i++
        word += command[i]
      }
      has = true
    } else if (c === '\\' && i + 1 < command.length) {
      word += command[++i]
      has = true
    } else if (c === ' ' || c === '\t' || c === '\r') {
      endWord()
    } else if (c === '\n' || c === ';' || c === '`') {
      endSegment()
    } else if (c === '|') {
      endSegment()
      if (command[i + 1] === '|' || command[i + 1] === '&') i++
    } else if (c === '&') {
      if (command[i + 1] === '>') {
        endWord()
        const append = command[i + 2] === '>'
        i += append ? 2 : 1
        pending = { append, isOutput: true }
      } else {
        endSegment()
        if (command[i + 1] === '&') i++
      }
    } else if (c === '(') {
      marker('(')
    } else if (c === ')') {
      marker(')')
    } else if (c === '>') {
      if (has && /^\d+$/.test(word)) {
        word = ''
        has = false
      } else endWord()
      let append = false
      let isOutput = true
      if (command[i + 1] === '>') {
        append = true
        i++
      } else if (command[i + 1] === '|') i++
      else if (command[i + 1] === '&') {
        isOutput = false
        i++
      }
      pending = { append, isOutput }
    } else if (c === '<') {
      endWord()
      while (command[i + 1] === '<' || command[i + 1] === '-') i++
      pending = { append: false, isOutput: false }
    } else {
      word += c
      has = true
    }
  }
  endSegment()
  return segments
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
const PREFIXES = new Set(['command', 'exec', 'env', 'nohup', 'time', 'then', 'do', 'else', 'elif', '!', '{', 'builtin'])
const SUDO_VALUE_OPTIONS = new Set(['-u', '-g', '-C', '-D', '-h', '-p', '-r', '-t', '-T', '-U'])
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh'])
const NULL_DEVICES = /^(?:\/dev\/(?:null|stdout|stderr|tty|fd\/\d+)|nul)$/i

const isFlag = (word: string) => word.startsWith('-') && word !== '-'
const baseName = (word: string) => word.replace(/\\/g, '/').split('/').pop()!.replace(/\.exe$/i, '')
const hasShort = (flags: string[], letters: string) =>
  flags.some(flag => /^-[^-]/.test(flag) && new RegExp(`[${letters}]`).test(flag))

// Path operands after `--` count even when they look like flags.
function operands(args: string[]) {
  const out: string[] = []
  let isRest = false
  for (const arg of args) {
    if (!isRest && arg === '--') isRest = true
    else if (isRest || !isFlag(arg)) out.push(arg)
  }
  return out
}

export const joinDir = (dir: string | null, arg: string | undefined) => {
  if (arg === undefined || arg === '~' || arg.startsWith('/') || arg.startsWith('~/') || /^[A-Za-z]:/.test(arg)) return arg ?? '~'
  return dir ? `${dir}/${arg}` : arg
}

function gitRisk(args: string[], dir: string | null): Risk | null {
  let gitDir = dir
  let at = 0
  while (at < args.length && isFlag(args[at]!)) {
    if (args[at] === '-C' && at + 1 < args.length) {
      gitDir = joinDir(gitDir, args[at + 1])
      at += 2
    } else if ((args[at] === '-c' || args[at] === '--git-dir' || args[at] === '--work-tree') && at + 1 < args.length) at += 2
    else at++
  }
  const sub = args[at]
  const rest = args.slice(at + 1)
  const flags = rest.filter(isFlag)
  const make = (kind: RiskKind, label: string, extra: Partial<Risk> = {}): Risk => ({ kind, label, reason: REASON[kind], targets: [], args: rest, dir: gitDir, ...extra })

  if (sub === 'reset' && rest.includes('--hard')) return make('git-reset', 'git reset --hard')
  if (sub === 'clean') {
    const force = flags.includes('--force') || hasShort(flags, 'f')
    const dry = flags.includes('--dry-run') || hasShort(flags, 'n')
    return force && !dry ? make('git-clean', 'git clean') : null
  }
  if (sub === 'push') {
    const forced = rest.some(arg => arg === '--force' || arg === '-f' || arg.startsWith('--force-with-lease') || arg.startsWith('+') || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(arg))
    return forced ? make('git-push-force', 'git push --force') : null
  }
  if (sub === 'branch') {
    const del = hasShort(flags, 'D') || (flags.includes('--delete') && (flags.includes('--force') || hasShort(flags, 'f'))) || (hasShort(flags, 'd') && hasShort(flags, 'f'))
    return del ? make('git-branch-delete', 'git branch -D', { targets: operands(rest) }) : null
  }
  if (sub === 'checkout') {
    const wholeTree = rest.includes('--') || rest.includes('.') || flags.includes('--force') || hasShort(flags, 'f')
    return wholeTree ? make('git-checkout', 'git checkout --') : null
  }
  if (sub === 'restore') {
    const stagedOnly = flags.includes('--staged') && !flags.includes('--worktree') && !hasShort(flags, 'W')
    return stagedOnly ? null : make('git-checkout', 'git restore')
  }
  return null
}

// A simple command: a risk, { cd } for a folder change, or null.
type Cd = { cd: string | null; raw: string | undefined }

function classifySegment(words: string[], dir: string | null, pushed: (string | null)[], depth: number): Risk | Cd | null {
  const list = [...words]
  const skipPrefixes = () => {
    while (list.length && (ASSIGNMENT.test(list[0]!) || PREFIXES.has(list[0]!))) list.shift()
  }
  skipPrefixes()
  if (list[0] === 'sudo') {
    list.shift()
    while (list.length && isFlag(list[0]!)) if (SUDO_VALUE_OPTIONS.has(list.shift()!)) list.shift()
  }
  skipPrefixes()
  let viaXargs = false
  if (list[0] === 'xargs') {
    viaXargs = true
    list.shift()
    while (list.length && isFlag(list[0]!)) list.shift()
  }
  const first = list.shift()
  if (first === undefined) return null
  const cmd = baseName(first)
  const lower = cmd.toLowerCase()
  const args = list

  if (cmd === 'cd') return { cd: args[0] === '-' ? '-' : joinDir(dir, args[0]), raw: args[0] }
  if (cmd === 'pushd') {
    pushed.push(dir)
    return { cd: joinDir(dir, args[0]), raw: undefined }
  }
  if (cmd === 'popd') return { cd: pushed.length ? pushed.pop()! : '-', raw: undefined }

  if (SHELLS.has(cmd)) {
    const at = args.findIndex(arg => /^-[a-z]*c[a-z]*$/.test(arg))
    if (at >= 0 && args[at + 1] !== undefined && depth < 3) return structural(args[at + 1]!, TEMP_NONE, dir, depth + 1)
    return null
  }

  const flags = (args.includes('--') ? args.slice(0, args.indexOf('--')) : args).filter(isFlag)
  if (['rm', 'rmdir', 'del', 'erase', 'rd', 'remove-item', 'ri'].includes(lower)) {
    const isWindows = ['del', 'erase', 'rd'].includes(lower)
    const isCmdlet = ['remove-item', 'ri'].includes(lower)
    const targets: string[] = []
    let isRest = false
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!
      if (!isRest && arg === '--') isRest = true
      else if (isCmdlet && /^-(?:literal)?path$/i.test(arg) && args[i + 1] !== undefined) targets.push(args[++i]!)
      else if (!isRest && (isFlag(arg) || (isWindows && /^\/[a-z]$/i.test(arg)))) continue
      else targets.push(arg)
    }
    const shown = [...new Set([...flags, ...(isWindows ? args.filter(arg => /^\/[a-z]$/i.test(arg)) : [])])]
    return { kind: 'rm', label: `${lower}${shown.length ? ` ${shown.join(' ')}` : ''}`, reason: REASON.rm, targets: viaXargs ? [] : targets, args, dir, isPreviewOnly: lower === 'rm' }
  }

  if (cmd === 'mv') {
    if (flags.includes('--no-clobber') || hasShort(flags, 'n')) return null
    const at = args.findIndex(arg => arg === '-t' || arg === '--target-directory' || arg.startsWith('--target-directory='))
    let dest: string | undefined
    let sources = operands(args)
    if (at >= 0) {
      dest = args[at]!.includes('=') ? args[at]!.split('=')[1] : args[at + 1]
      sources = operands(args.filter((arg, index) => index !== at && index !== at + 1 && !arg.startsWith('--target-directory=')))
    } else if (sources.length >= 2) dest = sources.pop()
    if (dest === undefined || viaXargs) return dest === undefined ? null : { kind: 'mv', label: 'mv', reason: REASON.mv, targets: [], args, dir, dest }
    return { kind: 'mv', label: 'mv', reason: REASON.mv, targets: sources, args, dir, dest }
  }

  if (cmd === 'chmod' || cmd === 'chown' || cmd === 'chgrp') {
    const isRecursive = flags.includes('--recursive') || hasShort(flags, 'R')
    if (!isRecursive) return null
    const paths = operands(args)
    return { kind: 'chmod', label: `${cmd} -R`, reason: REASON.chmod, targets: paths.slice(1), args, dir, isPreviewOnly: cmd !== 'chgrp' }
  }

  if (cmd === 'find') {
    const execRm = args.some((arg, index) => (arg === '-exec' || arg === '-execdir') && /^(?:\S*\/)?rm$/.test(args[index + 1] ?? ''))
    if (!args.includes('-delete') && !execRm) return null
    const roots: string[] = []
    for (const arg of args) {
      if (arg.startsWith('-') || arg === '(' || arg === '!') break
      roots.push(arg)
    }
    return { kind: 'find-delete', label: 'find -delete', reason: REASON['find-delete'], targets: roots.length ? roots : ['.'], args, dir, isPreviewOnly: !execRm }
  }

  if (cmd === 'git') return gitRisk(args, dir)

  return null
}

// A heredoc body is data for the program that reads it; only a shell or a SQL client runs what it reads.
export const RUNS_BODY = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'pwsh', 'powershell', 'psql', 'mysql', 'mariadb', 'sqlite3', 'sqlcmd', 'usql', 'pgcli', 'mycli', 'sqlplus', 'duckdb', 'clickhouse-client', 'mongosh', 'cockroach'])
export const HEREDOC_MARK = /(?<!<)<<(?!<)-?\s*(?:'([^']+)'|"([^"]+)"|\\?([A-Za-z_][\w-]*))/g

// The program a line hands its heredoc to: the first word of the last simple command before the marker.
export function receiverOf(before: string) {
  const last = split(before).filter(segment => segment.words.length).pop()
  const words = [...(last?.words ?? [])]
  while (words.length && (ASSIGNMENT.test(words[0]!) || PREFIXES.has(words[0]!) || words[0] === 'sudo')) words.shift()
  return baseName(words[0] ?? '').toLowerCase()
}

export type Heredoc = { receiver: string; lines: number; isCode: boolean }

// Cuts the heredoc bodies that are only data. Also reports each heredoc, in order, for the details pane.
export function heredocs(command: string): { code: string; found: Heredoc[] } {
  const lines = command.split('\n')
  const out: string[] = []
  const found: Heredoc[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    out.push(line)
    const marks = [...line.matchAll(HEREDOC_MARK)]
    if (!marks.length) continue
    const receiver = receiverOf(line.slice(0, marks[0]!.index))
    const isCode = RUNS_BODY.has(receiver)
    let cursor = i + 1
    for (const mark of marks) {
      const delimiter = mark[1] ?? mark[2] ?? mark[3]!
      let end = cursor
      while (end < lines.length && lines[end]!.trim() !== delimiter) end++
      if (isCode) out.push(...lines.slice(cursor, end))
      found.push({ receiver, lines: end - cursor, isCode })
      cursor = Math.min(lines.length, end + 1)
    }
    i = cursor - 1
  }
  return { code: out.join('\n'), found }
}

export const stripHeredocs = (command: string) => heredocs(command).code

const REASON: Record<RiskKind, string> = {
  rm: words.reasons.kindRm,
  mv: words.reasons.kindMv,
  chmod: words.reasons.kindChmod,
  'find-delete': words.reasons.kindFindExec,
  redirect: words.reasons.kindRedirect,
  sql: words.reasons.sql,
  'git-reset': words.reasons.gitForce,
  'git-clean': words.reasons.gitDestructive,
  'git-checkout': words.reasons.gitDestructive,
  'git-push-force': words.reasons.gitForce,
  'git-branch-delete': words.reasons.gitDestructive,
  rule: words.reasons.kindRule,
}

// ---- Temp-safe deletion logic ----

const TEMP_SAFE_PREFIXES = ['/tmp/', '/private/tmp/', '$TMPDIR', '${TMPDIR}']
const WINDOWS_TEMP_VARS = ['%TEMP%', '%TMP%', '$TEMP', '${TEMP}', '$TMP', '${TMP}']
const WINDOWS_TEMP_RE = /^(?:[a-z]:\/|\/[a-z]\/)users\/[^/]+\/appdata\/local\/temp\//i
const VAR_ASSIGN_RE = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.+)$/
const CYGPATH_RE = /^\$\(\s*cygpath\b[^()]*?\s+(\S+?)\s*\)$|^`\s*cygpath\b[^`]*?\s+(\S+?)\s*`$/
const VAR_REF_RE = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?(.*)$/
const CD_RE = /^cd\s+(\S+)$/
const MKTEMP_CALL_RE = /\$\(\s*(mktemp\b[^()]*?)\s*\)|`\s*(mktemp\b[^`]*?)\s*`/g
const MKTEMP_PLACEHOLDER = '/tmp/mktemp-d'

type TempContext = { resolved: Record<string, string> }
const TEMP_NONE: TempContext = { resolved: {} }

const lines = (text: string) => text.split(/\r\n|\r|\n/)
const stripQuotes = (text: string) => text.replace(/^['"]+|['"]+$/g, '')

// `mktemp -d` left on its default directory; a template or -p puts the folder somewhere else.
function mktempCreatesTempDir(call: string) {
  const args = call.split(/\s+/).filter(Boolean).slice(1)
  const hasDirFlag = args.some(arg => /^(?:-[a-zA-Z]*d[a-zA-Z]*|--directory)$/.test(arg))
  const overridesDir = args.some(arg => arg.startsWith('-p') || arg.startsWith('--tmpdir'))
  const hasTemplate = args.some(arg => !arg.startsWith('-'))
  return hasDirFlag && !overridesDir && !hasTemplate
}

const expandMktemp = (text: string) =>
  text.replace(MKTEMP_CALL_RE, (whole, quoted: string | undefined, ticked: string | undefined) => (mktempCreatesTempDir(quoted ?? ticked ?? '') ? MKTEMP_PLACEHOLDER : whole))

// ".." is never safe, even under /tmp/: "/tmp/x/../../etc" starts with "/tmp/" and escapes it.
export function isSafeTempPath(path: string) {
  if (path.includes('..')) return false
  if (TEMP_SAFE_PREFIXES.some(prefix => path.startsWith(prefix)) || WINDOWS_TEMP_VARS.some(prefix => path.startsWith(prefix))) return true
  return WINDOWS_TEMP_RE.test(path.replace(/\\/g, '/'))
}

function expandTempVar(arg: string, resolved: Record<string, string>) {
  const match = VAR_REF_RE.exec(arg)
  if (match && match[1]! in resolved) return resolved[match[1]!] + match[2]!
  return arg
}

// VAR=value lines whose value is already a temp-safe path, cygpath respelling included.
function resolveTempVars(text: string) {
  const resolved: Record<string, string> = {}
  for (const line of lines(text)) {
    const match = VAR_ASSIGN_RE.exec(line.trim())
    if (!match) continue
    let value = stripQuotes(match[2]!.trim())
    const cygpath = CYGPATH_RE.exec(value)
    if (cygpath) value = expandTempVar(stripQuotes((cygpath[1] ?? cygpath[2])!), resolved)
    if (isSafeTempPath(value)) resolved[match[1]!] = value
  }
  return resolved
}

// Peels one balanced quote pair, so an rm quoted as a loop item still parses as rm.
function unquote(text: string) {
  const bare = text.trim().replace(/\\+$/, '').trim()
  for (const quote of ["'", '"']) {
    if (bare.length > 1 && bare.startsWith(quote) && bare.endsWith(quote)) return bare.slice(1, -1).trim()
  }
  return bare
}

function resolveDeleteArg(arg: string, resolved: Record<string, string>, cwd: string | null) {
  const expanded = expandTempVar(unquote(arg).replace(/"/g, '').replace(/'/g, ''), resolved)
  if (cwd && !/^[/$~]/.test(expanded)) return `${cwd.replace(/\/+$/, '')}/${expanded}`
  return expanded
}

// `2>/dev/null`, `>&2` and `&>log` send output somewhere; they are not paths the command deletes.
const isRedirection = (token: string) => /^(?:\d*[<>]|&>)/.test(token)

function deleteTargets(all: string[]) {
  const tokens = all.filter(token => !isRedirection(token))
  if (!tokens.length) return []
  if (tokens[0] === 'rm') return tokens.slice(1).filter(token => !token.startsWith('-'))
  if (tokens[0] === 'find' && tokens.includes('-delete')) {
    const paths: string[] = []
    for (const token of tokens.slice(1)) {
      if (token.startsWith('-')) break
      paths.push(token)
    }
    return paths
  }
  return []
}

function isTempSafeDeleteLine(line: string, resolved: Record<string, string>, cwd: string | null) {
  const targets = deleteTargets(line.split(/\s+/).filter(Boolean))
  return targets.length > 0 && targets.every(target => isSafeTempPath(resolveDeleteArg(target, resolved, cwd)))
}

// Drops deletions that only touch temp paths; a cd outside temp clears the context, so `cd ~/repo && rm -rf src` still asks.
export function stripTempSafeDeletes(text: string) {
  const expanded = expandMktemp(text)
  const resolved = resolveTempVars(expanded)
  const kept: string[] = []
  let cwd: string | null = null
  for (const raw of lines(expanded)) {
    const line = unquote(raw)
    const cd = CD_RE.exec(line)
    if (cd) {
      const target = expandTempVar(unquote(cd[1]!), resolved)
      cwd = isSafeTempPath(target) ? target : null
    }
    if (isTempSafeDeleteLine(line, resolved, cwd)) continue
    kept.push(raw)
  }
  return kept.join('\n')
}

// ---- Built-in CHECKS, in order so the sharper reason wins ----

// cmd: the command word a check applies to; unmasked: it reads quoted operands, which are its targets.
type Check = { label: string; pattern: RegExp; reason: string; source: 'normalized' | 'raw' | 'temp'; kinds: RiskKind[]; kind?: RiskKind; cmd?: RegExp; viaXargs?: boolean; unmasked?: boolean; critical?: boolean }

// Directories that should never be recursively deleted, grouped as the hook groups them.
const CRITICAL_DIR_NAMES = [
  String.raw`\.git`, String.raw`\.github`, String.raw`\.claude`, String.raw`\.vscode`,
  'src', 'helpers', 'resources', 'tests', 'scripts', 'fixtures',
]
const CRITICAL_DIRS = CRITICAL_DIR_NAMES.join('|')

// Top-level system folders whose wipe is critical; anything deeper is an ordinary recursive delete.
const SYSTEM_DIRS = 'bin|boot|dev|etc|lib64|lib|opt|proc|root|sbin|srv|sys|usr|var|home|Users|System|Library|Applications'

export const CHECKS: Check[] = [
  {
    label: 'rm',
    cmd: /^rm$/,
    unmasked: true,
    // ~, $HOME, "/", a top-level system folder and a drive root count only as the whole folder (or its contents), never as the start of a deeper path.
    pattern: new RegExp(String.raw`\brm\s+.*(-[a-zA-Z]*[rf][a-zA-Z]*\s+|(-[a-zA-Z]*\s+)*)(~[\w.-]*\/*(?:\.?\*)?(?=[\s"';&|)]|$)|\$\{?HOME\}?\/*(?:\.?\*)?(?=[\s"';&|)]|$)|\.\.|\s+["']?(?:\/(?:${SYSTEM_DIRS}|[a-zA-Z](?:\/(?:Users|Windows|Program Files))?)?|[a-zA-Z]:[\\/]+(?:(?:Users|Windows|Program Files)[\\/]*)?)\/*\*?["']?(?=[\s;&|)]|$))`),
    reason: words.reasons.rootDelete,
    critical: true,
    source: 'temp',
    kinds: ['rm'],
  },
  {
    label: 'rm -r',
    cmd: /^rm$/,
    unmasked: true,
    pattern: new RegExp(String.raw`\brm\s+.*(-r|-R|--recursive).*\s+(${CRITICAL_DIRS})(/|$|\s)`),
    reason: words.reasons.criticalDelete,
    critical: true,
    source: 'temp',
    kinds: ['rm'],
  },
  {
    label: 'rm -r',
    cmd: /^rm$/,
    unmasked: true,
    pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*|--recursive)\b/,
    reason: words.reasons.recursiveDelete,
    source: 'temp',
    kinds: ['rm'],
  },
  {
    // Last of the rm checks on purpose, so the recursive ones report the sharper reason.
    label: 'rm',
    cmd: /^rm$/,
    unmasked: true,
    pattern: /\brm\s+(-[a-zA-Z]*\s+)*[^-]/,
    reason: words.reasons.fileDelete,
    source: 'temp',
    kinds: ['rm'],
  },
  {
    // Unity Catalog widens the destructive DDL surface to SCHEMA, CATALOG and VOLUME; VACUUM drops Delta history.
    label: 'sql',
    pattern: /\bDROP\s+(TABLE|DATABASE|SCHEMA|CATALOG|VIEW|FUNCTION|VOLUME)\b|\bTRUNCATE\s+(TABLE\s+)?\S|\bDELETE\s+FROM\s+\S+\s*;?\s*$|\bALTER\s+TABLE\s+\S+\s+DROP\s+(COLUMN|CONSTRAINT|FEATURE)\b|\bALTER\s+(TABLE|SCHEMA)\s+\S+\s+RENAME\b|\bVACUUM\s+\S/i,
    reason: words.reasons.sql,
    source: 'normalized',
    kinds: ['sql'],
    kind: 'sql',
  },
  {
    // \s(--force|-f) catches both "git push --force" and "git push origin -f".
    label: 'git push --force',
    cmd: /^git$/,
    pattern: /\bgit\s+push\b.*\s(--force|-f)(\s|$)|\bgit\s+push\b.*--force-with-lease\b|\bgit\s+reset\s+--hard\b/,
    reason: words.reasons.gitForce,
    source: 'normalized',
    kinds: ['git-push-force', 'git-reset'],
  },
  {
    label: 'git destructive',
    cmd: /^git$/,
    pattern: /\bgit\s+(clean\s+-[a-zA-Z]*[fd]|checkout\s+\.|restore\s+\.|branch\s+-D)\b/,
    reason: words.reasons.gitDestructive,
    source: 'normalized',
    kinds: ['git-clean', 'git-checkout', 'git-branch-delete'],
  },
  {
    label: 'git stash',
    cmd: /^git$/,
    pattern: /\bgit\s+stash\s+(drop|clear)\b/,
    reason: words.reasons.gitStash,
    source: 'normalized',
    kinds: [],
  },
  {
    label: 'git push --delete',
    cmd: /^git$/,
    pattern: /\bgit\s+push\b.*--delete\b/,
    reason: words.reasons.gitPushDelete,
    source: 'normalized',
    kinds: [],
  },
  {
    label: 'make deploy',
    cmd: /^make$/,
    pattern: /\bmake\s+(bundle-deploy|app-deploy|deploy)\b.*(TARGET|ENV)=(prod|production)\b/i,
    reason: words.reasons.makeDeploy,
    source: 'normalized',
    kinds: [],
  },
  {
    label: 'databricks bundle destroy',
    cmd: /^databricks$/,
    pattern: /\bdatabricks\s+bundle\s+destroy\b/,
    reason: words.reasons.bundleDestroy,
    source: 'normalized',
    kinds: [],
  },
  {
    label: 'deploy to prod',
    cmd: /deploy|^gcloud$/,
    pattern: /\bdeploy.*--env[= ](prod|production)\b|\bgcloud.*--project[= ][\w-]*-prod\b/i,
    reason: words.reasons.deployProd,
    source: 'normalized',
    kinds: [],
  },
  {
    label: 'gcloud delete',
    cmd: /^(gcloud|gsutil)$/,
    pattern: /\bgsutil\s+(rm|del|delete).*-r\b|\bgcloud\s+(dataproc|composer|sql).*delete\b|\bgcloud\s+projects\s+delete\b/i,
    reason: words.reasons.gcloudDelete,
    source: 'normalized',
    kinds: [],
  },
  {
    label: 'az delete',
    cmd: /^az$/,
    pattern: /\baz\s+group\s+delete\b|\baz\s+storage\s+(blob|container)\s+(delete|delete-batch)\b|\baz\s+databricks\s+workspace\s+delete\b|\baz\s+keyvault\s+(delete|purge)\b/i,
    reason: words.reasons.azDelete,
    source: 'normalized',
    kinds: [],
  },
  {
    label: 'databricks delete',
    cmd: /^databricks$/,
    pattern: /\bdatabricks\s+secrets\s+delete-scope\b|\bdatabricks\s+workspace\s+delete\b/,
    reason: words.reasons.databricksDelete,
    source: 'normalized',
    kinds: [],
  },
  {
    label: 'chmod',
    cmd: /^(chmod|chown)$/,
    pattern: /\b(chmod|chown)\s+.*-R\b|\bchmod\s+.*777\b/,
    reason: words.reasons.chmodUnsafe,
    source: 'normalized',
    kinds: ['chmod'],
  },
  {
    label: 'curl | sh',
    cmd: /^(curl|wget|fetch)$/,
    pattern: /\b(curl|wget|fetch)\b.*\|\s*(bash|sh|zsh|python|perl|ruby)\b/,
    reason: words.reasons.curlSh,
    source: 'raw',
    kinds: [],
  },
  {
    label: 'secret read',
    cmd: /^(cat|less|head|tail|more|source|grep|sed|awk|bat|echo)$/,
    pattern: /\b(cat|less|head|tail|more|source|grep|sed|awk|bat)\s+(\.env\b|\.databrickscfg\b|\.mcp\.json\b)|\becho.*\$\(.*\.env/,
    reason: words.reasons.secretRead,
    source: 'normalized',
    kinds: [],
  },
  {
    label: 'credential read',
    cmd: /^(cat|less|head|tail|more|bat)$/,
    pattern: /\b(cat|less|head|tail|more|bat)\b.+(\.databricks\/\.databricks\.env|\.aws\/(credentials|config)|\.ssh\/(config|known_hosts|authorized_keys)|id_rsa|id_ed25519)/,
    reason: words.reasons.credentialRead,
    source: 'raw',
    kinds: [],
  },
  {
    label: 'mv /dev/null',
    cmd: /^mv$/,
    pattern: /\bmv\s+.*\s+\/dev\/null\b/,
    reason: words.reasons.mvDevNull,
    source: 'normalized',
    kinds: [],
  },
  {
    label: 'find -delete',
    cmd: /^find$/,
    pattern: /\bfind\s+.*-delete\b/,
    reason: words.reasons.findDelete,
    source: 'temp',
    kinds: ['find-delete'],
  },
  {
    // Temp paths still ask here: what xargs feeds rm is not knowable from the command text.
    label: 'xargs rm',
    cmd: /^rm$/,
    viaXargs: true,
    pattern: /\bxargs\s+.*\brm\b/,
    reason: words.reasons.xargsRm,
    source: 'normalized',
    kinds: ['rm'],
  },
]

// Last check: a code file the command truncates with a single >.
const CODE_REDIRECT = /(?<!>)>(?!>)\s*([^>&|\s]+\.(py|js|ts|jsx|tsx|json|yaml|yml|toml|md|sh|sql))(?=\s|$)/

// ---- Structural reading of the command, for the preview and for what the checks lack ----

function structural(command: string, temp: TempContext, startDir: string | null, depth = 0): Risk | null {
  let dir = startDir
  let tempCwd: string | null = null
  const scopes: { dir: string | null; tempCwd: string | null }[] = []
  const pushed: (string | null)[] = []

  for (const { words, redirects } of split(command)) {
    if (words.length === 1 && words[0] === '(' && !redirects.length) {
      scopes.push({ dir, tempCwd })
      continue
    }
    if (words.length === 1 && words[0] === ')' && !redirects.length) {
      const scope = scopes.pop()
      if (scope) ({ dir, tempCwd } = scope)
      continue
    }
    const found = classifySegment(words, dir, pushed, depth)
    if (found && 'cd' in found) {
      dir = found.cd
      if (found.raw === undefined) tempCwd = null
      else {
        const target = expandTempVar(unquote(found.raw), temp.resolved)
        tempCwd = isSafeTempPath(target) ? target : null
      }
      continue
    }
    if (found) {
      const isTemp = found.isPreviewOnly && found.targets.length > 0 && found.targets.every(target => isSafeTempPath(resolveDeleteArg(target, temp.resolved, tempCwd)))
      if (isTemp) continue
      return found
    }
  }
  return null
}

const RULE: Omit<Risk, 'label' | 'reason'> = { kind: 'rule', targets: [], args: [], dir: null }

// ---- Steps: a rule applies to the command a step runs, not to words that merely appear in it ----

const SQL_CLIENTS = new Set(['psql', 'mysql', 'mariadb', 'sqlite3', 'sqlcmd', 'usql', 'pgcli', 'mycli', 'sqlplus', 'duckdb', 'clickhouse-client', 'mongosh', 'cockroach', 'databricks', 'bq', 'spark-sql'])
const XARGS_VALUE_FLAGS = new Set(['-I', '-n', '-P', '-L', '-d', '-E', '-s', '-a', '-i'])

export type Step = { line: string; words: string[]; cmd: string; args: string[]; viaXargs: boolean }

// The command a step runs: its first word once assignments and wrappers (sudo, env, nice, time, command, xargs) are skipped.
export function commandOf(words: string[]) {
  const list = [...words]
  let viaXargs = false
  for (;;) {
    const word = list[0]
    if (word === undefined) break
    if (ASSIGNMENT.test(word) || PREFIXES.has(word)) {
      list.shift()
      if (word === 'env') while (list.length && isFlag(list[0]!)) list.shift()
    } else if (word === 'sudo') {
      list.shift()
      while (list.length && isFlag(list[0]!)) if (SUDO_VALUE_OPTIONS.has(list.shift()!)) list.shift()
    } else if (word === 'nice') {
      list.shift()
      if (list[0] === '-n') list.splice(0, 2)
      else if (/^-\d+$/.test(list[0] ?? '')) list.shift()
    } else if (word === 'xargs') {
      viaXargs = true
      list.shift()
      while (list.length && isFlag(list[0]!)) if (XARGS_VALUE_FLAGS.has(list.shift()!)) list.shift()
    } else break
  }
  const first = list.shift()
  return { cmd: baseName(first ?? '').toLowerCase(), args: list, viaXargs }
}

// Quoted text becomes a placeholder, so words inside a string are not read as commands.
export function maskQuoted(text: string) {
  let out = ''
  let quote = ''
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (quote) {
      if (quote === '"' && c === '\\') i++
      else if (c === quote) {
        out += c
        quote = ''
      } else if (!out.endsWith('…')) out += '…'
    } else if (c === "'" || c === '"') {
      quote = c
      out += c
    } else if (c === '\\') out += c + (text[++i] ?? '')
    else out += c
  }
  return out
}

// One step per line: the shell's operators split outside quotes, and a substitution inside double quotes is its own step.
export function normalizeSteps(command: string, splitSubs = true) {
  let out = ''
  let quote = ''
  const subs: { close: string; depth: number }[] = []
  const brk = () => {
    if (!out.endsWith('\n')) out += '\n'
  }
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!
    if (quote === "'") {
      out += c
      if (c === "'") quote = ''
    } else if (quote === '"') {
      if (c === '\\' && i + 1 < command.length) out += c + command[++i]
      else if (c === '"') {
        out += c
        quote = ''
      } else if (splitSubs && ((c === '$' && command[i + 1] === '(') || c === '`')) {
        out += '"'
        brk()
        subs.push({ close: c === '`' ? '`' : ')', depth: 0 })
        quote = ''
        if (c === '$') i++
      } else out += c
    } else if (c === "'" || c === '"') {
      quote = c
      out += c
    } else if (c === '\\' && i + 1 < command.length) out += c + command[++i]
    else if (subs.length && c === subs[subs.length - 1]!.close && (c === '`' || subs[subs.length - 1]!.depth === 0)) {
      subs.pop()
      brk()
      out += '"'
      quote = '"'
    } else if (splitSubs && c === '(') {
      if (subs.length) subs[subs.length - 1]!.depth++
      brk()
    } else if (splitSubs && c === ')') {
      if (subs.length) subs[subs.length - 1]!.depth--
      brk()
    } else if (c === '&' && (command[i + 1] === '>' || command[i - 1] === '>')) out += c
    else if (c === ';' || c === '&' || c === '|' || c === '\n' || (splitSubs && c === '`')) brk()
    else out += c
  }
  return out
}

function stepsOf(text: string): Step[] {
  return text
    .split(/\r\n|\r|\n/)
    .map(line => {
      const words = split(line).find(segment => segment.words.length && segment.words[0] !== '(' && segment.words[0] !== ')')?.words ?? []
      return { line, words, ...commandOf(words) }
    })
    .filter(step => step.cmd)
}

const SHELLS_WITH_C = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh'])

// The program text a step hands to a shell, which runs it: `bash -c "..."`, `eval "..."`, `powershell -Command "..."`.
function innerOf(step: Step) {
  if (SHELLS_WITH_C.has(step.cmd)) {
    const at = step.args.findIndex(arg => /^-[a-z]*c[a-z]*$/.test(arg))
    return at >= 0 ? step.args[at + 1] : undefined
  }
  if (step.cmd === 'eval') return step.args.join(' ')
  if (step.cmd === 'powershell' || step.cmd === 'pwsh') {
    const at = step.args.findIndex(arg => /^-(?:command|c)$/i.test(arg))
    return at >= 0 ? step.args.slice(at + 1).join(' ') : undefined
  }
  return undefined
}

// A path that is a whole place: the root, home, a drive, or anything that climbs to a parent.
const WHOLE_PLACE = /^(?:\/\*?|~\/?\*?|\$\{?HOME\}?\/?\*?|[A-Za-z]:[\\/]?\*?|\/[A-Za-z]\/?\*?)$/

const isCriticalStep = (step: Step) =>
  CHECKS.some(check => check.critical && (!check.cmd || check.cmd.test(step.cmd)) && check.pattern.test(step.line)) ||
  operands(step.args).some(path => WHOLE_PLACE.test(path) || path.includes('..'))

function passes(rule: UserRule, text: string) {
  try {
    rule.re.lastIndex = 0
    return rule.re.test(text)
  } catch {
    return false
  }
}

// The command without the steps a pass rule matches, or null when none matches. A step a critical check marks, one that hands text to a shell, and one with a substitution always stay.
function withoutPassed(command: string, rules: UserRule[]) {
  const passRules = rules.filter(rule => rule.action === 'pass')
  if (!passRules.length) return null
  const kept: string[] = []
  let dropped = false
  for (const line of normalizeSteps(command, false).split(/\r\n|\r|\n/)) {
    const step = stepsOf(line)[0]
    const isPassed = step && !innerOf(step) && !/\$\(|`/.test(step.line) && !isCriticalStep(step) && passRules.some(rule => passes(rule, step.line.trim()))
    if (isPassed) dropped = true
    else kept.push(line)
  }
  return dropped ? kept.join('\n') : null
}

// The first risky thing in a command line, or null: the built-in checks, then what shells run, then this mod's extras, then the person's rules.
export function classify(original: string, rules: UserRule[] = [], depth = 0): Risk | null {
  const command = stripHeredocs(original)
  const rest = withoutPassed(command, rules)
  if (rest !== null) return classify(rest, rules.filter(rule => rule.action !== 'pass'), depth)
  // Temp logic reads whole lines, so `$(mktemp -d)` stays in one piece; the checks read the steps with substitutions split out.
  const lineText = normalizeSteps(command, false)
  const normalized = normalizeSteps(command)
  const temp: TempContext = { resolved: resolveTempVars(expandMktemp(lineText)) }
  const found = structural(expandMktemp(command), temp, null)
  const steps = stepsOf(normalized)
  const tempSteps = stepsOf(normalizeSteps(stripTempSafeDeletes(lineText)))
  const hasClient = steps.some(step => SQL_CLIENTS.has(step.cmd))

  const applies = (check: Check, step: Step) => (!check.cmd || check.cmd.test(step.cmd)) && (!check.viaXargs || step.viaXargs)
  const isHit = (check: Check) => {
    if (check.kind === 'sql') return hasClient && check.pattern.test(normalized)
    if (check.source === 'raw') return steps.some(step => applies(check, step)) && check.pattern.test(maskQuoted(command))
    return (check.source === 'temp' ? tempSteps : steps).some(step => applies(check, step) && check.pattern.test(check.unmasked ? step.line : maskQuoted(step.line)))
  }

  const hit = CHECKS.find(isHit)
  if (hit) {
    if (found && hit.kinds.includes(found.kind)) return { ...found, reason: hit.reason, isPreviewOnly: undefined, source: 'hook' }
    if (hit.kind === 'sql') {
      const statements = [...command.matchAll(/\b(?:DROP|TRUNCATE|DELETE\s+FROM|ALTER|VACUUM)\b[^;\n"']*/gi)].map(match => match[0].trim())
      return { ...RULE, kind: 'sql', label: hit.label, reason: hit.reason, statements, source: 'hook' }
    }
    return { ...RULE, label: hit.label, reason: hit.reason, source: 'hook' }
  }

  if (depth < 3) {
    for (const step of steps) {
      const inner = innerOf(step)
      const risk = inner ? classify(inner, rules, depth + 1) : null
      if (risk) return risk
    }
  }

  const code = CODE_REDIRECT.exec(maskQuoted(command))
  // A target built from a shell variable or a glob is never held: it is not a file a check could name.
  if (code && !/[$`*?]/.test(code[1]!)) return { kind: 'redirect', label: 'redirect >', reason: REASON.redirect, targets: [code[1]!], args: [code[1]!], dir: found?.dir ?? null, source: 'hook' }

  if (found && !found.isPreviewOnly) return found

  for (const rule of rules.filter(rule => rule.action !== 'pass')) {
    try {
      rule.re.lastIndex = 0
      if (rule.re.test(command)) return { ...RULE, label: words.labels.yourRule, reason: rule.reason, pattern: rule.re.source, source: 'rules' }
    } catch {
      // A user rule that fails to run is skipped; the built-in checks still hold the command.
    }
  }
  return null
}

// A matcher that throws holds the command anyway: an error never lets one through.
export function evaluate(value: unknown, rules: UserRule[] = []): { risk: Risk | null; command: string } {
  let command = '(unreadable command)'
  try {
    command = typeof value === 'string' ? value : String(value ?? '')
    return { risk: classify(command, rules), command }
  } catch (error) {
    const why = String((error as Error)?.message ?? error).slice(0, 80)
    return { risk: { kind: 'rule', label: words.labels.couldNotEvaluate, reason: fill(words.reasons.evaluateError, { why }), targets: [], args: [], dir: null, isError: true, source: 'error' }, command }
  }
}

// A longer pattern is skipped: it runs on every Bash call, and a huge one can stall the hook.
const MAX_PATTERN = 500

// rules.json: an array of { pattern, reason, flags?, action? }, where action is "pass" or the default "hold". A bad entry is skipped with a note; the built-in checks never depend on it.
export function compileRules(text: string): { rules: UserRule[]; notes: string[] } {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (error) {
    return { rules: [], notes: [fill(words.rulesNotes.notJson, { why: String((error as Error).message).slice(0, 60) })] }
  }
  if (!Array.isArray(data)) return { rules: [], notes: [words.rulesNotes.notArray] }
  const rules: UserRule[] = []
  const notes: string[] = []
  data.forEach((entry, index) => {
    const item = entry as { pattern?: unknown; reason?: unknown; flags?: unknown; action?: unknown } | null
    if (!item || typeof item.pattern !== 'string' || typeof item.reason !== 'string' || (item.flags !== undefined && typeof item.flags !== 'string') || (item.action !== undefined && typeof item.action !== 'string')) {
      notes.push(fill(words.rulesNotes.needsFields, { n: index + 1 }))
      return
    }
    if (item.pattern.length > MAX_PATTERN) {
      notes.push(fill(words.rulesNotes.skipped, { n: index + 1, why: fill(words.rulesNotes.tooLong, { max: MAX_PATTERN }) }))
      return
    }
    try {
      rules.push({ re: new RegExp(item.pattern, (item.flags ?? '').replace(/[gy]/g, '')), reason: item.reason, ...(item.action === 'pass' ? { action: 'pass' as const } : {}) })
    } catch (error) {
      notes.push(fill(words.rulesNotes.skipped, { n: index + 1, why: String((error as Error).message).slice(0, 60) }))
    }
  })
  return { rules, notes }
}

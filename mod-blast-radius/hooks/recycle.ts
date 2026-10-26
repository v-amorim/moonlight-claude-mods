// mod-blast-radius / hooks/recycle.ts, by v-amorim: which rm steps may go to the OS bin instead, and the rewrite that sends them
import { basename, dirname, isAbsolute, isInside, isSame, native, normalize } from './paths'
import { classify, CRITICAL_DIRS, HEREDOC_MARK, stripTempSafeDeletes, type Session, type UserRule } from './risk'

const CD = /^cd\s+(\S+)$/
const UNTRACKED_DIR_CHANGE = /\b(cd|pushd|popd)\b/
const RM_AT_COMMAND = /(^|[;&|\n]\s*)rm(?=\s)/g
const GLOB_CHARS = ['*', '?', '[']
// Characters that mean the token is shell syntax rather than a plain path, so its target is unknowable.
const SHELL_SYNTAX = ['$', '`', '(', ')', '{', '}', '<', '>', '~']
const HOME_REF = /^(?:~|\$HOME|\$\{HOME\})(?=\/|$)/
const CRITICAL_NAME = new RegExp(`^(?:${CRITICAL_DIRS})$`, 'i')

// outside: settles a delete target beyond the session folder; the plain rule never takes one.
type Where = { cwd: string | null; root: string; home: string; isWindows: boolean; outside?: (path: string) => boolean }

// Peels one balanced quote pair, so an rm quoted as a loop item still parses as rm.
function unquote(text: string) {
  const bare = text.trim().replace(/\\+$/, '').trim()
  for (const quote of ["'", '"']) {
    if (bare.length > 1 && bare.startsWith(quote) && bare.endsWith(quote)) return bare.slice(1, -1).trim()
  }
  return bare
}

// The folder whose contents may go to the bin; null when that would cover home, a whole drive, or nothing is known.
export function sessionRoot(session: Session, isWindows: boolean) {
  if (!session.cwd) return null
  const root = native(session.cwd, isWindows)
  if (!isAbsolute(root, isWindows) || dirname(root) === root || isSame(root, native(session.home, isWindows), isWindows)) return null
  return root
}

// A spelled path as an absolute one: `~` and $HOME read as home, a relative path as under the folder in force; null when it is not knowable.
function resolve(spelled: string, where: Where) {
  const home = HOME_REF.exec(spelled)
  const rest = home ? spelled.slice(home[0].length) : spelled
  if (!spelled || SHELL_SYNTAX.some(char => rest.includes(char))) return null
  if (home && !where.home) return null
  const path = native(home ? `${where.home}${rest}` : spelled, where.isWindows)
  if (isAbsolute(path, where.isWindows)) return path
  // A rooted path with no drive is Git Bash's own tree, which this check cannot place.
  if (path.startsWith('/') || where.cwd === null) return null
  return normalize(`${where.cwd}/${path}`, where.isWindows)
}

function isRecyclableTarget(arg: string, where: Where, isRecursive: boolean) {
  const bare = unquote(arg).replace(/["']/g, '')
  const path = bare ? resolve(bare, where) : null
  if (path === null) return false
  if (GLOB_CHARS.some(char => bare.includes(char))) {
    // `rm -rf *` in the session folder sweeps all of it; a plain `rm *.log` there only takes files.
    const folder = dirname(path)
    return isInside(folder, where.root, where.isWindows) || (isSame(folder, where.root, where.isWindows) && !isRecursive)
  }
  if (isRecursive && CRITICAL_NAME.test(basename(path))) return false
  return isInside(path, where.root, where.isWindows) || (where.outside?.(path) ?? false)
}

function isRecyclableRmLine(line: string, where: Where) {
  const [first, ...args] = line.split(/\s+/).filter(Boolean)
  if (first !== 'rm') return false
  const isRecursive = args.some(arg => /^(?:-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)$/.test(arg))
  const targets = args.filter(arg => !arg.startsWith('-'))
  return targets.length > 0 && targets.every(target => isRecyclableTarget(target, where, isRecursive))
}

// The text without the rm lines that can go to the bin, and whether any line was taken out.
export function splitRecyclable(text: string, session: Session, isWindows: boolean, outside?: (path: string) => boolean) {
  const root = sessionRoot(session, isWindows)
  if (root === null) return { kept: text, found: false }
  const where: Where = { cwd: root, root, home: session.home, isWindows, outside }
  const kept: string[] = []
  let found = false
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = unquote(raw)
    const cd = CD.exec(line)
    // `cd -` goes to a folder this check never saw.
    if (cd) where.cwd = where.cwd === null || cd[1] === '-' ? null : resolve(unquote(cd[1]!), where)
    // A subshell `(cd x` or a pushd moves the folder in a way the plain cd tracking cannot follow.
    else if (UNTRACKED_DIR_CHANGE.test(line)) where.cwd = null
    if (isRecyclableRmLine(line, where)) found = true
    else kept.push(raw)
  }
  return { kept: kept.join('\n'), found }
}

function isInQuotes(command: string, at: number) {
  let [single, double] = [false, false]
  for (let i = 0; i < at; i++) {
    const char = command[i]
    if (char === "'" && !double) single = !single
    else if (char === '"' && !single && (i === 0 || command[i - 1] !== '\\')) double = !double
  }
  return single || double
}

// Every rm in command position swapped for the helper; null when one sits inside quotes.
function swapRm(command: string, helper: string) {
  const matches = [...command.matchAll(RM_AT_COMMAND)]
  if (matches.length === 0 || matches.some(match => isInQuotes(command, (match.index ?? 0) + match[1]!.length))) return null
  return command.replace(RM_AT_COMMAND, (_all, lead: string) => `${lead}${helper}`)
}

export const helperCall = (script: string) => `sh '${script.replace(/'/g, "'\\''")}'`

const holds = (rule: UserRule, command: string) => {
  try {
    rule.re.lastIndex = 0
    return rule.re.test(command)
  } catch {
    return false
  }
}

export type Recycling = { session: Session; isWindows: boolean; rules: UserRule[]; outside?: (path: string) => boolean }

const isHeld = (command: string, rules: UserRule[]) => new RegExp(HEREDOC_MARK.source).test(command) || rules.some(rule => rule.action !== 'pass' && holds(rule, command))

// The command with its rm steps sent to the bin, or null when it must be judged as typed. The rm steps must sit inside the session folder, or be targets `outside` approves; every other step of the command must pass the checks on its own.
export function planRecycle(command: string, { session, isWindows, rules, outside }: Recycling): ((script: string) => string) | null {
  // A hold rule of the person's own names the whole command, so the bin does not settle it.
  if (isHeld(command, rules)) return null
  const { kept, found } = splitRecyclable(stripTempSafeDeletes(command.replace(/[;&|]+/g, '\n')), session, isWindows, outside)
  if (!found || swapRm(command, 'x') === null) return null
  if (classify(kept, rules, 0, session) !== null) return null
  return script => swapRm(command, helperCall(script))!
}

// The absolute rm targets beyond the session folder that planRecycle would ask `outside` about, each once.
export function outsideTargets(command: string, { session, isWindows, rules }: Recycling): string[] {
  if (isHeld(command, rules)) return []
  const asked = new Set<string>()
  splitRecyclable(stripTempSafeDeletes(command.replace(/[;&|]+/g, '\n')), session, isWindows, path => !!asked.add(path))
  return [...asked]
}

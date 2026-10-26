// mod-blast-radius / hooks/explain.ts, by v-amorim
// Plain-words copy for the card and the details pane, and the fitting rules that keep the card inside the band. Pure: no engine calls.
import { formatSize, type Report } from './preview'
import { classify, heredocs, type Risk, type UserRule } from './risk'
import text from './text'
import { fill, MARK } from './theme'

type Unit = { one: string; many: string }
const plural = (count: number, unit: Unit) => fill(count === 1 ? unit.one : unit.many, { n: count })

const NO_UNDO_RM = text.noUndoRm
const NO_UNDO_GIT_LOSS = text.noUndoGitLoss

export type Plain = {
  // What happens, verb first: the heading and the Run label share its wording.
  verb: string
  // The folder or file the heading names, shortened first when the card is tight.
  subject?: string
  run: string
  does: string
  undo: string
  // Haiku's words for what the command touches, shown when the preview measured nothing.
  targets?: string
  verdict?: { isOk: boolean; why: string }
}

type Fallback = { verb: string; run: string; does: string; undo: string }

// Built-in checks with no preview: what they do, in words.
const BY_LABEL: Record<string, Fallback> = text.byLabel

const sentence = (line: string) => (/[.!?]$/.test(line) ? line : `${line}.`)

// "DROP TABLE users" becomes "Drop table users": keywords lower-cased, names kept as written.
function sqlVerb(statement: string) {
  const words = statement.split(/\s+/)
  const keyword = /^(?:DROP|TABLE|DATABASE|SCHEMA|CATALOG|VIEW|FUNCTION|VOLUME|TRUNCATE|DELETE|FROM|ALTER|DROP|COLUMN|CONSTRAINT|FEATURE|RENAME|VACUUM|IF|EXISTS)$/i
  let isLeading = true
  const out = words.map((word, index) => {
    if (isLeading && keyword.test(word)) return index === 0 ? word[0]!.toUpperCase() + word.slice(1).toLowerCase() : word.toLowerCase()
    isLeading = false
    return word
  })
  return out.join(' ')
}

export function plainFor(risk: Risk, report: Report | null): Plain {
  const facts = report?.facts
  const items = facts?.items ?? []
  const hasFolder = items.some(item => item.path.endsWith('/'))
  switch (risk.kind) {
    case 'rm': {
      if (!facts || facts.files === undefined) return { ...(BY_LABEL[risk.label.startsWith('rm -r') ? 'rm -r' : 'rm'] ?? BY_LABEL.rm!) }
      const isOneFile = facts.files === 1 && items.length === 1 && !hasFolder
      const what = isOneFile ? facts.subject! : plural(facts.files, text.units.file)
      return {
        verb: fill(text.plain.deleteWhat, { what }),
        subject: isOneFile ? undefined : facts.subject,
        run: fill(text.plain.deleteWhat, { what }),
        does: hasFolder ? text.plain.removeFolder : isOneFile ? text.plain.removeFile : fill(text.plain.removeFiles, { files: plural(facts.files, text.units.file) }),
        undo: NO_UNDO_RM,
      }
    }
    case 'mv': {
      const what = facts?.subject ?? text.plain.theDestination
      return { verb: fill(text.plain.replaceWhat, { what }), run: fill(text.plain.replaceWhat, { what }), does: text.plain.mvDoes, undo: text.plain.mvUndo }
    }
    case 'redirect': {
      const what = facts?.subject ?? risk.targets[0] ?? text.plain.theFile
      return { verb: fill(text.plain.overwriteWhat, { what }), run: fill(text.plain.overwriteWhat, { what }), does: text.plain.redirectDoes, undo: text.plain.redirectUndo }
    }
    case 'chmod':
      return { verb: fill(text.plain.chmodVerb, { files: plural(facts?.count ?? 0, text.units.file) }), subject: facts?.subject, run: text.plain.chmodRun, does: text.plain.chmodDoes, undo: text.plain.chmodUndo }
    case 'find-delete':
      return { verb: text.plain.deleteMatching, subject: facts?.subject, run: text.plain.deleteMatching, does: text.plain.findDoes, undo: NO_UNDO_RM }
    case 'git-reset': {
      const lost = facts?.count ?? 0
      const dropped = facts?.files ?? 0
      const what = lost ? fill(text.plain.discardChanged, { files: plural(lost, text.units.changedFile) }) : dropped ? fill(text.plain.moveBack, { commits: plural(dropped, text.units.commit) }) : text.plain.resetToLast
      return { verb: what, run: what, does: fill(text.plain.resetDoes, { loss: NO_UNDO_GIT_LOSS }), undo: NO_UNDO_GIT_LOSS }
    }
    case 'git-clean': {
      const what = facts?.count !== undefined ? fill(text.plain.deleteUntracked, { files: plural(facts.count, text.units.untrackedFile) }) : text.plain.deleteUntrackedAny
      return { verb: what, run: what, does: text.plain.cleanDoes, undo: text.plain.cleanUndo }
    }
    case 'git-checkout': {
      const what = facts?.count !== undefined ? fill(text.plain.discardChanged, { files: plural(facts.count, text.units.changedFile) }) : text.plain.discardChangedAny
      return { verb: what, run: what, does: text.plain.checkoutDoes, undo: text.plain.checkoutUndo }
    }
    case 'git-push-force': {
      const where = facts?.subject ?? text.plain.theRemote
      const lost = facts?.count ? fill(text.plain.commitsLost, { commits: plural(facts.count, text.units.commit) }) : ''
      return {
        verb: fill(text.plain.forcePushTo, { where }),
        run: fill(text.plain.forcePushTo, { where }),
        does: fill(text.plain.pushDoes, { lost }),
        undo: text.plain.pushUndo,
      }
    }
    case 'git-branch-delete': {
      const what = facts?.subject ?? risk.targets.join(', ')
      return { verb: fill(text.plain.deleteBranch, { what }), run: fill(text.plain.deleteBranch, { what }), does: text.plain.branchDoes, undo: text.plain.branchUndo }
    }
    case 'sql': {
      const first = sqlVerb(risk.statements?.[0] ?? text.plain.runSql)
      const many = (risk.statements?.length ?? 0) > 1
      return { verb: many ? fill(text.plain.runManySql, { statements: plural(risk.statements!.length, text.units.destructiveStatement) }) : first, run: many ? text.plain.runSql : first, does: text.plain.sqlDoes, undo: text.plain.sqlUndo }
    }
    default: {
      if (risk.source === 'rules') return { verb: risk.reason, run: text.plain.runAnyway, does: sentence(fill(text.plain.matchesRule, { reason: risk.reason })), undo: text.plain.checkRule }
      if (risk.source === 'error') return { verb: text.plain.checkThis, run: text.plain.runAnyway, does: text.plain.errorDoes, undo: text.plain.unknown }
      const known = BY_LABEL[risk.label]
      if (known) return { ...known }
      return { verb: risk.reason, run: text.plain.runAnyway, does: sentence(risk.reason), undo: text.plain.unknown }
    }
  }
}

const WHY: Record<string, string> = {
  [text.reasons.rootDelete]: text.why.rootDelete,
  [text.reasons.criticalDelete]: text.why.criticalDelete,
  [text.reasons.recursiveDelete]: text.why.recursiveDelete,
  [text.reasons.fileDelete]: text.why.fileDelete,
  [text.reasons.gitForce]: text.why.gitForce,
}

const SOURCE: Record<NonNullable<Risk['source']> | 'blast', string> = text.source

export const whyOf = (risk: Risk) => ({ why: risk.source === 'error' ? risk.reason : sentence(WHY[risk.reason] ?? risk.reason), source: SOURCE[risk.source ?? 'blast'] })

// Splits the command into the pieces a person reads: each simple command, quotes kept, operators dropped.
export function pieces(command: string) {
  const out: string[] = []
  let word = ''
  let quote = ''
  const flush = () => {
    if (word.trim()) out.push(word.trim())
    word = ''
  }
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!
    if (quote) {
      word += c
      if (c === quote) quote = ''
    } else if (c === "'" || c === '"') {
      quote = c
      word += c
    } else if (c === '\\' && i + 1 < command.length) {
      word += c + command[++i]
    } else if (c === '&' && (command[i - 1] === '>' || command[i - 1] === '<' || command[i + 1] === '>')) {
      // The `&` of `2>&1` or `&>log` belongs to a redirection, not between two steps.
      word += c
    } else if (c === '\n' || c === ';' || c === '|' || c === '&') {
      flush()
      while ((c === '|' || c === '&') && command[i + 1] === c) i++
    } else word += c
  }
  flush()
  return out
}

export type Segment = { text: string; risk: Risk | null; says: string; isScript?: boolean }

const SCRIPT_RUNNERS = new Set(['node', 'python', 'python3', 'ruby', 'perl', 'deno', 'bun', 'php'])

// One step per top-level piece. A risky step gets a sentence, a heredoc one line about what reads it, and the rest are shown as written.
export function segmentsOf(command: string, rules: UserRule[] = []): Segment[] {
  const { code, found } = heredocs(command)
  let at = 0
  return pieces(code).map(piece => {
    const heredoc = /(?<!<)<<(?!<)/.test(piece) ? found[at++] : undefined
    if (heredoc && !heredoc.isCode) {
      const name = heredoc.receiver || text.steps.theCommand
      const says = SCRIPT_RUNNERS.has(heredoc.receiver) ? fill(text.steps.runsScript, { name, lines: heredoc.lines }) : fill(text.steps.readsText, { name, lines: plural(heredoc.lines, text.units.line) })
      return { text: piece, risk: null, says, isScript: true }
    }
    const bare = piece.replace(/^(?:do|then|else)\s+/, '')
    const risk = classify(bare, rules)
    if (!risk) return { text: piece, risk: null, says: '' }
    if (risk.kind === 'rm' && risk.targets.length) {
      const isRecursive = /^rm\s+-[a-zA-Z]*[rR]|--recursive|^rmdir/.test(bare) || risk.label.includes('-r')
      const what = risk.targets.join(', ')
      return { text: piece, risk, says: fill(isRecursive ? text.steps.deletesFolder : text.steps.deletes, { what }) }
    }
    const plain = plainFor(risk, null)
    return { text: piece, risk, says: fill(text.steps.says, { verb: plain.verb, does: plain.does }) }
  })
}

// The steps worth a row of their own, and one muted line for the harmless rest: "and 5 safe steps (cd, ls, grep…)".
export function stepsView(segments: Segment[]) {
  const shown = segments.filter(segment => segment.risk || segment.isScript)
  const safe = segments.filter(segment => !segment.risk && !segment.isScript)
  const names = [...new Set(safe.map(segment => segment.text.replace(/^(?:do|then|else)\s+/, '').split(/\s+/)[0]!).filter(Boolean))]
  const list = names.slice(0, 4).join(', ') + (names.length > 4 ? '…' : '')
  return { shown, rest: safe.length ? fill(text.steps.safeRest, { steps: plural(safe.length, text.units.safeStep), list }) : '' }
}

// The full command as rows no wider than the pane, at most maxRows of them; what is left over is counted.
export function capLines(command: string, width: number, maxRows: number) {
  const rows: string[] = []
  for (const line of command.split('\n')) {
    if (line.length <= width) rows.push(line)
    else for (let at = 0; at < line.length; at += width) rows.push(line.slice(at, at + width))
  }
  return { rows: rows.slice(0, maxRows), more: Math.max(0, rows.length - maxRows) }
}

// ---- Fitting the card inside the band ----

// Keeps the first folder and the last name: ~/blast-radius-demo/drafts/ becomes ~/blast-…/drafts/.
export function midCut(path: string, width: number) {
  if (path.length <= width) return path
  const isDir = path.endsWith('/')
  const parts = path.replace(/\/$/, '').split('/')
  const tail = `${parts.pop() ?? ''}${isDir ? '/' : ''}`
  if (!parts.length) return `${tail.slice(0, Math.max(1, width - 1))}…`
  const head = parts.slice(0, parts[0] === '~' || parts[0] === '' ? 2 : 1).join('/')
  const room = width - tail.length - 3
  if (room >= 3) return `${head.length > room ? `${head.slice(0, room - 1)}…` : head}/…/${tail}`
  return `…/${tail}`.length <= width ? `…/${tail}` : `…${tail.slice(Math.max(0, tail.length - width + 1))}`
}

export const cutEnd = (line: string, width: number) => (line.length <= width ? line : `${line.slice(0, Math.max(0, width - 1))}…`)

// Words wrapped to the width, at most maxRows rows; what does not fit ends the last row with an ellipsis.
export function wrapRows(sentenceText: string, width: number, maxRows: number) {
  const rows: string[] = []
  let line = ''
  for (const word of sentenceText.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      rows.push(line)
      line = word
    } else line = line ? `${line} ${word}` : word
  }
  if (line) rows.push(line)
  if (rows.length <= maxRows) return rows.map(row => cutEnd(row, width))
  const kept = rows.slice(0, maxRows)
  kept[maxRows - 1] = cutEnd(`${kept[maxRows - 1]} ${rows.slice(maxRows).join(' ')}`, width)
  return kept
}

// The heading text after the glyph: the folder name shrinks first, then goes; the counts in the verb stay.
export function fitHeading(plain: Plain, width: number) {
  const full = plain.subject ? fill(text.card.inFolder, { verb: plain.verb, subject: plain.subject }) : plain.verb
  if (full.length <= width) return full
  if (plain.subject) {
    const room = width - plain.verb.length - 4
    if (room >= 6) return fill(text.card.inFolder, { verb: plain.verb, subject: midCut(plain.subject, room) })
  }
  return cutEnd(plain.verb, width)
}

export type CardRow = { kind: 'head' | 'does' | 'path' | 'line' | 'note' | 'verdict'; text: string; stats?: string; isOk?: boolean }

// Heading, figures, sentence, then its second row, as many as the band holds; the command stays in Details.
// Open, the sentence keeps every row it needs up to this many, as far as the band lets the card grow.
export const DOES_ROWS_OPEN = 12

export function cardRows(plain: Plain, report: Report, width: number, bodyRows: number, isOpen = false): CardRow[] {
  const wrapped = wrapRows(plain.does, width, isOpen ? Math.min(DOES_ROWS_OPEN, Math.max(2, bodyRows - 1)) : 2)
  const { facts } = report
  const items = facts?.items ?? []
  const candidates: { order: number; priority: number; row: CardRow }[] = [{ order: 0, priority: 0, row: { kind: 'head', text: fitHeading(plain, width - 3) } }]
  if (items.length) {
    const first = items[0]!
    const stats = items.length > 1 && facts?.files !== undefined ? [plural(facts.files, text.units.file), plural(facts.folders ?? 0, text.units.folder), formatSize(facts.bytes ?? 0)].join(` ${MARK.sep} `) : first.stats
    const more = items.length > 1 ? fill(text.card.andMore, { n: items.length - 1 }) : ''
    const room = Math.max(8, width - stats.length - more.length - 3)
    candidates.push({ order: 10, priority: 1, row: { kind: 'path', text: `${midCut(first.path, room)}${more}`, stats } })
  } else if (report.isUnknown) {
    const note = plain.targets ? fill(text.card.fromCommand, { targets: plain.targets }) : text.card.cantPreview
    candidates.push({ order: 10, priority: 1, row: { kind: 'note', text: cutEnd(note, width) } })
  } else if (report.groups[0]?.lines[0]) {
    const group = report.groups[0]
    const rest = group.lines.length - 1 + group.more
    const more = rest > 0 ? fill(text.card.andMore, { n: rest }) : ''
    candidates.push({ order: 10, priority: 1, row: { kind: 'line', text: `${cutEnd(group.lines[0]!, Math.max(8, width - more.length))}${more}` } })
  }
  // Open, every sentence row outranks the paths and the verdict; shut, the second row is the first to go.
  wrapped.forEach((row, index) => candidates.push({ order: 1 + index / 100, priority: isOpen ? 0.5 : index === 0 ? 2 : 5, row: { kind: 'does', text: row } }))
  if (plain.verdict) {
    const line = fill(text.card.verdict, { lead: plain.verdict.isOk ? text.card.verdictOk : text.card.verdictCheck, why: plain.verdict.why })
    candidates.push({ order: 20, priority: 1.5, row: { kind: 'verdict', text: cutEnd(line, width - 2), isOk: plain.verdict.isOk } })
  }
  const chosen = [...candidates].sort((a, b) => a.priority - b.priority).slice(0, Math.max(1, bodyRows))
  return chosen.sort((a, b) => a.order - b.order).map(candidate => candidate.row)
}

// Whether opening the sentence draws rows the shut card does not: it is cut, or the band dropped its second row.
export function canOpenDoes(plain: Plain, report: Report, width: number, bodyRows: number) {
  const doesRows = (isOpen: boolean) => cardRows(plain, report, width, bodyRows, isOpen).filter(row => row.kind === 'does').length
  return doesRows(true) > doesRows(false)
}

// The digit that presses each action from an empty prompt, drawn as a keycap before its label.
export const HOTKEY = { cancel: '1', details: '2', run: '3' }
// Each action is a pill: two caps around a three-cell digit subpill and the padded label.
export const ACTION_EXTRA = 2 + 3 + 2
export const ACTION_GAP = 2

// The three action labels, shortened together so the row fits: Cancel, Details and the consequence stay in that order.
export function actionLabels(plain: Plain, width: number) {
  const fixed = text.card.cancel.length + text.card.details.length + 3 * ACTION_EXTRA + 2 * ACTION_GAP
  const run = cutEnd(plain.run, Math.max(8, width - fixed))
  return { cancel: text.card.cancel, details: text.card.details, run }
}


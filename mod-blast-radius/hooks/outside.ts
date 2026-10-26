// mod-blast-radius / hooks/outside.ts, by v-amorim: which delete targets outside the session folder may go to the bin with no card
import { dirname, isInside, isSame, native } from './paths'

// Past this many entries under a folder the walk gives up, and the folder keeps its card.
export const WALK_CAP = 2000

export type KeepEntry = { glob: string[] } | { marker: string; unless: string }
export type Keep = { entries: KeepEntry[]; error?: string }

const HOME_REF = /^(?:~|\$HOME|\$\{HOME\})(?=\/|$)/

const fold = (text: string, isWindows: boolean) => (isWindows ? text.toLowerCase() : text)

export const approvalKey = fold

// keep.json: an array of { glob, reason } and { marker, unless?, reason }. One bad entry cannot be told from a lost rule, so it breaks the whole file, which keeps everything.
export function compileKeep(raw: string, home: string, isWindows: boolean): Keep {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch (error) {
    return { entries: [], error: String((error as Error)?.message ?? error).slice(0, 60) }
  }
  if (!Array.isArray(data)) return { entries: [], error: 'not an array' }
  const entries: KeepEntry[] = []
  for (const item of data) {
    const { glob, marker, unless } = (item ?? {}) as Record<string, unknown>
    if (typeof glob === 'string' && glob.trim()) {
      const spelled = glob.trim().replace(/\\/g, '/')
      const at = HOME_REF.exec(spelled)
      const full = at ? `${home}${spelled.slice(at[0].length)}` : spelled
      entries.push({ glob: fold(native(full, isWindows), isWindows).split('/').filter(Boolean) })
    } else if (typeof marker === 'string' && marker.trim() && !/[\\/]/.test(marker) && (unless === undefined || typeof unless === 'string')) {
      entries.push({ marker: fold(marker.trim(), isWindows), unless: fold((unless ?? '').trim(), isWindows) })
    } else {
      return { entries: [], error: 'bad entry' }
    }
  }
  return { entries }
}

const segmentRe = (segment: string) => new RegExp(`^${segment.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*+/g, '[^/]*').replace(/\?/g, '[^/]')}$`)

// Whether the path is inside or equal to a glob match; a folder also counts when a file under it could match.
function reaches(glob: string[], at: number, parts: string[], seen: number, isFolder: boolean): boolean {
  if (at === glob.length) return true
  if (seen === parts.length) return isFolder || glob.slice(at).every(part => part === '**')
  if (glob[at] === '**') return reaches(glob, at + 1, parts, seen, isFolder) || reaches(glob, at, parts, seen + 1, isFolder)
  return segmentRe(glob[at]!).test(parts[seen]!) && reaches(glob, at + 1, parts, seen + 1, isFolder)
}

// An entry that is home, above it, or a root covers every file the person has, so it is no signal and is skipped.
export const isPending = (path: string, pending: string[] | undefined, isWindows: boolean, home: string) =>
  (pending ?? []).some(item => {
    const other = native(item, isWindows)
    if (dirname(other) === other || isSame(other, home, isWindows) || isInside(home, other, isWindows)) return false
    return isSame(path, other, isWindows) || isInside(path, other, isWindows) || isInside(other, path, isWindows)
  })

type Listed = { name: string; kind: string; isLink: boolean }
export type OutsideFs = {
  stat: (path: string) => Promise<{ kind: string; isLink: boolean }>
  exists: (path: string) => Promise<boolean>
  list: (path: string) => Promise<Listed[]>
  // Birth time in ms of each path, or of the oldest thing under a folder; null when it cannot be read.
  births: (paths: string[]) => Promise<(number | null)[]>
}

export type Standing = {
  // When this session first showed up; null when unknown.
  startedAt: number | null
  // null: keep.json is broken, so everything outside the session folder is kept.
  keep: Keep | null
  // What mod-wrap-up publishes; undefined without it.
  pending: string[] | undefined
  isWindows: boolean
  home: string
  root: string
}

// Folders that hold a marker file and not its unless file, above the path (and the folder itself) and below it.
async function isMarked(path: string, isFolder: boolean, markers: { marker: string; unless: string }[], standing: Standing, io: OutsideFs) {
  if (markers.length === 0) return false
  const { isWindows, home } = standing
  const holds = async (folder: string) => {
    for (const { marker, unless } of markers) {
      if ((await io.exists(`${folder}/${marker}`)) && !(unless && (await io.exists(`${folder}/${unless}`)))) return true
    }
    return false
  }
  for (let folder = isFolder ? path : dirname(path); ; folder = dirname(folder)) {
    if (await holds(folder)) return true
    if (dirname(folder) === folder || isSame(folder, home, isWindows)) break
  }
  if (!isFolder) return false
  const queue = [path]
  let count = 0
  for (let at = 0; at < queue.length; at++) {
    const entries = await io.list(queue[at]!)
    count += entries.length
    if (count > WALK_CAP) throw new Error('too many entries')
    const names = new Set(entries.map(entry => fold(entry.name, isWindows)))
    for (const { marker, unless } of markers) if (names.has(marker) && !(unless && names.has(unless))) return true
    for (const entry of entries) {
      if (entry.isLink) throw new Error('link')
      if (entry.kind === 'dir') queue.push(`${queue[at]}/${entry.name}`)
    }
  }
  return false
}

// The targets that may go to the bin with no card, by approvalKey. Every check fails closed: a throw, an unknown or a broken file leaves the target out.
export async function approveOutside(paths: string[], standing: Standing, io: OutsideFs): Promise<Set<string>> {
  const approved = new Set<string>()
  const { isWindows, keep, startedAt } = standing
  if (startedAt === null || !keep || keep.error) return approved
  const markers = keep.entries.filter((entry): entry is { marker: string; unless: string } => 'marker' in entry)
  const globs = keep.entries.filter((entry): entry is { glob: string[] } => 'glob' in entry)
  const candidates: string[] = []
  for (const path of paths) {
    try {
      const covers = (other: string) => isSame(path, other, isWindows) || isInside(other, path, isWindows)
      if (dirname(path) === path || covers(standing.root) || covers(standing.home)) continue
      if (isPending(path, standing.pending, isWindows, standing.home)) continue
      const stat = await io.stat(path)
      if (stat.isLink) continue
      const isFolder = stat.kind === 'dir'
      const parts = fold(path, isWindows).split('/').filter(Boolean)
      if (globs.some(entry => reaches(entry.glob, 0, parts, 0, isFolder))) continue
      if (await isMarked(path, isFolder, markers, standing, io)) continue
      candidates.push(path)
    } catch {
      // a check that cannot finish keeps the target on the card
    }
  }
  if (candidates.length === 0) return approved
  try {
    const births = await io.births(candidates)
    candidates.forEach((path, at) => {
      const born = births[at]
      if (typeof born === 'number' && Number.isFinite(born) && born > startedAt) approved.add(approvalKey(path, isWindows))
    })
  } catch {
    approved.clear()
  }
  return approved
}

const quoted = (path: string) => `'${path.replace(/'/g, "''")}'`

// One process for every target: each prints the birth time in ms of the oldest thing at or under it, or ERR for a link, an unreadable entry, more than WALK_CAP entries, or a time the system does not keep.
export function birthArgv(paths: string[], isWindows: boolean): string[] {
  if (isWindows) {
    const list = paths.map(quoted).join(', ')
    const script = `$ErrorActionPreference = 'Stop'; foreach ($p in @(${list})) { try { $all = @(Get-Item -LiteralPath $p -Force); if ($all[0].PSIsContainer) { $all += @(Get-ChildItem -LiteralPath $p -Recurse -Force | Select-Object -First ${WALK_CAP + 1}) }; if ($all.Count -gt ${WALK_CAP}) { throw 'cap' }; $min = [long]::MaxValue; foreach ($i in $all) { if ($i.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'link' }; $t = ([DateTimeOffset]$i.CreationTimeUtc).ToUnixTimeMilliseconds(); if ($t -lt $min) { $min = $t } }; $min } catch { 'ERR' } }`
    return ['powershell', '-NoProfile', '-NonInteractive', '-Command', script]
  }
  const script = [
    "case $(uname -s) in Darwin) s='stat -f %B' ;; *) s='stat -c %W' ;; esac",
    'for p in "$@"; do',
    '  if [ ! -e "$p" ] && [ ! -L "$p" ]; then echo ERR; continue; fi',
    '  c=$(find "$p" -print 2>/dev/null | head -n ' + (WALK_CAP + 1) + ' | wc -l)',
    '  if [ "$c" -gt ' + WALK_CAP + ' ] || [ -n "$(find "$p" -type l -print 2>/dev/null | head -n 1)" ]; then echo ERR; continue; fi',
    '  find "$p" -exec $s {} + 2>/dev/null | awk -v c="$c" \'$1 !~ /^[0-9]+$/ || $1 == 0 { bad = 1 } { n++; if (min == "" || $1 < min) min = $1 } END { if (bad || n != c) print "ERR"; else print min * 1000 }\'',
    'done',
  ].join('\n')
  return ['sh', '-c', script, 'sh', ...paths]
}

export function parseBirths(stdout: string, count: number): (number | null)[] {
  const lines = stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  if (lines.length !== count) return Array.from({ length: count }, () => null)
  return lines.map(line => (/^\d+$/.test(line) ? Number(line) : null))
}

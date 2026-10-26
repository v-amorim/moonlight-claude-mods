// mod-blast-radius / hooks/paths.ts, by v-amorim: pure path helpers, since a mod has no node:path

export const isDrivePath = (path: string) => /^[A-Za-z]:/.test(path)

// Collapses `.`, `..` and repeated slashes; a Windows path keeps its drive and compares by its lowercase form.
export function normalize(input: string, isWindows: boolean): string {
  const path = isWindows ? input.replace(/\\/g, '/') : input
  const drive = isWindows ? (/^[A-Za-z]:/.exec(path)?.[0] ?? '') : ''
  const rest = path.slice(drive.length)
  const isRooted = rest.startsWith('/')
  const parts: string[] = []
  for (const part of rest.split('/')) {
    if (part === '' || part === '.') continue
    if (part !== '..') parts.push(part)
    else if (parts.length > 0 && parts[parts.length - 1] !== '..') parts.pop()
    else if (!isRooted) parts.push('..')
  }
  return `${drive}${isRooted ? '/' : ''}${parts.join('/')}` || '.'
}

// Git Bash spells C:\x as /c/x; both sides of a comparison need the same spelling.
export function native(path: string, isWindows: boolean): string {
  const gitBash = isWindows ? /^\/([a-zA-Z])(\/.*)?$/.exec(path) : null
  return normalize(gitBash ? `${gitBash[1]!.toUpperCase()}:${gitBash[2] ?? '/'}` : path, isWindows)
}

export const isAbsolute = (path: string, isWindows: boolean) => (isWindows ? /^[A-Za-z]:\//.test(path) : path.startsWith('/'))

export function dirname(path: string): string {
  const at = path.lastIndexOf('/')
  if (at < 0) return /^[A-Za-z]:/.test(path) ? path.slice(0, 2) : '.'
  if (at === 0) return '/'
  return /^[A-Za-z]:$/.test(path.slice(0, at)) ? path.slice(0, at + 1) : path.slice(0, at)
}

export const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1)

const keyOf = (path: string, isWindows: boolean) => (isWindows ? path.toLowerCase() : path)

export const isSame = (a: string, b: string, isWindows: boolean) => keyOf(a, isWindows) === keyOf(b, isWindows)

// Strictly below `root`: the folder itself does not count.
export function isInside(path: string, root: string, isWindows: boolean) {
  const [low, top] = [keyOf(path, isWindows), keyOf(root, isWindows).replace(/\/+$/, '')]
  return low !== top && low.startsWith(`${top}/`)
}

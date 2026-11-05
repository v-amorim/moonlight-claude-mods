// mod-wrap-up / hooks/window.ts, by v-amorim: a handoff that opens the next session in a new Windows Terminal window instead of clearing this one; pure, the reads stay in register.tsx.
import type { NamePlan } from './titles'

// What the new window's own mod reads at its start, through the token its environment carries.
export type Join = {
  chain: string
  title: string
  text: string
  submit: boolean
  goal: string
  link: Pick<NamePlan, 'oldOwn' | 'nextOwn' | 'topic' | 'oldHop' | 'nextHop'>
}

// The mod's own data folder already exists, so the file needs no folder made for it.
export const joinFile = (config: string, token: string) => `${config}/mods-data/mod-wrap-up/join-${token}.json`

// The token names a file, so only letters, digits and hyphens get through.
export const joinToken = (session: string, now: number) => `${session.slice(0, 8)}-${now}`.replace(/[^A-Za-z0-9-]/g, '')

// A child of a Claude session inherits CLAUDE_CODE_CHILD_SESSION (transcripts off) and Git Bash's MSYS_NO_PATHCONV (hooks break), so cmd clears both before it starts claude.
export const windowArgv = (cwd: string, token: string) => ['wt.exe', '-w', 'new', '-d', cwd, 'cmd', '/c', `set CLAUDE_CODE_CHILD_SESSION=& set MSYS_NO_PATHCONV=& set WRAPUP_JOIN=${token}& claude`]

// Only Windows Terminal opens the window, so a config folder without a drive letter means the handoff clears as before.
export const canOpenWindow = (isOn: boolean, config: string) => isOn && /^[A-Za-z]:/.test(config)

const str = (value: unknown) => (typeof value === 'string' ? value : '')
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

// An emptied or torn file is no join, so a reload of the new window never joins twice.
export function readJoin(raw: string): Join | null {
  try {
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object' || !str(data.text)) return null
    const link = data.link ?? {}
    return {
      chain: str(data.chain),
      title: str(data.title),
      text: str(data.text),
      submit: data.submit === true,
      goal: str(data.goal),
      link: { oldOwn: str(link.oldOwn), nextOwn: str(link.nextOwn), topic: str(link.topic), oldHop: num(link.oldHop), nextHop: num(link.nextHop) },
    }
  } catch {
    return null
  }
}

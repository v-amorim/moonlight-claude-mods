// mod-blast-radius / hooks/spend.ts, by v-amorim
// Adds each side-model call's usage to <configDir>/mods-data/mod-blast-radius/spend.json, one bucket per UTC day and model. Never throws.
import type { EngineInterface, ModelUsage } from 'claude-code'

const MOD = 'mod-blast-radius'
const KEEP_DAYS = 30
const DAY_MS = 86_400_000

type Counts = { calls: number; input: number; output: number; cacheRead: number; cacheWrite: number }
type SpendFile = { days: Record<string, Record<string, Counts>> }

const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0)
const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10)

// Reads what is there, keeps only well-formed buckets from the last KEEP_DAYS days, and adds one call.
export function withCall(raw: unknown, model: string, usage: Partial<ModelUsage> | undefined, now: number): SpendFile {
  const oldest = dayKey(now - (KEEP_DAYS - 1) * DAY_MS)
  const days: SpendFile['days'] = {}
  const source = raw && typeof raw === 'object' ? (raw as { days?: unknown }).days : null
  if (source && typeof source === 'object') {
    for (const [day, models] of Object.entries(source as Record<string, unknown>)) {
      if (day < oldest || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !models || typeof models !== 'object') continue
      days[day] = {}
      for (const [name, c] of Object.entries(models as Record<string, Record<string, unknown>>)) {
        if (c && typeof c === 'object') days[day][name] = { calls: count(c.calls), input: count(c.input), output: count(c.output), cacheRead: count(c.cacheRead), cacheWrite: count(c.cacheWrite) }
      }
    }
  }
  const today = (days[dayKey(now)] ??= {})
  const was = (today[model] ??= { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
  was.calls += 1
  was.input += count(usage?.input_tokens)
  was.output += count(usage?.output_tokens)
  was.cacheRead += count(usage?.cache_read_input_tokens)
  was.cacheWrite += count(usage?.cache_creation_input_tokens)
  return { days }
}

async function configDir($: EngineInterface) {
  const custom = ((await $.env.get('CLAUDE_CONFIG_DIR')) ?? '').trim()
  const dir = custom || `${(await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''}/.claude`
  return dir.replace(/\\/g, '/').replace(/\/+$/, '')
}

// One queue per process, so two calls ending together do not overwrite each other's add.
let queue: Promise<unknown> = Promise.resolve()

// Records a finished call under the model that was asked for; a failed or missing read starts a fresh file, a failed write is dropped.
export function recordSpend($: EngineInterface, model: string, result: { usage?: Partial<ModelUsage> } | null | undefined) {
  if (!result?.usage) return
  const { usage } = result
  if (!count(usage.input_tokens) && !count(usage.output_tokens) && !count(usage.cache_read_input_tokens) && !count(usage.cache_creation_input_tokens)) return
  queue = queue.then(async () => {
    try {
      const path = `${await configDir($)}/mods-data/${MOD}/spend.json`
      const raw = await $.fs.read(path).then(file => JSON.parse(String(file)) as unknown).catch(() => null)
      const now = await $.clock.now()
      await $.fs.write(path, JSON.stringify(withCall(raw, model || 'unknown', usage, now)))
    } catch {
      // Spend is a courtesy: the mod works the same without it.
    }
  })
}

// mod-model-effort / hooks/levels.ts, by v-amorim
// Lists the effort levels and their glyphs and colors, matching the status line.
import style from './style'

export const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

// Matches the oh-my-posh status line's glyphs and colors, so both read alike.
export const LEVEL_LOOK: Record<string, { glyph: string; color: string }> = style.levels

// The model menu lists the models requests have used, newest first; no API lists them, and a fixed list goes stale.
export const MAX_MODELS = 6

// `claude-opus-5-5[1m]` is one model with `claude-opus-5-5`, so the menu keeps one entry; on a model without 1M by default, a pick runs at its default window.
export const plainModel = (id: string) => id.replace(/\[1m\]$/i, '')

export const withModel = (models: unknown, id: string | undefined) =>
  [...new Set([...(id ? [id] : []), ...(Array.isArray(models) ? models.filter((model): model is string => typeof model === 'string') : [])].map(plainModel))].slice(0, MAX_MODELS)

// `claude-opus-5-5` reads `Opus 5.5`; a trailing date and a `[1m]` are dropped.
export const displayName = (model: string) => {
  const match = /^claude-([a-z]+)-(\d+(?:-\d{1,2})*)(?:-\d{8})?$/.exec(plainModel(model))
  if (!match) return model
  return `${match[1]![0]!.toUpperCase()}${match[1]!.slice(1)} ${match[2]!.replace(/-/g, '.')}`
}

// Sets `modelSettings[model].effortLevel`, the key Alt+P writes; null when the file is not JSON or the edit would touch anything else.
export function withEffort(text: string, model: string, effort: string): string | null {
  let before: Record<string, any>
  try {
    before = JSON.parse(text)
  } catch {
    return null
  }
  const after = JSON.parse(text)
  after.modelSettings = { ...after.modelSettings, [model]: { ...after.modelSettings?.[model], effortLevel: effort } }
  const indent = /^\{\r?\n([ \t]+)"/.exec(text)?.[1] ?? '  '
  const out = JSON.stringify(after, null, indent) + '\n'
  const reparsed = JSON.parse(out)
  const others = (value: Record<string, any>) => JSON.stringify({ ...value, modelSettings: undefined })
  return others(before) === others(reparsed) ? out : null
}

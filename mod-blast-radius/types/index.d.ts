// mod-blast-radius / types/index.d.ts, by v-amorim
// Declares the mod's plugin state type with pane and holding flags and the session's permission checks.
declare module 'claude-code' {
  interface PluginState {
    'mod-blast-radius': {
      pane: boolean
      holding: boolean
      checks: { id: string; tool: string; family: string; summary: string; verdict: string; isAgent: boolean; at: number }[]
      // The AFK pass: until is its end in ms (-1: no end, 0: off), total its length, ran what ran with no card.
      afk: { until: number; total: number; ran: string[] }
    }
    // Read only: mod-menu's label mode, which the pill row follows, and the pane flag every mod sets while its panel is open.
    // Read only, soft: the absolute paths mod-wrap-up's ledger names in open tasks and live decisions. Absent without that mod.
    'mod-wrap-up': { pending: string[] }
    'mod-menu': { labels: 'always' | 'never'; pane: boolean; host: boolean; relay: { to: string; n: number; data: object } }
  }
}

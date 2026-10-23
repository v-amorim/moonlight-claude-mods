// mod-blast-radius / types/index.d.ts, by v-amorim
// Declares the mod's plugin state type with pane and holding flags and the session's permission checks.
declare module 'claude-code' {
  interface PluginState {
    'mod-blast-radius': {
      pane: boolean
      holding: boolean
      checks: { id: string; tool: string; family: string; summary: string; verdict: string; isAgent: boolean; at: number }[]
    }
  }
}

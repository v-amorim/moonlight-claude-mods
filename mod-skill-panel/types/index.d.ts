// mod-skill-panel / types/index.d.ts, by v-amorim
// Declares the mod's plugin state type and the menu mod's shared state.
declare module 'claude-code' {
  interface PluginState {
    'mod-skill-panel': { pane: boolean }
    'mod-menu': { hidden: boolean; labels: 'always' | 'never'; host: boolean; relay: { to: string; n: number; data: object } }
  }
}

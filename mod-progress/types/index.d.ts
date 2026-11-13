// mod-progress / types/index.d.ts, by v-amorim
// Declares the mod's plugin state type and the menu mod's shared state.
declare module 'claude-code' {
  interface PluginState {
    'mod-progress': { pane: boolean; task: string; 'output-open': string; booted: boolean }
    'mod-menu': { hidden: boolean; labels: 'always' | 'never'; nerd: boolean; host: boolean; relay: { to: string; n: number; data: object } }
  }
}

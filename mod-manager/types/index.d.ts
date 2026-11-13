// mod-manager / types/index.d.ts, by v-amorim
// Declares the plugin state shape for the pane and menu visibility.
declare module 'claude-code' {
  interface PluginState {
    'mod-manager': { pane: boolean }
    'mod-menu': { hidden: boolean; labels: 'always' | 'never'; host: boolean; relay: { to: string; n: number; data: object } }
  }
}

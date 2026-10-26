// mod-wrap-up / types/index.d.ts, by v-amorim
// Declares the plugin state shape for the settings pane and the menu's hidden flag.
declare module 'claude-code' {
  interface PluginState {
    // pending: the absolute paths the ledger's open tasks and live decisions name; mod-blast-radius reads it so it never bins them.
    'mod-wrap-up': { pane: boolean; pending: string[] }
    'mod-menu': { hidden: boolean; labels: 'always' | 'never' }
  }
}

// mod-heads-up / types/index.d.ts, by v-amorim
// Declares the plugin state shape for the pane and related mods' flags.
declare module 'claude-code' {
  interface PluginState {
    'mod-heads-up': { pane: boolean; open: string[] }
    'mod-menu': { hidden: boolean; nerd: boolean; labels: 'always' | 'never'; host: boolean; relay: { to: string; n: number; data: object } }
    // Read only: true while mod-blast-radius holds a command on its card.
    'mod-blast-radius': { holding: boolean }
  }
}

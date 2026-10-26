// mod-menu / types/index.d.ts, by v-amorim: plugin state shape
declare module 'claude-code' {
  interface PluginState {
    'mod-menu': { hidden: boolean; labels: 'auto' | 'always' | 'never'; booted: boolean }
  }
}

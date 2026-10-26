// mod-file-tree / types/index.d.ts, by v-amorim
// Declares the plugin state shape for the pane and file log.
declare module 'claude-code' {
  interface PluginState {
    'mod-file-tree': {
      pane: boolean
      log: {
        turn: number
        seq: number
        working: boolean
        files: { path: string; kind: string; last: string; seq: number; lastTurn: number; add: number; del: number }[]
        steps: { id: number; turn: number; path: string; tool: string; kind: string; note: string; add: number; del: number; lines: { op: string; t: string }[] }[]
      }
      cleared: { seq: number; step: number }
      session: string
    }
    'mod-menu': { hidden: boolean; labels: 'auto' | 'always' | 'never' }
  }
}

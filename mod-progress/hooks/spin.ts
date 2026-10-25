// mod-progress / hooks/spin.ts, by v-amorim: the running spinner and breathing cell on one 80 ms clock.
import type { ClientSurface } from 'claude-code'

import { SPIN_FRAMES, SPIN_MS } from './entry'
import { mix, THEME } from './theme'

// The hovered line and the frame count of a list that spins.
export type SpinState = { at: number; spin: number }

const BREATH_FRAMES = 16

export const spinFrame = (spin: number) => SPIN_FRAMES[spin % SPIN_FRAMES.length]!

// Accent to primary-70 and back, once every BREATH_FRAMES frames.
export const breathColor = (spin: number) => mix(THEME.accent, THEME.ok, (1 - Math.cos((2 * Math.PI * spin) / BREATH_FRAMES)) / 2)

const clocks = new WeakMap<object, () => void>()
const running = new WeakMap<object, boolean>()

// Ticks the frame count while something runs and the mod's animations are on; the clock stops itself once nothing does.
export const keepSpinning = (surface: ClientSurface<SpinState>, isRunning: boolean, still?: boolean) => {
  running.set(surface, isRunning && !still)
  if (!running.get(surface) || clocks.has(surface)) return
  const stop = surface.every(SPIN_MS, () => {
    if (!running.get(surface)) {
      stop()
      clocks.delete(surface)
      return
    }
    surface.setState({ at: surface.state?.at ?? -1, spin: (surface.state?.spin ?? 0) + 1 })
  })
  clocks.set(surface, stop)
}

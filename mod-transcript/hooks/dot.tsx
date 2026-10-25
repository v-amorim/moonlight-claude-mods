// mod-transcript / hooks/dot.tsx, by v-amorim
// Draws a running command's braille spinner until it finishes.
import type { ClientModule } from 'claude-code'

import { SPIN_FRAMES, SPIN_MS } from './entry'

export type DotProps = { color: string; still: boolean }

// The running command's spinner, the same braille dots as every running label; a still one holds its first frame.
const Dot: ClientModule<DotProps, number> = (props, surface) => {
  const { Text } = surface.elements
  if (surface.state === undefined) {
    surface.setState(0)
    if (!props.still) surface.every(SPIN_MS, () => surface.setState(((surface.state ?? 0) + 1) % SPIN_FRAMES.length))
  }
  return <Text color={props.color}>{SPIN_FRAMES[surface.state ?? 0]}</Text>
}

export default Dot

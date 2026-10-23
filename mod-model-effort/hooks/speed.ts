// mod-model-effort / hooks/speed.ts, by v-amorim: reply speed from a stream's times, pure.
export type Speed = { first: number; rate: number }

// Times in ms. No first chunk, no tokens or no streaming time gives no reading.
export function replySpeed(start: number, first: number | undefined, end: number, tokens: number | undefined): Speed | null {
  if (first === undefined || !tokens || tokens <= 0) return null
  const streamed = end - first
  const wait = first - start
  if (!(streamed > 0) || !(wait >= 0)) return null
  const rate = Math.round((tokens * 1000) / streamed)
  return Number.isFinite(rate) && rate > 0 ? { first: wait / 1000, rate } : null
}

export const isSpeed = (value: unknown): value is Speed => {
  const speed = value as Speed | null | undefined
  return Boolean(speed) && Number.isFinite(speed!.first) && Number.isFinite(speed!.rate)
}

// One decimal under 10 seconds, whole seconds from there.
export function firstText(seconds: number) {
  const tenths = Math.round(seconds * 10) / 10
  return tenths < 10 ? `${tenths.toFixed(1)}s` : `${Math.round(seconds)}s`
}

// Passes every chunk on in order, and hands each one to `seen` as it goes by.
export async function* watch<C, R>(stream: AsyncGenerator<C, R>, seen: (chunk: C) => Promise<void>): AsyncGenerator<C, R> {
  let step = await stream.next()
  while (!step.done) {
    await seen(step.value)
    step = await stream.next(yield step.value)
  }
  return step.value
}

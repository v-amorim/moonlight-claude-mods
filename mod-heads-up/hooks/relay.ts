// hooks/relay.ts, by v-amorim: mod-menu hands each click on its entries back to the owning mod through a state write
export type Relay = { to: string; data: unknown; n: number }

// The message a relay write carries for `plugin`, or undefined when it is for another mod.
export const relayedTo = (value: unknown, plugin: string) => {
  const relay = value as Relay | undefined
  return relay?.to === plugin ? relay.data : undefined
}

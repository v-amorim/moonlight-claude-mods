// mod-transcript / hooks/view.ts, by v-amorim
// Which agent's transcript the main view shows, known before a switch lands.

// The agent whose transcript is on screen (the band's view); its rows are not the main conversation's turns.
export const viewing: { agent: string | undefined } = { agent: undefined }

// A plugin's switch is announced here before it lands, so the rows already draw the new view; a refused switch puts the old one back.
export async function announceView<E extends { agentId?: string }, R extends { value?: { deny?: string } }>(e: E, next: (e: E) => Promise<R>) {
  const before = viewing.agent
  viewing.agent = e.agentId
  const shown = await next(e)
  if (shown.value?.deny) viewing.agent = before
  return shown
}

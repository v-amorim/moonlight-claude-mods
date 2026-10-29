// hooks/toasts.tsx, by v-amorim
// Shared toast cards; every mod that toasts carries the same copy.
import type { RenderElement } from 'claude-code'

import type { Tip } from './entry'
import { iconChip } from './pills'
import style from './style'
import { CAPS, MARK, mix, THEME } from './theme'

type Elements = { Box: (props: any) => RenderElement; Client: (props: any) => RenderElement; Text: (props: any) => RenderElement }

// The slice of a mod's Look the cards read, typed here because mod-menu has no look.tsx.
type ToastLook = { nerd: boolean; glyph: { close: string } }

export const TOAST_MS = 4000

const DISMISS_TIP = { label: 'Dismiss', text: 'hides this message' }
const MAX_TOASTS = 3

// A mod's own toasts, newest last. A toast reaches only the hooks above its caller, so each mod catches its own.
export class ToastList {
  items: { id: number; text: string }[] = []
  // The owning mod's animations setting is off, so the dismiss × does not fade.
  isStill = false
  private lastId = 0

  // `prefix` keeps the dismiss Client keys apart from other mods' cards in the band.
  constructor(readonly prefix: string) {}

  add(text: string) {
    const id = (this.lastId += 1)
    this.items = [...this.items, { id, text }].slice(-MAX_TOASTS)
    return id
  }

  drop(id: number) {
    this.items = this.items.filter(toast => toast.id !== id)
  }

  // The toast a dismiss click names, or undefined when the click was not on one of these cards.
  idOf(entryId: string) {
    const head = `toast-${this.prefix}-`
    return entryId.startsWith(head) ? Number(entryId.slice(head.length)) : undefined
  }
}

// A pill already frames the glyph, so drop the brackets and padding of the standalone button (safe `[×]`).
const bare = (glyph: string) => glyph.replace(/[[\]\s]/g, '')

// Callers write `✓ Saved` or `! Failed`; the card draws the mark.
function toneOf(text: string) {
  for (const [mark, color, bold] of [[MARK.ok, THEME.good, false], [MARK.warn, THEME.alert, true]] as const) {
    if (text.startsWith(mark)) return { mark, color, bold, text: text.slice(mark.length).trimStart() }
  }
  return { mark: MARK.bullet, color: THEME.accent, bold: false, text }
}

// The web toast as a band pill, or a card for an error: tinted icon chip, "Title: detail" split bold and muted, an error edged in alert; closeTip is the × tip.
export const toastCards = ({ Box, Client, Text }: Elements, list: ToastList, look?: ToastLook, closeTip: Pick<Tip, 'label' | 'text'> = DISMISS_TIP) =>
  list.items.map(toast => {
    const id = `toast-${list.prefix}-${toast.id}`
    const tone = toneOf(toast.text)
    const nerd = look?.nerd === true
    const close = bare(look?.glyph.close ?? style.glyphs.safe.close)
    const fill = mix(THEME.surface1, tone.color, 0.06)
    const split = tone.text.indexOf(': ')
    const [title, detail] = split > 0 ? [tone.text.slice(0, split), tone.text.slice(split + 2)] : [tone.text, '']
    const edge = tone.color === THEME.alert ? mix(fill, THEME.alert, 0.33) : THEME.border
    const tint = mix(fill, tone.color, 0.15)
    // With Nerd caps a notice is a one-row pill; an error keeps the bordered card so its whole message wraps, and so do the safe glyphs, since a box border cannot round a filled row.
    const isPill = nerd && tone.color !== THEME.alert
    const frame = isPill ? { backgroundColor: fill } : { paddingX: 1, borderStyle: 'round', borderColor: edge, backgroundColor: fill }
    return (
      <Box key={id} flexDirection="row" flexShrink={1}>
        {isPill ? <Text key={`${id}-left`} color={fill}>{CAPS.left}</Text> : null}
        <Box key={`${id}-body`} flexDirection="row" flexGrow={1} flexShrink={1} columnGap={1} alignItems="center" {...frame}>
          <Box key={`${id}-mark`} flexDirection="row" flexShrink={0}>
            {nerd ? <Text key={`${id}-mark-left`} color={tint} backgroundColor={fill}>{CAPS.left}</Text> : null}
            <Text color={tone.color} backgroundColor={tint} bold={tone.bold}>{nerd ? tone.mark : ` ${tone.mark} `}</Text>
            {nerd ? <Text key={`${id}-mark-right`} color={tint} backgroundColor={fill}>{CAPS.right}</Text> : null}
          </Box>
          <Box key={`${id}-text`} flexGrow={1} flexShrink={1}>
            <Text wrap={isPill ? 'truncate-end' : 'wrap'}>
              <Text color={THEME.onSurface} bold>{title}</Text>
              {detail ? <Text color={THEME.muted}>{` ${detail}`}</Text> : null}
            </Text>
          </Box>
          {iconChip({ Box, Text }, nerd, `${id}-close`, fill,
            <Client key={id} module="./entry.tsx" height={1} props={{ id, label: close, isOpen: false, bg: THEME.surface3, still: list.isStill, tip: { glyph: close, ...closeTip } }} />,
            <Client key={`${id}-grown`} module="./entry.tsx" height={1} props={{ id, label: `${close} ${closeTip.label}`, isOpen: false, bg: THEME.lifted, idle: THEME.accent, still: true, tip: { glyph: close, ...closeTip } }} />,
          )}
        </Box>
        {isPill ? <Text key={`${id}-right`} color={fill}>{CAPS.right}</Text> : null}
      </Box>
    )
  })

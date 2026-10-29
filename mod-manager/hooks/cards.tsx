// mod-manager / hooks/cards.tsx, by v-amorim
// Draws the two band cards above the prompt: the first-run welcome and the updates card.
import type { RenderElement } from 'claude-code'

import { cardFill, titleEdge, type Look } from './look'
import type { CatalogMod } from './registry'
import type { EntryProps, Tip } from './entry'
import { pill } from './pills'
import text from './text'
import { fill, THEME } from './theme'

type Elements = {
  Box: (props: any) => RenderElement
  Client: (props: any) => RenderElement
  Text: (props: any) => RenderElement
  Link: (props: any) => RenderElement
  Button?: (props: any) => RenderElement
}

// The hover group of the welcome card's Open setup pill; the band shows that Button's tip while it is lit.
export const OPEN_SETUP_SCOPE = 'card-welcome-open-pill'

// The tip row and the pill row sit under the card in the band.
const BAND_ROWS = 2

// The card's own rows besides its body: the two border rows (the title sits in the top one) and the buttons.
const CHROME_ROWS = 3

// The release the card is about: the sorted name@version list, so a new version changes it and the card returns once.
export const signatureOf = (updates: CatalogMod[]) => updates.map(mod => `${mod.name}@${mod.version}`).sort().join(',')

// A control glyph without the brackets and padding it carries as a Button label.
const bare = (glyph: string) => glyph.replace(/[[\]\s]/g, '')

type ButtonSpec = { id: string; label: string; tip: Tip; icon?: string; isOpen?: boolean; isBusy?: boolean; spinner?: boolean }

// A card button is a pill around an entry Client, so it fades under the pointer and posts its tip to the band's tip row.
function button({ Box, Client, Text }: Elements, look: Look, still: boolean, spec: ButtonSpec) {
  const props = {
    id: spec.id,
    label: spec.label,
    isOpen: spec.isOpen ?? true,
    bg: THEME.surface3,
    color: THEME.onSurface,
    nerd: look.nerd,
    still,
    isBusy: spec.isBusy ?? false,
    tip: spec.tip,
    ...(spec.spinner ? { spinner: true, tight: true } : {}),
    ...(look.nerd && spec.icon && !spec.spinner ? { subLead: spec.icon, subLeadColor: THEME.accent } : {}),
  } satisfies EntryProps
  return pill({ Box, Text }, look.nerd, THEME.surface3, <Client key={spec.id} module="./entry.tsx" height={1} props={props} />, `${spec.id}-pill`, cardFill())
}

const buttonRow = (elements: Elements, key: string, buttons: ButtonSpec[], look: Look, still: boolean) => {
  const { Box } = elements
  return (
    <Box key={`${key}-buttons`} flexDirection="row" columnGap={1} justifyContent="flex-end">
      {buttons.map(spec => button(elements, look, still, spec))}
    </Box>
  )
}

// onOpen hands back its promise: the press counts as the person asking only until it settles.
export type WelcomeInput = { showFontTip: boolean; still: boolean; maxRows: number; onOpen: () => Promise<unknown> }

// First run: what the mods are for, a font tip when none was found, and two buttons that both clear the card.
export function welcomeCard(elements: Elements, look: Look, { showFontTip, still, maxRows, onOpen }: WelcomeInput) {
  const { Box, Button, Link, Text } = elements
  // The least needed line goes first when the band is short: the font tip, then the intro.
  const room = Math.max(0, maxRows - BAND_ROWS - CHROME_ROWS)
  const intro = room >= 1
  const tip = showFontTip && room >= 2
  const gear = bare(look.glyph.gear)
  // A Button, not an entry: in a narrow terminal Claude Code opens a pane only with a person's press behind it.
  const open = pill(
    { Box, Text },
    look.nerd,
    THEME.surface3,
    // Swapped on purpose: the engine inverts a Button under the pointer, which lands it as accent on surface-4.
    Button ? <Button key="card-welcome-open" label={look.nerd ? `${gear} ${text.cardOpenSetup}` : ` ${gear} ${text.cardOpenSetup} `} plain hover={{ scope: OPEN_SETUP_SCOPE, color: THEME.lifted, backgroundColor: THEME.accent }} onPress={onOpen} /> : null,
    OPEN_SETUP_SCOPE,
    cardFill(),
    THEME.lifted,
  )
  const skip: ButtonSpec = { id: 'card-welcome-skip', label: text.cardNotNow, tip: { glyph: bare(look.glyph.close), label: text.cardNotNow, text: text.tipCardWelcomeSkip } }
  return (
    <Box key="card-welcome-block" flexDirection="column">
      <Box key="card-welcome" flexDirection="column" paddingX={1} borderStyle="round" borderColor={THEME.border} backgroundColor={cardFill()}>
        {intro ? <Text key="card-welcome-intro" color={THEME.muted} wrap="wrap">{text.cardWelcomeBody}</Text> : null}
        {tip ? (
          <Text key="card-welcome-font" color={THEME.muted} wrap="wrap">
            {`${text.cardNerdTip} `}
            <Link href={text.nerdFontsUrl} label={text.cardNerdHow} />
          </Text>
        ) : null}
        <Box key="card-welcome-buttons" flexDirection="row" columnGap={1}>
          {open}
          {button(elements, look, still, skip)}
        </Box>
      </Box>
      {titleEdge(elements, look, 'card-welcome', 'welcome', text.cardWelcomeTitle, '', 0)}
    </Box>
  )
}

export type UpdatesInput = { updates: CatalogMod[]; shown: (name: string) => string; isWorking: boolean; isUpdating: boolean; still: boolean; maxRows: number }

// Updates: one row per lagging mod, and the two buttons. A short band keeps the first rows and counts the rest.
export function updatesCard(elements: Elements, look: Look, { updates, shown, isWorking, isUpdating, still, maxRows }: UpdatesInput) {
  const { Box, Text } = elements
  const arrow = look.glyph.icon.arrow ?? ''
  const room = Math.max(1, maxRows - BAND_ROWS - CHROME_ROWS)
  const isCut = updates.length > room
  const listed = isCut ? updates.slice(0, Math.max(1, room - 1)) : updates
  const width = Math.max(...updates.map(mod => shown(mod.name).length))
  const title = fill(updates.length === 1 ? text.cardUpdatesOne : text.cardUpdatesTitle, { n: updates.length })
  const label = fill(text.cardUpdateAction, { n: updates.length })
  const buttons: ButtonSpec[] = [
    {
      id: 'card-update-run',
      label: isUpdating ? text.cardUpdating : label,
      icon: bare(look.glyph.cycle),
      isOpen: !isWorking,
      isBusy: isUpdating,
      spinner: isUpdating,
      tip: { glyph: bare(look.glyph.cycle), label, text: text.tipCardUpdate },
    },
    { id: 'card-update-skip', label: text.cardNotNow, tip: { glyph: bare(look.glyph.close), label: text.cardNotNow, text: text.tipCardUpdateSkip } },
  ]
  return (
    <Box key="card-updates-block" flexDirection="column">
      <Box key="card-updates" flexDirection="column" paddingX={1} borderStyle="round" borderColor={THEME.border} backgroundColor={cardFill()}>
        {listed.map((mod, at) => (
          <Box key={`card-updates-row-${at}`} flexDirection="row">
            <Box key={`card-updates-row-${at}-name`} flexShrink={0}>
              <Text color={THEME.onSurface}>{`${shown(mod.name).padEnd(width)}  `}</Text>
            </Box>
            <Text color={THEME.muted} wrap="truncate-end">
              {fill(text.pickUpdateDetail, { from: mod.installedVersion, to: '', arrow })}
              <Text key={`card-updates-row-${at}-to`} color={THEME.accent}>{mod.version}</Text>
            </Text>
          </Box>
        ))}
        {isCut ? <Text key="card-updates-more" color={THEME.muted}>{fill(text.cardMore, { n: updates.length - listed.length })}</Text> : null}
        {buttonRow(elements, 'card-updates', buttons, look, still)}
      </Box>
      {titleEdge(elements, look, 'card-updates', 'updates', title, '', 0)}
    </Box>
  )
}

// mod-collision-guard / hooks/hold.tsx, by v-amorim
// The card above the prompt that holds an edit: who edited the file, the file as a link, and the ways out.
import type { RenderElement } from 'claude-code'

import { entryCells, type EntryProps } from './entry'
import { agoText, clockText, splitPath, vscodeHref } from './guard'
import { cardFill, sepText, subpill, titleEdge, type Look } from './look'
import style from './style'
import text from './text'
import { CAPS, fill as slot, MARK, THEME } from './theme'

type Part = (props: any) => RenderElement
export type Parts = { Box: Part; Button: Part; Client: Part; Input: Part; Link: Part; Text: Part }

export const GUARD = { cancel: 'guard-cancel', worktree: 'guard-worktree', proceed: 'guard-proceed', send: 'guard-reason-send', back: 'guard-reason-back', field: 'guard-reason' }

// isUnchecked: the check itself failed, so there is no other session to name.
export type HoldView = {
  path: string
  root?: string
  session: string
  name?: string
  prompt?: number
  at: number
  more: number
  isUnchecked: boolean
  canWorktree: boolean
  isAsking: boolean
  draft: string
}

const NAME_MAX = 24

// The VS Code mark a path link leads with in Nerd mode, local since style.ts is a shared copy (as in mod-transcript's linkPill).
const LINK_ICON = String.fromCodePoint(0xf0a1e)

// A clickable pill, the whole of it the link: caps on surface3 and the icon leading, or one padding cell each side without the font; the text underlined.
function linkPill({ Link, Text }: Pick<Parts, 'Link' | 'Text'>, href: string, label: { folder: string; name: string }, nerd: boolean, key: string) {
  return (
    <Link key={key} href={href}>
      {nerd ? <Text color={THEME.surface3}>{CAPS.left}</Text> : null}
      <Text backgroundColor={THEME.surface3}>
        {nerd ? <Text color={THEME.secondary}>{`${LINK_ICON} `}</Text> : ' '}
        {/* Dim text is measured only on bg and surface-1, so on the pill's surface-3 the quieter folder takes muted. */}
        {label.folder ? <Text color={THEME.muted} underline>{label.folder}</Text> : null}
        <Text color={THEME.secondary} underline>{label.name}</Text>
        {nerd ? '' : ' '}
      </Text>
      {nerd ? <Text color={THEME.surface3}>{CAPS.right}</Text> : null}
    </Link>
  )
}

// Rows the card takes, border included: head, file, the blank row and the actions (or the field and its hint).
const CARD_ROWS = 6
// The card keeps its blank row only where the band has room for it above the pill row.
const BLANK_FROM_ROWS = CARD_ROWS + 3

export function holdCard(
  { Box, Button, Client, Input, Link, Text }: Parts,
  look: Look,
  view: HoldView,
  { now, columns, maxRows, still }: { now: number; columns: number; maxRows: number; still: boolean },
  on: { key: (id: string) => unknown; input: (value: string) => unknown; submit: (value: string) => unknown },
) {
  const width = Math.max(20, columns - 4)
  const bg = cardFill()
  const name = view.name ?? view.session.slice(0, 8)
  const shownName = [...name].length > NAME_MAX ? `${[...name].slice(0, NAME_MAX - 1).join('')}…` : name

  const subject = view.isUnchecked ? (
    <Text key="guard-head" color={THEME.muted} wrap="truncate-end">{text.card.headUnchecked}</Text>
  ) : (
    <Box key="guard-head" flexDirection="row" columnGap={1}>
      <Box key="guard-head-left" flexDirection="row" columnGap={1} flexShrink={1}>
        <Box key="guard-head-label" flexShrink={1}><Text color={THEME.muted} wrap="truncate-end">{text.card.head}</Text></Box>
        <Box key="guard-head-name" flexShrink={0}><Text color={THEME.onSurface} bold>{shownName}</Text></Box>
        {view.prompt === undefined ? null : subpill({ Box, Text }, look.nerd, bg, slot(text.card.prompt, { n: view.prompt }), 'guard-head-prompt')}
        {view.more > 0 ? <Box key="guard-head-more" flexShrink={0}><Text color={THEME.muted}>{view.more === 1 ? text.card.moreOne : slot(text.card.moreMany, { n: view.more })}</Text></Box> : null}
      </Box>
      <Box key="guard-head-when" flexGrow={1} flexShrink={0} justifyContent="flex-end">
        {sepText({ Text }, slot(text.card.when, { ago: agoText(now - view.at), clock: clockText(view.at) }), THEME.muted, 'guard-when')}
      </Box>
    </Box>
  )

  const file = (
    <Box key="guard-file" flexDirection="row">
      {linkPill({ Link, Text }, vscodeHref(view.path), splitPath(view.path, view.root, width - 4), look.nerd, 'guard-file-link')}
    </Box>
  )

  // The digit chip and its label in one entry; a Button nobody sees carries the digit, since only a Button takes a hotkey and a visible one inverts under the pointer.
  const choice = (id: string, label: string, digit: string, tipBody: string) => {
    const props = { id, label, isOpen: false, bg, subLead: digit, subLeadColor: THEME.onSurface, idle: THEME.muted, still, nerd: look.nerd, tip: { glyph: digit, label, text: tipBody } } satisfies EntryProps
    return (
      <Box key={`${id}-pad`} flexDirection="row">
        <Client key={id} module="./entry.tsx" width={entryCells(props)} height={1} props={props} />
        <Box key={`${id}-key`} width={0} height={0} overflow="hidden">
          <Button key={`${id}-hotkey`} label={label} hotkey={digit} plain onPress={() => on.key(id)} />
        </Box>
      </Box>
    )
  }
  const choices = [
    { id: GUARD.cancel, label: text.choiceCancel, tip: text.tips.cancel },
    ...(view.canWorktree && !view.isUnchecked ? [{ id: GUARD.worktree, label: text.choiceWorktree, tip: text.tips.worktree }] : []),
    { id: GUARD.proceed, label: text.choiceProceed, tip: view.isUnchecked ? text.tips.proceedUnchecked : text.tips.proceed },
  ]
  const actions = (
    <Box key="guard-actions" flexDirection="row" columnGap={3}>
      {choices.map((each, at) => choice(each.id, each.label, String(at + 1), each.tip))}
    </Box>
  )

  const hint = (id: string, key: string, label: string, tipBody: string) => {
    const props = { id, label, isOpen: false, bg, subLead: key, subLeadColor: THEME.onSurface, idle: THEME.muted, still, nerd: look.nerd, tip: { glyph: key, label, text: tipBody } } satisfies EntryProps
    return <Client key={id} module="./entry.tsx" width={entryCells(props)} height={1} props={props} />
  }
  const isEmpty = view.draft.trim() === ''
  const sendLabel = isEmpty ? text.reason.skip : text.reason.send
  const reasonRows = (
    <Box key="guard-reason-rows" flexDirection="column">
      <Box key="guard-reason-field" backgroundColor={THEME.surface3} paddingX={1}>
        <Input key={GUARD.field} placeholder={text.reason.placeholder} value={view.draft} submitLabel={sendLabel} autoFocus onInput={on.input} onSubmit={on.submit} />
      </Box>
      <Box key="guard-reason-hint" flexDirection="row" columnGap={1}>
        {hint(GUARD.send, text.reason.enter, sendLabel, isEmpty ? text.tips.reasonSkip : text.tips.reasonSend)}
        <Text key="guard-reason-sep" color={style.colors.pills.separator}>{MARK.sep}</Text>
        {hint(GUARD.back, text.reason.esc, text.reason.back, text.tips.reasonBack)}
      </Box>
    </Box>
  )

  return (
    <Box key="guard-card" flexDirection="column">
      <Box key="guard-card-box" flexDirection="column" borderStyle="round" borderColor={THEME.border} backgroundColor={bg} paddingX={1}>
        {subject}
        {file}
        {view.isAsking ? reasonRows : null}
        {!view.isAsking && maxRows >= BLANK_FROM_ROWS ? <Box key="guard-blank" height={1} /> : null}
        {view.isAsking ? null : actions}
      </Box>
      {titleEdge({ Box, Text }, look, 'guard-card', '', text.card.title, text.card.titleHint, 0, THEME.border)}
    </Box>
  )
}

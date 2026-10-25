// mod-collision-guard / tests/previews.test.tsx, by v-amorim
import { test } from 'claude-code/testing'

import text from '../hooks/text'
import { fill } from '../hooks/theme'
import { expectPreview, written } from './previews-kit'
import { snapshot } from './previews.snapshot'

// The card's head, file and action rows, worded from the mod's strings.
const card = () =>
  written(
    [{ text: `${text.card.head} `, color: 'muted' }, { text: 'hook-guard', color: 'onSurface', bold: true }, { text: ` ${fill(text.card.prompt, { n: 12 })}`, color: 'accent' }],
    [{ text: 'hooks/a.ts', color: 'secondary' }],
    [{ text: [text.choiceCancel, text.choiceWorktree, text.choiceProceed].map((choice, at) => `${at + 1} ${choice}`).join('   '), color: 'muted' }],
  )

for (const mode of ['nerd', 'safe'] as const) {
  test(`enabled=true example is the card's own wording (${mode})`, { options: { icons: mode } }, async () => {
    expectPreview(snapshot, 'enabled', 'true', mode, card())
  })

  test(`enabled=false example is its written line (${mode})`, { options: { icons: mode } }, async () => {
    expectPreview(snapshot, 'enabled', 'false', mode, written([{ text: 'Edits run without a question; they are still recorded.', color: 'muted' }]))
  })
}

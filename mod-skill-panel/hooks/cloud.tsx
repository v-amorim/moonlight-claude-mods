// mod-skill-panel / hooks/cloud.tsx, by v-amorim
// Lays out and draws the tag cloud of skill chips with hover and click.
import type { ClientModule, RenderChildren } from 'claude-code'

import { HOVER_STEPS, HOVER_TICK_MS, hoverMix, mix, postTip, stepToward } from './entry'
import { subpill } from './look'
import { TAG_WASH } from './tags'
import { CAPS, THEME } from './theme'

export type CloudGroup = { tag: string; label: string; icon: string; hex: string; tip: string; skills: { index: number; name: string; tip: string }[] }

// still: the animations setting is off, so a hover switches at once.
export type CloudProps = { groups: CloudGroup[]; width: number; selected: number; nerd: boolean; still?: boolean }

// Pointing at a chip is a tip message with id `chip:<index>` (one post per frame lands, so no separate hover); a click posts `add`.
export type CloudMessage = { type: 'add'; index: number }

type Placed = { x: number; width: number; index: number; name: string; tip: string }

// Cells a pill takes around its text: both caps in Nerd mode, a space each side in safe mode.
const ENDS = 2

// A tag's icon as a subpill: its cap, the icon and its cap, or the icon padded by a space each side.
const ICON_CELLS = 3

// The pointer's target: a chip is its index, a tag pill is -2 minus its group, nothing is -1.
const tagTarget = (group: number) => -2 - group

// The tag pill column, then each group's skills as chips that wrap under it to the next row; a faint rule between groups.
export function layoutCloud(groups: CloudGroup[], width: number) {
  const lead = Math.max(0, ...groups.map(group => ENDS + ICON_CELLS + 1 + group.label.length)) + 1
  const rows: { group: number; chips: Placed[]; isRule?: boolean }[] = []
  groups.forEach((group, at) => {
    if (at > 0) rows.push({ group: -1, chips: [], isRule: true })
    let row = { group: at, chips: [] as Placed[] }
    rows.push(row)
    let x = lead
    for (const skill of group.skills) {
      const chip = ENDS + 2 + skill.name.length
      if (row.chips.length > 0 && x + chip > width) {
        row = { group: -1, chips: [] }
        rows.push(row)
        x = lead
      }
      row.chips.push({ x, width: chip, index: skill.index, name: skill.name, tip: skill.tip })
      x += chip + 1
    }
  })
  return { lead, rows }
}

// levels: each target's hover fade, kept only while above 0.
type State = { hovered: number; levels: Record<number, number> }

const fadeLevels = (levels: Record<number, number>, hovered: number) => {
  const next: Record<number, number> = {}
  for (const target of new Set([...Object.keys(levels).map(Number), hovered])) {
    const level = stepToward(levels[target] ?? 0, target === hovered)
    if (target !== -1 && level > 0) next[target] = level
  }
  return next
}

const isFading = (levels: Record<number, number>, hovered: number) => Object.entries(levels).some(([target, level]) => level !== (Number(target) === hovered ? HOVER_STEPS : 0)) || (hovered !== -1 && !levels[hovered])

// Each cloud's fade timer runs only while a hover is moving: an idle cloud ticking costs a wakeup.
const fades = new WeakMap<object, () => void>()

// Every skill as a chip under its tag: the pointer on one lights it as a lifted chip with accent text and shows it in the panel's card; a click adds it to the prompt.
const Cloud: ClientModule<CloudProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const { groups, width, selected, nerd, still } = props
  const { lead, rows } = layoutCloud(groups, width)
  // A Client takes no hover prop, so it tracks the target under the pointer itself.
  const hovered = surface.state?.hovered ?? -1
  const levels = surface.state?.levels ?? {}

  surface.onPointer(event => {
    if (!still && !fades.has(surface)) {
      const stop = surface.every(HOVER_TICK_MS, () => {
        const { state } = surface
        if (state && isFading(state.levels, state.hovered)) {
          surface.setState({ ...state, levels: fadeLevels(state.levels, state.hovered) })
          return
        }
        stop()
        fades.delete(surface)
      })
      fades.set(surface, stop)
    }
    const row = event.type === 'leave' ? undefined : rows[event.y]
    const chip = row?.chips.find(each => event.x >= each.x && event.x < each.x + each.width)
    const tag = row && row.group >= 0 && event.x < lead - 1 ? row.group : -1
    const target = chip ? chip.index : tag >= 0 ? tagTarget(tag) : -1
    const isClick = event.type === 'down' && event.button === 'left' && chip !== undefined
    if (target !== hovered) {
      surface.setState({ hovered: target, levels: still ? (target === -1 ? {} : { [target]: HOVER_STEPS }) : fadeLevels(levels, target) })
      const group = chip ? groups.find(each => each.skills.some(skill => skill.index === chip.index)) : tag >= 0 ? groups[tag] : undefined
      if (!isClick) postTip(surface, chip ? `chip:${chip.index}` : tag >= 0 ? `tag:${tag}` : 'chip', group ? { glyph: group.icon, label: chip ? chip.name : group.label, text: chip ? chip.tip : group.tip } : null)
    }
    if (isClick) surface.post({ type: 'add', index: chip.index } satisfies CloudMessage)
  })

  const pill = (key: string, fill: string, body: RenderChildren) => (
    <Box key={key} flexDirection="row" flexShrink={0}>
      <Text key={`${key}-left`} color={fill} {...(nerd ? {} : { backgroundColor: fill })}>{nerd ? CAPS.left : ' '}</Text>
      <Box key={`${key}-body`} flexDirection="row" backgroundColor={fill}>{body}</Box>
      <Text key={`${key}-right`} color={fill} {...(nerd ? {} : { backgroundColor: fill })}>{nerd ? CAPS.right : ' '}</Text>
    </Box>
  )

  return (
    <Box flexDirection="column">
      {rows.map((row, at) => {
        if (row.isRule) return <Text key={`row-${at}`} color={THEME.border}>{'─'.repeat(width)}</Text>
        const group = groups[row.group]
        const tagLevel = levels[tagTarget(row.group)] ?? 0
        const tagFill = group ? hoverMix(mix(group.hex, THEME.surface1, TAG_WASH), THEME.lifted, tagLevel) : THEME.surface1
        return (
          <Box key={`row-${at}`} flexDirection="row">
            <Box key={`row-${at}-lead`} width={lead} flexShrink={0}>
              {group
                ? pill(`tag-${at}`, tagFill, (
                    <Box key={`tag-${at}-label`} flexDirection="row">
                      {subpill({ Box, Text }, nerd, tagFill, group.icon, `tag-${at}-icon`, group.hex)}
                      <Text color={hoverMix(group.hex, THEME.accent, tagLevel)}>{` ${group.label}`}</Text>
                    </Box>
                  ))
                : null}
            </Box>
            <Box key={`row-${at}-chips`} flexDirection="row" columnGap={1}>
              {row.chips.map(chip => {
                const level = levels[chip.index] ?? 0
                const isSelected = chip.index === selected
                const hex = groups.find(each => each.skills.some(skill => skill.index === chip.index))?.hex ?? THEME.muted
                // Hover lifts the chip and turns its name accent; the selected chip keeps its name accent and bold without the lift.
                const name = hoverMix(isSelected ? THEME.accent : THEME.secondary, THEME.accent, level)
                return pill(`chip-${chip.index}`, hoverMix(THEME.surface3, THEME.lifted, level), (
                  <Text key={`chip-${chip.index}-text`}>
                    <Text color={hex}>{'● '}</Text>
                    <Text color={name} bold={isSelected}>{chip.name}</Text>
                  </Text>
                ))
              })}
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}

export default Cloud

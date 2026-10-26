// mod-file-tree / hooks/list.tsx, by v-amorim
// Draws the file tree rows with indent guides, icons and tone colors for Claude's activity.
import type { ClientModule, RenderElement } from 'claude-code'

import { HOVER_STEPS, HOVER_TICK_MS, hoverMix, mix, postTip, shimmerColor, SPIN_FRAMES, SPIN_MS, stepToward, TICK_MS } from './entry'
import { cardFill } from './look'
import { CAPS, THEME } from './theme'

// live: Claude is on this file right now; added, changed and read set the name's color.
export type Tone = 'live' | 'added' | 'changed' | 'read' | 'dir'

export type Row = {
  // Indent guides, one `│ ` per level above the row.
  guides: string
  // A folder's chevron.
  lead?: string
  // The folder or file-type icon, drawn in markColor.
  mark: string
  markColor?: string
  name: string
  tone: Tone
  add: number
  del: number
  // The status letter (A, M, R), or the action word while Claude is on the file.
  status: string
  // Spaces that push the counts and the status to the pane's right edge.
  pad: number
  // When this file's latest edit landed, so the row glows and fades back.
  changedAt?: number
  // The mark the row ends in: a file's opens it in VS Code or the default app, a folder's opens it in the file manager.
  endMark: string
  // The open mark's color: a folder's differs from a file's arrow.
  endColor: string
  // What the footer says while the pointer is on the row text, and on the end mark.
  tip: string
  tipLabel: string
  openTip: string
}

// offset is the first row's index in the whole tree: a long tree draws as several lists.
// still: the animations setting is off: no shimmer, no glow, and the hover switches at once.
// nerd: the font has the rounded caps the live word's pill uses. width: every row's cells, the open mark in the last.
export type ListProps = { rows: Row[]; offset?: number; still?: boolean; nerd?: boolean; width: number; glyph: string; openLabel: string }

export type ListMessage = { type: 'select' | 'open'; index: number }

// The space, then the open mark's pill: caps around it on Nerd, a space each side on safe.
export const OPEN_CELLS = 4

// A file's name carries its status as color, named once in the pane's legend instead of a letter on every row.
export const NAME_COLOR: Record<Tone, string> = { live: THEME.onSurface, added: THEME.good, changed: THEME.warn, read: THEME.secondary, dir: THEME.onSurface }

// Lines added and removed in one pill; plain colored text where the font has no caps.
const countsPill = (Text: (props: any) => RenderElement, add: number, del: number, nerd: boolean) => {
  const parts = [add > 0 ? <Text key="add" color={THEME.good} backgroundColor={nerd ? THEME.surface3 : undefined}>{`+${add}`}</Text> : null, del > 0 ? <Text key="del" color={THEME.alert} backgroundColor={nerd ? THEME.surface3 : undefined}>{`${add > 0 ? ' ' : ''}−${del}`}</Text> : null]
  if (!nerd) return parts
  return [<Text key="counts-left" color={THEME.surface3}>{CAPS.left}</Text>, ...parts, <Text key="counts-right" color={THEME.surface3}>{CAPS.right}</Text>]
}

// levels: each row's hover fade, marks: the open mark's, kept only while above 0.
type State = { hovered: number; phase: number; spin?: number; levels: Record<number, number>; marks?: Record<number, number>; onMark?: boolean }

// Moonlight surface-3: the row Claude is on stands out from the tree's surface-1 as a band.
const LIVE_BG = THEME.surface3

// The live word's pill: rounded caps where the font has them, a space on each side elsewhere.
const LIVE_PILL = THEME.border

const livePill = (Text: (props: any) => RenderElement, word: string, nerd: boolean) => [
  <Text key="live-cap-left" color={LIVE_PILL}>{nerd ? CAPS.left : ' '}</Text>,
  <Text key="live-word" color={THEME.pill} backgroundColor={LIVE_PILL}>{word}</Text>,
  <Text key="live-cap-right" color={LIVE_PILL}>{nerd ? CAPS.right : ' '}</Text>,
]

// A Client draws Text only, so the open mark's pill draws its caps itself; OPEN_CELLS counts these cells.
// level lights it like a Button pill: the body goes accent, the glyph takes the body's old color, the caps follow the body.
const openPill = (Text: (props: any) => RenderElement, glyph: string, color: string, nerd: boolean, level: number) => {
  const body = hoverMix(THEME.surface3, THEME.accent, level)
  const ink = hoverMix(color, THEME.surface3, level)
  return nerd
    ? [
        <Text key="open-gap">{' '}</Text>,
        <Text key="open-cap-left" color={body}>{CAPS.left}</Text>,
        <Text key="open" color={ink} backgroundColor={body}>{glyph}</Text>,
        <Text key="open-cap-right" color={body}>{CAPS.right}</Text>,
      ]
    : [<Text key="open-gap">{' '}</Text>, <Text key="open" color={ink} backgroundColor={body}>{` ${glyph} `}</Text>]
}

// A file whose edit just landed starts in the live band's colors and fades to its own over this long.
const GLOW_MS = 2500

const glowOf = (row: Row, now: number) => (row.changedAt && now - row.changedAt < GLOW_MS ? 1 - (now - row.changedAt) / GLOW_MS : 0)

const fadeLevels = (levels: Record<number, number>, hovered: number) => {
  const next: Record<number, number> = {}
  for (const row of new Set([...Object.keys(levels).map(Number), hovered])) {
    const level = stepToward(levels[row] ?? 0, row === hovered)
    if (row >= 0 && level > 0) next[row] = level
  }
  return next
}

const isFading = (levels: Record<number, number>, hovered: number) =>
  Object.entries(levels).some(([row, level]) => level !== (Number(row) === hovered ? HOVER_STEPS : 0)) || (hovered >= 0 && !levels[hovered])

// The tickers read the latest rows from here, since their closures keep the first ones.
const latest = new WeakMap<object, ListProps>()

// Each list's two timers run only while there is something to move, a live or glowing row or a fading hover: idle lists ticking cost a wakeup each.
const timers = new WeakMap<object, Partial<Record<'move' | 'fade' | 'spin', () => void>>>()

const run = (surface: Parameters<ClientModule<ListProps, State>>[1], kind: 'move' | 'fade' | 'spin', ms: number, step: () => boolean) => {
  const own = timers.get(surface) ?? {}
  if (own[kind]) return
  const stop = surface.every(ms, () => {
    if (step()) return
    stop()
    delete own[kind]
  })
  own[kind] = stop
  timers.set(surface, own)
}

// A glow keeps the ticker one step past its end, so the row's last frame is its own colors.
const isMoving = (rows: ListProps['rows']) => {
  const now = Date.now()
  return rows.some(row => row.tone === 'live' || (row.changedAt !== undefined && now - row.changedAt < GLOW_MS + TICK_MS * 2))
}

// The tree rows; a click anywhere on a row selects it, the row under the pointer lights up, and the file Claude is on shimmers.
const FileList: ClientModule<ListProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const { rows } = props
  latest.set(surface, props)

  // A Client takes no hover prop, so it tracks the row under the pointer itself.
  const hovered = surface.state?.hovered ?? -1
  const phase = surface.state?.phase ?? 0
  const levels = surface.state?.levels ?? {}
  const marks = surface.state?.marks ?? {}

  if (!surface.state) surface.setState({ hovered: -1, phase: 0, levels: {} })
  if (!props.still && isMoving(rows)) {
    run(surface, 'move', TICK_MS, () => {
      const { state } = surface
      if (!state || latest.get(surface)?.still || !isMoving(latest.get(surface)?.rows ?? [])) return false
      surface.setState({ ...state, phase: state.phase + 1 })
      return true
    })
  }
  // The spinner beside the live word keeps its own 80 ms clock, apart from the shimmer's.
  const hasLive = (list: ListProps['rows']) => list.some(row => row.tone === 'live')
  if (!props.still && hasLive(rows)) {
    run(surface, 'spin', SPIN_MS, () => {
      const { state } = surface
      if (!state || latest.get(surface)?.still || !hasLive(latest.get(surface)?.rows ?? [])) return false
      surface.setState({ ...state, spin: (state.spin ?? 0) + 1 })
      return true
    })
  }

  surface.onPointer(event => {
    // The hover fade runs on its own, faster timer.
    if (!props.still) {
      run(surface, 'fade', HOVER_TICK_MS, () => {
        const { state } = surface
        if (!state || latest.get(surface)?.still) return false
        const markRow = state.onMark ? state.hovered : -1
        if (!isFading(state.levels ?? {}, state.hovered) && !isFading(state.marks ?? {}, markRow)) return false
        surface.setState({ ...state, levels: fadeLevels(state.levels ?? {}, state.hovered), marks: fadeLevels(state.marks ?? {}, markRow) })
        return true
      })
    }
    const row = event.type !== 'leave' && event.y >= 0 && event.y < rows.length ? event.y : -1
    const next = props.still ? (row >= 0 ? { [row]: HOVER_STEPS } : {}) : fadeLevels(levels, row)
    const isOpenMark = row >= 0 && rows[row]!.endMark !== '' && event.x >= props.width - OPEN_CELLS
    const isClick = event.type === 'down' && event.button === 'left' && row >= 0
    if (row !== hovered || isOpenMark !== (surface.state?.onMark === true)) {
      const nextMarks = props.still ? (isOpenMark ? { [row]: HOVER_STEPS } : {}) : fadeLevels(marks, isOpenMark ? row : -1)
      surface.setState({ hovered: row, phase, levels: row !== hovered ? next : levels, marks: nextMarks, onMark: isOpenMark })
      if (!isClick) postTip(surface, 'row', row >= 0 ? { glyph: props.glyph, label: isOpenMark ? props.openLabel : rows[row]!.tipLabel, text: isOpenMark ? rows[row]!.openTip : rows[row]!.tip } : null)
    }
    if (!isClick) return
    surface.post({ type: isOpenMark ? 'open' : 'select', index: (props.offset ?? 0) + row } satisfies ListMessage)
  })

  return (
    <Box flexDirection="column">
      {rows.map((row, index) => {
        const isLive = row.tone === 'live'
        const glow = props.still ? 0 : glowOf(row, Date.now())
        const restColor = mix(NAME_COLOR[row.tone], THEME.pill, glow)
        const nameColor = hoverMix(restColor, THEME.accent, levels[index] ?? 0)
        const rest = isLive ? LIVE_BG : glow > 0 ? mix(cardFill(), LIVE_BG, glow) : undefined
        const lift = levels[index] ?? 0
        const background = lift > 0 ? hoverMix(rest ?? cardFill(), THEME.lifted, lift) : rest
        return (
          <Box key={`row-${index}`} flexDirection="row" backgroundColor={background}>
            <Text color={THEME.border}>{row.guides}</Text>
            {row.lead ? <Text color={isLive ? THEME.accent : THEME.muted}>{`${row.lead} `}</Text> : null}
            {row.mark ? <Text color={row.markColor ?? THEME.muted}>{`${row.mark} `}</Text> : null}
            {isLive && !props.still ? (
              [...row.name].map((char, at) => (
                <Text key={`c${at}`} color={shimmerColor(at, phase, row.name.length)} bold>
                  {char}
                </Text>
              ))
            ) : (
              <Text color={nameColor}>{row.name}</Text>
            )}
            <Text>{' '.repeat(Math.max(1, row.pad))}</Text>
            {/* The live word sits left of the counts, so the counts keep one right edge whether a row is live or not. */}
            {/* It never shrinks: a row a cell too wide takes the cell from the gap, not from the word. */}
            {isLive && row.status ? <Box key="live" flexDirection="row" flexShrink={0}>{livePill(Text, row.status, props.nerd === true)}<Text key="live-spin" color={THEME.accent}>{` ${SPIN_FRAMES[props.still ? 0 : (surface.state?.spin ?? 0) % SPIN_FRAMES.length]}`}</Text></Box> : null}
            {isLive && row.status && (row.add > 0 || row.del > 0) ? <Text> </Text> : null}
            {row.add > 0 || row.del > 0 ? countsPill(Text, row.add, row.del, props.nerd === true) : null}
            {row.endMark ? openPill(Text, row.endMark, row.endColor, props.nerd === true, marks[index] ?? 0) : null}
          </Box>
        )
      })}
    </Box>
  )
}

export default FileList

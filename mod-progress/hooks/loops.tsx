// mod-progress / hooks/loops.tsx, by v-amorim
// The pane's list: a card per loop, two rows each, its gates under it when clicked.
import type { ClientModule, RenderChildren } from 'claude-code'

import { postTip } from './entry'
import { cardFill, lookFor } from './look'
import marks from './marks'
import { countGates, cutText, formatElapsed, gaugeColor, formatTokens, groupGates, modelInfo, stripCells, type Gate, type GateState, type Row } from './progress'
import style from './style'
import text from './text'
import { CAPS, decodeAll, fill, MARK, THEME } from './theme'

export type LoopsProps = { rows: Row[]; width: number; expanded: string; nerd: boolean; viewing: string; folded?: string[]; now?: number }

const GROUPS: Record<GateState, { label: string; color: string }> = {
  open: { label: text.groupOpen, color: THEME.accent },
  pending: { label: text.groupWaiting, color: THEME.warn },
  met: { label: text.groupMet, color: THEME.ok },
  abandoned: { label: text.groupDropped, color: THEME.alert },
}
export type LoopsMessage = { type: 'toggle'; id: string } | { type: 'task'; id: string } | { type: 'fold'; id: string }

// The count a folded card shows, and the toggle's label on an open one: shells when every task is one.
export const tasksLabel = (tasks: Row['tasks']) => {
  const isShells = tasks.every(task => task.kind === 'shell')
  const n = tasks.length
  return n === 1 ? (isShells ? text.shellOne : text.taskOne) : fill(isShells ? text.shellMany : text.taskMany, { n })
}

// The tip of a card's task toggle.
export const foldTip = (row: Row, isFolded: boolean, glyph: string) => ({ glyph, label: tasksLabel(row.tasks), text: isFolded ? text.tipFoldShut : text.tipFoldOpen })

type Line = { kind: 'head' | 'pills' | 'task' | 'gate' | 'ghead' | 'gfold' | 'empty' | 'gap' | 'run'; loop: number; group?: number; gate?: number; task?: number; run?: string }

// The rows top to bottom: a line naming the workflow run where its agents start, then head, pills, a line per background task, the open loop's gate groups (a header each, a row per open or waiting gate, one line for met or dropped), and a gap before the next card.
export function layoutLoops(rows: Row[], expanded: string, folded: string[] = []) {
  const lines: Line[] = []
  rows.forEach((row, loop) => {
    if (row.run && row.run !== rows[loop - 1]?.run) lines.push({ kind: 'run', loop: -1, run: row.run })
    lines.push({ kind: 'head', loop }, { kind: 'pills', loop })
    if (!folded.includes(row.id)) row.tasks.forEach((_, task) => lines.push({ kind: 'task', loop, task }))
    if (row.id === expanded) {
      if (row.gates.length === 0) lines.push({ kind: 'empty', loop })
      groupGates(row.gates).forEach((group, at) => {
        lines.push({ kind: 'ghead', loop, group: at })
        if (group.state === 'met' || group.state === 'abandoned') lines.push({ kind: 'gfold', loop, group: at })
        else group.gates.forEach((_, gate) => lines.push({ kind: 'gate', loop, group: at, gate }))
      })
    }
    if (loop < rows.length - 1) lines.push({ kind: 'gap', loop: -1 })
  })
  return lines
}

const LEVELS = style.levels as Record<string, { glyph: string; color: string }>

// @ts-expect-error Row holds undefined fields, which the host's JsonValue props type refuses.
const Loops: ClientModule<LoopsProps, number> = (props, surface) => {
  const { Box, Text } = surface.elements
  const { rows, width, expanded, nerd, viewing } = props
  const folded = props.folded ?? []
  const look = lookFor(nerd)
  const own = decodeAll(marks.glyphs)[nerd ? 'nerd' : 'safe']
  const lines = layoutLoops(rows, expanded, folded)
  // The state is the line under the pointer, times two, plus one over a card's task toggle: a task line is its own target, any other line stands for its card.
  const hoveredAt = surface.state !== undefined && surface.state >= 0 ? Math.floor(surface.state / 2) : -1
  const isFoldHover = surface.state !== undefined && surface.state >= 0 && surface.state % 2 === 1
  const taskOf = (at: number) => {
    const line = lines[at]
    return line?.kind === 'task' ? rows[line.loop]?.tasks[line.task!] : undefined
  }
  const foldText = (row: Row) => `${folded.includes(row.id) ? look.glyph.collapsed : look.glyph.expanded} ${tasksLabel(row.tasks)} `
  // The toggle sits at the right end of the card's second row, when the card has background tasks.
  const isFoldAt = (at: number, x: number) => {
    const line = lines[at]
    const row = line?.kind === 'pills' ? rows[line.loop] : undefined
    return row !== undefined && row.tasks.length > 0 && x >= width - [...foldText(row)].length
  }
  const targetOf = (at: number, isFold: boolean) => (taskOf(at) ? `task:${taskOf(at)!.id}` : `${isFold ? 'fold' : 'loop'}:${lines[at]?.loop ?? -1}`)

  surface.onPointer(event => {
    const at = event.type === 'leave' || (lines[event.y]?.loop ?? -1) < 0 ? -1 : event.y
    const isFold = at >= 0 && isFoldAt(at, event.x)
    const next = at < 0 ? -1 : at * 2 + (isFold ? 1 : 0)
    if (next !== (surface.state ?? -1)) {
      surface.setState(next)
      if (targetOf(at, isFold) !== targetOf(hoveredAt, isFoldHover)) {
        const task = taskOf(at)
        const row = rows[lines[at]?.loop ?? -1]
        postTip(surface, 'loops', task ? { glyph: task.kind === 'shell' ? look.glyph.icon.Bash ?? look.glyph.expanded : look.glyph.expanded, label: task.kind === 'shell' ? text.taskShell : text.taskMonitor, text: text.tipTask } : row && isFold ? foldTip(row, folded.includes(row.id), folded.includes(row.id) ? look.glyph.collapsed : look.glyph.expanded) : row ? { glyph: row.id === expanded ? look.glyph.expanded : look.glyph.collapsed, label: row.name, text: text.tipLoop } : null)
      }
    }
    if (event.type !== 'down' || event.button !== 'left' || at < 0) return
    const task = taskOf(at)
    if (task) surface.post({ type: 'task', id: task.id } satisfies LoopsMessage)
    else if (isFold) surface.post({ type: 'fold', id: rows[lines[at]!.loop]!.id } satisfies LoopsMessage)
    else surface.post({ type: 'toggle', id: rows[lines[at]!.loop]!.id } satisfies LoopsMessage)
  })

  // A pill on the card: rounded caps on Nerd, a space each side on safe.
  const pill = (key: string, on: string, body: RenderChildren) => (
    <Box key={key} flexDirection="row" flexShrink={0}>
      <Text key={`${key}-left`} color={THEME.surface3} backgroundColor={on}>{nerd ? CAPS.left : ' '}</Text>
      <Box key={`${key}-body`} flexDirection="row" backgroundColor={THEME.surface3}>{body}</Box>
      <Text key={`${key}-right`} color={THEME.surface3} backgroundColor={on}>{nerd ? CAPS.right : ' '}</Text>
    </Box>
  )

  const drawLine = (line: Line, at: number) => {
    const key = `line-${at}`
    if (line.kind === 'gap') return <Box key={key} height={1} />
    if (line.kind === 'run') {
      const members = rows.filter(each => each.run === line.run)
      const label = fill(text.workflowRun, { id: line.run!.replace(/^wf_/, '').slice(0, 6), sep: MARK.sep, done: members.filter(each => each.status !== 'running').length, total: members.length })
      return <Box key={key} height={1} width={width} paddingLeft={1}><Text wrap="truncate-end" color={THEME.secondary} bold>{label}</Text></Box>
    }
    const row = rows[line.loop]!
    const isHover = line.kind === 'task' ? hoveredAt === at : lines[hoveredAt]?.kind !== 'task' && (lines[hoveredAt]?.loop ?? -1) === line.loop
    const on = isHover ? THEME.lifted : cardFill()
    const isViewed = line.kind === 'head' && row.id === viewing
    const frame = (inner: RenderChildren) => (
      <Box key={key} height={1} width={width} flexDirection="row" backgroundColor={on}>
        <Text key={`${key}-lead`}>{' '}</Text>
        <Text key={`${key}-pad`} color={THEME.accent} bold>{isViewed ? MARK.cursor : ' '}</Text>
        {inner}
      </Box>
    )

    if (line.kind === 'head') {
      const mark = row.status === 'running' ? { glyph: own.running, color: THEME.accent } : row.status === 'done' ? { glyph: look.glyph.ok, color: THEME.ok } : { glyph: look.glyph.warn, color: THEME.alert }
      const right = fill(text.tokensTime, { tokens: formatTokens(row.tokens), sep: MARK.sep, time: row.elapsed || '0s' })
      return frame(
        <Box key={`${key}-body`} flexDirection="row" flexGrow={1} columnGap={1}>
          <Text key={`${key}-mark`} color={mark.color}>{mark.glyph}</Text>
          <Box key={`${key}-name`} flexGrow={1} flexShrink={1}>
            <Text wrap="truncate-end">
              <Text color={row.hue}>{`${own.agentDot} `}</Text>
              <Text color={isHover || isViewed ? THEME.accent : THEME.onSurface} bold>{row.name}</Text>
              <Text color={THEME.muted}>{row.description ? ` ${row.description}` : ''}</Text>
            </Text>
          </Box>
          <Box key={`${key}-right`} flexShrink={0}>
            <Text color={THEME.muted}>{`${right} `}</Text>
          </Box>
        </Box>,
      )
    }

    if (line.kind === 'pills') {
      const info = modelInfo(row.model)
      const level = row.effort ? LEVELS[row.effort] : undefined
      const gates = countGates(row.gates)
      const gauge = row.percent === undefined ? 0 : Math.round((row.percent / 100) * marks.gaugeCells)
      const countText = ` ${fill(text.gatesCount, { done: gates.done, total: gates.total })}${row.isPhaseDone ? ` ${MARK.sep} ${text.phaseDone}` : ''}`
      const before = [row.model ? 2 + [...info.name].length + (level ? 2 : 0) : 0, row.percent === undefined ? 0 : 2 + 3 + marks.gaugeCells + fill(text.gaugePercent, { percent: row.percent }).length].filter(cols => cols > 0)
      // The card's lead and padding, the pills before this one with their gaps, this pill's caps and count, the fold toggle, and a column of slack.
      const room = width - 4 - before.reduce((sum, cols) => sum + cols + 1, 0) - 2 - [...countText].length - (row.tasks.length > 0 ? [...foldText(row)].length : 0) - 1
      const cellOf = (state: GateState) => (state === 'abandoned' ? { glyph: own.gateDropped, color: THEME.alert } : state === 'open' ? { glyph: own.gateOpen, color: THEME.muted } : { glyph: own.gateMet, color: state === 'met' ? THEME.ok : THEME.warn })
      const isFoldOver = isHover && isFoldHover
      return frame(
        <Box key={`${key}-row`} flexDirection="row" flexGrow={1}>
        <Box key={`${key}-body`} flexDirection="row" columnGap={1} paddingLeft={2}>
          {row.model ? pill(`${key}-model`, on, (
            <Text color={info.hue} bold>
              {info.name}
              {level ? <Text color={level.color}>{` ${level.glyph}`}</Text> : null}
            </Text>
          )) : null}
          {row.percent === undefined ? null : pill(`${key}-gauge`, on, (
            <Text color={gaugeColor(row.percent)}>{`${own.gaugeIcon} ${own.gaugeFull.repeat(gauge)}${own.gaugeEmpty.repeat(marks.gaugeCells - gauge)} ${fill(text.gaugePercent, { percent: row.percent })}`}</Text>
          ))}
          {row.hasGates ? pill(`${key}-gates`, on, (
            <Text>
              {stripCells(row.gates, room).map((state, at) => <Text key={`${key}-cell-${at}`} color={cellOf(state).color}>{cellOf(state).glyph}</Text>)}
              <Text color={THEME.muted}>{countText}</Text>
            </Text>
          )) : null}
        </Box>
        <Box key={`${key}-gap`} flexGrow={1} />
        {row.tasks.length === 0 ? null : (
          <Box key={`${key}-fold`} flexShrink={0}>
            <Text>
              <Text color={THEME.accent}>{folded.includes(row.id) ? look.glyph.collapsed : look.glyph.expanded}</Text>
              <Text color={isFoldOver ? THEME.accent : THEME.muted}>{` ${tasksLabel(row.tasks)} `}</Text>
            </Text>
          </Box>
        )}
        </Box>,
      )
    }

    if (line.kind === 'task') {
      const task = row.tasks[line.task!]!
      const mark = task.status === 'running' ? { glyph: own.running, color: THEME.accent } : task.status === 'done' ? { glyph: look.glyph.ok, color: THEME.ok } : { glyph: look.glyph.warn, color: THEME.alert }
      return frame(
        <Box key={`${key}-body`} flexDirection="row" flexGrow={1} columnGap={1} paddingLeft={2}>
          <Text key={`${key}-mark`} color={mark.color}>{mark.glyph}</Text>
          <Box key={`${key}-text`} flexGrow={1} flexShrink={1}>
            <Text wrap="truncate-end">
              <Text color={THEME.muted}>{`${task.kind === 'shell' ? text.taskShell : text.taskMonitor} `}</Text>
              <Text color={isHover ? THEME.accent : task.status === 'running' ? THEME.onSurface : THEME.muted}>{task.command}</Text>
            </Text>
          </Box>
          <Box key={`${key}-right`} flexShrink={0}>
            <Text color={THEME.muted}>{`${task.elapsed} `}</Text>
          </Box>
        </Box>,
      )
    }

    if (line.kind === 'empty') {
      return frame(<Text key={`${key}-empty`} color={THEME.muted} wrap="truncate-end">{`   ${text.noGates}`}</Text>)
    }

    const group = groupGates(row.gates)[line.group!]!
    const name = (gate: Gate) => `${row.isMain && gate.file ? `${gate.file}/` : ''}${gate.id}`
    if (line.kind === 'ghead') {
      return frame(
        <Text key={`${key}-ghead`} wrap="truncate-end">
          <Text color={GROUPS[group.state].color} bold>{`  ${GROUPS[group.state].label}`}</Text>
          <Text color={THEME.muted}>{` ${MARK.sep} ${group.gates.length}`}</Text>
        </Text>,
      )
    }
    if (line.kind === 'gfold') {
      const names = group.state === 'met' ? group.gates.map(name).join(' ') : group.gates.map(gate => `${name(gate)} ${gate.text}`).join(` ${MARK.sep} `)
      return frame(<Text key={`${key}-gfold`} wrap="truncate-end" color={THEME.muted}>{`    ${cutText(names, Math.max(1, width - 7))}`}</Text>)
    }
    const gate = group.gates[line.gate!]!
    const since = group.state === 'pending' ? gate.changedAt : gate.firstSeenAt
    const age = since !== undefined && props.now !== undefined ? formatElapsed(props.now - since) : ''
    return frame(
      <Box key={`${key}-body`} flexDirection="row" paddingLeft={4} flexGrow={1} flexShrink={1}>
        <Box key={`${key}-text`} flexGrow={1} flexShrink={1}>
          <Text wrap="truncate-end" color={THEME.onSurface}>{`${name(gate)} ${gate.text}`}</Text>
        </Box>
        <Box key={`${key}-age`} flexShrink={0} paddingLeft={1}>
          <Text color={THEME.muted}>{`${age} `}</Text>
        </Box>
      </Box>,
    )
  }

  return <Box flexDirection="column">{lines.map(drawLine)}</Box>
}

export default Loops

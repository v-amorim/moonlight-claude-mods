// mod-transcript / tests/rows.test.ts, by v-amorim
// Tests status words, API error actions, questions, reports and notices read from rows.
import { expect, test } from 'claude-code/testing'

import { apiErrorAction, completeLines, hexColors, questionsOf, reportOf, senderTaskOf, statusesOf, withNotice } from '../hooks/rows'

test('a status word comes from a typed result field, never from the words in the output', () => {
  expect(statusesOf({ isInterrupted: false, isDeclined: false, output: { timedOutAfterMs: 120000 } })).toEqual(['timedOut'])
  expect(statusesOf({ isInterrupted: true, isDeclined: false, output: { interrupted: true } })).toEqual(['interrupted'])
  expect(statusesOf({ isInterrupted: false, isDeclined: false, output: { backgroundTaskId: 'b1' } })).toEqual(['background'])
  expect(statusesOf({ isInterrupted: false, isDeclined: false, output: 'started', input: { command: 'ping', run_in_background: true } })).toEqual(['background'])
  expect(statusesOf({ isInterrupted: false, isDeclined: true, output: 'refused' })).toEqual(['declined'])
  expect(statusesOf({ isInterrupted: false, isDeclined: false, output: 'command timed out and was interrupted' })).toEqual([])
})

test('the status words keep their order: timed out, interrupted, background, declined', () => {
  expect(statusesOf({ isInterrupted: true, isDeclined: true, output: { timedOutAfterMs: 1, backgroundedByUser: true } })).toEqual(['timedOut', 'interrupted', 'background', 'declined'])
})

test('AskUserQuestion lists each question with the answer and the note its result holds, or none', () => {
  const input = { questions: [{ header: 'Database', question: 'Which db?' }, { question: 'Ship now?' }] }
  expect(questionsOf(input, { answers: { 'Which db?': 'Postgres' }, annotations: { 'Which db?': { notes: 'managed' } } })).toEqual([
    { question: 'Which db?', answer: 'Postgres', note: 'managed' },
    { question: 'Ship now?', answer: undefined, note: undefined },
  ])
  expect(questionsOf({}, undefined)).toEqual([])
})

test('an API error the engine retries is a warning; the others need the person', () => {
  expect(apiErrorAction('rate_limit')).toBe('retry')
  expect(apiErrorAction('overloaded')).toBe('retry')
  expect(apiErrorAction('server_error')).toBe('retry')
  expect(apiErrorAction('billing_error')).toBe('act')
  expect(apiErrorAction('unknown')).toBe('act')
})

test('a report names its sender or task, and carries the task fields it parsed', () => {
  expect(reportOf({ name: 'researcher' }, { id: 'a1', status: 'completed', type: 'local_agent', durationMs: 122000 })).toEqual({
    name: 'researcher',
    status: 'completed',
    durationMs: 122000,
    id: 'a1',
    type: 'local_agent',
  })
  expect(reportOf(undefined, { type: 'local_bash' }).name).toBe('local_bash')
})

test('a read keeps its unfinished last line for the next read', () => {
  expect(completeLines('a\n{"b')).toEqual({ lines: ['a'], rest: '{"b' })
  expect(completeLines('x\n')).toEqual({ lines: ['x'], rest: '' })
  expect(completeLines('')).toEqual({ lines: [], rest: '' })
})

test('a peer report names its task from the stored origin, when the origin carries one', () => {
  expect(senderTaskOf({ kind: 'peer', from: 'a1', senderTaskId: 'a1' })).toBe('a1')
  expect(senderTaskOf({ kind: 'peer' })).toBeUndefined()
  expect(senderTaskOf(undefined)).toBeUndefined()
})

test('a notice gives its report the status and time it reports, and a report without a notice keeps its own', () => {
  const report = reportOf({ name: 'general-purpose' }, undefined)
  expect(withNotice(report, undefined)).toEqual(report)
  expect(withNotice(report, { status: 'completed', durationMs: 952121 })).toEqual({ name: 'general-purpose', status: 'completed', durationMs: 952121 })
})

test('hex colors come back once each, in order, short codes widened and alpha blended over the background', () => {
  expect(hexColors('low `#ACB9E6`, high #ea98ee, again #ACB9E6, short #fff and #0f08, alpha #FF6F7A80', '#000000')).toEqual([
    { code: '#ACB9E6', rgb: '#ACB9E6' },
    { code: '#ea98ee', rgb: '#EA98EE' },
    { code: '#fff', rgb: '#FFFFFF' },
    { code: '#0f08', rgb: '#008800' },
    { code: '#FF6F7A80', rgb: '#80383D' },
  ])
  expect(hexColors('#FFFFFF00 and #12345678 over white', '#FFFFFF')[0]!.rgb).toBe('#FFFFFF')
})

test('prompt numbers, issue refs, anchors and longer words are not colors', () => {
  expect(hexColors('prompt #229, issue #1234, entity &#123; url /page#section, word #deadbeefcafe, id #abcdefg', '#000000')).toEqual([])
})

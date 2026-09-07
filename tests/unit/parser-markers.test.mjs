import test from 'node:test'
import assert from 'node:assert/strict'
import { parseTimetable } from '../../shared/timetable.js'

const cell = (v) => ({ v })
const table = (rows) => ({ cols: [], rows: rows.map((c) => ({ c })) })

test('zero-duration marker rows (end === start) are kept; inverted times are dropped', () => {
  const t = table([
    [cell('Title'), cell('Day'), cell('Date'), cell('Start'), cell('End'), cell('Room')],
    [cell('Maths Audit Opens'), cell('Monday'), cell('7-Sep-2026'), cell('9:00'), cell('9:00'), cell('')],
    [cell('Broken Row'), cell('Monday'), cell('7-Sep-2026'), cell('11:00'), cell('9:00'), cell('')],
    [cell('Normal Session'), cell('Monday'), cell('7-Sep-2026'), cell('9:00'), cell('11:00'), cell('X')],
  ])
  const { sessions, warnings } = parseTimetable(t)
  const titles = sessions.map((s) => s.title)
  assert.ok(titles.includes('Maths Audit Opens'), 'zero-duration marker must be kept')
  assert.ok(titles.includes('Normal Session'))
  assert.ok(!titles.includes('Broken Row'), 'inverted times must be dropped')
  assert.equal(warnings.filter((w) => w.includes('invalid time')).length, 1)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { parseTimetable } from '../../shared/timetable.js'
import { attendanceSummary, isEligibleSession, isStudentRepTitle } from '../../shared/eligibility.js'

/**
 * Owner, 16 September 2026: Student Rep meetings are optional, never count
 * towards attendance, and exist only for a learner who says they are a rep.
 */

const cell = (v) => ({ v })
const table = (rows) => ({ cols: [], rows: rows.map((c) => ({ c })) })

test('the parser marks Student Rep meetings optional whatever the sheet says', () => {
  const { sessions } = parseTimetable(
    table([
      [cell('Title'), cell('Day'), cell('Date'), cell('Start'), cell('End'), cell('Room')],
      [cell('Student Rep Meeting'), cell('Monday'), cell('7-Sep-2026'), cell('13:00'), cell('14:00'), cell('B12')],
      [cell('Student Representatives briefing'), cell('Monday'), cell('7-Sep-2026'), cell('14:00'), cell('15:00'), cell('B12')],
      [cell('Maths 1'), cell('Monday'), cell('7-Sep-2026'), cell('9:00'), cell('11:00'), cell('B12')],
    ])
  )
  const by = (t) => sessions.find((s) => s.title === t)
  assert.equal(by('Student Rep Meeting').isOptional, true)
  assert.equal(by('Student Representatives briefing').isOptional, true)
  assert.equal(by('Maths 1').isOptional, false)
  assert.equal(isStudentRepTitle('Student rep drop-in'), true)
  assert.equal(isStudentRepTitle('Representation in the classroom'), false, 'a lesson about representation is not a rep meeting')
})

test('a Student Rep meeting is never an eligible attendance session, attended or not', () => {
  const s = (patch = {}) => ({ id: 'x', title: 'Teaching', dateISO: '2026-09-01', start: '09:00', end: '10:00', ...patch })
  const rep = s({ id: 'r', title: 'Student Rep Meeting', isOptional: true })
  assert.equal(isEligibleSession(rep), false)
  assert.equal(isEligibleSession(s({ id: 'm', title: 'Maths 1' })), true)
  const meta = { m: { attended: true }, r: { attended: true } }
  const out = attendanceSummary([s({ id: 'm', title: 'Maths 1' }), rep], (x) => meta[x.id], '2026-09-07')
  assert.equal(out.eligible, 1, 'the rep meeting does not enter the count')
  assert.equal(out.attended, 1)
})

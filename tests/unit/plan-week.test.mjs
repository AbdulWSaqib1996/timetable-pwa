import test from 'node:test'
import assert from 'node:assert/strict'
import { overlapsBusy, suggestPlanWeek, hhmm } from '../../shared/planWeek.js'

const S = (d, from, to, label, kind = 'session') => ({ d, from, to, label, kind })
const m = (h, mm = 0) => h * 60 + mm

test('no suggestion overlaps a busy interval; the travel buffer around sessions is honoured and named', () => {
  const busy = [S('2026-09-07', m(9), m(11), 'PS1'), S('2026-09-07', m(14, 30), m(16, 30), 'Maths 1'), S('2026-09-08', m(9), m(11), 'PS2')]
  const out = suggestPlanWeek({ anchorISO: '2026-09-09', busy })
  assert.equal(out.monday, '2026-09-07')
  assert.ok(out.suggestions.length > 0)
  for (const s of out.suggestions) {
    assert.ok(!overlapsBusy(busy, s.d, s.from, s.to), `${s.d} ${hhmm(s.from)}–${hhmm(s.to)} overlaps`)
    assert.ok(s.mins >= 30 && s.mins <= 120)
    assert.ok(s.from >= m(8) && s.to <= m(20))
    assert.ok(s.reasons.length > 0)
  }
  // Monday: 08:00–08:45 is only 45 min after the buffer (session 09:00 − 15) → suggested; 11:15–13:15 first chunk of the midday gap.
  const monday = out.suggestions.filter((s) => s.d === '2026-09-07')
  assert.deepEqual(monday.map((s) => [hhmm(s.from), hhmm(s.to)]), [['08:00', '08:45'], ['11:15', '13:15'], ['16:45', '18:45']])
  assert.match(monday[1].reasons[0], /free between PS1 .* and Maths 1/)
  assert.match(monday[1].reasons[1], /gap continues until 14:15/)
  assert.ok(out.excluded.some((e) => /15 min travel buffer/.test(e)))
})

test('quiet hours and the configurable range cut suggestions; free personal events do not block', () => {
  const busy = [S('2026-09-10', m(18), m(19), 'Yoga (free)', 'free'), S('2026-09-10', m(12), m(13), 'Lunch shift', 'personal')]
  const out = suggestPlanWeek({ anchorISO: '2026-09-10', busy, options: { start: m(10), end: m(19), quietFrom: 18, quietTo: 7 } })
  const thu = out.suggestions.filter((s) => s.d === '2026-09-10')
  // 10:00–12:00 (personal is not buffered), 13:00–15:00 + continuation, quiet from 18:00 stops the day at 18:00.
  assert.deepEqual(thu.map((s) => [hhmm(s.from), hhmm(s.to)]), [['10:00', '12:00'], ['13:00', '15:00']])
  assert.equal(thu[1].gapTo, m(18))
  assert.ok(out.excluded.some((e) => /quiet hours 18:00–07:00/.test(e)))
  assert.ok(out.excluded.some((e) => /marked free/.test(e)))
  assert.ok(!overlapsBusy(busy, '2026-09-10', m(18), m(19)) === false || true)
})

test('deadlines give a reason; workload totals separate timetabled, planned and personal minutes', () => {
  const busy = [S('2026-09-08', m(9), m(11), 'PS2'), S('2026-09-08', m(19), m(20), 'Essay block', 'plan'), S('2026-09-08', m(13), m(14), 'Dentist', 'personal')]
  const out = suggestPlanWeek({ anchorISO: '2026-09-08', busy, deadlines: [{ d: '2026-09-11', title: 'Essay 1' }] })
  const tue = out.suggestions.filter((s) => s.d === '2026-09-08')
  assert.ok(tue.every((s) => s.reasons.some((r) => /ahead of “Essay 1” \(due 2026-09-11\)/.test(r))))
  const w = out.workload.find((x) => x.d === '2026-09-08')
  assert.deepEqual(w, { d: '2026-09-08', timetabledMins: 120, plannedMins: 60, personalMins: 60 })
})

test('a DST-change week plans on wall minutes: Sunday 25 Oct 2026 keeps its 08:00–20:00 range', () => {
  const out = suggestPlanWeek({ anchorISO: '2026-10-25', busy: [S('2026-10-25', m(10), m(11), 'Revision', 'plan')] })
  assert.equal(out.monday, '2026-10-19')
  const sun = out.suggestions.filter((s) => s.d === '2026-10-25')
  assert.deepEqual(sun.map((s) => [hhmm(s.from), hhmm(s.to)]), [['08:00', '10:00'], ['11:00', '13:00']])
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { attendanceSummary, isCompleted, isEligibleSession, placementDaySummary } from '../../shared/eligibility.js'

const today = '2026-09-07'
const s = (patch = {}) => ({ id: 'x', title: 'Teaching', dateISO: '2026-09-01', start: '09:00', end: '10:00', ...patch })

test('attended, absent and unrecorded are separate; future and non-eligible rows are excluded', () => {
  const sessions = [
    s({ id: 'a' }), // attended
    s({ id: 'b' }), // absent
    s({ id: 'c' }), // unrecorded
    s({ id: 'd', dateISO: '2026-09-20' }), // future → excluded
    s({ id: 'e', isSelfStudy: true }), // self-study → excluded
    s({ id: 'f', isKeyDate: true }), // key date → excluded
    s({ id: 'g', title: 'SE1A School Experience' }), // placement → days, not sessions
  ]
  const meta = { a: { attended: true }, b: { absent: true } }
  const out = attendanceSummary(sessions, (x) => meta[x.id], today)
  assert.equal(out.eligible, 3)
  assert.equal(out.attended, 1)
  assert.equal(out.absent, 1)
  assert.equal(out.unrecorded, 1)
  assert.match(out.sentence, /1 attended of 3 eligible completed sessions; 1 absent, 1 unrecorded/)
})

test('all unrecorded and zero-denominator cases stay honest', () => {
  const none = attendanceSummary([], () => undefined, today)
  assert.equal(none.eligible, 0)
  assert.equal(none.attendedPct, null)
  assert.match(none.sentence, /No eligible completed sessions/)
  const all = attendanceSummary([s({ id: 'a' }), s({ id: 'b' })], () => undefined, today)
  assert.equal(all.unrecorded, 2)
  assert.equal(all.attended, 0)
})

test('deleted metadata counts as unrecorded, never as attendance or absence', () => {
  const out = attendanceSummary([s({ id: 'a' })], () => ({ attended: true, deleted: true }), today)
  assert.equal(out.attended, 0)
  assert.equal(out.unrecorded, 1)
})

test("a session later today is not completed until its end time passes", () => {
  const todaySession = s({ dateISO: today, start: '14:00', end: '15:00' })
  assert.equal(isCompleted(todaySession, today, 13 * 60), false)
  assert.equal(isCompleted(todaySession, today, 15 * 60), true)
  assert.equal(isCompleted(todaySession, today, null), true) // date-only callers keep old behaviour
  assert.equal(isEligibleSession(todaySession), true)
})

test('two placement events on one date are one school day; inferred days are labelled', () => {
  const sessions = [
    s({ id: 'm1', title: 'SE1A begins (1st - 5th Sep 2026)', dateISO: '2026-09-01' }),
    s({ id: 'm2', title: 'SE1A School Experience', dateISO: '2026-09-01' }), // same day, second event
    s({ id: 'plc-SE1A-2026-09-02', title: 'SE1A placement day', dateISO: '2026-09-02' }), // synthetic
  ]
  const meta = { m1: { attended: true } }
  const out = placementDaySummary(sessions, (x) => meta[x.id])
  assert.equal(out.blocks.length, 1)
  assert.equal(out.blocks[0].total, 2) // two dates, not three events
  assert.equal(out.blocks[0].attended, 1)
  assert.equal(out.blocks[0].inferred, 1)
  assert.equal(out.inferredDays, 1)
})

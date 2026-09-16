import test from 'node:test'
import assert from 'node:assert/strict'
import { collections, validatePayload } from '../../shared/contracts.js'
import { editHomework, followSession, keepDate, makeHomework, rescheduleHomework, resolveDue, resolveSource, validateHomeworkInput } from '../../shared/homework.js'

/**
 * Placement review Batch 2 (Pass 87) — the homework lifecycle: explicit due
 * intent with a resolver every consumer reads (HW-03), edit and reschedule on
 * the same record (HW-02), source resolution with a snapshot fallback (HW-04),
 * validation instead of truncation (HW-05), and the wire contract.
 */

const keyOf = (s) => s.eventKey || `${s.dateISO}|${s.start}|${s.title.toLowerCase()}`
const session = (id, title, dateISO, start = '09:00', extra = {}) => ({ id, title, dateISO, start, end: '11:00', eventKey: `event:${id}`, ...extra })
const m1 = session('m1', 'Maths 1', '2026-09-15')
const m2 = session('m2', 'Maths 2', '2026-09-22')
const m3 = session('m3', 'Maths 3', '2026-09-29')
const hw = () => makeHomework({ id: 'h1', title: 'Read chapter 3', details: 'Pages 10–20', sourceRef: keyOf(m1), source: m1, target: { key: keyOf(m2), session: m2 }, todayISO: '2026-09-15', now: 100 })

test('HW-03: due intent is explicit and the resolver names current, changed, missing and fixed — the effective date is always the last confirmed one', () => {
  const h = hw()
  assert.equal(h.dueMode, 'session')
  assert.deepEqual(h.dueSnapshot, { dateISO: '2026-09-22', start: '09:00', title: 'Maths 2', at: 100 })
  assert.deepEqual(h.sourceSnapshot, { dateISO: '2026-09-15', start: '09:00', title: 'Maths 1', at: 100 })
  assert.equal(resolveDue(h, [m1, m2, m3], keyOf).state, 'current')
  // The stable reference survives a move: the resolver says "changed" and keeps the confirmed date.
  const moved = { ...m2, dateISO: '2026-09-23' }
  const r = resolveDue(h, [m1, moved, m3], keyOf)
  assert.equal(r.state, 'changed')
  assert.equal(r.effectiveISO, '2026-09-22', 'no guess: the last confirmed deadline stands')
  assert.deepEqual([r.change.fromISO, r.change.toISO, r.change.moved, r.change.retitled], ['2026-09-22', '2026-09-23', true, false])
  assert.equal(resolveDue(h, [m1, { ...m2, title: 'Maths 2 (revised)' }, m3], keyOf).change.retitled, true)
  assert.equal(resolveDue(h, [m1, m3], keyOf).state, 'missing')
  assert.equal(resolveDue(h, [m1, m3], keyOf).effectiveISO, '2026-09-22')
  // Follow: the deadline moves with the session and the change is history. Keep: a fixed date that never moves again.
  const followed = followSession(h, moved, 200)
  assert.equal(followed.dueISO, '2026-09-23')
  assert.equal(resolveDue(followed, [m1, moved, m3], keyOf).state, 'current')
  assert.deepEqual(followed.dueHistory, [{ at: 200, fromISO: '2026-09-22', toISO: '2026-09-23', reason: 'follow' }])
  const kept = keepDate(h, 200)
  assert.equal(kept.dueMode, 'date')
  assert.equal(resolveDue(kept, [m1, { ...m2, dateISO: '2026-10-01' }, m3], keyOf).state, 'fixed')
  assert.equal(resolveDue(kept, [], keyOf).effectiveISO, '2026-09-22')
  // A learner-typed date never follows anything.
  const dated = makeHomework({ id: 'h2', title: 'Essay plan', dueISO: '2026-10-05', todayISO: '2026-09-15', now: 1 })
  assert.equal(dated.dueMode, 'date')
  assert.equal(resolveDue(dated, [m1, m2], keyOf).state, 'fixed')
  // Records written before Pass 87 (no dueMode) resolve by their reference.
  const legacy = { id: 'h3', title: 'Old', setISO: '2026-09-01', dueSessionRef: keyOf(m2), dueTitle: 'Maths 2', dueISO: '2026-09-22', status: 'todo', at: 1 }
  assert.equal(resolveDue(legacy, [m2], keyOf).state, 'current')
  assert.equal(resolveDue(legacy, [moved], keyOf).state, 'changed')
})

test('HW-02: edit and reschedule keep the record id and status; a deadline pin cannot become a due session', () => {
  const h = { ...hw(), status: 'doing' }
  const edited = editHomework(h, { title: 'Read chapter 3 and 4', details: '' }, 300)
  assert.equal(edited.id, 'h1')
  assert.equal(edited.status, 'doing')
  assert.equal(edited.details, undefined)
  const toM3 = rescheduleHomework(h, { target: { key: keyOf(m3), session: m3 } }, 400)
  assert.equal(toM3.dueISO, '2026-09-29')
  assert.equal(toM3.dueSessionRef, keyOf(m3))
  assert.equal(toM3.status, 'doing')
  assert.equal(toM3.dueHistory.at(-1).reason, 'edit')
  const toDate = rescheduleHomework(toM3, { target: null, dueISO: '2026-10-10' }, 500)
  assert.equal(toDate.dueMode, 'date')
  assert.equal(toDate.dueSessionRef, undefined)
  assert.throws(() => rescheduleHomework(h, { target: { key: 'k', session: { ...m3, isKeyDate: true } } }, 1), /teaching session/)
  assert.throws(() => rescheduleHomework(h, { target: null, dueISO: 'soon' }, 1), /Choose a session or a date/)
})

test('HW-04: the source resolves to the occurrence, then to its snapshot when the occurrence leaves the timetable', () => {
  const h = hw()
  assert.equal(resolveSource(h, [m1, m2], keyOf).session.id, 'm1')
  const gone = resolveSource(h, [m2], keyOf)
  assert.equal(gone.state, 'missing')
  assert.equal(gone.snapshot.title, 'Maths 1')
  assert.equal(resolveSource({ ...h, setSessionRef: undefined, sourceSnapshot: undefined }, [], keyOf).state, 'none')
})

test('HW-05: over-limit words are refused with a sentence, never cut', () => {
  assert.equal(validateHomeworkInput({ title: 'ok', details: '' }), null)
  assert.match(validateHomeworkInput({ title: '   ' }), /needs a title/)
  assert.match(validateHomeworkInput({ title: 'x'.repeat(201) }), /1 characters over the 200-character limit/)
  assert.match(validateHomeworkInput({ title: 'ok', details: 'y'.repeat(4001) }), /over the 4000-character limit/)
  assert.throws(() => makeHomework({ id: 'h', title: 'x'.repeat(201), dueISO: '2026-10-01', todayISO: '2026-09-15', now: 1 }), /over the 200-character limit/)
})

test('wire contract: the new fields validate and bad shapes are refused', () => {
  const empty = () => Object.fromEntries(collections.map((k) => [k, []]))
  const withAdmin = (admin) => ({ store: { activeId: 'p1', profiles: [{ id: 'p1', name: 'one', settings: { demo: true, sheetId: '', gid: null } }] }, admin: { p1: admin } })
  const h = followSession(hw(), { ...m2, dateISO: '2026-09-23' }, 200)
  assert.doesNotThrow(() => validatePayload(withAdmin({ ...empty(), homework: [h] })))
  assert.throws(() => validatePayload(withAdmin({ ...empty(), homework: [{ ...h, dueMode: 'whenever' }] })), /due mode/)
  assert.throws(() => validatePayload(withAdmin({ ...empty(), homework: [{ ...h, dueSnapshot: { title: 'x' } }] })), /snapshot/)
  assert.throws(() => validatePayload(withAdmin({ ...empty(), homework: [{ ...h, dueHistory: [{ at: 1, fromISO: '2026-09-22', toISO: '2026-09-23', reason: 'guess' }] }] })), /history/)
})

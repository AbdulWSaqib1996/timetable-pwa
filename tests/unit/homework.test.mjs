import test from 'node:test'
import assert from 'node:assert/strict'
import { HOMEWORK_TITLE_MAX, homeworkForSession, homeworkOfLesson, laterOccurrences, makeHomework, sortHomework, titleFamily, upcomingOccurrences } from '../../shared/homework.js'
import { ADMIN_SCHEMA_VERSION, collections, validatePayload } from '../../shared/contracts.js'

/**
 * Homework (owner request, 15 September 2026): a lesson sets it and it is due
 * in a LATER OCCURRENCE of the same lesson. Nothing is inferred — the learner
 * picks the occurrence and its date becomes the due date.
 */

const s = (id, title, dateISO, start = '09:00', extra = {}) => ({ id, title, dateISO, start, end: '', room: '', groups: '', tutor: '', subject: title, isSpecialism: false, isSelfStudy: false, isOptional: false, ...extra })
const TIMETABLE = [
  s('m1', 'Maths 1', '2026-09-15'),
  s('e1', 'English 1', '2026-09-15', '11:00'),
  s('m1b', 'Maths 1', '2026-09-15', '08:00'), // earlier the same day: not "later"
  s('m2', 'Maths 2', '2026-09-22'),
  s('m3', 'Maths 3', '2026-09-29'),
  s('kd', 'Assignment 1 hand-in', '2026-09-23', '', { isKeyDate: true }),
  s('free', 'Free time', '2026-09-24', '10:00', { isFreeTime: true }),
]

test('title families group the same lesson: "Maths 1" and "Maths 2" belong together, a plain title is its own family', () => {
  assert.equal(titleFamily('Maths 1'), titleFamily('Maths 2'))
  assert.equal(titleFamily('Maths 1'), 'maths')
  assert.equal(titleFamily('  English   2 '), 'english')
  assert.equal(titleFamily('Professional Studies'), 'professional studies')
  assert.equal(titleFamily('12'), '12', 'a title that is only a number keeps itself')
  assert.equal(titleFamily('School Experience SE1a'), 'school experience se1a')
})

test('later occurrences of the lesson only: same family, strictly later, never a key date or free time', () => {
  const later = laterOccurrences(TIMETABLE, 'maths', { dateISO: '2026-09-15', start: '09:00' })
  assert.deepEqual(later.map((x) => x.id), ['m2', 'm3'])
  assert.deepEqual(laterOccurrences(TIMETABLE, 'english', { dateISO: '2026-09-15', start: '11:00' }).map((x) => x.id), [])
  // From the earlier Maths on the same day, the 09:00 one is a later occurrence.
  assert.deepEqual(laterOccurrences(TIMETABLE, 'maths', { dateISO: '2026-09-15', start: '08:00' }).map((x) => x.id), ['m1', 'm2', 'm3'])
  // Everything later is offered, the lesson's own family flagged — including a different
  // session later the same day (homework can be due in the next lesson that day).
  const everything = upcomingOccurrences(TIMETABLE, 'maths', { dateISO: '2026-09-15', start: '09:00' })
  assert.deepEqual(everything.map((o) => [o.session.id, o.sameFamily]), [['e1', false], ['m2', true], ['m3', true]])
  assert.ok(!everything.some((o) => o.session.isKeyDate || o.session.isFreeTime), 'deadline pins and free time can never host homework')
})

test('makeHomework: the chosen occurrence sets the due date and is remembered by key; a plain date is allowed; nonsense is refused', () => {
  const lesson = { id: 'l1' }
  const target = { key: 'event:course:m2', session: TIMETABLE.find((x) => x.id === 'm2') }
  const made = makeHomework({ id: 'h1', title: '  Fractions worksheet  ', details: ' q1-8 ', lesson, sourceRef: 'event:course:m1', target, todayISO: '2026-09-15', now: 5 })
  // Pass 87 added the explicit due intent and its snapshot; the original shape is unchanged underneath.
  assert.equal(made.dueMode, 'session')
  assert.equal(made.dueSnapshot.dateISO, '2026-09-22')
  const { dueMode: _m, dueSnapshot: _s, ...hw } = made
  assert.deepEqual(hw, {
    id: 'h1',
    title: 'Fractions worksheet',
    details: 'q1-8',
    lessonId: 'l1',
    setSessionRef: 'event:course:m1',
    setISO: '2026-09-15',
    dueSessionRef: 'event:course:m2',
    dueTitle: 'Maths 2',
    dueISO: '2026-09-22',
    status: 'todo',
    at: 5,
  })
  const plain = makeHomework({ id: 'h2', title: 'Reading', lesson, target: null, dueISO: '2026-10-01', todayISO: '2026-09-15', now: 6 })
  assert.equal(plain.dueISO, '2026-10-01')
  assert.equal(plain.dueSessionRef, undefined)
  assert.equal(plain.details, undefined)
  assert.throws(() => makeHomework({ id: 'h3', title: '   ', target, todayISO: '2026-09-15', now: 7 }), /title/)
  assert.throws(() => makeHomework({ id: 'h4', title: 'x', target: null, dueISO: 'soon', todayISO: '2026-09-15', now: 7 }), /due date/)
  // Pass 87 (HW-05): over-limit words are refused with the count, never cut.
  assert.throws(() => makeHomework({ id: 'h5', title: 'y'.repeat(400), target, todayISO: '2026-09-15', now: 8 }), new RegExp(`200 characters over the ${HOMEWORK_TITLE_MAX}-character limit`))
})

test('lookups: homework due in one occurrence, homework a lesson set, outstanding before completed', () => {
  const list = [
    { id: 'a', title: 'A', dueSessionRef: 'k2', lessonId: 'l1', dueISO: '2026-09-22', setISO: '2026-09-15', status: 'todo', at: 1 },
    { id: 'b', title: 'B', dueSessionRef: 'k2', lessonId: 'l2', dueISO: '2026-09-20', setISO: '2026-09-15', status: 'done', completedISO: '2026-09-19', at: 2 },
    { id: 'c', title: 'C', dueSessionRef: 'k3', lessonId: 'l1', dueISO: '2026-09-18', setISO: '2026-09-15', status: 'todo', at: 3 },
  ]
  assert.deepEqual(homeworkForSession(list, 'k2').map((h) => h.id), ['a', 'b'], 'outstanding first, then completed')
  assert.deepEqual(homeworkForSession(list, undefined), [])
  assert.deepEqual(homeworkOfLesson(list, 'l1').map((h) => h.id), ['c', 'a'], 'outstanding by due date')
  assert.deepEqual(homeworkOfLesson(list, undefined), [])
  assert.deepEqual(sortHomework(list).map((h) => h.id), ['c', 'a', 'b'])
})

test('contract: homework is an optional collection, validated on the wire, from schema version 9', () => {
  assert.ok(collections.includes('homework'))
  assert.ok(ADMIN_SCHEMA_VERSION >= 9, 'homework arrived at schema version 9; later passes may bump it')
  const empty = Object.fromEntries(collections.map((k) => [k, []]))
  const payload = (homework) => ({ store: { activeId: 'p1', profiles: [{ id: 'p1', name: 'one', settings: { demo: true, sheetId: '', gid: null } }] }, admin: { p1: { ...empty, homework } } })
  const ok = { id: 'h1', title: 'Fractions worksheet', details: 'q1-8', lessonId: 'l1', dueSessionRef: 'event:course:m2', dueTitle: 'Maths 2', dueISO: '2026-09-22', setISO: '2026-09-15', status: 'todo', at: 1 }
  assert.doesNotThrow(() => validatePayload(payload([ok])))
  assert.doesNotThrow(() => validatePayload(payload([])))
  // A payload from an older client with no homework array at all still validates.
  const older = payload([])
  delete older.admin.p1.homework
  assert.doesNotThrow(() => validatePayload(older))
  assert.throws(() => validatePayload(payload([{ ...ok, status: 'attended' }])), /homework status/)
  assert.throws(() => validatePayload(payload([{ ...ok, dueISO: 'next week' }])), /date/)
  assert.throws(() => validatePayload(payload([{ ...ok, title: '  ' }])), /homework title/)
  assert.throws(() => validatePayload(payload([{ ...ok, details: 'x'.repeat(5000) }])), /homework details/)
})

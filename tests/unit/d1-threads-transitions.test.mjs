import test from 'node:test'
import assert from 'node:assert/strict'
import { collections, validatePayload } from '../../shared/contracts.js'
import { nextAttempt } from '../../shared/practice.js'
import { makeThread, threadOfLesson, threadSteps, threadsInformedBy, withNextAction, withNextLesson, withObservation } from '../../shared/threads.js'
import { makeTransition, sharedPackIds, transitionItems, transitionProgress } from '../../shared/transitions.js'

/**
 * Audit D1 (Pass 83) — E01 learning threads and E04 placement transitions:
 * references only, derived states with reasons, one observation informing
 * many threads without cloning, cross-placement next attempts that leave the
 * original untouched, stale ticks when the pin or the share set changes, and
 * the wire contract for both collections.
 */

const empty = () => Object.fromEntries(collections.map((k) => [k, []]))
const withAdmin = (admin) => ({ store: { activeId: 'p1', profiles: [{ id: 'p1', name: 'one', settings: { demo: true, sheetId: '', gid: null } }] }, admin: { p1: admin } })
const lesson = (patch = {}) => ({ id: 'l1', dateISO: '2026-09-14', classGroup: 'Y2', subject: 'Maths', evaluation: '', standards: [], placementId: 'pl-se1', at: 1, ...patch })
const obs = (patch = {}) => ({ id: 'o1', dateISO: '2026-09-14', observer: 'A Mentor', subject: 'Maths', focus: '', strengths: 's', development: 'd', sourceType: 'learner-entered', lessonId: 'l1', at: 2, ...patch })

test('E01: a thread starts from a lesson and every step says what is missing and why', () => {
  const l = lesson()
  const t = makeThread(l, 't1', 10)
  assert.deepEqual(t.lessonIds, ['l1'])
  assert.equal(t.placementId, 'pl-se1')
  assert.equal(threadOfLesson([t], 'l1'), t)
  const admin = { ...empty(), lessons: [l], observations: [] }
  const { steps, complete } = threadSteps(t, admin)
  assert.equal(complete, false)
  assert.deepEqual(steps.map((s) => [s.stage, s.state]), [['plan', 'missing'], ['teach', 'missing'], ['feedback', 'missing'], ['next', 'missing']])
  assert.match(steps[0].reason, /No plan saved yet/)
  // Plan and teach come from the lesson record itself, never from the thread.
  const taught = { ...l, planRevision: 2, planAt: 3, taughtAt: 4, taughtPlanRevision: 2 }
  const after = threadSteps(t, { ...admin, lessons: [taught] }).steps
  assert.equal(after[0].state, 'done')
  assert.match(after[0].reason, /revision 2/)
  assert.equal(after[1].state, 'done')
  // A deleted source is named, not silently dropped.
  const gone = threadSteps(t, { ...admin, lessons: [] }).steps
  assert.equal(gone[0].state, 'gone')
  assert.match(gone[0].reason, /no longer present/)
})

test('E01: one observation informs several threads by reference — attaching never copies it', () => {
  const l1 = lesson()
  const l2 = lesson({ id: 'l2', subject: 'English' })
  const o = obs()
  let t1 = makeThread(l1, 't1', 10)
  let t2 = makeThread(l2, 't2', 11)
  t1 = withObservation(t1, 'o1', true, 20)
  t2 = withObservation(t2, 'o1', true, 21)
  assert.equal(t1.revision, 2)
  assert.equal(withObservation(t1, 'o1', true, 30), t1, 'attaching twice is a no-op')
  const admin = { ...empty(), lessons: [l1, l2], observations: [o], learningThreads: [t1, t2] }
  assert.equal(admin.observations.length, 1, 'still exactly one observation record')
  assert.deepEqual(threadsInformedBy(admin.learningThreads, 'o1').map((t) => t.id), ['t1', 't2'])
  const fb = threadSteps(t1, admin).steps[2]
  assert.equal(fb.state, 'done')
  assert.match(fb.reason, /1 observation attached/)
  // Detaching from one thread leaves the other's reference intact.
  const t1off = withObservation(t1, 'o1', false, 40)
  assert.deepEqual(t1off.observationIds, [])
  assert.deepEqual(t2.observationIds, ['o1'])
})

test('E01: the next attempt can move placement while the original lesson keeps its own', () => {
  const l = lesson({ planRevision: 1, taughtAt: 5, taughtPlanRevision: 1 })
  let t = makeThread(l, 't1', 10)
  t = withNextAction(t, 'Cold-call after every modelled example', 20)
  const admin = { ...empty(), lessons: [l], observations: [obs()] }
  assert.match(threadSteps(withObservation(t, 'o1', true, 21), admin).steps[3].reason, /not been created yet/)
  const next = nextAttempt(l, 'l2', '2026-09-21', 30)
  next.placementId = 'pl-se2'
  t = withNextLesson(t, 'l2', 31)
  const admin2 = { ...admin, lessons: [l, next] }
  assert.deepEqual(t.lessonIds, ['l1', 'l2'])
  assert.equal(admin2.lessons[0].placementId, 'pl-se1', 'the original lesson is untouched')
  assert.equal(admin2.lessons[1].placementId, 'pl-se2')
  assert.equal(admin2.lessons[1].evaluation, '', 'no outcome copied')
  const step = threadSteps(withObservation(t, 'o1', true, 21), admin2).steps[3]
  assert.equal(step.state, 'done')
  assert.match(step.reason, /Cold-call/)
})

test('E04: checklist items are derived from the placement, school and packs; ticks go stale when their subject changes', () => {
  const school = { id: 'sch-2', name: 'Oak Academy', address: '2 Oak Rd', lat: 51.5, lng: -0.1, confirmedAt: 5, at: 10 }
  const placement = { id: 'pl-se2', code: 'SE2', schoolLocationId: 'sch-2', startISO: '2027-01-11', endISO: '2027-03-26', mappedBlockTags: ['SE2A'], mentorName: 'B Mentor', at: 10 }
  const packs = [{ id: 'pk1', title: 'Pack', state: 'draft', createdISO: '2026-09-01', items: [], sharing: { revision: 1, sharedAt: 1, mentorIds: ['m1'], attachmentUids: [], textHash: 'h' }, at: 1 }]
  const ctx = { placement, school, reviewPacks: packs, hasHome: true, defaultHours: { start: '08:30', end: '16:00' } }
  const t0 = makeTransition('pl-se1', 'pl-se2', 'tr1', 100)
  const first = transitionItems(t0, ctx)
  const state = (items, id) => items.find((i) => i.id === id).state
  assert.equal(state(first, 'school-confirmed'), 'done')
  assert.equal(state(first, 'travel-reviewed'), 'todo')
  assert.equal(state(first, 'return-set'), 'done', 'home is the labelled fallback')
  assert.match(first.find((i) => i.id === 'return-set').detail, /fallback/)
  assert.equal(state(first, 'mentor-recorded'), 'done')
  assert.equal(state(first, 'shares-reviewed'), 'todo')
  assert.equal(state(first, 'goals-chosen'), 'todo')
  assert.equal(transitionProgress(first).complete, false)

  // Review the journeys against the current pin, then move the pin: the tick goes stale.
  const reviewed = { ...t0, travelReviewed: { at: 101, lat: 51.5, lng: -0.1 }, sharesReviewed: { at: 102, packIds: sharedPackIds(packs) }, carryTargetIds: [], contextNote: 'Year 4, maths and science', confirmedStartISO: '2027-01-11' }
  const all = transitionItems(reviewed, ctx)
  assert.equal(state(all, 'travel-reviewed'), 'done')
  assert.equal(state(all, 'shares-reviewed'), 'done')
  assert.equal(transitionProgress(all).complete, true)
  const moved = transitionItems(reviewed, { ...ctx, school: { ...school, lat: 51.6 } })
  assert.equal(state(moved, 'travel-reviewed'), 'stale')
  assert.match(moved.find((i) => i.id === 'travel-reviewed').detail, /pin changed/)
  // Sharing another pack after the review makes that tick stale too.
  const morePacks = [...packs, { ...packs[0], id: 'pk2' }]
  assert.equal(state(transitionItems(reviewed, { ...ctx, reviewPacks: morePacks }), 'shares-reviewed'), 'stale')
  // Unsharing brings the set back to what was reviewed only if it matches.
  assert.equal(state(transitionItems(reviewed, { ...ctx, reviewPacks: [{ ...packs[0], sharing: { ...packs[0].sharing, unsharedAt: 5 } }] }), 'shares-reviewed'), 'stale')
  // A placement-specific return destination is named as such.
  const withReturn = transitionItems(reviewed, { ...ctx, placement: { ...placement, returnPlace: { label: 'Digs near school', lat: 51.51, lng: -0.11 } } })
  assert.match(withReturn.find((i) => i.id === 'return-set').detail, /Digs near school — set for this placement/)
})

test('wire contract: both collections validate, references are format-checked, and a return destination needs a pin', () => {
  const admin = {
    ...empty(),
    lessons: [lesson()],
    placements: [{ id: 'pl-se2', code: 'SE2', mappedBlockTags: [], returnPlace: { label: 'Digs', address: '1 Road', lat: 51.5, lng: -0.1 }, at: 1 }],
    learningThreads: [{ id: 't1', title: 'Maths · Y2', placementId: 'pl-se1', lessonIds: ['l1'], observationIds: ['o1'], nextAction: 'x', state: 'open', revision: 1, at: 1 }],
    transitions: [{ id: 'tr1', fromPlacementId: 'pl-se1', toPlacementId: 'pl-se2', travelReviewed: { at: 1, lat: 51.5, lng: -0.1 }, sharesReviewed: { at: 1, packIds: ['pk1'] }, carryTargetIds: [], contextNote: 'Y4', confirmedStartISO: '2027-01-11', state: 'open', at: 1 }],
  }
  assert.doesNotThrow(() => validatePayload(withAdmin(admin)))
  const bad = (patch) => withAdmin({ ...admin, ...patch })
  assert.throws(() => validatePayload(bad({ learningThreads: [{ ...admin.learningThreads[0], state: 'graded' }] })), /thread state/)
  assert.throws(() => validatePayload(bad({ learningThreads: [{ ...admin.learningThreads[0], lessonIds: ['../x'] }] })), /thread references/)
  assert.throws(() => validatePayload(bad({ transitions: [{ ...admin.transitions[0], state: 'failed' }] })), /transition state/)
  assert.throws(() => validatePayload(bad({ transitions: [{ ...admin.transitions[0], travelReviewed: { at: 1 } }] })), /travel review/)
  assert.throws(() => validatePayload(bad({ placements: [{ ...admin.placements[0], returnPlace: { label: 'Digs' } }] })), /return destination/)
  // Old payloads without the new collections still validate (optional collections).
  const legacy = { ...admin }
  delete legacy.learningThreads
  delete legacy.transitions
  assert.doesNotThrow(() => validatePayload(withAdmin(legacy)))
})

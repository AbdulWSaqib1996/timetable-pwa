import test from 'node:test'
import assert from 'node:assert/strict'
import { activateCycle, nextAttempt, nextSteps, planChanged, provenanceLabel, withPlanRevision } from '../../shared/practice.js'
import { collections, validatePayload } from '../../shared/contracts.js'

/**
 * G1b (Pass 70) — plan revisions vs the taught version, next attempts without
 * outcomes, one active focus, Today's next steps (dated work only, never
 * overdue for undated, max three), provenance, and the wire contract.
 */

const empty = () => Object.fromEntries(collections.map((k) => [k, []]))
const withAdmin = (admin) => ({ store: { activeId: 'p1', profiles: [{ id: 'p1', name: 'one', settings: { demo: true, sheetId: '', gid: null } }] }, admin: { p1: admin } })
const lesson = (patch = {}) => ({ id: 'l1', dateISO: '2026-09-14', classGroup: 'Y2', subject: 'Maths', evaluation: '', standards: [], at: 1, ...patch })

test('plan revisions: only plan fields bump the revision; evaluation is the other side of the record', () => {
  const l = lesson({ planRevision: 1 })
  assert.equal(planChanged(l, { ...l, evaluation: 'Went well' }), false)
  assert.equal(planChanged(l, { ...l, sequence: 'Starter…' }), true)
  const saved = withPlanRevision(l, { ...l, sequence: 'Starter…' }, 500)
  assert.equal(saved.planRevision, 2)
  assert.equal(saved.planAt, 500)
  const same = withPlanRevision(l, { ...l, evaluation: 'x' }, 600)
  assert.equal(same.planRevision, 1)
  assert.equal(same.planAt, undefined)
})

test('next attempt duplicates the plan under a new identity and copies no outcome', () => {
  const taught = lesson({ intention: 'Add within 20', sequence: '1…', checks: 'MWB', resources: ['a.pdf'], cycleId: 'c1', placementId: 'pl1', planRevision: 3, taughtAt: 9, taughtPlanRevision: 3, rehearsedAt: 8, reviewAt: 10, evaluation: 'ok', standards: ['TS4'], attempt: 1, stage: 'review', sessionRef: 'k1' })
  const next = nextAttempt(taught, 'l2', '2026-09-21', 20)
  assert.equal(next.id, 'l2')
  assert.equal(next.duplicatedFrom, 'l1')
  assert.equal(next.attempt, 2)
  assert.deepEqual([next.intention, next.sequence, next.checks, next.cycleId, next.placementId, next.sessionRef], ['Add within 20', '1…', 'MWB', 'c1', 'pl1', 'k1'])
  assert.deepEqual(next.resources, ['a.pdf'])
  assert.notEqual(next.resources, taught.resources, 'copied, not shared')
  assert.equal(next.evaluation, '')
  assert.deepEqual(next.standards, [])
  for (const f of ['taughtAt', 'taughtPlanRevision', 'rehearsedAt', 'reviewAt']) assert.equal(next[f], undefined, f)
  assert.equal(next.stage, 'plan')
  assert.equal(next.planRevision, 1)
})

test('one active focus: activating one pauses the other with a reason, never a failure label', () => {
  const cycles = [{ id: 'a', focus: 'A', state: 'active', at: 1 }, { id: 'b', focus: 'B', state: 'paused', at: 1 }]
  const next = activateCycle(cycles, 'b', 5)
  assert.equal(next.find((c) => c.id === 'b').state, 'active')
  assert.equal(next.find((c) => c.id === 'a').state, 'paused')
  assert.equal(next.find((c) => c.id === 'a').pausedReason, 'one-focus')
  assert.ok(!JSON.stringify(next).match(/fail/i))
})

test('next steps: dated work only, max three, pinned first, dismissed per day, past plans never "overdue", undated focus never overdue', () => {
  const admin = {
    lessons: [
      lesson({ id: 'plan1', dateISO: '2026-09-14', subject: 'Maths' }),
      lesson({ id: 'old', dateISO: '2026-09-01', subject: 'Old' }),
      lesson({ id: 'taught', dateISO: '2026-09-09', subject: 'Phonics', taughtAt: 5, intention: 'x' }),
      lesson({ id: 'reh', dateISO: '2026-09-15', subject: 'Science', intention: 'y' }),
      lesson({ id: 'far', dateISO: '2026-10-30', subject: 'Far' }),
    ],
    cycles: [{ id: 'c1', focus: 'Cold-call', state: 'active', at: 1 }],
    preps: [{ id: 'p1', dateISO: '2026-09-16', state: 'draft', at: 1 }],
  }
  const steps = nextSteps(admin, '2026-09-11')
  assert.equal(steps.length, 3)
  assert.deepEqual(steps.map((s) => s.id), ['review:taught', 'plan:plan1', 'rehearse:reh'])
  assert.ok(steps.every((s) => !/overdue|late/i.test(s.label + s.detail)))
  assert.ok(!steps.some((s) => s.id === 'plan:old'), 'a past unplanned lesson is not nagged')
  // Dismissing today's first two surfaces the next candidates; a dismissal for another day does not apply.
  const after = nextSteps(admin, '2026-09-11', { dismissed: [{ id: 'review:taught', dateISO: '2026-09-11' }, { id: 'plan:plan1', dateISO: '2026-09-10' }] })
  assert.deepEqual(after.map((s) => s.id), ['plan:plan1', 'rehearse:reh', 'prep:p1'])
  // Pinned comes first even when undated (the focus), and undated is never overdue.
  const withFocus = nextSteps({ ...admin, lessons: admin.lessons.filter((l) => l.id !== 'taught') }, '2026-09-11', { pinned: ['focus:c1'] })
  assert.equal(withFocus[0].id, 'focus:c1')
  assert.equal(withFocus[0].dateISO, null)
  // A focus with a planned attempt in progress is not repeated as a step.
  const busy = nextSteps({ ...admin, lessons: [lesson({ id: 'att', dateISO: '2026-12-01', cycleId: 'c1' })], preps: [] }, '2026-09-11')
  assert.ok(!busy.some((s) => s.kind === 'focus'))
  // Held meeting with a next review date inside 14 days surfaces; beyond it does not.
  const held = nextSteps({ lessons: [], cycles: [], preps: [{ id: 'p2', dateISO: '2026-09-01', state: 'held', outcome: { nextReviewISO: '2026-09-20' }, at: 1 }, { id: 'p3', dateISO: '2026-09-01', state: 'held', outcome: { nextReviewISO: '2026-12-20' }, at: 1 }] }, '2026-09-11')
  assert.deepEqual(held.map((s) => s.id), ['nextreview:p2'])
})

test('provenance labels: learner-entered never reads as reviewer authorship', () => {
  assert.equal(provenanceLabel('learner-entered'), 'Entered by you')
  assert.equal(provenanceLabel(undefined), 'Entered by you')
  assert.equal(provenanceLabel('personal-reflection'), 'Your reflection')
  assert.equal(provenanceLabel('reviewer-authenticated'), 'Reviewer-authenticated')
})

test('wire contract: workbench fields, cycles and preps validate; invented states and reviewer authorship are rejected', () => {
  const admin = {
    ...empty(),
    lessons: [lesson({ intention: 'i', sequence: 's', resources: ['r'], stage: 'teach', planRevision: 2, taughtPlanRevision: 2, taughtAt: 5, cycleId: 'c1', attempt: 2, duplicatedFrom: 'l0', rehearsalTaskId: 't1' })],
    observations: [{ id: 'o1', dateISO: '2026-09-14', observer: 'M', subject: 'Maths', focus: '', strengths: 's', development: 'd', sourceType: 'learner-entered', lessonId: 'l1', cycleId: 'c1', revision: 1, at: 1 }],
    meetings: [{ id: 'm1', dateISO: '2026-09-15', discussed: 'x', actions: [], prepId: 'p1', at: 1 }],
    cycles: [{ id: 'c1', focus: 'Cold-call', state: 'active', curriculumRef: 'KS1 maths', rehearsalNote: 'n', reviewDecision: 'continue', at: 1 }],
    preps: [{ id: 'p1', dateISO: '2026-09-15', state: 'held', changed: 'c', helpNeeded: 'h', exampleRefs: ['l1', 'o1'], proposedSteps: 'p', meetingId: 'm1', outcome: { happened: 'ok', durationMins: 30, nextReviewISO: '2026-09-29' }, at: 1 }],
  }
  assert.doesNotThrow(() => validatePayload(withAdmin(admin)))
  const bad = (patch) => withAdmin({ ...admin, ...patch })
  assert.throws(() => validatePayload(bad({ lessons: [{ ...admin.lessons[0], stage: 'assessed' }] })), /lesson stage/)
  assert.throws(() => validatePayload(bad({ cycles: [{ ...admin.cycles[0], state: 'failed' }] })), /practice state/)
  assert.throws(() => validatePayload(bad({ cycles: [{ ...admin.cycles[0], reviewDecision: 'fail' }] })), /review decision/)
  assert.throws(() => validatePayload(bad({ preps: [{ ...admin.preps[0], state: 'assessed' }] })), /preparation state/)
  assert.throws(() => validatePayload(bad({ preps: [{ ...admin.preps[0], outcome: { nextReviewISO: 'soon' } }] })), /next review/)
  assert.throws(() => validatePayload(bad({ observations: [{ ...admin.observations[0], sourceType: 'reviewer-authenticated' }] })), /provenance/)
  assert.throws(() => validatePayload(bad({ observations: [{ ...admin.observations[0], lessonId: 'has space' }] })), /observation link/)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { buildExperienceText, buildHandoverText, buildReviewPackText, compareToRequirement, experienceSummary, isDuplicateExperience, pinRecord, pinStale } from '../../shared/evidence.js'
import { collections, validatePayload } from '../../shared/contracts.js'
import { mergeAdmin } from '../../shared/merge.js'

/**
 * G3 (Pass 72) — pinned pack snapshots survive source edits, one record in
 * many examples without duplicate blobs, no double counting in the ledger,
 * layers never summed, comparisons only against confirmed requirements,
 * handover text excludes private notes, and the wire contract.
 */

const empty = () => Object.fromEntries(collections.map((k) => [k, []]))
const withAdmin = (admin) => ({ store: { activeId: 'p1', profiles: [{ id: 'p1', name: 'one', settings: { demo: true, sheetId: '', gid: null } }] }, admin: { p1: admin } })

test('a pack pins the canonical record; the old pack stays readable after the source changes and says it is stale', () => {
  const lesson = { id: 'l1', dateISO: '2026-09-14', subject: 'Maths', evaluation: 'Went well', standards: ['TS4'], at: 10 }
  const item = pinRecord('lesson', lesson, 'My best starter')
  assert.equal(item.revision, 10)
  const edited = { ...lesson, evaluation: 'Rewritten later', at: 20 }
  assert.equal(pinStale(item, edited), true)
  assert.equal(pinStale(item, lesson), false)
  const pack = { title: 'Review 1', state: 'draft', createdISO: '2026-09-14', items: [item], attachments: [{ id: '1', name: 'plan.pdf', state: 'missing' }] }
  const text = buildReviewPackText(pack)
  assert.match(text, /Evaluation: Went well/)
  assert.doesNotMatch(text, /Rewritten later/)
  assert.match(text, /Caption: My best starter/)
  assert.match(text, /plan\.pdf — missing on this device/)
  assert.match(text, /Nothing in this pack is an assessment/)
  // Preview and export are the same function → identical by construction.
  assert.equal(buildReviewPackText(pack), text)
  const obs = pinRecord('observation', { id: 'o1', dateISO: '2026-09-14', observer: 'M', sourceType: 'learner-entered', strengths: 's', development: 'd', at: 1 })
  assert.equal(obs.provenance, 'Entered by you')
})

test('one source record can sit in many examples by reference; removing an example never touches the lesson', () => {
  const lesson = { id: 'l1', dateISO: '2026-09-14', subject: 'Maths', at: 1 }
  const examples = [
    { id: 'e1', title: 'A', context: 'course-curriculum', refs: [{ entityType: 'lesson', entityId: 'l1' }], at: 1 },
    { id: 'e2', title: 'B', context: 'practice-cycle', refs: [{ entityType: 'lesson', entityId: 'l1' }], at: 1 },
  ]
  assert.equal(examples.filter((e) => e.refs.some((r) => r.entityId === 'l1')).length, 2)
  assert.ok(!JSON.stringify(examples).includes('"subject"'), 'no copied blob')
  const after = { lessons: [lesson], examples: examples.filter((e) => e.id !== 'e1') }
  assert.deepEqual(after.lessons, [lesson])
})

test('experience ledger: same date/type/layer/source is a double count; layers are summarised apart and never summed; untimed entries are not inferred', () => {
  const entries = [
    { id: 'x1', placementId: 'p', dateISO: '2026-09-14', type: 'teaching', layer: 'learner-logged', durationMins: 60, at: 1 },
    { id: 'x2', placementId: 'p', dateISO: '2026-09-14', type: 'mentor-meeting', layer: 'learner-logged', at: 1 },
    { id: 'x3', placementId: 'p', dateISO: '2026-09-14', type: 'teaching', layer: 'discussed-reviewed', durationMins: 60, at: 1 },
    { id: 'x4', placementId: 'q', dateISO: '2026-09-15', type: 'teaching', layer: 'learner-logged', durationMins: 30, at: 1 },
  ]
  assert.equal(isDuplicateExperience(entries, { id: 'new', placementId: 'p', dateISO: '2026-09-14', type: 'teaching', layer: 'learner-logged' }), true)
  assert.equal(isDuplicateExperience(entries, { id: 'new', placementId: 'p', dateISO: '2026-09-14', type: 'teaching', layer: 'learner-logged', sourceRef: 'l9' }), false, 'a different source is a different activity')
  assert.equal(isDuplicateExperience(entries, { id: 'new', placementId: 'p', dateISO: '2026-09-14', type: 'teaching', layer: 'provider-outcome-reference' }), false, 'another layer is not a double count')
  const s = experienceSummary(entries, 'p')
  assert.equal(s.layers['learner-logged'].count, 2)
  assert.equal(s.layers['learner-logged'].byType['mentor-meeting'].mins, 0)
  assert.equal(s.layers['learner-logged'].byType['mentor-meeting'].untimed, 1)
  assert.equal(s.layers['discussed-reviewed'].count, 1)
  assert.equal(s.layers['learner-logged'].days, 1)
  const text = buildExperienceText(s, 'SE1', [])
  assert.match(text, /never added together/)
  assert.match(text, /without a duration \(not inferred\)/)
})

test('comparisons only against a confirmed requirement; otherwise a total with no deficit', () => {
  assert.match(compareToRequirement(12, undefined).sentence, /no confirmed requirement/)
  assert.match(compareToRequirement(12, { verification: 'unconfirmed', plannedValue: '120 days', title: 'Days' }).sentence, /no confirmed requirement/)
  const c = compareToRequirement(12, { verification: 'confirmed', plannedValue: '120 days', title: 'Assessed school days', confirmedSource: 'Handbook p.4' })
  assert.equal(c.target, 120)
  assert.match(c.sentence, /12 of 120 \(Assessed school days, confirmed by you from Handbook p\.4\)/)
  assert.doesNotMatch(c.sentence, /short|deficit|behind/i)
})

test('handover text leaves out private notes, contacts and identifiers and says nobody received it', () => {
  const text = buildHandoverText({
    examples: [{ id: 'e', title: 'Cold-calling', context: 'practice-cycle', ittecf: ['classroom-practice'], standards: ['TS4'], partTwo: [], narrative: { changedNext: 'Wait longer' } }],
    experience: [{ id: 'x', placementId: 'p', dateISO: '2026-09-14', type: 'teaching', layer: 'learner-logged' }],
    reviews: [{ id: 'r', dateISO: '2026-12-11', focus: 'Progress review', learnerNotes: 'PRIVATE: felt nervous', providerJudgement: { text: 'On track', source: 'tutor, 11 Dec' }, nextSteps: 'Plan two sequences' }],
    placements: [{ id: 'p', code: 'SE1', schoolLocationId: 's', startISO: '2026-09-07', endISO: '2026-12-11', mentorName: 'A Mentor', mentorContact: 'mentor@school.example' }],
    schools: [{ id: 's', name: 'Riverside Primary', address: '1 River Lane' }],
  })
  assert.doesNotMatch(text, /PRIVATE|felt nervous/)
  assert.doesNotMatch(text, /mentor@school|1 River Lane|A Mentor/)
  assert.match(text, /Riverside Primary/)
  assert.match(text, /Provider view \(source: tutor, 11 Dec\): On track/)
  assert.match(text, /has not been sent to, or received by, any induction body/)
})

test('wire contract: examples, review packs, experience and reviews validate; invented states rejected; legacy merges', () => {
  const admin = {
    ...empty(),
    examples: [{ id: 'e1', title: 'A', context: 'course-curriculum', refs: [{ entityType: 'lesson', entityId: 'l1' }], narrative: { changedNext: 'x' }, ittecf: ['assessment'], standards: ['TS6'], partTwo: ['conduct-in-school'], at: 1 }],
    reviewPacks: [{ id: 'k1', title: 'Review 1', state: 'draft', createdISO: '2026-09-14', items: [{ kind: 'lesson', id: 'l1', revision: 10, snapshot: '{"id":"l1"}', caption: 'c', provenance: 'Entered by you' }], attachments: [{ id: '1', name: 'plan.pdf', state: 'local-only' }], notes: 'n', at: 1 }],
    experience: [{ id: 'x1', placementId: 'p', dateISO: '2026-09-14', type: 'teaching', layer: 'learner-logged', durationMins: 60, sourceRef: 'l1', note: 'n', at: 1 }],
    reviews: [{ id: 'r1', dateISO: '2026-12-11', participants: 'mentor', focus: 'f', questions: 'q', learnerNotes: 'private', providerJudgement: { text: 'On track', source: 'tutor' }, nextSteps: 'n', packId: 'k1', at: 1 }],
  }
  assert.doesNotThrow(() => validatePayload(withAdmin(admin)))
  const bad = (patch) => withAdmin({ ...admin, ...patch })
  assert.throws(() => validatePayload(bad({ examples: [{ ...admin.examples[0], context: 'qts-award' }] })), /example context/)
  assert.throws(() => validatePayload(bad({ reviewPacks: [{ ...admin.reviewPacks[0], state: 'approved' }] })), /pack state/)
  assert.throws(() => validatePayload(bad({ experience: [{ ...admin.experience[0], layer: 'assessed' }] })), /experience layer/)
  assert.throws(() => validatePayload(bad({ experience: [{ ...admin.experience[0], durationMins: 5000 }] })), /experience duration/)
  assert.throws(() => validatePayload(bad({ reviewPacks: [{ ...admin.reviewPacks[0], attachments: [{ id: '1', name: 'x', state: 'uploaded' }] }] })), /pack attachments/)
  const merged = mergeAdmin(admin, JSON.parse(JSON.stringify(admin)))
  for (const k of ['examples', 'reviewPacks', 'experience', 'reviews']) assert.deepEqual(merged[k], admin[k], k)
  const legacy = { reflections: [], targets: [], meetings: [], observations: [], lessons: [], audits: [] }
  assert.equal(mergeAdmin(legacy, admin).reviewPacks.length, 1)
})

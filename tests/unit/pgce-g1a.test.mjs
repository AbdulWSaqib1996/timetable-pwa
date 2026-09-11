import test from 'node:test'
import assert from 'node:assert/strict'
import { applyProgrammePack, diffProgrammePack, roadmapSummary, validateProgrammePack } from '../../shared/programme.js'
import { collections, validatePayload } from '../../shared/contracts.js'
import { mergeAdmin } from '../../shared/merge.js'

/**
 * G1a (Pass 69) — PG-01 programme packs: validation, diff preview, apply
 * semantics (confirmation kept only when unchanged; done milestones never
 * move; historical pack versions pinned), the roadmap summary, and the wire
 * contract for the four new collections.
 */

const empty = () => Object.fromEntries(collections.map((k) => [k, []]))
const withAdmin = (admin) => ({ store: { activeId: 'p1', profiles: [{ id: 'p1', name: 'one', settings: { demo: true, sheetId: '', gid: null } }] }, admin: { p1: admin } })

const packV1 = () => ({
  packId: 'ucl-primary-2026',
  label: 'UCL Primary PGCE handbook',
  ownerSource: 'provider',
  url: 'https://example.org/handbook',
  version: 1,
  requirements: [
    { key: 'school-days', section: 'School experience', title: 'Assessed school days', plannedValue: '120 days' },
    { key: 'observations', section: 'School experience', title: 'Formal observations per placement', plannedValue: '6' },
  ],
  milestones: [
    { key: 'review-1', kind: 'review', title: 'Progress review 1', date: '2026-12-11' },
    { key: 'essay-1', kind: 'academic', title: 'Assignment 1 hand-in', date: '2026-11-20' },
  ],
})

test('a pack validates as a whitelist rebuild; bad shapes list every error and invent nothing', () => {
  const ok = validateProgrammePack(packV1())
  assert.equal(ok.ok, true)
  assert.deepEqual(Object.keys(ok.pack).sort(), ['label', 'milestones', 'ownerSource', 'packId', 'requirements', 'url', 'version'])
  const bad = validateProgrammePack({ ...packV1(), version: 0, ownerSource: 'ai', requirements: [{ key: 'school days', section: '', title: 'x' }, { key: 'a', section: 's', title: 't', effectiveFrom: '20-01-01' }] })
  assert.equal(bad.ok, false)
  assert.ok(bad.errors.some((e) => e.startsWith('version')))
  assert.ok(bad.errors.some((e) => e.startsWith('ownerSource')))
  assert.ok(bad.errors.some((e) => e.includes('requirements[0].key')))
  assert.ok(bad.errors.some((e) => e.includes('requirements[0].section')))
  assert.ok(bad.errors.some((e) => e.includes('requirements[1].effectiveFrom')))
  assert.equal(validateProgrammePack('nope').ok, false)
  assert.equal(validateProgrammePack({ ...packV1(), requirements: [{ key: 'a', section: 's', title: 't' }, { key: 'a', section: 's', title: 'u' }] }).ok, false, 'duplicate keys rejected')
})

test('apply v1 then v2: unchanged requirements keep confirmation, changed ones lose it, removed ones go, done milestones never move, versions pinned', () => {
  const { pack: v1 } = validateProgrammePack(packV1())
  const first = applyProgrammePack(v1, { packs: [], requirements: [], milestones: [] }, 1000)
  assert.equal(first.packs.length, 1)
  assert.equal(first.requirements.length, 2)
  assert.ok(first.requirements.every((r) => r.verification === 'unconfirmed' && r.packVersion === 1))
  assert.equal(first.milestones.length, 2)
  // The learner confirms one requirement and holds the review.
  const confirmed = first.requirements.map((r) => (r.id === 'ucl-primary-2026:observations' ? { ...r, verification: 'confirmed', confirmedSource: 'Handbook p.12', confirmedAt: 2000 } : r))
  const held = first.milestones.map((m) => (m.id === 'ucl-primary-2026:m:review-1' ? { ...m, state: 'done', doneISO: '2026-12-11' } : m))
  // v2 changes the days wording, drops nothing, adds one, moves both milestones.
  const v2raw = packV1()
  v2raw.version = 2
  v2raw.requirements[0].plannedValue = '120 days (min.)'
  v2raw.requirements.push({ key: 'itap', section: 'Training', title: 'Intensive training and practice', plannedValue: '4 weeks' })
  v2raw.milestones[0].date = '2026-12-18'
  v2raw.milestones[1].date = '2026-11-27'
  const { pack: v2 } = validateProgrammePack(v2raw)
  const diff = diffProgrammePack(v2, confirmed, held)
  assert.deepEqual([diff.added.length, diff.changed.length, diff.unchanged.length, diff.removed.length], [1, 1, 1, 0])
  assert.equal(diff.milestonesMoved.length, 1, 'only the planned milestone moves')
  assert.equal(diff.milestonesKept.length, 1, 'the held review keeps its date')
  const second = applyProgrammePack(v2, { packs: first.packs, requirements: confirmed, milestones: held }, 3000)
  const byId = Object.fromEntries(second.requirements.map((r) => [r.id, r]))
  assert.equal(byId['ucl-primary-2026:observations'].verification, 'confirmed')
  assert.equal(byId['ucl-primary-2026:observations'].confirmedSource, 'Handbook p.12')
  assert.equal(byId['ucl-primary-2026:observations'].packVersion, 2)
  assert.equal(byId['ucl-primary-2026:school-days'].verification, 'unconfirmed', 'wording changed → confirmation cleared')
  assert.equal(byId['ucl-primary-2026:school-days'].plannedValue, '120 days (min.)')
  assert.equal(byId['ucl-primary-2026:itap'].section, 'Training')
  const ms = Object.fromEntries(second.milestones.map((m) => [m.id, m]))
  assert.equal(ms['ucl-primary-2026:m:review-1'].dateISO, '2026-12-11', 'done review pinned to the date it was held')
  assert.equal(ms['ucl-primary-2026:m:review-1'].packVersion, 1, 'historical review keeps its pack version')
  assert.equal(ms['ucl-primary-2026:m:essay-1'].dateISO, '2026-11-27')
  assert.equal(ms['ucl-primary-2026:m:essay-1'].packVersion, 2)
  assert.equal(second.packs[0].version, 2)
  // Re-applying v2 is a no-op for content.
  const third = applyProgrammePack(v2, second, 4000)
  assert.deepEqual(third.requirements.map((r) => [r.id, r.verification, r.plannedValue]).sort(), second.requirements.map((r) => [r.id, r.verification, r.plannedValue]).sort())
})

test('another pack is untouched by reference when one pack is applied', () => {
  const { pack: a } = validateProgrammePack({ ...packV1(), packId: 'a' })
  const { pack: b } = validateProgrammePack({ ...packV1(), packId: 'b', label: 'School pack', ownerSource: 'school' })
  const one = applyProgrammePack(a, { packs: [], requirements: [], milestones: [] }, 1)
  const two = applyProgrammePack(b, one, 2)
  for (const r of one.requirements) assert.ok(two.requirements.includes(r), 'same object kept')
  for (const m of one.milestones) assert.ok(two.milestones.includes(m))
})

test('roadmap summary: two pathways, one next review, unconfirmed count; nothing invents a target', () => {
  const reqs = [{ id: 'r1', verification: 'unconfirmed' }, { id: 'r2', verification: 'confirmed' }]
  const ms = [
    { id: 'm1', kind: 'academic', title: 'Essay', dateISO: '2026-11-20', state: 'planned' },
    { id: 'm2', kind: 'academic', title: 'Old essay', dateISO: '2026-09-01', state: 'done' },
    { id: 'm3', kind: 'review', title: 'Review 1', dateISO: '2026-12-11', state: 'planned' },
    { id: 'm4', kind: 'review', title: 'Review 0', dateISO: '2026-09-01', state: 'planned' },
    { id: 'm5', kind: 'training', title: 'ITAP', dateISO: '2027-01-10', state: 'planned' },
  ]
  const s = roadmapSummary(reqs, ms, '2026-09-11')
  assert.equal(s.academic.next.title, 'Essay')
  assert.deepEqual([s.academic.done, s.academic.total], [1, 2])
  assert.equal(s.training.next.title, 'ITAP')
  assert.equal(s.nextReview.title, 'Review 1', 'a past, unmarked review is not "next" and is not marked done')
  assert.equal(s.unconfirmed, 1)
  assert.equal(s.requirements, 2)
  const none = roadmapSummary([], [], '2026-09-11')
  assert.equal(none.nextReview, null)
  assert.equal(none.unconfirmed, 0)
})

test('the wire contract validates programmes, packs, requirements and milestones and rejects invented states', () => {
  const admin = {
    ...empty(),
    programmes: [{ id: 'course', route: 'pgce-qts', phase: 'primary', mode: 'full-time', providerLabel: 'UCL', academicYear: '2026/27', at: 1 }],
    packs: [{ id: 'p', label: 'Handbook', ownerSource: 'provider', version: 1, url: 'https://example.org', importedAt: 1, at: 1 }],
    requirements: [{ id: 'p:a', packId: 'p', packVersion: 1, section: 'S', title: 'T', plannedValue: '120 days', verification: 'confirmed', confirmedSource: 'Handbook', confirmedAt: 1, at: 1 }],
    milestones: [{ id: 'p:m:x', packId: 'p', packVersion: 1, kind: 'review', title: 'R', dateISO: '2026-12-11', state: 'done', doneISO: '2026-12-11', at: 1 }],
  }
  assert.doesNotThrow(() => validatePayload(withAdmin(admin)))
  const bad = (patch) => withAdmin({ ...admin, ...patch })
  assert.throws(() => validatePayload(bad({ programmes: [{ id: 'course', route: 'apprenticeship', at: 1 }] })), /programme route/)
  assert.throws(() => validatePayload(bad({ packs: [{ ...admin.packs[0], ownerSource: 'ai' }] })), /pack owner/)
  assert.throws(() => validatePayload(bad({ requirements: [{ ...admin.requirements[0], verification: 'verified' }] })), /verification/)
  assert.throws(() => validatePayload(bad({ milestones: [{ ...admin.milestones[0], state: 'missed' }] })), /milestone state/)
  assert.throws(() => validatePayload(bad({ milestones: [{ ...admin.milestones[0], dateISO: 'soon' }] })), /admin date/)
  // Legacy files (no programme collections) still merge.
  const legacy = { reflections: [], targets: [], meetings: [], observations: [], lessons: [], audits: [] }
  assert.equal(mergeAdmin(legacy, admin).requirements.length, 1)
})

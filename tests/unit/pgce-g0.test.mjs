import test from 'node:test'
import assert from 'node:assert/strict'
import { ADMIN_SCHEMA_VERSION, clientSourceTypes, collections, optionalCollections, validatePayload } from '../../shared/contracts.js'
import { mergeAdmin } from '../../shared/merge.js'

/**
 * G0 (Pass 68) — placement entity, typed links, provenance and schema
 * versioning on the wire contract and the merge.
 */

const empty = () => Object.fromEntries(collections.map((k) => [k, []]))
const basePayload = () => ({
  store: { activeId: 'p1', profiles: [{ id: 'p1', name: 'one', settings: { demo: true, sheetId: '', gid: null } }] },
})
const withAdmin = (admin) => ({ ...basePayload(), admin: { p1: admin } })

test('placements and schools are optional collections: legacy and Phase-5 payloads still validate', () => {
  assert.ok(collections.includes('placements') && collections.includes('schools'))
  assert.ok(optionalCollections.includes('placements') && optionalCollections.includes('schools'))
  const phase5 = { reflections: [], targets: [], meetings: [], observations: [], lessons: [], audits: [], tasks: [], exceptions: [], plans: [], commitments: [] }
  assert.doesNotThrow(() => validatePayload(withAdmin(phase5)))
  const legacy = { reflections: [], targets: [], meetings: [], observations: [], lessons: [], audits: [] }
  assert.doesNotThrow(() => validatePayload(withAdmin(legacy)))
})

test('a placement record validates: code, block mapping, hours, dates, school link; bad shapes are rejected', () => {
  const school = { id: 's1', name: 'Riverside Primary', address: '1 River Lane', lat: 51.5, lng: -0.1, confirmedAt: 5, entranceNote: 'Side gate', at: 1 }
  const placement = { id: 'pl1', code: 'SE1', schoolLocationId: 's1', startISO: '2026-10-05', endISO: '2026-12-11', mappedBlockTags: ['SE1A', 'SE1B'], mentorName: 'A Mentor', workingHours: { start: '08:15', end: '16:00' }, insetCountsAsSchoolDay: true, arrivalBufferMins: 15, notes: '', at: 1 }
  assert.doesNotThrow(() => validatePayload(withAdmin({ ...empty(), placements: [placement], schools: [school] })))
  const bad = (patch) => withAdmin({ ...empty(), placements: [placement], schools: [school], ...patch })
  assert.throws(() => validatePayload(bad({ placements: [{ ...placement, code: 'not a code!' }] })), /placement code/)
  assert.throws(() => validatePayload(bad({ placements: [{ ...placement, endISO: '2026-10-01' }] })), /end after/)
  assert.throws(() => validatePayload(bad({ placements: [{ ...placement, workingHours: { start: '25:00', end: '16:00' } }] })), /hours/)
  assert.throws(() => validatePayload(bad({ placements: [{ ...placement, arrivalBufferMins: 999 }] })), /buffer/)
  assert.throws(() => validatePayload(bad({ placements: [{ ...placement, mappedBlockTags: 'SE1A' }] })), /mapping/)
  assert.throws(() => validatePayload(bad({ schools: [{ ...school, lat: 120 }] })), /coordinates/)
  assert.throws(() => validatePayload(bad({ schools: [{ id: 's1', at: 1 }] })), /admin/i)
})

test('typed placement links on lessons, observations and meetings are format-checked; provenance is client-limited', () => {
  const ok = { ...empty(),
    lessons: [{ id: 'l1', dateISO: '2026-10-06', classGroup: '4B', subject: 'Maths', evaluation: '', standards: [], placementId: 'pl1', at: 1 }],
    meetings: [{ id: 'm1', dateISO: '2026-10-06', discussed: 'Targets', actions: [], placementId: 'pl1', at: 1 }],
    observations: [{ id: 'o1', dateISO: '2026-10-07', observer: 'Mentor', subject: 'Maths', focus: '', strengths: '', development: '', placementId: 'pl1', sourceType: 'learner-entered', at: 1 }],
  }
  assert.doesNotThrow(() => validatePayload(withAdmin(ok)))
  // A dangling id is allowed on the wire (rendered as Unassigned), a malformed one is not.
  assert.doesNotThrow(() => validatePayload(withAdmin({ ...ok, lessons: [{ ...ok.lessons[0], placementId: 'gone' }] })))
  assert.throws(() => validatePayload(withAdmin({ ...ok, lessons: [{ ...ok.lessons[0], placementId: 'has spaces' }] })), /placement link/)
  assert.deepEqual([...clientSourceTypes], ['personal-reflection', 'learner-entered'])
  assert.doesNotThrow(() => validatePayload(withAdmin({ ...ok, observations: [{ ...ok.observations[0], sourceType: 'personal-reflection' }] })))
  assert.throws(() => validatePayload(withAdmin({ ...ok, observations: [{ ...ok.observations[0], sourceType: 'reviewer-authenticated' }] })), /provenance/)
})

test('a profile with three placements round-trips the wire contract and a merge unchanged', () => {
  const codes = ['SE1', 'SE2', 'SE3']
  const schools = codes.map((c, i) => ({ id: 's' + i, name: 'School ' + c, at: 1 }))
  const placements = codes.map((c, i) => ({ id: 'pl' + i, code: c, schoolLocationId: 's' + i, mappedBlockTags: [c + 'A'], at: 1 }))
  const admin = { ...empty(), schemaVersion: 2, placements, schools }
  const payload = withAdmin(admin)
  assert.doesNotThrow(() => validatePayload(payload))
  assert.deepEqual(JSON.parse(JSON.stringify(payload)).admin.p1.placements, placements)
  const merged = mergeAdmin(admin, JSON.parse(JSON.stringify(admin)))
  assert.deepEqual(merged.placements, placements)
  assert.deepEqual(merged.schools, schools)
})

test('schemaVersion is accepted when sane and rejected when not', () => {
  assert.equal(ADMIN_SCHEMA_VERSION, 2)
  assert.doesNotThrow(() => validatePayload(withAdmin({ ...empty(), schemaVersion: 2 })))
  assert.doesNotThrow(() => validatePayload(withAdmin({ ...empty(), schemaVersion: 7 })))
  assert.throws(() => validatePayload(withAdmin({ ...empty(), schemaVersion: 'two' })), /schema version/)
  assert.throws(() => validatePayload(withAdmin({ ...empty(), schemaVersion: 0 })), /schema version/)
})

test('mergeAdmin merges placements and schools per record with tombstones, and never drops unknown newer fields', () => {
  const a = { ...empty(), schemaVersion: 2, placements: [{ id: 'pl1', code: 'SE1', mappedBlockTags: ['SE1A'], at: 5 }], schools: [{ id: 's1', name: 'Riverside', at: 5 }] }
  const b = { ...empty(), schemaVersion: 3, futureCollection: [{ id: 'x', at: 9 }], futureFlag: true,
    placements: [{ id: 'pl1', code: 'SE1', mappedBlockTags: ['SE1A', 'SE1B'], at: 8 }, { id: 'pl2', code: 'SE2', mappedBlockTags: [], at: 8 }],
    schools: [], deleted: { 'schools:s1': 9 } }
  const merged = mergeAdmin(a, b)
  assert.deepEqual(merged.placements.map((p) => [p.id, p.mappedBlockTags.join('+')]), [['pl1', 'SE1A+SE1B'], ['pl2', '']])
  assert.deepEqual(merged.schools, [], 'newer tombstone removes the school')
  assert.equal(merged.deleted['schools:s1'], 9)
  // A field this build has never heard of survives the merge, remote-first.
  assert.deepEqual(merged.futureCollection, [{ id: 'x', at: 9 }])
  assert.equal(merged.futureFlag, true)
  assert.equal(merged.schemaVersion, 3)
  // …and in the other direction: local-only unknown fields survive when the remote lacks them.
  const back = mergeAdmin(b, a)
  assert.deepEqual(back.futureCollection, [{ id: 'x', at: 9 }])
  assert.equal(back.schemaVersion, 2, 'present on both sides: the second argument wins, as for settings')
  // Older payloads with no placements collection merge as empty, not as an error.
  const legacy = { reflections: [], targets: [], meetings: [], observations: [], lessons: [], audits: [] }
  assert.doesNotThrow(() => mergeAdmin(legacy, a))
  assert.equal(mergeAdmin(legacy, a).placements.length, 1)
})

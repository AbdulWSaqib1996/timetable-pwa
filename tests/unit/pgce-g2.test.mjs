import test from 'node:test'
import assert from 'node:assert/strict'
import { formatMins, planWorkload, proposalsToBlocks, remainingEffort } from '../../shared/workload.js'
import { collections, validatePayload } from '../../shared/contracts.js'
import { mergeAdmin } from '../../shared/merge.js'

/**
 * G2 (Pass 71) — workload arithmetic over the existing plan model (protected
 * time never filled, no duplicate scheduling, deadline changes recompute,
 * unknown estimates stay unknown) and the wire contract for the new
 * knowledge, academic and support collections.
 */

const empty = () => Object.fromEntries(collections.map((k) => [k, []]))
const withAdmin = (admin) => ({ store: { activeId: 'p1', profiles: [{ id: 'p1', name: 'one', settings: { demo: true, sheetId: '', gid: null } }] }, admin: { p1: admin } })
const T = '2026-09-14' // a Monday
const fixture = () => ({
  todayISO: T,
  busy: [{ d: T, from: 9 * 60, to: 15 * 60, label: 'School', kind: 'session' }, { d: '2026-09-15', from: 9 * 60, to: 15 * 60, label: 'School', kind: 'session' }],
  protectedWindows: [{ id: 'w', day: 1, start: '18:00', end: '20:00', label: 'Family' }],
  tasks: [{ id: 't1', title: 'Essay', dueISO: '2026-09-16', status: 'todo' }, { id: 't2', title: 'Reading', dueISO: '2026-09-20', status: 'todo' }],
  plans: [{ id: 'a', parentId: 't1', kind: 'subtask', title: 'Outline', effortMins: 120 }, { id: 'b', parentId: 't1', kind: 'subtask', title: 'Draft', effortMins: 180 }],
})

test('remaining effort: estimates on undone children minus future blocks; no estimate is unknown (null), never zero', () => {
  const plans = [{ id: 'a', parentId: 't', kind: 'subtask', effortMins: 60 }, { id: 'd', parentId: 't', kind: 'subtask', effortMins: 60, done: true }, { id: 'b', parentId: 't', kind: 'block', dateISO: '2026-09-20', startTime: '10:00', endTime: '10:30' }, { id: 'old', parentId: 't', kind: 'block', dateISO: '2026-09-01', startTime: '10:00', endTime: '12:00' }]
  assert.equal(remainingEffort({ id: 't' }, plans, T), 30)
  assert.equal(remainingEffort({ id: 'x' }, plans, T), null)
  assert.equal(formatMins(150), '2 h 30 m')
  assert.equal(formatMins(120), '2 h')
})

test('proposals never touch protected time or travel buffers, respect due dates, and are earliest-deadline-first', () => {
  const r = planWorkload(fixture())
  assert.equal(r.needed, 300)
  assert.deepEqual(r.unknown.map((u) => u.title), ['Reading'])
  for (const p of r.proposals) {
    assert.equal(p.taskId, 't1')
    assert.ok(p.dateISO <= '2026-09-16', 'never after the due date')
    const from = +p.startTime.slice(0, 2) * 60 + +p.startTime.slice(3)
    const to = +p.endTime.slice(0, 2) * 60 + +p.endTime.slice(3)
    const dow = new Date(p.dateISO + 'T00:00:00Z').getUTCDay()
    if (dow === 1) assert.ok(to <= 18 * 60 || from >= 20 * 60, 'Monday 18–20 is protected')
    if (p.dateISO === T || p.dateISO === '2026-09-15') assert.ok(to <= 9 * 60 - 15 || from >= 15 * 60 + 15, 'travel buffer around the school day')
  }
  assert.equal(r.proposals.reduce((n, p) => n + p.effortMins, 0), 300)
  assert.equal(r.unallocated, 0)
  assert.ok(r.protectedMins > 0)
})

test('no duplicate scheduling: accepted blocks count as planned and are not proposed again; undo restores the previous plans', () => {
  const f = fixture()
  const first = planWorkload(f)
  const { blocks, ids } = proposalsToBlocks(first.proposals, (() => { let n = 0; return () => `blk${n++}` })(), 1)
  const after = planWorkload({ ...f, plans: [...f.plans, ...blocks], busy: [...f.busy, ...blocks.map((b) => ({ d: b.dateISO, from: +b.startTime.slice(0, 2) * 60 + +b.startTime.slice(3), to: +b.endTime.slice(0, 2) * 60 + +b.endTime.slice(3), label: b.title, kind: 'plan' }))] })
  assert.equal(after.proposals.length, 0, 'nothing left to propose')
  assert.equal(after.alreadyScheduled, 300)
  assert.equal(after.needed, 0)
  const undone = [...f.plans, ...blocks].filter((p) => !ids.includes(p.id))
  assert.deepEqual(undone, f.plans)
  assert.equal(planWorkload({ ...f, plans: undone }).proposals.length, first.proposals.length)
})

test('a deadline change recomputes the proposals (no acceptance happens by itself); an impossible deadline reports the gap', () => {
  const f = fixture()
  const soon = planWorkload({ ...f, tasks: [{ ...f.tasks[0], dueISO: T }, f.tasks[1]] })
  assert.ok(soon.proposals.every((p) => p.dateISO === T))
  assert.ok(soon.unallocated > 0, 'not enough free time today → an honest gap')
  assert.equal(formatMins(soon.unallocated).length > 0, true)
  const later = planWorkload({ ...f, tasks: [{ ...f.tasks[0], dueISO: '2026-09-25' }, f.tasks[1]] })
  assert.equal(later.unallocated, 0)
  assert.notDeepEqual(soon.proposals, later.proposals)
})

test('wire contract: goals, resources, projects, readings, contacts, questions, protected windows and support notes validate; invented states rejected', () => {
  const admin = {
    ...empty(),
    goals: [{ id: 'g1', topic: 'Fractions as division', strand: 'breadth', question: 'Why does ¾ = 3 ÷ 4?', confidence: [{ dateISO: '2026-09-14', level: 3, note: 'read chapter 2' }], resourceRefs: ['r1'], lessonRef: 'l1', nextReviewISO: '2026-09-28', state: 'open', legacyAuditId: 'a1', at: 1 }],
    resources: [{ id: 'r1', title: 'NCETM fractions spine', url: 'https://example.org/spine', note: 'ch. 2', at: 1 }],
    projects: [{ id: 'p1', title: 'Assignment 1', brief: 'b', criteria: 'c', deadlineRef: 'evt-1', words: 3000, credits: 30, status: 'result', submittedISO: '2026-11-20', feedback: { text: 'Good structure', source: 'tutor email 1 Dec' }, result: { text: 'Pass', source: 'portal 15 Dec' }, enquiry: { context: 'Y2 maths', consent: 'letters sent' }, at: 1 }],
    readings: [{ id: 'n1', projectId: 'p1', kind: 'quotation', text: 'Fractions are numbers', source: 'Author (2020)', page: '12', at: 1 }],
    tasks: [{ id: 't1', title: 'Outline', dueISO: '2026-10-01', status: 'todo', projectId: 'p1', at: 1 }],
    contacts: [{ id: 'c1', name: 'A Tutor', role: 'academic tutor', contact: 'a.tutor@example.org', at: 1 }],
    questions: [{ id: 'q1', text: 'Which referencing style?', askedTo: 'tutor', answered: true, answer: 'Harvard', at: 1 }],
    protected: [{ id: 'w1', day: 1, start: '18:00', end: '20:00', label: 'Family', at: 1 }],
    supportNotes: [{ id: 'agenda', text: 'Workload in November', at: 1 }],
  }
  assert.doesNotThrow(() => validatePayload(withAdmin(admin)))
  const bad = (patch) => withAdmin({ ...admin, ...patch })
  assert.throws(() => validatePayload(bad({ goals: [{ ...admin.goals[0], state: 'mastered' }] })), /goal state/)
  assert.throws(() => validatePayload(bad({ goals: [{ ...admin.goals[0], confidence: [{ dateISO: '2026-09-14', level: 7 }] }] })), /confidence/)
  assert.throws(() => validatePayload(bad({ projects: [{ ...admin.projects[0], status: 'awarded' }] })), /project status/)
  assert.throws(() => validatePayload(bad({ readings: [{ ...admin.readings[0], kind: 'summary' }] })), /reading note kind/)
  assert.throws(() => validatePayload(bad({ protected: [{ ...admin.protected[0], start: '20:00', end: '18:00' }] })), /protected window/)
  assert.throws(() => validatePayload(bad({ questions: [{ ...admin.questions[0], answered: 'yes' }] })), /question state/)
  // Round trip: a merge with a copy leaves every new collection intact (backup/restore copies the raw file).
  const merged = mergeAdmin(admin, JSON.parse(JSON.stringify(admin)))
  for (const k of ['goals', 'resources', 'projects', 'readings', 'contacts', 'questions', 'protected', 'supportNotes']) assert.deepEqual(merged[k], admin[k], k)
  const legacy = { reflections: [], targets: [], meetings: [], observations: [], lessons: [], audits: [] }
  assert.equal(mergeAdmin(legacy, admin).goals.length, 1)
})

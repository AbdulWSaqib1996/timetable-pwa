import test from 'node:test'
import assert from 'node:assert/strict'
import { collections, validatePayload } from '../../shared/contracts.js'
import { applyChanges, basisHash, nextWeekFixed, reviewWeeks, thisWeekSummary, undoBatch, weeklyReview } from '../../shared/weeklyReview.js'

/**
 * Audit D2 (Pass 84) — E02 weekly review over the workload planner: this
 * week's planned/logged/open, next week's fixed time (placement travel and
 * protected time named), a diff of moved/added/untouched/kept blocks, accept
 * twice never duplicates, Undo touches only its batch, a late finish reduces
 * free time, missing effort stays unknown; and E03's contract additions.
 */

const empty = () => Object.fromEntries(collections.map((k) => [k, []]))
const withAdmin = (admin) => ({ store: { activeId: 'p1', profiles: [{ id: 'p1', name: 'one', settings: { demo: true, sheetId: '', gid: null } }] }, admin: { p1: admin } })
// Wednesday 16 September 2026: this week is 14–20, next week 21–27.
const today = '2026-09-16'
const task = (id, title, dueISO, effort) => ({ id, title, dueISO, status: 'todo', at: 1, ...(effort ? { effortMins: effort } : {}) })
const sub = (id, parentId, effortMins) => ({ id, parentId, kind: 'subtask', title: 'part', effortMins, at: 1 })
const block = (id, parentId, dateISO, startTime, endTime, extra = {}) => ({ id, parentId, kind: 'block', title: 'Essay', dateISO, startTime, endTime, effortMins: 60, at: 1, ...extra })
const session = (d, from, to, label = 'Maths 1') => ({ d, from, to, label, kind: 'session' })

test('weeks, this week planned/logged/open, and effort unknown is never guessed', () => {
  assert.deepEqual(reviewWeeks(today), { fromISO: '2026-09-14', toISO: '2026-09-20', nextFromISO: '2026-09-21', nextToISO: '2026-09-27' })
  const tasks = [task('t1', 'Essay', '2026-09-30'), task('t2', 'Reading', '2026-10-02')]
  const plans = [sub('s1', 't1', 300), block('b1', 't1', '2026-09-15', '17:00', '18:00', { done: true }), block('b2', 't1', '2026-09-17', '17:00', '18:30')]
  const w = thisWeekSummary({ todayISO: today, tasks, plans })
  assert.equal(w.plannedMins, 150)
  assert.equal(w.loggedMins, 60)
  assert.equal(w.openCount, 2)
  assert.equal(w.openTasks.find((t) => t.id === 't2').remaining, null, 'no estimate → unknown, not zero')
  assert.equal(w.openTasks.find((t) => t.id === 't1').remaining, 300 - 90, 'the engine counts future blocks (today onward) as scheduled')
})

test('next week names placement travel and protected time as fixed, and a late finish at school reduces free time', () => {
  const busy = [session('2026-09-21', 8 * 60 + 30, 15 * 60 + 30, 'School Experience SE1a'), session('2026-09-22', 9 * 60, 11 * 60)]
  const base = nextWeekFixed({ todayISO: today, busy, protectedWindows: [{ id: 'p', day: 1, start: '18:00', end: '20:00', label: 'Family', at: 1 }], travel: { bufferMins: 30, isPlacement: (l) => /School Experience/.test(l) } })
  const monday = base.days.find((d) => d.d === '2026-09-21')
  assert.ok(monday.fixed.some((f) => f.kind === 'travel' && f.from === 8 * 60 && f.to === 8 * 60 + 30), 'travel before the first school session')
  assert.ok(monday.fixed.some((f) => f.kind === 'protected' && f.label === 'Protected: Family'))
  const late = nextWeekFixed({ todayISO: today, busy: [session('2026-09-21', 8 * 60 + 30, 17 * 60 + 30, 'School Experience SE1a'), busy[1]], protectedWindows: [{ id: 'p', day: 1, start: '18:00', end: '20:00', label: 'Family', at: 1 }], travel: { bufferMins: 30, isPlacement: (l) => /School Experience/.test(l) } })
  assert.ok(late.freeMins < base.freeMins, 'a late finish leaves less free time')
})

test('the diff: added, untouched, moved on a clash; accepting twice never duplicates; undo reverses only its batch', () => {
  const tasks = [task('t1', 'Essay', '2026-09-30'), task('t2', 'Reading', '2026-10-02')]
  const busy = [session('2026-09-21', 9 * 60, 17 * 60), session('2026-09-22', 9 * 60, 17 * 60), session('2026-09-23', 9 * 60, 17 * 60), session('2026-09-24', 9 * 60, 17 * 60), session('2026-09-25', 9 * 60, 17 * 60)]
  const plans0 = [sub('s1', 't1', 240), sub('s2', 't2', 60)]
  const opts = { start: 8 * 60, end: 20 * 60 }
  const r0 = weeklyReview({ todayISO: today, busy, tasks, plans: plans0, options: opts })
  assert.ok(r0.proposals.length > 0)
  assert.ok(r0.changes.every((c) => c.kind === 'added'), 'nothing exists yet → everything is added')
  let ids = 0
  const makeId = () => `n${++ids}`
  const a1 = applyChanges({ changes: r0.changes, selectedKeys: r0.actionable.map((c) => c.key), makeId, now: 5 })
  const plans1 = [...plans0, ...a1.added]
  const busy1 = [...busy, ...a1.added.map((b) => ({ d: b.dateISO, from: Number(b.startTime.slice(0, 2)) * 60 + Number(b.startTime.slice(3)), to: Number(b.endTime.slice(0, 2)) * 60 + Number(b.endTime.slice(3)), label: b.title, kind: 'plan' }))]
  // Accept again: every block stands untouched and nothing is actionable.
  const r1 = weeklyReview({ todayISO: today, busy: busy1, tasks, plans: plans1, options: opts })
  assert.equal(r1.actionable.length, 0, 'accepting twice never duplicates')
  assert.equal(r1.changes.filter((c) => c.kind === 'untouched').length, a1.added.length)
  assert.equal(applyChanges({ changes: r1.changes, selectedKeys: r1.changes.map((c) => c.key), makeId, now: 6 }).added.length, 0)
  // The timetable changes under one block: a session now covers it → a MOVE naming that block; the rest stay untouched.
  const victim = a1.added[0]
  const m = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3))
  const cover = { d: victim.dateISO, from: m(victim.startTime), to: m(victim.endTime), label: 'Late twilight session', kind: 'session' }
  const r2 = weeklyReview({ todayISO: today, busy: [...busy1, cover], tasks, plans: plans1, options: opts })
  const move = r2.changes.find((c) => c.kind === 'moved')
  assert.ok(move && move.block.id === victim.id, 'the clashing block is the one moved')
  assert.ok(r2.changes.filter((c) => c.kind === 'untouched').length >= a1.added.length - 1)
  // Apply the move and undo it: only this batch's block goes, only its removed block returns.
  const a2 = applyChanges({ changes: r2.changes, selectedKeys: r2.actionable.map((c) => c.key), makeId, now: 7 })
  assert.deepEqual(a2.removedIds, [victim.id])
  const drop = new Set(a2.removedIds)
  const plans3 = [...plans1.filter((p) => !drop.has(p.id)), ...a2.added]
  assert.ok(!plans3.some((p) => p.id === victim.id))
  const restored = undoBatch(plans3, a2.batch)
  assert.deepEqual(restored.map((p) => p.id).sort(), plans1.map((p) => p.id).sort(), 'undo restores exactly the pre-batch plans')
  assert.ok(a1.added.every((b) => restored.some((p) => p.id === b.id)), 'the earlier batch is untouched by this undo')
  // A changed timetable is a different basis.
  assert.notEqual(basisHash(busy), basisHash([...busy, session('2026-09-26', 9 * 60, 12 * 60)]))
})

test('wire contract: weekly reviews and the assignment fields validate; bad shapes are rejected', () => {
  const admin = {
    ...empty(),
    projects: [{ id: 'p1', title: 'Assignment 1', status: 'submitted', outline: [{ id: 'o1', title: 'Intro', done: true }], outlineRevision: 2, outlineAt: 1, drafts: [{ id: 'd1', kind: 'wallet', uid: 'u-1', label: 'Draft 1', at: 1 }, { id: 'd2', kind: 'link', url: 'https://x.example/doc', label: 'Draft 2', at: 1 }], submissions: [{ id: 's1', submittedAt: 1, channel: 'Turnitin', receiptUid: 'u-2', note: 'ref 123' }], feedbackRefs: [{ id: 'f1', kind: 'text', text: 'Good', source: 'tutor', at: 1 }], sources: [{ id: 'r1', title: 'Book', author: 'A', at: 1 }], at: 1 }],
    weeklyReviews: [{ id: 'w1', weekISO: '2026-09-14', reflection: 'ok', proposalRevision: 2, basisHash: 'x', batches: [{ id: 'b1', at: 1, addedIds: ['n1'], removed: [{ id: 'old', parentId: 't1', kind: 'block', title: 'Essay', at: 1 }], changesHash: 'h' }], at: 1 }],
  }
  assert.doesNotThrow(() => validatePayload(withAdmin(admin)))
  const bad = (patch) => withAdmin({ ...admin, ...patch })
  assert.throws(() => validatePayload(bad({ projects: [{ ...admin.projects[0], drafts: [{ id: 'd', kind: 'ftp', label: 'x', at: 1 }] }] })), /project drafts/)
  assert.throws(() => validatePayload(bad({ projects: [{ ...admin.projects[0], submissions: [{ id: 's', channel: 'x' }] }] })), /project submissions/)
  assert.throws(() => validatePayload(bad({ weeklyReviews: [{ ...admin.weeklyReviews[0], batches: [{ id: 'b' }] }] })), /review batch/)
  const legacy = { ...admin }
  delete legacy.weeklyReviews
  assert.doesNotThrow(() => validatePayload(withAdmin(legacy)))
})

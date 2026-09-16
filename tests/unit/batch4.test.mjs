import test from 'node:test'
import assert from 'node:assert/strict'
import { collections, validatePayload } from '../../shared/contracts.js'
import { planWorkload, proposalsToBlocks, remainingEffort } from '../../shared/workload.js'
import { decideChange, detectHomeworkChanges, homeworkPlanItem, makeHomework, reconcileChanges, resolveDue, withStatus } from '../../shared/homework.js'
import { transitionItems, transitionProgress, withDeferral } from '../../shared/transitions.js'
import { referencedUids, relinkUid } from '../../shared/dataCentre.js'

/**
 * Placement review Batch 4 (Pass 89): homework as a plan owner with no
 * duplicate task (NF-02); the change inbox created once per situation and
 * decided at most once (NF-04); "not known yet" transition items with a
 * follow-up date (NF-01); resources by uid that relink (NF-05); the contract.
 */

const keyOf = (s) => s.eventKey
const session = (id, title, dateISO, start = '09:00', extra = {}) => ({ id, title, dateISO, start, end: '11:00', eventKey: `event:${id}`, identityAt: 5, ...extra })
const m1 = session('m1', 'Maths 1', '2026-09-15')
const m2 = session('m2', 'Maths 2', '2026-09-22')
const hw = () => ({ ...makeHomework({ id: 'h1', title: 'Read chapter 3', sourceRef: keyOf(m1), source: m1, target: { key: keyOf(m2), session: m2 }, todayISO: '2026-09-15', now: 100 }), effortMins: 90 })

test('NF-02: homework plans as itself — its effort and subtasks count once, blocks carry the parent kind, and a task with the same id is untouched', () => {
  const h = hw()
  const item = homeworkPlanItem(h, resolveDue(h, [m1, m2], keyOf))
  assert.deepEqual(item, { id: 'h1', planKind: 'homework', title: 'Homework: Read chapter 3', dueISO: '2026-09-22', status: 'todo', effortMins: 90 })
  const task = { id: 'h1', title: 'A task that happens to share the id', dueISO: '2026-09-30', status: 'todo', at: 1 }
  const plans = [
    { id: 'sub', parentId: 'h1', parentKind: 'homework', kind: 'subtask', title: 'Notes', effortMins: 30, at: 1 },
    { id: 'tsub', parentId: 'h1', kind: 'subtask', title: 'Task part', effortMins: 120, at: 1 },
  ]
  assert.equal(remainingEffort(item, plans, '2026-09-15'), 120, 'own 90 + its own subtask 30; the task subtask is not its child')
  assert.equal(remainingEffort(task, plans, '2026-09-15'), 120, 'the task sees only its own child')
  const busy = ['16', '17', '18'].map((d) => ({ d: `2026-09-${d}`, from: 9 * 60, to: 17 * 60, label: 'x', kind: 'session' }))
  const r = planWorkload({ todayISO: '2026-09-15', busy, tasks: [item, task], plans, options: { start: 8 * 60, end: 20 * 60 } })
  const mine = r.proposals.filter((p) => p.taskId === 'h1' && p.parentKind === 'homework')
  assert.ok(mine.length > 0)
  assert.equal(mine.reduce((n, p) => n + p.effortMins, 0), 120, 'exactly the homework effort, no duplicate')
  const { blocks } = proposalsToBlocks(mine, () => 'b', 9)
  assert.equal(blocks[0].parentKind, 'homework')
  // Completing a block is effort, not completion: the record's status is a separate decision.
  assert.equal(withStatus(h, 'done', '2026-09-20', 200).statusHistory[0].status, 'done')
  const reopened = withStatus(withStatus(h, 'done', '2026-09-20', 200), 'todo', '2026-09-21', 300)
  assert.deepEqual(reopened.statusHistory.map((x) => [x.status, !!x.reopened]), [['done', false], ['todo', true]])
})

test('NF-04: a change is raised once per situation, told apart (moved / deadline / missing), decided at most once, and closed when the record settles', () => {
  const h = hw()
  const moved = { ...m2, dateISO: '2026-09-23', identityAt: 6 }
  let changes = detectHomeworkChanges({ homework: [h], changes: [], targets: [m1, moved], all: [m1, moved], keyOf, makeId: () => 'c1', now: 10 })
  assert.equal(changes.length, 1)
  assert.deepEqual([changes[0].kind, changes[0].previous.dateISO, changes[0].current.dateISO, changes[0].sourceRevision], ['moved', '2026-09-22', '2026-09-23', 6])
  // The same situation again raises nothing; a decided change for it stays decided.
  assert.equal(detectHomeworkChanges({ homework: [h], changes, targets: [m1, moved], all: [m1, moved], keyOf, makeId: () => 'c2', now: 11 }).length, 0)
  const decided = decideChange(changes[0], 'follow', 20)
  assert.equal(decideChange(decided, 'keep', 30).decision, 'follow', 'a second decision is a no-op')
  assert.equal(detectHomeworkChanges({ homework: [h], changes: [decided], targets: [m1, moved], all: [m1, moved], keyOf, makeId: () => 'c3', now: 12 }).length, 0)
  // Marked as a deadline (present in the timetable, absent from the eligible targets) vs gone entirely.
  assert.equal(detectHomeworkChanges({ homework: [h], changes: [], targets: [m1], all: [m1, m2], keyOf, makeId: () => 'c4', now: 13 })[0].kind, 'deadline')
  assert.equal(detectHomeworkChanges({ homework: [h], changes: [], targets: [m1], all: [m1], keyOf, makeId: () => 'c5', now: 14 })[0].kind, 'missing')
  // Done homework never asks; once the record follows the session the open change closes with 'follow'.
  assert.equal(detectHomeworkChanges({ homework: [{ ...h, status: 'done' }], changes: [], targets: [m1, moved], all: [m1, moved], keyOf, makeId: () => 'c6', now: 15 }).length, 0)
  const followed = { ...h, dueISO: '2026-09-23', dueSnapshot: { dateISO: '2026-09-23', start: '09:00', title: 'Maths 2', at: 16 } }
  const closed = reconcileChanges({ homework: [followed], changes, targets: [m1, moved], keyOf, now: 17 })
  assert.equal(closed[0].decision, 'follow')
  assert.equal(reconcileChanges({ homework: [h], changes, targets: [m1, moved], keyOf, now: 18 }), changes, 'still changed → untouched (same reference)')
})

test('NF-01: a transition item can be "not known yet" with a follow-up date; readiness counts it, and a later location edit still invalidates only the travel item', () => {
  const school = { id: 'sch-2', name: 'Oak Academy', lat: 51.5, lng: -0.1, confirmedAt: 5, at: 10 }
  const placement = { id: 'pl-se2', code: 'SE2', schoolLocationId: 'sch-2', mappedBlockTags: ['SE2A'], mentorName: 'B Mentor', at: 10 }
  const ctx = { placement, school, reviewPacks: [], hasHome: true, defaultHours: { start: '08:30', end: '16:00' } }
  let t = { id: 'tr1', toPlacementId: 'pl-se2', travelReviewed: { at: 1, lat: 51.5, lng: -0.1 }, sharesReviewed: { at: 1, packIds: [] }, carryTargetIds: [], contextNote: 'Y4', confirmedStartISO: '2027-01-11', state: 'open', at: 1 }
  let items = transitionItems(t, ctx)
  assert.equal(items.find((i) => i.id === 'resources-ready').state, 'todo')
  assert.equal(transitionProgress(items).complete, false)
  t = withDeferral(t, 'resources-ready', { followUpISO: '2027-01-04' }, 2)
  items = transitionItems(t, ctx)
  const deferred = items.find((i) => i.id === 'resources-ready')
  assert.equal(deferred.state, 'deferred')
  assert.match(deferred.detail, /Not known yet — follow up 2027-01-04/)
  assert.equal(transitionProgress(items).complete, true, 'deferred items never block readiness')
  assert.equal(transitionProgress(items).deferred, 1)
  // Adding a resource satisfies the item; a moved pin still invalidates only the travel review.
  assert.equal(transitionItems(t, { ...ctx, placement: { ...placement, resources: [{ id: 'r', kind: 'link', url: 'https://x.example', label: 'Handbook', at: 1 }] } }).find((i) => i.id === 'resources-ready').state, 'done')
  const moved = transitionItems(t, { ...ctx, school: { ...school, lat: 51.6 } })
  assert.equal(moved.find((i) => i.id === 'travel-reviewed').state, 'stale')
  assert.equal(moved.find((i) => i.id === 'resources-ready').state, 'deferred')
  assert.equal(withDeferral(t, 'resources-ready', null, 3).deferred['resources-ready'], undefined)
})

test('NF-05: homework and placement resources are referenced by uid, listed and relinked without touching bytes', () => {
  const admin = {
    homework: [{ ...hw(), resources: [{ id: 'r1', kind: 'wallet', uid: 'u-sheet', label: 'Worksheet', at: 1 }, { id: 'r2', kind: 'link', url: 'https://x.example', label: 'Video', at: 1 }] }],
    placements: [{ id: 'pl-se1', code: 'SE1', mappedBlockTags: [], resources: [{ id: 'r3', kind: 'wallet', uid: 'u-sheet', label: 'Handbook', at: 1 }], at: 1 }],
  }
  const refs = referencedUids(admin)
  assert.deepEqual(refs.get('u-sheet').map((r) => r.kind), ['homework-resource', 'placement-resource'], 'one document, two records, no copy')
  const relinked = relinkUid(admin, 'u-sheet', 'u-new', 9)
  assert.equal(relinked.homework[0].resources[0].uid, 'u-new')
  assert.equal(relinked.placements[0].resources[0].uid, 'u-new')
  assert.equal(relinked.homework[0].resources[1].url, 'https://x.example')
})

test('wire contract: plan parent kinds, homework effort/history/resources, placement resources, changes, preparations and deferrals validate; bad shapes are refused', () => {
  const empty = () => Object.fromEntries(collections.map((k) => [k, []]))
  const withAdmin = (admin) => ({ store: { activeId: 'p1', profiles: [{ id: 'p1', name: 'one', settings: { demo: true, sheetId: '', gid: null } }] }, admin: { p1: admin } })
  const admin = {
    ...empty(),
    homework: [{ ...hw(), statusHistory: [{ at: 1, status: 'done' }], resources: [{ id: 'r', kind: 'wallet', uid: 'u', label: 'x', at: 1 }] }],
    plans: [{ id: 'b', parentId: 'h1', parentKind: 'homework', kind: 'block', title: 'x', dateISO: '2026-09-20', startTime: '10:00', endTime: '11:00', effortMins: 60, at: 1 }],
    placements: [{ id: 'pl', code: 'SE1', mappedBlockTags: [], resources: [{ id: 'r', kind: 'link', url: 'https://x.example', label: 'Handbook', at: 1 }], at: 1 }],
    homeworkChanges: [{ id: 'c', homeworkId: 'h1', kind: 'moved', previous: { dateISO: '2026-09-22', title: 'Maths 2' }, current: { dateISO: '2026-09-23', title: 'Maths 2' }, decision: 'follow', decidedAt: 2, at: 1 }],
    preparations: [{ id: 'p', sessionRef: 'event:m2', items: [{ id: 'i', text: 'Bring the reading', done: false, at: 1 }], readyAt: 2, followUp: 'ok', at: 1 }],
    transitions: [{ id: 't', toPlacementId: 'pl', deferred: { 'resources-ready': { followUpISO: '2027-01-04', at: 1 } }, state: 'open', at: 1 }],
  }
  assert.doesNotThrow(() => validatePayload(withAdmin(admin)))
  const bad = (patch) => withAdmin({ ...admin, ...patch })
  assert.throws(() => validatePayload(bad({ plans: [{ ...admin.plans[0], parentKind: 'lesson' }] })), /parent kind/)
  assert.throws(() => validatePayload(bad({ homework: [{ ...admin.homework[0], resources: [{ id: 'r', kind: 'ftp', label: 'x', at: 1 }] }] })), /homework resources/)
  assert.throws(() => validatePayload(bad({ homeworkChanges: [{ ...admin.homeworkChanges[0], kind: 'vanished' }] })), /change kind/)
  assert.throws(() => validatePayload(bad({ preparations: [{ ...admin.preparations[0], items: [{ id: 'i', text: 'x' }] }] })), /preparation items/)
  assert.throws(() => validatePayload(bad({ transitions: [{ ...admin.transitions[0], deferred: { 'resources-ready': { followUpISO: 'soon', at: 1 } } }] })), /deferral/)
  const legacy = { ...admin }
  delete legacy.homeworkChanges
  delete legacy.preparations
  assert.doesNotThrow(() => validatePayload(withAdmin(legacy)))
})

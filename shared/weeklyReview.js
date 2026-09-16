/**
 * E02 (audit D2, Pass 84): a weekly review over the EXISTING workload planner.
 * Runtime-neutral. This week: planned / logged / still open. Next week: fixed
 * commitments and free slots. The planner's proposals become a DIFF against
 * the blocks already on next week — moved, added, untouched — that the learner
 * accepts one by one or as a batch. Accepted batches are recorded on the review
 * so Undo touches only that batch, accepting the same proposals twice is a
 * no-op, and an imported timetable change (a different busy basis) is named
 * as the reason the proposals were recalculated. No wellbeing or QTS score.
 */

import { addDaysISO } from './calendar-time.js'
import { suggestPlanWeek } from './planWeek.js'
import { planWorkload, remainingEffort } from './workload.js'

const toMins = (t) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t || '')
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}
const weekday = (iso) => new Date(iso + 'T00:00:00Z').getUTCDay()
const blockMins = (b) => Math.max(0, (toMins(b.endTime) ?? 0) - (toMins(b.startTime) ?? 0))

/** Monday–Sunday of the week holding `todayISO`, and the week after. */
export function reviewWeeks(todayISO) {
  const dow = (weekday(todayISO) + 6) % 7
  const fromISO = addDaysISO(todayISO, -dow)
  return { fromISO, toISO: addDaysISO(fromISO, 6), nextFromISO: addDaysISO(fromISO, 7), nextToISO: addDaysISO(fromISO, 13) }
}

const inWeek = (d, from, to) => !!d && d >= from && d <= to

/** This week: planned block minutes, logged (done) minutes, and what is still open. */
export function thisWeekSummary({ todayISO, tasks, plans }) {
  const { fromISO, toISO } = reviewWeeks(todayISO)
  const blocks = plans.filter((p) => p.kind === 'block' && inWeek(p.dateISO, fromISO, toISO))
  const plannedMins = blocks.reduce((n, b) => n + blockMins(b), 0)
  const loggedMins = blocks.filter((b) => b.done).reduce((n, b) => n + blockMins(b), 0)
  const openTasks = tasks
    .filter((t) => t.status !== 'done')
    .map((t) => ({ id: t.id, title: t.title, dueISO: t.dueISO, remaining: remainingEffort(t, plans, todayISO), dueThisWeek: inWeek(t.dueISO, fromISO, toISO), overdue: !!t.dueISO && t.dueISO < todayISO }))
  return { fromISO, toISO, blocks, plannedMins, loggedMins, openTasks, openCount: openTasks.length }
}

/**
 * Next week's fixed commitments by day (sessions, placement travel, personal,
 * protected) and its free slots. `busy` is the plan-week interval list with
 * protected windows already excluded; they are re-added here per day so the
 * review names them.
 */
export function nextWeekFixed({ todayISO, busy, protectedWindows = [], options = {}, travel = null }) {
  const { nextFromISO, nextToISO } = reviewWeeks(todayISO)
  const days = []
  const travelBusy = []
  for (let i = 0; i < 7; i++) {
    const d = addDaysISO(nextFromISO, i)
    const fixed = busy.filter((b) => b.d === d && b.kind !== 'free' && b.kind !== 'plan').map((b) => ({ from: b.from, to: b.to, label: b.label, kind: b.kind }))
    // Upcoming placement travel: the arrival buffer before the first school session of the day, labelled as an assumption.
    if (travel && travel.bufferMins > 0) {
      const first = fixed.filter((f) => f.kind === 'session' && travel.isPlacement(f.label)).sort((a, b) => a.from - b.from)[0]
      if (first) {
        const t = { from: Math.max(0, first.from - travel.bufferMins), to: first.from, label: `Travel to school (assumed ${travel.bufferMins} min)`, kind: 'travel' }
        fixed.push(t)
        travelBusy.push({ d, from: t.from, to: t.to, label: t.label, kind: 'personal' })
      }
    }
    for (const w of protectedWindows) {
      if (w.day !== weekday(d)) continue
      const from = toMins(w.start)
      const to = toMins(w.end)
      if (from === null || to === null || to <= from) continue
      fixed.push({ from, to, label: `Protected: ${w.label || 'time'}`, kind: 'protected' })
    }
    fixed.sort((a, b) => a.from - b.from)
    days.push({ d, fixed, fixedMins: fixed.reduce((n, f) => n + (f.to - f.from), 0) })
  }
  const protectedBusy = days.flatMap((day) => day.fixed.filter((f) => f.kind === 'protected').map((f) => ({ d: day.d, from: f.from, to: f.to, label: f.label, kind: 'personal' })))
  const week = suggestPlanWeek({ anchorISO: nextFromISO, busy: [...busy, ...protectedBusy, ...travelBusy], options })
  const free = week.suggestions.filter((s) => s.d >= nextFromISO && s.d <= nextToISO).map((s) => ({ d: s.d, from: s.from, to: s.gapTo, mins: s.gapTo - s.from }))
  return { nextFromISO, nextToISO, days, free, freeMins: free.reduce((n, f) => n + f.mins, 0) }
}

/** The planner's proposals restricted to next week, from the same engine the fortnight view uses. */
export function nextWeekProposals({ todayISO, busy, protectedWindows, deadlines, tasks, plans, options }) {
  const { toISO, nextFromISO, nextToISO } = reviewWeeks(todayISO)
  const daysAhead = Math.round((Date.parse(nextToISO + 'T00:00:00Z') - Date.parse(todayISO + 'T00:00:00Z')) / 86400000) + 1
  // The rest of THIS week is closed to proposals (it is reviewed, not replanned), while
  // remaining effort still counts this week's future blocks; only next week's slots are open.
  const closed = []
  for (let d = todayISO; d <= toISO; d = addDaysISO(d, 1)) closed.push({ d, from: 0, to: 24 * 60, label: 'This week (reviewed, not replanned)', kind: 'personal' })
  const result = planWorkload({ todayISO, days: daysAhead, busy: [...busy, ...closed], protectedWindows, deadlines, tasks, plans, options })
  return { ...result, proposals: result.proposals.filter((p) => p.dateISO >= nextFromISO && p.dateISO <= nextToISO) }
}

const slotKey = (p) => `${p.taskId ?? p.parentId}|${p.dateISO}|${p.startTime}|${p.endTime}`
const overlaps = (a, b) => a.from < b.to && b.from < a.to

/**
 * Next week as a diff. The planner only ever places REMAINING effort into
 * free slots (existing blocks count as busy), so:
 *  - untouched: an existing block that still stands — the engine never re-proposes it
 *  - moved: an existing block that now clashes with a session or commitment (the
 *    timetable changed under it) and a proposal that re-places that task's time
 *  - added: a proposal for effort no block covers yet
 *  - clash: a clashing block the planner found no free slot for — shown, never removed by itself
 * Blocks the learner edited are never touched unless they clash and the move is selected.
 */
export function weeklyReview({ todayISO, busy, protectedWindows = [], deadlines = [], tasks, plans, options = {} }) {
  const { nextFromISO, nextToISO } = reviewWeeks(todayISO)
  const open = new Set(tasks.filter((t) => t.status !== 'done').map((t) => t.id))
  const existing = plans.filter((p) => p.kind === 'block' && inWeek(p.dateISO, nextFromISO, nextToISO) && open.has(p.parentId))
  const hard = busy.filter((b) => b.kind === 'session' || b.kind === 'personal')
  const asInterval = (b) => ({ d: b.dateISO, from: toMins(b.startTime) ?? 0, to: toMins(b.endTime) ?? 0 })
  const clashing = existing.filter((b) => {
    const i = asInterval(b)
    return hard.some((h) => h.d === i.d && overlaps(h, i))
  })
  const clashIds = new Set(clashing.map((b) => b.id))
  // Plan the remainder as if the clashing blocks were gone: their time is free again and their effort is owed.
  const busyWithoutClashes = busy.filter((b) => !(b.kind === 'plan' && clashing.some((c) => { const i = asInterval(c); return i.d === b.d && i.from === b.from && i.to === b.to })))
  const result = nextWeekProposals({ todayISO, busy: busyWithoutClashes, protectedWindows, deadlines, tasks, plans: plans.filter((p) => !clashIds.has(p.id)), options })
  const claimed = new Set()
  const changes = []
  for (const p of result.proposals) {
    const clash = clashing.find((b) => !claimed.has(b.id) && b.parentId === p.taskId)
    if (clash) {
      claimed.add(clash.id)
      changes.push({ kind: 'moved', key: slotKey(p), proposal: p, block: clash })
      continue
    }
    changes.push({ kind: 'added', key: slotKey(p), proposal: p })
  }
  for (const b of existing) {
    if (claimed.has(b.id)) continue
    changes.push({ kind: clashIds.has(b.id) ? 'clash' : 'untouched', key: slotKey(b), block: b })
  }
  return { ...result, changes, actionable: changes.filter((c) => c.kind === 'added' || c.kind === 'moved'), clashing }
}

/** @deprecated kept for callers that already have proposals; prefer weeklyReview(). */
export function weeklyDiff({ todayISO, plans, proposals, tasks }) {
  const { nextFromISO, nextToISO } = reviewWeeks(todayISO)
  const open = new Set(tasks.filter((t) => t.status !== 'done').map((t) => t.id))
  const existing = plans.filter((p) => p.kind === 'block' && inWeek(p.dateISO, nextFromISO, nextToISO) && open.has(p.parentId))
  const changes = proposals.map((p) => ({ kind: 'added', key: slotKey(p), proposal: p }))
  for (const b of existing) changes.push({ kind: 'untouched', key: slotKey(b), block: b })
  return { changes, actionable: changes.filter((c) => c.kind === 'added') }
}

/** A stable fingerprint of the busy basis (what the proposals were computed against). */
export function basisHash(busy) {
  return [...busy].map((b) => `${b.d}:${b.from}-${b.to}:${b.kind}`).sort().join(',')
}

/** A stable fingerprint of a set of accepted changes. */
export function changesHash(changes) {
  return changes.map((c) => `${c.kind}:${c.key}${c.block ? `<${c.block.id}` : ''}`).sort().join(',')
}

/**
 * Apply the selected changes: added → new block; moved → new block at the
 * proposed slot and the old block removed. Returns the batch record (what to
 * add, what was removed, verbatim) so Undo can restore exactly this batch.
 */
export function applyChanges({ changes, selectedKeys, makeId, now }) {
  const chosen = changes.filter((c) => (c.kind === 'added' || c.kind === 'moved') && selectedKeys.includes(c.key))
  const added = chosen.map((c) => ({ id: makeId(), parentId: c.proposal.taskId, kind: 'block', title: c.proposal.title, dateISO: c.proposal.dateISO, startTime: c.proposal.startTime, endTime: c.proposal.endTime, effortMins: c.proposal.effortMins, at: now }))
  const removed = chosen.filter((c) => c.kind === 'moved').map((c) => c.block)
  return { batch: { id: makeId(), at: now, addedIds: added.map((b) => b.id), removed, changesHash: changesHash(chosen) }, added, removedIds: removed.map((b) => b.id) }
}

/** Reverse exactly one batch: drop what it added, restore what it removed. */
export function undoBatch(plans, batch) {
  const dropped = new Set(batch.addedIds)
  const restored = (batch.removed ?? []).filter((r) => !plans.some((p) => p.id === r.id))
  return [...plans.filter((p) => !dropped.has(p.id)), ...restored]
}

export function makeWeeklyReview(weekISO, id, now) {
  return { id, weekISO, proposalRevision: 1, batches: [], at: now }
}

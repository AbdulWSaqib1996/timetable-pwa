import { addDaysISO } from './calendar-time.js'
import { suggestPlanWeek } from './planWeek.js'

/**
 * Workload (MF-01 specialised for the PGCE, G2): a deterministic
 * needed-vs-available reckoning over the EXISTING plan model. Needed time is
 * the remaining effort on open tasks (subtask/milestone estimates minus blocks
 * already on the calendar); available time is the plan-week gaps after
 * timetabled sessions with their travel buffers, personal commitments,
 * existing blocks, quiet hours and the learner's protected windows. Proposals
 * are earliest-deadline-first blocks that never touch protected time, never
 * fall after a task's due date and are only ever accepted by the learner
 * (as ordinary plan blocks they can edit or undo). A task with no estimate is
 * reported as unknown, never guessed.
 */

export const WORKLOAD_HORIZON_DAYS = 14
export const WORKLOAD_BLOCK_MAX = 90
export const WORKLOAD_BLOCK_MIN = 30

const hhmm = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
const toMins = (t) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t || '')
  return m ? +m[1] * 60 + +m[2] : null
}
const weekday = (iso) => new Date(iso + 'T00:00:00Z').getUTCDay()

/** Remaining effort per open task: estimates on undone children minus future blocks; null = unknown. */
export function remainingEffort(task, plans, todayISO) {
  const children = plans.filter((p) => p.parentId === task.id)
  const estimates = children.filter((p) => p.kind !== 'block' && !p.done && Number.isFinite(p.effortMins))
  if (estimates.length === 0) return null
  const needed = estimates.reduce((n, p) => n + p.effortMins, 0)
  const scheduled = children.filter((p) => p.kind === 'block' && p.dateISO && p.dateISO >= todayISO && p.startTime && p.endTime).reduce((n, p) => n + Math.max(0, (toMins(p.endTime) ?? 0) - (toMins(p.startTime) ?? 0)), 0)
  return Math.max(0, needed - scheduled)
}

/** "2 h 30 m" style gap wording without a judgement. */
export function formatMins(mins) {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h && m ? `${h} h ${m} m` : h ? `${h} h` : `${m} m`
}

/**
 * @param {object} input
 * @param {string} input.todayISO
 * @param {number} [input.days]
 * @param {{d:string,from:number,to:number,label:string,kind:string}[]} input.busy plan-week busy intervals (sessions, personal, blocks)
 * @param {{id:string,day:number,start:string,end:string,label?:string}[]} [input.protectedWindows] weekly windows never used
 * @param {{d:string,title:string}[]} [input.deadlines]
 * @param {object[]} input.tasks open tasks
 * @param {object[]} input.plans plan children
 * @param {object} [input.options] suggestPlanWeek options (start/end/quiet/buffer)
 */
export function planWorkload({ todayISO, days = WORKLOAD_HORIZON_DAYS, busy = [], protectedWindows = [], deadlines = [], tasks, plans, options = {} }) {
  const endISO = addDaysISO(todayISO, days - 1)
  // Protected windows become busy intervals on every horizon day they fall on.
  const protectedBusy = []
  for (let i = 0; i < days; i++) {
    const d = addDaysISO(todayISO, i)
    for (const w of protectedWindows) {
      if (w.day !== weekday(d)) continue
      const from = toMins(w.start)
      const to = toMins(w.end)
      if (from === null || to === null || to <= from) continue
      protectedBusy.push({ d, from, to, label: `Protected: ${w.label || 'time'}`, kind: 'personal' })
    }
  }
  const allBusy = [...busy, ...protectedBusy]
  // Free slots across every week the horizon touches, earliest first.
  const slots = []
  const seen = new Set()
  for (let anchor = todayISO; anchor <= endISO; anchor = addDaysISO(anchor, 7)) {
    const week = suggestPlanWeek({ anchorISO: anchor, busy: allBusy, deadlines, options: { ...options, minMins: WORKLOAD_BLOCK_MIN, maxMins: WORKLOAD_BLOCK_MAX } })
    for (const s of week.suggestions) {
      const key = `${s.d}:${s.from}`
      if (seen.has(key) || s.d < todayISO || s.d > endISO) continue
      seen.add(key)
      slots.push({ d: s.d, from: s.from, to: s.gapTo })
    }
  }
  slots.sort((a, b) => (a.d === b.d ? a.from - b.from : a.d.localeCompare(b.d)))
  const available = slots.reduce((n, s) => n + (s.to - s.from), 0)

  const open = tasks.filter((t) => t.status !== 'done')
  const items = open.map((t) => ({ task: t, remaining: remainingEffort(t, plans, todayISO) }))
  const unknown = items.filter((x) => x.remaining === null).map((x) => ({ taskId: x.task.id, title: x.task.title }))
  const queue = items.filter((x) => x.remaining !== null && x.remaining > 0).sort((a, b) => (a.task.dueISO || '9999').localeCompare(b.task.dueISO || '9999') || a.task.id.localeCompare(b.task.id))
  const needed = queue.reduce((n, x) => n + x.remaining, 0)
  const alreadyScheduled = plans.filter((p) => p.kind === 'block' && p.dateISO && p.dateISO >= todayISO && p.dateISO <= endISO && open.some((t) => t.id === p.parentId)).reduce((n, p) => n + Math.max(0, (toMins(p.endTime) ?? 0) - (toMins(p.startTime) ?? 0)), 0)

  // Earliest-deadline-first into the earliest slots; a task never lands after its due date.
  const proposals = []
  const left = queue.map((x) => ({ ...x }))
  for (const slot of slots) {
    let cursor = slot.from
    while (slot.to - cursor >= WORKLOAD_BLOCK_MIN) {
      const pick = left.find((x) => x.remaining > 0 && (!x.task.dueISO || x.task.dueISO >= slot.d))
      if (!pick) break
      const mins = Math.min(pick.remaining, slot.to - cursor, WORKLOAD_BLOCK_MAX)
      if (mins < WORKLOAD_BLOCK_MIN && pick.remaining >= WORKLOAD_BLOCK_MIN) break
      const take = Math.max(mins, Math.min(WORKLOAD_BLOCK_MIN, slot.to - cursor))
      proposals.push({ taskId: pick.task.id, title: pick.task.title, dateISO: slot.d, startTime: hhmm(cursor), endTime: hhmm(cursor + take), effortMins: take })
      pick.remaining -= take
      cursor += take
    }
  }
  const proposedMins = proposals.reduce((n, p) => n + p.effortMins, 0)
  const unallocated = left.reduce((n, x) => n + Math.max(0, x.remaining), 0)
  const late = queue.filter((x) => x.task.dueISO && x.task.dueISO < todayISO).map((x) => ({ taskId: x.task.id, title: x.task.title, dueISO: x.task.dueISO }))
  return { todayISO, endISO, needed, alreadyScheduled, available, proposedMins, unallocated, unknown, late, proposals, protectedMins: protectedBusy.reduce((n, b) => n + (b.to - b.from), 0), slots: slots.length }
}

/** Turn accepted proposals into plan blocks; returns the new children and their ids (for undo). */
export function proposalsToBlocks(proposals, makeId, now) {
  const blocks = proposals.map((p) => ({ id: makeId(), parentId: p.taskId, kind: 'block', title: p.title, dateISO: p.dateISO, startTime: p.startTime, endTime: p.endTime, effortMins: p.effortMins, at: now }))
  return { blocks, ids: blocks.map((b) => b.id) }
}

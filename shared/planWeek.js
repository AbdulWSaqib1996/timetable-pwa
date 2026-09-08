import { addDaysISO, mondayOfISO } from './calendar-time.js'

/**
 * "Plan week" gap suggestions (R4 / NF-03), runtime-neutral. Inputs are
 * plain wall-minute intervals on course dates — timezone and DST never enter
 * the arithmetic because a course day is planned on its own wall clock.
 *
 * A suggestion is a gap in the visible planning range that is at least
 * `minMins` long after every busy interval (with an honest travel buffer
 * around timetabled sessions), the quiet hours and nothing else. Gaps longer
 * than `maxMins` suggest their first `maxMins` and say the gap continues.
 * Every suggestion carries the reasons it fits and what was left out. It is
 * a suggestion, never a guarantee: the caller shows it and the user decides.
 */

export const PLAN_RANGE_START = 8 * 60
export const PLAN_RANGE_END = 20 * 60
export const PLAN_MIN_MINS = 30
export const PLAN_MAX_MINS = 120
/** Applied either side of timetabled sessions — journey time is unknown, not zero. */
export const PLAN_TRAVEL_BUFFER_MINS = 15

export const hhmm = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`

function mergeIntervals(list) {
  const sorted = [...list].filter((b) => b.to > b.from).sort((a, b) => a.from - b.from)
  const out = []
  for (const b of sorted) {
    const last = out[out.length - 1]
    if (last && b.from <= last.to) {
      last.to = Math.max(last.to, b.to)
      last.labels.push(...b.labels)
    } else {
      out.push({ from: b.from, to: b.to, labels: [...b.labels] })
    }
  }
  return out
}

/**
 * @param {object} input
 * @param {string} input.anchorISO any date in the week to plan (Monday start)
 * @param {{d:string, from:number, to:number, label:string, kind:'session'|'personal'|'plan'|'free'}[]} input.busy
 *   wall-minute intervals; kind 'free' is displayed but never blocks
 * @param {{d:string, title:string}[]} [input.deadlines]
 * @param {{start?:number, end?:number, minMins?:number, maxMins?:number, bufferMins?:number, quietFrom?:number, quietTo?:number}} [input.options]
 */
export function suggestPlanWeek({ anchorISO, busy = [], deadlines = [], options = {} }) {
  const start = options.start ?? PLAN_RANGE_START
  const end = options.end ?? PLAN_RANGE_END
  const minMins = options.minMins ?? PLAN_MIN_MINS
  const maxMins = options.maxMins ?? PLAN_MAX_MINS
  const bufferMins = options.bufferMins ?? PLAN_TRAVEL_BUFFER_MINS
  const monday = mondayOfISO(anchorISO)
  const days = Array.from({ length: 7 }, (_, i) => addDaysISO(monday, i))
  const excluded = []
  if (bufferMins > 0) excluded.push(`${bufferMins} min travel buffer either side of timetabled sessions (journey time is an estimate, never zero)`)
  // Quiet hours (settings.quietFrom/quietTo are whole hours, may wrap midnight).
  const quiet = []
  if (options.quietFrom !== undefined && options.quietTo !== undefined) {
    const qf = options.quietFrom * 60
    const qt = options.quietTo * 60
    if (qf < qt) quiet.push({ from: qf, to: qt })
    else {
      quiet.push({ from: qf, to: 24 * 60 })
      quiet.push({ from: 0, to: qt })
    }
    excluded.push(`quiet hours ${hhmm(qf)}–${hhmm(qt)}`)
  }
  if (busy.some((b) => b.kind === 'free')) excluded.push('personal events marked free are shown but do not block a suggestion')

  const suggestions = []
  const workload = []
  for (const d of days) {
    const dayBusy = busy.filter((b) => b.d === d)
    const blocking = dayBusy
      .filter((b) => b.kind !== 'free')
      .map((b) => ({
        from: b.kind === 'session' ? b.from - bufferMins : b.from,
        to: b.kind === 'session' ? b.to + bufferMins : b.to,
        labels: [b.label],
      }))
    for (const q of quiet) blocking.push({ from: q.from, to: q.to, labels: ['quiet hours'] })
    const merged = mergeIntervals(blocking)
    const timetabled = dayBusy.filter((b) => b.kind === 'session').reduce((n, b) => n + (b.to - b.from), 0)
    const planned = dayBusy.filter((b) => b.kind === 'plan').reduce((n, b) => n + (b.to - b.from), 0)
    const personal = dayBusy.filter((b) => b.kind === 'personal').reduce((n, b) => n + (b.to - b.from), 0)
    workload.push({ d, timetabledMins: timetabled, plannedMins: planned, personalMins: personal })

    let cursor = start
    const dueLater = deadlines.filter((k) => k.d >= d).sort((a, b) => a.d.localeCompare(b.d))
    const pushGap = (from, to, before, after) => {
      const length = to - from
      if (length < minMins) return
      const suggestedTo = Math.min(to, from + maxMins)
      const reasons = []
      reasons.push(
        before && after
          ? `free between ${before} and ${after}`
          : before
            ? `free after ${before}`
            : after
              ? `free before ${after}`
              : 'nothing planned in this range'
      )
      if (suggestedTo < to) reasons.push(`the gap continues until ${hhmm(to)} — ${maxMins} min suggested at a time`)
      if (dueLater[0]) reasons.push(`ahead of “${dueLater[0].title}” (due ${dueLater[0].d === d ? 'today' : dueLater[0].d})`)
      suggestions.push({ d, from, to: suggestedTo, gapTo: to, mins: suggestedTo - from, reasons })
    }
    let prevLabel = null
    for (const b of merged) {
      const bFrom = Math.max(b.from, start)
      const bTo = Math.min(b.to, end)
      if (bFrom > cursor) pushGap(cursor, Math.min(bFrom, end), prevLabel, describe(b))
      cursor = Math.max(cursor, bTo)
      prevLabel = describe(b)
      if (cursor >= end) break
    }
    if (cursor < end) pushGap(cursor, end, prevLabel, null)
  }
  return { monday, days, suggestions, workload, excluded, range: { start, end }, minMins, maxMins }
}

function describe(b) {
  const label = b.labels.find((l) => l && l !== 'quiet hours') ?? b.labels[0] ?? 'busy'
  return `${label} (${hhmm(Math.max(0, b.from))}–${hhmm(Math.min(24 * 60, b.to))})`
}

/** True when a proposed interval overlaps any blocking busy interval on that day. */
export function overlapsBusy(busy, d, from, to) {
  return busy.some((b) => b.d === d && b.kind !== 'free' && b.from < to && from < b.to)
}

import { isPlacementTitle, placementTagOf } from './eligibility.js'

/**
 * Placement plan vs logged experience (P5-03) — runtime-neutral core.
 * Exceptions are applied AFTER span expansion, keyed by the stable
 * (block tag, date) identity so they survive source refreshes. Planned and
 * Logged stay separate: a missing record is unrecorded, never absent, and a
 * whole-day tick is a day-level fact, not minute-level accuracy.
 */

const toMins = (t) => {
  const m = (t ?? '').match(/^(\d{1,2}):(\d{2})$/)
  return m ? +m[1] * 60 + +m[2] : null
}

export function placementPolicyOf(settings) {
  return {
    start: settings?.placementHours?.start ?? '08:30',
    end: settings?.placementHours?.end ?? '15:45',
    breakMins: settings?.placementHours?.breakMins ?? 0,
    insetCounts: settings?.placementInsetCounts !== false,
  }
}

export const exceptionFor = (exceptions, tag, dateISO) =>
  (exceptions ?? []).find((e) => e.tag === tag && e.dateISO === dateISO)

/** Does this exception remove the day from the plan under the policy? */
export function isExcluded(exception, policy) {
  if (!exception) return false
  if (exception.kind === 'holiday' || exception.kind === 'cancelled') return true
  if (exception.kind === 'inset') return !policy.insetCounts
  return false
}

/** View-level filter removing excluded placement days from a session list. */
export function applyPlacementExceptionRules(sessions, exceptions, settings) {
  if (!exceptions || exceptions.length === 0) return sessions
  const policy = placementPolicyOf(settings)
  return sessions.filter((s) => {
    if (s.isKeyDate || !isPlacementTitle(s.title)) return true
    return !isExcluded(exceptionFor(exceptions, placementTagOf(s.title), s.dateISO), policy)
  })
}

const daySpan = (start, end, fallback) => {
  const s = toMins(start) ?? toMins(fallback.start) ?? 510
  const e = toMins(end) ?? toMins(fallback.end) ?? 945
  return Math.max(0, e - s)
}

/**
 * Per-block day views + totals. `metaOf(session)` resolves the whole-day
 * attendance tick for any of a date's rows.
 */
export function computePlacementBlocks(sessions, exceptions, settings, metaOf) {
  const policy = placementPolicyOf(settings)
  const byTagDate = new Map()
  for (const s of sessions ?? []) {
    if (s.isKeyDate || !isPlacementTitle(s.title)) continue
    const tag = placementTagOf(s.title)
    if (!byTagDate.has(tag)) byTagDate.set(tag, new Map())
    const dates = byTagDate.get(tag)
    dates.set(s.dateISO, [...(dates.get(s.dateISO) ?? []), s])
  }
  const blocks = []
  for (const [tag, dates] of byTagDate) {
    const days = []
    for (const [dateISO, rows] of [...dates.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const exception = exceptionFor(exceptions, tag, dateISO)
      const excluded = isExcluded(exception, policy)
      const inferred = rows.every((r) => String(r.id ?? '').startsWith('plc-'))
      // Day length: an exception's custom hours win, else the day's own row
      // times, else the default working hours; minus the configured break.
      const base =
        exception && (exception.kind === 'part-day' || exception.kind === 'hours') && exception.startTime
          ? daySpan(exception.startTime, exception.endTime, policy)
          : daySpan(rows[0].start || undefined, rows[0].end || undefined, policy)
      const plannedMins = excluded ? 0 : Math.max(0, base - policy.breakMins)
      const attended = rows.some((r) => {
        const m = metaOf(r)
        return !!m && !m.deleted && m.attended === true
      })
      const absent = rows.some((r) => {
        const m = metaOf(r)
        return !!m && !m.deleted && m.absent === true
      })
      const loggedMins =
        exception?.loggedMins !== undefined ? exception.loggedMins : attended && !excluded ? plannedMins : null
      days.push({
        dateISO,
        tag,
        inferred,
        exception,
        excluded,
        plannedMins,
        loggedMins,
        loggedFrom: exception?.loggedMins !== undefined ? 'correction' : loggedMins !== null ? 'day-tick' : null,
        attended,
        absent,
      })
    }
    blocks.push({
      tag,
      days,
      plannedDays: days.filter((d) => !d.excluded).length,
      plannedMins: days.reduce((n, d) => n + d.plannedMins, 0),
      loggedDays: days.filter((d) => (d.loggedMins ?? 0) > 0 || (d.attended && !d.excluded)).length,
      loggedMins: days.reduce((n, d) => n + (d.loggedMins ?? 0), 0),
      inferredDays: days.filter((d) => d.inferred && !d.excluded).length,
      excludedDays: days.filter((d) => d.excluded).length,
    })
  }
  return blocks.sort((a, b) => a.tag.localeCompare(b.tag))
}

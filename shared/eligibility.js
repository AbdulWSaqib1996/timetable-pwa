/**
 * Attendance/evidence eligibility (P3-06), shared so Stats, Settings
 * summaries, CSV exports and the printed binder all agree on one definition
 * of an "eligible completed session" and never conflate missing data with
 * absence.
 *
 * Eligible: a course session that is not a key date, not self-study and not a
 * placement row (placements are counted as unique school DAYS, separately).
 * Completed: its date is past — or today with an end time already reached
 * when the caller supplies the current minutes.
 */

export const isPlacementTitle = (t) => /school experience|placement|\bSE ?\d[a-z]?\b/i.test(t || '')

export const placementTagOf = (t) => {
  const m = (t || '').match(/SE ?\d[a-z]?/i)
  return m ? m[0].replace(/\s/g, '').toUpperCase() : 'PLACEMENT'
}

const timeToMinutes = (t) => {
  const m = (t || '').match(/^(\d{1,2}):(\d{2})$/)
  return m ? +m[1] * 60 + +m[2] : null
}

export function isEligibleSession(s) {
  return !s.isKeyDate && !s.isSelfStudy && !isPlacementTitle(s.title)
}

export function isCompleted(s, todayISO, nowMinutes = null) {
  if (s.dateISO < todayISO) return true
  if (s.dateISO > todayISO) return false
  if (nowMinutes === null) return true
  const end = timeToMinutes(s.end) ?? timeToMinutes(s.start)
  return end !== null && end <= nowMinutes
}

/**
 * Attended / absent / unrecorded over eligible completed sessions.
 * `metaOf(session)` returns that session's saved record ({attended?, absent?,
 * deleted?}) or undefined. Deleted records count as unrecorded — missing data
 * is never treated as absence, and never silently dropped to inflate a rate.
 */
export function attendanceSummary(sessions, metaOf, todayISO, nowMinutes = null) {
  let eligible = 0
  let attended = 0
  let absent = 0
  for (const s of sessions) {
    if (!isEligibleSession(s) || !isCompleted(s, todayISO, nowMinutes)) continue
    eligible++
    const m = metaOf(s)
    if (m && !m.deleted && m.attended) attended++
    else if (m && !m.deleted && m.absent) absent++
  }
  const unrecorded = eligible - attended - absent
  return {
    eligible,
    attended,
    absent,
    unrecorded,
    attendedPct: eligible > 0 ? Math.round((attended / eligible) * 100) : null,
    /** one honest sentence for any UI/print surface */
    sentence:
      eligible === 0
        ? 'No eligible completed sessions yet.'
        : `${Math.round((attended / eligible) * 100)}% attended — ${attended} of ${eligible} eligible completed session${eligible === 1 ? '' : 's'}; ${absent} absent, ${unrecorded} unrecorded.`,
  }
}

/**
 * Placement school days per block: unique dates (several events on one date
 * are one school day); a day is attended when any of its events is ticked.
 * Days backed only by synthetic span-expansion rows (ids starting "plc-")
 * are counted but reported as inferred, pending confirmation.
 */
export function placementDaySummary(sessions, metaOf) {
  const byTag = new Map()
  for (const s of sessions) {
    if (s.isKeyDate || !isPlacementTitle(s.title)) continue
    const tag = s.placementTag ?? placementTagOf(s.title)
    const e = byTag.get(tag) ?? { total: new Set(), attended: new Set(), real: new Set() }
    e.total.add(s.dateISO)
    const m = metaOf(s)
    if (m && !m.deleted && m.attended) e.attended.add(s.dateISO)
    if (!(s.id ?? '').startsWith('plc-')) e.real.add(s.dateISO)
    byTag.set(tag, e)
  }
  const blocks = [...byTag.entries()]
    .map(([tag, e]) => ({
      tag,
      total: e.total.size,
      attended: e.attended.size,
      inferred: [...e.total].filter((d) => !e.real.has(d)).length,
    }))
    .sort((a, b) => a.tag.localeCompare(b.tag))
  return {
    blocks,
    totalDays: blocks.reduce((n, b) => n + b.total, 0),
    attendedDays: blocks.reduce((n, b) => n + b.attended, 0),
    inferredDays: blocks.reduce((n, b) => n + b.inferred, 0),
  }
}

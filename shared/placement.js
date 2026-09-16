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

/**
 * The working policy for a placement (PL-03, Pass 86): the placement's own
 * override wins, else the profile default. `source` names which, so screens
 * can say where a value came from.
 */
export function placementPolicyOf(settings, placement) {
  const base = {
    start: settings?.placementHours?.start ?? '08:30',
    end: settings?.placementHours?.end ?? '15:45',
    breakMins: settings?.placementHours?.breakMins ?? 0,
    insetCounts: settings?.placementInsetCounts !== false,
    source: 'profile',
  }
  if (!placement) return base
  const hours = placement.workingHours && validateWorkingHours(placement.workingHours) === null ? placement.workingHours : null
  const inset = typeof placement.insetCountsAsSchoolDay === 'boolean' ? placement.insetCountsAsSchoolDay : base.insetCounts
  return { ...base, start: hours?.start ?? base.start, end: hours?.end ?? base.end, insetCounts: inset, source: hours || typeof placement.insetCountsAsSchoolDay === 'boolean' ? 'placement' : 'profile' }
}

/** The placement that owns a block tag, if any (records with mappedBlockTags). */
export const placementOwning = (placements, tag) => (placements ?? []).find((p) => (p.mappedBlockTags ?? []).includes(tag)) ?? null

/** Policy for a block tag: dated exceptions are handled by the caller; this resolves placement override → profile default. */
export function resolvePolicy(tag, settings, placements) {
  return placementPolicyOf(settings, placementOwning(placements, tag))
}

/** PL-05: a school day must end strictly after it starts; both clocks must be valid. Returns an error sentence or null. */
export function validateWorkingHours(hours) {
  if (!hours) return null
  const s = toMins(hours.start)
  const e = toMins(hours.end)
  if (s === null || e === null) return 'Enter both times as HH:MM.'
  if (e <= s) return 'The school day must end after it starts — swap the times or clear the override to use your default.'
  return null
}

/** PL-01: an address normalised for comparing "is this pin still for this address?". */
export const normaliseAddress = (a) => (a ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * PL-01: is the school's pin current for its address? A pin located for a
 * different address (the address changed after locating) is never current;
 * a record without `locatedFor` (pre-Pass-86) is trusted as before.
 */
export function locationCurrent(school) {
  if (!school || school.lat == null || school.lng == null) return false
  if (!Number.isFinite(school.lat) || !Number.isFinite(school.lng)) return false
  if (school.locatedFor === undefined) return true
  return normaliseAddress(school.locatedFor) === normaliseAddress(school.address)
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
export function applyPlacementExceptionRules(sessions, exceptions, settings, placements = []) {
  if (!exceptions || exceptions.length === 0) return sessions
  return sessions.filter((s) => {
    if (s.isKeyDate || !isPlacementTitle(s.title)) return true
    const tag = placementTagOf(s.title)
    return !isExcluded(exceptionFor(exceptions, tag, s.dateISO), resolvePolicy(tag, settings, placements))
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
export function computePlacementBlocks(sessions, exceptions, settings, metaOf, placements = []) {
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
    // PL-03: each block follows the policy of the placement that owns it.
    const policy = resolvePolicy(tag, settings, placements)
    const days = []
    for (const [dateISO, rows] of [...dates.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const exception = exceptionFor(exceptions, tag, dateISO)
      const excluded = isExcluded(exception, policy)
      const inferred = rows.every((r) => String(r.id ?? '').startsWith('plc-'))
      // Day length precedence (PL-03): a dated exception's hours → the imported
      // row's own times → the placement's default → the profile default; minus the break.
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

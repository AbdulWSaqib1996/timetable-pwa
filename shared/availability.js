import { COURSE_TIMEZONE, addDaysISO, utcToZonedParts, wallToUTC } from './calendar-time.js'

/**
 * Study-group availability model (P6-05), runtime-neutral so the browser
 * client and node unit tests agree byte-for-byte.
 *
 * Availability is intervals only: {d, from, to} wall minutes in the member's
 * declared timezone, plus generation time and horizon. Freshness is explicit —
 * a member whose availability is old or absent is EXCLUDED from the common
 * slots and reported, never silently treated as free.
 */

/** Availability older than this is stale and no longer trusted as "free". */
export const AVAILABILITY_FRESH_MS = 24 * 3_600_000

export const DEFAULT_WORK_START = 9 * 60
export const DEFAULT_WORK_END = 17 * 60
export const DEFAULT_MIN_MEETING = 30

/** 'fresh' | 'stale' | 'missing' for a member's published availability. */
export function memberFreshness(member, nowMs) {
  const at = Number(member?.at) || 0
  if (!at || !Array.isArray(member?.slots)) return 'missing'
  return nowMs - at < AVAILABILITY_FRESH_MS ? 'fresh' : 'stale'
}

/** "just now" | "23 min ago" | "5 h ago" | "3 days ago" */
export function lastUpdatedLabel(atMs, nowMs) {
  const mins = Math.max(0, Math.round((nowMs - atMs) / 60_000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.round(hours / 24)} days ago`
}

const isoDow = (dateISO) => {
  const [y, m, d] = dateISO.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/**
 * Free intervals from busy intervals: weekdays within [workStart, workEnd),
 * gaps of at least minMinutes, over `days` days from todayISO inclusive.
 * Busy blocks come from course sessions AND opted-in personal busy
 * commitments — the caller supplies plain intervals, never titles.
 */
export function computeFreeIntervals(busy, { todayISO, days = 7, workStart = DEFAULT_WORK_START, workEnd = DEFAULT_WORK_END, minMinutes = DEFAULT_MIN_MEETING } = {}) {
  const out = []
  for (let i = 0; i < days; i++) {
    const dateISO = addDaysISO(todayISO, i)
    const dow = isoDow(dateISO)
    if (dow === 0 || dow === 6) continue
    const dayBusy = busy
      .filter((b) => b.d === dateISO && b.to > b.from)
      .sort((a, b) => a.from - b.from)
    let cursor = workStart
    for (const b of dayBusy) {
      if (b.from - cursor >= minMinutes) out.push({ d: dateISO, from: cursor, to: Math.min(b.from, workEnd) })
      cursor = Math.max(cursor, b.to)
      if (cursor >= workEnd) break
    }
    if (workEnd - cursor >= minMinutes) out.push({ d: dateISO, from: cursor, to: workEnd })
  }
  return out.slice(0, 100)
}

/**
 * Convert wall-time slots from one timezone to another. A converted slot that
 * crosses midnight in the target zone is split into two same-day intervals so
 * downstream day-keyed intersection stays correct.
 */
export function slotsToZone(slots, fromTz, toTz) {
  if (!fromTz || fromTz === toTz) return slots
  const out = []
  for (const s of slots) {
    const hhmm = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
    const startUTC = wallToUTC(s.d, hhmm(s.from), fromTz).utcMs
    const endUTC = wallToUTC(s.d, hhmm(s.to === 1440 ? 1439 : s.to), fromTz).utcMs + (s.to === 1440 ? 60_000 : 0)
    const start = utcToZonedParts(startUTC, toTz)
    const end = utcToZonedParts(endUTC, toTz)
    const toMin = (p) => Number(p.hhmm.slice(0, 2)) * 60 + Number(p.hhmm.slice(3, 5))
    if (start.dateISO === end.dateISO) {
      out.push({ d: start.dateISO, from: toMin(start), to: toMin(end) || 1440 })
    } else {
      // Crosses midnight in the target zone: split at the boundary.
      out.push({ d: start.dateISO, from: toMin(start), to: 1440 })
      const endMin = toMin(end)
      if (endMin > 0) out.push({ d: end.dateISO, from: 0, to: endMin })
    }
  }
  return out.filter((s) => s.to > s.from)
}

/**
 * Common availability for the group. Only FRESH members count; stale/missing
 * members are returned in `excluded` with a reason so the UI can say why they
 * are not shown as free. Slots from members in another timezone are converted
 * into the course zone before intersecting.
 */
export function intersectAvailability(members, { minMinutes = DEFAULT_MIN_MEETING, now = Date.now(), tz = COURSE_TIMEZONE, workStart, workEnd } = {}) {
  const counted = []
  const excluded = []
  for (const m of members) {
    const freshness = memberFreshness(m, now)
    if (freshness !== 'fresh') {
      excluded.push({ memberId: m.memberId, name: m.name, reason: freshness })
      continue
    }
    counted.push(slotsToZone(m.slots, m.tz ?? tz, tz))
  }
  let common = counted.length > 0 ? counted[0] : []
  for (const next of counted.slice(1)) {
    const merged = []
    for (const a of common) {
      for (const b of next) {
        if (a.d !== b.d) continue
        const from = Math.max(a.from, b.from)
        const to = Math.min(a.to, b.to)
        if (to - from >= minMinutes) merged.push({ d: a.d, from, to })
      }
    }
    common = merged
  }
  if (workStart !== undefined || workEnd !== undefined) {
    common = common
      .map((s) => ({ d: s.d, from: Math.max(s.from, workStart ?? 0), to: Math.min(s.to, workEnd ?? 1440) }))
      .filter((s) => s.to - s.from >= minMinutes)
  }
  common.sort((a, b) => (a.d + String(a.from).padStart(4, '0')).localeCompare(b.d + String(b.from).padStart(4, '0')))
  return { slots: common, counted: counted.length, excluded }
}

/**
 * The EXACT body published to the group server. Kept as a pure builder so a
 * unit test can inspect it: intervals, identity and capability only — no
 * session titles, rooms, tutors or any other private detail can get in.
 */
export function availabilityPayload({ code, name, slots, tz = COURSE_TIMEZONE, horizonDays = 7, creds, wantCredentials = true }) {
  return {
    code,
    name,
    slots: slots.map((s) => ({ d: s.d, from: s.from, to: s.to })),
    tz,
    horizonDays,
    wantCredentials,
    ...(creds?.memberId ? { memberId: creds.memberId } : {}),
    ...(creds?.token ? { token: creds.token } : {}),
  }
}

/**
 * Calendar identity for an accepted proposal: stable across regenerations so
 * re-importing updates rather than duplicates. This exports to the USER'S OWN
 * calendar only — nothing is inserted into anyone else's.
 */
export function proposalEvent(code, proposal) {
  const hhmm = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
  return {
    id: `group-${code}-${proposal.id}`,
    calendarUid: `group-${code}-${proposal.id}`,
    dateISO: proposal.slot.d,
    start: hhmm(proposal.slot.from),
    end: hhmm(proposal.slot.to),
    title: 'Study group meet-up',
  }
}

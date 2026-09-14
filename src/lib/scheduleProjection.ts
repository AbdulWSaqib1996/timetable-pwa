import { sessionKey } from './diff'
import type { Session } from '../types'

/**
 * Canonical display/search projection (R1 / TT-02, TT-03). Imported
 * sessions, personal commitments and task pins stay separate canonical
 * owners; this only decides which of them a view SHOWS, deduplicated by
 * owner identity. "Visible" is never permission to notify or share —
 * reminder and availability eligibility have their own selectors.
 */

export interface ProjectionInput {
  /** imported sessions after membership + temporary display filters */
  filteredCourse: Session[]
  /** imported sessions, membership only (all dates) — the search corpus */
  courseAll: Session[]
  personal: Session[]
  keyDates: Session[]
  showPersonal: boolean
  showKeyDates: boolean
}

export interface Projection {
  /** timed items for Week/Month/Today/day lists */
  calendar: Session[]
  /** deadline/key-date pins for headers and month dots */
  pins: Session[]
  /** everything searchable, across all dates, display filters NOT applied */
  searchCorpus: Session[]
}

const byDateTime = (a: Session, b: Session) => (a.dateISO + (a.start || '99')).localeCompare(b.dateISO + (b.start || '99'))

/** Same day and, after trimming/case/whitespace, the same title: one key date, however many rows say so. */
export const sameDayTitle = (s: Session) => `${s.dateISO}|${s.title.trim().toLowerCase().replace(/\s+/g, ' ')}`
const norm = (v: string | undefined) => (v ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * Two key-date rows are the SAME event (audit B09, Pass 78) only when they
 * share the day and normalised title AND their starts agree (or one side is
 * untimed) AND neither a room nor a module contradicts the other. Two timed
 * rows at different times, or in different rooms, are two items and both stay.
 */
export function equivalentKeyDates(a: Session, b: Session): boolean {
  if (sameDayTitle(a) !== sameDayTitle(b)) return false
  if (a.start && b.start && a.start !== b.start) return false
  if (norm(a.room) && norm(b.room) && norm(a.room) !== norm(b.room)) return false
  if (norm(a.subject) && norm(b.subject) && norm(a.subject) !== norm(b.subject)) return false
  return true
}

/**
 * Key dates shown once (owner report, 13 Sep 2026): the key-dates tab can
 * repeat a deadline row with its own ID, and a personal task can carry the
 * same title on the same day. Identity dedupe keeps both; this keeps the
 * FIRST of each EQUIVALENT pair — sheet key dates come before task pins in
 * the input, so the sheet's row wins and the task still lives on Tasks. A
 * non-equivalent pair (different times or rooms) is kept whole.
 */
export function dedupeKeyDates(items: Session[]): Session[] {
  const out: Session[] = []
  for (const s of dedupeByKey(items)) {
    if (out.some((kept) => equivalentKeyDates(kept, s))) continue
    out.push(s)
  }
  return out
}

/**
 * B09: a course row is the key date itself (and so not repeated) only when it
 * carries the pin's day+title and the same start — or the pin is untimed and
 * this is the only row with that title on the day. A lesson that merely shares
 * a deadline's title at another time stays on the timetable.
 */
export function sessionIsPin(session: Session, pin: Session, sameTitledThatDay: number): boolean {
  if (sameDayTitle(session) !== sameDayTitle(pin)) return false
  if (pin.start) return session.start === pin.start
  return sameTitledThatDay === 1
}

/** How many visible key dates on that day share this one's title (for the "2 items" affordance). */
export function keyDateSiblings(pin: Session, pins: Session[]): number {
  const t = sameDayTitle(pin)
  return pins.filter((p) => sameDayTitle(p) === t).length
}

/** Day first; on a day the highlighted key dates lead, then timed rows by start. */
export const byDayKeyDateFirst = (a: Session, b: Session) => {
  if (a.dateISO !== b.dateISO) return a.dateISO.localeCompare(b.dateISO)
  if (!!a.isKeyDate !== !!b.isKeyDate) return a.isKeyDate ? -1 : 1
  return (a.start || '99').localeCompare(b.start || '99')
}

export function dedupeByKey(items: Session[]): Session[] {
  const seen = new Set<string>()
  const out: Session[] = []
  for (const s of items) {
    const k = sessionKey(s)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(s)
  }
  return out
}

export function buildProjection(input: ProjectionInput): Projection {
  const pins = input.showKeyDates ? dedupeKeyDates(input.keyDates).sort(byDateTime) : []
  // A deadline that the main timetable tab ALSO lists as a row on that day is one key
  // date, shown once and highlighted — the plain course row for it is not repeated.
  // Only a row that IS the pin is dropped (B09): same start, or the sole same-titled row
  // for an untimed pin. A lesson that merely shares the title at another time stays.
  const pinsByTitle = new Map<string, Session[]>()
  for (const p of pins) pinsByTitle.set(sameDayTitle(p), [...(pinsByTitle.get(sameDayTitle(p)) ?? []), p])
  const titledCount = new Map<string, number>()
  for (const s of input.filteredCourse) titledCount.set(sameDayTitle(s), (titledCount.get(sameDayTitle(s)) ?? 0) + 1)
  const isPin = (s: Session) => (pinsByTitle.get(sameDayTitle(s)) ?? []).some((p) => sessionIsPin(s, p, titledCount.get(sameDayTitle(s)) ?? 0))
  const calendar = dedupeByKey([...input.filteredCourse.filter((s) => !isPin(s)), ...(input.showPersonal ? input.personal : [])]).sort(byDateTime)
  // Search ignores temporary display filters: course-member events, personal
  // events and task pins across all dates — the user is looking for a thing,
  // not for what today's filter happens to show.
  const searchCorpus = dedupeByKey([...input.courseAll, ...input.personal, ...input.keyDates]).sort(byDateTime)
  return { calendar, pins, searchCorpus }
}

/** Dates that must appear as columns: any visible timed item OR pin. */
export function visibleDates(projection: Projection): Set<string> {
  const out = new Set<string>()
  for (const s of projection.calendar) out.add(s.dateISO)
  for (const s of projection.pins) out.add(s.dateISO)
  return out
}

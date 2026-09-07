import { zonedTodayISO } from '../../shared/calendar-time.js'
import { expandGroupOptions, sessionInMembership } from '../../shared/membership.js'
import type { Filters, Session, Settings } from '../types'
import { isPlacementSession } from './format'

export const DEFAULT_FILTERS: Filters = {
  dateRange: 'all',
  subjects: [],
  tutors: [],
  rooms: [],
  showSelfStudy: true,
  showOptional: true,
  showKeyDates: true,
  placementsOnly: false,
}

export function getFilters(settings: Settings): Filters {
  return { ...DEFAULT_FILTERS, ...settings.filters }
}

export interface FilterOptions {
  specialisms: string[]
  subjects: string[]
  tutors: string[]
  rooms: string[]
  groups: string[]
}

function distinctSorted(values: (string | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v && v.trim() !== ''))].sort((a, b) =>
    a.localeCompare(b)
  )
}

/** Distinct values the filter UI offers, derived from the loaded sheet.
 *  Group ranges like "1-10" expand so a Group 2 member can pick "2". */
export function deriveOptions(sessions: Session[]): FilterOptions {
  return {
    specialisms: distinctSorted(sessions.map((s) => s.specialismName)),
    subjects: distinctSorted(
      sessions.filter((s) => !s.isSpecialism && !s.isSelfStudy).map((s) => s.subject || s.title)
    ),
    tutors: distinctSorted(sessions.filter((s) => !s.isSelfStudy).map((s) => s.tutor)),
    rooms: distinctSorted(sessions.filter((s) => !s.isSelfStudy).map((s) => s.room)),
    groups: expandGroupOptions(sessions.map((s) => s.groups)),
  }
}

/** Today in the course timezone (Europe/London) — "today" must not shift when
 *  the device travels; the course calendar stays on London wall time. */
export function localTodayISO(): string {
  return zonedTodayISO()
}

/** Monday–Sunday bounds (inclusive, ISO dates) of the week containing `todayISO`. */
export function weekBounds(todayISO: string): { from: string; to: string } {
  const [y, m, d] = todayISO.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const dow = (date.getDay() + 6) % 7 // 0 = Monday
  const monday = new Date(y, m - 1, d - dow)
  const sunday = new Date(y, m - 1, d - dow + 6)
  const iso = (dt: Date) =>
    `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
  return { from: iso(monday), to: iso(sunday) }
}

/** The user's saved enrolment (specialisms + groups) as a membership record. */
export function membershipOf(settings: Settings): { specialisms: string[]; groups: string[] } {
  const mySpecialisms = settings.mySpecialisms ?? []
  const hideOthers = settings.hideOtherSpecialisms !== false && mySpecialisms.length > 0
  return { specialisms: hideOthers ? mySpecialisms : [], groups: settings.myGroups ?? [] }
}

/**
 * Course membership only: the sessions this user is enrolled in. This is the
 * base set for reminders, statistics, exports, journals and group availability —
 * temporary display filters (rooms, subjects, search…) never narrow it.
 */
export function selectCourseSessions(sessions: Session[], settings: Settings): Session[] {
  const membership = membershipOf(settings)
  return sessions.filter((s) => sessionInMembership(s, membership))
}

/** Should this course session produce reminders/leave alerts? Optional and
 *  self-study participation are explicit preferences, not display filters. */
export function reminderEligible(s: Session, settings: Settings): boolean {
  if (s.isOptional && settings.remindOptional === false) return false
  if (s.isSelfStudy && settings.remindSelfStudy === false) return false
  return true
}

/** Sessions notifications may fire for: membership plus reminder eligibility. */
export function selectReminderSessions(sessions: Session[], settings: Settings): Session[] {
  return selectCourseSessions(sessions, settings).filter((s) => reminderEligible(s, settings))
}

/** Temporary display narrowing applied on top of course membership. */
export function selectVisibleSessions(
  courseSessions: Session[],
  settings: Settings,
  todayISO: string,
  opts: { ignoreDateRange?: boolean } = {}
): Session[] {
  const filters = getFilters(settings)
  const dateRange = opts.ignoreDateRange ? 'all' : filters.dateRange
  const week = dateRange === 'week' ? weekBounds(todayISO) : null
  return courseSessions.filter((s) => {
    if (filters.placementsOnly && !isPlacementSession(s)) return false
    if (!filters.showSelfStudy && s.isSelfStudy) return false
    if (!filters.showOptional && s.isOptional) return false
    if (filters.subjects.length > 0 && !s.isSpecialism && !s.isSelfStudy) {
      if (!filters.subjects.includes(s.subject || s.title)) return false
    }
    if (filters.tutors.length > 0 && !s.isSelfStudy && !filters.tutors.includes(s.tutor)) return false
    if (filters.rooms.length > 0 && !s.isSelfStudy && !filters.rooms.includes(s.room)) return false
    if (dateRange === 'today' && s.dateISO !== todayISO) return false
    if (week && (s.dateISO < week.from || s.dateISO > week.to)) return false
    return true
  })
}

/** Membership + display filters together (what the timetable screens show). */
export function applyFilters(
  sessions: Session[],
  settings: Settings,
  todayISO: string,
  opts: { ignoreDateRange?: boolean } = {}
): Session[] {
  return selectVisibleSessions(selectCourseSessions(sessions, settings), settings, todayISO, opts)
}

/** How many temporary display filters are active (badge on the Filters button).
 *  Group/specialism membership is enrolment, not a display filter — not counted. */
export function activeFilterCount(settings: Settings): number {
  const filters = getFilters(settings)
  let count = filters.subjects.length + filters.tutors.length + filters.rooms.length
  if (!filters.showSelfStudy) count++
  if (!filters.showOptional) count++
  if (!filters.showKeyDates) count++
  if (filters.placementsOnly) count++
  return count
}

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

export function groupTokens(groups: string): string[] {
  return groups
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
}

function distinctSorted(values: (string | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v && v.trim() !== ''))].sort((a, b) =>
    a.localeCompare(b)
  )
}

/** Distinct values the filter UI offers, derived from the loaded sheet. */
export function deriveOptions(sessions: Session[]): FilterOptions {
  return {
    specialisms: distinctSorted(sessions.map((s) => s.specialismName)),
    subjects: distinctSorted(
      sessions.filter((s) => !s.isSpecialism && !s.isSelfStudy).map((s) => s.subject || s.title)
    ),
    tutors: distinctSorted(sessions.filter((s) => !s.isSelfStudy).map((s) => s.tutor)),
    rooms: distinctSorted(sessions.filter((s) => !s.isSelfStudy).map((s) => s.room)),
    groups: [...new Set(sessions.flatMap((s) => groupTokens(s.groups)))].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    ),
  }
}

export function localTodayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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

export function applyFilters(
  sessions: Session[],
  settings: Settings,
  todayISO: string,
  opts: { ignoreDateRange?: boolean } = {}
): Session[] {
  const filters = getFilters(settings)
  const mySpecialisms = settings.mySpecialisms ?? []
  const hideOthers = settings.hideOtherSpecialisms !== false && mySpecialisms.length > 0
  const dateRange = opts.ignoreDateRange ? 'all' : filters.dateRange
  const week = dateRange === 'week' ? weekBounds(todayISO) : null

  const myGroups = settings.myGroups ?? []
  return sessions.filter((s) => {
    if (filters.placementsOnly && !isPlacementSession(s)) return false
    if (hideOthers && s.isSpecialism && s.specialismName && !mySpecialisms.includes(s.specialismName)) {
      return false
    }
    if (myGroups.length > 0) {
      const tokens = groupTokens(s.groups)
      if (tokens.length > 0 && !tokens.some((t) => myGroups.includes(t))) return false
    }
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

/** How many non-default narrowing filters are active (shown as a badge on the Filters button). */
export function activeFilterCount(settings: Settings): number {
  const filters = getFilters(settings)
  let count = filters.subjects.length + filters.tutors.length + filters.rooms.length
  if (!filters.showSelfStudy) count++
  if (!filters.showOptional) count++
  if (!filters.showKeyDates) count++
  if (filters.placementsOnly) count++
  if ((settings.mySpecialisms ?? []).length > 0 && settings.hideOtherSpecialisms !== false) count++
  if ((settings.myGroups ?? []).length > 0) count++
  return count
}

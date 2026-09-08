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
  const calendar = dedupeByKey([...input.filteredCourse, ...(input.showPersonal ? input.personal : [])]).sort(byDateTime)
  const pins = input.showKeyDates ? dedupeByKey(input.keyDates).sort(byDateTime) : []
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

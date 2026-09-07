import { buildICSCalendar } from '../../shared/calendar-time.js'
import type { Session } from '../types'

/**
 * The .ics download shares one generator with the subscribed feed worker
 * (shared/calendar-time.js): course-timezone wall times exported as UTC
 * instants (correct on a device in any timezone, across DST) and RFC 5545
 * octet-based line folding.
 */
export function buildICS(sessions: Session[], calendarName: string): string {
  return buildICSCalendar(sessions, calendarName)
}

export function downloadICS(sessions: Session[], calendarName: string): void {
  const blob = new Blob([buildICS(sessions, calendarName)], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'my-timetable.ics'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

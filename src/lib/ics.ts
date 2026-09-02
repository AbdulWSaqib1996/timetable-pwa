import type { Session } from '../types'

function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

/** Fold lines longer than 74 octets per RFC 5545 §3.1. */
function fold(line: string): string {
  if (line.length <= 74) return line
  const parts: string[] = []
  let rest = line
  while (rest.length > 74) {
    parts.push(rest.slice(0, 74))
    rest = ' ' + rest.slice(74)
  }
  parts.push(rest)
  return parts.join('\r\n')
}

function dtLocal(dateISO: string, time: string): string {
  return `${dateISO.replace(/-/g, '')}T${time.replace(':', '')}00`
}

export function buildICS(sessions: Session[], calendarName: string): string {
  const now = new Date()
  const stamp = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}T${String(now.getUTCHours()).padStart(2, '0')}${String(now.getUTCMinutes()).padStart(2, '0')}${String(now.getUTCSeconds()).padStart(2, '0')}Z`
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//timetable-pwa//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    fold(`X-WR-CALNAME:${escapeText(calendarName)}`),
  ]
  for (const s of sessions) {
    lines.push('BEGIN:VEVENT')
    lines.push(fold(`UID:${s.id}@timetable-pwa`))
    lines.push(`DTSTAMP:${stamp}`)
    if (s.start) {
      lines.push(`DTSTART:${dtLocal(s.dateISO, s.start)}`)
      lines.push(`DTEND:${s.end ? dtLocal(s.dateISO, s.end) : dtLocal(s.dateISO, s.start)}`)
    } else {
      lines.push(`DTSTART;VALUE=DATE:${s.dateISO.replace(/-/g, '')}`)
    }
    lines.push(fold(`SUMMARY:${escapeText(s.title)}`))
    if (s.room && !s.isSelfStudy) lines.push(fold(`LOCATION:${escapeText(s.room)}`))
    const descParts = [
      s.tutor && s.tutor !== 'Self Study' ? `Tutor: ${s.tutor}` : '',
      s.subject && s.subject !== s.title ? `Subject: ${s.subject}` : '',
      s.groups ? `Groups: ${s.groups}` : '',
      s.link ? `Moodle: ${s.link}` : '',
    ].filter(Boolean)
    if (descParts.length > 0) lines.push(fold(`DESCRIPTION:${escapeText(descParts.join('\n'))}`))
    if (s.link) lines.push(fold(`URL:${s.link}`))
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
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

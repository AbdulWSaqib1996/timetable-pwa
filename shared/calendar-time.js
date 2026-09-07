/**
 * Course-calendar date/time helpers shared by the browser and workers.
 * The course runs on Europe/London wall time regardless of where the device
 * is — "today" and calendar maths use the course zone, not the device zone.
 */

export const COURSE_TIMEZONE = 'Europe/London'

/** Today's date (yyyy-mm-dd) in the course timezone. */
export function zonedTodayISO(zone = COURSE_TIMEZONE, now = new Date()) {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

const pad = (n) => String(n).padStart(2, '0')
const toUTC = (dateISO) => {
  const [y, m, d] = dateISO.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}
const fromUTC = (ms) => {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** dateISO + days (calendar arithmetic, timezone-free). */
export function addDaysISO(dateISO, days) {
  return fromUTC(toUTC(dateISO) + days * 86_400_000)
}

/** Monday of the week containing dateISO. */
export function mondayOfISO(dateISO) {
  const dow = (new Date(toUTC(dateISO)).getUTCDay() + 6) % 7
  return addDaysISO(dateISO, -dow)
}

/**
 * Shift a date by whole months, preserving the day number where valid and
 * clamping to the target month's length otherwise (31 Jan → 28/29 Feb).
 */
export function shiftMonthISO(dateISO, deltaMonths) {
  const [y, m, d] = dateISO.split('-').map(Number)
  const firstOfTarget = new Date(Date.UTC(y, m - 1 + deltaMonths, 1))
  const daysInTarget = new Date(Date.UTC(firstOfTarget.getUTCFullYear(), firstOfTarget.getUTCMonth() + 1, 0)).getUTCDate()
  return `${firstOfTarget.getUTCFullYear()}-${pad(firstOfTarget.getUTCMonth() + 1)}-${pad(Math.min(d, daysInTarget))}`
}

/* ---------- course wall time → UTC (one implementation for both runtimes) ---------- */

const offsetCache = new Map()

/** The zone's UTC offset (ms) at a given instant, via Intl (works in browsers
 *  and Workers alike — no bundled timezone database). */
export function zoneOffsetMs(utcMs, zone = COURSE_TIMEZONE) {
  const cacheKey = `${zone}|${Math.floor(utcMs / 3_600_000)}`
  const hit = offsetCache.get(cacheKey)
  if (hit !== undefined) return hit
  const dtf = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  })
  const parts = dtf.formatToParts(new Date(utcMs))
  const get = (type) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  const asUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'))
  const offset = asUTC - Math.floor(utcMs / 1000) * 1000
  if (offsetCache.size > 5000) offsetCache.clear()
  offsetCache.set(cacheKey, offset)
  return offset
}

/**
 * Convert a course-zone wall time to a UTC instant, handling DST explicitly:
 *  - a nonexistent wall time (spring-forward gap) maps to the instant one
 *    offset step later, with warning 'nonexistent' — never silently;
 *  - a repeated wall time (autumn ambiguity) takes the EARLIER instant, with
 *    warning 'ambiguous'.
 */
export function wallToUTC(dateISO, hhmm, zone = COURSE_TIMEZONE) {
  const [y, mo, d] = dateISO.split('-').map(Number)
  const [h, mi] = (hhmm || '00:00').split(':').map(Number)
  const wallAsUTC = Date.UTC(y, mo - 1, d, h, mi)
  // Probe the offsets in force around this date; DST transitions mean at most
  // two distinct candidates.
  const offsets = [...new Set([zoneOffsetMs(wallAsUTC - 86_400_000, zone), zoneOffsetMs(wallAsUTC + 86_400_000, zone), zoneOffsetMs(wallAsUTC, zone)])]
  const valid = offsets
    .map((offset) => wallAsUTC - offset)
    .filter((utcMs) => zoneOffsetMs(utcMs, zone) === wallAsUTC - utcMs)
    .sort((a, b) => a - b)
  if (valid.length === 1) return { utcMs: valid[0] }
  if (valid.length > 1) return { utcMs: valid[0], warning: 'ambiguous' }
  // Gap: no offset reproduces the wall time — shift FORWARD past the
  // transition (01:30 in the spring gap becomes 02:30 local), flagged.
  const after = Math.max(...offsets.map((offset) => wallAsUTC - offset))
  return { utcMs: after, warning: 'nonexistent' }
}

/* ---------- ICS generation (shared by the app download and the feed worker) ---------- */

export function escapeICSText(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

/** Fold long lines by UTF-8 OCTETS per RFC 5545 §3.1 — never by JavaScript
 *  string length, which undercounts every non-ASCII character. */
export function foldICSLine(line) {
  const encoder = new TextEncoder()
  if (encoder.encode(line).length <= 74) return line
  const out = []
  let current = ''
  let currentBytes = 0
  let limit = 74
  for (const ch of line) {
    const chBytes = encoder.encode(ch).length
    if (currentBytes + chBytes > limit) {
      out.push(current)
      current = ' '
      currentBytes = 1
      limit = 74
    }
    current += ch
    currentBytes += chBytes
  }
  out.push(current)
  return out.join('\r\n')
}

const icsStampUTC = (ms) => {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
}

/**
 * One ICS builder for the app download and the subscribed feed. Timed events
 * are emitted as UTC instants converted from course wall time (correct on a
 * device in any timezone, across DST); key dates and untimed rows are all-day
 * date values. UIDs come from the stable calendar identity.
 */
export function buildICSCalendar(sessions, calendarName, { zone = COURSE_TIMEZONE, now = new Date() } = {}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//timetable-pwa//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    foldICSLine(`X-WR-CALNAME:${escapeICSText(calendarName)}`),
  ]
  const stamp = icsStampUTC(now.getTime())
  for (const s of sessions) {
    lines.push('BEGIN:VEVENT')
    lines.push(foldICSLine(`UID:${escapeICSText(s.calendarUid || s.id)}@timetable-pwa`))
    lines.push(`DTSTAMP:${stamp}`)
    if (s.isKeyDate || !s.start) {
      // All-day events use date values; a single day needs no exclusive DTEND.
      lines.push(`DTSTART;VALUE=DATE:${s.dateISO.replace(/-/g, '')}`)
    } else {
      const start = wallToUTC(s.dateISO, s.start, zone)
      const end = wallToUTC(s.dateISO, s.end || s.start, zone)
      lines.push(`DTSTART:${icsStampUTC(start.utcMs)}`)
      lines.push(`DTEND:${icsStampUTC(Math.max(end.utcMs, start.utcMs))}`)
    }
    lines.push(foldICSLine(`SUMMARY:${escapeICSText(s.isKeyDate ? `📌 ${s.title}` : s.title)}`))
    if (s.room && !s.isSelfStudy) lines.push(foldICSLine(`LOCATION:${escapeICSText(s.room)}`))
    const descParts = [
      s.tutor && s.tutor !== 'Self Study' ? `Tutor: ${s.tutor}` : '',
      s.subject && s.subject !== s.title ? `Subject: ${s.subject}` : '',
      s.groups ? `Groups: ${s.groups}` : '',
      s.link ? `Moodle: ${s.link}` : '',
    ].filter(Boolean)
    if (descParts.length > 0) lines.push(foldICSLine(`DESCRIPTION:${escapeICSText(descParts.join('\n'))}`))
    if (s.link) lines.push(foldICSLine(`URL:${s.link}`))
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}

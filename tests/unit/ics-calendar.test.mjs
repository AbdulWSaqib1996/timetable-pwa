import test from 'node:test'
import assert from 'node:assert/strict'
import { buildICSCalendar, escapeICSText, foldICSLine, wallToUTC, zoneOffsetMs } from '../../shared/calendar-time.js'

test('London wall times convert to the right UTC instants in summer and winter', () => {
  // BST (UTC+1): 09:00 London = 08:00Z
  assert.equal(wallToUTC('2026-09-07', '09:00').utcMs, Date.UTC(2026, 8, 7, 8, 0))
  // GMT (UTC+0): 09:00 London = 09:00Z
  assert.equal(wallToUTC('2026-12-07', '09:00').utcMs, Date.UTC(2026, 11, 7, 9, 0))
  assert.equal(zoneOffsetMs(Date.UTC(2026, 8, 7, 8, 0)), 3_600_000)
  assert.equal(zoneOffsetMs(Date.UTC(2026, 11, 7, 9, 0)), 0)
})

test('DST gap shifts forward with a warning; ambiguous hour takes the earlier instant with a warning', () => {
  // UK spring-forward 2027: 28 March, 01:00 GMT → 02:00 BST. 01:30 does not exist.
  const gap = wallToUTC('2027-03-28', '01:30')
  assert.equal(gap.warning, 'nonexistent')
  assert.equal(gap.utcMs, Date.UTC(2027, 2, 28, 1, 30)) // renders as 02:30 BST — forward, never silent
  // UK fall-back 2026: 25 October, 02:00 BST → 01:00 GMT. 01:30 happens twice.
  const ambiguous = wallToUTC('2026-10-25', '01:30')
  assert.equal(ambiguous.warning, 'ambiguous')
  assert.equal(ambiguous.utcMs, Date.UTC(2026, 9, 25, 0, 30)) // earlier (BST) instant
  // A plain time on the same day converts cleanly.
  assert.equal(wallToUTC('2026-10-25', '09:00').warning, undefined)
})

test('ICS folding counts UTF-8 octets, unfolds back to the original', () => {
  const line = 'SUMMARY:' + '📌 Émile’s viva — assessment '.repeat(8)
  const folded = foldICSLine(line)
  const encoder = new TextEncoder()
  for (const part of folded.split('\r\n')) {
    assert.ok(encoder.encode(part).length <= 74, `folded line is ${encoder.encode(part).length} octets`)
  }
  // Unfold (strip the leading space of each continuation) reproduces the input.
  const unfolded = folded.split('\r\n').map((p, i) => (i === 0 ? p : p.slice(1))).join('')
  assert.equal(unfolded, line)
})

test('calendar output: UTC instants, all-day deadlines, escaped Unicode titles, stable UIDs', () => {
  const sessions = [
    {
      id: 'row-1',
      calendarUid: 'stable-uid-1',
      title: 'Maths; planning, part 1\nwith notes',
      dateISO: '2026-09-07',
      start: '09:00',
      end: '10:30',
      room: 'IOE - Bedford Way (20) - 642',
      tutor: 'Alex',
      groups: '1-10',
      subject: 'Maths',
    },
    { id: 'kd-1', title: '📌 Essay due', dateISO: '2026-11-02', start: '17:00', end: '', isKeyDate: true },
    { id: 'row-2', title: 'Untimed marker', dateISO: '2026-09-08', start: '', end: '' },
  ]
  const ics = buildICSCalendar(sessions, 'My Timetable', { now: new Date('2026-09-01T12:00:00Z') })
  assert.match(ics, /UID:stable-uid-1@timetable-pwa/)
  assert.match(ics, /DTSTART:20260907T080000Z/) // 09:00 BST → 08:00Z
  assert.match(ics, /DTEND:20260907T093000Z/)
  assert.match(ics, /DTSTART;VALUE=DATE:20261102/) // deadline stays all-day
  assert.match(ics, /DTSTART;VALUE=DATE:20260908/) // untimed row stays all-day
  assert.match(ics, /SUMMARY:Maths\\; planning\\, part 1\\nwith notes/)
  // Same input, later stamp: UIDs and times are unchanged (stable identity).
  const again = buildICSCalendar(sessions, 'My Timetable', { now: new Date('2026-09-02T09:00:00Z') })
  const strip = (t) => t.split('\r\n').filter((l) => !l.startsWith('DTSTAMP')).join('\n')
  assert.equal(strip(ics), strip(again))
  assert.equal(escapeICSText('a,b;c\\d'), 'a\\,b\\;c\\\\d')
})

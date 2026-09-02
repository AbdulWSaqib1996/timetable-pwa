import type { Session } from '../types'

/** "IOE - Bedford Way (20) - 631" → "Bedford Way 631" (cards only; detail shows the full name). */
export function shortenRoom(room: string): string {
  if (!room) return room
  let r = room.replace(/^IOE\s*[-–]\s*/i, '').replace(/\s*\(\d+\)\s*/g, ' ')
  r = r.replace(/\s*[-–]\s*/g, ' - ').replace(/\s{2,}/g, ' ').trim()
  r = r.replace(/ - (?=\d)/g, ' ')
  return r
}

/** Accent colours that read well on both light and dark surfaces. */
const PALETTE = ['#3b5bdb', '#0ca678', '#e8590c', '#9c36b5', '#1098ad', '#f08c00', '#e64980', '#37b24d']

/** Deterministic per-subject colour so the same class always looks the same. */
export function subjectColor(session: Session): string | null {
  if (session.isSelfStudy) return null
  const key = (session.subject || session.title).toLowerCase().trim()
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  return PALETTE[hash % PALETTE.length]
}

export function toMinutes(time: string): number | null {
  const m = time.match(/^(\d{1,2}):(\d{2})$/)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

export function formatRemaining(mins: number): string {
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const rest = mins % 60
  return rest > 0 ? `${h}h ${rest}m` : `${h}h`
}

/** Google Calendar "add event" template link (times are floating local, as in the ICS export). */
export function googleCalendarUrl(s: Session): string | null {
  if (!s.start) return null
  const dt = (t: string) => `${s.dateISO.replace(/-/g, '')}T${t.replace(':', '')}00`
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: s.title,
    dates: `${dt(s.start)}/${dt(s.end || s.start)}`,
  })
  if (s.room && !s.isSelfStudy) params.set('location', s.room)
  const details = [
    s.tutor && s.tutor !== 'Self Study' ? `Tutor: ${s.tutor}` : '',
    s.link ? `Moodle: ${s.link}` : '',
  ]
    .filter(Boolean)
    .join('\n')
  if (details) params.set('details', details)
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

/** Whole days from todayISO to dateISO (0 = today, negative = past). */
export function daysUntil(dateISO: string, todayISO: string): number {
  const toTime = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number)
    return new Date(y, m - 1, d).getTime()
  }
  return Math.round((toTime(dateISO) - toTime(todayISO)) / 86_400_000)
}

/** 1-based teaching-week number for a date, from the Monday of the term-start week. */
export function weekNumber(dateISO: string, termStartISO: string): number | null {
  const toDate = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number)
    return new Date(y, m - 1, d)
  }
  const termMonday = toDate(termStartISO)
  termMonday.setDate(termMonday.getDate() - ((termMonday.getDay() + 6) % 7))
  const diff = Math.floor((toDate(dateISO).getTime() - termMonday.getTime()) / (7 * 86_400_000))
  return diff >= 0 ? diff + 1 : null
}

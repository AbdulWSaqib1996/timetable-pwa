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

import type { Session } from '../types'
import { isPlacementSession, placementTag } from './format'
import { parsePlacementRange } from '../../shared/placementRange.js'
import { bankHolidayOn } from '../../shared/bankHolidays.js'

/**
 * Sheets mark placements as single rows like "SE1a begins (28th Sept - 2nd Oct 2026)" —
 * one row on the first day, nothing on the days between. Parse the range out of the
 * title (shared/placementRange.js — the workers use the same parser) and synthesize a
 * placement day for every weekday in the span, except bank holidays, so the block
 * actually appears in the timetable.
 */

export { parsePlacementRange }

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`

export function expandPlacementSpans(sessions: Session[]): Session[] {
  const out = [...sessions]
  const seenSpans = new Set<string>()
  for (const s of sessions) {
    if (!isPlacementSession(s)) continue
    const range = parsePlacementRange(s.title)
    if (!range) continue
    const tag = placementTag(s.title)
    const spanKey = `${tag}|${range.from}|${range.to}`
    if (seenSpans.has(spanKey)) continue
    seenSpans.add(spanKey)
    const validTime = (t: string) => t && t !== '00:00'
    const start = validTime(s.start) && s.start !== s.end ? s.start : '08:30'
    const end = validTime(s.end) && s.end !== s.start ? s.end : '15:45'
    const [y, m, d] = range.from.split('-').map(Number)
    const cursor = new Date(y, m - 1, d)
    while (true) {
      const dateISO = iso(cursor.getFullYear(), cursor.getMonth(), cursor.getDate())
      if (dateISO > range.to) break
      const dow = cursor.getDay()
      const alreadyMarked = sessions.some(
        (x) => x.dateISO === dateISO && isPlacementSession(x) && placementTag(x.title) === tag
      )
      if (dow !== 0 && dow !== 6 && !alreadyMarked && !bankHolidayOn(dateISO)) {
        out.push({
          id: `plc-${tag}-${dateISO}`,
          title: `${tag} placement day`,
          day: '',
          dateISO,
          start,
          end,
          room: '',
          groups: '',
          tutor: '',
          subject: `${tag} placement`,
          isSpecialism: false,
          isSelfStudy: false,
          isOptional: false,
        })
      }
      cursor.setDate(cursor.getDate() + 1)
    }
  }
  return out.sort((a, b) => (a.dateISO + (a.start || '99')).localeCompare(b.dateISO + (b.start || '99')))
}

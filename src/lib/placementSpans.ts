import type { Session } from '../types'
import { isPlacementSession, placementTag } from './format'

/**
 * Sheets mark placements as single rows like "SE1a begins (28th Sept - 2nd Oct 2026)" —
 * one row on the first day, nothing on the days between. Parse the range out of the
 * title and synthesize a placement day for every weekday in the span so the block
 * actually appears in the timetable.
 */

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`

/** "(28th Sept - 2nd Oct 2026)" / "(8th-12th March 2027)" → { from, to } ISO dates. */
export function parsePlacementRange(title: string): { from: string; to: string } | null {
  const m = title.match(
    /\((\d{1,2})(?:st|nd|rd|th)?(?:\s+([A-Za-z]+))?\s*[-–—]\s*(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})\)/
  )
  if (!m) return null
  const [, d1, m1name, d2, m2name, year] = m
  const mo2 = MONTHS[m2name.slice(0, 3).toLowerCase()]
  if (mo2 === undefined) return null
  const mo1 = m1name !== undefined ? MONTHS[m1name.slice(0, 3).toLowerCase()] : mo2
  if (mo1 === undefined) return null
  const from = iso(Number(year), mo1, Number(d1))
  const to = iso(Number(year), mo2, Number(d2))
  return from <= to ? { from, to } : null
}

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
      if (dow !== 0 && dow !== 6 && !alreadyMarked) {
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

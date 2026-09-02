import type { GvizCell, GvizTable } from './gviz'
import type { Session } from '../types'

type Field = 'title' | 'day' | 'date' | 'start' | 'end' | 'room' | 'groups' | 'tutor' | 'subject' | 'link'

const HEADER_MAP: Record<string, Field> = {
  title: 'title',
  day: 'day',
  date: 'date',
  start: 'start',
  'start time': 'start',
  end: 'end',
  'end time': 'end',
  room: 'room',
  location: 'room',
  groups: 'groups',
  group: 'groups',
  tutor: 'tutor',
  tutors: 'tutor',
  subject: 'subject',
  link: 'link',
  url: 'link',
  moodle: 'link',
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}

const SPECIALISM_RE = /^specialism\s*\d*\s*[-–—:]\s*(.+)$/i

function cellText(cell: GvizCell | null): string {
  if (!cell) return ''
  if (cell.f != null && cell.f !== '') return String(cell.f).trim()
  if (cell.v == null) return ''
  return String(cell.v).trim()
}

/** GViz serialises date values as the string "Date(2026,8,2)" (month is 0-based). */
function parseGvizDateString(s: string): { y: number; m: number; d: number; h?: number; min?: number } | null {
  const m = s.match(/^Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+))?/)
  if (!m) return null
  return {
    y: Number(m[1]), m: Number(m[2]), d: Number(m[3]),
    h: m[4] !== undefined ? Number(m[4]) : undefined,
    min: m[5] !== undefined ? Number(m[5]) : undefined,
  }
}

export function toISODate(y: number, monthIndex: number, d: number): string {
  return `${y}-${String(monthIndex + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Parse a date cell into yyyy-mm-dd. Handles GViz Date(...) values and "2-Sep-2026"-style text. */
export function parseDateCell(cell: GvizCell | null): string | null {
  if (!cell) return null
  if (typeof cell.v === 'string') {
    const g = parseGvizDateString(cell.v)
    if (g) return toISODate(g.y, g.m, g.d)
  }
  const text = cellText(cell)
  if (!text) return null
  const m = text.match(/^(\d{1,2})[-/ ]([A-Za-z]{3,})[-/ ](\d{4})$/)
  if (m) {
    const month = MONTHS[m[2].slice(0, 3).toLowerCase()]
    if (month !== undefined) return toISODate(Number(m[3]), month, Number(m[1]))
  }
  const dmy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (dmy) return toISODate(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]))
  const parsed = new Date(text)
  if (!isNaN(parsed.getTime())) {
    return toISODate(parsed.getFullYear(), parsed.getMonth(), parsed.getDate())
  }
  return null
}

/** Parse a time cell into HH:MM. Handles [h,m,s,ms] arrays, Date(1899,...) values and "9:30" text. */
export function parseTimeCell(cell: GvizCell | null): string {
  if (!cell) return ''
  if (Array.isArray(cell.v) && cell.v.length >= 2) {
    return `${String(cell.v[0]).padStart(2, '0')}:${String(cell.v[1]).padStart(2, '0')}`
  }
  if (typeof cell.v === 'string') {
    const g = parseGvizDateString(cell.v)
    if (g && g.h !== undefined && g.min !== undefined) {
      return `${String(g.h).padStart(2, '0')}:${String(g.min).padStart(2, '0')}`
    }
  }
  const text = cellText(cell)
  const m = text.match(/^(\d{1,2})[:.](\d{2})/)
  if (m) return `${m[1].padStart(2, '0')}:${m[2]}`
  return ''
}

function detectHeaderRow(table: GvizTable): { headerIndex: number; colMap: Partial<Record<Field, number>> } | null {
  const limit = Math.min(table.rows.length, 10)
  for (let r = 0; r < limit; r++) {
    const cells = table.rows[r].c
    const colMap: Partial<Record<Field, number>> = {}
    let matches = 0
    cells.forEach((cell, i) => {
      const field = HEADER_MAP[cellText(cell).toLowerCase()]
      if (field !== undefined && colMap[field] === undefined) {
        colMap[field] = i
        matches++
      }
    })
    if (matches >= 3) return { headerIndex: r, colMap }
  }
  return null
}

/**
 * Some sheets leave the Date/Start/End header cells blank (they come back empty from GViz).
 * Infer them from GViz's declared column types first, then by sniffing cell values.
 */
function inferMissingColumns(
  table: GvizTable,
  headerIndex: number,
  colMap: Partial<Record<Field, number>>
): void {
  const width = Math.max(table.cols.length, ...table.rows.map((r) => r.c.length), 0)
  const taken = new Set(Object.values(colMap) as number[])

  const sniff = (i: number, test: (cell: GvizCell | null) => boolean): boolean => {
    let hits = 0
    let nonEmpty = 0
    for (let r = headerIndex + 1; r < Math.min(table.rows.length, headerIndex + 40); r++) {
      const cell = table.rows[r].c[i] ?? null
      if (!cell || cell.v == null) continue
      nonEmpty++
      if (test(cell)) hits++
    }
    return nonEmpty > 0 && hits / nonEmpty > 0.5
  }

  const findColumn = (declaredTypes: string[], test: (cell: GvizCell | null) => boolean): number | undefined => {
    for (let i = 0; i < width; i++) {
      if (taken.has(i)) continue
      if (declaredTypes.includes(table.cols[i]?.type ?? '')) return i
    }
    for (let i = 0; i < width; i++) {
      if (taken.has(i)) continue
      if (sniff(i, test)) return i
    }
    return undefined
  }

  if (colMap.date === undefined) {
    const i = findColumn(['date'], (cell) => parseDateCell(cell) !== null)
    if (i !== undefined) {
      colMap.date = i
      taken.add(i)
    }
  }
  const isTime = (cell: GvizCell | null) => parseTimeCell(cell) !== ''
  if (colMap.start === undefined) {
    const i = findColumn(['datetime', 'timeofday'], isTime)
    if (i !== undefined) {
      colMap.start = i
      taken.add(i)
    }
  }
  if (colMap.end === undefined) {
    const i = findColumn(['datetime', 'timeofday'], isTime)
    if (i !== undefined) {
      colMap.end = i
      taken.add(i)
    }
  }
}

/** If no column was labelled as the link, find a column whose values are mostly URLs. */
function detectLinkColumn(table: GvizTable, headerIndex: number, taken: Set<number>): number | undefined {
  const width = Math.max(...table.rows.map((r) => r.c.length), 0)
  for (let i = 0; i < width; i++) {
    if (taken.has(i)) continue
    let urls = 0
    let nonEmpty = 0
    for (let r = headerIndex + 1; r < table.rows.length; r++) {
      const text = cellText(table.rows[r].c[i] ?? null)
      if (!text) continue
      nonEmpty++
      if (/^https?:\/\//i.test(text)) urls++
    }
    if (nonEmpty > 0 && urls / nonEmpty > 0.5) return i
  }
  return undefined
}

export interface ParseOutcome {
  sessions: Session[]
  warnings: string[]
}

export function parseTimetable(table: GvizTable): ParseOutcome {
  const warnings: string[] = []
  const detected = detectHeaderRow(table)
  if (!detected) {
    throw new Error(
      'Could not find a header row. The sheet needs columns like Title, Day, Date, Start, End, Room, Tutor.'
    )
  }
  const { headerIndex, colMap } = detected
  inferMissingColumns(table, headerIndex, colMap)
  if (colMap.link === undefined) {
    colMap.link = detectLinkColumn(table, headerIndex, new Set(Object.values(colMap) as number[]))
  }
  if (colMap.title === undefined || colMap.date === undefined) {
    throw new Error('The sheet needs at least a Title column and a Date column.')
  }

  const sessions: Session[] = []
  let lastDateISO: string | null = null
  let lastDay = ''
  for (let r = headerIndex + 1; r < table.rows.length; r++) {
    const cells = table.rows[r].c
    const get = (f: Field) => (colMap[f] !== undefined ? cellText(cells[colMap[f]!] ?? null) : '')

    const title = get('title')
    let dateISO = parseDateCell(cells[colMap.date] ?? null)
    let day = get('day')
    // Forward-fill date/day across merged/blank cells
    if (dateISO) {
      lastDateISO = dateISO
      lastDay = day
    } else {
      dateISO = lastDateISO
      if (!day) day = lastDay
    }
    if (!title || !dateISO) continue

    const linkText = get('link')
    const specialismMatch = title.match(SPECIALISM_RE)
    sessions.push({
      id: `${dateISO}-${r}`,
      title,
      day,
      dateISO,
      start: parseTimeCell(colMap.start !== undefined ? cells[colMap.start] ?? null : null),
      end: parseTimeCell(colMap.end !== undefined ? cells[colMap.end] ?? null : null),
      room: get('room'),
      groups: get('groups'),
      tutor: get('tutor'),
      subject: get('subject'),
      link: /^https?:\/\//i.test(linkText) ? linkText : undefined,
      isSpecialism: !!specialismMatch,
      specialismName: specialismMatch ? specialismMatch[1].trim() : undefined,
      isSelfStudy: /^self[- ]?study$/i.test(title),
      isOptional: /\(optional\)/i.test(title),
    })
  }

  if (sessions.length === 0) {
    warnings.push('No sessions were found below the header row.')
  }
  sessions.sort((a, b) => (a.dateISO + (a.start || '99')).localeCompare(b.dateISO + (b.start || '99')))
  return { sessions, warnings }
}

/**
 * Placement date ranges written in sheet titles, e.g.
 *   "SE1a begins (28th Sept - 2nd Oct 2026)"
 *   "SE2 begins (8th-12th March 2027)"
 *   "SE3 continues (Mon 12th April - Friday 2nd July 2027)"
 *   "… (Tuesday 15th Dec 2026 - Friday 1st Jan 2027, inclusive; …)"
 * Weekday names before either date are ignored, the first date may carry its
 * own year, a range without one that runs backwards (Dec → Jan) starts the
 * year before, and text after the second year is ignored. Shared by the app
 * and both workers so the three expansions can never disagree.
 */

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }
const WEEKDAY = '(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\\.?,?\\s+'
const DAY = '(\\d{1,2})(?:st|nd|rd|th)?'
const RANGE = new RegExp(
  `\\(\\s*(?:${WEEKDAY})?${DAY}(?:\\s+([a-z]+)\\.?)?(?:\\s+(\\d{4}))?\\s*[-–—]\\s*(?:${WEEKDAY})?${DAY}\\s+([a-z]+)\\.?\\s+(\\d{4})`,
  'i'
)

const pad = (n) => String(n).padStart(2, '0')
/** Longest believable block: a full term of placement is ~13 weeks; allow half a year. */
const MAX_SPAN_DAYS = 184
const monthOf = (name) => (name ? MONTHS[name.slice(0, 3).toLowerCase()] : undefined)
const validDay = (y, m, d) => {
  const dt = new Date(Date.UTC(y, m, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m && dt.getUTCDate() === d
}

/** "(Mon 12th April - Friday 2nd July 2027)" → { from: '2027-04-12', to: '2027-07-02' }, else null. */
export function parsePlacementRange(title) {
  const m = String(title || '').match(RANGE)
  if (!m) return null
  const [, d1, m1name, y1, d2, m2name, y2] = m
  const mo2 = monthOf(m2name)
  if (mo2 === undefined) return null
  const mo1 = m1name !== undefined ? monthOf(m1name) : mo2
  if (mo1 === undefined) return null
  const yearTo = Number(y2)
  // Without its own year, only a winter crossing (Oct–Dec into Jan–Mar) starts
  // the year before; anything else running backwards is a typo, not a range.
  const crossesYear = mo1 > mo2 && mo1 >= 9 && mo2 <= 2
  const yearFrom = y1 !== undefined ? Number(y1) : crossesYear ? yearTo - 1 : yearTo
  if (!validDay(yearFrom, mo1, Number(d1)) || !validDay(yearTo, mo2, Number(d2))) return null
  const from = `${yearFrom}-${pad(mo1 + 1)}-${pad(Number(d1))}`
  const to = `${yearTo}-${pad(mo2 + 1)}-${pad(Number(d2))}`
  if (from > to) return null
  // A mistyped year must never mint hundreds of placement days.
  if (Date.parse(to) - Date.parse(from) > MAX_SPAN_DAYS * 86400000) return null
  return { from, to }
}

/**
 * Declared spans per placement tag, from every row whose title carries a range
 * (e.g. "SE3 continues (Mon 12th April - Friday 2nd July 2027)"). Callers pass
 * their own title predicates so this module stays dependency-free.
 */
export function placementWindows(sessions, isPlacement, tagOf) {
  const windows = new Map()
  for (const s of sessions ?? []) {
    if (s.isKeyDate || !isPlacement(s.title)) continue
    const range = parsePlacementRange(s.title)
    if (!range) continue
    const tag = s.placementTag ?? tagOf(s.title)
    const list = windows.get(tag) ?? []
    if (!list.some((w) => w.from === range.from && w.to === range.to)) list.push(range)
    windows.set(tag, list)
  }
  return windows
}

/**
 * Whether a placement row's date counts as a placement DAY: when the sheet
 * declares the block's dates, only days inside them do (a briefing, a
 * tutorial or an upload deadline outside the block stays a normal event);
 * a block with no declared dates counts every row, as before.
 */
export function insideDeclaredSpan(windows, tag, dateISO) {
  const list = windows.get(tag)
  return !list || list.some((w) => dateISO >= w.from && dateISO <= w.to)
}

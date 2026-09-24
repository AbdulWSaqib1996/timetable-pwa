/**
 * Bank holidays in England and Wales, computed offline (no network, works in
 * the app and both workers). Rules: New Year's Day, Good Friday, Easter
 * Monday, early May (first Monday), spring (last Monday of May), summer (last
 * Monday of August), Christmas Day and Boxing Day, with substitute weekdays
 * when a fixed date falls at a weekend; plus the one-off moves and extra days
 * announced by royal proclamation. Names follow GOV.UK.
 */

const pad = (n) => String(n).padStart(2, '0')
const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`
const dow = (y, m, d) => new Date(Date.UTC(y, m, d)).getUTCDay()

/** Anonymous Gregorian algorithm (Meeus/Jones/Butcher). */
function easterSunday(y) {
  const a = y % 19
  const b = Math.floor(y / 100)
  const c = y % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return Date.UTC(y, month, day)
}
const shift = (utc, days) => {
  const dt = new Date(utc + days * 86400000)
  return iso(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate())
}
const firstMonday = (y, m) => 1 + ((8 - dow(y, m, 1)) % 7)
const lastMonday = (y, m) => {
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  return last - ((dow(y, m, last) + 6) % 7)
}

/** Proclaimed moves (date replaced) and extra days, England and Wales. */
const MOVED = {
  '1995-05-01': ['1995-05-08', 'Early May bank holiday (VE day)'],
  '2002-05-27': ['2002-06-04', 'Spring bank holiday'],
  '2012-05-28': ['2012-06-04', 'Spring bank holiday'],
  '2020-05-04': ['2020-05-08', 'Early May bank holiday (VE day)'],
  '2022-05-30': ['2022-06-02', 'Spring bank holiday'],
}
const EXTRA = {
  1999: [['1999-12-31', 'Millennium celebrations']],
  2002: [['2002-06-03', 'Golden Jubilee bank holiday']],
  2011: [['2011-04-29', 'Royal wedding']],
  2012: [['2012-06-05', 'Queen’s Diamond Jubilee']],
  2022: [['2022-06-03', 'Platinum Jubilee bank holiday'], ['2022-09-19', 'Bank Holiday for the State Funeral of Queen Elizabeth II']],
  2023: [['2023-05-08', 'Bank holiday for the coronation of King Charles III']],
}

const cache = new Map()

/** Sorted bank holidays for one calendar year: [{ dateISO, name }]. */
export function bankHolidaysForYear(y) {
  if (cache.has(y)) return cache.get(y)
  const list = []
  const add = (dateISO, name) => {
    const moved = MOVED[dateISO]
    list.push(moved ? { dateISO: moved[0], name: moved[1] } : { dateISO, name })
  }
  // New Year's Day, moved to Monday when it falls at a weekend.
  const ny = dow(y, 0, 1)
  add(iso(y, 0, ny === 6 ? 3 : ny === 0 ? 2 : 1), 'New Year’s Day')
  const easter = easterSunday(y)
  add(shift(easter, -2), 'Good Friday')
  add(shift(easter, 1), 'Easter Monday')
  add(iso(y, 4, firstMonday(y, 4)), 'Early May bank holiday')
  add(iso(y, 4, lastMonday(y, 4)), 'Spring bank holiday')
  add(iso(y, 7, lastMonday(y, 7)), 'Summer bank holiday')
  // Christmas and Boxing Day with weekend substitutes.
  const xmas = dow(y, 11, 25)
  if (xmas === 5) {
    add(iso(y, 11, 25), 'Christmas Day')
    add(iso(y, 11, 28), 'Boxing Day')
  } else if (xmas === 6) {
    add(iso(y, 11, 27), 'Christmas Day')
    add(iso(y, 11, 28), 'Boxing Day')
  } else if (xmas === 0) {
    add(iso(y, 11, 26), 'Boxing Day')
    add(iso(y, 11, 27), 'Christmas Day')
  } else {
    add(iso(y, 11, 25), 'Christmas Day')
    add(iso(y, 11, 26), 'Boxing Day')
  }
  for (const [dateISO, name] of EXTRA[y] ?? []) list.push({ dateISO, name })
  list.sort((a, b) => a.dateISO.localeCompare(b.dateISO))
  cache.set(y, list)
  return list
}

/** The bank holiday's name on that date, or null. */
export function bankHolidayOn(dateISO) {
  const y = Number(String(dateISO).slice(0, 4))
  if (!Number.isInteger(y)) return null
  return bankHolidaysForYear(y).find((h) => h.dateISO === dateISO)?.name ?? null
}

/** Bank holidays with from <= dateISO <= to (inclusive ISO dates). */
export function bankHolidaysBetween(from, to) {
  const out = []
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
    for (const h of bankHolidaysForYear(y)) if (h.dateISO >= from && h.dateISO <= to) out.push(h)
  }
  return out
}

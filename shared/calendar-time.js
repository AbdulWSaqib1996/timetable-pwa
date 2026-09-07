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

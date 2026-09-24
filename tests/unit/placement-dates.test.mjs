import test from 'node:test'
import assert from 'node:assert/strict'
import { parsePlacementRange, placementWindows, insideDeclaredSpan } from '../../shared/placementRange.js'
import { bankHolidaysForYear, bankHolidayOn, bankHolidaysBetween } from '../../shared/bankHolidays.js'
import { computePlacementBlocks } from '../../shared/placement.js'
import { placementDaySummary, isPlacementTitle, placementTagOf } from '../../shared/eligibility.js'

/**
 * Pass 93: placement ranges written with weekday names (the Group 2 sheet's
 * "SE3 continues (Mon 12th April - Friday 2nd July 2027)") and England and
 * Wales bank holidays. Titles below are copied from the live sheet.
 */

test('ranges: every title format on the Group 2 sheet parses, including weekday names and a year crossing', () => {
  const cases = {
    'SE1a begins (28th Sept - 2nd Oct 2026)': ['2026-09-28', '2026-10-02'],
    'SE1b begins (19th Oct - 3rd Dec 2026)': ['2026-10-19', '2026-12-03'],
    'SE1c Begins (6th Jan - 12th Feb 2027)': ['2027-01-06', '2027-02-12'],
    'SE2 begins (8th-12th March 2027)': ['2027-03-08', '2027-03-12'],
    'SE3 continues (Mon 12th April - Friday 2nd July 2027)': ['2027-04-12', '2027-07-02'],
    'SE3 ends (Mon 12th April - Friday 2nd July 2027)': ['2027-04-12', '2027-07-02'],
    'Winter break begins (Tuesday 15th Dec 2026 - Friday 1st Jan 2027, inclusive; Monday 14th Dec Online only)': ['2026-12-15', '2027-01-01'],
    'X (28th Dec - 3rd Jan 2027)': ['2026-12-28', '2027-01-03'],
    'X (Wed. 1st Sept – Fri. 3rd Sept 2027)': ['2027-09-01', '2027-09-03'],
  }
  for (const [title, [from, to]] of Object.entries(cases)) assert.deepEqual(parsePlacementRange(title), { from, to }, title)
  for (const bad of ['SE3 visit day', 'Half-term: Monday 31 May - Friday 4 June 2027', 'X (31st Feb - 2nd Mar 2027)', 'X (2nd Oct - 28th Sept 2026)', 'X (1st Foo - 2nd Bar 2026)', 'X (1st Jan 2026 - 2nd Jan 2027)']) {
    assert.equal(parsePlacementRange(bad), null, bad)
  }
})

test('bank holidays: England and Wales dates match GOV.UK, including substitutes and one-offs', () => {
  const dates = (y) => bankHolidaysForYear(y).map((h) => h.dateISO)
  assert.deepEqual(dates(2026), ['2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04', '2026-05-25', '2026-08-31', '2026-12-25', '2026-12-28'])
  // Christmas on a Saturday: Mon 27 and Tue 28 are the substitutes.
  assert.deepEqual(dates(2027), ['2027-01-01', '2027-03-26', '2027-03-29', '2027-05-03', '2027-05-31', '2027-08-30', '2027-12-27', '2027-12-28'])
  // Spring moved to Thu 2 Jun, extra jubilee and funeral days; Christmas on a Sunday.
  assert.deepEqual(dates(2022), ['2022-01-03', '2022-04-15', '2022-04-18', '2022-05-02', '2022-06-02', '2022-06-03', '2022-08-29', '2022-09-19', '2022-12-26', '2022-12-27'])
  assert.equal(bankHolidayOn('2027-05-03'), 'Early May bank holiday')
  assert.equal(bankHolidayOn('2027-05-04'), null)
  assert.deepEqual(bankHolidaysBetween('2027-04-12', '2027-07-02').map((h) => h.dateISO), ['2027-05-03', '2027-05-31'])
})

test('SE3 on the Group 2 sheet: days outside the declared 12 Apr – 2 Jul span are not placement days', () => {
  // The SE3-tagged rows on the sheet, plus the synthesized weekday rows the app adds for the span.
  const sheet = [
    ['SE3 Briefing and Q&A - students with EYFS placements', '2027-03-16'],
    ['SE3 visit day', '2027-03-23'],
    ['SE3 continues (Mon 12th April - Friday 2nd July 2027)', '2027-04-12'],
    ['SE3: In placement school as usual', '2027-05-05'],
    ['Mid-SE3 documentation uploads', '2027-05-25'],
    ['SE3 ends (Mon 12th April - Friday 2nd July 2027)', '2027-07-02'],
    ['SE3 1-to-1 tutorials', '2027-07-05'],
    ['SE3 - final, signed PRF upload', '2027-07-06'],
  ].map(([title, dateISO], i) => ({ id: `r${i}`, title, dateISO, start: '09:00', end: '15:00' }))
  const marked = new Set(sheet.map((s) => s.dateISO))
  const synthesized = []
  for (let t = Date.UTC(2027, 3, 12); t <= Date.UTC(2027, 6, 2); t += 86400000) {
    const d = new Date(t)
    const dateISO = d.toISOString().slice(0, 10)
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6 || marked.has(dateISO) || bankHolidayOn(dateISO)) continue
    synthesized.push({ id: `plc-SE3-${dateISO}`, title: 'SE3 placement day', dateISO, start: '08:30', end: '15:45' })
  }
  const sessions = [...sheet, ...synthesized]
  const windows = placementWindows(sessions, isPlacementTitle, placementTagOf)
  assert.deepEqual(windows.get('SE3'), [{ from: '2027-04-12', to: '2027-07-02' }])
  assert.equal(insideDeclaredSpan(windows, 'SE3', '2027-03-23'), false)
  assert.equal(insideDeclaredSpan(windows, 'SE9', '2027-03-23'), true, 'a block without declared dates keeps every row')
  // 60 weekdays from Mon 12 Apr to Fri 2 Jul 2027, minus two bank holidays (3 and 31 May).
  const [block] = computePlacementBlocks(sessions, [], {}, () => undefined)
  assert.equal(block.tag, 'SE3')
  assert.equal(block.plannedDays, 58)
  assert.equal(block.days[0].dateISO, '2027-04-12')
  assert.equal(block.days.at(-1).dateISO, '2027-07-02')
  assert.equal(block.days.some((d) => d.dateISO === '2027-05-03' || d.dateISO === '2027-05-31'), false)
  const summary = placementDaySummary(sessions, () => undefined)
  assert.equal(summary.blocks.find((b) => b.tag === 'SE3').total, 58)
})

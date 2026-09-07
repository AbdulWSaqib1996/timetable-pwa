import test from 'node:test'
import assert from 'node:assert/strict'
import { addDaysISO, mondayOfISO, shiftMonthISO, zonedTodayISO } from '../../shared/calendar-time.js'

test('course "today" follows Europe/London, not the device zone', () => {
  // 23:30 UTC on 7 Sep is 00:30 London on 8 Sep during BST.
  assert.equal(zonedTodayISO('Europe/London', new Date('2026-09-07T23:30:00Z')), '2026-09-08')
  // In winter (GMT) the same wall instant stays on the earlier date.
  assert.equal(zonedTodayISO('Europe/London', new Date('2026-12-07T23:30:00Z')), '2026-12-07')
  // A device in Tokyo would say 8 Sep already at 15:30 UTC — course today must not.
  assert.equal(zonedTodayISO('Europe/London', new Date('2026-09-07T15:30:00Z')), '2026-09-07')
})

test('day arithmetic crosses months, leap days and year boundaries', () => {
  assert.equal(addDaysISO('2026-12-31', 1), '2027-01-01')
  assert.equal(addDaysISO('2028-02-28', 1), '2028-02-29') // leap year
  assert.equal(addDaysISO('2027-02-28', 1), '2027-03-01') // non-leap
  assert.equal(addDaysISO('2026-09-01', -1), '2026-08-31')
  assert.equal(mondayOfISO('2026-09-06'), '2026-08-31') // Sunday → previous Monday
  assert.equal(mondayOfISO('2026-08-31'), '2026-08-31') // Monday → itself
})

test('month navigation preserves the day number where valid and clamps otherwise', () => {
  assert.equal(shiftMonthISO('2026-09-15', 1), '2026-10-15')
  assert.equal(shiftMonthISO('2026-01-31', 1), '2026-02-28') // clamp, non-leap
  assert.equal(shiftMonthISO('2028-01-31', 1), '2028-02-29') // clamp, leap day
  assert.equal(shiftMonthISO('2026-12-15', 1), '2027-01-15') // year boundary
  assert.equal(shiftMonthISO('2026-01-15', -1), '2025-12-15')
  assert.equal(shiftMonthISO('2026-03-31', -1), '2026-02-28')
})

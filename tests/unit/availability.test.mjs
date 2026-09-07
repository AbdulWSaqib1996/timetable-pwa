import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AVAILABILITY_FRESH_MS,
  availabilityPayload,
  computeFreeIntervals,
  intersectAvailability,
  lastUpdatedLabel,
  memberFreshness,
  proposalEvent,
  slotsToZone,
} from '../../shared/availability.js'
import { buildICSCalendar } from '../../shared/calendar-time.js'

const NOW = Date.parse('2026-09-07T12:00:00Z')
const MON = '2026-09-07'
const free = (d, from, to) => ({ d, from, to })

test('freshness policy: fresh within the window, stale after it, missing without data', () => {
  assert.equal(memberFreshness({ at: NOW - 3_600_000, slots: [] }, NOW), 'fresh')
  assert.equal(memberFreshness({ at: NOW - AVAILABILITY_FRESH_MS - 1, slots: [] }, NOW), 'stale')
  assert.equal(memberFreshness({ at: 0, slots: [] }, NOW), 'missing')
  assert.equal(memberFreshness({ at: NOW }, NOW), 'missing')
  assert.equal(lastUpdatedLabel(NOW - 23 * 60_000, NOW), '23 min ago')
  assert.equal(lastUpdatedLabel(NOW - 5 * 3_600_000, NOW), '5 h ago')
})

test('personal busy blocks remove free time exactly like course sessions', () => {
  const noBusy = computeFreeIntervals([], { todayISO: MON, days: 1 })
  assert.deepEqual(noBusy, [free(MON, 540, 1020)])
  // A 12:00–14:00 personal commitment (busy: true) splits the day.
  const withBusy = computeFreeIntervals([free(MON, 720, 840)], { todayISO: MON, days: 1 })
  assert.deepEqual(withBusy, [free(MON, 540, 720), free(MON, 840, 1020)])
})

test('working hours and minimum meeting length are honoured, weekends skipped', () => {
  const slots = computeFreeIntervals([free(MON, 600, 630)], {
    todayISO: MON,
    days: 7,
    workStart: 600,
    workEnd: 660,
    minMinutes: 30,
  })
  // 10:00–10:30 busy leaves only 10:30–11:00 each weekday; Sat/Sun produce nothing.
  assert.equal(slots.length, 5)
  assert.deepEqual(slots[0], free(MON, 630, 660))
  assert.ok(slots.every((s) => !['2026-09-12', '2026-09-13'].includes(s.d)))
})

test('timezone difference: Paris wall slots land on London wall time, cross-day splits are honest', () => {
  // 13:00–15:00 in Paris is 12:00–14:00 in London.
  assert.deepEqual(slotsToZone([free(MON, 780, 900)], 'Europe/Paris', 'Europe/London'), [free(MON, 720, 840)])
  // 00:00–01:00 in Paris crosses midnight backwards into the previous London day.
  assert.deepEqual(slotsToZone([free('2026-09-08', 0, 60)], 'Europe/Paris', 'Europe/London'), [
    free(MON, 1380, 1440),
  ])
  // Same zone: untouched.
  const same = [free(MON, 540, 600)]
  assert.equal(slotsToZone(same, 'Europe/London', 'Europe/London'), same)
})

test('intersection counts only fresh members; stale and missing are excluded with reasons', () => {
  const fresh = { memberId: 'a', name: 'Alex', at: NOW - 1000, slots: [free(MON, 540, 720)] }
  const fresh2 = { memberId: 'b', name: 'Sam', at: NOW - 1000, slots: [free(MON, 600, 780)] }
  const stale = { memberId: 'c', name: 'Jo', at: NOW - AVAILABILITY_FRESH_MS - 1, slots: [free(MON, 540, 720)] }
  const missing = { memberId: 'd', name: 'Kit', at: 0, slots: [] }
  const out = intersectAvailability([fresh, fresh2, stale, missing], { now: NOW, minMinutes: 30 })
  assert.deepEqual(out.slots, [free(MON, 600, 720)])
  assert.equal(out.counted, 2)
  assert.deepEqual(
    out.excluded.map((e) => `${e.name}:${e.reason}`).sort(),
    ['Jo:stale', 'Kit:missing']
  )
})

test('same-name members intersect as distinct people', () => {
  const a = { memberId: 'a', name: 'Alex', at: NOW, slots: [free(MON, 540, 660)] }
  const b = { memberId: 'b', name: 'Alex', at: NOW, slots: [free(MON, 600, 720)] }
  const out = intersectAvailability([a, b], { now: NOW, minMinutes: 30 })
  assert.equal(out.counted, 2)
  assert.deepEqual(out.slots, [free(MON, 600, 660)])
})

test('a member in another timezone intersects on converted wall time', () => {
  const london = { memberId: 'a', name: 'Alex', at: NOW, slots: [free(MON, 720, 840)] }
  const paris = { memberId: 'b', name: 'Camille', at: NOW, slots: [free(MON, 780, 900)], tz: 'Europe/Paris' }
  const out = intersectAvailability([london, paris], { now: NOW, minMinutes: 30, tz: 'Europe/London' })
  // Camille 13:00–15:00 Paris = 12:00–14:00 London; Alex 12:00–14:00 London.
  assert.deepEqual(out.slots, [free(MON, 720, 840)])
})

test('privacy: the published payload carries intervals and identity only — never titles', () => {
  const payload = availabilityPayload({
    code: 'K7M2PQ',
    name: 'Alex',
    slots: [{ d: MON, from: 540, to: 600, title: 'Physics seminar', room: 'B12' }],
    creds: { memberId: 'mabc', token: 'tok' },
  })
  const allowed = ['code', 'name', 'slots', 'tz', 'horizonDays', 'wantCredentials', 'memberId', 'token']
  assert.deepEqual(Object.keys(payload).sort(), allowed.sort())
  assert.deepEqual(payload.slots, [{ d: MON, from: 540, to: 600 }])
  assert.ok(!JSON.stringify(payload).includes('Physics'))
  assert.ok(!JSON.stringify(payload).includes('B12'))
})

test('export identity: the same proposal always yields the same calendar UID', () => {
  const proposal = { id: 'p1a2b3c4', slot: free('2026-09-09', 600, 660) }
  const a = proposalEvent('K7M2PQ', proposal)
  const b = proposalEvent('K7M2PQ', proposal)
  assert.equal(a.calendarUid, b.calendarUid)
  assert.equal(a.calendarUid, 'group-K7M2PQ-p1a2b3c4')
  const ics1 = buildICSCalendar([a], 'Study group')
  const ics2 = buildICSCalendar([b], 'Study group')
  const uid = (ics) => ics.match(/UID:[^\r\n]+/)[0]
  assert.equal(uid(ics1), uid(ics2))
  assert.ok(ics1.includes('DTSTART:20260909T090000Z')) // 10:00 BST = 09:00 UTC
  assert.ok(ics1.includes('SUMMARY:Study group meet-up'))
})

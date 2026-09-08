import test from 'node:test'
import assert from 'node:assert/strict'
import {
  departureState,
  journeyRequestKey,
  pickFeasibleItinerary,
  requiredArrivalMs,
  validateItinerary,
} from '../../shared/journey.js'
import { wallToUTC } from '../../shared/calendar-time.js'

const req = (patch = {}) => ({
  origin: { lat: 51.5465, lng: -0.1058, basis: 'device' },
  destination: { lat: 51.5227, lng: -0.1276 },
  mode: 'transit',
  intent: { kind: 'arrive-by', arriveByMs: Date.UTC(2026, 8, 8, 7, 50), eventKey: 'k1' },
  arrivalBufferMinutes: 10,
  ...patch,
})

test('request identity covers origin+basis, destination, mode, intent time and buffer', () => {
  const base = journeyRequestKey(req())
  assert.notEqual(base, journeyRequestKey(req({ mode: 'walking' })))
  assert.notEqual(base, journeyRequestKey(req({ arrivalBufferMinutes: 20 })))
  assert.notEqual(base, journeyRequestKey(req({ intent: { kind: 'leave-now' } })))
  assert.notEqual(base, journeyRequestKey(req({ origin: { lat: 51.7, lng: -0.1058, basis: 'device' } })))
  assert.notEqual(
    base,
    journeyRequestKey(req({ origin: { lat: 51.5465, lng: -0.1058, basis: 'home' } }))
  ) // same point, different basis — a stale device fix must not impersonate a saved origin
  assert.notEqual(
    base,
    journeyRequestKey(req({ intent: { kind: 'arrive-by', arriveByMs: Date.UTC(2026, 8, 9, 7, 50), eventKey: 'k1' } }))
  ) // tomorrow vs today
  // Tiny origin jitter shares the cache; destination rounding stays finer.
  const jittered = journeyRequestKey(
    req({ origin: { lat: 51.54651, lng: -0.10579, basis: 'device' } })
  )
  assert.equal(jittered, journeyRequestKey(req({ origin: { lat: 51.54652, lng: -0.10581, basis: 'device' } })))
})

test('required arrival subtracts the buffer; zero and large buffers behave', () => {
  const start = Date.UTC(2026, 8, 8, 8, 0)
  assert.equal(requiredArrivalMs(start, 10), start - 600_000)
  assert.equal(requiredArrivalMs(start, 0), start)
  assert.equal(requiredArrivalMs(start, 120), start - 7_200_000)
})

test('validateItinerary parses London wall times (BST) and rejects invalid responses', () => {
  const ok = validateItinerary({
    startDateTime: '2026-09-08T08:13:00',
    arrivalDateTime: '2026-09-08T08:46:00',
    duration: 33,
    legs: [
      {
        mode: { name: 'walking' },
        duration: 10,
        departureTime: '2026-09-08T08:13:00',
        arrivalTime: '2026-09-08T08:23:00',
        departurePoint: { commonName: 'A' },
        arrivalPoint: { commonName: 'B' },
        instruction: { summary: 'Walk to B' },
        disruptions: [],
      },
    ],
  })
  assert.ok(ok)
  assert.equal(ok.departureMs, wallToUTC('2026-09-08', '08:13').utcMs) // BST-aware
  assert.equal(ok.durationMins, 33)
  assert.equal(ok.legs[0].summary, 'Walk to B')
  // Rejections: missing times, non-positive duration, arrival before departure, missing leg mode.
  assert.equal(validateItinerary({ duration: 30 }), null)
  assert.equal(
    validateItinerary({ startDateTime: '2026-09-08T08:13:00', arrivalDateTime: '2026-09-08T08:46:00', duration: 0 }),
    null
  )
  assert.equal(
    validateItinerary({ startDateTime: '2026-09-08T09:00:00', arrivalDateTime: '2026-09-08T08:00:00', duration: 30 }),
    null
  )
  assert.equal(
    validateItinerary({
      startDateTime: '2026-09-08T08:13:00',
      arrivalDateTime: '2026-09-08T08:46:00',
      duration: 33,
      legs: [{ duration: 5 }],
    }),
    null
  )
})

test('feasible pick: latest departure that still arrives by the required instant; none → null', () => {
  const mk = (dep, arr) => ({ departureMs: dep, arrivalMs: arr, durationMins: (arr - dep) / 60000, legs: [], lines: [] })
  const required = 1_000_000_000
  const a = mk(required - 3_600_000, required - 600_000)
  const b = mk(required - 1_800_000, required - 60_000) // later departure, still on time
  const late = mk(required - 900_000, required + 600_000)
  assert.equal(pickFeasibleItinerary([a, b, late, null], required), b)
  assert.equal(pickFeasibleItinerary([late], required), null)
  assert.equal(pickFeasibleItinerary([], required), null)
})

test('departure state is timestamp-derived: future → imminent → passed, never negative', () => {
  const leave = 10_000_000
  assert.equal(departureState(leave, leave - 3_600_000), 'future')
  assert.equal(departureState(leave, leave - 120_000), 'imminent')
  assert.equal(departureState(leave, leave), 'passed')
  assert.equal(departureState(leave, leave + 3_600_000), 'passed')
})

test('DST boundary: an arrive-by on the clock-change morning still parses to real instants', () => {
  // UK clocks go back 25 Oct 2026: 08:30 wall is unambiguous GMT.
  const it = validateItinerary({
    startDateTime: '2026-10-25T08:00:00',
    arrivalDateTime: '2026-10-25T08:30:00',
    duration: 30,
    legs: [],
  })
  assert.ok(it)
  assert.equal(it.arrivalMs - it.departureMs, 30 * 60_000)
  assert.equal(it.departureMs, wallToUTC('2026-10-25', '08:00').utcMs)
})


test('duplicate disruption entries on a leg collapse to one warning (TfL repeats them per stop)', () => {
  const it = validateItinerary({
    startDateTime: '2026-09-08T08:13:00',
    arrivalDateTime: '2026-09-08T08:46:00',
    duration: 33,
    legs: [
      {
        mode: { name: 'tube' },
        duration: 20,
        departureTime: '2026-09-08T08:13:00',
        arrivalTime: '2026-09-08T08:33:00',
        routeOptions: [{ name: 'Metropolitan' }],
        departurePoint: { commonName: 'Wembley Park' },
        arrivalPoint: { commonName: 'Euston Square' },
        disruptions: [
          { description: 'Wembley Park: No Step Free Access - faulty lift' },
          { description: 'Wembley Park: No Step Free Access - faulty lift' },
          { description: ' Wembley Park: No Step Free Access - faulty lift ' },
        ],
      },
    ],
  })
  assert.deepEqual(it.legs[0].disruptions, ['Wembley Park: No Step Free Access - faulty lift'])
})

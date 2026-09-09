import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CACHED_TTL_MS,
  DEPARTURES_TTL_MS,
  LIVE_TTL_MS,
  freshnessLabel,
  travelStatus,
} from '../../shared/travel-state.js'

test('status derives from timestamps: live → cached → expired, never backwards', () => {
  const now = 1_000_000_000
  assert.equal(travelStatus(now - 1_000, now), 'live')
  assert.equal(travelStatus(now - LIVE_TTL_MS + 1, now), 'live')
  assert.equal(travelStatus(now - LIVE_TTL_MS, now), 'cached')
  assert.equal(travelStatus(now - CACHED_TTL_MS + 1, now), 'cached')
  assert.equal(travelStatus(now - CACHED_TTL_MS, now), 'expired')
  assert.equal(travelStatus(null, now), 'unavailable')
  assert.equal(travelStatus(undefined, now), 'unavailable')
  assert.equal(travelStatus(now + 60_000, now), 'unavailable') // clock skew: never claim live
})

test('provider data and old cached durations never share a live label; estimates say so', () => {
  const now = 1_000_000_000
  assert.equal(freshnessLabel({ basis: 'provider', fetchedAt: now - 1_000 }, now), 'live TfL')
  assert.match(freshnessLabel({ basis: 'provider', fetchedAt: now - 10 * 60_000 }, now), /TfL route from 10m ago/)
  assert.equal(freshnessLabel({ basis: 'provider', fetchedAt: now - CACHED_TTL_MS - 1 }, now), 'route unavailable')
  assert.equal(freshnessLabel({ basis: 'estimate' }, now), 'estimate from distance')
  // An estimate never upgrades itself just because a timestamp exists.
  assert.equal(freshnessLabel({ basis: 'estimate', fetchedAt: now }, now), 'estimate from distance')
})

test('departure boards expire on their own short TTL', () => {
  assert.ok(DEPARTURES_TTL_MS < LIVE_TTL_MS)
})

test('alreadyAtDestination: recent fix within 150 m suppresses; far, stale or missing fixes never do', async () => {
  const { alreadyAtDestination } = await import('../../shared/travel-state.js')
  const dest = { lat: 51.5236, lng: -0.1282 }
  const now = 1_800_000_000_000
  assert.equal(alreadyAtDestination({ lat: 51.5237, lng: -0.1281, at: now - 60_000 }, dest, { now }), true)
  assert.equal(alreadyAtDestination({ lat: 51.5237, lng: -0.1281 }, dest, { now }), true) // live watcher, no stamp
  assert.equal(alreadyAtDestination({ lat: 51.53, lng: -0.1282, at: now - 60_000 }, dest, { now }), false) // ~700 m
  assert.equal(alreadyAtDestination({ lat: 51.5237, lng: -0.1281, at: now - 4 * 3_600_000 }, dest, { now }), false) // stale
  assert.equal(alreadyAtDestination(null, dest, { now }), false)
  assert.equal(alreadyAtDestination({ lat: 51.5237, lng: -0.1281 }, null, { now }), false)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ACTION_CATALOGUE,
  CAPABILITY_VERSION,
  MAX_EVENTS_PER_VERSION,
  allowedEvents,
  validateBatch,
  validateStatsV2,
} from '../../shared/analytics-contracts.js'

const TODAY = '2026-09-07'
const base = () => ({
  schemaVersion: 2,
  token: 'abcd1234abcd1234',
  batchId: 'f00df00df00df00d',
  buildId: '9f9a654',
  capabilityVersion: 1,
  platform: 'ios',
  standalone: true,
  days: [{ date: TODAY, opens: 3, counts: { detail: 2 }, setup: { push: true } }],
})

test('a valid batch rebuilds cleanly; unknown fields cannot pass through', () => {
  const { ok, batch } = validateBatch({ ...base(), sneaky: 'x', days: [{ ...base().days[0], extra: 1 }] }, { todayISO: TODAY })
  assert.ok(ok)
  assert.deepEqual(Object.keys(batch).sort(), ['batchId', 'buildId', 'capabilityVersion', 'days', 'platform', 'schemaVersion', 'standalone', 'token'])
  assert.deepEqual(Object.keys(batch.days[0]).sort(), ['counts', 'date', 'opens', 'setup'])
})

test('invalid envelopes are refused whole: bad ids, versions, dates, counts, unknown events', () => {
  const cases = [
    { ...base(), schemaVersion: 1 },
    { ...base(), token: 'ZZZ' },
    { ...base(), batchId: 'short' },
    { ...base(), buildId: 'bad build!' },
    { ...base(), capabilityVersion: CAPABILITY_VERSION + 1 },
    { ...base(), platform: 'smartfridge' },
    { ...base(), days: [] },
    { ...base(), days: Array.from({ length: 8 }, (_, i) => ({ date: `2026-09-0${i + 1}`, opens: 1, counts: {} })) },
    { ...base(), days: [{ date: '2026-09-09', opens: 1, counts: {} }] }, // future beyond skew
    { ...base(), days: [{ date: '2026-08-01', opens: 1, counts: {} }] }, // beyond retention
    { ...base(), days: [{ date: TODAY, opens: -1, counts: {} }] },
    { ...base(), days: [{ date: TODAY, opens: 1, counts: { detail: 0 } }] },
    { ...base(), days: [{ date: TODAY, opens: 1, counts: { detail: 2.5 } }] },
    { ...base(), days: [{ date: TODAY, opens: 1, counts: { totally_unknown: 1 } }] },
    { ...base(), days: [{ date: TODAY, opens: 1, counts: { view_today: 1 } }] }, // capability 2 event from a v1 client
    { ...base(), days: [{ date: TODAY, opens: 1, counts: {} }, { date: TODAY, opens: 1, counts: {} }] }, // duplicate day
  ]
  for (const c of cases) {
    const { ok, batch } = validateBatch(c, { todayISO: TODAY })
    assert.equal(ok, false, JSON.stringify(c.days ?? c))
    assert.equal(batch, null)
  }
})

test('tomorrow within skew is allowed; setup keeps reported booleans only', () => {
  const { ok, batch } = validateBatch(
    { ...base(), days: [{ date: '2026-09-08', opens: 1, counts: {}, setup: { push: false, location: 'yes', bogus: true } }] },
    { todayISO: TODAY }
  )
  assert.ok(ok)
  assert.deepEqual(batch.days[0].setup, { push: false })
})

test('the catalogue stays within the per-version event cap and v2 names are reserved, not yet allowed', () => {
  for (let v = 1; v <= CAPABILITY_VERSION; v++) {
    assert.ok(allowedEvents(v).length <= MAX_EVENTS_PER_VERSION, `capability ${v} exceeds cap`)
  }
  assert.ok(!allowedEvents(CAPABILITY_VERSION).includes('task_created'))
  assert.equal(ACTION_CATALOGUE.photo.label, 'Photo add attempt')
  assert.equal(ACTION_CATALOGUE.evidence_photo_saved.semantics, 'success')
})

test('stats/v2 envelope validation: numerator>denominator, bad enums and reversed periods are refused', () => {
  const good = {
    schemaVersion: 2,
    snapshotId: 'abc',
    generatedAt: '2026-09-07T12:00:00Z',
    observedThrough: '2026-09-07',
    period: { from: '2026-08-08', to: '2026-09-07', timezone: 'UTC', includesPartialToday: true },
    source: 'event-day-v2',
    completeness: { status: 'complete', missingRows: 0, invalidRows: 0, scanComplete: true, reasons: [] },
    metrics: { activeTokens7: { value: 3, status: 'complete', definition: 'x' } },
    daily: [
      {
        date: '2026-09-07',
        active: { value: 3, status: 'complete', definition: 'x' },
        new: { value: 1, status: 'complete', definition: 'x' },
        returning: { value: 2, status: 'complete', definition: 'x' },
      },
    ],
    features: [
      {
        id: 'detail',
        contractVersion: 1,
        collectionStartedAt: '2026-09-07',
        measurement: 'available',
        adoption: { value: 50, status: 'complete', definition: 'x', numerator: 1, denominator: 2, eligibleCoverage: { eligible: 2, active: 3 } },
        uses: { value: 4, status: 'complete', definition: 'x' },
      },
    ],
  }
  assert.equal(validateStatsV2(good), true)
  assert.equal(validateStatsV2({ ...good, period: { ...good.period, from: '2026-09-08' } }), false)
  assert.equal(validateStatsV2({ ...good, source: 'vibes' }), false)
  const badRatio = structuredClone(good)
  badRatio.features[0].adoption.numerator = 5
  assert.equal(validateStatsV2(badRatio), false)
  const badCount = structuredClone(good)
  badCount.metrics.activeTokens7.value = -1
  assert.equal(validateStatsV2(badCount), false)
})

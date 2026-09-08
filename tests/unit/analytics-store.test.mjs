import test from 'node:test'
import assert from 'node:assert/strict'
import { AnalyticsStore } from '../../workers/push/analytics-store.js'

/** DO harness matching the GroupStore test's shape, plus list(prefix). */
function makeStore(records = new Map()) {
  let chain = Promise.resolve()
  const api = {
    get: async (key) => records.get(key),
    put: async (key, value) => {
      records.set(key, value)
    },
    delete: async (key) => {
      records.delete(key)
    },
    list: async ({ prefix = '' } = {}) =>
      new Map([...records.entries()].filter(([k]) => k.startsWith(prefix)).sort((a, b) => a[0].localeCompare(b[0]))),
  }
  const serial = (work) => {
    const next = chain.then(work)
    chain = next.catch(() => {})
    return next
  }
  const state = { storage: { ...api, transaction: (work) => serial(() => work(api)) } }
  return { store: new AnalyticsStore(state), records }
}

const dayISO = (ago) => new Date(Date.now() - ago * 86400000).toISOString().slice(0, 10)
const post = (store, path, body) =>
  store.fetch(new Request(`https://analytics${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }))

const batch = (over = {}) => ({
  schemaVersion: 2,
  token: 'aaaa1111aaaa1111',
  batchId: 'b111111111111111',
  buildId: '9f9a654',
  capabilityVersion: 1,
  platform: 'ios',
  standalone: true,
  days: [{ date: dayISO(0), opens: 2, counts: { detail: 3 }, setup: { push: true } }],
  ...over,
})

test('a replayed batch returns the same ack and never double counts (crash/restart included)', async () => {
  const { store, records } = makeStore()
  const first = await (await post(store, '/v2/batch', batch())).json()
  assert.equal(first.acked, 'b111111111111111')
  const replay = await (await post(store, '/v2/batch', batch())).json()
  assert.equal(replay.acked, 'b111111111111111')
  assert.equal(replay.duplicate, true)
  // Simulate the DO instance dying and a NEW instance over the same storage:
  // committed dedupe rows keep replays idempotent across restarts.
  const revived = makeStore(records)
  const afterRestart = await (await post(revived.store, '/v2/batch', batch())).json()
  assert.equal(afterRestart.duplicate, true)
  assert.equal(records.get(`day:${dayISO(0)}:aaaa1111aaaa1111`).counts.detail, 3)
})

test('two new batches on the same token/day each add exactly once; context follows, counts never overwritten', async () => {
  const { store, records } = makeStore()
  await post(store, '/v2/batch', batch())
  await post(store, '/v2/batch', batch({ batchId: 'b222222222222222', buildId: 'abc1234', days: [{ date: dayISO(0), opens: 1, counts: { detail: 2, week: 1 } }] }))
  const row = records.get(`day:${dayISO(0)}:aaaa1111aaaa1111`)
  assert.equal(row.counts.detail, 5)
  assert.equal(row.counts.week, 1)
  assert.equal(row.opens, 3)
  assert.equal(row.buildId, 'abc1234')
  assert.deepEqual(row.setup, { push: true })
})

test('aggregate: distinct tokens, v2 first-seen new/returning, watermark, honest feature states', async () => {
  const { store } = makeStore()
  // Token A active yesterday and today (first seen yesterday); token B new today.
  await post(store, '/v2/batch', batch({ days: [{ date: dayISO(1), opens: 1, counts: { detail: 1 } }] }))
  await post(store, '/v2/batch', batch({ batchId: 'b333333333333333', days: [{ date: dayISO(0), opens: 1, counts: { detail: 2 } }] }))
  await post(store, '/v2/batch', batch({ token: 'bbbb2222bbbb2222', batchId: 'b444444444444444', standalone: false, days: [{ date: dayISO(0), opens: 1, counts: {}, standalone: false }] }))
  const snap = await (await post(store, '/v2/aggregate', {})).json()
  assert.equal(snap.schemaVersion, 2)
  assert.equal(snap.observedThrough, dayISO(0))
  assert.equal(snap.metrics.activeTokens7.value, 2)
  assert.equal(snap.metrics.activeToday.value, 2)
  assert.equal(snap.metrics.activeToday.status, 'partial')
  const today = snap.daily[snap.daily.length - 1]
  assert.equal(today.active.value, 2)
  assert.equal(today.new.value, 1) // token B first seen today
  assert.equal(today.returning.value, 1) // token A first seen yesterday
  // standalone: A true, B false → 1/2 known
  assert.equal(snap.metrics.standaloneToday.numerator, 1)
  assert.equal(snap.metrics.standaloneToday.denominator, 2)
  const detail = snap.features.find((f) => f.id === 'detail')
  assert.equal(detail.measurement, 'available')
  assert.equal(detail.adoption.numerator, 1) // only token A used detail
  assert.equal(detail.adoption.denominator, 2)
  assert.equal(detail.uses.value, 3)
  assert.equal(detail.collectionStartedAt, dayISO(1))
  // Capability-2 events are collected now, but these fixture tokens report
  // capability 1 — the eligible denominator is honestly zero, never faked.
  const tasks = snap.features.find((f) => f.id === 'task_created')
  assert.equal(tasks.measurement, 'available')
  assert.equal(tasks.adoption.status, 'unavailable')
  assert.equal(tasks.adoption.denominator, 0)
  assert.equal(tasks.collectionStartedAt, null, 'no capability-2 batch has arrived yet')
})

test('aggregate prunes only expired analytics rows; fresh rows and unexpired dedupe records stay', async () => {
  const { store, records } = makeStore()
  await post(store, '/v2/batch', batch())
  records.set('day:2020-01-01:oldtoken0000old1', { opens: 1, counts: {} })
  records.set('dp:oldtoken0000old1:beefbeefbeefbeef', 5) // long expired
  await post(store, '/v2/aggregate', {})
  assert.equal(records.has('day:2020-01-01:oldtoken0000old1'), false)
  assert.equal(records.has('dp:oldtoken0000old1:beefbeefbeefbeef'), false)
  assert.equal(records.has(`day:${dayISO(0)}:aaaa1111aaaa1111`), true)
  assert.equal(records.has('dp:aaaa1111aaaa1111:b111111111111111'), true)
})

test('reserved ffffffff test tokens are accepted (smoke tests) but never aggregated', async () => {
  const { store } = makeStore()
  const res = await (await post(store, '/v2/batch', batch({ token: 'ffffffffffffffff', batchId: 'b555555555555555' }))).json()
  assert.equal(res.acked, 'b555555555555555')
  const snap = await (await post(store, '/v2/aggregate', {})).json()
  assert.equal(snap.metrics.activeToday.value, 0)
  assert.equal(snap.metrics.activeTokens7.value, 0)
  assert.equal(snap.features.find((f) => f.id === 'detail').uses.value, 0)
})

/* ---- A4: weekly cohorts and capability-2 eligibility ---- */

const mondayOf = (iso) => {
  const d = new Date(iso + 'T00:00:00Z')
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10)
}
const addDaysISO = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10)

test('cohorts: UTC Monday membership, EXACT-week returns, incomplete weeks dashed, no rolling windows', async () => {
  const { store } = makeStore()
  const thisMonday = mondayOf(dayISO(0))
  const cohortMonday = addDaysISO(thisMonday, -28) // four full weeks ago
  const send = (token, batchId, date) =>
    post(store, '/v2/batch', batch({ token, batchId, days: [{ date, opens: 1, counts: {} }] }))
  // Token A: first seen SUNDAY of cohort week (edge of the Monday boundary),
  // returns in week 1 (its Monday) and week 3.
  await send('aaaa000000000001', 'b100000000000001', addDaysISO(cohortMonday, 6))
  await send('aaaa000000000001', 'b100000000000002', addDaysISO(cohortMonday, 7))
  await send('aaaa000000000001', 'b100000000000003', addDaysISO(cohortMonday, 21))
  // Token B: first seen MONDAY of the cohort week, never returns.
  await send('bbbb000000000002', 'b200000000000001', cohortMonday)
  // Token C: first seen THIS week — its cohort is incomplete.
  await send('cccc000000000003', 'b300000000000001', dayISO(0))
  const snap = await (await post(store, '/v2/aggregate', {})).json()
  const cohort = snap.cohorts.find((c) => c.week === cohortMonday)
  assert.ok(cohort, 'cohort week missing')
  assert.equal(cohort.size, 2, 'Sunday first-seen belongs to the SAME Monday-keyed week')
  assert.equal(cohort.complete, true)
  // Week 1: only token A returned, in the exact following calendar week.
  assert.deepEqual(cohort.weeks[0], { n: 1, complete: true, returned: 1 })
  // Week 2: token A was active on day 21 — that is week 3, NOT a rolling
  // 14-day window; week 2 must be zero.
  assert.deepEqual(cohort.weeks[1], { n: 2, complete: true, returned: 0 })
  assert.deepEqual(cohort.weeks[2], { n: 3, complete: true, returned: 1 })
  // Week 4 of this cohort is the CURRENT week — incomplete, value withheld.
  assert.equal(cohort.weeks[3].complete, false)
  assert.equal(cohort.weeks[3].returned, null)
  // Token C's cohort (this week) is itself incomplete.
  const current = snap.cohorts.find((c) => c.week === thisMonday)
  assert.equal(current.complete, false)
})

test('capability-2 tokens make real eligible denominators and per-capability start dates', async () => {
  const { store } = makeStore()
  await post(store, '/v2/batch', batch({ days: [{ date: dayISO(0), opens: 1, counts: { detail: 1 } }] })) // capV 1
  await post(store, '/v2/batch', batch({
    token: 'dddd000000000004',
    batchId: 'b500000000000001',
    capabilityVersion: 2,
    days: [{ date: dayISO(0), opens: 1, counts: { task_created: 2, view_today: 1 } }],
  }))
  const snap = await (await post(store, '/v2/aggregate', {})).json()
  const tasks = snap.features.find((f) => f.id === 'task_created')
  assert.equal(tasks.measurement, 'available')
  // Eligible = tokens that CAN report it (capability >= 2): exactly one.
  assert.deepEqual([tasks.adoption.numerator, tasks.adoption.denominator], [1, 1])
  assert.equal(tasks.adoption.eligibleCoverage.active, 2)
  assert.equal(tasks.uses.value, 2)
  assert.equal(tasks.collectionStartedAt, dayISO(0), 'capability-2 collection starts at its own first batch')
  // The v1 feature keeps its own (older) start-date semantics.
  const detail = snap.features.find((f) => f.id === 'detail')
  assert.deepEqual([detail.adoption.numerator, detail.adoption.denominator], [1, 2])
})

/* ---- A5: reliability counters and build attribution ---- */

test('reliability: outcomes counted transactionally by reason and day; rates suppressed below the minimum', async () => {
  const { store } = makeStore()
  await post(store, '/v2/batch', batch())
  await post(store, '/v2/batch', batch()) // duplicate
  await post(store, '/v2/outcome', { reason: 'rejected' })
  await post(store, '/v2/outcome', { reason: 'oversize' })
  await post(store, '/v2/outcome', { reason: 'rateLimited' })
  assert.equal((await post(store, '/v2/outcome', { reason: 'made-up' })).status, 400)
  const snap = await (await post(store, '/v2/aggregate', {})).json()
  const today = snap.reliability.days[snap.reliability.days.length - 1]
  assert.deepEqual(
    { a: today.accepted, d: today.duplicate, r: today.rejected, o: today.oversize, l: today.rateLimited },
    { a: 1, d: 1, r: 1, o: 1, l: 1 }
  )
  assert.ok(snap.reliability.lastAcceptedAt > 0)
  // Yesterday had no attempts: rate is null and status is 'insufficient', never 0%.
  assert.equal(snap.reliability.lastCompleteDay.ratePct, null)
  assert.equal(snap.reliability.lastCompleteDay.status, 'insufficient')
  assert.deepEqual(snap.reliability.thresholds, { staleAfterMinutes: 30, rejectRatePct: 2, minAttempts: 100 })
})

test('releases: latest observed build per token, Unknown category, comparison only with >= 20 eligible tokens', async () => {
  const { store } = makeStore()
  // Token A: old build yesterday, NEW build today -> attributed to the new build once.
  await post(store, '/v2/batch', batch({ buildId: 'old0001', days: [{ date: dayISO(1), opens: 2, counts: {} }] }))
  await post(store, '/v2/batch', batch({ batchId: 'b777777777777777', buildId: 'new0002', days: [{ date: dayISO(0), opens: 1, counts: {} }] }))
  // 20 tokens on the old build over complete days -> comparison available for it.
  for (let i = 0; i < 20; i++) {
    await post(store, '/v2/batch', batch({ token: `cccc${String(i).padStart(12, '0')}`, batchId: `c${String(i).padStart(15, '0')}`, buildId: 'old0001', days: [{ date: dayISO(2), opens: 3, counts: {} }] }))
  }
  const snap = await (await post(store, '/v2/aggregate', {})).json()
  const list = snap.builds.list
  assert.equal(snap.builds.activeTokens, 21)
  const oldB = list.find((b) => b.buildId === 'old0001')
  const newB = list.find((b) => b.buildId === 'new0002')
  assert.equal(oldB.tokens, 20, 'token A must not ALSO count for its earlier build')
  assert.equal(newB.tokens, 1)
  assert.equal(newB.firstObserved, dayISO(0))
  assert.ok('unavailable' in newB.comparison && newB.comparison.minimum === 20)
  assert.equal(oldB.comparison.eligibleTokens, 21) // A's old-build day is a complete day too
  assert.equal(oldB.comparison.opensPerToken, Math.round(((20 * 3 + 2) / 21) * 10) / 10)
  assert.equal(list.find((b) => b.buildId === 'unknown'), undefined, 'no unknown row without unknown tokens')
})

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
  // A4 events are visibly NOT collected — never zero.
  const tasks = snap.features.find((f) => f.id === 'task_created')
  assert.equal(tasks.measurement, 'not-collected')
  assert.equal(tasks.adoption.value, null)
  assert.equal(tasks.uses.value, null)
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

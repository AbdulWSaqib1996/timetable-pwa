import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ack,
  claim,
  clearAll,
  pendingSummary,
  recordEvent,
  recordOpen,
  release,
  setDayContext,
} from '../../shared/telemetry-queue.js'

/** The memory adapter mirrors the browser IDB adapter: one atomic mutation. */
function makeQueue() {
  const rows = new Map()
  return {
    rows,
    apply(m) {
      for (const [k, v] of m.set ?? []) rows.set(k, v)
      for (const k of m.del ?? []) rows.delete(k)
      return m.result
    },
  }
}

const NOW = Date.parse('2026-09-07T12:00:00Z')
const TODAY = '2026-09-07'
let n = 0
const bid = () => `b${String(++n).padStart(15, '0')}`

test('ADM-05: an event recorded during a send survives the acknowledgement', () => {
  const q = makeQueue()
  q.apply(recordEvent(q.rows, { date: TODAY, event: 'detail' }))
  const batch = q.apply(claim(q.rows, { now: NOW, owner: 'tab1', batchId: bid() }))
  assert.equal(batch.days[0].counts.detail, 1)
  // While the request is in flight, another event lands — in a NEW segment.
  q.apply(recordEvent(q.rows, { date: TODAY, event: 'photo' }))
  q.apply(ack(q.rows, { batchId: batch.batchId, owner: 'tab1' }))
  // The in-flight event is still queued and travels with the next batch.
  const next = q.apply(claim(q.rows, { now: NOW + 1000, owner: 'tab1', batchId: bid() }))
  assert.deepEqual(next.days[0].counts, { photo: 1 })
  assert.equal(next.days[0].opens, 0)
})

test('a lost acknowledgement resends the SAME immutable batchId; duplicate ack is a no-op', () => {
  const q = makeQueue()
  q.apply(recordOpen(q.rows, { date: TODAY }))
  const first = q.apply(claim(q.rows, { now: NOW, owner: 'tab1', batchId: bid() }))
  // Send failed → lease released; the claimed batch stays frozen.
  q.apply(release(q.rows, { owner: 'tab1' }))
  const retry = q.apply(claim(q.rows, { now: NOW + 5000, owner: 'tab1', batchId: bid() }))
  assert.equal(retry.batchId, first.batchId)
  assert.deepEqual(retry.days, first.days)
  q.apply(ack(q.rows, { batchId: first.batchId, owner: 'tab1' }))
  q.apply(ack(q.rows, { batchId: first.batchId, owner: 'tab1' })) // duplicate: nothing to delete
  assert.equal(q.apply(claim(q.rows, { now: NOW + 9000, owner: 'tab1', batchId: bid() })), null)
})

test('ADM-06: two tabs cannot send concurrently; an expired lease is taken over with the same batch', () => {
  const q = makeQueue()
  q.apply(recordEvent(q.rows, { date: TODAY, event: 'week' }))
  const held = q.apply(claim(q.rows, { now: NOW, owner: 'tab1', batchId: bid() }))
  assert.ok(held)
  // Second tab while the lease is live: refused.
  assert.equal(q.apply(claim(q.rows, { now: NOW + 1000, owner: 'tab2', batchId: bid() })), null)
  // tab1 dies before acknowledging; after lease expiry tab2 resends the SAME
  // batch — the server's dedupe makes the double-send harmless.
  const takeover = q.apply(claim(q.rows, { now: NOW + 3 * 60_000, owner: 'tab2', batchId: bid() }))
  assert.equal(takeover.batchId, held.batchId)
})

test('ADM-08: offline days keep their own observed dates; a batch carries at most 7, oldest first', () => {
  const q = makeQueue()
  for (let i = 8; i >= 0; i--) {
    const d = new Date(NOW - i * 86400000).toISOString().slice(0, 10)
    q.apply(recordEvent(q.rows, { date: d, event: 'detail' }))
  }
  const batch = q.apply(claim(q.rows, { now: NOW, owner: 'tab1', batchId: bid() }))
  // The 8-days-ago segment fell to retention (7 days); 7 oldest remaining ship.
  assert.equal(batch.days.length, 7)
  assert.equal(batch.days[0].date, new Date(NOW - 7 * 86400000).toISOString().slice(0, 10))
  assert.ok(batch.days.every((d) => d.counts.detail === 1))
  assert.equal(pendingSummary(q.rows).dropped, 1)
  // Today's segment (the 8th remaining date) waits for the next batch.
  q.apply(ack(q.rows, { batchId: batch.batchId, owner: 'tab1' }))
  const rest = q.apply(claim(q.rows, { now: NOW, owner: 'tab1', batchId: bid() }))
  assert.equal(rest.days[0].date, TODAY)
})

test('ADM-07: opt-out clears every pending counter and a stale in-flight batch cannot resurface', () => {
  const q = makeQueue()
  q.apply(recordEvent(q.rows, { date: TODAY, event: 'detail' }))
  const inflight = q.apply(claim(q.rows, { now: NOW, owner: 'tab1', batchId: bid() }))
  q.apply(clearAll(q.rows, { now: NOW + 1 }))
  // The late ack for the OLD generation deletes nothing that matters…
  q.apply(ack(q.rows, { batchId: inflight.batchId, owner: 'tab1' }))
  // …and nothing is left to send, even though consent later returns.
  assert.equal(q.apply(claim(q.rows, { now: NOW + 2000, owner: 'tab1', batchId: bid() })), null)
  q.apply(recordEvent(q.rows, { date: TODAY, event: 'week' }))
  const fresh = q.apply(claim(q.rows, { now: NOW + 3000, owner: 'tab1', batchId: bid() }))
  assert.deepEqual(fresh.days[0].counts, { week: 1 }) // the old 'detail' never returns
})

test('context rides the day segment; counts clamp at 999', () => {
  const q = makeQueue()
  q.apply(recordOpen(q.rows, { date: TODAY }))
  q.apply(setDayContext(q.rows, { date: TODAY, standalone: true, platform: 'ios', setup: { push: true } }))
  for (let i = 0; i < 1200; i++) q.apply(recordEvent(q.rows, { date: TODAY, event: 'detail' }))
  const batch = q.apply(claim(q.rows, { now: NOW, owner: 'tab1', batchId: bid() }))
  assert.equal(batch.days[0].counts.detail, 999)
  assert.equal(batch.days[0].standalone, true)
  assert.deepEqual(batch.days[0].setup, { push: true })
})

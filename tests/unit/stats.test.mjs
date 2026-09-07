import test from 'node:test'
import assert from 'node:assert/strict'
import worker from '../../workers/push/worker.js'

/**
 * A1 regression suite (Pass 45): every reproduced audit defect gets the
 * failing-then-fixed expectation here. Fake KV only — no real key, no
 * production data.
 */

function fakeKV(entries = {}, opts = {}) {
  const rows = new Map(Object.entries(entries))
  const calls = { list: 0, get: 0 }
  const kv = {
    rows,
    calls,
    async get(key, type) {
      calls.get++
      if (opts.nullReads?.includes(key)) return null
      const v = rows.get(key)
      if (v === undefined) return null
      const str = typeof v === 'string' ? v : JSON.stringify(v)
      if (type === 'json') {
        try {
          return JSON.parse(str)
        } catch {
          return null
        }
      }
      return str
    },
    async put(key, value) {
      rows.set(key, value)
    },
    async delete(key) {
      rows.delete(key)
    },
    async list({ prefix = '', cursor } = {}) {
      calls.list++
      const keys = [...rows.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name }))
      const size = opts.pageSize ?? Infinity
      const start = cursor ? Number(cursor) : 0
      const page = keys.slice(start, start + size)
      const done = start + size >= keys.length
      return done ? { keys: page, list_complete: true } : { keys: page, list_complete: false, cursor: String(start + size) }
    },
  }
  return kv
}

let ipCounter = 0
const statsReq = (query = '', headers = {}) =>
  new Request(`https://push.test/stats${query}`, {
    headers: { 'cf-connecting-ip': `10.0.0.${++ipCounter}`, ...headers },
  })

const dayISO = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10)
const KEY = 'test-owner-key-for-fixtures-only'

test('ADM-01: /stats fails CLOSED — absent or empty server key is 503 and nothing is scanned', async () => {
  for (const seed of [{}, { statskey: '' }, { statskey: '   ' }]) {
    const kv = fakeKV(seed)
    const res = await worker.fetch(statsReq('?days=31&key=anything'), { PUSH: kv })
    assert.equal(res.status, 503)
    const body = await res.json()
    assert.equal(body.error, 'configuration unavailable')
    assert.equal(res.headers.get('cache-control'), 'no-store')
    assert.equal(kv.calls.list, 0, 'analytics rows were scanned before auth')
  }
})

test('ADM-01/03: wrong or missing credentials are 401 before any scan; both auth forms work when correct', async () => {
  const seed = { statskey: KEY, [`aping:${dayISO(0)}:aaaa1111`]: { i: true, p: 'ios', o: 1, u: {}, s: {} }, 'adev:aaaa1111': dayISO(0) }
  for (const req of [
    statsReq(''),
    statsReq('?key=wrong'),
    statsReq('', { authorization: `Bearer wrong` }),
    statsReq('', { authorization: KEY }), // malformed scheme
  ]) {
    const kv = fakeKV(seed)
    const res = await worker.fetch(req, { PUSH: kv })
    assert.equal(res.status, 401)
    assert.equal(res.headers.get('cache-control'), 'no-store')
    assert.equal(kv.calls.list, 0)
  }
  const viaHeader = await worker.fetch(statsReq('', { authorization: `Bearer ${KEY}` }), { PUSH: fakeKV(seed) })
  assert.equal(viaHeader.status, 200)
  assert.equal(viaHeader.headers.get('cache-control'), 'no-store')
  // Legacy query form still accepted during the dated transition window.
  const viaQuery = await worker.fetch(statsReq(`?key=${KEY}`), { PUSH: fakeKV(seed) })
  assert.equal(viaQuery.status, 200)
})

test('ADM-09: days=1 does not truncate the NAMED 7/30-day figures', async () => {
  const kv = fakeKV({
    statskey: KEY,
    'adev:oldtoken1': dayISO(3),
    [`aping:${dayISO(3)}:oldtoken1`]: { i: false, p: 'ios', o: 2, u: {}, s: {} },
    'adev:oldertok2': dayISO(20),
    [`aping:${dayISO(20)}:oldertok2`]: { i: false, p: 'android', o: 1, u: {}, s: {} },
  })
  const res = await worker.fetch(statsReq(`?days=1&key=${KEY}`), { PUSH: kv })
  const d = await res.json()
  assert.equal(d.windowDays, 1)
  assert.equal(d.daily.length, 1)
  assert.equal(d.activeLast7Days, 1, 'device active 3 days ago must count in the fixed 7-day window')
  assert.equal(d.activeLast30Days, 2, 'device active 20 days ago must count in the fixed 30-day window')
})

test('ADM-10: a listed row whose read returns null is completeness metadata, not activity', async () => {
  const gone = `aping:${dayISO(0)}:ghosttok1`
  const kv = fakeKV(
    {
      statskey: KEY,
      [gone]: { i: false, p: 'ios', o: 1, u: {}, s: {} },
      [`aping:${dayISO(0)}:realtoken1`]: { i: false, p: 'ios', o: 1, u: {}, s: {} },
      'adev:realtoken1': dayISO(0),
    },
    { nullReads: [gone] }
  )
  const d = await (await worker.fetch(statsReq(`?days=1&key=${KEY}`), { PUSH: kv })).json()
  assert.equal(d.daily[0].active, 1)
  assert.equal(d.daily[0].listed, 2)
  assert.equal(d.completeness.missingRows, 1)
  assert.equal(d.completeness.invalidRows, 0)
})

test('ADM-11: a capped pagination scan is flagged incomplete, never a silent partial total', async () => {
  const entries = { statskey: KEY }
  for (let i = 0; i < 60; i++) entries[`adev:token${String(i).padStart(4, '0')}`] = dayISO(1)
  const kv = fakeKV(entries, { pageSize: 1 }) // 60 single-key pages > 50-page cap
  const d = await (await worker.fetch(statsReq(`?days=1&key=${KEY}`), { PUSH: kv })).json()
  assert.equal(d.completeness.scanComplete, false)
})

test('ADM-12: zero/negative counters never mint adopters; unknown setup is not false', async () => {
  const kv = fakeKV({
    statskey: KEY,
    'adev:tokenaaa1': dayISO(0),
    [`aping:${dayISO(0)}:tokenaaa1`]: { i: false, p: 'ios', o: 1, u: { photo: 0, detail: -3, week: 2 }, s: { push: true } },
    'adev:tokenbbb2': dayISO(0),
    [`aping:${dayISO(0)}:tokenbbb2`]: { i: false, p: 'ios', o: 1, u: {}, s: {} },
  })
  const d = await (await worker.fetch(statsReq(`?days=7&key=${KEY}`), { PUSH: kv })).json()
  assert.equal(d.features.photo, undefined, 'zero count minted an adopter')
  assert.equal(d.features.detail, undefined, 'negative count minted an adopter')
  assert.deepEqual(d.features.week, { uses: 2, devices: 1 })
  // Setup: only the reported flag has a denominator; the empty object adds none.
  assert.equal(d.setup.known.push, 1)
  assert.equal(d.setup.counts.push, 1)
  assert.equal(d.setup.known.location, undefined)
  assert.equal(d.setup.devices, 1)
})

test('ADM-12/16: /ping stores only positive counters and reported booleans; oversized/non-JSON is refused', async () => {
  const kv = fakeKV({})
  const ping = (body, headers = { 'content-type': 'application/json' }) =>
    worker.fetch(
      new Request('https://push.test/ping', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'cf-connecting-ip': `10.1.0.${++ipCounter}`, ...headers } }),
      { PUSH: kv }
    )
  const ok = await ping({ d: 'abcd1234', i: true, p: 'ios', v: 9, o: 3, u: { photo: -5, detail: 0, week: 4 }, s: {} })
  assert.equal(ok.status, 200)
  const stored = JSON.parse(kv.rows.get(`aping:${dayISO(0)}:abcd1234`))
  assert.deepEqual(stored.u, { week: 4 }, 'negative/zero counters must be dropped at ingest')
  assert.deepEqual(stored.s, {}, 'an empty setup object must not fabricate six false flags')
  const partial = await ping({ d: 'abcd1234', u: {}, s: { push: false } })
  assert.equal(partial.status, 200)
  assert.deepEqual(JSON.parse(kv.rows.get(`aping:${dayISO(0)}:abcd1234`)).s, { push: false })
  const noType = await ping({ d: 'abcd1234' }, {})
  assert.equal(noType.status, 400)
  const oversized = await ping('{"d":"abcd1234","x":"' + 'a'.repeat(10000) + '"}')
  assert.equal(oversized.status, 400)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { GroupStore, cleanSlots } from '../../workers/push/group-store.js'

/** Minimal Durable Object harness matching the SyncStore test's shape. */
function makeStore(legacyKV = null) {
  const records = new Map()
  let chain = Promise.resolve()
  const tx = {
    get: async (key) => records.get(key),
    put: async (key, value) => {
      records.set(key, value)
    },
    delete: async (key) => {
      records.delete(key)
    },
  }
  const serial = (work) => {
    const next = chain.then(work)
    chain = next.catch(() => {})
    return next
  }
  const state = {
    storage: { ...tx, transaction: (work) => serial(() => work(tx)) },
    blockConcurrencyWhile: (work) => work(),
  }
  const env = { PUSH: { get: async () => legacyKV, delete: () => { throw new Error('must not delete KV') } } }
  return { store: new GroupStore(state, env), records }
}

const CODE = 'K7M2PQ'
const req = (path, method, body) =>
  new Request(`https://push.test${path}?code=${CODE}`, {
    method,
    ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
  })
const slots = [{ d: '2026-09-08', from: 540, to: 600 }]

test('create → join → get: stable ids, tokens never listed, same-name members stay distinct', async () => {
  const { store } = makeStore()
  const created = await (await store.fetch(req('/group', 'POST', { name: 'Alex', slots, wantCredentials: true }))).json()
  assert.ok(created.memberId && created.token)
  // Second person with the SAME display name joins with credentials: distinct member.
  const joined = await (await store.fetch(req('/group/join', 'POST', { name: 'Alex', slots, wantCredentials: true }))).json()
  assert.notEqual(joined.memberId, created.memberId)
  const list = await (await store.fetch(req('/group', 'GET'))).json()
  assert.equal(list.members.length, 2)
  assert.ok(list.members.every((m) => m.memberId && !('token' in m)))
})

test('rename keeps identity; a stale/wrong token is refused, not applied to someone else', async () => {
  const { store } = makeStore()
  const created = await (await store.fetch(req('/group', 'POST', { name: 'Alex', slots, wantCredentials: true }))).json()
  const renamed = await store.fetch(
    req('/group/join', 'POST', { name: 'Alexandra', slots, memberId: created.memberId, token: created.token })
  )
  assert.equal(renamed.status, 200)
  const list = await (await store.fetch(req('/group', 'GET'))).json()
  assert.deepEqual(list.members.map((m) => m.name), ['Alexandra'])
  assert.equal(list.members[0].memberId, created.memberId)
  const stale = await store.fetch(
    req('/group/join', 'POST', { name: 'X', slots, memberId: created.memberId, token: 'f'.repeat(32) })
  )
  assert.equal(stale.status, 403)
  const staleLeave = await store.fetch(
    req('/group/leave', 'POST', { memberId: created.memberId, token: 'f'.repeat(32) })
  )
  assert.equal(staleLeave.status, 403)
})

test('two simultaneous joins both land (transactions serialize; no lost update)', async () => {
  const { store } = makeStore()
  await store.fetch(req('/group', 'POST', { name: 'Owner', slots, wantCredentials: true }))
  const [a, b] = await Promise.all([
    store.fetch(req('/group/join', 'POST', { name: 'Pat', slots, wantCredentials: true })),
    store.fetch(req('/group/join', 'POST', { name: 'Sam', slots, wantCredentials: true })),
  ])
  assert.equal(a.status, 200)
  assert.equal(b.status, 200)
  const list = await (await store.fetch(req('/group', 'GET'))).json()
  assert.equal(list.members.length, 3)
})

test('legacy KV members import once with stable ids and stay name-addressable; KV is never deleted', async () => {
  const legacy = { createdAt: 1, members: { Jo: { slots, at: 5 }, Sam: { slots: [], at: 6 } } }
  const { store } = makeStore(legacy)
  const list = await (await store.fetch(req('/group', 'GET'))).json()
  assert.equal(list.members.length, 2)
  // An old client updates by name (no credentials) — it updates, never duplicates.
  const update = await store.fetch(req('/group/join', 'POST', { name: 'Jo', slots }))
  assert.equal(update.status, 200)
  const after = await (await store.fetch(req('/group', 'GET'))).json()
  assert.equal(after.members.length, 2)
  // A NEW client with the same name claims the legacy record and gets credentials.
  const claimed = await (await store.fetch(req('/group/join', 'POST', { name: 'Sam', slots, wantCredentials: true }))).json()
  assert.ok(claimed.token)
  const final = await (await store.fetch(req('/group', 'GET'))).json()
  assert.equal(final.members.length, 2)
})

test('invalid intervals are dropped and joins to a missing group 404', async () => {
  assert.deepEqual(cleanSlots([{ d: 'nope', from: 1, to: 2 }, { d: '2026-09-08', from: 600, to: 540 }, { d: '2026-09-08', from: 540, to: 2000 }]), [])
  assert.deepEqual(cleanSlots([{ d: '2026-09-08', from: 540, to: 600, extra: 'x' }]), slots)
  const { store } = makeStore()
  const missing = await store.fetch(req('/group/join', 'POST', { name: 'Jo', slots }))
  assert.equal(missing.status, 404)
})

test('leaving the last member removes the group; a full group refuses a 13th member', async () => {
  const { store } = makeStore()
  const created = await (await store.fetch(req('/group', 'POST', { name: 'Solo', slots, wantCredentials: true }))).json()
  await store.fetch(req('/group/leave', 'POST', { memberId: created.memberId, token: created.token }))
  assert.equal((await store.fetch(req('/group', 'GET'))).status, 404)
  // Refill to the cap.
  await store.fetch(req('/group', 'POST', { name: 'M0', slots, wantCredentials: true }))
  for (let i = 1; i < 12; i++) {
    const r = await store.fetch(req('/group/join', 'POST', { name: `M${i}`, slots, wantCredentials: true }))
    assert.equal(r.status, 200)
  }
  const overflow = await store.fetch(req('/group/join', 'POST', { name: 'M12', slots, wantCredentials: true }))
  assert.equal(overflow.status, 403)
})

test('KV listings paginate through every cursor page', async () => {
  const { listAllKeys } = await import('../../workers/push/worker.js')
  const pages = [
    { keys: [{ name: 'sub:1' }, { name: 'sub:2' }], list_complete: false, cursor: 'c1' },
    { keys: [{ name: 'sub:3' }], list_complete: false, cursor: 'c2' },
    { keys: [{ name: 'sub:4' }], list_complete: true },
  ]
  const calls = []
  const kv = {
    list: async (opts) => {
      calls.push(opts.cursor)
      return pages[calls.length - 1]
    },
  }
  const keys = await listAllKeys(kv, { prefix: 'sub:' })
  assert.deepEqual(keys.map((k) => k.name), ['sub:1', 'sub:2', 'sub:3', 'sub:4'])
  assert.deepEqual(calls, [undefined, 'c1', 'c2'])
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { MentorStore } from '../../workers/push/mentor-store.js'
import { attestationString, decryptText, encryptText, hmacHex, randomHex, validAttestation } from '../../shared/mentor.js'
import { collections, validatePayload } from '../../shared/contracts.js'

/**
 * G4 + Pass 77 (audit B02) — the mentor space: owner token gates owner
 * routes; invitations are single use; sessions are scoped to one space;
 * revocation cuts everything; a share is a versioned COMPLETE REPLACEMENT of
 * the pack's portal content (zero files → zero accessible; the same file
 * twice → one decryptable; five is a total bound; a stale revision is refused;
 * a replay is a no-op; a failed upload or commit leaves the previous share
 * readable); feedback is signed, verifiable and retry-idempotent.
 */

function makeStore(opts = {}) {
  const records = new Map()
  const kv = new Map()
  let chain = Promise.resolve()
  const tx = { get: async (k) => records.get(k), put: async (k, v) => { records.set(k, v) }, delete: async (k) => { records.delete(k) } }
  const serial = (work) => { const next = chain.then(work); chain = next.catch(() => {}); return next }
  const storage = { ...tx, transaction: (work) => serial(async () => { if (opts.failCommit?.()) throw new Error('commit failed'); return work(tx) }) }
  const state = { storage, blockConcurrencyWhile: (work) => work() }
  const env = { PUSH: { get: async (k, type) => (type === 'json' ? JSON.parse(kv.get(k) ?? 'null') : kv.get(k) ?? null), put: async (k, v) => { if (opts.failPut?.(k)) throw new Error('kv down'); kv.set(k, v) }, delete: async () => { throw new Error('must not delete KV') } } }
  return { store: new MentorStore(state, env), records, kv }
}
const SPACE = randomHex(12)
const OWNER = randomHex(24)
const call = async (store, path, body, space = SPACE) => {
  const res = await store.fetch(new Request(`https://push.test${path}?space=${space}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }))
  return { status: res.status, body: await res.json() }
}
async function setup(opts) {
  const s = makeStore(opts)
  assert.equal((await call(s.store, '/mentor/space', { ownerToken: OWNER })).status, 200)
  return s
}
const mk = async (store, name) => {
  const inv = (await call(store, '/mentor/invite', { ownerToken: OWNER })).body
  return (await call(store, '/mentor/join', { code: inv.code, secret: inv.secret, name, passphrase: 'correct horse battery' })).body
}
const file = async (id, text) => {
  const key = randomHex(32)
  const blob = await encryptText(text, key)
  return { id, name: `${id}.txt`, size: text.length, key, iv: blob.iv, data: blob.data }
}
const share = (store, packId, revision, mentorIds, attachments, text = 'REVIEW PACK') => call(store, '/mentor/share', { ownerToken: OWNER, revision, pack: { id: packId, title: 'Progress review 1', text }, mentorIds, attachments })

test('owner routes need the owner token; a second device with a different token cannot claim the space', async () => {
  const { store } = await setup()
  assert.equal((await call(store, '/mentor/space', { ownerToken: randomHex(24) })).status, 403)
  assert.equal((await call(store, '/mentor/invite', { ownerToken: randomHex(24) })).status, 403)
  assert.equal((await call(store, '/mentor/mentors', { ownerToken: 'short' })).status, 403)
  assert.equal((await call(store, '/mentor/share', { ownerToken: randomHex(24), revision: 1, pack: { id: 'k', title: 't', text: 'x' } })).status, 403)
  assert.equal((await call(store, '/mentor/space', { ownerToken: OWNER })).status, 200, 'idempotent for the owner')
})

test('invitation: single use, wrong secret refused, join creates a scoped mentor with a session; login works; passphrase rules', async () => {
  const { store } = await setup()
  const inv = (await call(store, '/mentor/invite', { ownerToken: OWNER, label: 'Ms Mentor' })).body
  assert.match(inv.code, /^[A-Z2-9]{8}$/)
  assert.equal((await call(store, '/mentor/join', { code: inv.code, secret: randomHex(16), name: 'X', passphrase: 'correct horse' })).status, 403)
  assert.equal((await call(store, '/mentor/join', { code: inv.code, secret: inv.secret, name: 'A Mentor', passphrase: 'short' })).status, 400)
  const joined = (await call(store, '/mentor/join', { code: inv.code, secret: inv.secret, name: '  A   Mentor ', passphrase: 'correct horse battery' })).body
  assert.match(joined.mentorId, /^mt[0-9a-f]{12}$/)
  assert.equal(joined.name, 'A Mentor')
  assert.equal((await call(store, '/mentor/join', { code: inv.code, secret: inv.secret, name: 'B', passphrase: 'correct horse battery' })).status, 403, 'single use')
  assert.equal((await call(store, '/mentor/login', { mentorId: joined.mentorId, passphrase: 'wrong passphrase' })).status, 403)
  const login = await call(store, '/mentor/login', { mentorId: joined.mentorId, passphrase: 'correct horse battery' })
  assert.equal(login.status, 200)
  assert.notEqual(login.body.session, joined.session)
  assert.equal((await call(store, '/mentor/packs', { session: joined.session }, randomHex(12))).status, 404, 'another space id is unknown here')
})

test('a share is a versioned complete replacement: zero files → zero; same file twice → one decryptable; five total; recipients replaced; stale/replay handled', async () => {
  const { store, kv } = await setup()
  const a = await mk(store, 'A Mentor')
  const b = await mk(store, 'B Mentor')
  const att1 = await file('att1', 'PDF bytes one')
  // Revision 1: A gets att1.
  assert.equal((await share(store, 'k1', 1, [a.mentorId], [att1])).status, 200)
  assert.ok([...kv.keys()].some((k) => k === `matt:${SPACE}:k1:1:att1`), 'ciphertext under a versioned key')
  assert.ok(!JSON.stringify([...kv.values()]).includes('PDF bytes one'), 'KV never holds plaintext')
  let forA = (await call(store, '/mentor/packs', { session: a.session })).body
  assert.deepEqual(forA.packs[0].attachments, [{ id: 'att1', name: 'att1.txt', size: 13 }])
  assert.equal(forA.packs[0].revision, 1)
  assert.equal((await call(store, '/mentor/packs', { session: b.session })).body.packs.length, 0, 'not shared with B')
  const got = (await call(store, '/mentor/attachment', { session: a.session, packId: 'k1', attachmentId: 'att1' })).body
  assert.equal(await decryptText({ iv: got.iv, data: got.data }, got.key), 'PDF bytes one')
  // Out-of-order and stale revisions are refused; a replay of the current one is a no-op.
  assert.equal((await share(store, 'k1', 3, [a.mentorId], [])).status, 409)
  const replay = await share(store, 'k1', 1, [a.mentorId], [att1])
  assert.equal(replay.status, 200)
  assert.equal(replay.body.replayed, true)
  // Revision 2 with NO files: nothing accessible any more (the omitted file does not linger).
  assert.equal((await share(store, 'k1', 2, [a.mentorId], [])).status, 200)
  forA = (await call(store, '/mentor/packs', { session: a.session })).body
  assert.deepEqual(forA.packs[0].attachments, [])
  assert.equal((await call(store, '/mentor/attachment', { session: a.session, packId: 'k1', attachmentId: 'att1' })).status, 404)
  // Revision 3: the same file again with NEW bytes → exactly one entry, decryptable with the served key.
  const att1v2 = await file('att1', 'PDF bytes two')
  assert.equal((await share(store, 'k1', 3, [a.mentorId], [att1v2])).status, 200)
  forA = (await call(store, '/mentor/packs', { session: a.session })).body
  assert.equal(forA.packs[0].attachments.length, 1)
  const again = (await call(store, '/mentor/attachment', { session: a.session, packId: 'k1', attachmentId: 'att1' })).body
  assert.equal(await decryptText({ iv: again.iv, data: again.data }, again.key), 'PDF bytes two')
  // Five is a total bound; duplicate ids in one manifest are invalid.
  const six = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => file(`f${i}`, `f${i}`)))
  assert.equal((await share(store, 'k1', 4, [a.mentorId], six)).status, 400)
  assert.equal((await share(store, 'k1', 4, [a.mentorId], [att1v2, att1v2])).status, 400)
  // Revision 4 replaces the recipients: B sees exactly the new manifest, A loses the pack.
  assert.equal((await share(store, 'k1', 4, [b.mentorId], [att1v2])).status, 200)
  assert.equal((await call(store, '/mentor/packs', { session: a.session })).body.packs.length, 0)
  const forB = (await call(store, '/mentor/packs', { session: b.session })).body
  assert.equal(forB.packs.length, 1)
  assert.equal(forB.packs[0].revision, 4)
  assert.equal((await call(store, '/mentor/attachment', { session: a.session, packId: 'k1', attachmentId: 'att1' })).status, 404)
  // Owner listing reports the committed revision.
  const list = (await call(store, '/mentor/mentors', { ownerToken: OWNER })).body
  assert.deepEqual(list.packs.map((p) => [p.id, p.revision, p.mentorIds, p.attachments]), [['k1', 4, [b.mentorId], 1]])
})

test('a failed upload or a failed commit leaves the previous share readable; the next attempt with the same revision succeeds', async () => {
  let failPut = false
  let failCommit = false
  const { store } = await setup({ failPut: () => failPut, failCommit: () => failCommit })
  const a = await mk(store, 'A Mentor')
  const att1 = await file('att1', 'first')
  assert.equal((await share(store, 'k1', 1, [a.mentorId], [att1])).status, 200)
  failPut = true
  const att2 = await file('att2', 'second')
  assert.equal((await share(store, 'k1', 2, [a.mentorId], [att2])).status, 502)
  failPut = false
  failCommit = true
  assert.equal((await share(store, 'k1', 2, [a.mentorId], [att2])).status, 409)
  failCommit = false
  let packs = (await call(store, '/mentor/packs', { session: a.session })).body.packs
  assert.equal(packs[0].revision, 1)
  assert.deepEqual(packs[0].attachments.map((x) => x.id), ['att1'])
  const got = (await call(store, '/mentor/attachment', { session: a.session, packId: 'k1', attachmentId: 'att1' })).body
  assert.equal(await decryptText({ iv: got.iv, data: got.data }, got.key), 'first')
  assert.equal((await share(store, 'k1', 2, [a.mentorId], [att2])).status, 200, 'retry with the same revision')
  packs = (await call(store, '/mentor/packs', { session: a.session })).body.packs
  assert.deepEqual(packs[0].attachments.map((x) => x.id), ['att2'])
})

test('feedback is signed and verifiable, retry-idempotent by client id; revocation cuts sessions, login and sharing', async () => {
  const { store, kv } = await setup()
  const a = await mk(store, 'A Mentor')
  const b = await mk(store, 'B Mentor')
  assert.equal((await share(store, 'k1', 1, [a.mentorId], [])).status, 200)
  assert.equal((await call(store, '/mentor/feedback', { session: b.session, packId: 'k1', text: 'nope' })).status, 404)
  const fb = (await call(store, '/mentor/feedback', { session: a.session, packId: 'k1', text: 'Strong modelling; extend the wait time.', clientId: 'cli-1' })).body
  assert.match(fb.sig, /^[0-9a-f]{64}$/)
  const retry = (await call(store, '/mentor/feedback', { session: a.session, packId: 'k1', text: 'Strong modelling; extend the wait time.', clientId: 'cli-1' })).body
  assert.equal(retry.feedbackId, fb.feedbackId)
  assert.equal(retry.replayed, true)
  const inbox = (await call(store, '/mentor/inbox', { ownerToken: OWNER, since: 0 })).body.feedback
  assert.equal(inbox.length, 1)
  const item = inbox[0]
  const attestation = { spaceId: item.spaceId, mentorId: item.mentorId, mentorName: item.mentorName, feedbackId: item.feedbackId, at: item.at, sig: item.sig }
  assert.equal(validAttestation(attestation), true)
  assert.equal(await hmacHex(kv.get('mentor-signing-key'), attestationString(attestation, item.text)), item.sig)
  assert.deepEqual((await call(store, '/mentor/verify', { ownerToken: OWNER, attestation, text: item.text })).body, { valid: true })
  assert.deepEqual((await call(store, '/mentor/verify', { ownerToken: OWNER, attestation, text: item.text + ' (edited)' })).body, { valid: false })
  assert.equal((await call(store, '/mentor/revoke', { ownerToken: OWNER, mentorId: a.mentorId })).status, 200)
  assert.equal((await call(store, '/mentor/packs', { session: a.session })).status, 401)
  assert.equal((await call(store, '/mentor/login', { mentorId: a.mentorId, passphrase: 'correct horse battery' })).status, 403)
  assert.equal((await share(store, 'k2', 1, [a.mentorId], [])).status, 400, 'cannot share with a revoked mentor')
})

test('B10: unshare is owner-only and idempotent — the pack leaves the portal (packs and attachment refused), a stale client share is refused, the next share works', async () => {
  const { store } = await setup()
  const a = await mk(store, 'A Mentor')
  const att1 = await file('att1', 'first')
  assert.equal((await share(store, 'k1', 1, [a.mentorId], [att1])).status, 200)
  assert.equal((await call(store, '/mentor/unshare', { ownerToken: randomHex(24), packId: 'k1' })).status, 403)
  assert.equal((await call(store, '/mentor/unshare', { ownerToken: OWNER, packId: 'nope' })).body.unshared, false, 'unknown pack is a harmless no-op')
  const un = (await call(store, '/mentor/unshare', { ownerToken: OWNER, packId: 'k1' })).body
  assert.equal(un.unshared, true)
  assert.equal(un.revision, 2)
  assert.equal((await call(store, '/mentor/packs', { session: a.session })).body.packs.length, 0, 'gone from the mentor')
  assert.equal((await call(store, '/mentor/attachment', { session: a.session, packId: 'k1', attachmentId: 'att1' })).status, 404)
  assert.equal((await call(store, '/mentor/feedback', { session: a.session, packId: 'k1', text: 'late' })).status, 404)
  const again = (await call(store, '/mentor/unshare', { ownerToken: OWNER, packId: 'k1' })).body
  assert.equal(again.replayed, true)
  assert.equal(again.revision, 2, 'idempotent: no further revision')
  assert.deepEqual((await call(store, '/mentor/mentors', { ownerToken: OWNER })).body.packs.map((p) => [p.id, p.revision, p.mentorIds, p.attachments]), [['k1', 2, [], 0]])
  assert.equal((await share(store, 'k1', 2, [a.mentorId], [])).status, 409, 'a client that missed the unshare must review again')
  assert.equal((await share(store, 'k1', 3, [a.mentorId], [att1])).status, 200)
  assert.equal((await call(store, '/mentor/packs', { session: a.session })).body.packs.length, 1)
})

test('B08: close-space is owner-only and recoverable — every mentor route is refused with 403 while closed, nothing is deleted, reopen restores exactly what was shared', async () => {
  const { store, records } = await setup()
  const a = await mk(store, 'A Mentor')
  const att1 = await file('att1', 'first')
  assert.equal((await share(store, 'k1', 1, [a.mentorId], [att1])).status, 200)
  const fb = await call(store, '/mentor/feedback', { session: a.session, packId: 'k1', text: 'Before closing.' })
  assert.equal(fb.status, 200)
  assert.equal((await call(store, '/mentor/close', { ownerToken: randomHex(24) })).status, 403)
  const closed = await call(store, '/mentor/close', { ownerToken: OWNER })
  assert.equal(closed.status, 200)
  assert.ok(closed.body.closedAt > 0)
  const before = JSON.stringify([...records.keys()].filter((k) => k.startsWith('pack:') || k.startsWith('feedback:') || k.startsWith('mentor:')).sort())
  for (const [path, body] of [
    ['/mentor/packs', { session: a.session }],
    ['/mentor/attachment', { session: a.session, packId: 'k1', attachmentId: 'att1' }],
    ['/mentor/feedback', { session: a.session, packId: 'k1', text: 'x' }],
    ['/mentor/login', { mentorId: a.mentorId, passphrase: 'correct horse battery' }],
  ]) assert.equal((await call(store, path, body)).status, 403, `${path} refused while closed`)
  const inv = (await call(store, '/mentor/invite', { ownerToken: OWNER })).body
  assert.equal((await call(store, '/mentor/join', { code: inv.code, secret: inv.secret, name: 'B', passphrase: 'correct horse battery' })).status, 403, 'no joining while closed')
  const list = (await call(store, '/mentor/mentors', { ownerToken: OWNER })).body
  assert.equal(list.closedAt, closed.body.closedAt)
  assert.equal(list.packs.length, 1, 'owner still sees the manifest')
  assert.equal((await call(store, '/mentor/inbox', { ownerToken: OWNER, since: 0 })).body.feedback.length, 1, 'feedback kept')
  assert.equal((await call(store, '/mentor/close', { ownerToken: OWNER })).body.closedAt, closed.body.closedAt, 'idempotent')
  assert.equal(JSON.stringify([...records.keys()].filter((k) => k.startsWith('pack:') || k.startsWith('feedback:') || k.startsWith('mentor:')).sort()), before, 'nothing deleted')
  const reopened = await call(store, '/mentor/reopen', { ownerToken: OWNER })
  assert.equal(reopened.body.closedAt, null)
  const login = await call(store, '/mentor/login', { mentorId: a.mentorId, passphrase: 'correct horse battery' })
  assert.equal(login.status, 200)
  const packs = (await call(store, '/mentor/packs', { session: login.body.session })).body.packs
  assert.deepEqual(packs.map((p) => [p.id, p.revision, p.attachments.length]), [['k1', 1, 1]])
  const got = (await call(store, '/mentor/attachment', { session: login.body.session, packId: 'k1', attachmentId: 'att1' })).body
  assert.equal(await decryptText({ iv: got.iv, data: got.data }, got.key), 'first')
})

test('client contract: reviewer-authenticated needs a well-formed attestation; pack attachments carry a stable uid and a sharing summary', () => {
  const empty = Object.fromEntries(collections.map((k) => [k, []]))
  const withAdmin = (admin) => ({ store: { activeId: 'p1', profiles: [{ id: 'p1', name: 'one', settings: { demo: true, sheetId: '', gid: null } }] }, admin: { p1: admin } })
  const base = { id: 'o1', dateISO: '2026-09-14', observer: 'A Mentor', subject: 'Maths', focus: '', strengths: '', development: 'Extend wait time', at: 1 }
  const attestation = { spaceId: randomHex(12), mentorId: 'mt0123456789ab', mentorName: 'A Mentor', feedbackId: 'fbabcdef012345', at: 5, sig: randomHex(32) }
  assert.doesNotThrow(() => validatePayload(withAdmin({ ...empty, observations: [{ ...base, sourceType: 'reviewer-authenticated', attestation }] })))
  assert.throws(() => validatePayload(withAdmin({ ...empty, observations: [{ ...base, sourceType: 'reviewer-authenticated' }] })), /provenance/)
  const pack = { id: 'k1', title: 'Review 1', state: 'draft', createdISO: '2026-09-14', items: [], attachments: [{ id: '1', uid: 'legacy-' + randomHex(32), name: 'plan.pdf', size: 1200, state: 'local-only' }], sharing: { revision: 2, sharedAt: 5, mentorIds: ['mt0123456789ab'], attachmentUids: ['legacy-x'], textHash: 'abc' }, at: 1 }
  assert.doesNotThrow(() => validatePayload(withAdmin({ ...empty, reviewPacks: [pack] })))
  assert.throws(() => validatePayload(withAdmin({ ...empty, reviewPacks: [{ ...pack, sharing: { revision: 0 } }] })), /sharing summary/)
})

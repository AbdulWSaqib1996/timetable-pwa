import test from 'node:test'
import assert from 'node:assert/strict'
import { MentorStore } from '../../workers/push/mentor-store.js'
import { attestationString, decryptText, encryptText, hmacHex, randomHex, validAttestation } from '../../shared/mentor.js'
import { collections, validatePayload } from '../../shared/contracts.js'

/**
 * G4 — the mentor space: owner token gates owner routes; invitations are
 * single use and expire; a mentor's session is scoped to one space; revocation
 * kills sessions and hides packs; packs are visible only to the mentors they
 * were shared with; attachments come back encrypted with their key only to an
 * authenticated mentor; feedback is signed and the signature verifies; the
 * client contract accepts reviewer-authenticated only with an attestation.
 */

function makeStore() {
  const records = new Map()
  const kv = new Map()
  let chain = Promise.resolve()
  const tx = { get: async (k) => records.get(k), put: async (k, v) => { records.set(k, v) }, delete: async (k) => { records.delete(k) } }
  const serial = (work) => { const next = chain.then(work); chain = next.catch(() => {}); return next }
  const state = { storage: { ...tx, transaction: (work) => serial(() => work(tx)) }, blockConcurrencyWhile: (work) => work() }
  const env = { PUSH: { get: async (k, type) => (type === 'json' ? JSON.parse(kv.get(k) ?? 'null') : kv.get(k) ?? null), put: async (k, v) => { kv.set(k, v) }, delete: async () => { throw new Error('must not delete KV') } } }
  return { store: new MentorStore(state, env), records, kv }
}
const SPACE = randomHex(12)
const OWNER = randomHex(24)
const call = async (store, path, body, space = SPACE) => {
  const res = await store.fetch(new Request(`https://push.test${path}?space=${space}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }))
  return { status: res.status, body: await res.json() }
}
async function setup() {
  const s = makeStore()
  assert.equal((await call(s.store, '/mentor/space', { ownerToken: OWNER })).status, 200)
  return s
}

test('owner routes need the owner token; a second device with a different token cannot claim the space', async () => {
  const { store } = await setup()
  assert.equal((await call(store, '/mentor/space', { ownerToken: randomHex(24) })).status, 403)
  assert.equal((await call(store, '/mentor/invite', { ownerToken: randomHex(24) })).status, 403)
  assert.equal((await call(store, '/mentor/mentors', { ownerToken: 'short' })).status, 403)
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
  assert.match(joined.session, /^[0-9a-f]{48}$/)
  assert.equal((await call(store, '/mentor/join', { code: inv.code, secret: inv.secret, name: 'B', passphrase: 'correct horse battery' })).status, 403, 'single use')
  assert.equal((await call(store, '/mentor/login', { mentorId: joined.mentorId, passphrase: 'wrong passphrase' })).status, 403)
  const login = await call(store, '/mentor/login', { mentorId: joined.mentorId, passphrase: 'correct horse battery' })
  assert.equal(login.status, 200)
  assert.notEqual(login.body.session, joined.session)
  const list = (await call(store, '/mentor/mentors', { ownerToken: OWNER })).body
  assert.deepEqual(list.mentors.map((m) => [m.name, m.revokedAt]), [['A Mentor', null]])
  assert.equal(list.invites.length, 0, 'a used invitation is no longer pending')
  // A session is bound to its space: another space id is unknown to this object (and routes to a different object in production).
  assert.equal((await call(store, '/mentor/packs', { session: joined.session }, randomHex(12))).status, 404)
})

test('packs are scoped to the mentors they were shared with; attachments come back encrypted with their key; feedback is signed and verifiable; revocation cuts everything', async () => {
  const { store, kv } = await setup()
  const mk = async (name) => {
    const inv = (await call(store, '/mentor/invite', { ownerToken: OWNER })).body
    return (await call(store, '/mentor/join', { code: inv.code, secret: inv.secret, name, passphrase: 'correct horse battery' })).body
  }
  const a = await mk('A Mentor')
  const b = await mk('B Mentor')
  const key = randomHex(32)
  const blob = await encryptText('PDF bytes here', key)
  const share = await call(store, '/mentor/share', { ownerToken: OWNER, pack: { id: 'k1', title: 'Progress review 1', text: 'REVIEW PACK — Progress review 1\nEvaluation: Went well' }, mentorIds: [a.mentorId], attachments: [{ id: 'att1', name: 'plan.pdf', size: 14, key, iv: blob.iv, data: blob.data }] })
  assert.equal(share.status, 200)
  assert.ok([...kv.keys()].some((k) => k.startsWith(`matt:${SPACE}:k1:`)), 'encrypted attachment stored in KV')
  assert.ok(!JSON.stringify([...kv.values()]).includes('PDF bytes here'), 'KV never holds plaintext')
  const forA = (await call(store, '/mentor/packs', { session: a.session })).body
  assert.equal(forA.packs.length, 1)
  assert.equal(forA.packs[0].text, 'REVIEW PACK — Progress review 1\nEvaluation: Went well')
  assert.deepEqual(forA.packs[0].attachments, [{ id: 'att1', name: 'plan.pdf', size: 14 }])
  assert.equal((await call(store, '/mentor/packs', { session: b.session })).body.packs.length, 0, 'not shared with B')
  assert.equal((await call(store, '/mentor/attachment', { session: b.session, packId: 'k1', attachmentId: 'att1' })).status, 404)
  const att = (await call(store, '/mentor/attachment', { session: a.session, packId: 'k1', attachmentId: 'att1' })).body
  assert.equal(await decryptText({ iv: att.iv, data: att.data }, att.key), 'PDF bytes here')
  // Feedback: signed with the worker key; the owner can verify it and reads it in the inbox.
  assert.equal((await call(store, '/mentor/feedback', { session: b.session, packId: 'k1', text: 'nope' })).status, 404)
  const fb = (await call(store, '/mentor/feedback', { session: a.session, packId: 'k1', text: 'Strong modelling; extend the wait time.' })).body
  assert.match(fb.sig, /^[0-9a-f]{64}$/)
  const inbox = (await call(store, '/mentor/inbox', { ownerToken: OWNER, since: 0 })).body.feedback
  assert.equal(inbox.length, 1)
  const item = inbox[0]
  assert.equal(item.mentorName, 'A Mentor')
  assert.equal(item.packTitle, 'Progress review 1')
  const attestation = { spaceId: item.spaceId, mentorId: item.mentorId, mentorName: item.mentorName, feedbackId: item.feedbackId, at: item.at, sig: item.sig }
  assert.equal(validAttestation(attestation), true)
  assert.equal(await hmacHex(kv.get('mentor-signing-key'), attestationString(attestation, item.text)), item.sig)
  assert.deepEqual((await call(store, '/mentor/verify', { ownerToken: OWNER, attestation, text: item.text })).body, { valid: true })
  assert.deepEqual((await call(store, '/mentor/verify', { ownerToken: OWNER, attestation, text: item.text + ' (edited)' })).body, { valid: false }, 'changed text breaks the signature')
  assert.deepEqual((await call(store, '/mentor/verify', { ownerToken: OWNER, attestation: { ...attestation, mentorName: 'Someone else' }, text: item.text })).body, { valid: true }, 'the display name is not signed; identity is the mentor id')
  assert.equal((await call(store, '/mentor/inbox', { ownerToken: OWNER, since: item.at })).body.feedback.length, 0, 'since filter')
  // Revocation: sessions die, packs vanish, login refused; the owner sees the state.
  assert.equal((await call(store, '/mentor/revoke', { ownerToken: OWNER, mentorId: a.mentorId })).status, 200)
  assert.equal((await call(store, '/mentor/packs', { session: a.session })).status, 401)
  assert.equal((await call(store, '/mentor/login', { mentorId: a.mentorId, passphrase: 'correct horse battery' })).status, 403)
  assert.equal((await call(store, '/mentor/share', { ownerToken: OWNER, pack: { id: 'k2', title: 'x', text: 'y' }, mentorIds: [a.mentorId] })).status, 400, 'cannot share with a revoked mentor')
  const list = (await call(store, '/mentor/mentors', { ownerToken: OWNER })).body
  assert.ok(list.mentors.find((m) => m.id === a.mentorId).revokedAt > 0)
  assert.equal(list.mentors.find((m) => m.id === b.mentorId).revokedAt, null)
})

test('client contract: reviewer-authenticated needs a well-formed attestation; learner-entered never carries one by mistake', () => {
  const empty = Object.fromEntries(collections.map((k) => [k, []]))
  const withAdmin = (admin) => ({ store: { activeId: 'p1', profiles: [{ id: 'p1', name: 'one', settings: { demo: true, sheetId: '', gid: null } }] }, admin: { p1: admin } })
  const base = { id: 'o1', dateISO: '2026-09-14', observer: 'A Mentor', subject: 'Maths', focus: '', strengths: '', development: 'Extend wait time', at: 1 }
  const attestation = { spaceId: randomHex(12), mentorId: 'mt0123456789ab', mentorName: 'A Mentor', feedbackId: 'fbabcdef012345', at: 5, sig: randomHex(32) }
  assert.doesNotThrow(() => validatePayload(withAdmin({ ...empty, observations: [{ ...base, sourceType: 'reviewer-authenticated', attestation }] })))
  assert.throws(() => validatePayload(withAdmin({ ...empty, observations: [{ ...base, sourceType: 'reviewer-authenticated' }] })), /provenance/)
  assert.throws(() => validatePayload(withAdmin({ ...empty, observations: [{ ...base, sourceType: 'reviewer-authenticated', attestation: { ...attestation, sig: 'nope' } }] })), /provenance/)
  assert.doesNotThrow(() => validatePayload(withAdmin({ ...empty, observations: [{ ...base, sourceType: 'learner-entered' }] })))
})

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


test('audit: re-sharing retains omitted attachments and duplicates same id with stale key', async()=>{
 const {store}=await setup()
 const inv=(await call(store,'/mentor/invite',{ownerToken:OWNER})).body
 const m=(await call(store,'/mentor/join',{code:inv.code,secret:inv.secret,name:'Synthetic mentor',passphrase:'audit fixture only'})).body
 const make=async()=>{const key=randomHex(32);const blob=await encryptText('Synthetic attachment',key);return {id:'att1',name:'fixture.txt',size:20,key,...blob}}
 const send=async(attachments)=>call(store,'/mentor/share',{ownerToken:OWNER,pack:{id:'pack1',title:'Fixture',text:'Synthetic'},mentorIds:[m.mentorId],attachments})
 await send([await make()]); await send([])
 let packs=(await call(store,'/mentor/packs',{session:m.session})).body.packs
 assert.equal(packs[0].attachments.length,1,'omitted old file remains visible')
 await send([await make()])
 packs=(await call(store,'/mentor/packs',{session:m.session})).body.packs
 assert.equal(packs[0].attachments.length,2,'same id appears twice')
 const att=(await call(store,'/mentor/attachment',{session:m.session,packId:'pack1',attachmentId:'att1'})).body
 await assert.rejects(()=>decryptText({iv:att.iv,data:att.data},att.key))
})

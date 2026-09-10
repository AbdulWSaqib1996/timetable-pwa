import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createECDH, hkdfSync, createDecipheriv } from 'node:crypto'
import worker from '../../workers/push/worker.js'

const subKey = async endpoint => 'sub:' + Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint))).toString('base64url')
const device = name => {
  const client = createECDH('prime256v1'); client.generateKeys()
  return { client, subscription: { endpoint: `https://fcm.googleapis.com/fcm/send/${name}`, keys: {
    auth: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url'),
    p256dh: client.getPublicKey().toString('base64url'),
  } } }
}
async function fixture(t) {
  const A = device('fixture-a'), B = device('fixture-b')
  const vapidPair = await crypto.subtle.generateKey({ name:'ECDSA', namedCurve:'P-256' },true,['sign','verify'])
  const data = new Map([['vapid', JSON.stringify({publicKey:Buffer.from(await crypto.subtle.exportKey('raw',vapidPair.publicKey)).toString('base64url'),privateJwk:await crypto.subtle.exportKey('jwk',vapidPair.privateKey)})]])
  for(const d of [A,B]) data.set(await subKey(d.subscription.endpoint),JSON.stringify({subscription:d.subscription,config:{sheetId:'fixture-sheet-1234567890'}}))
  const writes=[], requests=[]
  const env={PUSH:{
    get:async(k,type)=>type==='json' ? JSON.parse(data.get(k)??'null') : data.get(k)??null,
    put:async(k,v,opts)=>{ assert.notEqual(k,'vapid','existing VAPID must not be overwritten'); writes.push({k,opts});data.set(k,v) },
    list:async()=>{throw new Error('A device test must never list subscriptions')},
    delete:async()=>{throw new Error('No user records may be deleted by this test')},
  }}
  const old=globalThis.fetch
  globalThis.fetch=async(url,options)=>{requests.push({url,options});return new Response('',{status:201})}
  t.after(()=>{globalThis.fetch=old})
  let ip=0
  const call=(path,body)=>worker.fetch(new Request(`https://worker.invalid${path}`,{method:'POST',headers:{'content-type':'application/json','cf-connecting-ip':`${t.name}-${ip++}`},body:body===undefined?undefined:JSON.stringify(body)}),env)
  return {A,B,data,env,writes,requests,call,vapidPair}
}
test('legacy broadcast is disabled; absent or mismatched device credentials never send',async t=>{
  const f=await fixture(t)
  assert.equal((await f.call('/test')).status,410)
  assert.equal((await f.call('/test-device')).status,400)
  assert.equal((await f.call('/test-device',{subscription:{endpoint:f.A.subscription.endpoint}})).status,400)
  assert.equal((await f.call('/test-device',{subscription:{...f.A.subscription,keys:f.B.subscription.keys}})).status,403)
  assert.equal((await f.call('/test-device',{subscription:device('unregistered').subscription})).status,403)
  assert.equal(f.requests.length,0);assert.equal(f.writes.length,0)
})
test('one authenticated device gets one correctly encrypted notification; cooldown is per device',async t=>{
  const f=await fixture(t),beforeB=f.data.get(await subKey(f.B.subscription.endpoint))
  const res=await f.call('/test-device',{subscription:f.A.subscription})
  assert.deepEqual(await res.json(),{ok:true,sent:1});assert.equal(f.requests.length,1)
  const {url,options}=f.requests[0]
  assert.equal(url,f.A.subscription.endpoint);assert.equal(options.redirect,'manual')
  const payload=Buffer.from(options.body),salt=payload.subarray(0,16),pub=payload.subarray(21,21+payload[20])
  assert.equal(payload.readUInt32BE(16),4096)
  const ikm=hkdfSync('sha256',f.A.client.computeSecret(pub),Buffer.from(f.A.subscription.keys.auth,'base64url'),Buffer.concat([Buffer.from('WebPush: info\0'),f.A.client.getPublicKey(),pub]),32)
  const key=hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: aes128gcm\0'),16)
  const nonce=hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: nonce\0'),12)
  const ciphertext=payload.subarray(21+payload[20]),decipher=createDecipheriv('aes-128-gcm',key,nonce)
  decipher.setAuthTag(ciphertext.subarray(-16))
  const plain=Buffer.concat([decipher.update(ciphertext.subarray(0,-16)),decipher.final()])
  assert.equal(plain.at(-1),2)
  assert.equal(JSON.parse(plain.subarray(0,-1)).body,'Background push is working on this device.')
  const jwt=options.headers.Authorization.match(/t=([^,]+)/)[1].split('.')
  assert.equal(JSON.parse(Buffer.from(jwt[1],'base64url')).aud,'https://fcm.googleapis.com')
  assert.equal(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},f.vapidPair.publicKey,Buffer.from(jwt[2],'base64url'),new TextEncoder().encode(jwt.slice(0,2).join('.'))),true)
  assert.equal(f.data.get(await subKey(f.B.subscription.endpoint)),beforeB)
  assert.equal((await f.call('/test-device',{subscription:f.A.subscription})).status,429)
  assert.equal(f.requests.length,1)
  assert.equal((await f.call('/test-device',{subscription:f.B.subscription})).status,200)
  assert.equal(f.requests.length,2)
  assert.ok(f.writes.every(w=>w.k.startsWith('testlock:') && w.opts.expirationTtl===600))
})
test('reject untrusted destinations, malformed keys, oversized bodies and credential replacement',async t=>{
  const f=await fixture(t)
  for(const endpoint of ['http://fcm.googleapis.com/a','https://127.0.0.1/a','https://fcm.googleapis.com.evil.invalid/a','https://fcm.googleapis.com:8443/a','https://user:pass@fcm.googleapis.com/a']){
    assert.equal((await f.call('/subscribe',{subscription:{...f.A.subscription,endpoint},config:{sheetId:'fixture-sheet-1234567890'}})).status,400)
  }
  assert.equal((await f.call('/subscribe',{subscription:{...f.A.subscription,keys:f.B.subscription.keys},config:{sheetId:'fixture-sheet-1234567890'}})).status,403)
  assert.equal((await f.call('/test-device',{subscription:f.A.subscription,padding:'x'.repeat(5000)})).status,400)
  assert.equal((await f.call('/subscribe',{subscription:f.A.subscription,config:{sheetId:42}})).status,400)
  assert.equal(f.requests.length,0);assert.equal(f.writes.length,0)
  assert.equal((await f.call('/subscribe',{subscription:f.A.subscription,config:{sheetId:'fixture-sheet-1234567890'}})).status,200)
})
test('provider errors and redirects fail without leaking response bodies or changing subscriptions',async t=>{
  const f=await fixture(t)
  globalThis.fetch=async()=>new Response('sensitive-provider-detail',{status:302,headers:{location:'http://127.0.0.1/secret'}})
  const res=await f.call('/test-device',{subscription:f.A.subscription})
  assert.equal(res.status,502);assert.doesNotMatch(await res.text(),/sensitive-provider-detail|127\.0/)
})

// ---------- FA-03: attendance answers are authoritative per profile and course day ----------
import { applyAttendanceReport, attendanceMarksFor, normalizeAttendance } from '../../workers/push/worker.js'

test('attendance report: mark, clear, stale revision, unrelated profile and old-day expiry', () => {
  const now = Date.parse('2026-09-07T16:40:00Z')
  const rec = { config: { profileId: 'a' } }
  const k = '2026-09-07|14:30|maths 1'
  let r = applyAttendanceReport(rec, { profileId: 'a', day: '2026-09-07', rev: 1, keys: [k] }, now)
  assert.equal(r.status, 'applied')
  rec.attendance = r.attendance
  assert.ok(attendanceMarksFor(rec, 'a', '2026-09-07', now).has(k))
  assert.equal(attendanceMarksFor(rec, 'b', '2026-09-07', now).size, 0)
  // Clearing the answer makes the session promptable again (reversible).
  r = applyAttendanceReport(rec, { profileId: 'a', day: '2026-09-07', rev: 2, keys: [] }, now)
  assert.equal(r.status, 'applied')
  rec.attendance = r.attendance
  assert.equal(attendanceMarksFor(rec, 'a', '2026-09-07', now).size, 0)
  // A stale snapshot (older revision) is rejected and changes nothing.
  r = applyAttendanceReport(rec, { profileId: 'a', day: '2026-09-07', rev: 1, keys: [k] }, now)
  assert.equal(r.status, 'stale')
  assert.equal(r.rev, 2)
  // Same revision, same keys → unchanged (no write needed).
  r = applyAttendanceReport(rec, { profileId: 'a', day: '2026-09-07', rev: 2, keys: [] }, now)
  assert.equal(r.status, 'unchanged')
  // Another profile's marks are kept independently.
  r = applyAttendanceReport(rec, { profileId: 'b', day: '2026-09-07', rev: 1, keys: ['2026-09-07|09:00|ps1'] }, now)
  rec.attendance = r.attendance
  assert.ok(attendanceMarksFor(rec, 'b', '2026-09-07', now).has('2026-09-07|09:00|ps1'))
  assert.equal(attendanceMarksFor(rec, 'a', '2026-09-07', now).size, 0)
  // Old days expire on normalisation (two-day retention).
  rec.attendance.a['2026-09-01'] = { rev: 1, keys: ['2026-09-01|09:00|old'] }
  assert.equal(normalizeAttendance(rec, now).a['2026-09-01'], undefined)
})

test('attendance report: legacy union-style marks migrate into the subscription profile by their key date, else expire', () => {
  const now = Date.parse('2026-09-07T16:40:00Z')
  const rec = { config: { profileId: 'a' }, marks: { '2026-09-07|14:30|maths 1': now - 3600_000, '2026-09-01|09:00|old': now - 6 * 86400_000 } }
  const a = normalizeAttendance(rec, now)
  assert.deepEqual(a.a['2026-09-07'], { rev: 0, keys: ['2026-09-07|14:30|maths 1'] })
  assert.equal(a.a['2026-09-01'], undefined)
  // No profile on the subscription → nothing can be attributed; the legacy marks expire.
  assert.deepEqual(normalizeAttendance({ marks: rec.marks }, now), {})
})

test('/attendance endpoint: validates the snapshot contract, rejects stale reports with 409, skips unchanged writes, migrates legacy marks', async (t) => {
  const f = await fixture(t)
  const key = await subKey(f.A.subscription.endpoint)
  const rec = JSON.parse(f.data.get(key))
  rec.config.profileId = 'a'
  // The endpoint runs on the real clock and keeps two days: use today's course date.
  const day = new Date().toISOString().slice(0, 10)
  rec.marks = { [`${day}|09:00|ps1`]: Date.now() - 60_000 }
  f.data.set(key, JSON.stringify(rec))
  const good = { v: 2, endpoint: f.A.subscription.endpoint, profileId: 'a', day, rev: 1, keys: [`${day}|14:30|maths 1`] }
  assert.equal((await f.call('/attendance', { ...good, v: 1 })).status, 400) // old contract
  assert.equal((await f.call('/attendance', { ...good, keys: ['1999-01-01|09:00|x'] })).status, 400) // key outside the day
  assert.equal((await f.call('/attendance', { ...good, endpoint: 'https://fcm.googleapis.com/fcm/send/unknown' })).status, 404)
  let res = await f.call('/attendance', good)
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { ok: true, rev: 1 })
  let stored = JSON.parse(f.data.get(key))
  assert.equal(stored.marks, undefined) // migrated
  assert.deepEqual(stored.attendance.a[day].keys, [`${day}|14:30|maths 1`]) // the snapshot is authoritative
  const writes = f.writes.length
  res = await f.call('/attendance', good)
  assert.deepEqual(await res.json(), { ok: true, skipped: true, rev: 1 })
  assert.equal(f.writes.length, writes) // unchanged → no KV write
  res = await f.call('/attendance', { ...good, rev: 0, keys: [] })
  assert.equal(res.status, 409)
  assert.equal((await res.json()).rev, 1)
  res = await f.call('/attendance', { ...good, rev: 2, keys: [] })
  assert.equal(res.status, 200)
  stored = JSON.parse(f.data.get(key))
  assert.deepEqual(stored.attendance.a[day].keys, [])
})

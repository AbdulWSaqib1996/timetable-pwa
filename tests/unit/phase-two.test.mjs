import test from 'node:test'
import assert from 'node:assert/strict'
import { parseTimetable, parseDateCell, parseTimeCell } from '../../shared/timetable.js'
import { reconcileEvents, eventKey } from '../../shared/identity.js'
import { mergeRecords, mergeAdmin, mergeStores, canonical, syncSettings } from '../../shared/merge.js'
import { validatePayload, collections } from '../../shared/contracts.js'
import { SyncStore } from '../../workers/push/sync-store.js'
const event = (patch={}) => ({id:'2026-09-07-2',dateISO:'2026-09-07',start:'09:00',end:'10:00',title:'Teaching',tutor:'Alex',groups:'2',room:'A',...patch})
test('shared parser rejects impossible dates/times and only forward fills blank cells', () => {
  assert.equal(parseDateCell({v:'31/02/2026'}),null)
  assert.equal(parseDateCell({v:'Date(2026,12,1)'}),null)
  assert.equal(parseTimeCell({v:'24:30'}),'')
  assert.equal(parseTimeCell({v:'12:30 pm'}),'12:30')
  const table = {cols:[],rows:[['Title','Date','Start','End','Event ID'],['A','07/09/2026','09:00','10:00','a'],['Bad','31/02/2026','09:00','10:00','b'],['No inheritance','','09:00','10:00','c'],['B','08/09/2026','09:00','10:00','d'],['C','','10:00','11:00','e']].map(row=>({c:row.map(v=>({v}))}))}
  const result = parseTimetable(table)
  assert.deepEqual(result.sessions.map(s=>s.title),['A','B','C'])
  assert.equal(result.sessions[0].sourceId,'a')
  assert.equal(result.warnings.length,2)
})
test('rescheduling and row movement keep legacy owner and calendar UID; explicit IDs handle title changes', () => {
  const old = event()
  const moved = reconcileEvents([event({id:'new-row',dateISO:'2026-09-10',start:'11:00'})],[old])[0]
  assert.equal(eventKey(moved),eventKey(old)); assert.equal(moved.calendarUid,old.id)
  const explicit = {...moved,sourceId:'teaching-1'}
  const renamed = reconcileEvents([{...explicit,title:'New title',dateISO:'2026-10-20'}],[explicit])[0]
  assert.equal(eventKey(renamed),eventKey(old))
  const ambiguous = reconcileEvents([event({dateISO:'2026-09-09'})],[old,event({id:'another',dateISO:'2026-09-08'})])[0]
  const unsafe = reconcileEvents([event({sourceId:'id\nBEGIN:VEVENT'})])[0]
  assert.ok(!unsafe.calendarUid.includes('\n'))
  assert.equal(ambiguous.identityCandidates.length,2)
  assert.notEqual(eventKey(ambiguous),eventKey(old))
})
test('merge tombstones prevent resurrection and converge in both directions', () => {
  const a={key:{note:'old',at:1}}, b={key:{deleted:true,at:2}}
  assert.deepEqual(mergeRecords(a,b),mergeRecords(b,a))
  assert.equal(mergeRecords(a,b).key.deleted,true)
  assert.equal(mergeRecords({key:{deleted:true,at:2}},{key:{note:'stale',at:2}}).key.deleted,true)
  const empty=()=>Object.fromEntries(collections.map(k=>[k,[]]))
  const left={...empty(),targets:[{id:'x',text:'old',at:1}]}
  const right={...empty(),deleted:{'targets:x':2}}
  assert.equal(mergeAdmin(left,right).targets.length,0)
  assert.equal(canonical(mergeAdmin(left,right)),canonical(mergeAdmin(right,left)))
  const p={id:'p1',name:'one',at:1,settings:{sheetId:'',demo:true}}
  assert.equal(mergeStores({activeId:'p1',profiles:[p]},{activeId:'',profiles:[],deletedProfiles:{p1:2}}).profiles.length,0)
  assert.equal(syncSettings({...p.settings,pushEnabled:true}).pushEnabled,undefined)
})
test('payload contracts reject unsafe settings and malformed collections', () => {
  const payload={store:{activeId:'p1',profiles:[{id:'p1',name:'one',settings:{demo:true,sheetId:'',gid:null}}]},meta:{p1:{}}}
  assert.doesNotThrow(()=>validatePayload(payload))
  assert.throws(()=>validatePayload({...payload,store:{...payload.store,profiles:[{...payload.store.profiles[0],settings:{demo:true,sheetId:'',pushServerBase:'javascript:alert(1)'}}]}}))
  assert.throws(()=>validatePayload({...payload,meta:{other:{}}}))
  assert.throws(()=>validatePayload({...payload,admin:{p1:{targets:'wrong'}}}))
})
test('sync object imports legacy ciphertext and rejects simultaneous stale revision without deleting KV', async () => {
  const records=new Map(); let chain=Promise.resolve()
  const tx={get:async key=>records.get(key),put:async(key,value)=>{records.set(key,value)}}
  const serial=work=>{const next=chain.then(work);chain=next.catch(()=>{});return next}
  const state={storage:{...tx,transaction:work=>serial(()=>work(tx))},blockConcurrencyWhile:work=>work()}
  const object=new SyncStore(state,{PUSH:{get:async()=>({blob:'legacy',at:1}),delete:()=>{throw Error('must not delete')}}})
  const id='a'.repeat(64),url='https://sync.test/sync-v2?id='+id
  const initial=await (await object.fetch(new Request(url))).json()
  assert.equal(initial.blob,'legacy');assert.equal(initial.revision,1)
  const post=blob=>object.fetch(new Request(url,{method:'POST',body:JSON.stringify({revision:1,blob})}))
  const results=await Promise.all([post('device-a'),post('device-b')])
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409])
  assert.equal((await (await object.fetch(new Request(url))).json()).revision,2)
})
test('calendar feed preserves existing UIDs for moved sessions and deadlines', async () => {
  const {default:worker}=await import('../../workers/ics-feed/worker.js')
  const originalFetch=globalThis.fetch,originalCaches=globalThis.caches
  const kv=new Map(),pending=[]
  const id='a'.repeat(24),kdid='b'.repeat(24)
  let moved=false
  const table=title=>({cols:[],rows:[['Title','Date','Start','End'],...(moved?[['','','','']]:[]),[title,moved?'10/09/2026':'07/09/2026','09:00','10:00']].map(row=>({c:row.map(v=>({v}))}))})
  globalThis.caches={default:{match:async()=>null,put:async()=>{}}}
  globalThis.fetch=async url=>new Response(JSON.stringify({table:table(String(url).includes(kdid)?'Deadline':'Teaching')}))
  const env={RATE:{get:async key=>kv.has(key)?JSON.parse(kv.get(key)):null,put:async(key,value)=>kv.set(key,value)}}
  const ctx={waitUntil:p=>pending.push(p)}
  try {
    const request=new Request(`https://calendar.test/?id=${id}&kdid=${kdid}`)
    const first=await (await worker.fetch(request,env,ctx)).text();await Promise.all(pending)
    moved=true
    const second=await (await worker.fetch(request,env,ctx)).text();await Promise.all(pending)
    const uids=text=>[...text.matchAll(/^UID:(.*)$/gm)].map(m=>m[1]).sort()
    assert.equal(uids(first).length,2);assert.deepEqual(uids(second),uids(first))
  } finally { globalThis.fetch=originalFetch;globalThis.caches=originalCaches }
})

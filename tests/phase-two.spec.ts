import { test, expect } from './fixtures'
import { build } from 'esbuild'
let library: string
test.beforeAll(async () => {
  const output = await build({stdin:{contents:`export * from './src/lib/storage'; export * from './src/lib/backup'; export * from './src/lib/attachments'; export * from './src/lib/recovery'; export * from './src/lib/admin'; export * from './src/lib/sync';`,resolveDir:process.cwd()},bundle:true,format:'iife',globalName:'phaseTwo',write:false})
  library=output.outputFiles[0].text
})
test('backup repeat import, rollback on storage failure, and profile owner isolation', async ({page}) => {
  await page.goto('./')
  await page.addScriptTag({content:library})
  const result = await page.evaluate(async () => {
    const api=(window as any).phaseTwo
    const store={activeId:'p1',profiles:[{id:'p1',name:'One',settings:{demo:true,specialismsChosen:true,sheetId:'',gid:null}},{id:'p2',name:'Two',settings:{demo:true,specialismsChosen:true,sheetId:'',gid:null}}]}
    localStorage.setItem('timetable.store.v2',JSON.stringify(store))
    api.saveMeta('p1',{old:{note:'keep me',at:1}})
    await api.addAttachment('photos',{owner:'p1|old',blob:new Blob(['image'],{type:'image/png'}),at:1})
    await api.addAttachment('wallet',{owner:'p2',blob:new Blob(['file'],{type:'text/plain'}),at:1,name:'two.txt',type:'text/plain',size:4})
    const backup=await api.exportBackup()
    await api.importBackup(backup); await api.importBackup(backup)
    const repeat=(await api.readAttachments('photos')).length
    const incoming=JSON.parse(backup);incoming.meta.p1.old.note='replace'
    const original=Storage.prototype.setItem;let failed=false
    Storage.prototype.setItem=function(key,value){if(key==='timetable.meta.v2.p1' && !failed){failed=true;throw new DOMException('Injected quota failure','QuotaExceededError')}original.call(this,key,value)}
    let error=''
    try {await api.importBackup(JSON.stringify(incoming))}catch(e){error=String(e)}finally{Storage.prototype.setItem=original}
    const restored=api.loadMeta('p1').old.note
    const journalFlag=localStorage.getItem('timetable.restore-pending.v1')
    await api.clearProfileData('p1')
    return {repeat,error,restored,journalFlag,photos:(await api.readAttachments('photos')).length,wallet:(await api.readAttachments('wallet')).length,deleted:JSON.parse(localStorage.getItem('timetable.store.v2')!).deletedProfiles.p1,backupVersion:JSON.parse(backup).version}
  })
  expect(result.repeat).toBe(1);expect(result.error).toContain('quota');expect(result.restored).toBe('keep me');expect(result.journalFlag).toBeNull()
  expect(result.photos).toBe(0);expect(result.wallet).toBe(1);expect(result.deleted).toBeGreaterThan(0);expect(result.backupVersion).toBe(4)
})
test('corrupt attachment leaves metadata and existing files untouched', async ({page}) => {
  await page.goto('./'); await page.addScriptTag({content:library})
  const result=await page.evaluate(async()=>{
    const api=(window as any).phaseTwo
    const store={activeId:'p1',profiles:[{id:'p1',name:'Old',settings:{demo:true,specialismsChosen:true,sheetId:'',gid:null}}]}
    localStorage.setItem('timetable.store.v2',JSON.stringify(store))
    const backup={version:4,store:{...store,profiles:[{...store.profiles[0],name:'Wrong'}]},photos:[{owner:'p1|key',at:1,data:'data:image/png;base64,%%%'}]}
    try{await api.importBackup(JSON.stringify(backup))}catch{}
    return api.loadStore().profiles[0].name
  })
  expect(result).toBe('Old')
})
test('interrupted recovery replays its journal on reload', async ({page}) => {
  await page.goto('./');await page.addScriptTag({content:library})
  await page.evaluate(async()=>{
    const api=(window as any).phaseTwo
    await api.addAttachment('photos',{owner:'p1|old',blob:new Blob(['keep'],{type:'image/png'}),at:1})
    const before={metadata:{'timetable.meta.v2.p1':JSON.stringify({key:{note:'before',at:1}})},photos:await api.readAttachments('photos'),wallet:[]}
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('timetable-recovery',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})
    await new Promise<void>((resolve,reject)=>{const t=db.transaction('journal','readwrite');t.objectStore('journal').put(before,'pending');t.oncomplete=()=>resolve();t.onabort=()=>reject(t.error)})
    db.close()
    localStorage.setItem('timetable.restore-pending.v1','1')
    localStorage.setItem('timetable.meta.v2.p1',JSON.stringify({key:{note:'partial import'}}))
    await api.replaceAttachments('photos',[])
  })
  await page.reload();await expect(page.getByRole('button',{name:/demo/i})).toBeVisible()
  await page.addScriptTag({content:library})
  const result=await page.evaluate(async()=>({note:(window as any).phaseTwo.loadMeta('p1').key.note,photos:(await (window as any).phaseTwo.readAttachments('photos')).length,flag:localStorage.getItem('timetable.restore-pending.v1')}))
  expect(result).toEqual({note:'before',photos:1,flag:null})
})
test('two devices merge concurrent PGCE edits, retain profiles, and keep deletion tombstones', async ({browser}) => {
  const contexts=await Promise.all([browser.newContext({serviceWorkers:'block'}),browser.newContext({serviceWorkers:'block'})])
  let remote:any={revision:0};let conflicts=0
  for(const context of contexts) await context.route('**/*',async route=>{
    const url=new URL(route.request().url())
    if(url.hostname==='sync.phase-two.test') {
      if(route.request().method()==='GET') return route.fulfill({json:remote})
      const body=route.request().postDataJSON()
      if(body.revision!==remote.revision){conflicts++;return route.fulfill({status:409,json:{error:'conflict'}})}
      remote={blob:body.blob,revision:remote.revision+1,at:Date.now()};return route.fulfill({json:remote})
    }
    if(['127.0.0.1','localhost'].includes(url.hostname)) return route.continue()
    return route.abort()
  })
  const pages=await Promise.all(contexts.map(c=>c.newPage()))
  const base=`http://127.0.0.1:4173/${process.env.VERCEL?'':'timetable-pwa/'}`
  for(const [index,page] of pages.entries()) {
    await page.goto(base);await page.addScriptTag({content:library})
    await page.evaluate(index=>{
      const api=(window as any).phaseTwo
      api.saveStore({activeId:'p1',profiles:[{id:'p1',name:'Shared',settings:{demo:true,specialismsChosen:true,sheetId:'',gid:null,pushEnabled:index===0}},{id:'extra'+index,name:'Extra',settings:{demo:true,specialismsChosen:true,sheetId:'',gid:null}}]})
      const admin=api.loadAdminFile('p1')
      api.saveAdminFile('p1',{...admin,reflections:[{id:'r'+index,weekISO:'2026-09-07',wentWell:'Device '+index,challenges:'',focus:'',standards:[],at:1}]})
      api.saveMeta('p1',{key:{note:'old',at:1}})
    },index)
  }
  await Promise.all(pages.map(page=>page.evaluate(()=> (window as any).phaseTwo.pushSync('https://sync.phase-two.test','ABCDEFGH'))))
  for(const page of pages) await page.evaluate(()=> (window as any).phaseTwo.pushSync('https://sync.phase-two.test','ABCDEFGH'))
  for(const page of pages) expect(await page.evaluate(()=> (window as any).phaseTwo.loadAdminFile('p1').reflections.length)).toBe(2)
  await pages[0].evaluate(async()=>{const api=(window as any).phaseTwo;api.saveMeta('p1',{});await api.pushSync('https://sync.phase-two.test','ABCDEFGH')})
  await pages[1].evaluate(()=> (window as any).phaseTwo.pushSync('https://sync.phase-two.test','ABCDEFGH'))
  for(const [index,page] of pages.entries()) {
    const result=await page.evaluate(()=>{const api=(window as any).phaseTwo;return {deleted:api.loadMeta('p1').key.deleted,profiles:api.loadStore().profiles.length,push:api.loadStore().profiles.find((p:any)=>p.id==='p1').settings.pushEnabled}})
    expect(result).toEqual({deleted:true,profiles:3,push:index===0})
  }
  expect(conflicts).toBeGreaterThan(0)
  await Promise.all(contexts.map(c=>c.close()))
})
test('legacy version 2 and 3 fixtures retain owners and import idempotently', async ({page})=>{
  await page.goto('./');await page.addScriptTag({content:library})
  const result=await page.evaluate(async()=>{
    const api=(window as any).phaseTwo
    const store={activeId:'p1',profiles:[{id:'p1',name:'Legacy',settings:{demo:true,specialismsChosen:true,sheetId:'',gid:null}}]}
    const photo={owner:'p1|2026-09-07|09:00|legacy',at:1,data:'data:image/png;base64,aGVsbG8='}
    const v2={version:2,store,meta:{p1:{'2026-09-07|09:00|legacy':{note:'legacy evidence',at:1}}},photos:[photo]}
    await api.importBackup(JSON.stringify(v2));await api.importBackup(JSON.stringify(v2))
    const v3={...v2,version:3,wallet:[{owner:'p1',name:'legacy.txt',type:'text/plain',at:2,data:'ZG9jdW1lbnQ='}]}
    await api.importBackup(JSON.stringify(v3));await api.importBackup(JSON.stringify(v3))
    return {photos:(await api.readAttachments('photos')).length,wallet:(await api.readAttachments('wallet')).length,note:api.loadMeta('p1')['2026-09-07|09:00|legacy'].note}
  })
  expect(result).toEqual({photos:1,wallet:1,note:'legacy evidence'})
})
test('PGCE-only writes emit a sync change and stale unrelated records are not restamped', async ({page})=>{
  await page.goto('./');await page.addScriptTag({content:library})
  const result=await page.evaluate(()=>{
    const api=(window as any).phaseTwo;let events=0
    window.addEventListener('timetable-data-changed',()=>events++)
    const initial={...api.loadAdminFile('p1'),reflections:[{id:'one',weekISO:'2026-09-07',wentWell:'one',challenges:'',focus:'',standards:[],at:1},{id:'two',weekISO:'2026-09-14',wentWell:'two',challenges:'',focus:'',standards:[],at:1}]}
    api.saveAdminFile('p1',initial)
    const before=api.loadAdminFile('p1').reflections.find((r:any)=>r.id==='two').at
    api.saveAdminFile('p1',{...initial,reflections:initial.reflections.map((r:any)=>r.id==='one'?{...r,wentWell:'changed'}:r)})
    const after=api.loadAdminFile('p1').reflections.find((r:any)=>r.id==='two').at
    return {events,before,after}
  })
  expect(result.events).toBe(2);expect(result.after).toBe(result.before)
})

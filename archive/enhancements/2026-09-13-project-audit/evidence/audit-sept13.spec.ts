import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'

/**
 * G3 (Pass 72) — evidence examples over referenced records, review packs
 * that pin snapshots (old pack readable after the source edits, missing
 * attachments shown, export text == preview), the experience ledger by layer
 * with no double counting and comparisons only against confirmed
 * requirements, review records and a handover pack without private notes.
 */

test.use({ timezoneId: 'Europe/London' })

const session = (id: string, title: string, dateISO: string, day: string) => ({ id, title, day, dateISO, start: '08:30', end: '15:30', room: '', groups: '', tutor: '', subject: '', isSpecialism: false, isSelfStudy: false, isOptional: false })
const SESSIONS = [session('a1', 'School Experience SE1a', '2026-09-14', 'Mon'), session('a2', 'School Experience SE1a', '2026-09-15', 'Tue')]
const base = () => ({
  reflections: [{ id: 'r1', weekISO: '2026-09-07', wentWell: 'Routines', challenges: '', focus: '', standards: [], at: 1 }], targets: [], meetings: [{ id: 'm1', dateISO: '2026-09-14', discussed: 'Targets', actions: [], at: 1 }],
  observations: [{ id: 'o1', dateISO: '2026-09-14', observer: 'A Mentor', subject: 'Maths', focus: '', strengths: 'Clear modelling', development: 'Wait time', sourceType: 'learner-entered', at: 1 }],
  lessons: [{ id: 'l1', dateISO: '2026-09-14', classGroup: 'Y2', subject: 'Maths — number bonds', evaluation: 'Went well', standards: ['TS4'], at: 10 }],
  audits: [], tasks: [], exceptions: [], plans: [], commitments: [],
  placements: [{ id: 'pl-se1', code: 'SE1', schoolLocationId: 'sch-1', startISO: '2026-09-07', endISO: '2026-12-11', mappedBlockTags: ['SE1A'], mentorName: 'A Mentor', mentorContact: 'mentor@school.example', at: 10 }],
  schools: [{ id: 'sch-1', name: 'Riverside Primary', address: '1 River Lane', lat: 51.53, lng: -0.11, confirmedAt: 5, at: 10 }],
  programmes: [], packs: [], requirements: [{ id: 'pk:days', packId: 'pk', section: 'School experience', title: 'Assessed school days', plannedValue: '120 days', verification: 'unconfirmed', at: 1 }], milestones: [], cycles: [], preps: [],
  goals: [], resources: [], projects: [], readings: [], contacts: [{ id: 'c1', name: 'Wellbeing adviser', contact: 'wb@uni.example', at: 1 }], questions: [], protected: [], supportNotes: [{ id: 'agenda', text: 'PRIVATE agenda', at: 1 }],
  examples: [], reviewPacks: [], experience: [], reviews: [],
})

async function seed(page: Page, admin: Record<string, unknown> = base()) {
  await page.clock.install({ time: new Date('2026-09-14T06:05:00Z') })
  await page.addInitScript(
    ({ SESSIONS, admin }) => {
      localStorage.setItem('timetable.whatsnew.v1', '99')
      if (localStorage.getItem('timetable.store.v2')) return
      localStorage.setItem('timetable.store.v2', JSON.stringify({ activeId: 'fx', profiles: [{ id: 'fx', name: 'My timetable', settings: { demo: false, sheetId: 'FIXTURESHEET-FIXTURESHEET-FIXTURESHEET-0001', gid: null, specialismsChosen: true, checklistDismissed: true, usagePing: false } }] }))
      localStorage.setItem('timetable.cache.v2.fx', JSON.stringify({ fetchedAt: Date.now(), sessions: SESSIONS }))
      localStorage.setItem('timetable.admin.v1.fx', JSON.stringify(admin))
    },
    { SESSIONS, admin }
  )
  await page.setViewportSize({ width: 390, height: 844 })
}
const admin = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('timetable.admin.v1.fx') ?? '{}'))


test('audit: failed mentor listing stays in loading state', async ({ page }) => {
  await seed(page)
  await page.addInitScript(() => {
    const s=JSON.parse(localStorage.getItem('timetable.store.v2')!); Object.assign(s.profiles[0].settings,{mentorSpaceId:'a'.repeat(24),mentorOwnerToken:'b'.repeat(48)}); localStorage.setItem('timetable.store.v2',JSON.stringify(s))
  })
  await page.route('**/mentor/mentors', r=>r.fulfill({status:503,contentType:'application/json',body:'{}'}))
  await page.goto('./#/pgce')
  await page.getByRole('button',{name:/^Review packs/}).click()
  await page.getByLabel('Pack title').fill('Audit review')
  await page.getByRole('button',{name:'Create pack'}).click()
  await expect(page.getByText('Loading your mentors…')).toBeVisible()
  await page.screenshot({path:'../handoff/visuals/before-review-pack.png',fullPage:true})
})
test('audit: selection carries across packs', async ({ page }) => {
  await seed(page)
  await page.goto('./#/pgce')
  await page.getByRole('button',{name:/^Review packs/}).click()
  for(const title of ['Pack A','Pack B']) { await page.getByLabel('Pack title').fill(title); await page.getByRole('button',{name:'Create pack'}).click() }
  await page.getByRole('checkbox',{name:/Lesson · .*number bonds/}).check()
  await page.getByRole('button',{name:/Pack A ·/}).click()
  await expect(page.getByRole('checkbox',{name:/Lesson · .*number bonds/})).toBeChecked()
  await page.getByRole('button',{name:'Pin selection (1)'}).click()
  const data=await admin(page)
  expect(data.reviewPacks.find((p:any)=>p.title==='Pack A').items).toHaveLength(1)
})
test('audit: portal network failure leaves sign-in disabled', async ({ page }) => {
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
  await page.route('**/mentor/login',r=>r.abort())
  await page.goto('./mentor.html#/space/'+ 'a'.repeat(24)+'/mt0123456789ab')
  await page.getByLabel('Passphrase',{exact:true}).fill('example passphrase')
  await page.getByRole('button',{name:'Sign in',exact:true}).click()
  await expect.poll(()=>errors.length).toBeGreaterThan(0)
  await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeDisabled()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.screenshot({path:'../handoff/visuals/before-mentor-error.png',fullPage:true})
})
test('audit: current UI captures and width evidence', async ({ page }) => {
  await seed(page)
  for(const route of ['today','schedule','tasks','pgce']){
    await page.goto('./#/'+route)
    await page.screenshot({path:'../handoff/visuals/before-'+route+'.png',fullPage:true})
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  }
  await page.setViewportSize({width:320,height:740});await page.goto('./#/pgce')
  await page.screenshot({path:'../handoff/visuals/before-pgce-320.png',fullPage:true})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})
test('audit: pack B uploads attachment selected in pack A', async ({page})=>{
 const file:any=base();file.reviewPacks=[{id:'packA',title:'Pack A',state:'selected',createdISO:'2026-09-14',items:[],attachments:[{id:'1',name:'Private A.txt',state:'local-only'}],at:1},{id:'packB',title:'Pack B',state:'selected',createdISO:'2026-09-14',items:[],attachments:[],at:1}]
 await seed(page,file)
 await page.addInitScript(()=>{const s=JSON.parse(localStorage.getItem('timetable.store.v2')!);Object.assign(s.profiles[0].settings,{mentorSpaceId:'a'.repeat(24),mentorOwnerToken:'b'.repeat(48)});localStorage.setItem('timetable.store.v2',JSON.stringify(s))})
 await page.route('**/mentor/mentors',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({mentors:[{id:'mt0123456789ab',name:'Synthetic mentor',revokedAt:null}],packs:[],invites:[]})}))
 let sent:any=null
 await page.route('**/mentor/share',r=>{sent=r.request().postDataJSON();return r.fulfill({contentType:'application/json',body:'{"sharedAt":1,"attachments":1}'})})
 await page.goto('./#/pgce')
 await page.evaluate(()=>new Promise<void>((resolve,reject)=>{const r=indexedDB.open('timetable-wallet',1);r.onupgradeneeded=()=>{r.result.createObjectStore('files',{keyPath:'id',autoIncrement:true}).createIndex('owner','owner')};r.onerror=()=>reject(r.error);r.onsuccess=()=>{const tx=r.result.transaction('files','readwrite');tx.objectStore('files').put({id:1,uid:'synthetic-a',owner:'fx',name:'Private A.txt',blob:new Blob(['synthetic private A']),at:1});tx.oncomplete=()=>{r.result.close();resolve()}}}))
 await page.getByRole('button',{name:/^Review packs/}).click()
 await page.getByRole('checkbox',{name:'Synthetic mentor',exact:true}).check()
 await page.getByRole('list',{name:'Attachments to share',exact:true}).getByRole('checkbox').check()
 await page.getByRole('button',{name:/Pack B ·/}).click()
 await expect(page.getByRole('list',{name:'Attachments to share',exact:true})).toHaveCount(0)
 await page.getByRole('button',{name:'Share pack',exact:true}).click()
 await expect.poll(()=>sent?.pack?.id).toBe('packB')
 expect(sent.attachments[0].name).toBe('Private A.txt')
 await page.screenshot({path:'../handoff/visuals/before-pack-viewport.png'})
})

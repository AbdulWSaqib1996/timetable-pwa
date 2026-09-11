import { test, expect } from './fixtures'
import {mockStats} from './admin-fixtures'
import {writeFileSync} from 'node:fs'
const out='../handoff/evidence'
test.use({timezoneId:'Europe/London'})
async function seed(page:any){
 await page.clock.install({time:new Date('2026-09-07T07:15:00Z')})
 await page.addInitScript(()=>{
 localStorage.setItem('timetable.whatsnew.v1','99')
 const settings={demo:true,sheetId:'',gid:null,specialismsChosen:true,checklistDismissed:true,usagePing:false,theme:'light',homeAddress:'1 Example Street, London N1',homeLat:51.55,homeLng:-0.1,locationEnabled:true,customKeyDates:[{id:'a',title:'Assessment essay draft',dateISO:'2026-09-05'},{id:'b',title:'Reading log',dateISO:'2026-09-10',start:'17:00'},{id:'c',title:'Completed admin form',dateISO:'2026-09-06'}]}
 localStorage.setItem('timetable.store.v2',JSON.stringify({activeId:'fx',profiles:[{id:'fx',name:'Demo timetable',settings}]}))
 localStorage.setItem('timetable.meta.v2.fx',JSON.stringify({'2026-09-06||completed admin form':{status:'done',at:1}}))
 })
}
test('capture current learner screens and measurements',async({page})=>{
 await seed(page);const metrics:any[]=[]
 async function shot(name:string){
 await page.waitForTimeout(350)
 await page.screenshot({path:`${out}/before-${name}.png`})
 metrics.push({name,...await page.evaluate(()=>({overflow:document.documentElement.scrollWidth-innerWidth,smallButtons:[...document.querySelectorAll('button')].filter(b=>{const r=b.getBoundingClientRect();return r.width>0&&r.height>0&&r.top<innerHeight&&r.bottom>0&&r.height<40}).map(b=>({text:b.textContent?.trim()||b.getAttribute('aria-label'),height:Math.round(b.getBoundingClientRect().height)})),smallText:[...document.querySelectorAll('h1,h2,h3,p,.week-event,.filter-hint')].filter(e=>parseFloat(getComputedStyle(e).fontSize)<14&&e.getBoundingClientRect().width>0).slice(0,20).map(e=>({text:e.textContent?.slice(0,90),size:getComputedStyle(e).fontSize}))}))})
 }
 await page.setViewportSize({width:390,height:900})
 for(const route of ['today','schedule','tasks','pgce','settings','settings/data','settings/reminders','find']){await page.goto('./#/'+route);await shot(route.replaceAll('/','-'))}
 await page.goto('./#/today');await page.locator('.today-hero').getByRole('button',{name:'Session details'}).click();await shot('session');await page.getByRole('tab',{name:'Travel & map'}).click();await shot('travel')
 await page.goto('./#/home');await shot('home')
 await page.setViewportSize({width:1440,height:900});await page.goto('./#/schedule');await shot('schedule-desktop')
 await page.goto('./#/pgce');await shot('pgce-desktop')
 await page.setViewportSize({width:390,height:900});await page.goto('./#/settings');await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('timetable.store.v2')!);s.profiles[0].settings.theme='dark';localStorage.setItem('timetable.store.v2',JSON.stringify(s))});
 // init script reseeds on reload; set theme through the UI is covered by existing theme regressions.
 writeFileSync(`${out}/ui-measurements.json`,JSON.stringify(metrics,null,2))
})
test('capture current admin with synthetic metrics',async({page,context})=>{
 await mockStats(context);await page.setViewportSize({width:1440,height:900});await page.goto('./analytics.html');await page.getByLabel('Owner key').fill('synthetic-audit-key');await page.getByRole('button',{name:'Unlock'}).click();await page.waitForTimeout(400);await page.screenshot({path:`${out}/before-admin.png`})
 await page.setViewportSize({width:390,height:900});await page.screenshot({path:`${out}/before-admin-mobile.png`})
})

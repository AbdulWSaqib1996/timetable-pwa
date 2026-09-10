import {test,expect} from './fixtures'
const settings={demo:true,sheetId:'',gid:null,specialismsChosen:true,checklistDismissed:true,usagePing:false,attendancePrompts:true}
async function seed(page:any){
 await page.clock.install({time:new Date('2026-09-07T15:40:00Z')})
 await page.addInitScript((settings:any)=>{
 localStorage.setItem('timetable.whatsnew.v1','99');
 localStorage.setItem('timetable.store.v2',JSON.stringify({activeId:'audit',profiles:[{id:'audit',name:'Demo learner',settings}]}));
 Object.assign(window,{auditNotifications:[]});Object.defineProperty(window,'Notification',{configurable:true,value:class{static permission='granted';constructor(t:string){(window as any).auditNotifications.push(t)}}});
 },settings)
}
test('Current UI evidence',async({page})=>{
 await seed(page)
 for(const width of [390,1440]){
 await page.setViewportSize({width,height:900})
 for(const route of ['today','schedule','tasks','pgce','settings','settings/data','find']){
 await page.goto('./#/'+route);await page.waitForTimeout(250)
 await page.screenshot({path:`../evidence/${width}-${route.replaceAll('/','-')}.png`,fullPage:true})
 }
 }
})
test.describe('foreign device zone',()=>{
 test.use({timezoneId:'America/New_York'})
 test('reproduces missing foreground prompt while course-clock card is present',async({page})=>{
 await seed(page);await page.goto('./#/today');await page.clock.runFor(35000)
 await expect(page.getByRole('region',{name:'Attendance prompt'})).toContainText('Maths 1')
 expect(await page.evaluate(()=>(window as any).auditNotifications)).not.toContain('Did you attend Maths 1?')
 })
})
test('invalid backup export correctly stays disabled',async({page})=>{
 await seed(page);await page.goto('./#/settings/data')
 await page.evaluate(()=>localStorage.setItem('timetable.meta.v2.audit',JSON.stringify({'2026-09-07|14:30|maths 1':{note:42,at:1}})))
 await page.getByRole('button',{name:'Back up… (preview first)'}).click()
 const sheet=page.getByRole('dialog',{name:'Back up'})
 await expect(sheet.getByRole('alert')).toBeVisible()
 await expect(sheet.getByRole('button',{name:'Generate backup',exact:true})).toBeDisabled()
 await page.screenshot({path:'../evidence/backup-invalid-blocked.png',fullPage:true})
})

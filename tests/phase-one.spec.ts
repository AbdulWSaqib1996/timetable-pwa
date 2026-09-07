import { test, expect } from './fixtures'

test('overdue personal deadlines remain visible and completed tasks do not notify',async ({page})=>{
  await page.clock.install({time:new Date('2026-09-07T08:15:00Z')})
  await page.addInitScript(()=>{
    localStorage.setItem('timetable.whatsnew.v1','6')
    localStorage.setItem('timetable.store.v2',JSON.stringify({activeId:'fixture',profiles:[{id:'fixture',name:'Fixture',settings:{demo:true,specialismsChosen:true,checklistDismissed:true,usagePing:false,keyDateReminderDays:[7],customKeyDates:[
      {id:'late',title:'Overdue essay',dateISO:'2026-09-06'},
      {id:'done',title:'Submitted essay',dateISO:'2026-09-08',start:'17:00'},
      {id:'next',title:'Upcoming essay',dateISO:'2026-09-09'},
      {id:'past-done',title:'Old submitted essay',dateISO:'2026-09-05'},
    ]}}]}))
    localStorage.setItem('timetable.meta.v2.fixture',JSON.stringify({'2026-09-08|17:00|submitted essay':{status:'done'},'2026-09-05||old submitted essay':{status:'done'}}))
    const received:string[]=[]
    Object.assign(window,{received})
    Object.defineProperty(window,'Notification',{value:class{static permission='granted';constructor(title:string){received.push(title)}}})
  })
  await page.goto('./')
  await expect(page.locator('.keydate-strip')).toContainText('Overdue essay')
  await expect(page.locator('.keydate-strip')).toContainText('1d overdue')
  // Phase 4: deadlines live in the Tasks destination (Overdue/Upcoming/Completed).
  await page.getByRole('button',{name:'Tasks',exact:true}).click()
  await expect(page.getByText('1 overdue deadline still outstanding.')).toBeVisible()
  const overdueGroup=page.getByRole('region',{name:'Overdue tasks'})
  await expect(overdueGroup).toContainText('Overdue essay')
  const upcomingGroup=page.getByRole('region',{name:'Upcoming tasks'})
  await expect(upcomingGroup).toContainText('Upcoming essay')
  await expect(upcomingGroup).not.toContainText('Submitted essay')
  // Completed records stay retrievable behind their own group.
  await page.locator('.completed-tasks summary').click()
  await expect(page.locator('.completed-tasks')).toContainText('Submitted essay')
  await expect(page.locator('.completed-tasks')).toContainText('Old submitted essay')
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {received:string[]}).received)).toEqual(['📌 Upcoming essay'])
  const upcoming=page.locator('.keydates-list li').filter({hasText:'Upcoming essay'}).first()
  await upcoming.getByTitle('Cycle status').click()
  await upcoming.getByTitle('Cycle status').click()
  // Simulate another reminder offset becoming due: completed work stays suppressed.
  await page.evaluate(()=>localStorage.removeItem('timetable.notified.v2'))
  await page.clock.runFor(30_000)
  expect(await page.evaluate(()=>(window as unknown as {received:string[]}).received)).toEqual(['📌 Upcoming essay'])
})

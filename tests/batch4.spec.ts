import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'

/**
 * Placement review Batch 4 (Pass 89) in the browser: homework with an effort
 * estimate is planned by the workload planner as itself — accepted blocks
 * belong to the homework, never a duplicate task, and a block done is not the
 * homework done (NF-02); a moved due session appears in the Tasks inbox once
 * and is decided there at most once, with the study blocks named (NF-04); a
 * session's preparation checklist and ready statement, mirrored on Today
 * (NF-03); resources on homework and a placement by wallet uid, listed as
 * On this device / Missing (NF-05); a transition item "not known yet" with a
 * follow-up date that never blocks readiness (NF-01).
 */

test.use({ timezoneId: 'Europe/London' })

const session = (id: string, title: string, dateISO: string, day: string, start = '09:00', end = '11:00', extra: Record<string, unknown> = {}) => ({ id, title, day, dateISO, start, end, room: 'B12', groups: '1', tutor: 'A Tutor', subject: title, isSpecialism: false, isSelfStudy: false, isOptional: false, eventKey: `event:${id}`, ...extra })
const SESSIONS = [
  session('m1', 'Maths 1', '2026-09-16', 'Wed'),
  session('m2', 'Maths 2', '2026-09-23', 'Wed'),
  session('a1', 'School Experience SE1a', '2026-09-17', 'Thu', '08:30', '15:30'),
]
const HW = { id: 'h1', title: 'Read chapter 3', details: 'Pages 10–20', setSessionRef: 'event:m1', sourceSnapshot: { dateISO: '2026-09-16', start: '09:00', title: 'Maths 1', at: 1 }, setISO: '2026-09-16', dueMode: 'session', dueSessionRef: 'event:m2', dueTitle: 'Maths 2', dueSnapshot: { dateISO: '2026-09-23', start: '09:00', title: 'Maths 2', at: 1 }, dueISO: '2026-09-23', status: 'todo', effortMins: 90, at: 1 }
const SE1 = { id: 'pl-se1', code: 'SE1', schoolLocationId: 'sch-1', startISO: '2026-09-07', endISO: '2026-12-11', mappedBlockTags: ['SE1A'], mentorName: 'A Mentor', at: 10 }
const SE2 = { id: 'pl-se2', code: 'SE2', schoolLocationId: 'sch-2', startISO: '2027-01-11', endISO: '2027-03-26', mappedBlockTags: ['SE2A'], mentorName: 'B Mentor', at: 10 }
const SCHOOL1 = { id: 'sch-1', name: 'Riverside Primary', address: '1 River Lane', lat: 51.53, lng: -0.11, confirmedAt: 5, at: 10 }
const SCHOOL2 = { id: 'sch-2', name: 'Oak Academy', address: '2 Oak Road', lat: 51.44, lng: -0.19, confirmedAt: 5, at: 10 }
const base = () => ({
  reflections: [], targets: [], meetings: [], observations: [], audits: [], tasks: [], exceptions: [], plans: [], commitments: [], programmes: [], packs: [], requirements: [], milestones: [], cycles: [], preps: [], goals: [], resources: [], projects: [], readings: [], contacts: [], questions: [], protected: [], supportNotes: [], examples: [], reviewPacks: [], experience: [], reviews: [], lessons: [],
  homework: [HW],
  placements: [SE1, SE2],
  schools: [SCHOOL1, SCHOOL2],
})

async function seed(page: Page, admin: Record<string, unknown> = base()) {
  await page.clock.install({ time: new Date('2026-09-16T06:05:00Z') })
  await page.addInitScript(
    ({ SESSIONS, admin }) => {
      localStorage.setItem('timetable.whatsnew.v1', '99')
      if (localStorage.getItem('timetable.store.v2')) return
      localStorage.setItem('timetable.store.v2', JSON.stringify({ activeId: 'fx', profiles: [{ id: 'fx', name: 'My timetable', settings: { demo: false, sheetId: 'FIXTURESHEET-FIXTURESHEET-FIXTURESHEET-0001', gid: null, specialismsChosen: true, checklistDismissed: true, usagePing: false, placementReviewSeen: true, homeLat: 51.55, homeLng: -0.1, homeAddress: '1 Example Street', placementHours: { start: '08:30', end: '16:00' } } }] }))
      localStorage.setItem('timetable.cache.v2.fx', JSON.stringify({ fetchedAt: Date.now(), sessions: SESSIONS }))
      localStorage.setItem('timetable.admin.v1.fx', JSON.stringify(admin))
    },
    { SESSIONS, admin }
  )
  await page.setViewportSize({ width: 390, height: 844 })
}
const readAdmin = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('timetable.admin.v1.fx')!))
const seedWallet = (page: Page, entries: { uid: string; name: string }[]) =>
  page.evaluate(
    (entries) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('timetable-wallet', 1)
        req.onupgradeneeded = () => {
          const s = req.result.createObjectStore('files', { keyPath: 'id', autoIncrement: true })
          s.createIndex('owner', 'owner')
        }
        req.onsuccess = () => {
          const tx = req.result.transaction('files', 'readwrite')
          for (const e of entries) tx.objectStore('files').put({ owner: 'fx', name: e.name, type: 'application/pdf', size: 3, blob: new Blob(['abc'], { type: 'application/pdf' }), at: Date.now(), uid: e.uid })
          tx.oncomplete = () => { req.result.close(); resolve() }
          tx.onerror = () => reject(tx.error)
        }
        req.onerror = () => reject(req.error)
      }),
    entries
  )

test('NF-02: homework with an effort estimate is planned as itself — blocks belong to the homework, no task is created, and a finished block is not the homework done', async ({ page }) => {
  await seed(page)
  await page.goto('./#/homework/h1')
  await expect(page.getByRole('heading', { name: 'Read chapter 3' })).toBeVisible()
  await expect(page.getByLabel('Effort (minutes)', { exact: true })).toHaveValue('90')
  await page.getByLabel('Subtask', { exact: true }).fill('Make notes')
  await page.getByLabel('Subtask effort (minutes)').fill('30')
  await page.getByRole('button', { name: 'Add subtask' }).click()
  await expect(page.getByRole('list', { name: 'Homework subtasks' })).toContainText('Make notes · 30 min')
  await page.getByRole('button', { name: 'Review study times' }).click()
  const sheet = page.getByRole('dialog', { name: 'Workload & support' })
  await expect(sheet.getByLabel('Workload summary')).toContainText('2 h across 1 open item — tasks and homework')
  const proposals = sheet.getByRole('list', { name: 'Proposed blocks' })
  await expect(proposals.getByRole('listitem').first()).toContainText('Homework: Read chapter 3')
  await sheet.getByRole('button', { name: /Accept \d+ proposals?/ }).click()
  let a = await readAdmin(page)
  const blocks = a.plans.filter((p: { kind: string }) => p.kind === 'block')
  expect(blocks.length).toBeGreaterThan(0)
  expect(blocks.every((b: { parentId: string; parentKind: string }) => b.parentId === 'h1' && b.parentKind === 'homework')).toBe(true)
  expect(blocks.reduce((n: number, b: { effortMins: number }) => n + b.effortMins, 0)).toBe(120)
  expect(a.tasks).toHaveLength(0)
  expect(a.homework[0].status).toBe('todo')
  await expect(sheet).toContainText('Nothing to propose')
  await sheet.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByRole('list', { name: 'Study blocks' }).getByRole('listitem')).toHaveCount(blocks.length)
  // The blocks are on the Schedule as study blocks of the homework.
  await page.goto('./#/schedule')
  await page.getByRole('option', { name: new RegExp(blocks[0].dateISO === '2026-09-16' ? 'Wednesday 16 September' : 'Thursday 17 September') }).click()
  await expect(page.locator('.day-list')).toContainText('Read chapter 3')
})

test('NF-04: a moved due session raises one inbox item with its study blocks; deciding it once follows the session and the item closes', async ({ page }) => {
  // Nothing changed: no inbox.
  const a = base()
  a.plans = [{ id: 'blk', parentId: 'h1', parentKind: 'homework', kind: 'block', title: 'Homework: Read chapter 3', dateISO: '2026-09-21', startTime: '17:00', endTime: '18:00', effortMins: 60, at: 1 }] as never[]
  await seed(page, a)
  await page.goto('./#/tasks')
  await expect(page.getByRole('region', { name: 'Upcoming tasks' })).toContainText('Read chapter 3')
  expect((await readAdmin(page)).homeworkChanges ?? []).toHaveLength(0)
  await expect(page.locator('.homework-inbox')).toHaveCount(0)
  // The sheet moves Maths 2 to the Thursday (a fresh cache, as a refetch would leave it), and the app opens on it.
  await page.evaluate(() => {
    const c = JSON.parse(localStorage.getItem('timetable.cache.v2.fx')!)
    const t = c.sessions.find((s: { id: string }) => s.id === 'm2')
    t.dateISO = '2026-09-24'
    t.day = 'Thu'
    localStorage.setItem('timetable.cache.v2.fx', JSON.stringify(c))
  })
  await page.goto('about:blank')
  await page.goto('./#/tasks')
  const inbox = page.locator('.homework-inbox')
  await expect(inbox).toBeVisible()
  const row = inbox.getByRole('list', { name: 'Homework changes' }).getByRole('listitem')
  await expect(row).toHaveCount(1)
  await expect(row).toContainText('Maths 2 moved: Wed, 23 Sept 2026 09:00 → Thu, 24 Sept 2026 09:00')
  await expect(row).toContainText('1 study block planned against it')
  let f = await readAdmin(page)
  expect(f.homeworkChanges).toHaveLength(1)
  expect(f.homeworkChanges[0]).toMatchObject({ homeworkId: 'h1', kind: 'moved' })
  expect(f.homeworkChanges[0].decidedAt).toBeUndefined()
  // Reloading raises nothing new.
  await page.reload()
  f = await readAdmin(page)
  expect(f.homeworkChanges).toHaveLength(1)
  await row.getByRole('button', { name: 'Follow this session' }).click()
  await expect(inbox).toHaveCount(0)
  f = await readAdmin(page)
  expect(f.homework[0].dueISO).toBe('2026-09-24')
  expect(f.homeworkChanges[0]).toMatchObject({ decision: 'follow' })
  expect(f.homeworkChanges[0].decidedAt).toBeGreaterThan(0)
  await expect(page.locator('.task-card').filter({ hasText: 'Read chapter 3' })).toContainText('Thu, 24 Sept 2026')
  // The homework page keeps the history of both kinds.
  await page.goto('./#/homework/h1')
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await page.getByRole('button', { name: 'To do' }).click()
  await expect(page.getByRole('list', { name: 'Status history' })).toContainText('Reopened')
})

test('NF-03: a session keeps the learner’s preparation — items, a ready statement, a follow-up note — and Today shows it for the next session', async ({ page }) => {
  // The homework is due at today's Maths 1 so the Today hero carries both the checklist and the due count.
  const a = base()
  a.homework = [{ ...HW, dueSessionRef: 'event:m1', dueTitle: 'Maths 1', dueISO: '2026-09-16', dueSnapshot: { dateISO: '2026-09-16', start: '09:00', title: 'Maths 1', at: 1 } }]
  await seed(page, a)
  await page.goto('./#/schedule')
  await page.getByRole('option', { name: /Wednesday 16 September/ }).click()
  await page.locator('.day-list .session-card').filter({ hasText: 'Maths 1' }).click()
  const prep = page.locator('section[aria-labelledby="detail-prep-heading"]')
  await expect(prep).toContainText('1 homework due here (see the Homework section)')
  await prep.getByLabel('New preparation item').fill('Bring the reading')
  await prep.getByRole('button', { name: 'Add item' }).click()
  await prep.getByLabel('New preparation item').fill('Charge the laptop')
  await prep.getByRole('button', { name: 'Add item' }).click()
  const items = prep.getByRole('list', { name: 'Preparation items' })
  await expect(items.getByRole('checkbox')).toHaveCount(2)
  await items.getByRole('checkbox').first().check()
  await prep.getByRole('checkbox', { name: /Ready for this session/ }).check()
  await prep.getByLabel('Follow-up after the session').fill('New homework set: chapter 4')
  await prep.getByLabel('Follow-up after the session').blur()
  const f = await readAdmin(page)
  expect(f.preparations).toHaveLength(1)
  expect(f.preparations[0]).toMatchObject({ sessionRef: 'event:m1', followUp: 'New homework set: chapter 4' })
  expect(f.preparations[0].items.map((i: { done: boolean }) => i.done)).toEqual([true, false])
  expect(f.preparations[0].readyAt).toBeGreaterThan(0)
  expect(f.homework[0].status).toBe('todo')
  // Today: Maths 1 is the next session; its hero carries the preparation line.
  await page.goto('./#/today')
  await expect(page.getByRole('region', { name: 'Next session' })).toContainText('Maths 1')
  await expect(page.getByRole('button', { name: /Preparation for this session: 1 of 2 items done, 1 homework due, you said you are ready/ })).toBeVisible()
})

test('NF-05 + NF-01: resources by wallet uid on homework and a placement (present or missing), and a transition item deferred with a follow-up date', async ({ page }) => {
  await seed(page)
  await page.goto('./#/today')
  await seedWallet(page, [{ uid: 'u-handbook', name: 'handbook.pdf' }])
  await page.goto('./#/homework/h1')
  const hwRes = page.locator('.resource-links').first()
  await hwRes.getByLabel('Homework resources: document').selectOption('u-handbook')
  await hwRes.getByLabel('Homework resources: label').fill('Worksheet')
  await hwRes.getByRole('button', { name: 'Add resource' }).click()
  await expect(page.getByRole('list', { name: 'Homework resources' })).toContainText('Worksheet · handbook.pdf')
  await expect(page.getByRole('list', { name: 'Homework resources' })).toContainText('On this device')
  await page.goto('./#/placement/pl-se2')
  const plRes = page.locator('.placement-resources .resource-links')
  await plRes.getByLabel('Placement resources: kind').selectOption('link')
  await plRes.getByLabel('Placement resources: link').fill('https://school.example/handbook')
  await plRes.getByLabel('Placement resources: label').fill('Handbook')
  await plRes.getByRole('button', { name: 'Add resource' }).click()
  await plRes.getByLabel('Placement resources: kind').selectOption('wallet')
  await plRes.getByLabel('Placement resources: document').selectOption('u-handbook')
  await plRes.getByLabel('Placement resources: label').fill('Entrance instructions')
  await plRes.getByRole('button', { name: 'Add resource' }).click()
  await expect(page.getByRole('list', { name: 'Placement resources' }).getByRole('listitem')).toHaveCount(2)
  let a = await readAdmin(page)
  expect(a.homework[0].resources[0]).toMatchObject({ kind: 'wallet', uid: 'u-handbook', label: 'Worksheet' })
  expect(a.placements.find((p: { id: string }) => p.id === 'pl-se2').resources).toHaveLength(2)
  expect(a.placements.find((p: { id: string }) => p.id === 'pl-se1').resources).toBeUndefined()
  // The transition checklist counts the resources; another item can be "not known yet" with a follow-up.
  await page.goto('./#/placement/pl-se2/prepare')
  const context = page.getByRole('list', { name: 'Teaching context' })
  await expect(context.locator('li').filter({ hasText: 'School resources to hand' })).toContainText('2 resources on the placement')
  const ctxItem = context.locator('li').filter({ hasText: 'Teaching context noted' })
  await ctxItem.getByLabel(/Follow up on: Teaching context noted/).fill('2027-01-04')
  await ctxItem.getByRole('button', { name: 'Not known yet' }).click()
  await expect(ctxItem).toContainText('Not known yet — follow up 2027-01-04')
  await expect(page.getByLabel('Checklist progress')).toContainText('1 not known yet')
  a = await readAdmin(page)
  expect(a.transitions[0].deferred['context-noted']).toMatchObject({ followUpISO: '2027-01-04' })
  await ctxItem.getByRole('button', { name: 'I know this now' }).click()
  await expect(ctxItem).toContainText('To do')
  // The wallet file goes: the homework resource reads missing and the data centre offers to relink it.
  await page.evaluate(() => new Promise<void>((resolve) => { const req = indexedDB.open('timetable-wallet', 1); req.onsuccess = () => { const tx = req.result.transaction('files', 'readwrite'); tx.objectStore('files').clear(); tx.oncomplete = () => { req.result.close(); resolve() } } }))
  await page.goto('./#/homework/h1')
  await expect(page.getByRole('list', { name: 'Homework resources' })).toContainText('Missing on this device')
  await page.goto('./#/settings/data')
  await page.getByRole('button', { name: 'Review details' }).click()
  await expect(page.getByRole('list', { name: 'Missing files' })).toContainText('homework resource “Read chapter 3”')
  await expect(page.getByRole('list', { name: 'Missing files' })).toContainText('placement resource “SE2”')
})

import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'

/**
 * G1b (Pass 70) — PG-02 lesson workbench and PG-03 practice & mentor
 * preparation, on the audit's §17.1 fixture up to "next attempt": plan (with a
 * template and a new focus) → rehearsal block on the Schedule → teach (large
 * type, pins the plan revision, sets NO attendance) → learner-entered feedback
 * with its provenance label → next attempt as a new identity without outcomes
 * — all while offline after load. Then Today's next steps (dated work only,
 * dismiss/pin), mentor preparation (agreed actions live on the meeting record)
 * and the one-active practice focus.
 */

test.use({ timezoneId: 'Europe/London' })

const session = (id: string, title: string, dateISO: string, day: string) => ({
  id, title, day, dateISO, start: '08:30', end: '15:30', room: '', groups: '', tutor: '', subject: '', isSpecialism: false, isSelfStudy: false, isOptional: false,
})
const SESSIONS = [session('a1', 'School Experience SE1a', '2026-09-14', 'Mon'), session('a2', 'School Experience SE1a', '2026-09-15', 'Tue'), session('b1', 'School Experience SE1b', '2026-11-02', 'Mon')]
const SE1 = { id: 'pl-se1', code: 'SE1', schoolLocationId: 'sch-1', startISO: '2026-09-07', endISO: '2026-12-11', mappedBlockTags: ['SE1A', 'SE1B'], mentorName: 'A Mentor', at: 10 }
const SCHOOL = { id: 'sch-1', name: 'Riverside Primary', address: '1 River Lane, N1 1AA', lat: 51.53, lng: -0.11, confirmedAt: 5, at: 10 }
const base = () => ({
  reflections: [], targets: [], meetings: [], observations: [], audits: [], tasks: [], exceptions: [], plans: [], commitments: [], placements: [SE1], schools: [SCHOOL], programmes: [], packs: [], requirements: [], milestones: [], cycles: [], preps: [],
  lessons: [{ id: 'l1', dateISO: '2026-09-14', classGroup: 'Year 2', subject: 'Maths — number bonds', evaluation: '', standards: [], placementId: 'pl-se1', at: 10 }],
})

async function seed(page: Page, admin: Record<string, unknown> = base()) {
  await page.clock.install({ time: new Date('2026-09-11T07:05:00Z') })
  await page.addInitScript(
    ({ SESSIONS, admin }) => {
      localStorage.setItem('timetable.whatsnew.v1', '99')
      if (localStorage.getItem('timetable.store.v2')) return
      localStorage.setItem('timetable.store.v2', JSON.stringify({ activeId: 'fx', profiles: [{ id: 'fx', name: 'My timetable', settings: { demo: false, sheetId: 'FIXTURESHEET-FIXTURESHEET-FIXTURESHEET-0001', gid: null, specialismsChosen: true, checklistDismissed: true, usagePing: false, homeLat: 51.55, homeLng: -0.1, homeAddress: '1 Example Street' } }] }))
      localStorage.setItem('timetable.cache.v2.fx', JSON.stringify({ fetchedAt: Date.now(), sessions: SESSIONS }))
      localStorage.setItem('timetable.admin.v1.fx', JSON.stringify(admin))
    },
    { SESSIONS, admin }
  )
  await page.setViewportSize({ width: 390, height: 844 })
}
const admin = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('timetable.admin.v1.fx') ?? '{}'))

test('full cycle offline: plan → rehearsal block → teach (no attendance) → review with learner-entered feedback → next attempt without outcomes', async ({ page, context }) => {
  await seed(page)
  await page.goto('./#/placement/pl-se1')
  await expect(page.getByRole('heading', { level: 1, name: 'SE1 · Riverside Primary' })).toBeVisible()
  await context.setOffline(true)
  await page.getByRole('list', { name: 'Lessons' }).getByRole('button').first().click()
  const wb = page.getByRole('dialog', { name: /Lesson workbench/ })
  await expect(wb).toBeVisible()
  const tabs = wb.getByRole('tablist', { name: 'Lesson stages' })
  await expect(tabs.getByRole('tab', { name: 'Plan' })).toHaveAttribute('aria-selected', 'true')

  // Plan: template, intention, a new focus, linked timetable occurrence.
  await wb.getByRole('button', { name: 'Five-part lesson' }).click()
  await expect(wb.getByRole('textbox', { name: /^Sequence\b/ })).toHaveValue(/Retrieval starter/)
  await wb.getByLabel('Learning intention').fill('Recall number bonds to 10 fluently')
  await wb.getByLabel('New focus').fill('Cold-call every learner')
  await wb.getByRole('button', { name: 'Add focus' }).click()
  await wb.getByRole('combobox', { name: 'Timetable occurrence' }).selectOption({ index: 1 })
  await wb.getByRole('button', { name: 'Save plan', exact: true }).click()
  let file = await admin(page)
  let l1 = file.lessons.find((l: { id: string }) => l.id === 'l1')
  expect(l1.planRevision).toBe(1)
  expect(l1.intention).toBe('Recall number bonds to 10 fluently')
  expect(l1.sequence).toMatch(/Retrieval starter/)
  expect(l1.sessionRef).toBeTruthy()
  expect(file.cycles).toHaveLength(1)
  expect(file.cycles[0]).toMatchObject({ focus: 'Cold-call every learner', state: 'active' })
  expect(l1.cycleId).toBe(file.cycles[0].id)
  expect(l1.evaluation).toBe('')

  // Rehearse: a block on the Schedule through the plan model (task + timed block).
  await tabs.getByRole('tab', { name: 'Rehearse' }).click()
  await expect(wb).toContainText('Recall number bonds')
  await wb.getByLabel('Rehearsal date').fill('2026-09-13')
  await wb.getByRole('button', { name: 'Add rehearsal block' }).click()
  file = await admin(page)
  const task = file.tasks.find((t: { title: string }) => t.title === 'Rehearse: Maths — number bonds')
  expect(task).toMatchObject({ status: 'todo', dueISO: '2026-09-14' })
  expect(file.plans.find((p: { parentId: string }) => p.parentId === task.id)).toMatchObject({ kind: 'block', dateISO: '2026-09-13', startTime: '16:00', endTime: '16:30' })
  await wb.getByRole('button', { name: 'Mark rehearsed →' }).click()
  await expect(tabs.getByRole('tab', { name: 'Teach' })).toHaveAttribute('aria-selected', 'true')

  // Teach: large-type essentials; starting pins the plan revision and records nothing else.
  const metaBefore = await page.evaluate(() => localStorage.getItem('timetable.meta.v2.fx'))
  await expect(wb.locator('.teach-mode')).toBeVisible()
  const fontSize = await wb.locator('.teach-sequence').evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
  expect(fontSize).toBeGreaterThanOrEqual(17)
  await wb.getByRole('button', { name: 'Start teaching' }).click()
  file = await admin(page)
  l1 = file.lessons.find((l: { id: string }) => l.id === 'l1')
  expect(l1.taughtAt).toBeGreaterThan(0)
  expect(l1.taughtPlanRevision).toBe(1)
  expect(l1.rehearsedAt).toBeGreaterThan(0)
  expect(await page.evaluate(() => localStorage.getItem('timetable.meta.v2.fx'))).toBe(metaBefore)
  expect(l1.evaluation).toBe('')
  expect(l1.standards).toEqual([])

  // A plan edit after teaching becomes revision 2; the review names the taught revision.
  await tabs.getByRole('tab', { name: 'Plan' }).click()
  await wb.getByLabel('Checks for understanding').fill('Exit ticket with three bonds')
  await wb.getByRole('button', { name: 'Save plan', exact: true }).click()
  await tabs.getByRole('tab', { name: 'Teach' }).click()
  await wb.getByRole('button', { name: 'Finished — review →' }).click()
  await expect(tabs.getByRole('tab', { name: 'Review' })).toHaveAttribute('aria-selected', 'true')
  await expect(wb).toContainText('taught rev 1, now rev 2')
  await wb.getByLabel(/Evaluation/).fill('Pace was right; two learners needed the tens frame.')
  await wb.getByRole('button', { name: 'TS4', exact: true }).click()
  await wb.getByRole('button', { name: 'Save review' }).click()
  await wb.getByLabel('Feedback from').fill('A Mentor')
  await wb.getByLabel('Feedback development').fill('Wait longer after cold-calling.')
  await wb.getByRole('button', { name: 'Add feedback' }).click()
  const feedback = wb.getByRole('list', { name: 'Feedback' })
  await expect(feedback).toContainText('Entered by you')
  await expect(feedback).toContainText('Wait longer after cold-calling.')
  await expect(feedback).not.toContainText('Reviewer')
  file = await admin(page)
  expect(file.observations[0]).toMatchObject({ sourceType: 'learner-entered', lessonId: 'l1', cycleId: file.cycles[0].id, placementId: 'pl-se1', observer: 'A Mentor' })
  l1 = file.lessons.find((l: { id: string }) => l.id === 'l1')
  expect(l1.evaluation).toMatch(/Pace was right/)
  expect(l1.standards).toEqual(['TS4'])

  // Next attempt: new identity, plan carried, outcomes not.
  await wb.getByRole('button', { name: 'Next attempt →' }).click()
  await expect(wb).toContainText('attempt 2')
  await expect(tabs.getByRole('tab', { name: 'Plan' })).toHaveAttribute('aria-selected', 'true')
  file = await admin(page)
  expect(file.lessons).toHaveLength(2)
  const l2 = file.lessons.find((l: { id: string }) => l.id !== 'l1')
  expect(l2).toMatchObject({ attempt: 2, duplicatedFrom: 'l1', intention: 'Recall number bonds to 10 fluently', cycleId: file.cycles[0].id, placementId: 'pl-se1', evaluation: '', standards: [], planRevision: 1, stage: 'plan' })
  expect(l2.taughtAt).toBeUndefined()
  expect(l2.reviewAt).toBeUndefined()
  expect(file.observations).toHaveLength(1)
  await context.setOffline(false)
  // The quick retrospective lesson form in the PGCE file still works unchanged.
  await wb.getByRole('button', { name: 'Close' }).click()
  await page.goto('./#/pgce')
  await page.getByRole('button', { name: /Add or open a record/ }).click()
  await page.getByRole('menuitem', { name: /^Lessons/ }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByPlaceholder('Subject (e.g. Maths — fractions)').fill('Quick retro')
  await sheet.getByRole('button', { name: 'Log lesson' }).click()
  const quick = (await admin(page)).lessons.find((l: { subject: string }) => l.subject === 'Quick retro')
  expect(quick.stage).toBeUndefined()
  await expect(sheet.getByRole('button', { name: 'Open workbench: Quick retro' })).toBeVisible()
})

test('Today next steps: at most three from dated work and the active focus, nothing overdue, dismiss for today and pin first, opening lands on the right stage', async ({ page }) => {
  const a = base()
  a.lessons = [
    { id: 'plan1', dateISO: '2026-09-14', classGroup: 'Y2', subject: 'Maths', evaluation: '', standards: [], at: 1 },
    { id: 'old', dateISO: '2026-09-01', classGroup: 'Y2', subject: 'Old lesson', evaluation: '', standards: [], at: 1 },
    { id: 'taught', dateISO: '2026-09-09', classGroup: 'Y2', subject: 'Phonics', evaluation: '', standards: [], intention: 'x', taughtAt: 5, taughtPlanRevision: 1, planRevision: 1, at: 1 },
    { id: 'reh', dateISO: '2026-09-15', classGroup: 'Y2', subject: 'Science', evaluation: '', standards: [], intention: 'y', at: 1 },
  ]
  ;(a as { cycles: unknown[] }).cycles = [{ id: 'c1', focus: 'Cold-call every learner', state: 'active', at: 1 }]
  ;(a as { preps: unknown[] }).preps = [{ id: 'p1', dateISO: '2026-09-16', state: 'draft', exampleRefs: [], at: 1 }]
  await seed(page, a)
  await page.goto('./#/today')
  const card = page.getByRole('region', { name: 'Next steps' })
  await expect(card).toBeVisible()
  const items = card.getByRole('listitem')
  await expect(items).toHaveCount(3)
  await expect(items.nth(0)).toContainText('Review Phonics')
  await expect(items.nth(1)).toContainText('Plan Maths')
  await expect(items.nth(2)).toContainText('Rehearse Science')
  await expect(card).not.toContainText(/overdue|late/i)
  await expect(card).not.toContainText('Old lesson')
  await card.getByRole('button', { name: 'Dismiss for today: Plan Maths' }).click()
  await expect(items).toHaveCount(3)
  await expect(card).not.toContainText('Plan Maths')
  await expect(card).toContainText('Prepare for your mentor meeting')
  await page.reload()
  await expect(page.getByRole('region', { name: 'Next steps' })).not.toContainText('Plan Maths')
  await card.getByRole('button', { name: 'Pin: Rehearse Science' }).click()
  await expect(items.nth(0)).toContainText('Rehearse Science')
  await card.locator('.next-step-main').filter({ hasText: 'Review Phonics' }).click()
  const wb = page.getByRole('dialog', { name: /Lesson workbench/ })
  await expect(wb.getByRole('tab', { name: 'Review' })).toHaveAttribute('aria-selected', 'true')
})

test('mentor preparation: agenda with referenced examples and open actions; "held" creates the meeting that owns the agreed actions; next review surfaces on Today', async ({ page }) => {
  const a = base()
  a.meetings = [{ id: 'm0', dateISO: '2026-09-04', discussed: 'Earlier', actions: [{ id: 'act0', text: 'Read the marking policy', done: false }], at: 1 }]
  await seed(page, a)
  await page.goto('./#/pgce')
  await page.getByRole('button', { name: /Add or open a record/ }).click()
  await page.getByRole('menuitem', { name: /^Mentor preparation/ }).click()
  const sheet = page.getByRole('dialog', { name: 'Mentor preparation' })
  await sheet.getByLabel('Meeting date').fill('2026-09-16')
  await sheet.getByRole('button', { name: 'New agenda' }).click()
  await sheet.getByLabel('What changed since last time').fill('Tried cold-calling in three lessons.')
  await sheet.getByLabel('Where I need help').fill('Wait time after a question.')
  await sheet.getByRole('checkbox', { name: /Lesson · .*Maths — number bonds/ }).check()
  await expect(sheet.getByRole('list', { name: 'Open actions' })).toContainText('Read the marking policy')
  let file = await admin(page)
  expect(file.preps[0]).toMatchObject({ state: 'draft', dateISO: '2026-09-16', exampleRefs: ['l1'], changed: 'Tried cold-calling in three lessons.' })
  await sheet.getByLabel('What happened').fill('Agreed to model wait time together.')
  await sheet.getByLabel('Next review date').fill('2026-09-23')
  await sheet.getByLabel('Agreed actions').fill('Plan one lesson with 5-second wait time\nRecord one cold-call sequence')
  await sheet.getByRole('button', { name: 'Meeting held — save' }).click()
  file = await admin(page)
  const meeting = file.meetings.find((m: { prepId?: string }) => m.prepId === file.preps[0].id)
  expect(meeting.actions.map((x: { text: string; done: boolean }) => [x.text, x.done])).toEqual([['Plan one lesson with 5-second wait time', false], ['Record one cold-call sequence', false]])
  expect(meeting.dateISO).toBe('2026-09-16')
  expect(file.preps[0]).toMatchObject({ state: 'held', meetingId: meeting.id, outcome: { happened: 'Agreed to model wait time together.', nextReviewISO: '2026-09-23' } })
  await expect(sheet).toContainText('2 agreed actions on the meeting record (2 open)')
  await sheet.getByRole('button', { name: 'Close' }).click()
  await page.goto('./#/today')
  await expect(page.getByRole('region', { name: 'Next steps' })).toContainText('Next review agreed with your mentor')
})

test('practice focus: one active at a time (the other pauses, never fails), resume, review decision, archive', async ({ page }) => {
  await seed(page)
  await page.goto('./#/pgce')
  await page.getByRole('button', { name: /Add or open a record/ }).click()
  await page.getByRole('menuitem', { name: /^Practice focus/ }).click()
  const sheet = page.getByRole('dialog', { name: 'Practice focus' })
  await sheet.getByLabel('Focus', { exact: true }).fill('Cold-call every learner')
  await sheet.getByRole('button', { name: 'Start focus' }).click()
  await sheet.getByLabel('Focus', { exact: true }).fill('Clear instructions in three steps')
  await sheet.getByRole('button', { name: 'Start focus' }).click()
  const cycles = sheet.getByRole('list', { name: 'Practice cycles' }).getByRole('listitem')
  await expect(cycles).toHaveCount(2)
  await expect(cycles.filter({ hasText: 'Clear instructions' })).toContainText('Active focus')
  await expect(cycles.filter({ hasText: 'Cold-call' })).toContainText('Paused')
  await expect(cycles.filter({ hasText: 'Cold-call' })).toContainText('another focus became active')
  await expect(sheet).not.toContainText(/fail/i)
  await cycles.filter({ hasText: 'Cold-call' }).getByRole('button', { name: 'Resume' }).click()
  await expect(cycles.filter({ hasText: 'Cold-call' })).toContainText('Active focus')
  await expect(cycles.filter({ hasText: 'Clear instructions' })).toContainText('Paused')
  await cycles.filter({ hasText: 'Clear instructions' }).getByRole('combobox', { name: /Review decision/ }).selectOption('close')
  await cycles.filter({ hasText: 'Clear instructions' }).getByRole('button', { name: 'Archive' }).click()
  const file = await admin(page)
  expect(file.cycles.map((c: { focus: string; state: string; reviewDecision?: string }) => [c.focus, c.state, c.reviewDecision ?? null]).sort()).toEqual([['Clear instructions in three steps', 'archived', 'close'], ['Cold-call every learner', 'active', null]])
  // The PGCE menu counts only live focuses.
  await sheet.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('button', { name: /Add or open a record/ }).click()
  await expect(page.getByRole('menuitem', { name: 'Practice focus (1)' })).toBeVisible()
})

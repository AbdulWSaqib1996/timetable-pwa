import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'

/**
 * Owner request, 15 September 2026:
 *  1. a key date is never attended — it is COMPLETED, it stays on the schedule
 *     when done, and the tick is the same state on Tasks and on the Schedule;
 *  2. a lesson can set HOMEWORK scheduled against a later occurrence of that
 *     lesson ("Maths 1 gave me homework, it is due in Maths 2"), which then
 *     appears on that session, on Tasks and on the Schedule with one tick.
 */

test.use({ timezoneId: 'Europe/London' })

const session = (id: string, title: string, dateISO: string, day: string, start: string, end: string, extra: Record<string, unknown> = {}) => ({
  id, title, day, dateISO, start, end, room: 'B12', groups: '', tutor: 'A Tutor', subject: title, isSpecialism: false, isSelfStudy: false, isOptional: false, ...extra,
})
const SESSIONS = [
  session('m1', 'Maths 1', '2026-09-15', 'Tue', '09:00', '11:00'),
  session('m2', 'Maths 2', '2026-09-22', 'Tue', '09:00', '11:00'),
  session('m3', 'Maths 3', '2026-09-29', 'Tue', '09:00', '11:00'),
]
const KEYDATES = [
  { ...session('kd-1', 'Assignment 1 hand-in', '2026-09-18', 'Fri', '', '', { isKeyDate: true, sourceKey: 'keydates', sourceId: 'A1' }), eventKey: 'event:keydates:A1' },
]
const base = () => ({
  reflections: [], targets: [], meetings: [], observations: [], audits: [], exceptions: [], plans: [], commitments: [], placements: [], schools: [], programmes: [], packs: [], requirements: [], milestones: [], cycles: [], preps: [], goals: [], resources: [], projects: [], readings: [], contacts: [], questions: [], protected: [], supportNotes: [], examples: [], reviewPacks: [], experience: [], reviews: [], homework: [],
  tasks: [{ id: 't1', title: 'Reading log', dueISO: '2026-09-17', status: 'todo', at: 1 }],
  lessons: [{ id: 'l1', dateISO: '2026-09-15', classGroup: 'Y2', subject: 'Maths 1', evaluation: '', standards: [], at: 10 }],
})

async function seed(page: Page, admin: Record<string, unknown> = base()) {
  await page.clock.install({ time: new Date('2026-09-15T06:05:00Z') })
  await page.addInitScript(
    ({ SESSIONS, KEYDATES, admin }) => {
      localStorage.setItem('timetable.whatsnew.v1', '99')
      if (localStorage.getItem('timetable.store.v2')) return
      localStorage.setItem('timetable.store.v2', JSON.stringify({ activeId: 'fx', profiles: [{ id: 'fx', name: 'My timetable', settings: { demo: false, sheetId: 'FIXTURESHEET-FIXTURESHEET-FIXTURESHEET-0001', gid: null, keyDatesSheetId: 'FIXTURESHEET-FIXTURESHEET-FIXTURESHEET-0001', keyDatesGid: '7', specialismsChosen: true, checklistDismissed: true, usagePing: false } }] }))
      localStorage.setItem('timetable.cache.v2.fx', JSON.stringify({ fetchedAt: Date.now(), sessions: SESSIONS, keyDates: KEYDATES }))
      localStorage.setItem('timetable.admin.v1.fx', JSON.stringify(admin))
    },
    { SESSIONS, KEYDATES, admin }
  )
  await page.setViewportSize({ width: 390, height: 844 })
}
const admin = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('timetable.admin.v1.fx') ?? '{}'))
const meta = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('timetable.meta.v2.fx') ?? '{}'))

test('a key date is completed, not attended: the Schedule keeps it and shows Completed, and Tasks and the Schedule agree both ways', async ({ page }) => {
  await seed(page)
  await page.goto('./#/schedule')
  await expect(page.getByRole('heading', { level: 1, name: 'Schedule' })).toBeVisible()
  await page.getByRole('option', { name: /Friday 18 September/ }).click()
  const card = page.locator('.day-list .session-card').filter({ hasText: 'Assignment 1 hand-in' })
  await expect(card).toHaveCount(1)
  await expect(card).toContainText('Key date')
  await card.click()
  // No attendance anywhere on a key date — completion instead.
  await expect(page.getByRole('heading', { name: 'Attendance' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Attended' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Absent' })).toHaveCount(0)
  const statusGroup = page.getByRole('group', { name: 'Key date status' })
  await expect(statusGroup).toBeVisible()
  await expect(page.getByText('attendance is not recorded for key dates')).toBeVisible()
  await statusGroup.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByText('Completed · attendance is not recorded for key dates')).toBeVisible()
  // Marked on the Schedule: the row stays, shown as completed.
  await page.goto('./#/schedule')
  await page.getByRole('option', { name: /Friday 18 September/ }).click()
  await expect(card).toHaveCount(1)
  await expect(card).toHaveClass(/key-date-done/)
  await expect(card).toContainText('Completed')
  await expect(card).not.toContainText('Attended')
  // …and it reads the same on Tasks.
  await page.goto('./#/tasks')
  await page.locator('details.completed-tasks summary').click()
  const kdRow = page.locator('.task-card').filter({ hasText: 'Assignment 1 hand-in' })
  await expect(kdRow).toContainText('Completed')
  await expect(page.getByRole('combobox', { name: 'Status for Assignment 1 hand-in' })).toHaveValue('done')
  expect(Object.values(await meta(page)).some((m) => (m as { status?: string }).status === 'done')).toBe(true)
  // The other direction, for a personal task: completing it on Tasks shows on the Schedule.
  await page.getByRole('combobox', { name: 'Status for Reading log' }).first().selectOption('done')
  expect((await admin(page)).tasks[0]).toMatchObject({ status: 'done', completedISO: '2026-09-15' })
  await page.goto('./#/schedule')
  await page.getByRole('option', { name: /Thursday 17 September/ }).click()
  const taskCard = page.locator('.day-list .session-card').filter({ hasText: 'Reading log' })
  await expect(taskCard).toHaveClass(/key-date-done/)
  await expect(taskCard).toContainText('Completed')
  await expect(taskCard).toContainText('Your task')
})

test('homework set in Maths 1 is scheduled against Maths 2, and one tick covers the lesson, that session, Tasks and the Schedule', async ({ page }) => {
  await seed(page)
  // 1. Record it in the lesson that set it.
  await page.goto('./#/pgce/lesson/l1')
  const wb = page.getByRole('dialog', { name: /Lesson workbench/ })
  await expect(wb).toBeVisible()
  await wb.getByRole('tab', { name: 'Teach' }).click()
  const panel = wb.getByRole('group', { name: 'Homework set in this lesson' })
  await expect(panel).toBeVisible()
  await panel.getByLabel('Homework', { exact: true }).fill('Fractions worksheet')
  await panel.getByLabel('Details (optional)').fill('Questions 1–8')
  // Later occurrences of THIS lesson are offered first — Maths 2 and Maths 3, never Maths 1 itself.
  const due = panel.getByLabel('Due in')
  const laterOptions = due.locator('optgroup[label="Later occurrences of this lesson"] option')
  await expect(laterOptions).toHaveText([/^Maths 2 · Tue 22 Sep/, /^Maths 3 · Tue 29 Sep/])
  await due.selectOption((await laterOptions.first().getAttribute('value'))!)
  await panel.getByRole('button', { name: 'Add homework' }).click()
  const file = await admin(page)
  expect(file.homework).toHaveLength(1)
  expect(file.homework[0]).toMatchObject({ title: 'Fractions worksheet', details: 'Questions 1–8', lessonId: 'l1', dueTitle: 'Maths 2', dueISO: '2026-09-22', setISO: '2026-09-15', status: 'todo' })
  await expect(panel.getByRole('list', { name: 'Homework set' })).toContainText('due in Maths 2 · Tue 22 Sep')
  await wb.getByRole('button', { name: 'Close' }).click()

  // 2. It shows on the session it is due in, and on that day's schedule.
  await page.goto('./#/schedule')
  await page.getByRole('button', { name: 'Next week' }).click()
  await page.getByRole('option', { name: /Tuesday 22 September/ }).click()
  const hwCard = page.locator('.day-list .session-card').filter({ hasText: 'Homework: Fractions worksheet' })
  await expect(hwCard).toHaveCount(1)
  await expect(hwCard).toContainText('Homework')
  await page.locator('.day-list .session-card').filter({ hasText: 'Maths 2' }).click()
  const dueHere = page.getByRole('list', { name: 'Homework due' })
  await expect(dueHere).toContainText('Fractions worksheet')
  await dueHere.getByRole('checkbox', { name: /Fractions worksheet/ }).check()
  expect((await admin(page)).homework[0]).toMatchObject({ status: 'done', completedISO: '2026-09-15' })

  // 3. The same state on Tasks, and unticking there feeds back to the lesson.
  await page.goto('./#/tasks')
  await page.locator('details.completed-tasks summary').click()
  const row = page.locator('.task-card').filter({ hasText: 'Fractions worksheet' })
  await expect(row).toContainText('Homework')
  await expect(row).toContainText('Completed')
  await page.getByRole('combobox', { name: 'Status for Homework: Fractions worksheet' }).selectOption('todo')
  expect((await admin(page)).homework[0].status).toBe('todo')
  await page.goto('./#/pgce/lesson/l1')
  await wb.getByRole('tab', { name: 'Teach' }).click()
  await expect(wb.getByRole('group', { name: 'Homework set in this lesson' }).getByRole('checkbox', { name: /Fractions worksheet/ })).not.toBeChecked()
  // Nothing was written to session metadata: the record is the only owner.
  expect(Object.keys(await meta(page))).toEqual([])
})

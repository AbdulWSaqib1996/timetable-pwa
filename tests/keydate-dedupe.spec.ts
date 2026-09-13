import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'

/**
 * Owner report (13 Sep 2026): key dates sometimes appeared twice on the
 * timetable and sat among the sessions by time. One highlighted key date per
 * day+title — whether the second copy is a repeated sheet row with its own
 * ID, a task with the same title, or the deadline also listed on the main
 * tab — and it leads the day.
 */

test.use({ timezoneId: 'Europe/London' })

const session = (id: string, title: string, dateISO: string, start: string, end: string, extra: Record<string, unknown> = {}) => ({
  id, title, day: 'Mon', dateISO, start, end, room: 'B1', groups: '', tutor: '', subject: '', isSpecialism: false, isSelfStudy: false, isOptional: false, ...extra,
})
const D = '2026-09-14'
const SESSIONS = [
  session('s1', 'Maths 2', D, '09:00', '11:00'),
  // The main tab also lists the deadline as a row at noon.
  session('s2', 'Assignment 1 hand-in', D, '12:00', '12:00'),
  session('s3', 'English 2', D, '14:00', '16:00'),
]
const KEYDATES = [
  { ...session('kd-1', 'Assignment 1 hand-in', D, '', '', { isKeyDate: true, sourceKey: 'keydates', sourceId: 'A1' }), eventKey: 'event:keydates:A1' },
  // The key-dates tab repeats the row with a different Event ID.
  { ...session('kd-2', 'Assignment 1 hand-in ', D, '', '', { isKeyDate: true, sourceKey: 'keydates', sourceId: 'A1-copy' }), eventKey: 'event:keydates:A1-copy' },
  { ...session('kd-3', 'Reading log', D, '', '', { isKeyDate: true, sourceKey: 'keydates', sourceId: 'R1' }), eventKey: 'event:keydates:R1' },
]

async function seed(page: Page) {
  await page.clock.install({ time: new Date('2026-09-14T06:05:00Z') })
  await page.addInitScript(
    ({ SESSIONS, KEYDATES, D }) => {
      localStorage.setItem('timetable.whatsnew.v1', '99')
      if (localStorage.getItem('timetable.store.v2')) return
      localStorage.setItem('timetable.store.v2', JSON.stringify({ activeId: 'fx', profiles: [{ id: 'fx', name: 'My timetable', settings: { demo: false, sheetId: 'FIXTURESHEET-FIXTURESHEET-FIXTURESHEET-0001', gid: null, keyDatesSheetId: 'FIXTURESHEET-FIXTURESHEET-FIXTURESHEET-0001', keyDatesGid: '7', specialismsChosen: true, checklistDismissed: true, usagePing: false } }] }))
      localStorage.setItem('timetable.cache.v2.fx', JSON.stringify({ fetchedAt: Date.now(), sessions: SESSIONS, keyDates: KEYDATES }))
      // A personal task with the same title on the same day (a milestone, say).
      localStorage.setItem('timetable.admin.v1.fx', JSON.stringify({ reflections: [], targets: [], meetings: [], observations: [], lessons: [], audits: [], exceptions: [], plans: [], commitments: [], tasks: [{ id: 't1', title: 'assignment 1 hand-in', dueISO: D, status: 'todo', at: 1 }] }))
    },
    { SESSIONS, KEYDATES, D }
  )
  await page.setViewportSize({ width: 390, height: 844 })
}

test('one highlighted key date per day and title, shown first; the plain course row for the same deadline is not repeated; other rows keep their order', async ({ page }) => {
  await seed(page)
  await page.goto(`./#/schedule`)
  await expect(page.getByRole('heading', { level: 1, name: 'Schedule' })).toBeVisible()
  const cards = page.locator('.day-list .session-card')
  await expect(cards).toHaveCount(4)
  const titles = await cards.evaluateAll((els) => els.map((el) => [el.classList.contains('key-date'), (el.textContent ?? '').replace(/\s+/g, ' ').trim()]))
  expect(titles[0][0]).toBe(true)
  expect(titles[0][1]).toMatch(/Assignment 1 hand-in/)
  expect(titles[1][0]).toBe(true)
  expect(titles[1][1]).toMatch(/Reading log/)
  expect(titles[2][0]).toBe(false)
  expect(titles[2][1]).toMatch(/Maths 2/)
  expect(titles[3][0]).toBe(false)
  expect(titles[3][1]).toMatch(/English 2/)
  await expect(page.locator('.day-list .session-card.key-date').filter({ hasText: 'Assignment 1 hand-in' })).toHaveCount(1)
  await expect(page.locator('.day-list .session-card:not(.key-date)').filter({ hasText: 'Assignment 1 hand-in' })).toHaveCount(0)
  // The task itself is untouched on Tasks.
  await page.goto('./#/tasks')
  await expect(page.getByText('assignment 1 hand-in')).toBeVisible()
})

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

async function seed(page: Page, SESSIONS_ = SESSIONS, KEYDATES_ = KEYDATES) {
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
    { SESSIONS: SESSIONS_, KEYDATES: KEYDATES_, D }
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

/**
 * Audit B09 (Pass 78): dedupe only merges EQUIVALENT rows. Two key dates with
 * one title at different times (or rooms) are two items, both shown and
 * marked as a group; a lesson that merely shares a deadline's title at another
 * time stays on the timetable. The Pass 74 case above still yields one row.
 */
test('two timed key dates with one title stay as a marked group; a same-titled lesson at another time is not dropped; an equivalent repeat still merges', async ({ page }) => {
  const sessions = [
    // A lesson that happens to be titled like the deadline, at a different time: a real session.
    session('s1', 'Progress review', D, '09:00', '10:00'),
    session('s2', 'English 2', D, '14:00', '16:00'),
    // The main tab's own row for the 12:00 deadline: the pin itself, not repeated.
    session('s3', 'Portfolio submission', D, '12:00', '12:00'),
  ]
  const keyDates = [
    { ...session('kd-a', 'Progress review', D, '10:30', '11:00', { isKeyDate: true, sourceKey: 'keydates', sourceId: 'PR1' }), eventKey: 'event:keydates:PR1' },
    { ...session('kd-b', 'Progress review', D, '15:00', '15:30', { isKeyDate: true, sourceKey: 'keydates', sourceId: 'PR2' }), eventKey: 'event:keydates:PR2' },
    // An untimed repeat of the 10:30 one (same room) — equivalent, merged.
    { ...session('kd-c', 'progress review', D, '', '', { isKeyDate: true, sourceKey: 'keydates', sourceId: 'PR1-copy' }), eventKey: 'event:keydates:PR1-copy' },
    { ...session('kd-d', 'Portfolio submission', D, '12:00', '12:00', { isKeyDate: true, sourceKey: 'keydates', sourceId: 'PS' }), eventKey: 'event:keydates:PS' },
  ]
  await seed(page, sessions, keyDates)
  await page.goto(`./#/schedule`)
  await expect(page.getByRole('heading', { level: 1, name: 'Schedule' })).toBeVisible()
  const cards = page.locator('.day-list .session-card')
  // 3 sheet key dates (two Progress reviews + Portfolio) and the seed's task pin lead the day, then the lesson and English — 6 rows, not 5 or 7.
  await expect(cards).toHaveCount(6)
  await expect(page.locator('.day-list .session-card.key-date').filter({ hasText: 'Progress review' })).toHaveCount(2)
  await expect(page.locator('.day-list .session-card:not(.key-date)').filter({ hasText: 'Progress review' })).toHaveCount(1)
  await expect(page.locator('.day-list .session-card').filter({ hasText: 'Portfolio submission' })).toHaveCount(1)
  await expect(page.locator('.day-list .keydate-group')).toHaveCount(2)
  await expect(page.locator('.day-list .keydate-group').first()).toContainText('2 items with this title today · this one at 10:30')
  const kinds = await cards.evaluateAll((els) => els.map((el) => el.classList.contains('key-date')))
  expect(kinds).toEqual([true, true, true, true, false, false])
})

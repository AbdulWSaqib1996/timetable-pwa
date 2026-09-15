import { expect, test } from './fixtures'
import type { Page, Route } from '@playwright/test'

/**
 * Owner reports, 16 September 2026:
 *  1. a timetable row that is really a deadline must never show an attendance
 *     register — whether it duplicates a key date or the learner says so — and
 *     a deadline is never "my first session" of a day;
 *  2. a session whose room names no place the app can route to ("In School",
 *     and not one of the mapped placements) takes a location set on the session
 *     itself, used for its travel and directions; each session keeps its own.
 */

test.use({ timezoneId: 'Europe/London' })

const session = (id: string, title: string, dateISO: string, day: string, start: string, end: string, room = 'B12') => ({
  id, title, day, dateISO, start, end, room, groups: '1,2', tutor: 'A Tutor', subject: title, isSpecialism: false, isSelfStudy: false, isOptional: false,
})
// Today (16 Sep): a deadline row imported on the MAIN tab at 09:00, then a real session.
// Tomorrow: a deadline row first, then the real first session.
const SESSIONS = [
  session('d1', 'Maths PLT 1: Development Plan', '2026-09-16', 'Wed', '09:00', '09:00', 'In School'),
  session('s1', 'Maths 1', '2026-09-16', 'Wed', '11:00', '13:00'),
  session('d2', 'Portfolio submission', '2026-09-17', 'Thu', '08:00', '08:00', 'In School'),
  session('s2', 'English 1', '2026-09-17', 'Thu', '10:00', '12:00', 'In School'),
  session('s3', 'English 2', '2026-09-24', 'Thu', '10:00', '12:00', 'In School'),
]
const KEYDATES = [
  // The key-dates tab carries the same Development Plan deadline for the same day.
  { ...session('kd-1', 'Maths PLT 1: Development Plan', '2026-09-16', 'Wed', '', ''), isKeyDate: true, sourceKey: 'keydates', sourceId: 'DP1', eventKey: 'event:keydates:DP1' },
]
const ADMIN = {
  reflections: [], targets: [], meetings: [], observations: [], audits: [], tasks: [], exceptions: [], plans: [], commitments: [], placements: [], schools: [], programmes: [], packs: [], requirements: [], milestones: [], cycles: [], preps: [], goals: [], resources: [], projects: [], readings: [], contacts: [], questions: [], protected: [], supportNotes: [], examples: [], reviewPacks: [], experience: [], reviews: [], homework: [], lessons: [],
}

async function seed(page: Page) {
  await page.clock.install({ time: new Date('2026-09-16T06:05:00Z') })
  await page.addInitScript(
    ({ SESSIONS, KEYDATES, ADMIN }) => {
      localStorage.setItem('timetable.whatsnew.v1', '99')
      if (localStorage.getItem('timetable.store.v2')) return
      localStorage.setItem('timetable.store.v2', JSON.stringify({ activeId: 'fx', profiles: [{ id: 'fx', name: 'My timetable', settings: { demo: false, sheetId: 'FIXTURESHEET-FIXTURESHEET-FIXTURESHEET-0001', gid: null, keyDatesSheetId: 'FIXTURESHEET-FIXTURESHEET-FIXTURESHEET-0001', keyDatesGid: '7', specialismsChosen: true, checklistDismissed: true, usagePing: false, locationEnabled: false } }] }))
      localStorage.setItem('timetable.cache.v2.fx', JSON.stringify({ fetchedAt: Date.now(), sessions: SESSIONS, keyDates: KEYDATES }))
      localStorage.setItem('timetable.admin.v1.fx', JSON.stringify(ADMIN))
    },
    { SESSIONS, KEYDATES, ADMIN }
  )
  await page.setViewportSize({ width: 390, height: 844 })
}
const meta = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('timetable.meta.v2.fx') ?? '{}'))

test('a timetable row that duplicates a key date opens as the key date — completion, never an attendance register', async ({ page }) => {
  await seed(page)
  await page.goto('./#/schedule')
  await page.getByRole('option', { name: /Wednesday 16 September/ }).click()
  // The day shows the deadline once, highlighted, and the real session after it.
  await expect(page.locator('.day-list .session-card').filter({ hasText: 'Development Plan' })).toHaveCount(1)
  await page.locator('.day-list .session-card').filter({ hasText: 'Development Plan' }).click()
  await expect(page.getByRole('heading', { name: 'Attendance' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Attended' })).toHaveCount(0)
  await expect(page.getByRole('group', { name: 'Key date status' })).toBeVisible()
  await expect(page.getByText('attendance is not recorded for key dates')).toBeVisible()
})

test('any timetable row can be marked a deadline: attendance goes, it completes like a key date, and it is never the first session of a day', async ({ page }) => {
  await seed(page)
  // Tomorrow's preview names the deadline row first — until it is marked as one.
  await page.goto('./#/today')
  await expect(page.getByText(/Tomorrow: .*first at 08:00 — Portfolio submission/)).toBeVisible()
  // Open tomorrow's 08:00 row and say it is not a session I attend.
  await page.goto('./#/schedule')
  await page.getByRole('option', { name: /Thursday 17 September/ }).click()
  await page.locator('.day-list .session-card').filter({ hasText: 'Portfolio submission' }).click()
  await expect(page.getByRole('heading', { name: 'Attendance' })).toBeVisible()
  await page.getByRole('button', { name: /Not a session I attend/ }).click()
  // It is a key date now: completion, no attendance, and it says why.
  await expect(page.getByRole('heading', { name: 'Attendance' })).toHaveCount(0)
  const status = page.getByRole('group', { name: 'Key date status' })
  await expect(status).toBeVisible()
  await expect(page.getByText(/You marked this timetable row as a deadline/)).toBeVisible()
  expect(Object.values(await meta(page)).some((m) => (m as { deadlineOnly?: boolean }).deadlineOnly === true)).toBe(true)
  // Tomorrow's first session is now the real one.
  await page.goto('./#/today')
  await expect(page.getByText(/Tomorrow: .*first at 10:00 — English 1/)).toBeVisible()
  // It leads its day on the Schedule as a key date, and Tasks carries it.
  await page.goto('./#/schedule')
  await page.getByRole('option', { name: /Thursday 17 September/ }).click()
  const card = page.locator('.day-list .session-card').filter({ hasText: 'Portfolio submission' })
  await expect(card).toHaveClass(/key-date/)
  await page.goto('./#/tasks')
  await expect(page.locator('.task-card').filter({ hasText: 'Portfolio submission' })).toBeVisible()
  // Completing it on Tasks shows as completed on the Schedule.
  await page.getByRole('combobox', { name: 'Status for Portfolio submission' }).selectOption('done')
  await page.goto('./#/schedule')
  await page.getByRole('option', { name: /Thursday 17 September/ }).click()
  await expect(card).toContainText('Completed')
  // And the choice is reversible.
  await card.click()
  await page.getByRole('button', { name: 'Record attendance instead' }).click()
  await expect(page.getByRole('heading', { name: 'Attendance' })).toBeVisible()
})

test('a session whose room names no place takes its own location, and each session keeps its own', async ({ page }) => {
  // page routes take precedence over the context-wide network isolation.
  await page.route('**/api.postcodes.io/**', (route: Route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 200, result: { latitude: 51.44, longitude: -0.19 } }) }))
  await seed(page)
  await page.goto('./#/schedule')
  await page.getByRole('option', { name: /Thursday 17 September/ }).click()
  await page.locator('.day-list .session-card').filter({ hasText: 'English 1' }).click()
  const card = page.locator('section[aria-labelledby="detail-place-heading"]')
  await expect(card).toBeVisible()
  await expect(card).toContainText('The timetable says “In School”')
  await card.getByLabel('Place name').fill('Oakfield Primary')
  await card.getByLabel('Address').fill('SW15 1AA')
  await card.getByRole('button', { name: 'Locate on map' }).click()
  await expect(card).toContainText('SW15 1AA — located')
  await expect(card).toContainText('the directions for this session use this place')
  const saved = Object.values(await meta(page)).map((m) => (m as { location?: { label?: string; address: string; lat?: number } }).location).filter(Boolean)
  expect(saved).toHaveLength(1)
  expect(saved[0]).toMatchObject({ label: 'Oakfield Primary', address: 'SW15 1AA', lat: 51.44 })
  // The session's own place drives its directions.
  await page.getByRole('tab', { name: 'Travel & map' }).click()
  await expect(page.getByLabel('Travel and map')).toContainText('Oakfield Primary')
  // A different session of the same title has its own — nothing was applied across the timetable.
  await page.goto('./#/schedule')
  await page.getByRole('button', { name: 'Next week' }).click()
  await page.getByRole('option', { name: /Thursday 24 September/ }).click()
  await page.locator('.day-list .session-card').filter({ hasText: 'English 2' }).click()
  const second = page.locator('section[aria-labelledby="detail-place-heading"]')
  await expect(second).toContainText('The timetable says “In School”')
  await expect(second.getByLabel('Address')).toHaveValue('')
})

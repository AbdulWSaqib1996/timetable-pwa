import { expect, test } from './fixtures'
import type { Page, Route } from '@playwright/test'

/**
 * R2 regressions (Pass 51): journey continuity while a page stays open,
 * superseded plans, reminder flag survival, component lanes, panel
 * identity, honest map and clipboard states. Synthetic records, frozen
 * clock, all providers mocked.
 */

const ADMIN = {
  reflections: [], targets: [], observations: [], lessons: [], audits: [], meetings: [], exceptions: [], plans: [], tasks: [],
  commitments: [
    { id: 'remindme', title: 'Reminder-enabled appointment', dateISO: '2026-09-07', startTime: '17:00', endTime: '18:00', kind: 'appointment', busy: true, remind: true, at: 1 },
    // Saturday: a three-way morning chain and a lone afternoon block (TT-14).
    { id: 'sa', title: 'Morning A', dateISO: '2026-09-12', startTime: '09:00', endTime: '10:00', kind: 'study', busy: true, at: 1 },
    { id: 'sb', title: 'Morning B', dateISO: '2026-09-12', startTime: '09:30', endTime: '10:30', kind: 'study', busy: true, at: 1 },
    { id: 'sc', title: 'Morning C', dateISO: '2026-09-12', startTime: '10:00', endTime: '11:00', kind: 'study', busy: true, at: 1 },
    { id: 'sd', title: 'Lone afternoon', dateISO: '2026-09-12', startTime: '15:00', endTime: '16:00', kind: 'study', busy: true, at: 1 },
  ],
}

async function seed(page: Page, opts: { width?: number; clock?: string; locationEnabled?: boolean; noClipboard?: boolean } = {}) {
  await page.clock.install({ time: new Date(opts.clock ?? '2026-09-07T07:05:00Z') })
  await page.addInitScript(
    ({ admin, locationEnabled, noClipboard }) => {
      localStorage.setItem('timetable.whatsnew.v1', '99')
      if (noClipboard) Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
      if (localStorage.getItem('timetable.store.v2')) return
      localStorage.setItem(
        'timetable.store.v2',
        JSON.stringify({
          activeId: 'r2',
          profiles: [{ id: 'r2', name: 'R2 synthetic', settings: { demo: true, sheetId: '', gid: null, specialismsChosen: true, checklistDismissed: true, usagePing: false, travelMode: 'transit', locationEnabled, homeLat: 51.55, homeLng: -0.1, homeAddress: '1 Synthetic Street' } }],
        })
      )
      localStorage.setItem('timetable.admin.v1.r2', JSON.stringify(admin))
    },
    { admin: ADMIN, locationEnabled: opts.locationEnabled ?? false, noClipboard: opts.noClipboard ?? false }
  )
  await page.setViewportSize({ width: opts.width ?? 390, height: 900 })
}

const journey = (dep: string, arr: string, mins: number) => ({
  journeys: [{ startDateTime: dep, arrivalDateTime: arr, duration: mins, legs: [{ mode: { name: 'walking' }, duration: mins, departureTime: dep, arrivalTime: arr, departurePoint: { commonName: 'A' }, arrivalPoint: { commonName: 'B' }, instruction: { summary: 'Walk' } }] }],
})

async function openTodaysSessionTravel(page: Page) {
  await page.goto('./#/schedule')
  await page.locator('.day-list .session-card').first().click()
  await page.getByRole('tab', { name: 'Travel & map' }).click()
  await page.getByLabel('Journey origin').selectOption('campus')
}

test('TT-11: a planned departure that passes while the page is open fetches exactly one leave-now alternative', async ({ page, context }) => {
  const requests: string[] = []
  await context.route('**/api.tfl.gov.uk/Journey/**', (route: Route) => {
    const url = route.request().url()
    requests.push(url)
    const arriving = url.includes('timeIs=Arriving')
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(arriving ? journey('2026-09-07T08:13:00', '2026-09-07T08:46:00', 33) : journey('2026-09-07T08:20:00', '2026-09-07T08:50:00', 30)) })
  })
  await seed(page)
  await openTodaysSessionTravel(page)
  await expect(page.getByText(/Leave by 08:13/)).toBeVisible()
  const before = requests.filter((u) => !u.includes('timeIs=Arriving')).length
  // 08:05 → 08:16: the departure passes without any navigation.
  await page.clock.fastForward('11:00')
  await expect(page.getByText(/Planned departure 08:13 has passed/)).toBeVisible()
  await expect(page.getByText(/Leaving now instead: ≈ 30m/)).toBeVisible()
  expect(requests.filter((u) => !u.includes('timeIs=Arriving')).length).toBe(before + 1)
  // More ticks must not flood the provider.
  await page.clock.fastForward('02:00')
  await page.waitForTimeout(200)
  expect(requests.filter((u) => !u.includes('timeIs=Arriving')).length).toBe(before + 1)
})

test('TT-12: changing origin supersedes the plan immediately; a failed fetch has a working Retry', async ({ page, context }) => {
  let fail = true
  await context.route('**/api.tfl.gov.uk/Journey/**', (route: Route) => {
    if (fail) return route.abort()
    const url = route.request().url()
    const home = url.includes('51.55')
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(journey(home ? '2026-09-07T08:30:00' : '2026-09-07T08:13:00', '2026-09-07T08:46:00', home ? 16 : 33)) })
  })
  await seed(page)
  await openTodaysSessionTravel(page)
  await expect(page.getByText(/Couldn't reach TfL/)).toBeVisible()
  // Retry bypasses the (15 s) negative cache and succeeds once the network is back.
  fail = false
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByText(/Leave by 08:13/)).toBeVisible()
  // Origin change: the old plan vanishes at once; the new identity plans afresh.
  await page.getByLabel('Journey origin').selectOption('home')
  await expect(page.getByText(/Leave by 08:13/)).toHaveCount(0)
  await expect(page.getByText(/Leave by 08:30/)).toBeVisible()
})

test('TT-13: editing a reminder-enabled personal event keeps its reminder; the control turns it off explicitly', async ({ page }) => {
  await seed(page)
  await page.goto('./#/schedule')
  // Selecting a personal event opens its editor directly.
  await page.locator('.day-list .session-card', { hasText: 'Reminder-enabled appointment' }).click()
  const remind = page.getByLabel('Remind me')
  await expect(remind).toBeChecked()
  await page.getByLabel('Title', { exact: true }).fill('Reminder-enabled appointment (renamed)')
  await page.getByRole('button', { name: /^Save/ }).click()
  let rec = await page.evaluate(() => JSON.parse(localStorage.getItem('timetable.admin.v1.r2')!).commitments.find((c: { id: string }) => c.id === 'remindme'))
  expect(rec.remind).toBe(true)
  expect(rec.title).toContain('renamed')
  await page.goto('./#/schedule')
  await page.locator('.day-list .session-card', { hasText: 'renamed' }).click()
  await page.getByLabel('Remind me').uncheck()
  await page.getByRole('button', { name: /^Save/ }).click()
  rec = await page.evaluate(() => JSON.parse(localStorage.getItem('timetable.admin.v1.r2')!).commitments.find((c: { id: string }) => c.id === 'remindme'))
  expect(rec.remind).toBe(false)
})

test('TT-14: three overlapping morning blocks share lanes; the lone afternoon block keeps full width', async ({ page }) => {
  // 1600px: two lanes stay above V2's 100px readable minimum, so no grouping.
  await seed(page, { width: 1600 })
  await page.goto('./#/schedule')
  const w = async (title: string) => page.locator('.week-event', { hasText: title }).evaluate((el) => el.getBoundingClientRect().width)
  const morning = await w('Morning A')
  const afternoon = await w('Lone afternoon')
  const column = await page.locator('.week-col').last().evaluate((el) => el.getBoundingClientRect().width)
  expect(afternoon).toBeGreaterThan(column - 12) // full width, not a third
  expect(afternoon).toBeGreaterThan(morning * 1.8) // the chain shares two lanes
})

test('TT-15: the desktop panel follows identity — closes on week change unless pinned', async ({ page }) => {
  await seed(page, { width: 1600 })
  await page.goto('./#/schedule')
  await page.locator('.week-event', { hasText: 'Morning A' }).click()
  await expect(page.locator('.session-panel')).toContainText('Morning A')
  await page.locator('.week-view').getByRole('button', { name: /next week/i }).click()
  await expect(page.locator('.session-panel')).toHaveCount(0)
  await page.locator('.week-view').getByRole('button', { name: /previous week/i }).click()
  await page.locator('.week-event', { hasText: 'Morning A' }).click()
  await page.getByRole('button', { name: 'Pin panel across weeks' }).click()
  await page.locator('.week-view').getByRole('button', { name: /next week/i }).click()
  await expect(page.locator('.session-panel')).toContainText('Morning A')
})

test('TT-16: when no map tile loads, the map says so and offers Retry while the address stays usable', async ({ page, context }) => {
  await context.route('**/tile.openstreetmap.org/**', (route: Route) => route.abort())
  await context.route('**/api.tfl.gov.uk/**', (route: Route) => route.abort())
  await seed(page)
  await openTodaysSessionTravel(page)
  await expect(page.locator('.map-fallback').getByText(/Map could not load|Map unavailable offline/)).toBeVisible({ timeout: 15000 })
  await expect(page.getByRole('button', { name: 'Retry map' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Copy address' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Open in Google Maps/ })).toBeVisible()
})

test('TT-17: journey-home copy never claims a live route before one exists; saved origins come before GPS; clipboard failure is honest', async ({ page, context }) => {
  await context.route('**/api.tfl.gov.uk/Journey/**', (route: Route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(journey('2026-09-07T08:20:00', '2026-09-07T08:50:00', 30)) })
  )
  await seed(page, { locationEnabled: false, noClipboard: true })
  await page.goto('./#/home')
  await expect(page.getByText('Leaving now — choose where you are starting from')).toBeVisible()
  await expect(page.getByText(/Pick a saved starting point below for a route — no location permission needed/)).toBeVisible()
  await expect(page.getByText(/Turn them on in Settings for a live journey/)).toHaveCount(0)
  await page.getByLabel('Journey origin').selectOption('campus')
  await expect(page.getByText(/Leaving now — live route/)).toBeVisible()
  await page.getByRole('button', { name: 'Use this origin by default for the journey home' }).click()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('timetable.store.v2')!).profiles[0].settings.defaultOriginHome)).toBe('campus')
  await page.getByRole('button', { name: 'Copy address' }).click()
  await expect(page.getByText(/Copy unavailable here/)).toBeVisible()
  await expect(page.getByText('1 Synthetic Street').last()).toBeVisible()
})

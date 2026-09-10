import { expect, test } from './fixtures'
import type { Page, Route } from '@playwright/test'

/**
 * V3 (Pass 60) — travel to a session, journey home, the Settings index,
 * Data & devices, Reminders and Find from the visual audit. Every check is
 * against real state with synthetic fixtures; nothing is a snapshot.
 */

test.use({ timezoneId: 'Europe/London' })

const DEMO = { demo: true, sheetId: '', gid: null, specialismsChosen: true, checklistDismissed: true, usagePing: false }
const EMPTY_ADMIN = { reflections: [], targets: [], observations: [], lessons: [], audits: [], exceptions: [], plans: [], commitments: [], meetings: [], tasks: [] }

async function seed(
  page: Page,
  opts: { settings?: Record<string, unknown>; admin?: Record<string, unknown>; extra?: Record<string, string>; permission?: string | 'unsupported'; width?: number; clock?: string } = {}
) {
  await page.clock.install({ time: new Date(opts.clock ?? '2026-09-07T07:05:00Z') })
  await page.addInitScript(
    ({ settings, admin, extra, permission }) => {
      localStorage.setItem('timetable.whatsnew.v1', '99')
      const w = window as unknown as { permissionRequests: number }
      w.permissionRequests = 0
      if (permission === 'unsupported') {
        Object.defineProperty(window, 'Notification', { value: undefined, configurable: true })
      } else {
        Object.defineProperty(window, 'Notification', {
          value: class {
            static permission = permission
            static requestPermission() {
              w.permissionRequests += 1
              return Promise.resolve(permission)
            }
            constructor() {}
          },
          configurable: true,
        })
      }
      if (localStorage.getItem('timetable.store.v2')) return
      localStorage.setItem('timetable.store.v2', JSON.stringify({ activeId: 'd', profiles: [{ id: 'd', name: 'Demo learner', settings }] }))
      localStorage.setItem('timetable.admin.v1.d', JSON.stringify(admin))
      for (const [k, v] of Object.entries(extra ?? {})) localStorage.setItem(k, v)
    },
    { settings: { ...DEMO, ...(opts.settings ?? {}) }, admin: opts.admin ?? EMPTY_ADMIN, extra: opts.extra ?? {}, permission: opts.permission ?? 'granted' }
  )
  await page.setViewportSize({ width: opts.width ?? 390, height: 844 })
}

const journey = (dep: string, arr: string, mins: number) => ({
  journeys: [{ startDateTime: dep, arrivalDateTime: arr, duration: mins, legs: [{ mode: { name: 'walking' }, duration: mins, departureTime: dep, arrivalTime: arr, departurePoint: { commonName: 'A' }, arrivalPoint: { commonName: 'B' }, instruction: { summary: 'Walk' } }] }],
})

const top = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!.y

test('Travel & map: origin and destination first, the missing input named, Choose starting point focuses the real control; a plan turns the status live and every travel component survives', async ({ page, context }) => {
  await context.route('**/api.tfl.gov.uk/Journey/**', (route: Route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(journey('2026-09-07T08:20:00', '2026-09-07T08:50:00', 30)) })
  )
  await context.route('**/tile.openstreetmap.org/**', (route: Route) => route.abort())
  await seed(page, { settings: { travelMode: 'transit', locationEnabled: false, homeLat: 51.55, homeLng: -0.1, homeAddress: '1 Synthetic Street' } })
  await page.goto('./#/schedule')
  await page.locator('.day-list .session-card').first().click()
  await page.getByRole('tab', { name: 'Travel & map' }).click()
  const panel = page.locator('.detail-tabpanel[aria-label="Travel and map"]')
  const od = panel.locator('.travel-od')
  await expect(od).toContainText('Choose a starting point')
  await expect(od).toContainText(/Session starts \d\d:\d\d/)
  await expect(od.getByRole('button', { name: 'Copy address' })).toBeVisible()
  // Order: summary → status → primary action → origin control → options → map → external navigation.
  const choose = panel.getByRole('button', { name: 'Choose starting point' })
  await expect(choose).toBeVisible()
  expect(await top(page, '.travel-od')).toBeLessThan(await top(page, '.travel-summary'))
  expect(await top(page, '.travel-summary')).toBeLessThan((await choose.boundingBox())!.y)
  expect((await choose.boundingBox())!.y).toBeLessThan((await page.getByLabel('Journey origin').boundingBox())!.y)
  await choose.click()
  await expect(page.getByLabel('Journey origin')).toBeFocused()
  await expect(panel.locator('.travel-summary')).toHaveClass(/travel-summary--missing/)
  // A real plan: the status turns live, the primary action disappears, steps/map/directions remain.
  await page.getByLabel('Journey origin').selectOption('campus')
  await expect(panel.locator('.travel-summary')).toHaveClass(/travel-summary--live/)
  await expect(page.getByText(/Leave by|live TfL/)).toBeVisible()
  await expect(choose).toHaveCount(0)
  await expect(page.getByRole('group', { name: 'Arrival buffer' })).toBeVisible()
  await expect(page.getByText('Journey steps')).toBeVisible()
  await expect(page.locator('.map-fallback').getByText(/Map could not load|Map unavailable offline/)).toBeVisible({ timeout: 15000 })
  await expect(page.getByRole('button', { name: 'Retry map' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Open in Google Maps/ })).toBeVisible()
  const box = await page.locator('.map-fallback').boundingBox()
  expect(box!.height).toBeLessThan(160) // compact unavailable-map card
})

test('Journey home: one origin/destination summary, an explicit unknown starting point, distinct Choose starting point and Open home in Maps, edit-home grouped with the address', async ({ page }) => {
  await seed(page, { settings: { travelMode: 'transit', locationEnabled: false, homeLat: 51.55, homeLng: -0.1, homeAddress: '1 Synthetic Street' } })
  await page.goto('./#/home')
  const od = page.locator('.journey-home-page .travel-od')
  await expect(od).toContainText('Your return journey')
  await expect(od).toContainText('Starting point not selected')
  await expect(od.locator('.today-hero-building')).toHaveText('1 Synthetic Street')
  await expect(od.getByRole('button', { name: 'Copy address' })).toBeVisible()
  await expect(page.getByText(/Travel time needs a starting point/)).toBeVisible()
  const choose = page.getByRole('button', { name: 'Choose starting point' })
  const maps = page.getByRole('link', { name: /Open home in Maps/ })
  await expect(choose).toBeVisible()
  await expect(maps).toBeVisible()
  await choose.click()
  await expect(page.getByLabel('Journey origin')).toBeFocused()
  await od.getByRole('button', { name: 'Edit home location' }).click()
  await expect(page).toHaveURL(/#\/settings/)
})

test('Settings index: seven icon-tile rows with one accessible name each, Done only, and a save line that comes from real persistence state', async ({ page }) => {
  await seed(page)
  await page.goto('./#/settings')
  const rows = page.locator('.settings-index--tiles .settings-index-row')
  await expect(rows).toHaveCount(7)
  await expect(page.locator('.settings-index-icon')).toHaveCount(7)
  for (const name of ['My timetable', 'Reminders', 'Travel & home', 'Connected calendars', 'Data & devices', 'Appearance', 'Help & privacy']) {
    await expect(page.getByRole('button', { name: new RegExp(`^${name.replace('&', '&')}`) })).toBeVisible()
  }
  await expect(rows.first().locator('button')).toHaveCount(0) // no nested icon button
  await expect(page.getByRole('button', { name: 'Done' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Settings/ })).toHaveCount(0)
  await expect(page.getByText('Saved on this device')).toBeVisible()
  const hint = await rows.first().locator('.settings-index-hint').evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
  expect(hint).toBeGreaterThanOrEqual(14)
})

test('Data & devices: state → Back up / Restore → sync → storage & advanced; drafts surface automatically; Offline is said, not guessed; attendance analysis is one tap away in Term stats', async ({ page }) => {
  const draft = { version: 1, profileId: 'd', recordKind: 'task', recordId: 'draft1', baseRevision: 0, savedAt: Date.now(), value: { title: 'Half-written task' } }
  await seed(page, { extra: { 'timetable.draft.v1.task.draft1.d': JSON.stringify(draft) } })
  await page.goto('./#/settings/data')
  const health = page.getByRole('list', { name: 'Data health' })
  await expect(health).toContainText('all changes written to this device')
  await expect(page.locator('.data-drafts-notice')).toContainText('1 unsaved draft')
  const advanced = page.locator('details.data-advanced')
  await expect(advanced).not.toHaveAttribute('open', '')
  expect(await top(page, '#data-health')).toBeLessThan((await page.getByRole('button', { name: 'Back up… (preview first)' }).boundingBox())!.y)
  expect((await page.getByRole('button', { name: 'Back up… (preview first)' }).boundingBox())!.y).toBeLessThan(await top(page, '#sync'))
  expect(await top(page, '#sync')).toBeLessThan(await top(page, '#attendance-analysis'))
  await advanced.locator('summary').click()
  await expect(advanced).toContainText(/Storage/)
  await expect(advanced).toContainText('0 photos, 0 documents')
  // Values sit under their labels at 390px (single column), two columns only from 640px.
  const column = await health.locator('li').first().evaluate((el) => getComputedStyle(el).flexDirection)
  expect(column).toBe('column')
  await page.setViewportSize({ width: 800, height: 900 })
  expect(await health.locator('li').first().evaluate((el) => getComputedStyle(el).flexDirection)).toBe('row')
  await page.setViewportSize({ width: 390, height: 844 })
  // Offline: the page says so instead of a stale sync guess.
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    window.dispatchEvent(new Event('offline'))
  })
  await expect(page.locator('#data-health')).toContainText('Offline')
  // Relocation: analysis lives in Term stats, reachable in one tap.
  await page.getByRole('button', { name: 'Term stats' }).click()
  const stats = page.getByRole('dialog', { name: 'Term stats' })
  await expect(stats.getByText(/^\d+%$/).first()).toBeVisible()
  await expect(stats.getByRole('button', { name: 'Export attendance CSV' })).toBeVisible()
})

test('Reminders: grouped by decision with the state beside each heading; a denied permission says Blocked on this device with recovery steps; viewing never prompts', async ({ page }) => {
  await seed(page, { permission: 'denied', settings: { reminderOffsets: [15], attendancePrompts: true } })
  await page.goto('./#/settings/reminders')
  await expect(page.locator('#quiet-hours')).toBeVisible() // the Settings chunk is code-split; wait for the last group
  const ids = await page.locator('.settings-body section[id]').evaluateAll((els) => els.map((e) => e.id))
  expect(ids).toEqual(['notification-status', 'session-reminders', 'leave-alerts', 'attendance-prompts', 'key-date-reminders', 'quiet-hours'])
  await expect(page.locator('#notification-status .notif-state')).toHaveText('Blocked on this device')
  const blocked = page.locator('.notif-blocked')
  await expect(blocked).toContainText('Blocked on this device')
  await expect(blocked.locator('ol li')).toHaveCount(3)
  await expect(page.locator('#session-reminders .notif-state')).toHaveText('15m before')
  await expect(page.locator('#attendance-prompts .notif-state')).toHaveText('at each session’s end')
  await expect(page.locator('#quiet-hours')).toContainText('Europe/London')
  const chip = page.locator('#session-reminders .chip').first()
  expect((await chip.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  expect(await page.evaluate(() => (window as unknown as { permissionRequests: number }).permissionRequests)).toBe(0)
  // Granted and unsupported states are named truthfully too.
  await page.goto('./#/settings')
  await page.evaluate(() => {
    Object.defineProperty(window, 'Notification', { value: class { static permission = 'granted' }, configurable: true })
  })
  await page.goto('./#/settings/reminders')
  await expect(page.locator('#notification-status .notif-state')).toHaveText('Allowed on this device')
  // Settings search knows the new groups.
  await page.goto('./#/settings')
  await page.getByRole('searchbox', { name: 'Search settings' }).fill('attend')
  await page.getByRole('list', { name: 'Search results' }).getByRole('button', { name: /Attendance prompts/ }).click()
  await expect(page.locator('#attendance-prompts h3')).toBeFocused()
})

test('Find: labelled field, all six scope chips, results grouped by type in relevance order, the indexed-content note, keyboard contract intact', async ({ page }) => {
  await seed(page, {
    admin: { ...EMPTY_ADMIN, commitments: [{ id: 'dent', title: 'Dentist appointment', dateISO: '2026-09-09', startTime: '17:00', endTime: '18:00', kind: 'appointment', busy: true, at: 1 }] },
  })
  await page.goto('./#/find')
  await expect(page.locator('label.find-label')).toHaveText('Search')
  const box = page.getByRole('searchbox', { name: 'Find anything' })
  await expect(box).toBeFocused()
  await expect(page.getByRole('group', { name: 'Record types' }).getByRole('button', { pressed: true })).toHaveCount(6)
  await expect(page.getByText(/searched on this device only/)).toBeVisible()
  await expect(page.getByText('Find the right record')).toBeVisible()
  await box.fill('english')
  const results = page.getByRole('list', { name: 'Search results' })
  await expect(results.locator('.find-group-title').first()).toContainText('Timetable sessions')
  await expect(results.getByRole('button').first()).toContainText('English')
  await box.fill('dentist')
  await expect(results.locator('.find-group-title')).toHaveCount(1)
  await expect(results.locator('.find-group-title')).toContainText('Personal events (1)')
  await box.press('ArrowDown')
  await expect(results.getByRole('button').first()).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(box).toBeFocused()
  // Scope: dropping Personal hides the event; "All types" restores it.
  await page.getByRole('group', { name: 'Record types' }).getByRole('button', { name: 'Personal' }).click()
  await expect(page.getByText(/No results for “dentist”/)).toBeVisible()
  await page.getByRole('button', { name: 'All types' }).click()
  await expect(results.getByRole('button')).toHaveCount(1)
})

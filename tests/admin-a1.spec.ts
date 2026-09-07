import { expect, test } from './fixtures'
import type { Page, Route } from '@playwright/test'

/**
 * A1 browser coverage (Pass 45): the admin dashboard holds its credential in
 * memory only, locks completely, discards late responses, renders honest
 * chart geometry and copy. All worker traffic is mocked.
 */

const statsFixture = (overrides: Record<string, unknown> = {}) => {
  const day = (i: number) => new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)
  return {
    generatedAt: new Date().toISOString(),
    windowDays: 31,
    timezone: 'UTC',
    includesPartialToday: true,
    completeness: { scanComplete: true, missingRows: 0, invalidRows: 0 },
    totalDevicesEver: 140,
    activeLast7Days: 124,
    activeLast30Days: 131,
    todayVersions: { 9: 30, 8: 8 },
    retention: { oneDay: 41, twoToFourDays: 52, fivePlusDays: 31 },
    features: { detail: { uses: 384, devices: 92 }, photo: { uses: 12, devices: 9 } },
    opensLast7Days: 512,
    dayparts: [4, 10, 120, 160, 140, 78],
    setup: { devices: 30, counts: { push: 18 }, known: { push: 26 } },
    daily: Array.from({ length: 31 }, (_, i) => ({
      date: day(i),
      active: i === 0 ? 38 : 20 + (i % 9),
      listed: i === 0 ? 38 : 20 + (i % 9),
      installed: 24,
      newDevices: i % 5,
      platforms: { ios: 20 },
    })),
    ...overrides,
  }
}

async function seedLegacy(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('tt.statskey', 'legacy-persisted-key')
    localStorage.setItem('tt.statscache', JSON.stringify({ at: Date.now(), data: { daily: [] } }))
  })
}

test('legacy key/cache are purged, nothing loads before unlock, and no credential travels in a URL', async ({ page, context }) => {
  const statsUrls: string[] = []
  await context.route('**/timetable-push.ics-feed.workers.dev/**', (route: Route) => {
    statsUrls.push(route.request().url())
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(statsFixture()) })
  })
  await seedLegacy(page)
  await page.goto('./analytics.html')
  await expect(page.getByText(/Locked — enter the owner key/)).toBeVisible()
  expect(statsUrls.length, 'a stats request fired before unlock').toBe(0)
  const legacy = await page.evaluate(() => [localStorage.getItem('tt.statskey'), localStorage.getItem('tt.statscache')])
  expect(legacy).toEqual([null, null])
  // Unlock: credential goes in the Authorization header, never the URL.
  const authHeaders: (string | undefined)[] = []
  await context.route('**/timetable-push.ics-feed.workers.dev/stats**', (route: Route) => {
    authHeaders.push(route.request().headers()['authorization'])
    statsUrls.push(route.request().url())
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(statsFixture()) })
  })
  await page.getByLabel('Owner key').fill('test-key')
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.getByText('active last 7 days', { exact: false })).toBeVisible()
  expect(authHeaders[0]).toBe('Bearer test-key')
  expect(statsUrls.every((u) => !u.includes('key='))).toBe(true)
})

test('Lock clears everything and a late response cannot repopulate the page', async ({ page, context }) => {
  let delayed = false
  await context.route('**/timetable-push.ics-feed.workers.dev/stats**', async (route: Route) => {
    if (delayed) await new Promise((r) => setTimeout(r, 1500))
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(statsFixture()) })
  })
  await page.goto('./analytics.html')
  await page.getByLabel('Owner key').fill('test-key')
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.getByText('active last 7 days', { exact: false })).toBeVisible()
  // Lock: snapshot gone, key field focused and empty.
  await page.getByRole('button', { name: '🔒 Lock' }).click()
  await expect(page.getByText(/Locked — enter the owner key/)).toBeVisible()
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('key')
  expect(await page.getByLabel('Owner key').inputValue()).toBe('')
  // Unlock with a SLOW response, lock while it is in flight: the late reply
  // must be discarded, not rendered.
  delayed = true
  await page.getByLabel('Owner key').fill('test-key')
  await page.getByRole('button', { name: 'Unlock' }).click()
  await page.getByRole('button', { name: '🔒 Lock' }).click()
  await page.waitForTimeout(2000)
  await expect(page.getByText(/Locked — enter the owner key/)).toBeVisible()
  await expect(page.getByText('active last 7 days', { exact: false })).toHaveCount(0)
})

test('401 relocks with an honest message; 503 names configuration, not emptiness', async ({ page, context }) => {
  let status = 401
  await context.route('**/timetable-push.ics-feed.workers.dev/stats**', (route: Route) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: 'x' }) })
  )
  await page.goto('./analytics.html')
  await page.getByLabel('Owner key').fill('wrong')
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.getByText(/Access expired or the key is wrong/)).toBeVisible()
  status = 503
  await page.getByLabel('Owner key').fill('any')
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.getByText(/no stats key configured/)).toBeVisible()
  await expect(page.getByText(/not an empty dataset/)).toBeVisible()
})

test('nonzero data draws visibly nonzero bars; honest labels; completeness cap is loudly flagged', async ({ page, context }) => {
  await context.route('**/timetable-push.ics-feed.workers.dev/stats**', (route: Route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(statsFixture({ completeness: { scanComplete: false, missingRows: 3, invalidRows: 0 } })),
    })
  )
  await page.goto('./analytics.html')
  await page.getByLabel('Owner key').fill('test-key')
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.getByText('active last 7 days', { exact: false })).toBeVisible()
  // ADM-04 regression: with nonzero series, rendered segments have real height.
  const heights = await page.$$eval('.chart .bar .seg-ret', (els) => els.map((e) => (e as HTMLElement).offsetHeight))
  expect(Math.max(...heights)).toBeGreaterThan(10)
  expect(heights.filter((h) => h > 0).length).toBeGreaterThan(20)
  // ADM-14 copy: honest names replace the misleading ones.
  await expect(page.getByText('observed on 1 day in this window')).toBeVisible()
  await expect(page.getByText(/tried it once/)).toHaveCount(0)
  await expect(page.getByText('standalone-mode reports today')).toBeVisible()
  await expect(page.getByText('Photo add attempt')).toBeVisible()
  // ADM-11 surfaced: capped scans are labelled incomplete lower bounds.
  await expect(page.getByText(/INCOMPLETE lower bounds/)).toBeVisible()
  await expect(page.getByText(/3 listed row\(s\) could not be read/)).toBeVisible()
  // ADM-20: retention statement covers the no-expiry first-seen ledger.
  await expect(page.getByText(/first-seen token ledger currently has no expiry/)).toBeVisible()
})

import { expect, test } from './fixtures'
import { legacyFixture, mockStats } from './admin-fixtures'

/**
 * A1 invariants (Pass 45), running against the A3 React shell: in-memory
 * credential only, header-only auth, complete lock lifecycle with late
 * responses discarded, honest error states, real chart geometry and honest
 * metric copy. All worker traffic is mocked.
 */

test('legacy key/cache are purged, nothing loads before unlock, and no credential travels in a URL', async ({ page, context }) => {
  const { legacyCalls } = await mockStats(context)
  const authHeaders: (string | undefined)[] = []
  await context.route(/timetable-push\.ics-feed\.workers\.dev\/stats\?/, (route) => {
    authHeaders.push(route.request().headers()['authorization'])
    legacyCalls.push(route.request().url())
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(legacyFixture()) })
  })
  await page.addInitScript(() => {
    localStorage.setItem('tt.statskey', 'legacy-persisted-key')
    localStorage.setItem('tt.statscache', JSON.stringify({ at: Date.now(), data: { daily: [] } }))
  })
  await page.goto('./analytics.html')
  await expect(page.getByLabel('Owner key')).toBeVisible()
  expect(legacyCalls.length, 'a stats request fired before unlock').toBe(0)
  const legacy = await page.evaluate(() => [localStorage.getItem('tt.statskey'), localStorage.getItem('tt.statscache')])
  expect(legacy).toEqual([null, null])
  await page.getByLabel('Owner key').fill('test-key')
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.getByText('Active tokens — last 7 days')).toBeVisible()
  expect(authHeaders[0]).toBe('Bearer test-key')
  expect(legacyCalls.every((u) => !u.includes('key='))).toBe(true)
})

test('Lock clears everything and a late response cannot repopulate the page', async ({ page, context }) => {
  let delayMs = 0
  await mockStats(context)
  await context.route(/timetable-push\.ics-feed\.workers\.dev\/stats\?/, async (route) => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(legacyFixture()) })
  })
  await page.goto('./analytics.html')
  await page.getByLabel('Owner key').fill('test-key')
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.getByText('Active tokens — last 7 days')).toBeVisible()
  await page.getByRole('button', { name: '🔒 Lock' }).click()
  await expect(page.getByLabel('Owner key')).toBeVisible()
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('owner-key')
  await expect(page.getByText('Active tokens — last 7 days')).toHaveCount(0)
  // Unlock with a SLOW response, lock while in flight: the late reply is discarded.
  delayMs = 1500
  await page.getByLabel('Owner key').fill('test-key')
  await page.getByRole('button', { name: 'Unlock' }).click()
  await page.getByRole('button', { name: '🔒 Lock' }).click()
  await page.waitForTimeout(2000)
  await expect(page.getByLabel('Owner key')).toBeVisible()
  await expect(page.getByText('Active tokens — last 7 days')).toHaveCount(0)
})

test('401 relocks with an honest message; 503 names configuration, not emptiness', async ({ page, context }) => {
  let status = 401
  await mockStats(context, { legacy: () => ({ status, body: { error: 'x' } }), v2: () => ({ status: 503, body: { error: 'aggregate unavailable' } }) })
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
  await mockStats(context, {
    legacy: () => ({ status: 200, body: legacyFixture({ completeness: { scanComplete: false, missingRows: 3, invalidRows: 0 } }) }),
  })
  await page.goto('./analytics.html')
  await page.getByLabel('Owner key').fill('test-key')
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.getByText('Active tokens — last 7 days')).toBeVisible()
  // ADM-04 regression: nonzero series render segments with real pixel height.
  const heights = await page.$$eval('.chart-bar .seg-returning', (els) => els.map((e) => (e as HTMLElement).offsetHeight))
  expect(Math.max(...heights)).toBeGreaterThan(10)
  expect(heights.filter((h) => h > 0).length).toBeGreaterThan(20)
  // Honest copy on the overview.
  await expect(page.getByText('self-reported display mode, not confirmed installs')).toBeVisible()
  await expect(page.getByText(/first-seen ledger, currently no expiry/)).toBeVisible()
  await expect(page.getByText(/INCOMPLETE lower bounds/)).toBeVisible()
  await expect(page.getByText(/3 listed row\(s\) could not be read/)).toBeVisible()
  // Return-frequency naming lives on its own section now — never "tried it once".
  await page.goto('./analytics.html#returning')
  await expect(page.getByText('Observed on 1 day')).toBeVisible()
  await expect(page.getByText(/tried it once/i)).toHaveCount(0)
})

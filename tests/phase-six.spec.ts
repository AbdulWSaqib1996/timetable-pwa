import { expect, test } from './fixtures'
import type { Page, Route } from '@playwright/test'

/**
 * Phase 6 browser coverage: the future-date arrival-by intent is proven by
 * captured request fixtures; stale results cannot survive an origin change;
 * failures keep the destination usable. Network stays blocked except our
 * synthetic TfL responses.
 */

const tflJourney = (dep: string, arr: string, duration: number) => ({
  journeys: [
    {
      startDateTime: dep,
      arrivalDateTime: arr,
      duration,
      legs: [
        {
          mode: { name: 'walking' },
          duration,
          departureTime: dep,
          arrivalTime: arr,
          departurePoint: { commonName: 'Origin St' },
          arrivalPoint: { commonName: 'IOE' },
          instruction: { summary: 'Walk to IOE' },
          disruptions: [{ description: 'Planned roadworks on the route' }],
          isDisrupted: true,
        },
      ],
    },
  ],
})

async function seed(page: Page) {
  await page.clock.install({ time: new Date('2026-09-07T07:15:00Z') })
  await page.addInitScript(() => {
    localStorage.setItem('timetable.whatsnew.v1', '99')
    localStorage.setItem(
      'timetable.store.v2',
      JSON.stringify({
        activeId: 'fx',
        profiles: [
          {
            id: 'fx',
            name: 'Demo timetable',
            settings: {
              demo: true,
              sheetId: '',
              gid: null,
              specialismsChosen: true,
              checklistDismissed: true,
              usagePing: false,
              travelMode: 'transit',
              homeAddress: '1 Example Street (synthetic)',
              homeLat: 51.55,
              homeLng: -0.1,
            },
          },
        ],
      })
    )
  })
}

test('a future session gets a real arrive-by plan: date/time/timeIs in the request, Leave by in the UI', async ({ page, context }) => {
  const requests: string[] = []
  await context.route('**/api.tfl.gov.uk/Journey/**', (route: Route) => {
    requests.push(route.request().url())
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(tflJourney('2026-09-08T08:13:00', '2026-09-08T08:46:00', 33)) })
  })
  await seed(page)
  await page.setViewportSize({ width: 390, height: 844 })
  // Open tomorrow's first demo session (PS2 09:00 on 8 Sep) from the schedule.
  await page.goto('./#/schedule')
  await page.locator('.week-strip-day').nth(1).click() // Tuesday 8th
  await page.locator('.day-list .session-card').first().click()
  await page.getByRole('tab', { name: 'Travel & map' }).click()
  // The origin defaults to a saved choice (no device fix in tests) — pick campus.
  await page.getByLabel('Journey origin').selectOption('campus')
  await expect(page.getByText(/Leave by 08:13/)).toBeVisible()
  await expect(page.getByText(/planned arrival 08:46/)).toBeVisible()
  await expect(page.getByText(/\+ 10 min buffer/)).toBeVisible()
  // The provider was asked for the ACTUAL date with an arriving intent.
  const url = requests.find((u) => u.includes('timeIs=Arriving'))
  expect(url).toBeTruthy()
  expect(url).toContain('date=20260908')
  expect(url).toContain('time=0850') // 09:00 start − 10 min buffer, London wall time
  // Leg-adjacent disruption from the itinerary itself.
  await page.locator('.journey-steps summary').click()
  await expect(page.getByText('Planned roadworks on the route')).toBeVisible()
})

test('changing the arrival buffer or origin invalidates the plan (new request identity)', async ({ page, context }) => {
  const urls: string[] = []
  await context.route('**/api.tfl.gov.uk/Journey/**', (route: Route) => {
    urls.push(route.request().url())
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(tflJourney('2026-09-08T08:13:00', '2026-09-08T08:46:00', 33)) })
  })
  await seed(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./#/schedule')
  await page.locator('.week-strip-day').nth(1).click()
  await page.locator('.day-list .session-card').first().click()
  await page.getByRole('tab', { name: 'Travel & map' }).click()
  await page.getByLabel('Journey origin').selectOption('campus')
  await expect(page.getByText(/Leave by/)).toBeVisible()
  const before = urls.length
  // Buffer change → a NEW provider request with the new arrival time.
  await page.getByRole('button', { name: '20 min' }).click()
  await expect.poll(() => urls.length).toBeGreaterThan(before)
  expect(urls[urls.length - 1]).toContain('time=0840')
  // Origin change → another new request; the old result is gone meanwhile.
  const mid = urls.length
  await page.getByLabel('Journey origin').selectOption('home')
  await expect.poll(() => urls.length).toBeGreaterThan(mid)
})

test('provider failure keeps the destination usable: address, map area and external navigation', async ({ page, context }) => {
  await context.route('**/api.tfl.gov.uk/**', (route: Route) => route.abort())
  await seed(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./#/schedule')
  await page.locator('.week-strip-day').nth(1).click()
  await page.locator('.day-list .session-card').first().click()
  await page.getByRole('tab', { name: 'Travel & map' }).click()
  await page.getByLabel('Journey origin').selectOption('campus')
  await expect(page.getByText(/Couldn't reach TfL|Waiting for/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Copy address' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Open in Google Maps/ })).toBeVisible()
})

test('journey home is leave-now with an explicit origin and never a fabricated plan', async ({ page, context }) => {
  const urls: string[] = []
  await context.route('**/api.tfl.gov.uk/Journey/**', (route: Route) => {
    urls.push(route.request().url())
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(tflJourney('2026-09-07T08:20:00', '2026-09-07T08:50:00', 30)) })
  })
  await seed(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./#/home')
  await expect(page.getByLabel('Journey origin')).toBeVisible()
  await page.getByLabel('Journey origin').selectOption('campus')
  await expect(page.getByText(/live TfL/)).toBeVisible()
  // Leave-now request: no arriving intent parameter.
  expect(urls.length).toBeGreaterThan(0)
  expect(urls.every((u) => !u.includes('timeIs=Arriving'))).toBe(true)
})

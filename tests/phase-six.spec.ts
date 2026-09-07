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

test('study group: freshness-labelled members, stale never counted free, explicit proposal send, intervals-only payloads', async ({ page, context }) => {
  const NOW = Date.parse('2026-09-07T07:15:00Z')
  const bodies: Record<string, unknown>[] = []
  const groupState = {
    members: [
      { memberId: 'me1', name: 'Me', at: NOW - 5 * 60_000, slots: [{ d: '2026-09-08', from: 540, to: 1020 }] },
      { memberId: 'm2', name: 'Riya', at: NOW - 30 * 3_600_000, slots: [{ d: '2026-09-08', from: 540, to: 1020 }] },
    ],
    proposals: [] as Record<string, unknown>[],
  }
  await context.route('**/timetable-push.ics-feed.workers.dev/**', (route: Route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname
    if (req.method() === 'POST') bodies.push({ path, ...(req.postDataJSON() as Record<string, unknown>) })
    if (path === '/group' && req.method() === 'POST') {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, code: 'K7M2PQ', memberId: 'me1', token: 'tok1' }) })
    }
    if (path === '/group' && req.method() === 'GET') {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(groupState) })
    }
    if (path === '/group/propose') {
      const slot = (req.postDataJSON() as { slot: { d: string; from: number; to: number } }).slot
      const proposal = { id: 'p1', rev: 1, by: 'me1', slot, status: 'open', participants: ['me1', 'm2'], responses: { me1: 'yes' }, at: NOW }
      groupState.proposals = [proposal]
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, proposal }) })
    }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })
  await seed(page)
  await page.goto('./#/settings/timetable')
  await page.getByRole('button', { name: /Set up a study group/ }).click()
  await page.getByPlaceholder('Your display name').fill('Me')
  await page.getByRole('button', { name: 'Create a group' }).click()
  // Freshness is explicit: my row is recent, Riya's availability is 30h old
  // and she is excluded from the common slots by name.
  await expect(page.getByText('updated 5 min ago')).toBeVisible()
  await expect(page.getByText(/out of date, not counted as free/)).toBeVisible()
  await expect(page.getByText(/Not counted \(availability out of date\): Riya/)).toBeVisible()
  // Proposing is a two-step explicit send.
  await page.getByRole('button', { name: 'Propose' }).first().click()
  await expect(page.getByText(/Nothing is sent until you press Send/)).toBeVisible()
  await page.getByRole('button', { name: 'Send proposal' }).click()
  await expect(page.getByText(/by Me/)).toBeVisible()
  // Privacy: every payload that left the app carries intervals and identity
  // only — no session titles, rooms or other content fields.
  const allowed = new Set(['path', 'code', 'name', 'slots', 'tz', 'horizonDays', 'wantCredentials', 'memberId', 'token', 'slot'])
  for (const b of bodies.filter((x) => String(x.path).startsWith('/group'))) {
    expect(Object.keys(b).every((k) => allowed.has(k))).toBe(true)
    for (const s of [...((b.slots as unknown[]) ?? []), ...(b.slot ? [b.slot] : [])]) {
      expect(Object.keys(s as object).sort()).toEqual(['d', 'from', 'to'])
    }
  }
  expect(bodies.some((b) => b.path === '/group/propose')).toBe(true)
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

import { expect, test } from './fixtures'
import type { Page, Route } from '@playwright/test'

/**
 * Phase 7 browser coverage: route lines appear ONLY when the provider sent
 * geometry (P7-03), text steps stay primary, and another course applies from
 * a validated template without source-code edits (P7-01).
 */

const tflJourney = (withGeometry: boolean) => ({
  journeys: [
    {
      startDateTime: '2026-09-08T08:13:00',
      arrivalDateTime: '2026-09-08T08:46:00',
      duration: 33,
      legs: [
        {
          mode: { name: 'tube' },
          duration: 20,
          departureTime: '2026-09-08T08:13:00',
          arrivalTime: '2026-09-08T08:33:00',
          routeOptions: [{ name: 'Victoria' }],
          departurePoint: { commonName: 'Highbury', lat: 51.546, lon: -0.104 },
          arrivalPoint: { commonName: 'Euston' },
          instruction: { summary: 'Victoria line to Euston' },
          ...(withGeometry ? { path: { lineString: '[[51.546,-0.104],[51.539,-0.115],[51.528,-0.133]]' } } : {}),
        },
        {
          mode: { name: 'walking' },
          duration: 13,
          departureTime: '2026-09-08T08:33:00',
          arrivalTime: '2026-09-08T08:46:00',
          departurePoint: { commonName: 'Euston' },
          arrivalPoint: { commonName: 'IOE' },
          instruction: { summary: 'Walk to IOE' },
          ...(withGeometry ? { path: { lineString: '[[51.528,-0.133],[51.5227,-0.1276]]' } } : {}),
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
  await page.setViewportSize({ width: 390, height: 844 })
}

async function openTravelTab(page: Page) {
  await page.goto('./#/schedule')
  await page.locator('.week-strip-day').nth(1).click()
  await page.locator('.day-list .session-card').first().click()
  await page.getByRole('tab', { name: 'Travel & map' }).click()
  await page.getByLabel('Journey origin').selectOption('campus')
}

test('route map draws ONLY provider geometry, with attribution, leg highlight and no accessibility claims', async ({ page, context }) => {
  await context.route('**/api.tfl.gov.uk/Journey/**', (route: Route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(tflJourney(true)) })
  )
  await context.route('**/tile.openstreetmap.org/**', (route: Route) =>
    route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64') })
  )
  await seed(page)
  await openTravelTab(page)
  await expect(page.getByText(/Leave by 08:13/)).toBeVisible()
  // Both legs sent geometry: two polylines, fitted once, TfL + OSM attribution.
  await expect(page.locator('.route-map-overlay polyline')).toHaveCount(2)
  await expect(page.getByText('© OpenStreetMap · Powered by TfL Open Data')).toBeVisible()
  // The honest entrance note is there; no step-free/entrance claims exist.
  await expect(page.getByText(/entrances and step-free access aren't verified/)).toBeVisible()
  // Selecting a leg from the TEXT steps highlights it on the map.
  await page.locator('.journey-steps summary').click()
  const firstLeg = page.locator('.route-step-selectable').first()
  await firstLeg.click()
  await expect(firstLeg).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.route-map-overlay polyline[data-leg="0"]')).toHaveAttribute('stroke-width', '6')
})

test('geometry absent: destination-only map, complete text steps — no invented route lines', async ({ page, context }) => {
  await context.route('**/api.tfl.gov.uk/Journey/**', (route: Route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(tflJourney(false)) })
  )
  await seed(page)
  await openTravelTab(page)
  await expect(page.getByText(/Leave by 08:13/)).toBeVisible()
  await expect(page.locator('.route-map-overlay polyline')).toHaveCount(0)
  await expect(page.locator('.static-map')).toBeVisible()
  await page.locator('.journey-steps summary').click()
  await expect(page.getByText('Highbury → Euston')).toBeVisible()
  await expect(page.getByText('Walk to IOE')).toBeVisible()
})

const NYU_TEMPLATE = {
  configId: 'nyu-teaching-residency',
  version: 1,
  name: 'NYU Teaching Residency',
  timezone: 'America/New_York',
  terminology: { specialism: 'Concentration', group: 'Cohort' },
  campus: { label: 'NYU Steinhardt', lat: 40.7295, lng: -73.9965, searchSuffix: 'NYU New York' },
  buildings: [{ name: 'Pless Hall', keywords: ['pless'], lat: 40.7308, lng: -73.9946 }],
  features: { placement: true, pgceFile: false },
}

test('another course applies from a validated template: preview, feature flags, campus and honest unknown rooms', async ({ page }) => {
  await seed(page)
  await page.goto('./#/settings/timetable')
  await expect(page.getByText(/UCL Primary PGCE · timezone Europe\/London/)).toBeVisible()
  await page.getByRole('button', { name: '🎓 Course setup' }).click()
  await page.getByRole('button', { name: 'Import template…' }).click()
  // An invalid template is refused with reasons, nothing applied.
  await page.getByLabel('Course template JSON').fill('{"configId": "x"}')
  await page.getByRole('button', { name: 'Check template' }).click()
  await expect(page.getByLabel('Template problems')).toBeVisible()
  // The real template previews, then applies.
  await page.getByLabel('Course template JSON').fill(JSON.stringify(NYU_TEMPLATE))
  await page.getByRole('button', { name: 'Check template' }).click()
  await expect(page.getByRole('heading', { name: 'Preview' })).toBeVisible()
  await expect(page.locator('.keydate-line').getByText('NYU Steinhardt')).toBeVisible()
  await page.getByRole('button', { name: 'Apply this course' }).click()
  await expect(page.getByText('NYU Teaching Residency', { exact: false }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Close' }).click()
  // Feature flag: the PGCE file destination is gone from the shell.
  await expect(page.getByText('PGCE file')).toHaveCount(0)
  // Terminology follows the course in filters.
  await page.goto('./#/schedule')
  await page.getByRole('button', { name: 'Filters' }).click()
  await expect(page.getByText(/concentrations \(membership\)/i)).toBeVisible()
  await page.getByRole('button', { name: 'Close' }).click()
  // Unknown room (UCL demo rooms don't match NYU buildings): raw text stays,
  // external search uses the configured suffix — never a wrong-campus guess.
  await page.locator('.week-strip-day').nth(1).click()
  await page.locator('.day-list .session-card').first().click()
  await page.getByRole('tab', { name: 'Travel & map' }).click()
  await expect(page.getByText('No map match for this location', { exact: false })).toBeVisible()
  const maps = page.getByRole('link', { name: /Open in Google Maps/ })
  await expect(maps).toHaveAttribute('href', /NYU%20New%20York/)
  // Switching back to the built-in restores everything.
  await page.goto('./#/settings/timetable')
  await page.getByRole('button', { name: '🎓 Course setup' }).click()
  await page.getByRole('button', { name: 'Switch back to UCL Primary PGCE' }).click()
  await page.getByRole('button', { name: 'Close' }).click()
  await page.goto('./#/today')
  await expect(page.getByText('PGCE file').first()).toBeVisible()
})

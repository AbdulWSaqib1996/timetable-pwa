import { expect, test } from './fixtures'
import type { Page, Route } from '@playwright/test'
import { mockStats, v2Fixture } from './admin-fixtures'

/**
 * A4 coverage (Pass 48): capability-2 events fire at REAL success points
 * exactly once, stay content-free, and the dashboard renders cohorts and
 * v2 adoption honestly. All worker traffic is mocked.
 */

async function seedRealProfile(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('timetable.whatsnew.v1', '99')
    if (localStorage.getItem('timetable.store.v2')) return
    localStorage.setItem(
      'timetable.store.v2',
      JSON.stringify({
        activeId: 'fx',
        profiles: [
          {
            id: 'fx',
            name: 'My timetable',
            settings: { demo: false, sheetId: 'FIXTURESHEET', gid: null, specialismsChosen: true, checklistDismissed: true },
          },
        ],
      })
    )
  })
  await page.setViewportSize({ width: 390, height: 844 })
}

const collectCounts = (bodies: Record<string, unknown>[]) => {
  const totals: Record<string, number> = {}
  for (const b of bodies) {
    for (const d of (b.days as { counts: Record<string, number> }[]) ?? []) {
      for (const [k, n] of Object.entries(d.counts ?? {})) totals[k] = (totals[k] ?? 0) + n
    }
  }
  return totals
}

test('route views and task create/complete fire exactly once at their success points, content-free', async ({ page, context }) => {
  const bodies: Record<string, unknown>[] = []
  await context.route('**/timetable-push.ics-feed.workers.dev/v2/batch', (route: Route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    bodies.push(body)
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, acked: body.batchId }) })
  })
  await seedRealProfile(page)
  // Dwell briefly on each destination — the queue write is asynchronous and
  // a same-tick navigation can outrun it (as a real bounce would).
  await page.goto('./#/today')
  await page.waitForTimeout(300)
  await page.goto('./#/schedule')
  await page.waitForTimeout(300)
  await page.goto('./#/tasks')
  await page.waitForTimeout(300)
  // Create a task through the real UI; the event fires on successful save.
  await page.getByRole('button', { name: /Add task/ }).click()
  await page.getByLabel('Title').fill('Fixture task — private text that must never leave')
  await page.locator('input[type="date"]').first().fill('2026-09-30')
  await page.getByRole('button', { name: 'Save task' }).click()
  await expect(page.getByText('Fixture task', { exact: false }).first()).toBeVisible()
  await page.reload()
  // Navigations flush incrementally, so poll until the created task's batch
  // has actually landed rather than reading after the first partial flush.
  await expect.poll(() => collectCounts(bodies).task_created, { timeout: 10000 }).toBe(1)
  let totals = collectCounts(bodies)
  expect(totals.view_today).toBeGreaterThanOrEqual(1)
  expect(totals.view_schedule).toBe(1)
  expect(totals.view_tasks).toBeGreaterThanOrEqual(1)
  expect(totals.task_completed).toBeUndefined()
  // Complete it: exactly one completion, no second creation, EDIT is not a create.
  await page.getByText('Fixture task', { exact: false }).first().click()
  await page.getByRole('button', { name: '✓ Done' }).click()
  await page.getByRole('button', { name: 'Save task' }).click()
  await expect(page.getByRole('heading', { name: 'Edit task' })).toHaveCount(0)
  await page.reload()
  await expect.poll(() => collectCounts(bodies).task_completed, { timeout: 10000 }).toBe(1)
  totals = collectCounts(bodies)
  expect(totals.task_created).toBe(1)
  // Privacy: the task title never left the device in any payload.
  expect(JSON.stringify(bodies)).not.toContain('private text')
})

const cohortFixture = () => {
  const monday = (weeksAgo: number) => {
    const now = new Date()
    const day = (now.getUTCDay() + 6) % 7
    const thisMonday = new Date(now.getTime() - day * 86400000)
    return new Date(thisMonday.getTime() - weeksAgo * 7 * 86400000).toISOString().slice(0, 10)
  }
  return {
    ...v2Fixture(),
    features: [
      {
        id: 'task_created',
        contractVersion: 2,
        collectionStartedAt: monday(1),
        measurement: 'available',
        adoption: { value: 75, status: 'complete', definition: 'x', numerator: 3, denominator: 4, eligibleCoverage: { eligible: 4, active: 6 } },
        uses: { value: 5, status: 'complete', definition: 'x' },
      },
    ],
    cohorts: [
      {
        week: monday(5),
        size: 40,
        complete: true,
        weeks: [
          { n: 1, complete: true, returned: 22 },
          { n: 2, complete: true, returned: 15 },
          { n: 3, complete: true, returned: 12 },
          { n: 4, complete: true, returned: 9 },
        ],
      },
      {
        week: monday(2),
        size: 3,
        complete: true,
        weeks: [
          { n: 1, complete: true, returned: 2 },
          { n: 2, complete: false, returned: null },
          { n: 3, complete: false, returned: null },
          { n: 4, complete: false, returned: null },
        ],
      },
      {
        week: monday(0),
        size: 6,
        complete: false,
        weeks: [1, 2, 3, 4].map((n) => ({ n, complete: false, returned: null })),
      },
    ],
  }
}

test('cohort table: percentages need size AND complete weeks; small cohorts and open weeks stay honest', async ({ page, context }) => {
  await mockStats(context, { v2: () => ({ status: 200, body: cohortFixture() }) })
  await page.goto('./analytics.html#returning')
  await page.getByLabel('Owner key').fill('test-key')
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.getByRole('heading', { name: 'Return visits' })).toBeVisible()
  // Healthy complete cohort: headline % with numerator/denominator.
  await expect(page.getByText('55% (22/40)')).toBeVisible()
  // Small cohort: counts only, labelled, no manufactured percentage.
  await expect(page.getByText('Small cohort')).toBeVisible()
  await expect(page.getByText('2/3', { exact: true })).toBeVisible()
  await expect(page.getByText('67%')).toHaveCount(0)
  // Open weeks and the forming cohort are dashes, never zeros.
  await expect(page.getByText('forming')).toBeVisible()
  expect(await page.getByText('Not complete').count()).toBeGreaterThan(3)
  // Frequency stays as its own labelled measure below.
  await expect(page.getByText('Frequency vs cohorts')).toBeVisible()
})

test('adoption takes v2 numbers per feature once real observations exist', async ({ page, context }) => {
  await mockStats(context, { v2: () => ({ status: 200, body: cohortFixture() }) })
  await page.goto('./analytics.html#adoption')
  await page.getByLabel('Owner key').fill('test-key')
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.getByRole('heading', { name: 'Feature adoption' })).toBeVisible()
  const row = page.getByRole('row', { name: /Task created/ })
  await expect(row).toContainText('v2 event-day since')
  await expect(row).toContainText('3/4')
  await expect(row).toContainText('75%')
  // Legacy rows keep their received-day labelling alongside.
  await expect(page.getByRole('row', { name: /Session details/ })).toContainText('received')
})

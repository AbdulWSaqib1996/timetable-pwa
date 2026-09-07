import { expect, test } from './fixtures'
import type { Page, Route } from '@playwright/test'

/**
 * A2 browser coverage (Pass 46): the v2 telemetry client sends validated,
 * observed-day batches; a failed send retries the SAME immutable batch;
 * opt-out clears pending collection; nothing private ever leaves. All worker
 * traffic is mocked.
 */

async function seedRealProfile(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('timetable.whatsnew.v1', '99')
    // Init scripts re-run on every navigation: seed ONCE so in-test settings
    // changes (like the opt-out toggle) survive reloads.
    if (localStorage.getItem('timetable.store.v2')) return
    localStorage.setItem(
      'timetable.store.v2',
      JSON.stringify({
        activeId: 'fx',
        profiles: [
          {
            id: 'fx',
            name: 'My timetable',
            settings: {
              // NOT a demo profile: telemetry consent is on by default.
              demo: false,
              sheetId: 'FIXTURESHEET',
              gid: null,
              specialismsChosen: true,
              checklistDismissed: true,
              homeAddress: '7 Private Street — must never appear in telemetry',
            },
          },
        ],
      })
    )
  })
  await page.setViewportSize({ width: 390, height: 844 })
}

const todayUTC = () => new Date().toISOString().slice(0, 10)

function captureBatches(bodies: Record<string, unknown>[], status: () => number) {
  return (route: Route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    bodies.push(body)
    const s = status()
    return route.fulfill({
      status: s,
      contentType: 'application/json',
      body: JSON.stringify(s === 200 ? { ok: true, acked: body.batchId } : { error: 'boom' }),
    })
  }
}

test('batches carry observed UTC days, a valid envelope and nothing private', async ({ page, context }) => {
  const bodies: Record<string, unknown>[] = []
  await context.route('**/timetable-push.ics-feed.workers.dev/v2/batch', captureBatches(bodies, () => 200))
  await seedRealProfile(page)
  await page.goto('./#/today')
  await expect.poll(() => bodies.length, { timeout: 10000 }).toBeGreaterThan(0)
  const first = bodies[0]
  expect(first.schemaVersion).toBe(2)
  expect(String(first.batchId)).toMatch(/^[0-9a-f]{16,32}$/)
  expect(String(first.token)).toMatch(/^[0-9a-f]{8,32}$/)
  const days = first.days as { date: string; opens: number; counts: Record<string, number> }[]
  expect(days[0].date).toBe(todayUTC())
  expect(days[0].opens).toBeGreaterThan(0)
  // A feature use recorded AFTER the first flush travels later, still dated.
  await page.goto('./#/session/whatever')
  await page.reload()
  await expect.poll(() => bodies.length, { timeout: 10000 }).toBeGreaterThan(1)
  const withDetail = bodies.find((b) => (b.days as { counts: Record<string, number> }[])?.some((d) => d.counts?.detail))
  expect(withDetail).toBeTruthy()
  expect(withDetail!.batchId).not.toBe(first.batchId)
  // Privacy sweep: the serialized payloads carry counters and identity only.
  for (const b of bodies) {
    expect(Object.keys(b).sort()).toEqual(['batchId', 'buildId', 'capabilityVersion', 'days', 'platform', 'schemaVersion', 'standalone', 'token'])
    const json = JSON.stringify(b)
    expect(json).not.toContain('Private Street')
    expect(json).not.toContain('FIXTURESHEET')
    expect(json).not.toContain('My timetable')
  }
})

test('a failed send retries the SAME immutable batchId; the ack finally clears it', async ({ page, context }) => {
  const bodies: Record<string, unknown>[] = []
  let status = 500
  await context.route('**/timetable-push.ics-feed.workers.dev/v2/batch', captureBatches(bodies, () => status))
  await seedRealProfile(page)
  await page.goto('./#/today')
  await expect.poll(() => bodies.length, { timeout: 10000 }).toBeGreaterThan(0)
  const failedId = bodies[0].batchId
  // The server said 500: the claimed batch stays frozen. A fresh app start
  // resends the SAME batch — the server's dedupe makes replays harmless.
  status = 200
  await page.reload()
  await expect.poll(() => bodies.length, { timeout: 10000 }).toBeGreaterThan(1)
  expect(bodies[1].batchId).toBe(failedId)
  expect(JSON.stringify(bodies[1].days)).toBe(JSON.stringify(bodies[0].days))
  // Acknowledged: another restart has nothing old to send (either silence or
  // a batch that only contains the new open, under a NEW id).
  await page.reload()
  await page.waitForTimeout(1000)
  const later = bodies.slice(2)
  expect(later.every((b) => b.batchId !== failedId)).toBe(true)
})

test('switching the usage toggle off clears pending counters and stops collection', async ({ page, context }) => {
  const bodies: Record<string, unknown>[] = []
  let status = 500 // keep everything pending so there is something to clear
  await context.route('**/timetable-push.ics-feed.workers.dev/v2/batch', captureBatches(bodies, () => status))
  await seedRealProfile(page)
  await page.goto('./#/session/whatever') // records a 'detail' use
  await expect.poll(() => bodies.length, { timeout: 10000 }).toBeGreaterThan(0)
  // Opt out via the real Settings toggle.
  await page.goto('./#/settings/help')
  await page.getByLabel('Share anonymous usage counts').uncheck()
  await expect(page.getByText(/Switching this off clears anything not yet sent/)).toBeVisible()
  status = 200
  const before = bodies.length
  await page.reload()
  await page.waitForTimeout(1500)
  // Consent off: no batch may leave, and the previously pending 'detail'
  // counter is gone for good.
  expect(bodies.length).toBe(before)
  // Re-enabling starts a FRESH generation: the old counters never resurface.
  await page.goto('./#/settings/help')
  await page.getByLabel('Share anonymous usage counts').check()
  await page.reload()
  await page.waitForTimeout(1500)
  const resent = bodies.slice(before)
  expect(resent.every((b) => !JSON.stringify(b).includes('"detail"'))).toBe(true)
})

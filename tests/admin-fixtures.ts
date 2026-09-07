import type { BrowserContext, Route } from '@playwright/test'

/** Synthetic stats fixtures shared by the admin dashboard specs. */

export const legacyFixture = (overrides: Record<string, unknown> = {}) => {
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
    features: { detail: { uses: 384, devices: 92 }, photo: { uses: 12, devices: 9 }, week: { uses: 40, devices: 20 } },
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

export const v2Fixture = () => {
  const today = new Date().toISOString().slice(0, 10)
  const count = (value: number | null, definition = 'x') => ({ value, status: 'complete', definition })
  return {
    schemaVersion: 2,
    snapshotId: 'fixture01',
    generatedAt: new Date().toISOString(),
    observedThrough: today,
    period: { from: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10), to: today, timezone: 'UTC', includesPartialToday: true },
    source: 'event-day-v2',
    completeness: { status: 'complete', missingRows: 0, invalidRows: 0, scanComplete: true, reasons: [] },
    metrics: { activeTokens7: count(3), activeTokens30: count(3), activeToday: { ...count(2), status: 'partial' } },
    daily: [{ date: today, active: count(2), new: count(1), returning: count(1) }],
    features: [
      {
        id: 'task_created',
        contractVersion: 2,
        collectionStartedAt: null,
        measurement: 'not-collected',
        adoption: { value: null, status: 'unavailable', definition: 'x', numerator: null, denominator: null, eligibleCoverage: null },
        uses: { value: null, status: 'unavailable', definition: 'x' },
      },
    ],
  }
}

export async function mockStats(
  context: BrowserContext,
  opts: { legacy?: () => { status: number; body: unknown }; v2?: () => { status: number; body: unknown } } = {}
): Promise<{ legacyCalls: string[] }> {
  const legacyCalls: string[] = []
  await context.route(/timetable-push\.ics-feed\.workers\.dev\/stats\?/, (route: Route) => {
    legacyCalls.push(route.request().url())
    const r = opts.legacy?.() ?? { status: 200, body: legacyFixture() }
    return route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.body) })
  })
  await context.route(/timetable-push\.ics-feed\.workers\.dev\/stats\/v2/, (route: Route) => {
    const r = opts.v2?.() ?? { status: 200, body: v2Fixture() }
    return route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.body) })
  })
  return { legacyCalls }
}

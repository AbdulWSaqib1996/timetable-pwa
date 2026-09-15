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
    metrics: {
      activeTokens7: count(124, 'distinct tokens, fixed last 7 UTC days incl. partial today'),
      activeTokens30: count(131, 'distinct tokens, fixed last 30 UTC days incl. partial today'),
      tokensEver: count(140, 'tokens ever observed under v2 collection'),
      newTokensWindow: count(9),
      activeToday: { ...count(38), status: 'partial' },
      standaloneToday: { value: 63, status: 'partial', definition: 'x', numerator: 24, denominator: 38, eligibleCoverage: { eligible: 38, active: 38 } },
    },
    daily: Array.from({ length: 31 }, (_, i) => {
      const date = new Date(Date.now() - (30 - i) * 86400000).toISOString().slice(0, 10)
      return { date, active: count(i === 30 ? 38 : 20 + (i % 9)), new: count(i % 5), returning: count(i === 30 ? 34 : 18) }
    }),
    setup: { tokens: 30, known: { push: 26, location: 20 }, on: { push: 18, location: 5 }, definition: 'setup coverage' },
    frequency: { tokens: 124, oneDay: 41, twoToFourDays: 52, fivePlusDays: 31, definition: 'distinct observed days per token' },
    reliability: {
      thresholds: { staleAfterMinutes: 30, rejectRatePct: 2, minAttempts: 100 },
      lastAcceptedAt: Date.now() - 5 * 60_000,
      days: Array.from({ length: 7 }, (_, i) => ({
        date: new Date(Date.now() - (6 - i) * 86400000).toISOString().slice(0, 10),
        accepted: 140,
        duplicate: 3,
        rejected: 1,
        oversize: 0,
        rateLimited: 0,
      })),
      lastCompleteDay: { date: new Date(Date.now() - 86400000).toISOString().slice(0, 10), attempts: 144, refused: 1, rateLimited: 0, ratePct: 0.7, status: 'ok' },
    },
    builds: {
      activeTokens: 30,
      list: [
        { buildId: '7af3942', tokens: 24, sharePct: 80, firstObserved: today, comparison: { periodFrom: 'x', periodTo: 'y', eligibleTokens: 24, opensPerToken: 3.4 } },
        { buildId: '5c924c3', tokens: 4, sharePct: 13, firstObserved: today, comparison: { unavailable: true, eligibleTokens: 4, minimum: 20 } },
        { buildId: 'unknown', tokens: 2, sharePct: 7, firstObserved: null, comparison: { unavailable: true, eligibleTokens: 2, minimum: 20 } },
      ],
    },
    features: [
      {
        id: 'detail',
        contractVersion: 1,
        collectionStartedAt: new Date(Date.now() - 20 * 86400000).toISOString().slice(0, 10),
        measurement: 'available',
        adoption: { value: 74, status: 'complete', definition: 'x', numerator: 92, denominator: 124, eligibleCoverage: { eligible: 124, active: 124 } },
        uses: { value: 384, status: 'complete', definition: 'x' },
      },
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
): Promise<{ legacyCalls: string[]; v2Calls: string[] }> {
  const legacyCalls: string[] = []
  const v2Calls: string[] = []
  await context.route(/timetable-push\.ics-feed\.workers\.dev\/stats\?/, (route: Route) => {
    legacyCalls.push(route.request().url())
    const r = opts.legacy?.() ?? { status: 200, body: legacyFixture() }
    return route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.body) })
  })
  await context.route(/timetable-push\.ics-feed\.workers\.dev\/stats\/v2/, (route: Route) => {
    v2Calls.push(route.request().url())
    const r = opts.v2?.() ?? { status: 200, body: v2Fixture() }
    return route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.body) })
  })
  return { legacyCalls, v2Calls }
}

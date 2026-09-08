import { validateStatsV2 } from '../../../shared/analytics-contracts.js'

/**
 * Authenticated stats client (A3 / ADM-15): Bearer header only, bounded
 * timeout, typed failures and response-shape validation — a malformed or
 * unexpected body becomes a typed 'invalid' failure, never rendered markup.
 */

export const STATS_BASE = 'https://timetable-push.ics-feed.workers.dev'
const TIMEOUT_MS = 15_000

export type StatsFailure =
  | { kind: 'unauthorized' }
  | { kind: 'config' }
  | { kind: 'no-aggregate' }
  | { kind: 'rate'; retryAfterS: number }
  | { kind: 'network' }
  | { kind: 'invalid' }

export class StatsError extends Error {
  failure: StatsFailure
  constructor(failure: StatsFailure) {
    super(failure.kind)
    this.failure = failure
  }
}

export interface LegacyDaily {
  date: string
  active: number
  listed?: number
  installed: number
  newDevices: number
  platforms: Record<string, number>
}

export interface LegacyStats {
  generatedAt: string
  windowDays: number
  timezone?: string
  includesPartialToday?: boolean
  completeness?: { scanComplete: boolean; missingRows: number; invalidRows: number }
  totalDevicesEver: number
  activeLast7Days: number
  activeLast30Days: number
  todayVersions: Record<string, number>
  retention: { oneDay: number; twoToFourDays: number; fivePlusDays: number }
  features: Record<string, { uses: number; devices: number }>
  opensLast7Days: number
  setup: { devices: number; counts: Record<string, number>; known?: Record<string, number> }
  daily: LegacyDaily[]
}

async function request(path: string, key: string, signal: AbortSignal | undefined): Promise<unknown> {
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), TIMEOUT_MS)
  const onOuter = () => timeout.abort()
  signal?.addEventListener('abort', onOuter)
  let res: Response
  try {
    res = await fetch(`${STATS_BASE}${path}`, {
      headers: { authorization: `Bearer ${key}` },
      signal: timeout.signal,
    })
  } catch (err) {
    if (signal?.aborted) throw err // superseded — caller discards silently
    throw new StatsError({ kind: 'network' })
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onOuter)
  }
  if (res.status === 401) throw new StatsError({ kind: 'unauthorized' })
  if (res.status === 429) {
    const after = Number(res.headers.get('retry-after'))
    throw new StatsError({ kind: 'rate', retryAfterS: Number.isFinite(after) && after > 0 ? after : 60 })
  }
  if (res.status === 503) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new StatsError({ kind: body?.error === 'aggregate unavailable' ? 'no-aggregate' : 'config' })
  }
  if (!res.ok) throw new StatsError({ kind: 'network' })
  try {
    return await res.json()
  } catch {
    throw new StatsError({ kind: 'invalid' })
  }
}

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

function validateLegacy(d: unknown): LegacyStats {
  const o = d as LegacyStats
  if (
    !o ||
    typeof o !== 'object' ||
    !Array.isArray(o.daily) ||
    !isNum(o.activeLast7Days) ||
    !isNum(o.activeLast30Days) ||
    !isNum(o.totalDevicesEver) ||
    !o.retention ||
    typeof o.features !== 'object' ||
    o.daily.some((x) => typeof x.date !== 'string' || !isNum(x.active) || x.active < 0)
  ) {
    throw new StatsError({ kind: 'invalid' })
  }
  return o
}

export async function fetchLegacyStats(key: string, days: number, signal?: AbortSignal): Promise<LegacyStats> {
  return validateLegacy(await request(`/stats?days=${days}`, key, signal))
}

export interface StatsV2Count {
  value: number | null
  status: 'complete' | 'partial' | 'unavailable'
  definition: string
}
export interface StatsV2Ratio extends StatsV2Count {
  numerator: number | null
  denominator: number | null
  eligibleCoverage: { eligible: number; active: number } | null
}
export interface StatsV2 {
  schemaVersion: 2
  snapshotId: string
  generatedAt: string
  observedThrough: string | null
  period: { from: string; to: string; timezone: 'UTC'; includesPartialToday: boolean }
  source: string
  completeness: { status: string; missingRows: number; invalidRows: number; scanComplete: boolean; reasons: string[] }
  metrics: Record<string, StatsV2Count | StatsV2Ratio>
  daily: { date: string; active: StatsV2Count; new: StatsV2Count; returning: StatsV2Count }[]
  features: {
    id: string
    contractVersion: number
    collectionStartedAt: string | null
    measurement: 'available' | 'legacy' | 'not-collected'
    adoption: StatsV2Ratio
    uses: StatsV2Count
  }[]
  /** reliability diagnostics (A5); absent from pre-A5 snapshots */
  reliability?: {
    thresholds: { staleAfterMinutes: number; rejectRatePct: number; minAttempts: number }
    lastAcceptedAt: number | null
    days: { date: string; accepted: number; duplicate: number; rejected: number; oversize: number; rateLimited: number }[]
    lastCompleteDay: { date: string; attempts: number; refused: number; rateLimited: number; ratePct: number | null; status: 'ok' | 'alert' | 'insufficient' }
  }
  /** release coverage (A5); absent from pre-A5 snapshots */
  builds?: {
    activeTokens: number
    list: {
      buildId: string
      tokens: number
      sharePct: number | null
      firstObserved: string | null
      comparison:
        | { periodFrom: string; periodTo: string; eligibleTokens: number; opensPerToken: number }
        | { unavailable: true; eligibleTokens: number; minimum: number }
    }[]
  }
  /** weekly cohorts (A4); absent from pre-A4 snapshots */
  cohorts?: {
    week: string
    size: number
    complete: boolean
    weeks: { n: number; complete: boolean; returned: number | null }[]
  }[]
}

export async function fetchV2Stats(key: string, signal?: AbortSignal): Promise<StatsV2> {
  const body = await request('/stats/v2?section=overview', key, signal)
  if (!validateStatsV2(body)) throw new StatsError({ kind: 'invalid' })
  return body as StatsV2
}

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
  /** when the published numbers last CHANGED (the copy is only republished on change) */
  generatedAt: string
  /** last successful snapshot-job run, changed or not; absent on older workers */
  checkedAt?: string
  observedThrough: string | null
  period: { from: string; to: string; timezone: 'UTC'; includesPartialToday: boolean }
  source: string
  completeness: { status: string; missingRows: number; invalidRows: number; scanComplete: boolean; reasons: string[] }
  metrics: Record<string, StatsV2Count | StatsV2Ratio>
  daily: { date: string; active: StatsV2Count; new: StatsV2Count; returning: StatsV2Count }[]
  /** setup coverage under v2 (16 Sep 2026); absent from older snapshots */
  setup?: { tokens: number; known: Record<string, number>; on: Record<string, number>; definition?: string }
  /** return frequency under v2 (16 Sep 2026); absent from older snapshots */
  frequency?: { tokens: number; oneDay: number; twoToFourDays: number; fivePlusDays: number; definition?: string }
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

/** Job freshness: the last successful run, falling back to the last publish. */
export function freshnessISO(v2: StatsV2): string {
  return v2.checkedAt ?? v2.generatedAt
}

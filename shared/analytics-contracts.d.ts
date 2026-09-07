export const ANALYTICS_SCHEMA_VERSION: 2
export const CAPABILITY_VERSION: number
export const ACTION_CATALOGUE: Record<string, { label: string; semantics: 'view' | 'attempt' | 'success'; since: number }>
export const SETUP_FLAGS: readonly string[]
export const PLATFORMS: readonly string[]
export const MAX_BATCH_BYTES: number
export const MAX_DAYS_PER_BATCH: number
export const MAX_COUNT: number
export const MAX_EVENTS_PER_VERSION: number
export const QUEUE_RETENTION_DAYS: number
export const DEDUPE_HORIZON_DAYS: number
export const MAX_FUTURE_SKEW_DAYS: number

export interface BatchDay {
  date: string
  opens: number
  counts: Record<string, number>
  setup?: Record<string, boolean>
}

export interface AnalyticsBatch {
  schemaVersion: 2
  token: string
  batchId: string
  buildId: string
  capabilityVersion: number
  platform: string
  standalone: boolean | null
  days: BatchDay[]
}

export function allowedEvents(capabilityVersion: number): string[]
export function validateBatch(
  input: unknown,
  opts?: { todayISO?: string }
): { ok: boolean; errors: string[]; batch: AnalyticsBatch | null }
export function validateStatsV2(input: unknown): boolean

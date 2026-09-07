export interface PlannedSource {
  id: string
  kind: 'timetable' | 'extra' | 'keydates'
  label: string
  sheetId: string
  gid: string | null
}
export interface SourceStatus extends PlannedSource {
  status: 'ok' | 'stale' | 'error'
  warnings: string[]
  error?: string
  lastAttemptAt: number
  lastSuccessAt: number | null
}
export interface SourceResult<Row> {
  ok: boolean
  rows?: Row[]
  warnings?: string[]
  error?: string
}
export function planSources(settings: {
  demo?: boolean
  sheetId?: string
  gid?: string | null
  extraTabs?: { sheetId: string; gid: string | null }[]
  keyDatesSheetId?: string
  keyDatesGid?: string | null
} | null): PlannedSource[]
export function sourceKeyOf(src: { sheetId: string; gid: string | null }): string
export function resolveSourceResults<Row extends { sourceKey?: string }>(
  plan: PlannedSource[],
  results: Record<string, SourceResult<Row>>,
  prevRows?: Row[],
  nowMs?: number
): { bySource: Map<string, Row[]>; statuses: SourceStatus[]; warnings: string[] }
export function createGenerationGate(): {
  begin(): { gen: number; isCurrent: () => boolean }
  current(): number
}

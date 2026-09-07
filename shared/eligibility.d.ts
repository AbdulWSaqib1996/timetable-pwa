export function isPlacementTitle(title: string | undefined): boolean
export function placementTagOf(title: string | undefined): string
export function isEligibleSession(s: { isKeyDate?: boolean; isSelfStudy?: boolean; title: string }): boolean
export function isCompleted(
  s: { dateISO: string; start?: string; end?: string },
  todayISO: string,
  nowMinutes?: number | null
): boolean
export interface AttendanceSummary {
  eligible: number
  attended: number
  absent: number
  unrecorded: number
  attendedPct: number | null
  sentence: string
}
export function attendanceSummary<S extends { dateISO: string; title: string }>(
  sessions: S[],
  metaOf: (s: S) => { attended?: boolean; absent?: boolean; deleted?: boolean } | undefined,
  todayISO: string,
  nowMinutes?: number | null
): AttendanceSummary
export interface PlacementBlockSummary {
  tag: string
  total: number
  attended: number
  inferred: number
}
export function placementDaySummary<S extends { dateISO: string; title: string; id?: string }>(
  sessions: S[],
  metaOf: (s: S) => { attended?: boolean; deleted?: boolean } | undefined
): { blocks: PlacementBlockSummary[]; totalDays: number; attendedDays: number; inferredDays: number }

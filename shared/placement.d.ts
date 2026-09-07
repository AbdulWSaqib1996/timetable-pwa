export interface PlacementPolicy {
  start: string
  end: string
  breakMins: number
  insetCounts: boolean
}
export interface PlacementExceptionLike {
  id: string
  tag: string
  dateISO: string
  kind: 'holiday' | 'inset' | 'part-day' | 'cancelled' | 'hours'
  startTime?: string
  endTime?: string
  loggedMins?: number
  note?: string
  at: number
}
export interface PlacementDayView {
  dateISO: string
  tag: string
  inferred: boolean
  exception?: PlacementExceptionLike
  excluded: boolean
  plannedMins: number
  loggedMins: number | null
  loggedFrom: 'correction' | 'day-tick' | null
  attended: boolean
  absent: boolean
}
export interface PlacementBlockView {
  tag: string
  days: PlacementDayView[]
  plannedDays: number
  plannedMins: number
  loggedDays: number
  loggedMins: number
  inferredDays: number
  excludedDays: number
}
export function placementPolicyOf(settings: unknown): PlacementPolicy
export function exceptionFor(
  exceptions: PlacementExceptionLike[] | undefined,
  tag: string,
  dateISO: string
): PlacementExceptionLike | undefined
export function isExcluded(exception: PlacementExceptionLike | undefined, policy: PlacementPolicy): boolean
export function applyPlacementExceptionRules<T extends { title: string; dateISO: string; isKeyDate?: boolean }>(
  sessions: T[],
  exceptions: PlacementExceptionLike[] | undefined,
  settings: unknown
): T[]
export function computePlacementBlocks<S extends { title: string; dateISO: string; id?: string; start?: string; end?: string; isKeyDate?: boolean }>(
  sessions: S[],
  exceptions: PlacementExceptionLike[] | undefined,
  settings: unknown,
  metaOf: (s: S) => { attended?: boolean; absent?: boolean; deleted?: boolean } | undefined
): PlacementBlockView[]

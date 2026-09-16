export interface PlacementPolicy {
  start: string
  end: string
  breakMins: number
  insetCounts: boolean
  /** which record the hours/inset choice came from */
  source: 'profile' | 'placement'
}
export interface PlacementLike { mappedBlockTags?: string[]; workingHours?: { start: string; end: string }; insetCountsAsSchoolDay?: boolean }
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
export function placementPolicyOf(settings: unknown, placement?: PlacementLike | null): PlacementPolicy
export function placementOwning<P extends PlacementLike>(placements: P[] | undefined, tag: string): P | null
export function resolvePolicy(tag: string, settings: unknown, placements?: PlacementLike[]): PlacementPolicy
export function validateWorkingHours(hours: { start?: string; end?: string } | undefined | null): string | null
export function normaliseAddress(address: string | undefined | null): string
export function locationCurrent(school: { address?: string; lat?: number; lng?: number; locatedFor?: string } | undefined | null): boolean
export function exceptionFor(
  exceptions: PlacementExceptionLike[] | undefined,
  tag: string,
  dateISO: string
): PlacementExceptionLike | undefined
export function isExcluded(exception: PlacementExceptionLike | undefined, policy: PlacementPolicy): boolean
export function applyPlacementExceptionRules<T extends { title: string; dateISO: string; isKeyDate?: boolean }>(
  sessions: T[],
  exceptions: PlacementExceptionLike[] | undefined,
  settings: unknown,
  placements?: PlacementLike[]
): T[]
export function computePlacementBlocks<S extends { title: string; dateISO: string; id?: string; start?: string; end?: string; isKeyDate?: boolean }>(
  sessions: S[],
  exceptions: PlacementExceptionLike[] | undefined,
  settings: unknown,
  metaOf: (s: S) => { attended?: boolean; absent?: boolean; deleted?: boolean } | undefined,
  placements?: PlacementLike[]
): PlacementBlockView[]

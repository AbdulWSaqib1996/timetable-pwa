export interface FreeSlot {
  d: string
  from: number
  to: number
}

export interface AvailabilityMemberLike {
  memberId?: string
  name: string
  at: number
  slots: FreeSlot[]
  tz?: string
}

export interface ExcludedMember {
  memberId?: string
  name: string
  reason: 'stale' | 'missing'
}

export interface ProposalSlotLike {
  id: string
  slot: FreeSlot
}

export const AVAILABILITY_FRESH_MS: number
export const DEFAULT_WORK_START: number
export const DEFAULT_WORK_END: number
export const DEFAULT_MIN_MEETING: number

export function memberFreshness(member: { at?: number; slots?: unknown } | null | undefined, nowMs: number): 'fresh' | 'stale' | 'missing'
export function lastUpdatedLabel(atMs: number, nowMs: number): string
export function computeFreeIntervals(
  busy: FreeSlot[],
  opts?: { todayISO?: string; days?: number; workStart?: number; workEnd?: number; minMinutes?: number }
): FreeSlot[]
export function slotsToZone(slots: FreeSlot[], fromTz: string | undefined, toTz: string): FreeSlot[]
export function intersectAvailability(
  members: AvailabilityMemberLike[],
  opts?: { minMinutes?: number; now?: number; tz?: string; workStart?: number; workEnd?: number }
): { slots: FreeSlot[]; counted: number; excluded: ExcludedMember[] }
export function availabilityPayload(input: {
  code: string
  name: string
  slots: FreeSlot[]
  tz?: string
  horizonDays?: number
  creds?: { memberId?: string; token?: string }
  wantCredentials?: boolean
}): Record<string, unknown>
export function proposalEvent(code: string, proposal: ProposalSlotLike): {
  id: string
  calendarUid: string
  dateISO: string
  start: string
  end: string
  title: string
}

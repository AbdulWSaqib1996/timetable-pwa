export const PLAN_RANGE_START: number
export const PLAN_RANGE_END: number
export const PLAN_MIN_MINS: number
export const PLAN_MAX_MINS: number
export const PLAN_TRAVEL_BUFFER_MINS: number

export interface PlanBusyInterval {
  d: string
  from: number
  to: number
  label: string
  kind: 'session' | 'personal' | 'plan' | 'free'
}

export interface PlanSuggestion {
  d: string
  from: number
  to: number
  gapTo: number
  mins: number
  reasons: string[]
}

export interface PlanWorkload {
  d: string
  timetabledMins: number
  plannedMins: number
  personalMins: number
}

export interface PlanWeekResult {
  monday: string
  days: string[]
  suggestions: PlanSuggestion[]
  workload: PlanWorkload[]
  excluded: string[]
  range: { start: number; end: number }
  minMins: number
  maxMins: number
}

export function hhmm(mins: number): string
export function suggestPlanWeek(input: {
  anchorISO: string
  busy?: PlanBusyInterval[]
  deadlines?: { d: string; title: string }[]
  options?: { start?: number; end?: number; minMins?: number; maxMins?: number; bufferMins?: number; quietFrom?: number; quietTo?: number }
}): PlanWeekResult
export function overlapsBusy(busy: PlanBusyInterval[], d: string, from: number, to: number): boolean

export const PLAN_FIELDS: readonly string[]
export const LESSON_STAGES: readonly ['plan', 'rehearse', 'teach', 'review']
export const CYCLE_STATES: readonly ['active', 'paused', 'archived']
export const REVIEW_DECISIONS: readonly ['continue', 'adapt', 'close']
export const PREP_STATES: readonly ['draft', 'held']
export const LESSON_TEMPLATES: readonly { id: string; label: string; sequence: string; checks: string }[]
export function planChanged(prev: any, next: any): boolean
export function withPlanRevision<T>(prev: any, next: T, now: number): T
export function nextAttempt(lesson: any, newId: string, dateISO: string, now: number): any
export function activateCycle<T>(cycles: T[], id: string, now: number): T[]
export interface NextStep { id: string; kind: 'plan' | 'rehearse' | 'review' | 'focus' | 'prep'; label: string; detail: string; dateISO: string | null; lessonId?: string; cycleId?: string; prepId?: string; pinned: boolean }
export function nextSteps(admin: any, todayISO: string, prefs?: { dismissed?: { id: string; dateISO: string }[]; pinned?: string[] }): NextStep[]
export function provenanceLabel(sourceType?: string): string

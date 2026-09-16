import type { WorkloadProposal, WorkloadResult } from './workload.js'

export interface ReviewWeeks { fromISO: string; toISO: string; nextFromISO: string; nextToISO: string }
export function reviewWeeks(todayISO: string): ReviewWeeks

export interface OpenTaskLine { id: string; title: string; dueISO?: string; remaining: number | null; dueThisWeek: boolean; overdue: boolean }
export function thisWeekSummary(input: { todayISO: string; tasks: any[]; plans: any[] }): { fromISO: string; toISO: string; blocks: any[]; plannedMins: number; loggedMins: number; openTasks: OpenTaskLine[]; openCount: number }

export interface FixedInterval { from: number; to: number; label: string; kind: string }
export function nextWeekFixed(input: { todayISO: string; busy: { d: string; from: number; to: number; label: string; kind: string }[]; protectedWindows?: any[]; options?: any; travel?: { bufferMins: number; isPlacement: (label: string) => boolean } | null }): { nextFromISO: string; nextToISO: string; days: { d: string; fixed: FixedInterval[]; fixedMins: number }[]; free: { d: string; from: number; to: number; mins: number }[]; freeMins: number }

export function nextWeekProposals(input: { todayISO: string; busy: any[]; protectedWindows?: any[]; deadlines?: any[]; tasks: any[]; plans: any[]; options?: any }): WorkloadResult

export type ChangeKind = 'untouched' | 'moved' | 'added' | 'clash'
export interface WeeklyChange { kind: ChangeKind; key: string; proposal?: WorkloadProposal; block?: any }
export function weeklyDiff(input: { todayISO: string; plans: any[]; proposals: WorkloadProposal[]; tasks: any[] }): { changes: WeeklyChange[]; actionable: WeeklyChange[] }
export function weeklyReview(input: { todayISO: string; busy: any[]; protectedWindows?: any[]; deadlines?: any[]; tasks: any[]; plans: any[]; options?: any }): WorkloadResult & { changes: WeeklyChange[]; actionable: WeeklyChange[]; clashing: any[] }

export function basisHash(busy: { d: string; from: number; to: number; kind: string }[]): string
export function changesHash(changes: WeeklyChange[]): string

export interface ReviewBatch { id: string; at: number; addedIds: string[]; removed: any[]; changesHash: string }
export function applyChanges(input: { changes: WeeklyChange[]; selectedKeys: string[]; makeId: () => string; now: number }): { batch: ReviewBatch; added: any[]; removedIds: string[] }
export function undoBatch(plans: any[], batch: ReviewBatch): any[]
export function makeWeeklyReview(weekISO: string, id: string, now: number): any

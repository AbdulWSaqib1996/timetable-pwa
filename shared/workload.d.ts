export const WORKLOAD_HORIZON_DAYS: number
export const WORKLOAD_BLOCK_MAX: number
export const WORKLOAD_BLOCK_MIN: number
export function remainingEffort(task: any, plans: any[], todayISO: string): number | null
export function formatMins(mins: number): string
export interface WorkloadProposal { taskId: string; title: string; dateISO: string; startTime: string; endTime: string; effortMins: number }
export interface WorkloadResult { todayISO: string; endISO: string; needed: number; alreadyScheduled: number; available: number; proposedMins: number; unallocated: number; unknown: { taskId: string; title: string }[]; late: { taskId: string; title: string; dueISO: string }[]; proposals: WorkloadProposal[]; protectedMins: number; slots: number }
export function planWorkload(input: { todayISO: string; days?: number; busy?: { d: string; from: number; to: number; label: string; kind: string }[]; protectedWindows?: { id: string; day: number; start: string; end: string; label?: string }[]; deadlines?: { d: string; title: string }[]; tasks: any[]; plans: any[]; options?: { start?: number; end?: number; bufferMins?: number; quietFrom?: number; quietTo?: number } }): WorkloadResult
export function proposalsToBlocks(proposals: WorkloadProposal[], makeId: () => string, now: number): { blocks: any[]; ids: string[] }

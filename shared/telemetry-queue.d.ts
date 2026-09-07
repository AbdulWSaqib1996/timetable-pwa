export const LEASE_MS: number

export type QueueRows = Map<string, any>

export interface Mutation {
  set?: [string, unknown][]
  del?: string[]
  result?: unknown
}

export interface ClaimedBatch {
  batchId: string
  days: {
    date: string
    opens: number
    counts: Record<string, number>
    standalone?: boolean
    platform?: string
    setup?: Record<string, boolean>
  }[]
}

export function recordEvent(rows: QueueRows, input: { date: string; event: string; n?: number }): Mutation
export function recordOpen(rows: QueueRows, input: { date: string }): Mutation
export function setDayContext(
  rows: QueueRows,
  input: { date: string; standalone?: boolean; platform?: string; setup?: Record<string, boolean> }
): Mutation
export function claim(
  rows: QueueRows,
  input: { now: number; owner: string; batchId: string; leaseMs?: number; retentionDays?: number }
): Mutation & { result: ClaimedBatch | null }
export function ack(rows: QueueRows, input: { batchId: string; owner: string }): Mutation
export function release(rows: QueueRows, input: { owner: string }): Mutation
export function clearAll(rows: QueueRows, input: { now: number }): Mutation
export function pendingSummary(rows: QueueRows): { openSegments: number; claimedSegments: number; dropped: number }

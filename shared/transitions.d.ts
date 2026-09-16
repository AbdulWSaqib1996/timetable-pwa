export const TRANSITION_STATES: readonly ['open', 'done']
export const TRANSITION_CONTEXT_MAX: number
export const TRANSITION_GROUPS: readonly { id: string; label: string; items: readonly { id: string; label: string }[] }[]
export const TRANSITION_ITEM_IDS: string[]

export interface TransitionItem {
  id: string
  group: string
  label: string
  state: 'done' | 'todo' | 'stale' | 'deferred'
  detail: string
}

export function makeTransition(fromPlacementId: string | undefined, toPlacementId: string, id: string, now: number): any
export function sharedPackIds(reviewPacks: any[] | undefined): string[]
export function transitionItems(
  transition: any,
  ctx: { placement?: any; school?: any; reviewPacks?: any[]; hasHome: boolean; defaultHours?: { start: string; end: string } }
): TransitionItem[]
export function transitionProgress(items: TransitionItem[]): { done: number; deferred: number; total: number; stale: number; complete: boolean }
export function withDeferral<T>(transition: T, itemId: string, deferral: { followUpISO?: string; note?: string } | null, now: number): T

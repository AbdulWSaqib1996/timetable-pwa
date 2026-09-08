export function toMins(hhmm: unknown): number | null
export function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean
export function assignLanesByComponent<T extends { start: number; end: number }>(
  items: T[]
): { item: T; lane: number; lanes: number }[]
export function classifyNow<T extends { start: number | null; end?: number | null; busy?: boolean }>(
  items: T[],
  nowMins: number
): { current: T[]; upcoming: T[]; finished: T[]; untimed: T[]; clashCount: number }

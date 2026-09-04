/**
 * Local feature-usage counters for the anonymous daily ping: how often the app
 * was opened, in which part of the day, and which features were used (counts
 * only — never any content). Accumulates between pings; reset after a
 * confirmed send. Everything stays coarse: small integers, whitelisted keys.
 */

const KEY = 'timetable.usage.v1'

export interface UsageState {
  /** app opens/resumes since the last successful ping */
  o: number
  /** opens per 4-hour daypart (00-04, 04-08, … 20-24) */
  h: number[]
  /** feature-use counts, keyed by short feature name */
  u: Record<string, number>
}

const EMPTY: UsageState = { o: 0, h: [0, 0, 0, 0, 0, 0], u: {} }

function load(): UsageState {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...EMPTY, h: [...EMPTY.h], u: {} }
    const parsed = JSON.parse(raw) as Partial<UsageState>
    return {
      o: typeof parsed.o === 'number' ? parsed.o : 0,
      h: Array.isArray(parsed.h) && parsed.h.length === 6 ? parsed.h : [...EMPTY.h],
      u: parsed.u && typeof parsed.u === 'object' ? parsed.u : {},
    }
  } catch {
    return { ...EMPTY, h: [...EMPTY.h], u: {} }
  }
}

function save(state: UsageState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* storage unavailable */
  }
}

export function trackOpen(): void {
  const s = load()
  s.o = Math.min(999, s.o + 1)
  const bucket = Math.floor(new Date().getHours() / 4)
  s.h[bucket] = Math.min(999, (s.h[bucket] ?? 0) + 1)
  save(s)
}

export function trackUse(feature: string): void {
  const s = load()
  s.u[feature] = Math.min(999, (s.u[feature] ?? 0) + 1)
  save(s)
}

export function collectUsage(): UsageState {
  return load()
}

export function resetUsage(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

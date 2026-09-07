export const LIVE_TTL_MS: number
export const CACHED_TTL_MS: number
export const DEPARTURES_TTL_MS: number
export type TravelFreshness = 'live' | 'cached' | 'expired' | 'unavailable'
export function travelStatus(fetchedAt: number | null | undefined, now?: number): TravelFreshness
export function ageLabel(fetchedAt: number, now?: number): string
export function freshnessLabel(
  result: { basis: 'provider' | 'estimate'; fetchedAt?: number | null },
  now?: number
): string

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

export const AT_DESTINATION_METERS: number
export const AT_DESTINATION_MAX_AGE_MS: number
export function alreadyAtDestination(
  loc: { lat: number; lng: number; at?: number } | null | undefined,
  dest: { lat: number; lng: number } | null | undefined,
  opts?: { now?: number; maxMeters?: number; maxAgeMs?: number }
): boolean

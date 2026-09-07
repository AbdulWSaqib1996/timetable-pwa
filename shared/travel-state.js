/**
 * Truthful travel freshness (P3-08): provider data and old cached durations
 * must never share a "live" label, and an estimate must say it is one.
 * Status is derived from timestamps so a stale result can only age out,
 * never keep counting down.
 */

export const LIVE_TTL_MS = 5 * 60_000
export const CACHED_TTL_MS = 30 * 60_000
/** departure boards go stale fast — hide entries older than this */
export const DEPARTURES_TTL_MS = 90_000

export function travelStatus(fetchedAt, now = Date.now()) {
  if (fetchedAt == null) return 'unavailable'
  const age = now - fetchedAt
  if (age < 0) return 'unavailable'
  if (age < LIVE_TTL_MS) return 'live'
  if (age < CACHED_TTL_MS) return 'cached'
  return 'expired'
}

export function ageLabel(fetchedAt, now = Date.now()) {
  const mins = Math.max(1, Math.round((now - fetchedAt) / 60_000))
  return mins < 60 ? `${mins}m` : `${Math.round(mins / 60)}h`
}

/**
 * One honest label for a travel duration:
 *  - basis 'estimate' → distance-based estimate (never "live")
 *  - basis 'provider' → Live TfL when fresh, "TfL route from Nm ago" when
 *    cached, unavailable once expired.
 */
export function freshnessLabel({ basis, fetchedAt }, now = Date.now()) {
  if (basis === 'estimate') return 'estimate from distance'
  const status = travelStatus(fetchedAt, now)
  if (status === 'live') return 'live TfL'
  if (status === 'cached') return `TfL route from ${ageLabel(fetchedAt, now)} ago`
  return 'route unavailable'
}

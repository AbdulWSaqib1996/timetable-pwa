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

/** Being "already there": within this many metres of the destination… */
export const AT_DESTINATION_METERS = 150
/** …on a fix no older than this — an old fix at the building proves nothing. */
export const AT_DESTINATION_MAX_AGE_MS = 3 * 3_600_000

function haversineMeters(a, b) {
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(h))
}

/**
 * A leave alert is pointless when the person is already at the session's
 * location (owner request, 9 Sep 2026). True only for a recent fix within
 * AT_DESTINATION_METERS of the destination; a fix without a timestamp is
 * treated as current (the in-app watcher), a stale one never suppresses.
 */
export function alreadyAtDestination(loc, dest, { now = Date.now(), maxMeters = AT_DESTINATION_METERS, maxAgeMs = AT_DESTINATION_MAX_AGE_MS } = {}) {
  if (!loc || !dest || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng) || !Number.isFinite(dest.lat) || !Number.isFinite(dest.lng)) return false
  if (typeof loc.at === 'number' && now - loc.at > maxAgeMs) return false
  return haversineMeters(loc, dest) <= maxMeters
}

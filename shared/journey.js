import { COURSE_TIMEZONE, wallToUTC } from './calendar-time.js'

/**
 * Journey request/result model (P6-01/P6-02). A request carries its full
 * identity — origin (with basis), destination, mode, intent (leave-now or
 * arrive-by with the actual instant and owning event) and arrival buffer —
 * and every cache entry/result is keyed by that identity, so nothing stale
 * can survive an origin, destination, mode, time or buffer change.
 */

/** Cache/request identity. Coordinate rounding (~110m origin, ~11m dest) is
 *  deliberate: close origins share provider results without conflating
 *  materially different destinations. */
export function journeyRequestKey(req) {
  const o = `${req.origin.lat.toFixed(3)},${req.origin.lng.toFixed(3)}|${req.origin.basis ?? 'device'}`
  const d = `${req.destination.lat.toFixed(4)},${req.destination.lng.toFixed(4)}`
  const i =
    req.intent.kind === 'arrive-by'
      ? `arrive:${req.intent.arriveByMs}|${req.intent.timeZone ?? COURSE_TIMEZONE}|${req.intent.eventKey ?? ''}|buf:${req.arrivalBufferMinutes ?? 0}`
      : `leave-now`
  return [o, d, req.mode, i].join('||')
}

/** Required arrival = event start minus the chosen buffer. */
export function requiredArrivalMs(startMs, bufferMins) {
  return startMs - Math.max(0, bufferMins) * 60_000
}

const parseLondonLocal = (iso, zone) => {
  const m = typeof iso === 'string' ? iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/) : null
  if (!m) return null
  return wallToUTC(m[1], m[2], zone).utcMs
}

/**
 * Validate and normalise a provider journey (TfL shape: local wall-time
 * `startDateTime`/`arrivalDateTime`, minute `duration`, legs with times).
 * Returns null for anything unusable — an invalid response is rejected, not
 * repaired. Durations come from the provider (waits/transfers included);
 * nothing here subtracts a second duration from the planned departure.
 */
export function validateItinerary(raw, zone = COURSE_TIMEZONE) {
  if (!raw || typeof raw !== 'object') return null
  const departureMs = parseLondonLocal(raw.startDateTime, zone)
  const arrivalMs = parseLondonLocal(raw.arrivalDateTime, zone)
  const durationMins = Number(raw.duration)
  if (departureMs === null || arrivalMs === null) return null
  if (!Number.isFinite(durationMins) || durationMins <= 0) return null
  if (arrivalMs < departureMs) return null
  const legs = []
  for (const leg of Array.isArray(raw.legs) ? raw.legs : []) {
    const mode = leg?.mode?.name ?? ''
    if (!mode) return null
    legs.push({
      mode,
      line: mode === 'walking' ? '' : leg.routeOptions?.[0]?.name || mode,
      from: leg.departurePoint?.commonName ?? '',
      to: leg.arrivalPoint?.commonName ?? '',
      departMs: parseLondonLocal(leg.departureTime, zone),
      arriveMs: parseLondonLocal(leg.arrivalTime, zone),
      minutes: Number(leg.duration) || 0,
      fromLat: leg.departurePoint?.lat,
      fromLng: leg.departurePoint?.lon,
      summary: leg.instruction?.summary ?? '',
      disruptions: (Array.isArray(leg.disruptions) ? leg.disruptions : [])
        .map((d) => String(d?.description ?? '').slice(0, 200))
        .filter(Boolean),
      isDisrupted: leg.isDisrupted === true,
    })
  }
  return { departureMs, arrivalMs, durationMins, legs, lines: legs.map((l) => l.line).filter(Boolean) }
}

/**
 * Choose the itinerary to act on for an arrive-by request: the latest
 * departure that still arrives by the required instant (small tolerance for
 * provider rounding); null when nothing feasible exists.
 */
export function pickFeasibleItinerary(itineraries, requiredMs, toleranceMs = 90_000) {
  const feasible = itineraries.filter((it) => it && it.arrivalMs <= requiredMs + toleranceMs)
  if (feasible.length === 0) return null
  return feasible.sort((a, b) => b.departureMs - a.departureMs)[0]
}

/** Truthful departure state derived from timestamps — never a negative countdown. */
export function departureState(leaveByMs, nowMs) {
  if (nowMs >= leaveByMs) return 'passed'
  if (leaveByMs - nowMs <= 5 * 60_000) return 'imminent'
  return 'future'
}

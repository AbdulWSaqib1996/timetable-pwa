import { utcToZonedParts } from '../../shared/calendar-time.js'
import { journeyRequestKey, pickFeasibleItinerary, validateItinerary } from '../../shared/journey.js'
import type { Itinerary, JourneyRequestLike } from '../../shared/journey.js'
import type { Coords } from './campus'

/**
 * Date-specific journey planning against the TfL Journey Planner (P6-01).
 * Parameters verified against the live API at implementation time:
 * `date=yyyyMMdd&time=HHmm&timeIs=Arriving|Departing`, journeys carrying
 * local-London `startDateTime`/`arrivalDateTime` and per-leg times.
 * The provider's chosen itinerary determines the departure — we never
 * subtract our own duration from an already planned departure.
 */

export interface PlanResult {
  requestKey: string
  itinerary: Itinerary | null
  /** all valid itineraries returned (for honesty about alternatives) */
  alternatives: Itinerary[]
  fetchedAt: number
  /** 'planned' = date-specific request honoured; 'leave-now' fallback label */
  intentHonoured: 'arrive-by' | 'leave-now'
  error?: 'network' | 'no-itinerary'
}

const TFL_MODES = 'tube,bus,overground,elizabeth-line,dlr,national-rail,walking'
const planCache = new Map<string, PlanResult>()
const PLAN_TTL_MS = 10 * 60_000
/** A network failure is remembered only briefly (R2 / TT-12) so a recovery
 *  retry is not answered from a stale negative cache. */
const NEGATIVE_TTL_MS = 15_000

export function cachedPlan(key: string): PlanResult | null {
  const hit = planCache.get(key)
  if (!hit) return null
  const ttl = hit.error === 'network' ? NEGATIVE_TTL_MS : PLAN_TTL_MS
  return Date.now() - hit.fetchedAt < ttl ? hit : null
}

/**
 * Plan a journey for the request's actual intent. Transit and walking use the
 * provider with real date/time; anything else is the caller's responsibility
 * (heuristics stay labelled estimates and never come from here).
 */
export async function planJourney(req: JourneyRequestLike, signal?: AbortSignal, opts: { bypassCache?: boolean } = {}): Promise<PlanResult> {
  const key = journeyRequestKey(req)
  const hit = opts.bypassCache ? null : cachedPlan(key)
  if (hit) return hit
  const from: Coords = { lat: req.origin.lat, lng: req.origin.lng }
  const to: Coords = { lat: req.destination.lat, lng: req.destination.lng }
  const params = new URLSearchParams()
  if (req.mode === 'walking') params.set('mode', 'walking')
  else params.set('mode', TFL_MODES)
  let intentHonoured: PlanResult['intentHonoured'] = 'leave-now'
  if (req.intent.kind === 'arrive-by') {
    // TfL expects LONDON wall time whatever the course timezone is — the
    // provider's clock is not configurable.
    const wall = utcToZonedParts(req.intent.arriveByMs, 'Europe/London')
    params.set('date', wall.dateISO.replace(/-/g, ''))
    params.set('time', wall.hhmm.replace(':', ''))
    params.set('timeIs', 'Arriving')
    intentHonoured = 'arrive-by'
  }
  let result: PlanResult
  try {
    const res = await fetch(
      `https://api.tfl.gov.uk/Journey/JourneyResults/${from.lat},${from.lng}/to/${to.lat},${to.lng}?${params.toString()}`,
      { signal }
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = (await res.json()) as { journeys?: unknown[] }
    const alternatives = (json.journeys ?? [])
      .map((j) => validateItinerary(j))
      .filter((it): it is Itinerary => it !== null)
    const itinerary =
      req.intent.kind === 'arrive-by'
        ? pickFeasibleItinerary(alternatives, req.intent.arriveByMs)
        : alternatives.sort((a, b) => a.arrivalMs - b.arrivalMs)[0] ?? null
    result = {
      requestKey: key,
      itinerary,
      alternatives,
      fetchedAt: Date.now(),
      intentHonoured,
      error: itinerary ? undefined : 'no-itinerary',
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    result = { requestKey: key, itinerary: null, alternatives: [], fetchedAt: Date.now(), intentHonoured, error: 'network' }
  }
  if (planCache.size > 100) planCache.clear()
  planCache.set(key, result)
  return result
}

/* ---------- plan store: display and leave reminders share ONE plan ---------- */

interface StoredPlan {
  requestKey: string
  leaveByMs: number
  arrivalMs: number
  durationMins: number
  fetchedAt: number
}

/** Keyed by PROFILE + event (R2 / TT-12): a plan published for one profile's
 *  event can never be consumed for another's. */
const leavePlans = new Map<string, StoredPlan>()
const planKey = (profileId: string, eventKey: string) => `${profileId}|${eventKey}`

/** Publish today's planned departure for an event so leave reminders fire on
 *  the SAME itinerary the screen shows (P6-01 item 6). A changed request key
 *  (buffer, origin, time…) replaces the entry wholesale. */
export function publishLeavePlan(profileId: string, eventKey: string, plan: StoredPlan): void {
  leavePlans.set(planKey(profileId, eventKey), plan)
}

/** Supersede immediately: the moment request intent changes, the old plan
 *  must stop driving reminders — expiry alone is not identity validation. */
export function clearLeavePlan(profileId: string, eventKey: string): void {
  leavePlans.delete(planKey(profileId, eventKey))
}

/** The plan is valid only while its request identity still matches the
 *  caller's expectation (when given) and it is fresh. */
export function leavePlanFor(profileId: string, eventKey: string, expectedRequestKey?: string): StoredPlan | null {
  const hit = leavePlans.get(planKey(profileId, eventKey))
  if (!hit) return null
  if (expectedRequestKey && hit.requestKey !== expectedRequestKey) return null
  return Date.now() - hit.fetchedAt < PLAN_TTL_MS * 2 ? hit : null
}

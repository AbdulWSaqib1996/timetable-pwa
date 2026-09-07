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

export function cachedPlan(key: string): PlanResult | null {
  const hit = planCache.get(key)
  return hit && Date.now() - hit.fetchedAt < PLAN_TTL_MS ? hit : null
}

/**
 * Plan a journey for the request's actual intent. Transit and walking use the
 * provider with real date/time; anything else is the caller's responsibility
 * (heuristics stay labelled estimates and never come from here).
 */
export async function planJourney(req: JourneyRequestLike, signal?: AbortSignal): Promise<PlanResult> {
  const key = journeyRequestKey(req)
  const hit = cachedPlan(key)
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

const leavePlans = new Map<string, StoredPlan>()

/** Publish today's planned departure for an event so leave reminders fire on
 *  the SAME itinerary the screen shows (P6-01 item 6). A changed request key
 *  (buffer, origin, time…) replaces the entry wholesale. */
export function publishLeavePlan(eventKey: string, plan: StoredPlan): void {
  leavePlans.set(eventKey, plan)
}

export function clearLeavePlan(eventKey: string): void {
  leavePlans.delete(eventKey)
}

export function leavePlanFor(eventKey: string): StoredPlan | null {
  const hit = leavePlans.get(eventKey)
  return hit && Date.now() - hit.fetchedAt < PLAN_TTL_MS * 2 ? hit : null
}

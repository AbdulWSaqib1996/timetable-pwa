import { useEffect, useMemo, useRef, useState } from 'react'
import { departureState, journeyRequestKey } from '../../shared/journey.js'
import type { Itinerary, JourneyIntent, JourneyRequestLike } from '../../shared/journey.js'
import type { Coords } from '../lib/campus'
import { clearLeavePlan, planJourney, publishLeavePlan } from '../lib/journeyPlanner'
import type { PlanResult } from '../lib/journeyPlanner'
import type { OriginOption } from '../lib/origins'
import { telemetryTrack } from '../lib/telemetry'
import { tflDeparturesNear, tflDisruptions } from '../lib/tfl'
import type { TflDepartures, TflDisruption } from '../lib/tfl'

const plannedKeys = new Set<string>()

export interface UseJourneyInput {
  origin: OriginOption | null
  destination: { coords: Coords; label?: string } | null
  mode: 'walking' | 'transit' | 'driving'
  intent: JourneyIntent
  /** stable event key an arrive-by plan belongs to (leave reminders align) */
  eventKey?: string
  enabled: boolean
}

export interface JourneyView {
  status: 'idle' | 'loading' | 'ready' | 'no-route' | 'error'
  plan: PlanResult | null
  itinerary: Itinerary | null
  /** the plan's own departure instant (arrive-by), or null for leave-now */
  leaveByMs: number | null
  /** timestamp-derived: 'future' | 'imminent' | 'passed' (arrive-by only) */
  departure: 'future' | 'imminent' | 'passed' | null
  /** truthful leave-now fallback once the planned departure has passed */
  fallback: Itinerary | null
  legDeps: Record<number, TflDepartures>
  disruptions: TflDisruption[]
  fetchedAt: number | null
}

/**
 * One journey per request identity (P6-01/02): results clear the moment the
 * origin, destination, mode, intent time or buffer changes; an obsolete
 * request is aborted and its late result ignored. Departure boards poll only
 * while the journey is imminent/now AND the page is visible; a passed
 * planned departure switches to a refreshed leave-now route with a truthful
 * arrival — never a negative countdown.
 */
export function useJourney({ origin, destination, mode, intent, eventKey, enabled }: UseJourneyInput): JourneyView {
  const request: JourneyRequestLike | null = useMemo(() => {
    if (!origin?.coords || !destination) return null
    return {
      origin: { ...origin.coords, basis: origin.basis, label: origin.label },
      destination: { ...destination.coords, label: destination.label },
      mode,
      intent,
    }
  }, [origin?.coords?.lat, origin?.coords?.lng, origin?.basis, destination?.coords.lat, destination?.coords.lng, mode, intent]) // eslint-disable-line react-hooks/exhaustive-deps

  const key = request ? journeyRequestKey(request) : null
  const [state, setState] = useState<{ key: string | null; plan: PlanResult | null; fallback: Itinerary | null; loading: boolean }>({
    key: null,
    plan: null,
    fallback: null,
    loading: false,
  })
  const [legDeps, setLegDeps] = useState<Record<number, TflDepartures & { at: number }>>({})
  const [disruptions, setDisruptions] = useState<TflDisruption[]>([])
  const [, setTick] = useState(0)
  const abortRef = useRef<AbortController | null>(null)

  // Fetch (and refetch) whenever the request identity changes.
  useEffect(() => {
    // Old results vanish immediately with the identity that produced them.
    setState({ key, plan: null, fallback: null, loading: !!(enabled && request && key) })
    setLegDeps({})
    if (!enabled || !request || !key) return
    if (mode === 'driving') {
      // No planning provider for driving — the caller shows a labelled
      // estimate; nothing is fabricated here.
      setState({ key, plan: null, fallback: null, loading: false })
      return
    }
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    let cancelled = false
    void planJourney(request, ctrl.signal)
      .then(async (plan) => {
        if (cancelled) return
        let fallback: Itinerary | null = null
        if (
          request.intent.kind === 'arrive-by' &&
          plan.itinerary &&
          departureState(plan.itinerary.departureMs, Date.now()) === 'passed'
        ) {
          // The planned departure has passed: fetch a truthful leave-now route.
          const nowPlan = await planJourney(
            { ...request, intent: { kind: 'leave-now' } },
            ctrl.signal
          ).catch(() => null)
          fallback = nowPlan?.itinerary ?? null
        }
        if (cancelled) return
        setState({ key, plan, fallback, loading: false })
        // A4 success: a real provider plan was shown for this request
        // identity (deduped per key; nothing about the journey is sent).
        if (plan.itinerary && !plannedKeys.has(key)) {
          if (plannedKeys.size > 50) plannedKeys.clear()
          plannedKeys.add(key)
          telemetryTrack('journey_planned')
        }
        if (eventKey && request.intent.kind === 'arrive-by' && plan.itinerary) {
          publishLeavePlan(eventKey, {
            requestKey: plan.requestKey,
            leaveByMs: plan.itinerary.departureMs,
            arrivalMs: plan.itinerary.arrivalMs,
            durationMins: plan.itinerary.durationMins,
            fetchedAt: plan.fetchedAt,
          })
        } else if (eventKey && plan.error) {
          clearLeavePlan(eventKey)
        }
      })
      .catch(() => {
        if (!cancelled) setState({ key, plan: null, fallback: null, loading: false })
      })
    void tflDisruptions().then((d) => {
      if (!cancelled) setDisruptions(d)
    })
    return () => {
      cancelled = true
      ctrl.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled])

  // Minute tick so departure state moves future → imminent → passed honestly.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  const active = state.key === key ? state : { key, plan: null, fallback: null, loading: !!enabled }
  const itinerary = active.plan?.itinerary ?? null
  const leaveByMs = request?.intent.kind === 'arrive-by' && itinerary ? itinerary.departureMs : null
  const departure = leaveByMs !== null ? departureState(leaveByMs, Date.now()) : null

  // Departure boards: only for a journey that is happening about now, and
  // only while the page is visible (documented provider limits: 30s poll).
  const boardsItinerary = departure === 'passed' ? active.fallback : itinerary
  const boardsWanted =
    enabled && mode === 'transit' && !!boardsItinerary && (request?.intent.kind === 'leave-now' || departure !== 'future')
  useEffect(() => {
    setLegDeps({})
    if (!boardsWanted || !boardsItinerary) return
    let cancelled = false
    const load = () => {
      if (document.visibilityState === 'hidden') return
      let fetched = 0
      boardsItinerary.legs.forEach((leg, i) => {
        if (leg.mode === 'walking' || !leg.line || leg.fromLat == null || leg.fromLng == null) return
        if (fetched++ >= 3) return
        void tflDeparturesNear(leg.fromLat, leg.fromLng, leg.line).then((dep) => {
          if (!cancelled && dep) setLegDeps((prev) => ({ ...prev, [i]: { ...dep, at: Date.now() } }))
        })
      })
    }
    load()
    const t = setInterval(load, 30_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVisible)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardsWanted, boardsItinerary])

  const freshDeps: Record<number, TflDepartures> = {}
  for (const [i, dep] of Object.entries(legDeps)) {
    if (Date.now() - dep.at < 90_000) freshDeps[Number(i)] = dep
  }

  return {
    status: !enabled || !request
      ? 'idle'
      : active.loading
        ? 'loading'
        : active.plan?.error === 'network'
          ? 'error'
          : active.plan && !itinerary
            ? 'no-route'
            : itinerary
              ? 'ready'
              : 'idle',
    plan: active.plan,
    itinerary,
    leaveByMs,
    departure,
    fallback: active.fallback,
    legDeps: freshDeps,
    disruptions,
    fetchedAt: active.plan?.fetchedAt ?? null,
  }
}

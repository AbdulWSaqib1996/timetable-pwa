import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { departureState, journeyRequestKey } from '../../shared/journey.js'
import type { Itinerary, JourneyIntent, JourneyRequestLike } from '../../shared/journey.js'
import type { Coords } from '../lib/campus'
import { activeCourse } from '../lib/course'
import { clearLeavePlan, planJourney, publishLeavePlan } from '../lib/journeyPlanner'
import type { PlanResult } from '../lib/journeyPlanner'
import type { OriginOption } from '../lib/origins'
import { telemetryTrack } from '../lib/telemetry'
import { tflDeparturesNear, tflDisruptions } from '../lib/tfl'
import type { TflDepartures, TflDisruption } from '../lib/tfl'

const plannedKeys = new Set<string>()
/** A plan older than this is refreshed when the page becomes visible again. */
const STALE_MS = 10 * 60_000

export interface UseJourneyInput {
  origin: OriginOption | null
  destination: { coords: Coords; label?: string } | null
  mode: 'walking' | 'transit' | 'driving'
  intent: JourneyIntent
  /** stable event key an arrive-by plan belongs to (leave reminders align) */
  eventKey?: string
  /** owning profile — leave plans are published per profile (TT-12) */
  profileId?: string
  enabled: boolean
}

export interface JourneyView {
  status: 'idle' | 'loading' | 'ready' | 'no-route' | 'error' | 'no-provider'
  plan: PlanResult | null
  itinerary: Itinerary | null
  /** the plan's own departure instant (arrive-by), or null for leave-now */
  leaveByMs: number | null
  /** timestamp-derived: 'future' | 'imminent' | 'passed' (arrive-by only) */
  departure: 'future' | 'imminent' | 'passed' | null
  /** truthful leave-now fallback once the planned departure has passed */
  fallback: Itinerary | null
  /** the fallback is being fetched right now (TT-11) */
  refreshing: boolean
  /** a fallback was requested and none could be found */
  fallbackUnavailable: boolean
  legDeps: Record<number, TflDepartures>
  disruptions: TflDisruption[]
  fetchedAt: number | null
  /** re-request the current identity, bypassing any cached failure */
  retry: () => void
}

type State = {
  key: string | null
  plan: PlanResult | null
  fallback: Itinerary | null
  loading: boolean
  refreshing: boolean
  fallbackUnavailable: boolean
}
const empty = (key: string | null, loading: boolean): State => ({ key, plan: null, fallback: null, loading, refreshing: false, fallbackUnavailable: false })

/**
 * One journey per request identity (P6-01/02; R2 / TT-11, TT-12): results
 * clear the moment the origin, destination, mode, intent time or buffer
 * changes; an obsolete request is aborted and its late result ignored; the
 * previously published leave plan is superseded IMMEDIATELY on any identity
 * change, not left to expire. Departure boards poll only while the journey
 * is imminent/now AND the page is visible. When an initially future planned
 * departure passes while the page stays open, ONE leave-now alternative is
 * fetched (abort/generation-protected); a stale plan refreshes on resume.
 */
export function useJourney({ origin, destination, mode, intent, eventKey, profileId, enabled }: UseJourneyInput): JourneyView {
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
  const providerAvailable = activeCourse().journeyProvider !== 'none'
  const [state, setState] = useState<State>(empty(null, false))
  const [legDeps, setLegDeps] = useState<Record<number, TflDepartures & { at: number }>>({})
  const [disruptions, setDisruptions] = useState<TflDisruption[]>([])
  const [, setTick] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const abortRef = useRef<AbortController | null>(null)
  const pid = profileId ?? ''

  // Fetch (and refetch) whenever the request identity changes or a retry is asked for.
  useEffect(() => {
    // Old results — AND the reminder consumer's copy of them — vanish with
    // the identity that produced them (TT-12).
    setState(empty(key, !!(enabled && request && key && providerAvailable)))
    setLegDeps({})
    if (eventKey) clearLeavePlan(pid, eventKey)
    if (!enabled || !request || !key || !providerAvailable) return
    if (mode === 'driving') {
      // No planning provider for driving — the caller shows a labelled
      // estimate; nothing is fabricated here.
      setState(empty(key, false))
      return
    }
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    let cancelled = false
    void planJourney(request, ctrl.signal, { bypassCache: attempt > 0 })
      .then(async (plan) => {
        if (cancelled) return
        let fallback: Itinerary | null = null
        let fallbackUnavailable = false
        if (
          request.intent.kind === 'arrive-by' &&
          plan.itinerary &&
          departureState(plan.itinerary.departureMs, Date.now()) === 'passed'
        ) {
          // The planned departure has already passed: fetch a truthful leave-now route.
          const nowPlan = await planJourney({ ...request, intent: { kind: 'leave-now' } }, ctrl.signal).catch(() => null)
          fallback = nowPlan?.itinerary ?? null
          fallbackUnavailable = !fallback
        }
        if (cancelled) return
        setState({ key, plan, fallback, loading: false, refreshing: false, fallbackUnavailable })
        if (plan.itinerary && !plannedKeys.has(key)) {
          if (plannedKeys.size > 50) plannedKeys.clear()
          plannedKeys.add(key)
          telemetryTrack('journey_planned')
        }
        if (eventKey && request.intent.kind === 'arrive-by' && plan.itinerary) {
          publishLeavePlan(pid, eventKey, {
            requestKey: plan.requestKey,
            leaveByMs: plan.itinerary.departureMs,
            arrivalMs: plan.itinerary.arrivalMs,
            durationMins: plan.itinerary.durationMins,
            fetchedAt: plan.fetchedAt,
          })
        } else if (eventKey && plan.error) {
          clearLeavePlan(pid, eventKey)
        }
      })
      .catch(() => {
        if (!cancelled) setState(empty(key, false))
      })
    void tflDisruptions().then((d) => {
      if (!cancelled) setDisruptions(d)
    })
    return () => {
      cancelled = true
      ctrl.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, attempt, providerAvailable])

  // Minute tick so departure state moves future → imminent → passed honestly.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  const active: State = state.key === key ? state : empty(key, !!enabled)
  const itinerary = active.plan?.itinerary ?? null
  const leaveByMs = request?.intent.kind === 'arrive-by' && itinerary ? itinerary.departureMs : null
  const departure = leaveByMs !== null ? departureState(leaveByMs, Date.now()) : null

  // TT-11: the FIRST transition into 'passed' while mounted fetches exactly
  // one leave-now alternative for the same request identity. Ticks after
  // that do nothing; a late response for a superseded identity is ignored.
  const transitionKeyRef = useRef<string | null>(null)
  useEffect(() => {
    if (departure !== 'passed' || !request || !key || active.fallback || active.refreshing || active.fallbackUnavailable) return
    if (transitionKeyRef.current === key) return
    transitionKeyRef.current = key
    const ctrl = new AbortController()
    let cancelled = false
    setState((s) => (s.key === key ? { ...s, refreshing: true } : s))
    void planJourney({ ...request, intent: { kind: 'leave-now' } }, ctrl.signal, { bypassCache: true })
      .then((nowPlan) => {
        if (cancelled) return
        setState((s) => (s.key === key ? { ...s, fallback: nowPlan.itinerary, refreshing: false, fallbackUnavailable: !nowPlan.itinerary } : s))
      })
      .catch(() => {
        if (!cancelled) setState((s) => (s.key === key ? { ...s, refreshing: false, fallbackUnavailable: true } : s))
      })
    return () => {
      cancelled = true
      ctrl.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departure, key])

  // Resume refresh: a plan older than STALE_MS is re-requested when the tab
  // becomes visible again (not on every render or tick).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      const fetchedAt = state.plan?.fetchedAt
      if (state.key === key && fetchedAt && Date.now() - fetchedAt > STALE_MS) setAttempt((n) => n + 1)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [state.plan?.fetchedAt, state.key, key])

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

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  return {
    status: !providerAvailable
      ? 'no-provider'
      : !enabled || !request
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
    refreshing: active.refreshing,
    fallbackUnavailable: active.fallbackUnavailable,
    legDeps: freshDeps,
    disruptions,
    fetchedAt: active.plan?.fetchedAt ?? null,
    retry,
  }
}

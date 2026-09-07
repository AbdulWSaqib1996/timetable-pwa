import { useEffect, useState } from 'react'
import { DEPARTURES_TTL_MS } from '../../shared/travel-state.js'
import type { Coords } from '../lib/campus'
import { tflDeparturesNear, tflDisruptions, tflRoute } from '../lib/tfl'
import type { TflDepartures, TflDisruption, TflRoute } from '../lib/tfl'

/**
 * Live TfL journey between two points: the recommended route (which already
 * avoids closures/strikes), per-leg departure boards refreshed every 30s while
 * active, and current line disruptions. Shared by the session detail sheet and
 * the head-home dropdown so both show the same end-to-end journey.
 */
export function useLiveJourney(from: Coords | null, to: Coords | null, enabled: boolean) {
  const [route, setRoute] = useState<TflRoute | null>(null)
  const [routeFetchedAt, setRouteFetchedAt] = useState<number | null>(null)
  const [disruptions, setDisruptions] = useState<TflDisruption[]>([])
  const [legDeps, setLegDeps] = useState<Record<number, TflDepartures & { at: number }>>({})

  useEffect(() => {
    // The request identity changed — clear every previous result immediately.
    setRoute(null)
    setRouteFetchedAt(null)
    setDisruptions([])
    setLegDeps({})
    if (!enabled || !from || !to) return
    let cancelled = false
    let depsTimer: ReturnType<typeof setInterval> | undefined
    // Live departures for every transit leg (bus, tube, Overground, Elizabeth line,
    // DLR — National Rail boards aren't in TfL's arrivals feed and simply won't show).
    // Polling pauses while the page is hidden and refreshes immediately on resume.
    const loadDepartures = (r: TflRoute) => {
      if (document.visibilityState === 'hidden') return
      let fetched = 0
      r.legs.forEach((leg, i) => {
        if (leg.mode === 'walking' || !leg.line || leg.fromLat == null || leg.fromLng == null) return
        if (fetched++ >= 3) return
        void tflDeparturesNear(leg.fromLat, leg.fromLng, leg.line).then((dep) => {
          if (!cancelled && dep) setLegDeps((prev) => ({ ...prev, [i]: { ...dep, at: Date.now() } }))
        })
      })
    }
    let onVisible: (() => void) | undefined
    void tflRoute(from, to).then((r) => {
      if (cancelled) return
      setRoute(r)
      setRouteFetchedAt(r ? Date.now() : null)
      if (r) {
        loadDepartures(r)
        depsTimer = setInterval(() => loadDepartures(r), 30_000)
        onVisible = () => {
          if (document.visibilityState === 'visible') loadDepartures(r)
        }
        document.addEventListener('visibilitychange', onVisible)
      }
    })
    void tflDisruptions().then((d) => {
      if (!cancelled) setDisruptions(d)
    })
    return () => {
      cancelled = true
      if (depsTimer) clearInterval(depsTimer)
      if (onVisible) document.removeEventListener('visibilitychange', onVisible)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, from?.lat, from?.lng, to?.lat, to?.lng])

  /** Disruptions filtered to the lines this route actually uses. */
  const routeDisruptions = route
    ? disruptions.filter((d) => route.lines.some((l) => l.toLowerCase().includes(d.line.toLowerCase())))
    : []

  // Departure boards expire rather than lingering: entries older than the TTL
  // (e.g. after a background pause) are withheld until the next refresh lands.
  const freshLegDeps: Record<number, TflDepartures> = {}
  for (const [i, dep] of Object.entries(legDeps)) {
    if (Date.now() - dep.at < DEPARTURES_TTL_MS) freshLegDeps[Number(i)] = dep
  }

  return { route, routeFetchedAt, legDeps: freshLegDeps, disruptions, routeDisruptions }
}

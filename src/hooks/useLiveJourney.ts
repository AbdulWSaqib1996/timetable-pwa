import { useEffect, useState } from 'react'
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
  const [disruptions, setDisruptions] = useState<TflDisruption[]>([])
  const [legDeps, setLegDeps] = useState<Record<number, TflDepartures>>({})

  useEffect(() => {
    setRoute(null)
    setDisruptions([])
    setLegDeps({})
    if (!enabled || !from || !to) return
    let cancelled = false
    let depsTimer: ReturnType<typeof setInterval> | undefined
    // Live departures for every transit leg (bus, tube, Overground, Elizabeth line,
    // DLR — National Rail boards aren't in TfL's arrivals feed and simply won't show).
    const loadDepartures = (r: TflRoute) => {
      let fetched = 0
      r.legs.forEach((leg, i) => {
        if (leg.mode === 'walking' || !leg.line || leg.fromLat == null || leg.fromLng == null) return
        if (fetched++ >= 3) return
        void tflDeparturesNear(leg.fromLat, leg.fromLng, leg.line).then((dep) => {
          if (!cancelled && dep) setLegDeps((prev) => ({ ...prev, [i]: dep }))
        })
      })
    }
    void tflRoute(from, to).then((r) => {
      if (cancelled) return
      setRoute(r)
      if (r) {
        loadDepartures(r)
        depsTimer = setInterval(() => loadDepartures(r), 30_000)
      }
    })
    void tflDisruptions().then((d) => {
      if (!cancelled) setDisruptions(d)
    })
    return () => {
      cancelled = true
      if (depsTimer) clearInterval(depsTimer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, from?.lat, from?.lng, to?.lat, to?.lng])

  /** Disruptions filtered to the lines this route actually uses. */
  const routeDisruptions = route
    ? disruptions.filter((d) => route.lines.some((l) => l.toLowerCase().includes(d.line.toLowerCase())))
    : []

  return { route, legDeps, disruptions, routeDisruptions }
}

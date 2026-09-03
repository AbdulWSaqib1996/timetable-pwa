import { useEffect, useRef, useState } from 'react'
import type { Coords } from '../lib/campus'
import { matchBuilding } from '../lib/campus'
import { tflDisruptions, tflRoute } from '../lib/tfl'
import type { TflDisruption } from '../lib/tfl'
import type { Session, Settings } from '../types'

/**
 * Location + live TfL context: watches the device position while travel times
 * are enabled, polls line status in transit mode, and warms the journey-time
 * cache for upcoming buildings so list cards show the same live value as the
 * detail sheet.
 */
export function useTravel(settings: Settings | null, exportSessions: Session[], todayISO: string) {
  const [coords, setCoords] = useState<Coords | null>(null)
  const [tubeStatus, setTubeStatus] = useState<TflDisruption[]>([])
  const locationEnabled = settings?.locationEnabled ?? false
  const travelMode = settings?.travelMode ?? 'walking'

  const exportRef = useRef(exportSessions)
  exportRef.current = exportSessions

  // Device location for travel-time estimates (only while enabled in Settings).
  useEffect(() => {
    if (!locationEnabled || !('geolocation' in navigator)) {
      setCoords(null)
      return
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setCoords(null),
      { enableHighAccuracy: false, maximumAge: 120_000 }
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [locationEnabled])

  // Live TfL line status while public transport is the chosen mode (strikes, closures, delays).
  useEffect(() => {
    if (travelMode !== 'transit') {
      setTubeStatus([])
      return
    }
    let live = true
    const load = () =>
      void tflDisruptions().then((d) => {
        if (live) setTubeStatus(d)
      })
    load()
    const t = setInterval(load, 5 * 60_000)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [travelMode])

  // Warm live TfL journey times for upcoming buildings so list cards show the same
  // live value as the detail sheet (cards read the cache synchronously).
  const [, setLiveTick] = useState(0)
  useEffect(() => {
    if (travelMode !== 'transit' || !coords) return
    let live = true
    const warm = async () => {
      const seen = new Set<string>()
      for (const s of exportRef.current) {
        if (s.dateISO < todayISO || s.isSelfStudy || !s.room) continue
        const building = matchBuilding(s.room)
        if (!building || seen.has(building.name)) continue
        seen.add(building.name)
        if (seen.size > 8) break
        await tflRoute(coords, { lat: building.lat, lng: building.lng })
      }
      if (live) setLiveTick((t) => t + 1)
    }
    void warm()
    const t = setInterval(() => void warm(), 5 * 60_000)
    return () => {
      live = false
      clearInterval(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [travelMode, coords?.lat, coords?.lng])

  return { coords, tubeStatus, locationEnabled, travelMode }
}

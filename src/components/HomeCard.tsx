import { useEffect, useState } from 'react'
import type { Coords, TravelMode } from '../lib/campus'
import { TRAVEL_MODE_PHRASE, estimateTravelToCoords } from '../lib/campus'
import { formatRemaining } from '../lib/format'
import { tflModeIcon, tflRoute } from '../lib/tfl'
import type { TflRoute } from '../lib/tfl'

interface Props {
  home: { lat: number; lng: number }
  /** device location (travel times enabled), else null */
  coords: Coords | null
  travelMode: TravelMode
  /** end of today's last session, in minutes from midnight; null on session-free days */
  lastEndMins: number | null
}

/**
 * End-of-day "head home" card: appears from shortly before today's last session
 * ends until the evening, showing the live journey home — time, route and
 * arrival estimate. Home coordinates never leave the device.
 */
export function HomeCard({ home, coords, travelMode, lastEndMins }: Props) {
  // A minute tick so the card appears/updates without any other re-render.
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000)
    return () => clearInterval(t)
  }, [])

  const now = new Date()
  const nowMins = now.getHours() * 60 + now.getMinutes()
  const visible =
    lastEndMins !== null && nowMins >= lastEndMins - 30 && nowMins < 23 * 60

  // Live TfL journey in transit mode, refreshed every 5 minutes while visible.
  const [route, setRoute] = useState<TflRoute | null>(null)
  useEffect(() => {
    setRoute(null)
    if (!visible || travelMode !== 'transit' || !coords) return
    let live = true
    const load = () =>
      void tflRoute(coords, home).then((r) => {
        if (live) setRoute(r)
      })
    load()
    const t = setInterval(load, 5 * 60_000)
    return () => {
      live = false
      clearInterval(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, travelMode, coords?.lat, coords?.lng, home.lat, home.lng])

  if (!visible || !coords) return null

  const est = estimateTravelToCoords(home, coords, travelMode, 'Home')
  const minutes = travelMode === 'transit' && route ? route.minutes : est.minutes
  if (minutes === null) return null
  const liveLabel = travelMode === 'transit' && route ? ' (live TfL)' : ''
  const arrive = new Date(now.getTime() + minutes * 60_000)
  const arriveLabel = `${String(arrive.getHours()).padStart(2, '0')}:${String(arrive.getMinutes()).padStart(2, '0')}`
  const legSummary =
    route && route.legs.length > 0
      ? route.legs
          .map((l) => (l.mode === 'walking' ? '🚶' : `${tflModeIcon(l.mode)} ${l.line}`))
          .join(' → ')
      : null

  return (
    <div className="home-card">
      <div className="home-card-main">
        <span className="home-card-title">🏠 Head home</span>
        <span className="home-card-info">
          ≈ {formatRemaining(minutes)} {TRAVEL_MODE_PHRASE[travelMode]}
          {liveLabel} · arrive ~{arriveLabel}
        </span>
        {legSummary && <span className="home-card-route">{legSummary}</span>}
      </div>
      <a className="travel-link" href={est.mapsUrl} target="_blank" rel="noopener noreferrer">
        Directions ↗
      </a>
    </div>
  )
}

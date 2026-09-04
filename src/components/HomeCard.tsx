import { useEffect, useState } from 'react'
import type { Coords, TravelMode } from '../lib/campus'
import { TRAVEL_MODE_PHRASE, estimateTravelToCoords, haversineMeters } from '../lib/campus'
import { formatRemaining } from '../lib/format'
import { cachedRouteMinutes, tflModeIcon, tflRoute } from '../lib/tfl'
import type { TflRoute } from '../lib/tfl'

interface Props {
  home: { lat: number; lng: number }
  /** device location (travel times enabled), else null */
  coords: Coords | null
  travelMode: TravelMode
}

/**
 * Compact "head home" pill in the header — shows the journey-home minutes
 * whenever you're away from home (any time of day), and expands into a small
 * dropdown with the live route, arrival ETA and a Directions link. Hides
 * itself at home. Coordinates never leave the device.
 */
export function HomePill({ home, coords, travelMode }: Props) {
  const [open, setOpen] = useState(false)
  // A minute tick keeps the pill/ETA current without any other re-render.
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000)
    return () => clearInterval(t)
  }, [])

  const visible = coords !== null && haversineMeters(coords, home) > 400

  // Live TfL journey while the dropdown is open (refreshed every 5 minutes).
  const [route, setRoute] = useState<TflRoute | null>(null)
  useEffect(() => {
    setRoute(null)
    if (!open || !visible || travelMode !== 'transit' || !coords) return
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
  }, [open, visible, travelMode, coords?.lat, coords?.lng, home.lat, home.lng])

  if (!visible || !coords) return null

  const est = estimateTravelToCoords(home, coords, travelMode, 'Home')
  let minutes = est.minutes
  let live = false
  if (travelMode === 'transit') {
    const cached = route?.minutes ?? cachedRouteMinutes(coords, home)
    if (cached !== null && cached !== undefined) {
      minutes = cached
      live = true
    }
  }
  if (minutes === null) return null
  const arrive = new Date(Date.now() + minutes * 60_000)
  const arriveLabel = `${String(arrive.getHours()).padStart(2, '0')}:${String(arrive.getMinutes()).padStart(2, '0')}`
  const legSummary =
    route && route.legs.length > 0
      ? route.legs.map((l) => (l.mode === 'walking' ? '🚶' : `${tflModeIcon(l.mode)} ${l.line}`)).join(' → ')
      : null

  return (
    <>
      <button
        type="button"
        className={`btn-icon home-pill${open ? ' on' : ''}`}
        aria-expanded={open}
        aria-label={`Journey home: about ${formatRemaining(minutes)}`}
        title="Journey home"
        onClick={() => setOpen((v) => !v)}
      >
        🏠<span className="home-pill-mins">{formatRemaining(minutes)}</span>
      </button>
      {open && (
        <div className="home-pop" role="region" aria-label="Journey home">
          <div className="home-card-main">
            <span className="home-card-title">🏠 Head home</span>
            <span className="home-card-info">
              ≈ {formatRemaining(minutes)} {TRAVEL_MODE_PHRASE[travelMode]}
              {live ? ' (live TfL)' : ''} · arrive ~{arriveLabel}
            </span>
            {legSummary && <span className="home-card-route">{legSummary}</span>}
          </div>
          <a className="travel-link" href={est.mapsUrl} target="_blank" rel="noopener noreferrer">
            Directions ↗
          </a>
        </div>
      )}
    </>
  )
}

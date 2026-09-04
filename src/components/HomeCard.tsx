import { useEffect, useState } from 'react'
import type { Coords, TravelMode } from '../lib/campus'
import { TRAVEL_MODE_PHRASE, estimateTravelToCoords, haversineMeters } from '../lib/campus'
import { formatRemaining } from '../lib/format'
import { cachedRouteMinutes } from '../lib/tfl'
import { cachedWeatherForHour, weatherEmoji, weatherForHour } from '../lib/weather'
import { useLiveJourney } from '../hooks/useLiveJourney'
import { RouteSteps } from './RouteSteps'
import { StaticMap } from './StaticMap'

interface Props {
  home: { lat: number; lng: number }
  /** device location (travel times enabled), else null */
  coords: Coords | null
  travelMode: TravelMode
}

/**
 * Compact "head home" pill in the header — shows the journey-home minutes
 * whenever you're away from home (any time of day). The dropdown carries the
 * same end-to-end journey as a session's detail sheet: the visual route
 * timeline with per-leg live departure boards, disruption warnings, weather
 * and the map. Hides itself at home. Coordinates never leave the device.
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

  const { route, legDeps, routeDisruptions } = useLiveJourney(
    coords,
    home,
    open && visible && travelMode === 'transit'
  )

  // Weather for the journey (you're leaving now, so: this hour's forecast).
  const [weatherReady, setWeatherReady] = useState(false)
  const now = new Date()
  const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  useEffect(() => {
    if (!open) return
    void weatherForHour(todayISO, new Date().getHours()).then((w) => setWeatherReady(w !== null))
  }, [open, todayISO])

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
  const forecast = open && weatherReady ? cachedWeatherForHour(todayISO, now.getHours()) : null

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
          </div>
          {route && <RouteSteps route={route} legDeps={legDeps} routeDisruptions={routeDisruptions} />}
          {route && route.legs.length === 0 && travelMode === 'transit' && (
            <p className="route-info">Best option now: walk (no transit leg needed).</p>
          )}
          {forecast && (
            <p className="route-info">
              {weatherEmoji(forecast.code)} {Math.round(forecast.tempC)}°
              {forecast.rainProb >= 30 ? ` · ${forecast.rainProb}% rain` : ''} for the journey
            </p>
          )}
          <StaticMap lat={home.lat} lng={home.lng} label="Home" />
          <a className="btn-secondary btn-link" href={est.mapsUrl} target="_blank" rel="noopener noreferrer">
            Directions home ↗
          </a>
        </div>
      )}
    </>
  )
}

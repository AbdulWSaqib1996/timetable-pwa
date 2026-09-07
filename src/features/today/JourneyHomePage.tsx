import { useEffect, useState } from 'react'
import { freshnessLabel } from '../../../shared/travel-state.js'
import { RouteSteps } from '../../components/RouteSteps'
import { StaticMap } from '../../components/StaticMap'
import { EmptyState, PageHeader } from '../../components/ui'
import { useLiveJourney } from '../../hooks/useLiveJourney'
import { TRAVEL_MODE_PHRASE, estimateTravelToCoords, haversineMeters } from '../../lib/campus'
import type { Coords, TravelMode } from '../../lib/campus'
import { formatRemaining } from '../../lib/format'
import { cachedRouteInfo } from '../../lib/tfl'
import { cachedWeatherForHour, weatherEmoji, weatherForHour } from '../../lib/weather'
import type { Settings } from '../../types'

interface Props {
  settings: Settings
  coords: Coords | null
  locationEnabled: boolean
  travelMode: TravelMode
  onBack: () => void
  onOpenSettings: () => void
}

/**
 * Journey home (P4-06): a full-width screen (contained panel on desktop via
 * the shell's reading width) with the same journey structure as session
 * travel — summary + freshness, explicit origin, destination card, visible
 * map, collapsible steps, external directions. Intent is leave-now to home;
 * never an arrival-by plan (Phase 6).
 */
export function JourneyHomePage({ settings, coords, locationEnabled, travelMode, onBack, onOpenSettings }: Props) {
  const homeSet = settings.homeLat != null && settings.homeLng != null
  const home = homeSet ? { lat: settings.homeLat!, lng: settings.homeLng! } : null
  const nearHome = home && coords ? haversineMeters(coords, home) <= 400 : false

  const { route, routeFetchedAt, legDeps, routeDisruptions } = useLiveJourney(
    coords,
    home,
    travelMode === 'transit' && !!coords && !!home
  )

  // A minute tick keeps the arrival estimate current.
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000)
    return () => clearInterval(t)
  }, [])

  const todayISO = (() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })()
  const [weatherReady, setWeatherReady] = useState(false)
  useEffect(() => {
    void weatherForHour(todayISO, new Date().getHours()).then((w) => setWeatherReady(w !== null))
  }, [todayISO])
  const forecast = weatherReady ? cachedWeatherForHour(todayISO, new Date().getHours()) : null

  if (!home) {
    return (
      <div className="page journey-home-page">
        <button type="button" className="page-back" onClick={onBack}>
          ‹ Back
        </button>
        <PageHeader title="Journey home" />
        <EmptyState
          title="No home location saved yet"
          hint="Save your home address once and this screen shows the live route, departures and arrival estimate whenever you want to head back."
          action={
            <div className="btn-row">
              <button type="button" className="btn-primary" onClick={onOpenSettings}>
                Set home location
              </button>
              <button type="button" className="btn-ghost" onClick={onBack}>
                Not now
              </button>
            </div>
          }
        />
      </div>
    )
  }

  const est = coords ? estimateTravelToCoords(home, coords, travelMode, 'Home') : null
  let minutes = est?.minutes ?? null
  let basisLabel = 'estimate from distance'
  if (travelMode === 'transit' && coords) {
    if (route) {
      minutes = route.minutes
      basisLabel = freshnessLabel({ basis: 'provider', fetchedAt: routeFetchedAt })
    } else {
      const info = cachedRouteInfo(coords, home)
      if (info) {
        minutes = info.route.minutes
        basisLabel = freshnessLabel({ basis: 'provider', fetchedAt: info.fetchedAt })
      }
    }
  }
  const arrive = minutes !== null ? new Date(Date.now() + minutes * 60_000) : null
  const arriveLabel = arrive
    ? `${String(arrive.getHours()).padStart(2, '0')}:${String(arrive.getMinutes()).padStart(2, '0')}`
    : null
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${home.lat},${home.lng}&travelmode=${travelMode === 'transit' ? 'transit' : travelMode}`

  return (
    <div className="page journey-home-page">
      <button type="button" className="page-back" onClick={onBack}>
        ‹ Back
      </button>
      <PageHeader title="Journey home" subtitle="Leaving now — live route to your saved home" />

      {nearHome && (
        <p className="filter-hint">You look to be near home already (approximate). The route below still works.</p>
      )}

      <div className="travel-summary">
        {minutes !== null ? (
          <>
            <span className="travel-summary-mins">
              ≈ {formatRemaining(minutes)} {TRAVEL_MODE_PHRASE[travelMode]}
            </span>
            <span className="filter-hint">
              {basisLabel}
              {arriveLabel ? ` · arrive ~${arriveLabel}` : ''}
            </span>
          </>
        ) : !locationEnabled ? (
          <span className="filter-hint">
            Travel times are off. Turn them on in Settings for a live journey — the address, map and external
            directions below work without them.
          </span>
        ) : (
          <span className="filter-hint">
            Waiting for your location… if this persists, check the app still has location permission, or use
            the external directions below.
          </span>
        )}
      </div>

      <p className="filter-hint journey-origin">
        {coords
          ? 'From your current location (live device fix)'
          : locationEnabled
            ? 'Origin: waiting for a device location fix'
            : 'Origin: unavailable — location is off'}
      </p>

      <div className="ui-card destination-card">
        <span className="today-hero-room-name">Home</span>
        {settings.homeAddress && <span className="today-hero-building">{settings.homeAddress}</span>}
        {settings.homeAddress && (
          <button
            type="button"
            className="travel-link copy-address"
            onClick={() => void navigator.clipboard?.writeText(settings.homeAddress!).catch(() => {})}
          >
            Copy address
          </button>
        )}
      </div>

      <StaticMap lat={home.lat} lng={home.lng} label="Home" />

      {route && route.legs.length > 0 ? (
        <details className="journey-steps" open>
          <summary>
            <span>Journey steps</span>
            <span className="route-total">
              ≈ {formatRemaining(route.minutes)} ·{' '}
              {[...new Set(route.legs.map((l) => (l.mode === 'walking' ? 'walk' : l.line || l.mode)))].join(' · ')}
            </span>
          </summary>
          <RouteSteps route={route} legDeps={legDeps} routeDisruptions={routeDisruptions} />
        </details>
      ) : route && route.legs.length === 0 && travelMode === 'transit' ? (
        <p className="route-info">Best option now: walk (no transit leg needed).</p>
      ) : null}

      {forecast && (
        <p className="route-info">
          {weatherEmoji(forecast.code)} {Math.round(forecast.tempC)}°
          {forecast.rainProb >= 30 ? ` · ${forecast.rainProb}% rain` : ''} for the journey
        </p>
      )}

      <a className="btn-primary btn-link external-nav" href={mapsUrl} target="_blank" rel="noopener noreferrer">
        Directions home ↗
      </a>
      <p className="filter-hint external-nav-caption">Opens navigation outside My Timetable</p>
    </div>
  )
}

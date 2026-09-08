import { useEffect, useState } from 'react'
import { telemetryTrack } from '../../lib/telemetry'
import { ItinerarySteps } from '../../components/ItinerarySteps'
import { OriginSelector } from '../../components/OriginSelector'
import { RouteMap } from '../../components/RouteMap'
import { StaticMap } from '../../components/StaticMap'
import { EmptyState, PageHeader } from '../../components/ui'
import { useJourney } from '../../hooks/useJourney'
import { TRAVEL_MODE_PHRASE, estimateTravelToCoords, haversineMeters } from '../../lib/campus'
import type { Coords, TravelMode } from '../../lib/campus'
import { formatRemaining } from '../../lib/format'
import type { OriginOption } from '../../lib/origins'
import { cachedWeatherForHour, weatherEmoji, weatherForHour } from '../../lib/weather'
import type { Settings } from '../../types'

interface Props {
  settings: Settings
  coords: Coords | null
  locationEnabled: boolean
  travelMode: TravelMode
  /** selectable origins (home itself is filtered out) */
  origins: OriginOption[]
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
export function JourneyHomePage({ settings, coords, locationEnabled, travelMode, origins, onBack, onOpenSettings }: Props) {
  const homeSet = settings.homeLat != null && settings.homeLng != null
  const home = homeSet ? { lat: settings.homeLat!, lng: settings.homeLng! } : null
  const nearHome = home && coords ? haversineMeters(coords, home) <= 400 : false

  // Home is the DESTINATION — it never appears as an origin here, and the
  // request is always leave-now (an earlier session's arrive-by plan can
  // never be reused: the request identity differs by construction, P6-04).
  const originOptions = origins.filter((o) => o.basis !== 'home')
  const [originId, setOriginId] = useState<string | null>(
    () => originOptions.find((o) => o.basis === 'device' && o.coords)?.id ?? null
  )
  useEffect(() => {
    if (originId === null) {
      const device = originOptions.find((o) => o.basis === 'device' && o.coords)
      if (device) setOriginId(device.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originOptions.find((o) => o.basis === 'device')?.coords != null])
  const origin = originOptions.find((o) => o.id === originId && o.coords) ?? null

  const journey = useJourney({
    origin,
    destination: home ? { coords: home, label: 'Home' } : null,
    mode: travelMode,
    intent: { kind: 'leave-now' },
    enabled: travelMode !== 'driving' && !!home && !!origin,
  })

  // A minute tick keeps the arrival estimate current.
  const [, setTick] = useState(0)
  useEffect(() => telemetryTrack('journey_home_opened'), [])
  // Route-map leg highlight (P7-03), cleared when the itinerary changes.
  const [selectedLeg, setSelectedLeg] = useState<number | null>(null)
  useEffect(() => setSelectedLeg(null), [journey.itinerary])
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

  const est = origin?.coords ? estimateTravelToCoords(home, origin.coords, travelMode, 'Home') : null
  let minutes = est?.minutes ?? null
  let basisLabel = 'estimate from distance'
  if (journey.itinerary) {
    minutes = journey.itinerary.durationMins
    basisLabel = `live TfL${journey.fetchedAt ? ` · checked ${new Date(journey.fetchedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}`
  } else if (journey.status === 'error' && minutes !== null) {
    basisLabel = "estimate from distance — couldn't reach TfL"
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

      <OriginSelector options={originOptions} selectedId={originId} onSelect={setOriginId} />
      {!origin && (
        <p className="filter-hint journey-origin">
          {locationEnabled
            ? 'Waiting for a device fix — or pick a saved origin above.'
            : 'Location is off — pick a saved origin above, or use the external directions below.'}
        </p>
      )}

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

      {journey.itinerary && journey.itinerary.legs.some((l) => l.geometry.length >= 2) ? (
        <RouteMap
          itinerary={journey.itinerary}
          origin={origin?.coords ?? null}
          destination={home}
          selectedLeg={selectedLeg}
          label="Home"
        />
      ) : (
        <StaticMap lat={home.lat} lng={home.lng} label="Home" />
      )}

      {journey.itinerary && journey.itinerary.legs.length > 0 ? (
        <details className="journey-steps" open>
          <summary>
            <span>Journey steps</span>
            <span className="route-total">
              ≈ {formatRemaining(journey.itinerary.durationMins)} ·{' '}
              {[...new Set(journey.itinerary.legs.map((l) => (l.mode === 'walking' ? 'walk' : l.line || l.mode)))].join(' · ')}
            </span>
          </summary>
          <ItinerarySteps
            itinerary={journey.itinerary}
            legDeps={journey.legDeps}
            disruptions={journey.disruptions}
            selectedLeg={selectedLeg}
            onSelectLeg={setSelectedLeg}
          />
        </details>
      ) : journey.itinerary && journey.itinerary.legs.length === 0 && travelMode === 'transit' ? (
        <p className="route-info">Best option now: walk (no transit leg needed).</p>
      ) : null}

      {forecast && (
        <p className="route-info">
          {weatherEmoji(forecast.code)} {Math.round(forecast.tempC)}°
          {forecast.rainProb >= 30 ? ` · ${forecast.rainProb}% rain` : ''} for the journey
        </p>
      )}

      <a className="btn-primary btn-link external-nav" href={mapsUrl} target="_blank" rel="noopener noreferrer" onClick={() => telemetryTrack('navigation_link_opened')}>
        Directions home ↗
      </a>
      <p className="filter-hint external-nav-caption">Opens navigation outside My Timetable</p>
    </div>
  )
}

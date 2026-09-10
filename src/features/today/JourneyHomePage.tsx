import { useEffect, useRef, useState } from 'react'
import { telemetryTrack } from '../../lib/telemetry'
import { useCourseClock } from '../../hooks/useCourseClock'
import { utcToZonedParts } from '../../../shared/calendar-time.js'
import { courseZone } from '../../lib/course'
import { ItinerarySteps } from '../../components/ItinerarySteps'
import { OriginSelector } from '../../components/OriginSelector'
import { RouteMap } from '../../components/RouteMap'
import { StaticMap } from '../../components/StaticMap'
import { CopyButton } from '../../components/CopyButton'
import { EmptyState, IconAlert, IconChevronLeft, IconHome, IconPin, PageHeader } from '../../components/ui'
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
  onUpdateSettings?: (patch: Partial<Settings>) => void
}

/**
 * Journey home (P4-06 → V3): one origin/destination summary, one state
 * sentence, then the primary action for the state ("Choose starting point"
 * until an origin exists), the explicit origin control, the visible map,
 * collapsible steps and external directions. Intent is leave-now to home;
 * never an arrival-by plan (Phase 6). The starting point is never inferred
 * from the last session.
 */
export function JourneyHomePage({ settings, coords, locationEnabled, travelMode, origins, onBack, onOpenSettings, onUpdateSettings }: Props) {
  const homeSet = settings.homeLat != null && settings.homeLng != null
  const home = homeSet ? { lat: settings.homeLat!, lng: settings.homeLng! } : null
  const nearHome = home && coords ? haversineMeters(coords, home) <= 400 : false

  // Home is the DESTINATION — it never appears as an origin here, and the
  // request is always leave-now (an earlier session's arrive-by plan can
  // never be reused: the request identity differs by construction, P6-04).
  const originOptions = origins.filter((o) => o.basis !== 'home')
  // NF-06 groundwork: a saved default origin for the journey home is used
  // before any live fix; a device fix only fills in when nothing is chosen.
  const [originId, setOriginId] = useState<string | null>(() => {
    const saved = settings.defaultOriginHome
    if (saved && originOptions.some((o) => o.id === saved && o.coords)) return saved
    return originOptions.find((o) => o.basis === 'device' && o.coords)?.id ?? null
  })
  useEffect(() => {
    if (originId === null) {
      const device = originOptions.find((o) => o.basis === 'device' && o.coords)
      if (device) setOriginId(device.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originOptions.find((o) => o.basis === 'device')?.coords != null])
  const origin = originOptions.find((o) => o.id === originId && o.coords) ?? null
  const originSelect = useRef<HTMLSelectElement>(null)

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

  // Course clock (TT-05): today and the forecast hour are course-local.
  const clock = useCourseClock()
  const todayISO = clock.todayISO
  const courseHour = Math.floor(clock.nowMins / 60)
  const [weatherReady, setWeatherReady] = useState(false)
  useEffect(() => {
    void weatherForHour(todayISO, courseHour).then((w) => setWeatherReady(w !== null))
  }, [todayISO, courseHour])
  const forecast = weatherReady ? cachedWeatherForHour(todayISO, courseHour) : null

  if (!home) {
    return (
      <div className="page journey-home-page">
        <button type="button" className="page-back" onClick={onBack}>
          <IconChevronLeft size={18} /> Back
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
  // Arrival is formatted in the course zone and labelled when the device
  // clock differs — never a mix of clocks in one sentence (TT-05).
  const arriveLabel =
    minutes !== null
      ? `${utcToZonedParts(Date.now() + minutes * 60_000, courseZone()).hhmm}${clock.zoneDiffers ? ' course time' : ''}`
      : null
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${home.lat},${home.lng}&travelmode=${travelMode === 'transit' ? 'transit' : travelMode}`
  const tone = journey.itinerary ? 'live' : journey.status === 'error' || journey.status === 'no-route' ? 'attention' : origin ? 'estimate' : 'missing'

  return (
    <div className="page journey-home-page">
      <button type="button" className="page-back" onClick={onBack}>
        <IconChevronLeft size={18} /> Back
      </button>
      <PageHeader
        title="Journey home"
        subtitle={
          // Copy follows ONE journey state — never "live" before a live plan exists (TT-17).
          !origin
            ? 'Leaving now — choose where you are starting from'
            : journey.status === 'loading'
              ? 'Leaving now — planning the route'
              : journey.itinerary
                ? `Leaving now — live route${journey.fetchedAt ? ` (checked ${new Date(journey.fetchedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })})` : ''}`
                : journey.status === 'error'
                  ? 'Leaving now — route provider unreachable, estimate only'
                  : journey.status === 'no-route'
                    ? 'Leaving now — no route found'
                    : journey.status === 'no-provider'
                      ? 'Leaving now — external directions'
                      : 'Leaving now — distance estimate'
        }
      />

      {/* Origin → destination summary (V3): the starting point is explicitly unknown until chosen. */}
      <div className="ui-card travel-od" aria-label="Your return journey">
        <p className="travel-od-title">
          <span className="travel-od-tile" aria-hidden="true">
            <IconHome />
          </span>
          Your return journey
        </p>
        <div className="travel-od-row">
          <IconPin />
          <span>
            <strong>{origin ? origin.label : 'Starting point not selected'}</strong>
            <span className="travel-od-detail">{origin ? origin.detail ?? 'Chosen starting point' : 'Choose your current location or a saved place'}</span>
          </span>
        </div>
        <div className="travel-od-row destination-card">
          <IconHome />
          <span>
            <strong className="today-hero-room-name">Home</strong>
            {settings.homeAddress && <span className="today-hero-building travel-od-detail">{settings.homeAddress}</span>}
          </span>
        </div>
        {settings.homeAddress && (
          <div className="travel-od-actions">
            <CopyButton text={settings.homeAddress} />
            <button type="button" className="travel-link" onClick={onOpenSettings}>
              Edit home location
            </button>
          </div>
        )}
      </div>

      {nearHome && (
        <p className="filter-hint">You look to be near home already (approximate). The route below still works.</p>
      )}

      <div className={`travel-summary travel-summary--${tone}`}>
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
        ) : originOptions.some((o) => o.basis !== 'device' && o.coords) ? (
          <span className="filter-hint">
            <IconAlert size={16} /> Travel time needs a starting point — a past session does not confirm where you are now. Pick a saved
            origin above for a route — no location permission needed. The address, map and external directions below work regardless.
          </span>
        ) : !locationEnabled ? (
          <span className="filter-hint">
            <IconAlert size={16} /> No saved origin yet. Turn travel times on in Settings for a live journey from your location, or
            save a campus/placement origin — the address and external directions below work without either.
          </span>
        ) : (
          <span className="filter-hint">
            Waiting for your location… if this persists, check the app still has location permission, or use
            the external directions below.
          </span>
        )}
      </div>

      {!origin && originOptions.some((o) => o.coords) && (
        <button type="button" className="btn-primary travel-primary" onClick={() => originSelect.current?.focus()}>
          <IconPin size={18} /> Choose starting point
        </button>
      )}

      <OriginSelector options={originOptions} selectedId={originId} onSelect={setOriginId} selectRef={originSelect} />
      {origin && onUpdateSettings && settings.defaultOriginHome !== origin.id && origin.basis !== 'device' && (
        <p className="filter-hint journey-origin">
          <button type="button" className="travel-link" onClick={() => onUpdateSettings({ defaultOriginHome: origin.id })}>
            Use this origin by default for the journey home
          </button>
        </p>
      )}
      {!origin && (
        <p className="filter-hint journey-origin">
          {locationEnabled
            ? 'Waiting for a device fix — or pick a saved starting point.'
            : 'Location is off — pick a saved starting point, or use the external directions below.'}
        </p>
      )}

      {journey.itinerary && journey.itinerary.legs.some((l) => l.geometry.length >= 2) ? (
        <RouteMap
          itinerary={journey.itinerary}
          origin={origin?.coords ?? null}
          destination={home}
          selectedLeg={selectedLeg}
          label="Home"
        />
      ) : (
        <StaticMap lat={home.lat} lng={home.lng} label="Home" address={settings.homeAddress} />
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

      <a className={`${origin ? 'btn-primary' : 'btn-secondary'} btn-link external-nav`} href={mapsUrl} target="_blank" rel="noopener noreferrer" onClick={() => telemetryTrack('navigation_link_opened')}>
        Open home in Maps ↗
      </a>
      <p className="filter-hint external-nav-caption">Opens navigation outside My Timetable — Maps may ask for your location when you start.</p>
    </div>
  )
}

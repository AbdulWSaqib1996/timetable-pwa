import { useEffect, useMemo, useRef, useState } from 'react'
import { utcToZonedParts, wallToUTC } from '../../../shared/calendar-time.js'
import { requiredArrivalMs } from '../../../shared/journey.js'
import { courseZone } from '../../lib/course'
import { useCourseClock } from '../../hooks/useCourseClock'
import { useJourney } from '../../hooks/useJourney'
import { ItinerarySteps } from '../../components/ItinerarySteps'
import { OriginSelector } from '../../components/OriginSelector'
import { RouteMap } from '../../components/RouteMap'
import { StaticMap } from '../../components/StaticMap'
import { CopyButton } from '../../components/CopyButton'
import { EmptyState, IconAlert, IconChevronLeft, IconHome, IconPin, IconSchool, PageHeader } from '../../components/ui'
import { TRAVEL_MODE_PHRASE, estimateTravelToCoords, haversineMeters } from '../../lib/campus'
import type { Coords, TravelMode } from '../../lib/campus'
import { formatRemaining } from '../../lib/format'
import type { OriginOption } from '../../lib/origins'
import type { PlacementRec, SchoolLocationRec } from '../../lib/admin'
import { placementPolicy } from '../../lib/placement'
import { isPlacementSession, placementTag } from '../../lib/format'
import { telemetryTrack } from '../../lib/telemetry'
import type { Session, Settings } from '../../types'

interface Props {
  placement: PlacementRec
  school: SchoolLocationRec | undefined
  leg: 'out' | 'back'
  settings: Settings
  coords: Coords | null
  locationEnabled: boolean
  travelMode: TravelMode
  origins: OriginOption[]
  sessions: Session[]
  profileId: string
  onBack: () => void
  onOpenSettings: () => void
  onEditPlacement: () => void
}

const hhmm = (ms: number) => utcToZonedParts(ms, courseZone()).hhmm

/**
 * To school / Back home (PG-07A, G1a). Outward: arrive by the next mapped
 * school day's start minus this placement's buffer (or leave now once it has
 * started). Return: planned separately from the school — leave-now from the
 * school (or your current location) to home; never a reversed outward route.
 * The request identity (profile + placement + school pin + direction + origin
 * + destination + mode + time) lives in useJourney's key, so a late response
 * for SE1 can never render under SE2. Every existing travel control is kept:
 * origin choice, live TfL steps, route map or static map, Copy address, Maps.
 */
export function PlacementJourneyPage({ placement, school, leg, settings, coords, locationEnabled, travelMode, origins, sessions, profileId, onBack, onOpenSettings, onEditPlacement }: Props) {
  const clock = useCourseClock()
  const schoolCoords: Coords | null = school && school.lat != null && school.lng != null ? { lat: school.lat, lng: school.lng } : null
  const home: Coords | null = settings.homeLat != null && settings.homeLng != null ? { lat: settings.homeLat, lng: settings.homeLng } : null
  const policy = placementPolicy(settings)
  const hours = placement.workingHours ?? { start: policy.start, end: policy.end }
  const buffer = placement.arrivalBufferMins ?? settings.arrivalBufferMins ?? 10
  const schoolLabel = `${placement.code}${school?.name ? ` · ${school.name}` : ''}`
  const title = leg === 'out' ? 'To school' : 'Back home'

  // The next mapped school day (today counts until the day has started).
  const mapped = new Set(placement.mappedBlockTags)
  const nextDay = useMemo(() => {
    const days = [...new Set(sessions.filter((s) => !s.isKeyDate && isPlacementSession(s) && mapped.has(placementTag(s.title))).map((s) => s.dateISO))].sort()
    return days.find((d) => d >= clock.todayISO) ?? null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, placement.mappedBlockTags, clock.todayISO])
  const startMs = nextDay ? wallToUTC(nextDay, hours.start, courseZone()).utcMs : null
  const arriveByMs = startMs !== null ? requiredArrivalMs(startMs, buffer) : null
  const arriveByFuture = arriveByMs !== null && arriveByMs > Date.now() + 5 * 60_000

  // Origins: outward from home/device/saved places (never the school itself);
  // return from the school (or the device) — home is the destination.
  const schoolOrigin: OriginOption | null = schoolCoords ? { id: `placement-${placement.id}`, basis: 'placement', label: school?.name || placement.code, detail: school?.address, coords: schoolCoords } : null
  const originOptions = useMemo(() => {
    const base = origins.filter((o) => !(schoolCoords && o.coords && o.coords.lat === schoolCoords.lat && o.coords.lng === schoolCoords.lng))
    if (leg === 'out') return base
    return [...(schoolOrigin ? [schoolOrigin] : []), ...base.filter((o) => o.basis !== 'home')]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origins, leg, schoolCoords?.lat, schoolCoords?.lng, placement.id])
  const [originId, setOriginId] = useState<string | null>(() => {
    if (leg === 'back') return schoolOrigin?.id ?? originOptions.find((o) => o.basis === 'device' && o.coords)?.id ?? null
    return originOptions.find((o) => o.basis === 'home' && o.coords)?.id ?? originOptions.find((o) => o.basis === 'device' && o.coords)?.id ?? null
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

  const destination = leg === 'out' ? (schoolCoords ? { coords: schoolCoords, label: school?.name || 'School' } : null) : home ? { coords: home, label: 'Home' } : null
  const intent = leg === 'out' && arriveByFuture && arriveByMs !== null ? ({ kind: 'arrive-by', arriveByMs, timeZone: courseZone(), eventKey: `placement:${placement.id}:out` } as const) : ({ kind: 'leave-now' } as const)
  const journey = useJourney({
    origin,
    destination,
    mode: travelMode,
    intent,
    eventKey: `placement:${placement.id}:${leg}`,
    profileId,
    enabled: travelMode !== 'driving' && !!destination && !!origin,
  })
  const shown = journey.departure === 'passed' ? journey.fallback : journey.itinerary
  const [selectedLeg, setSelectedLeg] = useState<number | null>(null)
  useEffect(() => setSelectedLeg(null), [shown])
  const nearDestination = destination && coords ? haversineMeters(coords, destination.coords) <= 400 : false
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000)
    return () => clearInterval(t)
  }, [])

  const back = (
    <button type="button" className="page-back" onClick={onBack}>
      <IconChevronLeft size={18} /> {schoolLabel}
    </button>
  )

  if (leg === 'out' && !schoolCoords) {
    return (
      <div className="page journey-home-page">
        {back}
        <PageHeader title={title} subtitle={schoolLabel} />
        <EmptyState
          title="School location not confirmed yet"
          hint="Add the school address and confirm its pin in the placement setup — an address alone is not enough to plan a route."
          action={
            <div className="btn-row">
              <button type="button" className="btn-primary" onClick={onEditPlacement}>Complete setup</button>
              <button type="button" className="btn-ghost" onClick={onBack}>Not now</button>
            </div>
          }
        />
      </div>
    )
  }
  if (leg === 'back' && !home) {
    return (
      <div className="page journey-home-page">
        {back}
        <PageHeader title={title} subtitle={schoolLabel} />
        <EmptyState
          title="No return destination yet"
          hint="Save your home address once and the journey back from school shows the live route and arrival estimate."
          action={
            <div className="btn-row">
              <button type="button" className="btn-primary" onClick={onOpenSettings}>Set return destination</button>
              <button type="button" className="btn-ghost" onClick={onBack}>Not now</button>
            </div>
          }
        />
      </div>
    )
  }

  const dest = destination!.coords
  const est = origin?.coords ? estimateTravelToCoords(dest, origin.coords, travelMode, destination!.label) : null
  let minutes = est?.minutes ?? null
  let basisLabel = 'estimate from distance'
  if (shown) {
    minutes = shown.durationMins
    basisLabel = `live TfL${journey.fetchedAt ? ` · checked ${new Date(journey.fetchedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}`
  } else if (journey.status === 'error' && minutes !== null) basisLabel = "estimate from distance — couldn't reach TfL"
  const leaveLabel = journey.leaveByMs ? hhmm(journey.leaveByMs) : null
  const arriveLabel = minutes !== null && intent.kind === 'leave-now' ? hhmm(Date.now() + minutes * 60_000) : null
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${dest.lat},${dest.lng}&travelmode=${travelMode === 'transit' ? 'transit' : travelMode}`
  const tone = shown ? 'live' : journey.status === 'error' || journey.status === 'no-route' ? 'attention' : origin ? 'estimate' : 'missing'
  const whenLine =
    leg === 'out'
      ? intent.kind === 'arrive-by'
        ? `Arrive by ${hhmm(arriveByMs!)} on ${nextDay}${nextDay === clock.todayISO ? ' (today)' : ''} · ${buffer} min early · ${TRAVEL_MODE_PHRASE[travelMode]}`
        : nextDay
          ? `School day has started (${hours.start}) — leaving now · ${TRAVEL_MODE_PHRASE[travelMode]}`
          : `No mapped school day ahead — leaving now · ${TRAVEL_MODE_PHRASE[travelMode]}`
      : `Leaving now · school day ends ${hours.end} · ${TRAVEL_MODE_PHRASE[travelMode]}`

  return (
    <div className="page journey-home-page journey-placement-page">
      {back}
      <PageHeader
        title={title}
        subtitle={
          !origin
            ? 'Choose where you are starting from'
            : journey.status === 'loading'
              ? 'Planning the route'
              : shown
                ? `Live route${journey.fetchedAt ? ` (checked ${new Date(journey.fetchedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })})` : ''}`
                : journey.status === 'error'
                  ? 'Route provider unreachable, estimate only'
                  : journey.status === 'no-route'
                    ? 'No route found'
                    : journey.status === 'no-provider'
                      ? 'External directions'
                      : 'Distance estimate'
        }
      />

      <div className="ui-card travel-od" aria-label={leg === 'out' ? 'Journey to school' : 'Journey home from school'}>
        <p className="travel-od-title">
          <span className="travel-od-tile" aria-hidden="true">{leg === 'out' ? <IconSchool /> : <IconHome />}</span>
          {leg === 'out' ? `To ${schoolLabel}` : `From ${schoolLabel}`}
        </p>
        <div className="travel-od-row">
          <IconPin />
          <span>
            <strong>{origin ? origin.label : 'Starting point not selected'}</strong>
            <span className="travel-od-detail">{origin ? origin.detail ?? 'Chosen starting point' : 'Choose your current location or a saved place'}</span>
          </span>
        </div>
        <div className="travel-od-row destination-card">
          {leg === 'out' ? <IconSchool /> : <IconHome />}
          <span>
            <strong className="today-hero-room-name">{destination!.label}</strong>
            <span className="today-hero-building travel-od-detail">{leg === 'out' ? school?.address || 'Address not set' : settings.homeAddress || ''}</span>
            {leg === 'out' && school?.entranceNote && <span className="travel-od-detail">{school.entranceNote}</span>}
          </span>
        </div>
        <p className="filter-hint travel-od-when">{whenLine}</p>
        <div className="travel-od-actions">
          {(leg === 'out' ? school?.address : settings.homeAddress) && <CopyButton text={(leg === 'out' ? school?.address : settings.homeAddress) as string} />}
          <button type="button" className="travel-link" onClick={leg === 'out' ? onEditPlacement : onOpenSettings}>
            {leg === 'out' ? 'Edit school' : 'Edit home location'}
          </button>
        </div>
        {leg === 'out' && school && !school.confirmedAt && (
          <p className="filter-hint"><IconAlert size={16} /> This pin has not been confirmed — confirm it in the placement setup so reminders use the right place.</p>
        )}
      </div>

      {nearDestination && <p className="filter-hint">You look to be near {destination!.label} already (approximate). The route below still works.</p>}
      <div className={`travel-summary travel-summary--${tone}`}>
        {minutes !== null ? (
          <>
            <span className="travel-summary-mins">≈ {formatRemaining(minutes)} {TRAVEL_MODE_PHRASE[travelMode]}</span>
            <span className="filter-hint">
              {basisLabel}
              {leaveLabel && intent.kind === 'arrive-by' ? ` · leave by ${leaveLabel}` : ''}
              {arriveLabel ? ` · arrive ~${arriveLabel}` : ''}
            </span>
          </>
        ) : originOptions.some((o) => o.coords) ? (
          <span className="filter-hint"><IconAlert size={16} /> Travel time needs a starting point — pick one below. The address, map and external directions work regardless.</span>
        ) : !locationEnabled ? (
          <span className="filter-hint"><IconAlert size={16} /> No saved origin yet. Turn travel times on in Settings for a live journey from your location, or save your home — the address and external directions work without either.</span>
        ) : (
          <span className="filter-hint">Waiting for your location… if this persists, check the app still has location permission, or use the external directions below.</span>
        )}
      </div>

      {!origin && originOptions.some((o) => o.coords) && (
        <button type="button" className="btn-primary travel-primary" onClick={() => originSelect.current?.focus()}>
          <IconPin size={18} /> Choose starting point
        </button>
      )}
      <OriginSelector options={originOptions} selectedId={originId} onSelect={setOriginId} selectRef={originSelect} />
      {(journey.status === 'error' || journey.status === 'no-route') && (
        <button type="button" className="btn-secondary" onClick={journey.retry}>Retry</button>
      )}

      {shown && shown.legs.some((l) => l.geometry.length >= 2) ? (
        <RouteMap itinerary={shown} origin={origin?.coords ?? null} destination={dest} selectedLeg={selectedLeg} label={destination!.label} address={leg === 'out' ? school?.address : settings.homeAddress} />
      ) : (
        <StaticMap lat={dest.lat} lng={dest.lng} label={destination!.label} address={leg === 'out' ? school?.address : settings.homeAddress} />
      )}

      {shown && shown.legs.length > 0 ? (
        <details className="journey-steps" open>
          <summary>
            <span>Journey steps</span>
            <span className="route-total">≈ {formatRemaining(shown.durationMins)} · {[...new Set(shown.legs.map((l) => (l.mode === 'walking' ? 'walk' : l.line || l.mode)))].join(' · ')}</span>
          </summary>
          <ItinerarySteps itinerary={shown} legDeps={journey.legDeps} disruptions={journey.disruptions} selectedLeg={selectedLeg} onSelectLeg={setSelectedLeg} />
        </details>
      ) : shown && shown.legs.length === 0 && travelMode === 'transit' ? (
        <p className="route-info">Best option: walk (no transit leg needed).</p>
      ) : null}

      <a className={`${origin ? 'btn-primary' : 'btn-secondary'} btn-link external-nav`} href={mapsUrl} target="_blank" rel="noopener noreferrer" onClick={() => telemetryTrack('navigation_link_opened')}>
        Open in Maps ↗
      </a>
      <p className="filter-hint external-nav-caption">Opens navigation outside My Timetable — Maps may ask for your location when you start.</p>
    </div>
  )
}

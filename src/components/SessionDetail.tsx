import { IdentityReview } from './IdentityReview'
import { reportPersistenceFailure } from '../lib/persistence'
import { useEffect, useRef, useState } from 'react'
import { useModalA11y } from '../lib/a11y'
import { freshnessLabel } from '../../shared/travel-state.js'
import { TRAVEL_MODE_PHRASE, estimateTravel, estimateTravelToCoords } from '../lib/campus'
import { geocodeAddress } from '../lib/geocode'
import { TEACHERS_STANDARDS } from '../lib/standards'
import type { Coords, TravelMode } from '../lib/campus'
import { formatRemaining, googleCalendarUrl, isPlacementSession } from '../lib/format'
import { parseLocation } from '../lib/location'
import { sessionKey } from '../lib/diff'
import { trackUse } from '../lib/usage'
import { addPhoto, compressImage, deletePhoto, getPhotos } from '../lib/photos'
import type { StoredPhoto } from '../lib/photos'
import { useLiveJourney } from '../hooks/useLiveJourney'
import { RouteSteps } from './RouteSteps'
import { weatherEmoji, weatherForHour } from '../lib/weather'
import type { HourWeather } from '../lib/weather'
import type { Session, SessionMeta } from '../types'
import { SegmentedControl } from './ui'
import { StaticMap } from './StaticMap'

interface Props {
  session: Session
  meta?: SessionMeta
  /** device location when the user enabled travel times, else null */
  coords: Coords | null
  locationEnabled: boolean
  travelMode: TravelMode
  /** active profile id, for the photo store */
  profileId: string
  /** full page (mobile) or dialog sheet (desktop) */
  presentation: 'page' | 'sheet'
  /** label for the Back control in page presentation */
  backLabel?: string
  /** placement details for this session's SE block (placement sessions only) */
  placementInfo?: { school?: string; address?: string; mentor?: string; notes?: string; lat?: number; lng?: number }
  onPlacementInfo?: (patch: {
    school?: string
    address?: string
    mentor?: string
    notes?: string
    lat?: number
    lng?: number
  }) => void
  onMeta: (patch: Partial<SessionMeta>) => void
  onClose: () => void
}

function formatLongDate(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function shortDate(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

function toMinutes(time: string): number | null {
  const m = time.match(/^(\d{1,2}):(\d{2})$/)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

function formatDuration(start: string, end: string): string | null {
  const s = toMinutes(start)
  const e = toMinutes(end)
  if (s === null || e === null || e <= s) return null
  const mins = e - s
  const hours = Math.floor(mins / 60)
  const rest = mins % 60
  if (hours === 0) return `${rest} minutes`
  const hourPart = `${hours} hour${hours === 1 ? '' : 's'}`
  return rest > 0 ? `${hourPart} ${rest} minutes` : hourPart
}

/**
 * Session detail (P4-05): full-page on mobile with Back, dialog sheet on
 * desktop. Overview and Travel & map tabs stay mounted so entered notes and
 * draft state survive tab switches. A deadline opens task detail instead —
 * no attendance controls or campus travel for a submission.
 */
export function SessionDetail({
  session,
  meta,
  coords,
  locationEnabled,
  travelMode,
  profileId,
  presentation,
  backLabel = 'Back',
  placementInfo,
  onPlacementInfo,
  onMeta,
  onClose,
}: Props) {
  const isTask = session.isKeyDate === true
  const [tab, setTab] = useState<'overview' | 'travel'>('overview')
  const dialogRef = useModalA11y<HTMLDivElement>(onClose)
  const duration = formatDuration(session.start, session.end)
  const gcalUrl = googleCalendarUrl(session)

  // Placement sessions with a geocoded school address target the school;
  // everything else targets the matched campus building.
  const schoolCoords =
    isPlacementSession(session) && placementInfo?.lat != null && placementInfo?.lng != null
      ? { lat: placementInfo.lat, lng: placementInfo.lng }
      : null
  const travel = isTask
    ? null
    : schoolCoords
      ? estimateTravelToCoords(schoolCoords, coords, travelMode, placementInfo?.school || 'Placement school')
      : session.room && !session.isSelfStudy
        ? estimateTravel(session.room, coords, travelMode)
        : null

  const [geoStatus, setGeoStatus] = useState<'working' | 'ok' | 'fail' | null>(null)

  // Photo notes (stored locally in IndexedDB, downscaled on save).
  const [photos, setPhotos] = useState<StoredPhoto[]>([])
  const photoUrls = useRef<string[]>([])
  const reloadPhotos = () =>
    void getPhotos(profileId, sessionKey(session)).then((list) => {
      photoUrls.current.forEach((u) => URL.revokeObjectURL(u))
      photoUrls.current = list.map((p) => URL.createObjectURL(p.blob))
      setPhotos(list)
    }).catch(error => reportPersistenceFailure('Photos could not be read: ' + String(error)))
  useEffect(() => {
    reloadPhotos()
    return () => {
      photoUrls.current.forEach((u) => URL.revokeObjectURL(u))
      photoUrls.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, profileId])

  async function handleAddPhoto(file: File) {
    trackUse('photo')
    const blob = await compressImage(file)
    await addPhoto(profileId, sessionKey(session), blob)
    onMeta({ photos: photos.length + 1 })
    reloadPhotos()
  }

  async function handleDeletePhoto(id: number) {
    await deletePhoto(id)
    onMeta({ photos: Math.max(0, photos.length - 1) || undefined })
    reloadPhotos()
  }

  // Live TfL journey — departure boards poll only while Travel & map shows.
  const { route, routeFetchedAt, legDeps, routeDisruptions } = useLiveJourney(
    coords,
    travel?.location ?? null,
    tab === 'travel' && travelMode === 'transit' && !!coords && !!travel?.location
  )

  // Weather for the journey: forecast at the computed leave time (start − travel).
  const [journeyWeather, setJourneyWeather] = useState<{ at: string; w: HourWeather } | null>(null)
  const startMins = toMinutes(session.start)
  const travelMins = travelMode === 'transit' && route ? route.minutes : travel?.minutes ?? null
  useEffect(() => {
    setJourneyWeather(null)
    if (startMins === null || travelMins === null) return
    const leaveMins = startMins - travelMins
    if (leaveMins <= 0) return
    let cancelled = false
    void weatherForHour(session.dateISO, Math.floor(leaveMins / 60)).then((w) => {
      if (!cancelled && w) {
        setJourneyWeather({
          at: `${String(Math.floor(leaveMins / 60)).padStart(2, '0')}:${String(leaveMins % 60).padStart(2, '0')}`,
          w,
        })
      }
    })
    return () => {
      cancelled = true
    }
  }, [session.dateISO, startMins, travelMins])

  const shownMinutes = travelMode === 'transit' && route ? route.minutes : travel?.minutes ?? null
  const basisLabel =
    travelMode === 'transit' && route
      ? freshnessLabel({ basis: 'provider', fetchedAt: routeFetchedAt })
      : 'estimate from distance'

  // The sheet's Location column glues building and room together — split them.
  const loc = parseLocation(session.isSelfStudy || isTask ? '' : session.room)
  const locationRows: { label: string; value: string }[] = loc.building
    ? [
        { label: 'Building', value: loc.building },
        { label: 'Room', value: `${loc.room}${loc.roomName ? ` · ${loc.roomName}` : ''}` },
      ]
    : loc.note === 'booking-ref'
      ? [{ label: 'Room', value: `Not in the sheet yet (booking ref ${loc.raw})` }]
      : loc.note === 'tbc'
        ? [{ label: 'Room', value: 'TBC — check nearer the time' }]
        : loc.raw
          ? [{ label: 'Location', value: loc.raw }]
          : []
  const rows: { label: string; value: string }[] = [
    {
      label: isTask ? 'Due' : 'Date',
      value: formatLongDate(session.dateISO) + (isTask && session.start ? ` · ${session.start}` : ''),
    },
    {
      label: 'Time',
      value: !isTask && session.start ? (session.end ? `${session.start} – ${session.end}` : session.start) : '',
    },
    { label: 'Duration', value: !isTask ? duration ?? '' : '' },
    ...locationRows,
    { label: 'Tutor', value: session.tutor === 'Self Study' ? '' : session.tutor },
    { label: 'Subject', value: session.subject !== session.title ? session.subject : '' },
    { label: 'Groups', value: session.groups },
  ].filter((r) => r.value !== '')

  const conciseLine = [
    shortDate(session.dateISO),
    !isTask && session.start
      ? `${session.start}${session.end && session.end !== session.start ? `–${session.end}` : ''}`
      : isTask && session.start
        ? `due ${session.start}`
        : '',
    loc.building && loc.room ? `Room ${loc.room}` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  const overview = (
    <div className="detail-tabpanel" role="tabpanel" aria-label="Overview" hidden={tab !== 'overview'}>
      {session.isSpecialism && session.specialismName && (
        <span className="badge badge-specialism">Specialism · {session.specialismName}</span>
      )}
      {session.isSelfStudy && <span className="badge badge-selfstudy">Self study</span>}
      {session.isOptional && <span className="badge badge-optional">Optional</span>}
      <dl className="detail-list">
        {rows.map(({ label, value }) => (
          <div className="detail-row" key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {session.link ? (
        <a className="btn-primary btn-link" href={session.link} target="_blank" rel="noopener noreferrer">
          Open in Moodle ↗
        </a>
      ) : null}
      {gcalUrl && (
        <a className="btn-secondary btn-link" href={gcalUrl} target="_blank" rel="noopener noreferrer">
          Add to Google Calendar
        </a>
      )}
      {isTask ? (
        <section className="detail-notes">
          <div className="chip-grid attendance-chips" role="group" aria-label="Task status">
            {(['todo', 'doing', 'done'] as const).map((status) => (
              <button
                key={status}
                type="button"
                className={`chip${(meta?.status ?? 'todo') === status ? ' chip-on' : ''}`}
                aria-pressed={(meta?.status ?? 'todo') === status}
                onClick={() => onMeta({ status })}
              >
                {status === 'todo' ? 'To do' : status === 'doing' ? 'In progress' : '✓ Done'}
              </button>
            ))}
          </div>
          <textarea
            className="note-input"
            placeholder="Notes for this task (saved on this device)…"
            rows={2}
            value={meta?.note ?? ''}
            onChange={(e) => onMeta({ note: e.target.value })}
          />
        </section>
      ) : (
        <>
          {isPlacementSession(session) && onPlacementInfo && (
            <section className="detail-notes placement-details">
              <h3 className="subheading">🏫 Placement details</h3>
              <input
                type="text"
                className="placement-input"
                placeholder="School name"
                value={placementInfo?.school ?? ''}
                onChange={(e) => onPlacementInfo({ school: e.target.value })}
              />
              <input
                type="text"
                className="placement-input"
                placeholder="Address / postcode"
                value={placementInfo?.address ?? ''}
                onChange={(e) => onPlacementInfo({ address: e.target.value })}
                onBlur={(e) => {
                  const address = e.target.value.trim()
                  if (!address) return
                  setGeoStatus('working')
                  void geocodeAddress(address).then((located) => {
                    if (located) {
                      onPlacementInfo({ lat: located.lat, lng: located.lng })
                      setGeoStatus('ok')
                    } else {
                      setGeoStatus('fail')
                    }
                  })
                }}
              />
              {geoStatus === 'working' && <p className="filter-hint">📍 Locating the school…</p>}
              {geoStatus === 'fail' && (
                <p className="filter-hint">Couldn't locate that address — try adding the postcode.</p>
              )}
              {(geoStatus === 'ok' || (geoStatus === null && schoolCoords)) && (
                <p className="filter-hint">📍 Located — Travel & map now points at the school.</p>
              )}
              <input
                type="text"
                className="placement-input"
                placeholder="Mentor / contact"
                value={placementInfo?.mentor ?? ''}
                onChange={(e) => onPlacementInfo({ mentor: e.target.value })}
              />
              <textarea
                className="note-input"
                rows={2}
                placeholder="Placement notes (times, entry instructions, what to bring…)"
                value={placementInfo?.notes ?? ''}
                onChange={(e) => onPlacementInfo({ notes: e.target.value })}
              />
              <p className="filter-hint">Shared across all sessions of this placement block; saved on this device.</p>
            </section>
          )}
          <section className="detail-notes">
            <div className="chip-grid attendance-chips">
              <button
                type="button"
                className={`chip${meta?.attended ? ' chip-on' : ''}`}
                aria-pressed={meta?.attended === true}
                onClick={() =>
                  onMeta(
                    meta?.attended
                      ? { attended: false }
                      : { attended: true, absent: false, absentReason: undefined }
                  )
                }
              >
                ✓ Attended
              </button>
              <button
                type="button"
                className={`chip${meta?.absent ? ' chip-on chip-absent' : ''}`}
                aria-pressed={meta?.absent === true}
                onClick={() =>
                  onMeta(
                    meta?.absent
                      ? { absent: false, absentReason: undefined }
                      : { absent: true, attended: false }
                  )
                }
              >
                ✗ Absent
              </button>
              {!meta?.attended && !meta?.absent && !session.isSelfStudy && (
                <span className="badge">Unrecorded</span>
              )}
              {meta?.absent && (
                <select
                  className="absent-reason"
                  aria-label="Absence reason"
                  value={meta?.absentReason ?? ''}
                  onChange={(e) => onMeta({ absentReason: e.target.value || undefined })}
                >
                  <option value="">Reason…</option>
                  <option value="Sick">Sick</option>
                  <option value="Travel">Travel</option>
                  <option value="Personal">Personal</option>
                  <option value="Other">Other</option>
                </select>
              )}
            </div>
            <textarea
              className="note-input"
              placeholder="Notes for this session (saved on this device)…"
              rows={2}
              value={meta?.note ?? ''}
              onChange={(e) => onMeta({ note: e.target.value })}
            />
            <div className="chip-grid ts-chips">
              {TEACHERS_STANDARDS.map((ts) => {
                const on = (meta?.standards ?? []).includes(ts.id)
                return (
                  <button
                    key={ts.id}
                    type="button"
                    className={`chip chip-small${on ? ' chip-on' : ''}`}
                    aria-pressed={on}
                    title={ts.label}
                    onClick={() => {
                      const cur = meta?.standards ?? []
                      onMeta({ standards: on ? cur.filter((x) => x !== ts.id) : [...cur, ts.id].sort() })
                    }}
                  >
                    {ts.id}
                  </button>
                )
              })}
            </div>
            <p className="filter-hint">
              Tag notes/photos against the Teachers' Standards — they build your evidence journal.
            </p>
            <p className="filter-hint">{photos.length} photos available on this device.{(meta?.photos ?? 0) > photos.length ? ` ${(meta?.photos ?? 0) - photos.length} more recorded elsewhere; import a backup from that device to view them.` : ''}</p>
            <div className="photo-grid">
              {photos.map((p, i) => (
                <span className="photo-thumb" key={p.id}>
                  <a href={photoUrls.current[i]} target="_blank" rel="noopener noreferrer">
                    <img src={photoUrls.current[i]} alt="Session photo" loading="lazy" />
                  </a>
                  <button
                    type="button"
                    className="photo-delete"
                    aria-label="Delete photo"
                    onClick={() => void handleDeletePhoto(p.id).catch(error => reportPersistenceFailure('Photo deletion failed: ' + String(error)))}
                  >
                    ✕
                  </button>
                </span>
              ))}
              <label className="photo-add">
                📷 Add photo
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void handleAddPhoto(file).catch(error => reportPersistenceFailure('Photo save failed: ' + String(error)))
                    e.target.value = ''
                  }}
                />
              </label>
            </div>
          </section>
        </>
      )}
    </div>
  )

  const travelPanel = !isTask && travel && (
    <div className="detail-tabpanel" role="tabpanel" aria-label="Travel and map" hidden={tab !== 'travel'}>
      <div className="travel-summary">
        {shownMinutes !== null ? (
          <>
            <span className="travel-summary-mins">
              ≈ {formatRemaining(shownMinutes)} {TRAVEL_MODE_PHRASE[travelMode]}
            </span>
            <span className="filter-hint">
              {basisLabel}
              {coords ? ' · from your current location' : ''}
            </span>
          </>
        ) : locationEnabled ? (
          <span className="filter-hint">Waiting for your location… address and directions still work below.</span>
        ) : (
          <span className="filter-hint">
            Turn on travel times in Settings for a journey estimate — the address and directions work without it.
          </span>
        )}
      </div>
      <div className="ui-card destination-card">
        <span className="today-hero-room-name">{travel.building ?? (loc.raw || session.room)}</span>
        {loc.room && (
          <span className="today-hero-building">
            Room {loc.room}
            {loc.roomName ? ` · ${loc.roomName}` : ''}
          </span>
        )}
        {placementInfo?.address && <span className="today-hero-building">{placementInfo.address}</span>}
        <button
          type="button"
          className="travel-link copy-address"
          onClick={() => void navigator.clipboard?.writeText(placementInfo?.address || session.room).catch(() => {})}
        >
          Copy address
        </button>
      </div>
      {travel.location ? (
        <StaticMap lat={travel.location.lat} lng={travel.location.lng} label={travel.building ?? undefined} />
      ) : (
        <div className="ui-card map-fallback">
          <p className="filter-hint">
            No map match for this location — the address and external directions below still work.
          </p>
        </div>
      )}
      {route && route.legs.length > 0 ? (
        <details className="journey-steps">
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
      {journeyWeather && (
        <p className="route-info">
          {weatherEmoji(journeyWeather.w.code)} {Math.round(journeyWeather.w.tempC)}°
          {journeyWeather.w.rainProb >= 30 ? ` · ${journeyWeather.w.rainProb}% rain` : ''} around your leave
          time ({journeyWeather.at})
        </p>
      )}
      <a className="btn-primary btn-link external-nav" href={travel.mapsUrl} target="_blank" rel="noopener noreferrer">
        Open in Google Maps ↗
      </a>
      <p className="filter-hint external-nav-caption">Opens navigation outside My Timetable</p>
    </div>
  )

  const body = (
    <>
      <div className="sheet-header">
        <h2 className="detail-title">{session.title}</h2>
        <IdentityReview session={session} profileId={profileId} />
        {presentation === 'sheet' && (
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        )}
      </div>
      {conciseLine && <p className="detail-concise">{conciseLine}</p>}
      {!isTask && travel && (
        <div className="detail-tabs">
          <SegmentedControl
            label="Session detail sections"
            value={tab}
            options={[
              { value: 'overview', label: 'Overview' },
              { value: 'travel', label: 'Travel & map' },
            ]}
            onChange={setTab}
          />
        </div>
      )}
      {overview}
      {travelPanel}
      {presentation === 'sheet' && (
        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      )}
    </>
  )

  if (presentation === 'page') {
    return (
      <div className="page detail-page">
        <button type="button" className="page-back" onClick={onClose}>
          ‹ {backLabel}
        </button>
        {body}
      </div>
    )
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal-card sheet"
        role="dialog"
        aria-modal="true"
        aria-label={session.title}
        onClick={(e) => e.stopPropagation()}
      >
        {body}
      </div>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { useModalA11y } from '../lib/a11y'
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

export function SessionDetail({
  session,
  meta,
  coords,
  locationEnabled,
  travelMode,
  profileId,
  placementInfo,
  onPlacementInfo,
  onMeta,
  onClose,
}: Props) {
  const dialogRef = useModalA11y<HTMLDivElement>(onClose)
  const duration = formatDuration(session.start, session.end)
  const gcalUrl = googleCalendarUrl(session)
  // Placement sessions with a geocoded school address target the school; everything
  // else targets the matched campus building. All travel machinery (map, live route,
  // departures, leave-time weather) follows this target.
  const schoolCoords =
    isPlacementSession(session) && placementInfo?.lat != null && placementInfo?.lng != null
      ? { lat: placementInfo.lat, lng: placementInfo.lng }
      : null
  const travel = schoolCoords
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
    })
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

  // Live TfL journey (time + recommended route + per-leg departure boards +
  // disruptions on the route's lines) — shared with the head-home dropdown.
  const { route, legDeps, routeDisruptions } = useLiveJourney(
    coords,
    travel?.location ?? null,
    travelMode === 'transit' && !!coords && !!travel?.location
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
  const liveLabel = travelMode === 'transit' && route ? ' (live TfL)' : ''
  // The sheet's Location column glues building and room together — split them
  // into their own rows (with special cases for TBC and leaked booking refs).
  const loc = parseLocation(session.isSelfStudy ? '' : session.room)
  const locationRows: { label: string; value: string }[] = loc.building
    ? [
        { label: 'Building', value: loc.building },
        { label: 'Room', value: `${loc.room}${loc.roomName ? ` · ${loc.roomName}` : ''}` },
      ]
    : loc.note === 'booking-ref'
      ? [{ label: 'Room', value: `Not in the sheet yet (booking ref ${loc.raw})` }]
      : loc.note === 'tbc'
        ? [{ label: 'Room', value: 'TBC — check nearer the time' }]
        : [{ label: 'Location', value: loc.raw }]
  const rows: { label: string; value: string }[] = [
    { label: 'Date', value: formatLongDate(session.dateISO) },
    {
      label: 'Time',
      value: session.start ? (session.end ? `${session.start} – ${session.end}` : session.start) : '',
    },
    { label: 'Duration', value: duration ?? '' },
    ...locationRows,
    { label: 'Tutor', value: session.tutor === 'Self Study' ? '' : session.tutor },
    { label: 'Subject', value: session.subject !== session.title ? session.subject : '' },
    { label: 'Groups', value: session.groups },
  ].filter((r) => r.value !== '')

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
        <div className="sheet-header">
          <h2 className="detail-title">{session.title}</h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
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
        {travel && (
          <div className="travel-row">
            <span className="travel-info">
              {travel.building
                ? shownMinutes !== null
                  ? `≈ ${formatRemaining(shownMinutes)} ${TRAVEL_MODE_PHRASE[travelMode]}${liveLabel} · ${travel.building}`
                  : locationEnabled
                    ? `${travel.building} (waiting for your location…)`
                    : `${travel.building} — enable travel times in Settings for an estimate`
                : 'Not matched to a UCL campus building'}
            </span>
            <a className="travel-link" href={travel.mapsUrl} target="_blank" rel="noopener noreferrer">
              Directions ↗
            </a>
          </div>
        )}
        {route && <RouteSteps route={route} legDeps={legDeps} routeDisruptions={routeDisruptions} />}
        {journeyWeather && (
          <p className="route-info">
            {weatherEmoji(journeyWeather.w.code)} {Math.round(journeyWeather.w.tempC)}°
            {journeyWeather.w.rainProb >= 30 ? ` · ${journeyWeather.w.rainProb}% rain` : ''} around your
            leave time ({journeyWeather.at})
          </p>
        )}
        {route && route.legs.length === 0 && travelMode === 'transit' && (
          <p className="route-info">Best option now: walk (no transit leg needed).</p>
        )}
        {travel?.location && (
          <StaticMap lat={travel.location.lat} lng={travel.location.lng} label={travel.building ?? undefined} />
        )}
        {session.link && (
          <a className="btn-primary btn-link" href={session.link} target="_blank" rel="noopener noreferrer">
            Open in Moodle ↗
          </a>
        )}
        {gcalUrl && (
          <a className="btn-secondary btn-link" href={gcalUrl} target="_blank" rel="noopener noreferrer">
            Add to Google Calendar
          </a>
        )}
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
              <p className="filter-hint">
                📍 Located — the map and travel details below now point at the school.
              </p>
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
            {placementInfo?.address && (
              <a
                className="travel-link"
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(placementInfo.address)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Directions to the school ↗
              </a>
            )}
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
            Tag notes/photos against the Teachers' Standards — they build your evidence journal
            (Settings → Evidence journal).
          </p>
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
                  onClick={() => void handleDeletePhoto(p.id)}
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
                  if (file) void handleAddPhoto(file)
                  e.target.value = ''
                }}
              />
            </label>
          </div>
        </section>
        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

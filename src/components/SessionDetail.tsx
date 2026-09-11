import { IdentityReview } from './IdentityReview'
import { reportPersistenceFailure } from '../lib/persistence'
import { useEffect, useRef, useState } from 'react'
import { useModalA11y } from '../lib/a11y'
import { TRAVEL_MODE_PHRASE, estimateTravel, estimateTravelToCoords } from '../lib/campus'
import { geocodeAddress } from '../lib/geocode'
import { TEACHERS_STANDARDS } from '../lib/standards'
import type { Coords, TravelMode } from '../lib/campus'
import { formatRemaining, googleCalendarUrl, isPlacementSession, sessionKindLabel } from '../lib/format'
import { splitTitle } from '../features/today/TodayPage'
import { parseLocation } from '../lib/location'
import { sessionKey } from '../lib/diff'
import { trackUse } from '../lib/usage'
import { telemetryTrack } from '../lib/telemetry'
import { PHOTO_CAPTION_MAX, addPhoto, compressImage, deletePhoto, getPhotos, setPhotoCaption } from '../lib/photos'
import type { StoredPhoto } from '../lib/photos'
import { wallToUTC, utcToZonedParts } from '../../shared/calendar-time.js'
import { courseZone } from '../lib/course'
import { requiredArrivalMs } from '../../shared/journey.js'
import { useJourney } from '../hooks/useJourney'
import { ItinerarySteps } from './ItinerarySteps'
import { OriginSelector } from './OriginSelector'
import type { OriginOption } from '../lib/origins'
import { weatherEmoji, weatherForHourAt } from '../lib/weather'
import type { HourWeather } from '../lib/weather'
import type { Session, SessionMeta } from '../types'
import { IconAlert, IconBook, IconCalendar, IconCamera, IconCheck, IconChevronLeft, IconClock, IconClose, IconHome, IconNote, IconPin, IconSchool, PageHeader, SegmentedControl } from './ui'
import { CopyButton } from './CopyButton'
import { RouteMap } from './RouteMap'
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
  /** selectable journey origins (P6-02) */
  origins: OriginOption[]
  /** arrival buffer minutes for arrive-by planning (P6-01) */
  arrivalBufferMins: number
  onSetArrivalBuffer: (mins: number) => void
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
  /** the Journey home screen (V3 design: the return trip is a separate destination) */
  onOpenHomeJourney?: () => void
  /** G1a: `SE2 · <school>` from the session's block mapping */
  placementLabel?: string
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
  origins,
  arrivalBufferMins,
  onSetArrivalBuffer,
  backLabel = 'Back',
  placementInfo,
  placementLabel,
  onPlacementInfo,
  onMeta,
  onClose,
  onOpenHomeJourney,
}: Props) {
  const isTask = session.isKeyDate === true
  const titleSplit = splitTitle(session.title)
  const [tab, setTab] = useState<'overview' | 'travel'>('overview')
  useEffect(() => {
    if (tab === 'travel') telemetryTrack('journey_session_opened')
  }, [tab])
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
    trackUse('photo') // legacy attempt semantics, fired at the start
    const blob = await compressImage(file)
    await addPhoto(profileId, sessionKey(session), blob)
    // A4 success: compression AND local persistence both completed.
    telemetryTrack('evidence_photo_saved')
    onMeta({ photos: photos.length + 1 })
    reloadPhotos()
  }

  async function handleDeletePhoto(id: number) {
    await deletePhoto(id)
    onMeta({ photos: Math.max(0, photos.length - 1) || undefined })
    reloadPhotos()
  }

  // Date-specific journey planning (P6-01/02): a FUTURE session gets an
  // arrive-by plan for its actual date/time with the chosen buffer; a
  // session happening about now gets a leave-now route. Driving stays a
  // labelled distance estimate — nothing future is fabricated for it.
  const startMs = !isTask && session.start ? wallToUTC(session.dateISO, session.start, courseZone()).utcMs : null
  const planable = !isTask && !!travel?.location && travelMode !== 'driving'
  const futurePlan = planable && startMs !== null && startMs > Date.now() + 5 * 60_000
  const [originId, setOriginId] = useState<string | null>(
    () => origins.find((o) => o.basis === 'device' && o.coords)?.id ?? null
  )
  useEffect(() => {
    // A fix arriving selects the device origin only if nothing was chosen —
    // never silently replacing a deliberate saved-origin choice.
    if (originId === null) {
      const device = origins.find((o) => o.basis === 'device' && o.coords)
      if (device) setOriginId(device.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origins.find((o) => o.basis === 'device')?.coords != null])
  const origin = origins.find((o) => o.id === originId && o.coords) ?? null
  const originSelect = useRef<HTMLSelectElement>(null)
  const journey = useJourney({
    origin,
    destination: travel?.location ? { coords: travel.location, label: travel.building ?? undefined } : null,
    mode: travelMode,
    intent:
      futurePlan && startMs !== null
        ? { kind: 'arrive-by', arriveByMs: requiredArrivalMs(startMs, arrivalBufferMins), timeZone: courseZone(), eventKey: sessionKey(session) }
        : { kind: 'leave-now' },
    eventKey: sessionKey(session),
    profileId,
    enabled: tab === 'travel' && planable,
  })
  const shownItinerary = journey.departure === 'passed' ? journey.fallback : journey.itinerary
  // Leg highlight for the route map (P7-03) — cleared whenever the itinerary
  // itself changes so a stale selection can't point at the wrong route.
  const [selectedLeg, setSelectedLeg] = useState<number | null>(null)
  useEffect(() => setSelectedLeg(null), [shownItinerary])

  // Weather at the DESTINATION around the planned departure (provider horizon
  // honoured — outside it there is simply no forecast shown).
  const [journeyWeather, setJourneyWeather] = useState<{ at: string; w: HourWeather } | null>(null)
  useEffect(() => {
    setJourneyWeather(null)
    const dest = travel?.location
    const leaveMs = journey.leaveByMs ?? (shownItinerary ? Date.now() : null)
    if (!dest || leaveMs === null) return
    const wall = utcToZonedParts(leaveMs)
    let cancelled = false
    void weatherForHourAt(dest, wall.dateISO, parseInt(wall.hhmm.slice(0, 2), 10)).then((w) => {
      if (!cancelled && w) setJourneyWeather({ at: wall.hhmm, w })
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journey.leaveByMs, shownItinerary, travel?.location?.lat])

  const hhmm = (ms: number) => utcToZonedParts(ms, courseZone()).hhmm

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
  // Identity (date, time, place) now lives in the identity card above the
  // details list (V-06 → gap closure); the list keeps the remaining facts.
  const rows: { label: string; value: string }[] = [
    ...(isTask ? [{ label: 'Due', value: formatLongDate(session.dateISO) + (session.start ? ` · ${session.start}` : '') }] : []),
    { label: 'Duration', value: !isTask ? duration ?? '' : '' },
    ...(loc.building && loc.room ? [{ label: 'Room name', value: loc.roomName ?? '' }] : locationRows),
    { label: 'Tutor', value: session.tutor === 'Self Study' ? '' : session.tutor },
    { label: 'Subject', value: session.subject !== session.title ? session.subject : '' },
    { label: 'Groups', value: session.groups },
  ].filter((r) => r.value !== '')


  const overview = (
    <div className="detail-tabpanel" role="tabpanel" aria-label="Overview" hidden={tab !== 'overview'}>
      {/* Identity hero (design.css .hero): kind tag, title split into heading + subtitle
          (separator kept for the accessible name), then clock and pin rows. */}
      <section className={`ui-card hero detail-identity${isTask ? ' detail-identity--task' : ''}`}>
        <span className={`tag ${isTask ? 'tag--amber' : 'tag--teal'} badge-kind`}>
          {isTask ? <IconNote size={15} /> : <IconBook size={15} />} {isTask ? 'Key date' : sessionKindLabel(session)}
        </span>
        {placementLabel && <span className="tag tag--teal badge-kind detail-placement-label">{placementLabel}</span>}
        <h2 className="detail-title">
          {titleSplit ? (
            <>
              <span className="detail-title-head">{titleSplit.head}</span>
              <span className="visually-hidden">{titleSplit.sep}</span>
              <span className="detail-title-sub">{titleSplit.tail}</span>
            </>
          ) : (
            session.title
          )}
        </h2>
        {!titleSplit && !isTask && session.subject && session.subject !== session.title && <p className="detail-title-sub">{session.subject}</p>}
        <div className="hero-details">
          {isTask ? (
            <div className="hero-detail">
              <IconCalendar />
              <span>Due {formatLongDate(session.dateISO)}{session.start ? ` · ${session.start}` : ''}</span>
            </div>
          ) : (
            <>
              {session.start && (
                <div className="hero-detail">
                  <IconClock />
                  <span className="today-hero-time">
                    {session.start}
                    {session.end && session.end !== session.start ? `–${session.end}` : ''}
                  </span>
                </div>
              )}
              {(loc.building || loc.raw) && (
                <div className="hero-detail">
                  <IconPin />
                  <span>
                    {loc.building
                      ? `${loc.building}${loc.room ? ` · Room ${loc.room}` : ''}`
                      : loc.note === 'tbc'
                        ? 'Room TBC — check nearer the time'
                        : loc.note === 'booking-ref'
                          ? `Room not in the sheet yet (booking ref ${loc.raw})`
                          : loc.raw}
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      </section>
      <section className="ui-card detail-card">
        <div className="section-title">
          <span className="ui-tile ui-tile--blue" aria-hidden="true">
            <IconNote />
          </span>
          <h3>Details</h3>
        </div>
      {session.isSpecialism && session.specialismName && (
        <span className="badge badge-specialism">Specialism · {session.specialismName}</span>
      )}
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
      </section>
      {isTask ? (
        <section className="ui-card detail-card">
          <div className="section-title">
            <span className="ui-tile ui-tile--amber" aria-hidden="true">
              <IconCheck />
            </span>
            <h3>Status &amp; notes</h3>
          </div>
          <div className="chip-grid attendance-chips" role="group" aria-label="Task status">
            {(['todo', 'doing', 'done'] as const).map((status) => (
              <button
                key={status}
                type="button"
                className={`chip${(meta?.status ?? 'todo') === status ? ' chip-on' : ''}`}
                aria-pressed={(meta?.status ?? 'todo') === status}
                onClick={() => onMeta({ status })}
              >
                {status === 'done' && <IconCheck />}
                {status === 'todo' ? 'To do' : status === 'doing' ? 'In progress' : 'Done'}
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
          <p className="filter-hint">
            From your key-dates sheet — the title and due date are corrected in the sheet itself;
            your status and notes live here and are never overwritten by it.
          </p>
        </section>
      ) : (
        <>
          {isPlacementSession(session) && onPlacementInfo && (
            <section className="ui-card detail-card placement-details">
              <div className="section-title">
                <span className="ui-tile ui-tile--teal" aria-hidden="true">
                  <IconSchool />
                </span>
                <h3>Placement details</h3>
              </div>
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
              {geoStatus === 'working' && <p className="filter-hint">Locating the school…</p>}
              {geoStatus === 'fail' && (
                <p className="filter-hint">Couldn't locate that address — try adding the postcode.</p>
              )}
              {(geoStatus === 'ok' || (geoStatus === null && schoolCoords)) && (
                <p className="filter-hint">Located — Travel & map now points at the school.</p>
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
          <section className="ui-card detail-card detail-section" aria-labelledby="detail-attendance-heading">
            <div className="section-title">
              <span className="ui-tile ui-tile--teal" aria-hidden="true">
                <IconCheck />
              </span>
              <h3 id="detail-attendance-heading">Attendance</h3>
            </div>
            <p className="detail-state">
              {meta?.attended
                ? 'Recorded as attended'
                : meta?.absent
                  ? `Recorded as absent${meta.absentReason ? ` · ${meta.absentReason}` : ''}`
                  : session.isSelfStudy
                    ? 'Self study — attendance is not recorded'
                    : 'Not recorded'}
            </p>
            {!session.isSelfStudy && (
            <div className="attendance-choice" role="group" aria-label="Attendance">
              <button
                type="button"
                className={`chip attendance-option${meta?.attended ? ' chip-on' : ''}`}
                aria-pressed={meta?.attended === true}
                onClick={() =>
                  onMeta(
                    meta?.attended
                      ? { attended: false }
                      : { attended: true, absent: false, absentReason: undefined }
                  )
                }
              >
                <IconCheck />
                Attended
              </button>
              <button
                type="button"
                className={`chip attendance-option${meta?.absent ? ' chip-on chip-absent' : ''}`}
                aria-pressed={meta?.absent === true}
                onClick={() =>
                  onMeta(
                    meta?.absent
                      ? { absent: false, absentReason: undefined }
                      : { absent: true, attended: false }
                  )
                }
              >
                <IconAlert />
                Absent
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
            )}
          </section>
          <section className="ui-card detail-card detail-section" aria-labelledby="detail-notes-heading">
            <div className="section-title">
              <span className="ui-tile ui-tile--violet" aria-hidden="true">
                <IconBook />
              </span>
              <h3 id="detail-notes-heading">Notes &amp; evidence</h3>
            </div>
            <p className="detail-state">
              {meta?.at
                ? `Last saved on this device ${new Date(meta.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
                : 'Nothing recorded yet — notes, standards and photos save on this device as you add them.'}
            </p>
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
            <button
              type="button"
              className={`chip chip-small${meta?.reviewLater ? ' chip-on' : ''}`}
              aria-pressed={meta?.reviewLater === true}
              title="Flag this record for the evidence review queue"
              onClick={() => onMeta({ reviewLater: meta?.reviewLater ? undefined : true })}
            >
              {meta?.reviewLater ? 'Flagged: review later' : 'Review later'}
            </button>
            <p className="filter-hint">{photos.length} photos available on this device.{(meta?.photos ?? 0) > photos.length ? ` ${(meta?.photos ?? 0) - photos.length} more recorded elsewhere; import a backup from that device to view them.` : ''}</p>
            <div className="photo-grid">
              {photos.map((p, i) => (
                <span className="photo-thumb" key={p.id}>
                  <a href={photoUrls.current[i]} target="_blank" rel="noopener noreferrer">
                    <img src={photoUrls.current[i]} alt={p.caption || 'Session photo'} loading="lazy" />
                  </a>
                  <input
                    type="text"
                    className="photo-caption-input"
                    placeholder="Caption…"
                    aria-label="Photo caption"
                    maxLength={PHOTO_CAPTION_MAX}
                    defaultValue={p.caption ?? ''}
                    onBlur={(e) =>
                      void setPhotoCaption(p.id, e.target.value)
                        .then(reloadPhotos)
                        .catch((error) => reportPersistenceFailure('Caption save failed: ' + String(error)))
                    }
                  />
                  <button
                    type="button"
                    className="photo-delete"
                    aria-label="Delete photo"
                    onClick={() => void handleDeletePhoto(p.id).catch(error => reportPersistenceFailure('Photo deletion failed: ' + String(error)))}
                  >
                    <IconClose />
                  </button>
                </span>
              ))}
              <label className="photo-add">
                <IconCamera /> Add photo
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
      {!isTask && travel && (
        <button type="button" className="btn-primary btn-wide detail-travel-cta" onClick={() => setTab('travel')}>
          <IconPin size={18} /> Travel to this session
        </button>
      )}
    </div>
  )

  // One status tone for the summary (V3): live plan / estimate / attention / waiting for an origin.
  const tone = journey.itinerary
    ? 'live'
    : journey.status === 'error' || journey.status === 'no-route'
      ? 'attention'
      : origin || travelMode === 'driving'
        ? 'estimate'
        : 'missing'
  const travelPanel = !isTask && travel && (
    <div className="detail-tabpanel" role="tabpanel" aria-label="Travel and map" hidden={tab !== 'travel'}>
      {/* Origin → destination first (V3): the missing input is named, never inferred. */}
      <div className="ui-card travel-od" aria-label="Journey summary">
        <div className="travel-od-row">
          <IconPin />
          <span>
            <strong>{planable ? (origin ? origin.label : 'Choose a starting point') : 'Your location'}</strong>
            <span className="travel-od-detail">
              {planable ? (origin ? origin.detail ?? 'Chosen starting point' : 'Use your current location or a saved place') : 'Driving estimates use the distance from your device'}
            </span>
          </span>
        </div>
        <div className="travel-od-row destination-card">
          <IconBook />
          <span>
            <strong className="today-hero-room-name">{travel.building ?? (loc.raw || session.room)}</strong>
            <span className="today-hero-building travel-od-detail">
              {loc.room ? `Room ${loc.room}${loc.roomName ? ` · ${loc.roomName}` : ''} · ` : ''}
              {session.start ? `Session starts ${session.start}` : ''}
            </span>
            {placementInfo?.address && <span className="today-hero-building travel-od-detail">{placementInfo.address}</span>}
          </span>
        </div>
        <div className="travel-od-actions">
          <CopyButton text={placementInfo?.address || session.room} />
        </div>
      </div>
      {travel.location && shownItinerary && shownItinerary.legs.some((l) => l.geometry.length >= 2) ? (
        // Full-route map (P7-03): drawn ONLY from provider geometry; a failed
        // or geometry-less plan falls back to the destination-only map below.
        <RouteMap
          itinerary={shownItinerary}
          origin={origin?.coords ?? null}
          destination={travel.location}
          selectedLeg={selectedLeg}
          label={travel.building ?? undefined}
        />
      ) : travel.location ? (
        <StaticMap lat={travel.location.lat} lng={travel.location.lng} label={travel.building ?? undefined} address={placementInfo?.address || session.room} />
      ) : (
        <div className="ui-card map-fallback">
          <p className="filter-hint">
            No map match for this location — the address and external directions below still work.
          </p>
        </div>
      )}
      {travel.location && (
        <p className="filter-hint entrance-note">
          The pin marks the approximate building centre — entrances and step-free access aren't
          verified here; check the venue's own access information.
        </p>
      )}
      <div className={`travel-summary travel-summary--${tone}`}>
        {travelMode === 'driving' ? (
          travel.minutes !== null ? (
            <>
              <span className="travel-summary-mins">≈ {formatRemaining(travel.minutes)} drive</span>
              <span className="filter-hint">
                estimate from distance — live driving plans aren't available; use external navigation below
              </span>
            </>
          ) : (
            <span className="filter-hint">Driving estimates need a location — external navigation below works regardless.</span>
          )
        ) : !origin ? (
          <span className="filter-hint">
            {locationEnabled
              ? 'Waiting for a device fix — or choose a saved starting point below. The address and directions still work.'
              : 'Location is off — choose a saved starting point below. The address and directions still work.'}
          </span>
        ) : journey.status === 'loading' ? (
          <span className="filter-hint">Planning the journey…</span>
        ) : journey.departure === 'passed' && journey.itinerary ? (
          <>
            <span className="travel-summary-mins">Planned departure {hhmm(journey.itinerary.departureMs)} has passed</span>
            <span className="filter-hint">
              {journey.fallback
                ? `Leaving now instead: ≈ ${formatRemaining(journey.fallback.durationMins)} · arrive ~${hhmm(Date.now() + journey.fallback.durationMins * 60_000)}`
                : journey.refreshing
                  ? 'Finding a leave-now alternative…'
                  : journey.fallbackUnavailable
                    ? 'No leave-now alternative was found — use external navigation below.'
                    : 'Checking for a leave-now alternative…'}
            </span>
          </>
        ) : futurePlan && journey.itinerary && journey.leaveByMs !== null ? (
          <>
            <span className="travel-summary-mins">Leave by {hhmm(journey.leaveByMs)}</span>
            <span className="filter-hint">
              {formatRemaining(journey.itinerary.durationMins)} journey
              {arrivalBufferMins > 0 ? ` + ${arrivalBufferMins} min buffer` : ''} · planned arrival{' '}
              {hhmm(journey.itinerary.arrivalMs)} · planned with TfL for{' '}
              {utcToZonedParts(journey.itinerary.departureMs).dateISO.split('-').reverse().slice(0, 2).join('/')}
              {journey.fetchedAt ? ` · checked ${hhmm(journey.fetchedAt)}` : ''} · from {origin.label.toLowerCase()}
            </span>
          </>
        ) : journey.itinerary ? (
          <>
            <span className="travel-summary-mins">
              ≈ {formatRemaining(journey.itinerary.durationMins)} {TRAVEL_MODE_PHRASE[travelMode]}
            </span>
            <span className="filter-hint">
              live TfL{journey.fetchedAt ? ` · checked ${hhmm(journey.fetchedAt)}` : ''} · from {origin.label.toLowerCase()}
            </span>
          </>
        ) : journey.status === 'no-route' ? (
          <span className="filter-hint">
            {futurePlan
              ? 'No feasible itinerary for that arrival time — there may be no service then. External navigation below still works.'
              : 'No route found right now — the address and external navigation below still work.'}
          </span>
        ) : journey.status === 'error' ? (
          <>
            {travel.minutes !== null && (
              <span className="travel-summary-mins">≈ {formatRemaining(travel.minutes)} {TRAVEL_MODE_PHRASE[travelMode]}</span>
            )}
            <span className="filter-hint">
              Couldn't reach TfL — {travel.minutes !== null ? 'showing a distance estimate only.' : 'no estimate available.'}{' '}
              A route outage never hides the destination below.{' '}
              <button type="button" className="travel-link" onClick={journey.retry}>
                Retry
              </button>
            </span>
          </>
        ) : journey.status === 'no-provider' ? (
          <span className="filter-hint">
            Internal route planning isn't available for this course's region — the address and
            external navigation below are the route.
          </span>
        ) : (
          <span className="filter-hint">Open this tab with a route provider available for a plan.</span>
        )}
      </div>
      {planable && !origin && origins.some((o) => o.coords) && (
        <button type="button" className="btn-primary travel-primary" onClick={() => originSelect.current?.focus()}>
          <IconPin size={18} /> Choose starting point
        </button>
      )}
      {planable && <OriginSelector options={origins} selectedId={originId} onSelect={setOriginId} selectRef={originSelect} />}
      <a
        className="btn-secondary btn-link external-nav btn-wide"
        href={travel.mapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => telemetryTrack('navigation_link_opened')}
      >
        Open in Google Maps ↗
      </a>
      <p className="filter-hint external-nav-caption">Opens navigation outside My Timetable</p>
      {futurePlan && (
        <div className="buffer-row">
          <span className="ui-field-label">Arrive early by</span>
          <div className="chip-grid" role="group" aria-label="Arrival buffer">
            {[0, 5, 10, 15, 20].map((m) => (
              <button
                key={m}
                type="button"
                className={`chip chip-small${arrivalBufferMins === m ? ' chip-on' : ''}`}
                aria-pressed={arrivalBufferMins === m}
                onClick={() => onSetArrivalBuffer(m)}
              >
                {m === 0 ? 'On time' : `${m} min`}
              </button>
            ))}
          </div>
          <p className="filter-hint">A secondary preference — changing it plans the journey again for the new arrival time.</p>
        </div>
      )}
      {shownItinerary && shownItinerary.legs.length > 0 ? (
        <details className="journey-steps">
          <summary>
            <span>Journey steps</span>
            <span className="route-total">
              ≈ {formatRemaining(shownItinerary.durationMins)} ·{' '}
              {[...new Set(shownItinerary.legs.map((l) => (l.mode === 'walking' ? 'walk' : l.line || l.mode)))].join(' · ')}
            </span>
          </summary>
          <ItinerarySteps
            itinerary={shownItinerary}
            legDeps={journey.legDeps}
            disruptions={journey.disruptions}
            showTimes={futurePlan && journey.departure !== 'passed'}
            selectedLeg={selectedLeg}
            onSelectLeg={setSelectedLeg}
          />
        </details>
      ) : shownItinerary && shownItinerary.legs.length === 0 && travelMode === 'transit' ? (
        <p className="route-info">Best option now: walk (no transit leg needed).</p>
      ) : null}
      {journeyWeather && (
        <p className="route-info">
          {weatherEmoji(journeyWeather.w.code)} {Math.round(journeyWeather.w.tempC)}°
          {journeyWeather.w.rainProb >= 30 ? ` · ${journeyWeather.w.rainProb}% rain` : ''} around your leave
          time ({journeyWeather.at})
        </p>
      )}
      {onOpenHomeJourney && (
        <section className="ui-card detail-card return-trip">
          <div className="section-title">
            <span className="ui-tile ui-tile--teal" aria-hidden="true">
              <IconHome />
            </span>
            <div>
              <h3>Planning the return trip?</h3>
              <p className="filter-hint">Home is a separate destination.</p>
            </div>
          </div>
          <button type="button" className="btn-ghost btn-ghost--left" onClick={onOpenHomeJourney}>
            View journey home →
          </button>
        </section>
      )}
    </div>
  )

  const pageTitle = isTask ? 'Task details' : tab === 'travel' ? 'Travel to session' : 'Session details'
  const subtitleLine = `${(titleSplit ? titleSplit.head : session.title).slice(0, 48)} · ${shortDate(session.dateISO)}`
  const body = (
    <>
      {presentation === 'sheet' ? (
        <div className="sheet-header">
          <div>
            <h2 className="sheet-title">{pageTitle}</h2>
            <p className="page-subtitle">{subtitleLine}</p>
          </div>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </div>
      ) : (
        <PageHeader title={pageTitle} subtitle={subtitleLine} />
      )}
      <IdentityReview session={session} profileId={profileId} />
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
          <IconChevronLeft size={18} /> {backLabel}
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

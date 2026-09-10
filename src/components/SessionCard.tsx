import { TRAVEL_MODE_ICON, estimateTravel } from '../lib/campus'
import type { Coords, TravelMode } from '../lib/campus'
import { formatRemaining, isPlacementSession, sessionKindLabel, shortenRoom, subjectColor } from '../lib/format'
import { parseLocation, shortBuildingName } from '../lib/location'
import { cachedRouteMinutes } from '../lib/tfl'
import { weatherEmoji } from '../lib/weather'
import type { HourWeather } from '../lib/weather'
import type { Session, SessionMeta } from '../types'
import { IconBook, IconChevronRight, IconPin } from './ui'

interface Props {
  session: Session
  meta?: SessionMeta
  /** device location (when travel times are enabled), for the travel chip */
  coords?: Coords | null
  travelMode?: TravelMode
  /** overlaps another visible session on the same day */
  conflict?: boolean
  /** forecast at the session's start hour (sessions within the 7-day forecast) */
  weather?: HourWeather | null
  onSelect: (session: Session) => void
}

/**
 * One session card (V2 hierarchy): time column (start bold, end below), the
 * full title, a labelled place line, a labelled kind line, then state badges.
 * Colour on the left edge follows the canonical subject; the text always
 * identifies the kind on its own.
 */
export function SessionCard({ session, meta, coords, travelMode = 'walking', conflict, weather, onSelect }: Props) {
  const placement = !session.isKeyDate && isPlacementSession(session)
  const color = session.isKeyDate ? null : placement ? 'var(--saved-text)' : subjectColor(session)
  const travel =
    coords && session.room && !session.isSelfStudy ? estimateTravel(session.room, coords, travelMode) : null
  // Keep card and detail-sheet times consistent: in transit mode, use the same
  // cached live TfL journey the detail sheet shows (warmed by the app). Only a
  // genuinely fresh provider value drops the estimate marker (P3-08).
  let travelMins = travel?.minutes ?? null
  let liveBasis = false
  if (travelMins !== null && travelMode === 'transit' && travel?.location && coords) {
    const live = cachedRouteMinutes(coords, travel.location)
    if (live !== null) {
      travelMins = live
      liveBasis = true
    }
  }
  const loc = !session.isSelfStudy && session.room ? parseLocation(session.room) : null
  const place = loc
    ? loc.building && loc.room
      ? `${shortBuildingName(loc)} · Room ${loc.room}`
      : loc.note
        ? 'Room TBC'
        : shortenRoom(session.room)
    : null
  const photos = meta?.photos ?? 0
  return (
    <button
      type="button"
      className={`session-card${session.isSelfStudy ? ' self-study' : ''}${session.isKeyDate ? ' key-date' : ''}${placement ? ' placement-session' : ''}`}
      style={color ? { borderLeft: `4px solid ${color}` } : undefined}
      onClick={() => onSelect(session)}
    >
      <div className="session-time">
        <span className="session-start">{session.start || '—'}</span>
        {session.end && session.end !== session.start && <span className="session-end">{session.end}</span>}
      </div>
      <div className="session-body">
        <div className="session-title">{session.title}</div>
        <div className="session-meta">
          {place && (
            <span className={`session-loc${loc?.note ? ' session-loc-tbc' : ''}`}>
              <IconPin size={14} />
              <span>{place}</span>
            </span>
          )}
          {session.tutor && session.tutor !== 'Self Study' && <span>{session.tutor}</span>}
          {travelMins != null && (
            <span
              className="travel-chip"
              title={`${liveBasis ? 'Live TfL journey time' : 'Estimate from distance'}${travel?.building ? ` · ${travel.building}` : ''}`}
            >
              {TRAVEL_MODE_ICON[travelMode]} {liveBasis ? '' : '≈'}{formatRemaining(travelMins)}
            </span>
          )}
          {weather && !session.isKeyDate && (
            <span className="weather-chip" title={`Forecast at ${session.start}`}>
              {weatherEmoji(weather.code)} {Math.round(weather.tempC)}°
              {weather.rainProb >= 40 ? ` · ${weather.rainProb}%` : ''}
            </span>
          )}
        </div>
        <div className="session-kind">
          <IconBook size={14} />
          <span>{sessionKindLabel(session)}</span>
        </div>
        {conflict && <span className="badge badge-conflict">Clash</span>}
        {(session.identityCandidates?.length || session.identityWarning) && (
          <span className="badge badge-conflict">Identity review</span>
        )}
        {meta?.attended && <span className="badge badge-attended">Attended</span>}
        {meta?.absent && <span className="badge badge-absent">Absent</span>}
        {meta?.note && <span className="badge badge-note">Note</span>}
        {photos > 0 && (
          <span className="badge badge-note">
            {photos} photo{photos === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <span className="session-chevron" aria-hidden="true">
        <IconChevronRight />
      </span>
    </button>
  )
}

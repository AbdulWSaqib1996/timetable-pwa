import { TRAVEL_MODE_ICON, estimateTravel } from '../lib/campus'
import type { Coords, TravelMode } from '../lib/campus'
import { formatRemaining, isPlacementSession, shortenRoom, subjectColor } from '../lib/format'
import { cachedRouteMinutes } from '../lib/tfl'
import { weatherEmoji } from '../lib/weather'
import type { HourWeather } from '../lib/weather'
import type { Session, SessionMeta } from '../types'

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

export function SessionCard({ session, meta, coords, travelMode = 'walking', conflict, weather, onSelect }: Props) {
  const placement = !session.isKeyDate && isPlacementSession(session)
  const color = session.isKeyDate ? null : placement ? '#0ca678' : subjectColor(session)
  const travel =
    coords && session.room && !session.isSelfStudy ? estimateTravel(session.room, coords, travelMode) : null
  // Keep card and detail-sheet times consistent: in transit mode, use the same
  // cached live TfL journey the detail sheet shows (warmed by the app).
  let travelMins = travel?.minutes ?? null
  if (travelMins !== null && travelMode === 'transit' && travel?.location && coords) {
    const live = cachedRouteMinutes(coords, travel.location)
    if (live !== null) travelMins = live
  }
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
          {!session.isSelfStudy && session.room && <span>{shortenRoom(session.room)}</span>}
          {session.tutor && session.tutor !== 'Self Study' && <span>{session.tutor}</span>}
          {travelMins != null && (
            <span className="travel-chip" title={travel?.building ?? undefined}>
              {TRAVEL_MODE_ICON[travelMode]} {formatRemaining(travelMins)}
            </span>
          )}
          {weather && !session.isKeyDate && (
            <span className="weather-chip" title={`Forecast at ${session.start}`}>
              {weatherEmoji(weather.code)} {Math.round(weather.tempC)}°
              {weather.rainProb >= 40 ? ` · ${weather.rainProb}%` : ''}
            </span>
          )}
        </div>
        {session.isKeyDate && <span className="badge badge-keydate">📌 Key date</span>}
        {conflict && <span className="badge badge-conflict">⚠ Clash</span>}
        {session.isSpecialism && session.specialismName && (
          <span className="badge badge-specialism">{session.specialismName}</span>
        )}
        {session.isSelfStudy && <span className="badge badge-selfstudy">Self study</span>}
        {session.isOptional && <span className="badge badge-optional">Optional</span>}
        {meta?.attended && <span className="badge badge-attended">✓ attended</span>}
        {meta?.absent && <span className="badge badge-absent">✗ absent</span>}
        {meta?.note && <span className="badge badge-note">📝 note</span>}
        {(meta?.photos ?? 0) > 0 && <span className="badge badge-note">📷 {meta!.photos}</span>}
      </div>
      <span className="session-chevron" aria-hidden="true">
        ›
      </span>
    </button>
  )
}

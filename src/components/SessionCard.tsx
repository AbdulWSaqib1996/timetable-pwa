import { TRAVEL_MODE_ICON, estimateTravel } from '../lib/campus'
import type { Coords, TravelMode } from '../lib/campus'
import { formatRemaining, shortenRoom, subjectColor } from '../lib/format'
import type { Session, SessionMeta } from '../types'

interface Props {
  session: Session
  meta?: SessionMeta
  /** device location (when travel times are enabled), for the travel chip */
  coords?: Coords | null
  travelMode?: TravelMode
  /** overlaps another visible session on the same day */
  conflict?: boolean
  onSelect: (session: Session) => void
}

export function SessionCard({ session, meta, coords, travelMode = 'walking', conflict, onSelect }: Props) {
  const color = session.isKeyDate ? null : subjectColor(session)
  const travel =
    coords && session.room && !session.isSelfStudy ? estimateTravel(session.room, coords, travelMode) : null
  return (
    <button
      type="button"
      className={`session-card${session.isSelfStudy ? ' self-study' : ''}${session.isKeyDate ? ' key-date' : ''}`}
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
          {travel?.minutes != null && (
            <span className="travel-chip" title={travel.building ?? undefined}>
              {TRAVEL_MODE_ICON[travelMode]} {formatRemaining(travel.minutes)}
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
        {meta?.note && <span className="badge badge-note">📝 note</span>}
      </div>
      <span className="session-chevron" aria-hidden="true">
        ›
      </span>
    </button>
  )
}

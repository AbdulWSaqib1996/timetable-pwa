import { estimateTravel } from '../../lib/campus'
import type { TravelMode } from '../../lib/campus'
import { parseLocation, shortBuildingName } from '../../lib/location'
import type { Session, SessionMeta } from '../../types'

interface Props {
  session: Session
  meta?: SessionMeta
  travelMode: TravelMode
  onMeta: (session: Session, patch: Partial<SessionMeta>) => void
  onOpenFull: (session: Session) => void
  onClose: () => void
}

function longDate(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
}

/**
 * Desktop selected-session panel (P4-04, ≥1280px): summary, prominent room,
 * Moodle/Directions, attendance and a quick note — with a route to the full
 * detail (travel, photos, standards). Nonmodal: no focus trap.
 */
export function SessionPanel({ session, meta, travelMode, onMeta, onOpenFull, onClose }: Props) {
  const loc = parseLocation(session.isSelfStudy ? '' : session.room)
  const travel = session.room && !session.isSelfStudy ? estimateTravel(session.room, null, travelMode) : null
  return (
    <aside className="session-panel" aria-label={`Selected session: ${session.title}`}>
      <div className="session-panel-head">
        <span className="session-panel-kicker">Selected session</span>
        <button type="button" className="btn-icon" aria-label="Close panel" onClick={onClose}>
          ✕
        </button>
      </div>
      <h2 className="session-panel-title">{session.title}</h2>
      {session.subject && session.subject !== session.title && (
        <p className="filter-hint">{session.subject}</p>
      )}
      <p className="session-panel-when">
        {longDate(session.dateISO)}
        <br />
        {session.start}
        {session.end && session.end !== session.start ? `–${session.end}` : ''}
        {session.tutor && session.tutor !== 'Self Study' ? ` · Tutor ${session.tutor}` : ''}
      </p>
      {!session.isSelfStudy && session.room && (
        <div className="today-hero-room">
          <span className="today-hero-room-name">
            {loc.building && loc.room ? `Room ${loc.room}` : loc.note ? 'Room TBC' : session.room}
          </span>
          {loc.building && <span className="today-hero-building">{shortBuildingName(loc)}</span>}
        </div>
      )}
      {session.link && (
        <a className="btn-primary btn-link" href={session.link} target="_blank" rel="noopener noreferrer">
          Open Moodle ↗
        </a>
      )}
      {travel && (
        <a className="btn-secondary btn-link" href={travel.mapsUrl} target="_blank" rel="noopener noreferrer">
          Directions ↗
        </a>
      )}
      {!session.isKeyDate && !session.isSelfStudy && (
        <div className="chip-grid attendance-chips">
          <button
            type="button"
            className={`chip${meta?.attended ? ' chip-on' : ''}`}
            aria-pressed={meta?.attended === true}
            onClick={() =>
              onMeta(
                session,
                meta?.attended ? { attended: false } : { attended: true, absent: false, absentReason: undefined }
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
              onMeta(session, meta?.absent ? { absent: false, absentReason: undefined } : { absent: true, attended: false })
            }
          >
            ✗ Absent
          </button>
        </div>
      )}
      <label className="ui-field">
        <span className="ui-field-label">Session note</span>
        <textarea
          className="note-input"
          rows={3}
          placeholder="Add a note…"
          value={meta?.note ?? ''}
          onChange={(e) => onMeta(session, { note: e.target.value })}
        />
      </label>
      <button type="button" className="btn-secondary" onClick={() => onOpenFull(session)}>
        Full details (travel, photos, standards)
      </button>
    </aside>
  )
}

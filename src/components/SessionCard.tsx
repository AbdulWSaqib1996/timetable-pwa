import { shortenRoom, subjectColor } from '../lib/format'
import type { Session, SessionMeta } from '../types'

interface Props {
  session: Session
  meta?: SessionMeta
  onSelect: (session: Session) => void
}

export function SessionCard({ session, meta, onSelect }: Props) {
  const color = subjectColor(session)
  return (
    <button
      type="button"
      className={`session-card${session.isSelfStudy ? ' self-study' : ''}`}
      style={color ? { borderLeft: `4px solid ${color}` } : undefined}
      onClick={() => onSelect(session)}
    >
      <div className="session-time">
        <span className="session-start">{session.start || '—'}</span>
        {session.end && <span className="session-end">{session.end}</span>}
      </div>
      <div className="session-body">
        <div className="session-title">{session.title}</div>
        <div className="session-meta">
          {!session.isSelfStudy && session.room && <span>{shortenRoom(session.room)}</span>}
          {session.tutor && session.tutor !== 'Self Study' && <span>{session.tutor}</span>}
        </div>
        {session.isSpecialism && session.specialismName && (
          <span className="badge badge-specialism">{session.specialismName}</span>
        )}
        {session.isSelfStudy && <span className="badge badge-selfstudy">Self study</span>}
        {meta?.attended && <span className="badge badge-attended">✓ attended</span>}
        {meta?.note && <span className="badge badge-note">📝 note</span>}
      </div>
      <span className="session-chevron" aria-hidden="true">
        ›
      </span>
    </button>
  )
}

import type { Session } from '../types'

interface Props {
  session: Session
  onSelect: (session: Session) => void
}

export function SessionCard({ session, onSelect }: Props) {
  return (
    <button
      type="button"
      className={`session-card${session.isSelfStudy ? ' self-study' : ''}`}
      onClick={() => onSelect(session)}
    >
      <div className="session-time">
        <span className="session-start">{session.start || '—'}</span>
        {session.end && <span className="session-end">{session.end}</span>}
      </div>
      <div className="session-body">
        <div className="session-title">{session.title}</div>
        <div className="session-meta">
          {!session.isSelfStudy && session.room && <span>{session.room}</span>}
          {session.tutor && session.tutor !== 'Self Study' && <span>{session.tutor}</span>}
        </div>
        {session.isSpecialism && session.specialismName && (
          <span className="badge badge-specialism">{session.specialismName}</span>
        )}
        {session.isSelfStudy && <span className="badge badge-selfstudy">Self study</span>}
      </div>
      <span className="session-chevron" aria-hidden="true">
        ›
      </span>
    </button>
  )
}

import { shortenRoom } from '../lib/format'
import type { Session } from '../types'
import { Card, Dialog } from './ui'

export type AttendanceAnswer = 'attended' | 'absent'

interface CommonProps {
  session: Session
  onAnswer: (session: Session, answer: AttendanceAnswer) => void
}

/**
 * Quick attendance answer (owner request, 9 Sep 2026). Notification action
 * buttons do not exist on every platform (iOS web push shows none), so the
 * same two answers live here: as a sheet when a "did you attend?" notification
 * is tapped, and as a card on Today for a session that just ended and has no
 * answer yet. Answering writes exactly what the ✓/✗ actions write.
 */
export function AttendancePromptSheet({ session, onAnswer, onOpen, onClose }: CommonProps & { onOpen: (session: Session) => void; onClose: () => void }) {
  return (
    <Dialog label={`Did you attend ${session.title}?`} onClose={onClose} className="attendance-prompt-sheet">
      <div className="sheet-header">
        <h2>Did you attend {session.title}?</h2>
        <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <p className="filter-hint">
        {session.dateISO.split('-').reverse().join('/')} · {session.start}
        {session.end ? `–${session.end}` : ''}
        {session.room ? ` · ${shortenRoom(session.room)}` : ''}. Your answer counts toward attendance and placement days; you can change it on the session later.
      </p>
      <div className="modal-actions attendance-prompt-actions">
        <button type="button" className="btn-primary" onClick={() => onAnswer(session, 'attended')}>
          ✓ Attended
        </button>
        <button type="button" className="btn-secondary" onClick={() => onAnswer(session, 'absent')}>
          ✗ Absent
        </button>
        <button type="button" className="btn-ghost" onClick={() => onOpen(session)}>
          Open session
        </button>
        <button type="button" className="btn-ghost" onClick={onClose}>
          Not now
        </button>
      </div>
    </Dialog>
  )
}

export function AttendancePromptCard({ session, onAnswer }: CommonProps) {
  return (
    <Card tone="accent" className="attendance-prompt-card">
      <section aria-label="Attendance prompt">
        <p className="today-hero-label">Did you attend?</p>
        <p className="attendance-prompt-title">
          {session.title}
          <span className="filter-hint">
            {' '}
            · ended {session.end}
            {session.room ? ` · ${shortenRoom(session.room)}` : ''}
          </span>
        </p>
        <div className="btn-row">
          <button type="button" className="btn-primary" onClick={() => onAnswer(session, 'attended')}>
            ✓ Attended
          </button>
          <button type="button" className="btn-secondary" onClick={() => onAnswer(session, 'absent')}>
            ✗ Absent
          </button>
        </div>
      </section>
    </Card>
  )
}

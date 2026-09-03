import { useModalA11y } from '../lib/a11y'
import type { SessionChange } from '../types'

interface Props {
  changes: SessionChange[]
  onClear: () => void
  onClose: () => void
}

function formatDate(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

const LABEL: Record<SessionChange['type'], string> = {
  added: 'Added',
  removed: 'Removed',
  changed: 'Changed',
}

export function ChangesSheet({ changes, onClear, onClose }: Props) {
  const dialogRef = useModalA11y<HTMLDivElement>(onClose)
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div ref={dialogRef} className="modal-card sheet" role="dialog" aria-modal="true" aria-label="Timetable changes" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>Timetable changes</h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {changes.length === 0 ? (
          <p className="filter-hint">
            No changes detected yet. When the sheet is edited, differences to your upcoming sessions
            (rooms, tutors, added or cancelled sessions) appear here after a refresh.
          </p>
        ) : (
          <ul className="changes-list">
            {changes.map((c, i) => (
              <li key={i} className={`change-row change-${c.type}`}>
                <span className={`badge badge-change-${c.type}`}>{LABEL[c.type]}</span>
                <div className="change-body">
                  <span className="change-title">{c.title}</span>
                  <span className="change-meta">
                    {formatDate(c.dateISO)}
                    {c.start && ` · ${c.start}`}
                    {c.detail && ` — ${c.detail}`}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="modal-actions">
          <button type="button" className="btn-primary" onClick={onClose}>
            Done
          </button>
          {changes.length > 0 && (
            <button type="button" className="btn-ghost" onClick={onClear}>
              Clear history
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

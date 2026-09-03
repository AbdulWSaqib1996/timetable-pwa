import { useModalA11y } from '../lib/a11y'
import { sessionKey } from '../lib/diff'
import { daysUntil } from '../lib/format'
import type { MetaMap, Session, SessionMeta } from '../types'

interface Props {
  keyDates: Session[]
  todayISO: string
  configured: boolean
  metaMap?: MetaMap
  onSelect: (session: Session) => void
  onSetStatus: (kd: Session, status: SessionMeta['status']) => void
  onDeleteCustom: (id: string) => void
  onClose: () => void
}

function formatDate(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

const STATUS_CYCLE: Record<string, SessionMeta['status']> = { todo: 'doing', doing: 'done', done: 'todo' }
const STATUS_LABEL: Record<string, string> = { todo: '○', doing: '◐ in progress', done: '✓ submitted' }

export function KeyDatesSheet({
  keyDates,
  todayISO,
  configured,
  metaMap,
  onSelect,
  onSetStatus,
  onDeleteCustom,
  onClose,
}: Props) {
  const dialogRef = useModalA11y<HTMLDivElement>(onClose)
  const statusOf = (k: Session): SessionMeta['status'] => metaMap?.[sessionKey(k)]?.status ?? 'todo'
  const upcoming = keyDates
    .filter((k) => k.dateISO >= todayISO)
    .sort((a, b) => (a.dateISO + a.start).localeCompare(b.dateISO + b.start))
  const pastCount = keyDates.length - upcoming.length
  const nextFortnight = upcoming.filter((k) => daysUntil(k.dateISO, todayISO) <= 14 && statusOf(k) !== 'done').length

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div ref={dialogRef} className="modal-card sheet" role="dialog" aria-modal="true" aria-label="Key dates" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>Key dates</h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {!configured && keyDates.length === 0 && (
          <p className="filter-hint">
            Paste the link to your submissions/key-dates sheet tab in Settings → Key dates, or add
            your own deadlines below.
          </p>
        )}
        {upcoming.length > 0 && (
          <p className={`workload-line${nextFortnight >= 3 ? ' heavy' : ''}`}>
            {nextFortnight === 0
              ? 'Nothing outstanding in the next 14 days.'
              : `${nextFortnight} deadline${nextFortnight === 1 ? '' : 's'} outstanding in the next 14 days${nextFortnight >= 3 ? ' — busy stretch ahead' : ''}. Tap the status to cycle it; tap a row for notes.`}
          </p>
        )}
        {upcoming.length === 0 && keyDates.length > 0 && (
          <p className="filter-hint">No upcoming key dates{pastCount > 0 ? ` (${pastCount} already passed)` : ''}.</p>
        )}
        <ul className="keydates-list">
          {upcoming.map((k) => {
            const days = daysUntil(k.dateISO, todayISO)
            const status = statusOf(k)
            const isCustom = k.id.startsWith('custom-')
            return (
              <li key={k.id} className={status === 'done' ? 'kd-done' : ''}>
                <div className="keydate-line">
                  <button type="button" className="keydate-row" onClick={() => onSelect(k)}>
                    <span className={`kd-chip${days <= 7 && status !== 'done' ? ' urgent' : ''}`}>
                      {days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `in ${days}d`}
                    </span>
                    <div className="change-body">
                      <span className="change-title">
                        {isCustom && '👤 '}
                        {k.title}
                        {metaMap?.[sessionKey(k)]?.note && ' 📝'}
                      </span>
                      <span className="change-meta">
                        {formatDate(k.dateISO)}
                        {k.start && ` · ${k.start}`}
                        {metaMap?.[sessionKey(k)]?.note && ` — ${metaMap[sessionKey(k)].note}`}
                      </span>
                    </div>
                  </button>
                  <span className="kd-actions">
                    <button
                      type="button"
                      className={`kd-status kd-status-${status}`}
                      title="Cycle status"
                      onClick={() => onSetStatus(k, STATUS_CYCLE[status ?? 'todo'])}
                    >
                      {STATUS_LABEL[status ?? 'todo']}
                    </button>
                    {isCustom && (
                      <button
                        type="button"
                        className="btn-icon"
                        aria-label="Delete personal deadline"
                        onClick={() => onDeleteCustom(k.id)}
                      >
                        ✕
                      </button>
                    )}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
        <p className="filter-hint">Add personal deadlines with the ＋ button on the main screen.</p>
        <div className="modal-actions">
          <button type="button" className="btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

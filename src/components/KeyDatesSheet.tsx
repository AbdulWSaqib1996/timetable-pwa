import { sessionKey } from '../lib/diff'
import { daysUntil } from '../lib/format'
import type { MetaMap, Session } from '../types'

interface Props {
  keyDates: Session[]
  todayISO: string
  configured: boolean
  metaMap?: MetaMap
  onSelect: (session: Session) => void
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

export function KeyDatesSheet({ keyDates, todayISO, configured, metaMap, onSelect, onClose }: Props) {
  const upcoming = keyDates
    .filter((k) => k.dateISO >= todayISO)
    .sort((a, b) => (a.dateISO + a.start).localeCompare(b.dateISO + b.start))
  const pastCount = keyDates.length - upcoming.length
  const nextFortnight = upcoming.filter((k) => daysUntil(k.dateISO, todayISO) <= 14).length

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card sheet" role="dialog" aria-label="Key dates" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>Key dates</h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {!configured ? (
          <p className="filter-hint">
            Paste the link to your submissions/key-dates sheet tab in Settings → Key dates, and
            deadlines will appear here with countdowns.
          </p>
        ) : upcoming.length === 0 ? (
          <p className="filter-hint">
            No upcoming key dates{pastCount > 0 ? ` (${pastCount} already passed)` : ''}.
          </p>
        ) : (
          <>
            <p className={`workload-line${nextFortnight >= 3 ? ' heavy' : ''}`}>
              {nextFortnight === 0
                ? 'Nothing due in the next 14 days.'
                : `${nextFortnight} deadline${nextFortnight === 1 ? '' : 's'} in the next 14 days${nextFortnight >= 3 ? ' — busy stretch ahead' : ''}. Tap one to add notes (e.g. "draft done").`}
            </p>
            <ul className="keydates-list">
            {upcoming.map((k) => {
              const days = daysUntil(k.dateISO, todayISO)
              return (
                <li key={k.id}>
                  <button type="button" className="keydate-row" onClick={() => onSelect(k)}>
                    <span className={`kd-chip${days <= 7 ? ' urgent' : ''}`}>
                      {days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `in ${days}d`}
                    </span>
                    <div className="change-body">
                      <span className="change-title">
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
                </li>
              )
            })}
            </ul>
          </>
        )}
        <div className="modal-actions">
          <button type="button" className="btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

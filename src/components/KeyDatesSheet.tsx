import { useState } from 'react'
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
  onAddCustom: (title: string, dateISO: string, start?: string) => void
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
  onAddCustom,
  onDeleteCustom,
  onClose,
}: Props) {
  const [newTitle, setNewTitle] = useState('')
  const [newDate, setNewDate] = useState('')
  const [newTime, setNewTime] = useState('')

  const statusOf = (k: Session): SessionMeta['status'] => metaMap?.[sessionKey(k)]?.status ?? 'todo'
  const upcoming = keyDates
    .filter((k) => k.dateISO >= todayISO)
    .sort((a, b) => (a.dateISO + a.start).localeCompare(b.dateISO + b.start))
  const pastCount = keyDates.length - upcoming.length
  const nextFortnight = upcoming.filter((k) => daysUntil(k.dateISO, todayISO) <= 14 && statusOf(k) !== 'done').length

  function submitCustom() {
    if (!newTitle.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return
    onAddCustom(newTitle.trim(), newDate, newTime || undefined)
    setNewTitle('')
    setNewDate('')
    setNewTime('')
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card sheet" role="dialog" aria-label="Key dates" onClick={(e) => e.stopPropagation()}>
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
        <details className="filter-section">
          <summary>➕ Add your own deadline</summary>
          <div className="custom-kd-form">
            <input
              type="text"
              placeholder="e.g. Dissertation draft to supervisor"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
            />
            <div className="btn-row">
              <input type="date" className="date-input" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
              <input type="time" className="date-input" value={newTime} onChange={(e) => setNewTime(e.target.value)} />
              <button
                type="button"
                className="btn-secondary"
                disabled={!newTitle.trim() || !newDate}
                onClick={submitCustom}
              >
                Add
              </button>
            </div>
            <p className="filter-hint">
              Personal deadlines join the countdown strip, reminders and calendar export, and stay on
              this device (and in backups).
            </p>
          </div>
        </details>
        <div className="modal-actions">
          <button type="button" className="btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

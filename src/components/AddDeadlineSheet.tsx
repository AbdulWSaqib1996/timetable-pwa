import { useState } from 'react'

interface Props {
  onAdd: (title: string, dateISO: string, start?: string) => void
  onClose: () => void
}

export function AddDeadlineSheet({ onAdd, onClose }: Props) {
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')

  function submit() {
    if (!title.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return
    onAdd(title.trim(), date, time || undefined)
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" role="dialog" aria-label="Add deadline" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>Add a deadline</h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="custom-kd-form">
          <input
            type="text"
            placeholder="e.g. Dissertation draft to supervisor"
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <div className="btn-row">
            <input type="date" className="date-input" value={date} onChange={(e) => setDate(e.target.value)} />
            <input type="time" className="date-input" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
          <p className="filter-hint">
            Personal deadlines appear as 📌 key dates — in the countdown strip, reminders and calendar
            export — and stay on this device (and in backups).
          </p>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn-primary" disabled={!title.trim() || !date} onClick={submit}>
            Add deadline
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

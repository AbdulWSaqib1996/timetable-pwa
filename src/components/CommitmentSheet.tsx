import { useState } from 'react'
import { newAdminId } from '../lib/admin'
import type { CommitmentRec } from '../lib/admin'
import { useDraft } from '../hooks/useDraft'
import { Dialog, Field, IconClose, StatusMessage } from './ui'

interface Fields {
  title: string
  dateISO: string
  startTime: string
  endTime: string
  kind: CommitmentRec['kind']
  location: string
  busy: boolean
  remind: boolean
  notes: string
}

interface Props {
  profileId: string
  /** the saved record when editing; null when creating */
  commitment: CommitmentRec | null
  /** date to prefill for a new entry */
  defaultDateISO: string
  /** times/kind to prefill for a new entry (Plan week suggestion, NF-03) */
  defaultStartTime?: string
  defaultEndTime?: string
  defaultKind?: CommitmentRec['kind']
  latest: CommitmentRec | null
  onSave: (rec: CommitmentRec) => boolean
  onDelete?: (rec: CommitmentRec) => void
  onClose: () => void
  /** ids of saved commitments — a recoverable NEW draft must not be one of them */
  existingIds?: Set<string>
}

const fieldsOf = (c: CommitmentRec | null, defaultDateISO: string, defaults: { startTime?: string; endTime?: string; kind?: CommitmentRec['kind'] } = {}): Fields => ({
  title: c?.title ?? '',
  dateISO: c?.dateISO ?? defaultDateISO,
  startTime: c?.startTime ?? defaults.startTime ?? '17:00',
  endTime: c?.endTime ?? defaults.endTime ?? '18:00',
  kind: c?.kind ?? defaults.kind ?? 'appointment',
  location: c?.location ?? '',
  busy: c?.busy !== false,
  // Preserved on every edit (TT-13); new events default to reminders OFF.
  remind: c?.remind === true,
  notes: c?.notes ?? '',
})

/**
 * Personal commitment / study block editor (P5-06). Individual events only —
 * no recurrence is implied. Busy/free participation is explicit; the title
 * and notes never leave this device except in encrypted sync/backups.
 */
export function CommitmentSheet({ profileId, commitment, defaultDateISO, defaultStartTime, defaultEndTime, defaultKind, latest, onSave, onDelete, onClose, existingIds }: Props) {
  const [initialId] = useState(() => commitment?.id ?? newAdminId())
  const draft = useDraft<Fields>(profileId, 'commitment', initialId, commitment?.at ?? 0, fieldsOf(commitment, defaultDateISO, { startTime: defaultStartTime, endTime: defaultEndTime, kind: defaultKind }), { existingIds })
  const recordId = draft.recordId
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const f = draft.value
  const set = (patch: Partial<Fields>) => draft.setValue((prev) => ({ ...prev, ...patch }))

  function commit(fields: Fields) {
    const title = fields.title.trim()
    if (!title) return setError('Give it a title.')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.dateISO)) return setError('Pick a date.')
    if (!fields.startTime || !fields.endTime || fields.endTime <= fields.startTime)
      return setError('It must end after it starts.')
    const rec: CommitmentRec = {
      id: recordId,
      title,
      dateISO: fields.dateISO,
      startTime: fields.startTime,
      endTime: fields.endTime,
      kind: fields.kind,
      location: fields.location.trim() || undefined,
      busy: fields.busy,
      remind: fields.remind,
      notes: fields.notes.trim() || undefined,
      at: Date.now(),
    }
    if (onSave(rec)) {
      draft.commitClear()
      onClose()
    } else {
      setError('Saving failed — your draft is kept.')
    }
  }

  return (
    <Dialog label={commitment ? 'Edit personal event' : 'Add personal event'} onClose={onClose}>
      <div className="sheet-header">
        <h2>{commitment ? 'Edit personal event' : 'Add personal event'}</h2>
        <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
          <IconClose />
        </button>
      </div>

      {draft.pendingDraft && (
        <StatusMessage tone="info">
          <span>
            Unsaved draft found.{' '}
            <button type="button" className="travel-link" onClick={draft.resumeDraft}>
              Continue draft
            </button>{' '}
            ·{' '}
            <button type="button" className="travel-link" onClick={draft.discardDraft}>
              Discard draft
            </button>
          </span>
        </StatusMessage>
      )}
      {conflict && latest && (
        <StatusMessage tone="danger">
          <span>
            This event changed on another device while you were editing.{' '}
            <button type="button" className="travel-link" onClick={() => commit(f)}>
              Keep mine
            </button>{' '}
            ·{' '}
            <button
              type="button"
              className="travel-link"
              onClick={() => {
                draft.discardDraft()
                onClose()
              }}
            >
              Use latest
            </button>
          </span>
        </StatusMessage>
      )}

      <Field label="Title">
        <input type="text" maxLength={120} value={f.title} onChange={(e) => set({ title: e.target.value })} autoFocus={!commitment} />
      </Field>
      <div className="task-edit-row">
        <Field label="Date">
          <input type="date" className="date-input" value={f.dateISO} onChange={(e) => set({ dateISO: e.target.value })} />
        </Field>
        <Field label="Starts">
          <input type="time" className="date-input" value={f.startTime} onChange={(e) => set({ startTime: e.target.value })} />
        </Field>
        <Field label="Ends">
          <input type="time" className="date-input" value={f.endTime} onChange={(e) => set({ endTime: e.target.value })} />
        </Field>
      </div>
      <Field label="Kind">
        <div className="chip-grid" role="group" aria-label="Kind">
          {(['appointment', 'work', 'study'] as const).map((k) => (
            <button
              key={k}
              type="button"
              className={`chip${f.kind === k ? ' chip-on' : ''}`}
              aria-pressed={f.kind === k}
              onClick={() => set({ kind: k })}
            >
              {k === 'appointment' ? 'Appointment' : k === 'work' ? 'Work' : 'Study block'}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Location (optional)">
        <input type="text" className="placement-input" value={f.location} onChange={(e) => set({ location: e.target.value })} />
      </Field>
      <label className="toggle-row">
        <input type="checkbox" checked={f.busy} onChange={(e) => set({ busy: e.target.checked })} />
        Counts as busy time (clashes and study-group availability)
      </label>
      <p className="filter-hint">
        Only the busy TIME interval is ever shared with a study group — never the title, notes or
        location.
      </p>
      <label className="toggle-row">
        <input type="checkbox" checked={f.remind} onChange={(e) => set({ remind: e.target.checked })} />
        Remind me
      </label>
      <p className="filter-hint">
        Uses your session reminder timing from Settings → Reminders. Counting as busy never turns
        reminders on by itself.
      </p>
      <Field label="Notes">
        <textarea className="note-input" rows={2} value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
      </Field>

      <p className="filter-hint" aria-live="polite">
        {draft.draftStatus === 'saved'
          ? 'Draft saved on this device.'
          : draft.draftStatus === 'failed'
            ? 'Draft could NOT be saved (storage full?) — keep this open until you save.'
            : ' '}
      </p>
      {error && (
        <p className="setup-error" role="alert">
          {error}
        </p>
      )}

      <div className="modal-actions">
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            setError(null)
            if (commitment && latest && latest.at > draft.baseRevision) {
              setConflict(true)
              return
            }
            commit(f)
          }}
        >
          Save
        </button>
        {commitment && onDelete && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              draft.commitClear()
              onDelete(commitment)
              onClose()
            }}
          >
            Delete event
          </button>
        )}
        <button type="button" className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  )
}

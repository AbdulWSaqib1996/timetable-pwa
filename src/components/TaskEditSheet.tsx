import { useState } from 'react'
import { newAdminId } from '../lib/admin'
import type { TaskRecord } from '../lib/admin'
import { useDraft } from '../hooks/useDraft'
import { Dialog, Field, StatusMessage } from './ui'

interface TaskFields {
  title: string
  dueISO: string
  dueTime: string
  status: TaskRecord['status']
  notes: string
}

interface Props {
  profileId: string
  /** the saved record when editing; null when creating */
  task: TaskRecord | null
  /** the CURRENT saved copy (may be newer than `task` if sync applied mid-edit) */
  latest: TaskRecord | null
  onSave: (record: TaskRecord) => boolean
  onDuplicate?: (task: TaskRecord) => void
  onDelete?: (task: TaskRecord) => void
  onClose: () => void
}

const fieldsOf = (t: TaskRecord | null): TaskFields => ({
  title: t?.title ?? '',
  dueISO: t?.dueISO ?? '',
  dueTime: t?.dueTime ?? '',
  status: t?.status ?? 'todo',
  notes: t?.notes ?? '',
})

/**
 * Task create/edit form (P5-01) with local drafts (P5-02): debounced draft
 * persistence with honest status, recovered-draft Continue/Discard, and a
 * revision check at save — if sync changed the task while editing, the user
 * chooses Keep mine / Use latest instead of silently overwriting.
 */
export function TaskEditSheet({ profileId, task, latest, onSave, onDuplicate, onDelete, onClose }: Props) {
  const [recordId] = useState(() => task?.id ?? newAdminId())
  const draft = useDraft<TaskFields>(profileId, 'task', recordId, task?.at ?? 0, fieldsOf(task))
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<TaskRecord | null>(null)
  const f = draft.value
  const set = (patch: Partial<TaskFields>) => draft.setValue((prev) => ({ ...prev, ...patch }))

  function commit(fields: TaskFields) {
    const title = fields.title.trim()
    if (!title) {
      setError('Give the task a title.')
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.dueISO)) {
      setError('Pick a due date.')
      return
    }
    const record: TaskRecord = {
      id: recordId,
      title,
      dueISO: fields.dueISO,
      dueTime: fields.dueTime || undefined,
      status: fields.status,
      notes: fields.notes.trim() || undefined,
      completedISO:
        fields.status === 'done'
          ? task?.completedISO ?? new Date().toISOString().slice(0, 10)
          : task?.completedISO,
      at: Date.now(),
    }
    if (onSave(record)) {
      draft.commitClear()
      onClose()
    } else {
      setError('Saving failed — your draft is kept. Free some storage and try again.')
    }
  }

  function handleSave() {
    setError(null)
    // Conflict check: did sync change this task while the form was open?
    if (task && latest && latest.at > draft.baseRevision) {
      setConflict(latest)
      return
    }
    commit(f)
  }

  return (
    <Dialog label={task ? 'Edit task' : 'Add task'} onClose={onClose}>
      <div className="sheet-header">
        <h2>{task ? 'Edit task' : 'Add task'}</h2>
        <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      {draft.pendingDraft && (
        <StatusMessage tone="info">
          <span>
            You have an unsaved draft of this task from{' '}
            {new Date(draft.pendingDraft.savedAt).toLocaleString('en-GB', {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
            .{' '}
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

      {conflict && (
        <StatusMessage tone="danger">
          <span>
            This task changed on another device while you were editing (now “{conflict.title}”, due{' '}
            {conflict.dueISO}).{' '}
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
        <input
          type="text"
          maxLength={120}
          value={f.title}
          onChange={(e) => set({ title: e.target.value })}
          autoFocus={!task}
        />
      </Field>
      <div className="task-edit-row">
        <Field label="Due date">
          <input type="date" className="date-input" value={f.dueISO} onChange={(e) => set({ dueISO: e.target.value })} />
        </Field>
        <Field label="Due time (optional)">
          <input type="time" className="date-input" value={f.dueTime} onChange={(e) => set({ dueTime: e.target.value })} />
        </Field>
      </div>
      <Field label="Status">
        <div className="chip-grid" role="group" aria-label="Task status">
          {(['todo', 'doing', 'done'] as const).map((status) => (
            <button
              key={status}
              type="button"
              className={`chip${f.status === status ? ' chip-on' : ''}`}
              aria-pressed={f.status === status}
              onClick={() => set({ status })}
            >
              {status === 'todo' ? '○ To do' : status === 'doing' ? '◐ In progress' : '✓ Done'}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Notes">
        <textarea className="note-input" rows={3} value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
      </Field>

      <p className="filter-hint" aria-live="polite">
        {draft.draftStatus === 'saved'
          ? 'Draft saved on this device.'
          : draft.draftStatus === 'failed'
            ? 'Draft could NOT be saved (storage full?) — keep this sheet open until you save.'
            : draft.draftStatus === 'saving'
              ? 'Saving draft…'
              : ' '}
      </p>
      {error && (
        <p className="setup-error" role="alert">
          {error}
        </p>
      )}

      <div className="modal-actions">
        <button type="button" className="btn-primary" onClick={handleSave}>
          Save task
        </button>
        {task && onDuplicate && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              onDuplicate(task)
              onClose()
            }}
          >
            Duplicate
          </button>
        )}
        {task && onDelete && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              draft.commitClear()
              onDelete(task)
              onClose()
            }}
          >
            Delete task
          </button>
        )}
        <button type="button" className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  )
}

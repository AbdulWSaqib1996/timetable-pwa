import { useState } from 'react'
import { newAdminId } from '../lib/admin'
import type { MeetingAction } from '../lib/admin'
import { useDraft } from '../hooks/useDraft'
import { TEACHERS_STANDARDS } from '../lib/standards'
import { Dialog, Field, StatusMessage } from './ui'

/**
 * One schema-driven editor for every PGCE record type (P5-02): reflections,
 * targets, meetings (with per-action identity preserved), observations,
 * lessons and audits. Drafts persist locally with honest status; a sync
 * change mid-edit offers Keep mine / Use latest; validation runs before the
 * commit reaches the persistence layer.
 */

export type RecordKind = 'reflection' | 'target' | 'meeting' | 'observation' | 'lesson' | 'audit'

interface FieldDef {
  name: string
  label: string
  type: 'text' | 'textarea' | 'date' | 'standards' | 'select' | 'actions'
  options?: { value: string; label: string }[]
  required?: boolean
}

const SCHEMAS: Record<RecordKind, { title: string; fields: FieldDef[] }> = {
  reflection: {
    title: 'reflection',
    fields: [
      { name: 'weekISO', label: 'Week of', type: 'date', required: true },
      { name: 'wentWell', label: 'What went well', type: 'textarea' },
      { name: 'challenges', label: 'Challenges', type: 'textarea' },
      { name: 'focus', label: 'Focus for next week', type: 'textarea' },
      { name: 'standards', label: "Teachers' Standards", type: 'standards' },
    ],
  },
  target: {
    title: 'target',
    fields: [
      { name: 'text', label: 'Target', type: 'textarea', required: true },
      {
        name: 'status',
        label: 'Status',
        type: 'select',
        options: [
          { value: 'open', label: '○ Open' },
          { value: 'progress', label: '◐ In progress' },
          { value: 'met', label: '✓ Met' },
        ],
      },
      { name: 'setISO', label: 'Set on', type: 'date', required: true },
      { name: 'metISO', label: 'Met on', type: 'date' },
      { name: 'standards', label: "Teachers' Standards", type: 'standards' },
    ],
  },
  meeting: {
    title: 'meeting record',
    fields: [
      { name: 'dateISO', label: 'Date', type: 'date', required: true },
      { name: 'discussed', label: 'What was discussed', type: 'textarea' },
      { name: 'actions', label: 'Actions', type: 'actions' },
    ],
  },
  observation: {
    title: 'observation',
    fields: [
      { name: 'dateISO', label: 'Date', type: 'date', required: true },
      { name: 'observer', label: 'Observer', type: 'text' },
      { name: 'subject', label: 'Lesson / subject', type: 'text' },
      { name: 'focus', label: 'Observation focus', type: 'text' },
      { name: 'strengths', label: 'Strengths', type: 'textarea' },
      { name: 'development', label: 'Development points', type: 'textarea' },
    ],
  },
  lesson: {
    title: 'lesson record',
    fields: [
      { name: 'dateISO', label: 'Date', type: 'date', required: true },
      { name: 'classGroup', label: 'Class', type: 'text' },
      { name: 'subject', label: 'Subject', type: 'text' },
      { name: 'evaluation', label: 'Evaluation', type: 'textarea' },
      { name: 'standards', label: "Teachers' Standards", type: 'standards' },
    ],
  },
  audit: {
    title: 'audit entry',
    fields: [
      { name: 'subject', label: 'Subject', type: 'text', required: true },
      {
        name: 'stage',
        label: 'Stage',
        type: 'select',
        options: [
          { value: 'baseline', label: 'Baseline' },
          { value: 'revisited', label: 'Revisited' },
          { value: 'secure', label: 'Secure' },
        ],
      },
      { name: 'dateISO', label: 'Date', type: 'date', required: true },
      { name: 'note', label: 'Note', type: 'textarea' },
    ],
  },
}

type Value = Record<string, unknown>

interface Props {
  profileId: string
  kind: RecordKind
  /** the saved record when editing began */
  record: Value & { id: string; at: number }
  /** the CURRENT saved copy (may be newer if sync applied mid-edit) */
  latest: (Value & { id: string; at: number }) | null
  onSave: (record: Value & { id: string; at: number }) => boolean
  onDelete: () => void
  onClose: () => void
}

export function RecordEditSheet({ profileId, kind, record, latest, onSave, onDelete, onClose }: Props) {
  const schema = SCHEMAS[kind]
  const draft = useDraft<Value>(profileId, kind, record.id, record.at, record)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const v = draft.value
  const set = (name: string, value: unknown) => draft.setValue((prev) => ({ ...prev, [name]: value }))

  function commit(value: Value) {
    for (const f of schema.fields) {
      const raw = value[f.name]
      if (f.type === 'date' && raw && !/^\d{4}-\d{2}-\d{2}$/.test(String(raw))) {
        setError(`${f.label}: pick a valid date.`)
        return
      }
      if (f.required && (raw === undefined || String(raw).trim() === '')) {
        setError(`${f.label} is required.`)
        return
      }
      if (f.type === 'select' && f.options && !f.options.some((o) => o.value === value[f.name])) {
        setError(`${f.label}: pick a value.`)
        return
      }
    }
    const next = { ...record, ...value, id: record.id, at: Date.now() } as Value & { id: string; at: number }
    if (onSave(next)) {
      draft.commitClear()
      onClose()
    } else {
      setError('Saving failed — your draft is kept. Free some storage and try again.')
    }
  }

  function handleSave() {
    setError(null)
    if (latest && latest.at > draft.baseRevision) {
      setConflict(true)
      return
    }
    commit(v)
  }

  const actions = (v.actions as MeetingAction[] | undefined) ?? []

  return (
    <Dialog label={`Edit ${schema.title}`} onClose={onClose}>
      <div className="sheet-header">
        <h2>Edit {schema.title}</h2>
        <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      {draft.pendingDraft && (
        <StatusMessage tone="info">
          <span>
            Unsaved draft from{' '}
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
            This {schema.title} changed on another device while you were editing.{' '}
            <button type="button" className="travel-link" onClick={() => commit(v)}>
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

      {schema.fields.map((f) => {
        if (f.type === 'standards') {
          const selected = (v[f.name] as string[] | undefined) ?? []
          return (
            <Field key={f.name} label={f.label}>
              <div className="chip-grid ts-chips">
                {TEACHERS_STANDARDS.map((ts) => (
                  <button
                    key={ts.id}
                    type="button"
                    className={`chip chip-small${selected.includes(ts.id) ? ' chip-on' : ''}`}
                    aria-pressed={selected.includes(ts.id)}
                    title={ts.label}
                    onClick={() =>
                      set(
                        f.name,
                        selected.includes(ts.id) ? selected.filter((x) => x !== ts.id) : [...selected, ts.id].sort()
                      )
                    }
                  >
                    {ts.id}
                  </button>
                ))}
              </div>
            </Field>
          )
        }
        if (f.type === 'actions') {
          return (
            <Field key={f.name} label={f.label} hint="Editing keeps each action's identity and its done state.">
              <div className="record-actions-edit">
                {actions.map((a) => (
                  <div className="record-action-row" key={a.id}>
                    <input
                      type="text"
                      value={a.text}
                      aria-label="Action text"
                      onChange={(e) =>
                        set(
                          'actions',
                          actions.map((x) => (x.id === a.id ? { ...x, text: e.target.value } : x))
                        )
                      }
                    />
                    <button
                      type="button"
                      className="btn-icon"
                      aria-label="Remove action"
                      onClick={() => set('actions', actions.filter((x) => x.id !== a.id))}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => set('actions', [...actions, { id: newAdminId(), text: '', done: false }])}
                >
                  ＋ Add action
                </button>
              </div>
            </Field>
          )
        }
        if (f.type === 'select') {
          return (
            <Field key={f.name} label={f.label}>
              <select
                className="date-input"
                value={String(v[f.name] ?? f.options?.[0]?.value ?? '')}
                onChange={(e) => set(f.name, e.target.value)}
              >
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
          )
        }
        if (f.type === 'date') {
          return (
            <Field key={f.name} label={f.label}>
              <input
                type="date"
                className="date-input"
                value={String(v[f.name] ?? '')}
                onChange={(e) => set(f.name, e.target.value)}
              />
            </Field>
          )
        }
        if (f.type === 'textarea') {
          return (
            <Field key={f.name} label={f.label}>
              <textarea
                className="note-input"
                rows={2}
                value={String(v[f.name] ?? '')}
                onChange={(e) => set(f.name, e.target.value)}
              />
            </Field>
          )
        }
        return (
          <Field key={f.name} label={f.label}>
            <input
              type="text"
              className="placement-input"
              value={String(v[f.name] ?? '')}
              onChange={(e) => set(f.name, e.target.value)}
            />
          </Field>
        )
      })}

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
          Save changes
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            draft.commitClear()
            onDelete()
            onClose()
          }}
        >
          Delete {schema.title}
        </button>
        <button type="button" className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  )
}

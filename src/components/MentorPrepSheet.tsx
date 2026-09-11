import { useState } from 'react'
import { Dialog, Field, FieldGroup, IconClose } from './ui'
import { provenanceLabel } from '../../shared/practice.js'
import { newAdminId } from '../lib/admin'
import type { AdminFile, Meeting, MentorPrepRec } from '../lib/admin'

interface Props {
  admin: AdminFile
  todayISO: string
  placementOptions: { value: string; label: string }[]
  onUpdateAdmin: (updater: (prev: AdminFile) => AdminFile) => void
  onClose: () => void
}

const fmt = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

/**
 * Mentor preparation (PG-03, G1b). Before the meeting: an agenda built from
 * what changed, where help is needed, selected examples (lessons and feedback
 * records, referenced not copied), proposed next steps, and the open actions
 * already owed. After: what happened, optional duration, agreed actions — which
 * are created on a Meeting record, the same owner as before — and the next
 * review date. Feedback keeps its provenance label; entering a mentor's words
 * here never makes them reviewer-authenticated.
 */
export function MentorPrepSheet({ admin, todayISO, placementOptions, onUpdateAdmin, onClose }: Props) {
  const preps = [...admin.preps].sort((a, b) => b.dateISO.localeCompare(a.dateISO))
  const [selectedId, setSelectedId] = useState<string | null>(preps.find((p) => p.state === 'draft')?.id ?? null)
  const [newDate, setNewDate] = useState(todayISO)
  const [newPlacement, setNewPlacement] = useState('')
  const [held, setHeld] = useState({ happened: '', duration: '', actions: '', nextReviewISO: '' })
  const selected = admin.preps.find((p) => p.id === selectedId) ?? null
  const setPrep = (id: string, patch: Partial<MentorPrepRec>) => onUpdateAdmin((prev) => ({ ...prev, preps: prev.preps.map((p) => (p.id === id ? { ...p, ...patch, at: Date.now() } : p)) }))
  const openActions = admin.meetings.flatMap((m) => m.actions.filter((a) => !a.done).map((a) => ({ ...a, dateISO: m.dateISO })))
  const examples = [
    ...admin.lessons.map((l) => ({ id: l.id, label: `Lesson · ${fmt(l.dateISO)} · ${l.subject || 'Lesson'}${l.attempt && l.attempt > 1 ? ` (attempt ${l.attempt})` : ''}` })),
    ...admin.observations.map((o) => ({ id: o.id, label: `Feedback · ${fmt(o.dateISO)} · ${o.subject || o.focus || 'Observation'} · ${provenanceLabel(o.sourceType)}` })),
  ].slice(0, 30)

  const markHeld = () => {
    if (!selected) return
    const now = Date.now()
    const actions = held.actions.split('\n').map((t) => t.trim()).filter(Boolean).map((text) => ({ id: newAdminId(), text, done: false }))
    const meeting: Meeting = { id: newAdminId(), dateISO: selected.dateISO, discussed: held.happened.trim() || [selected.changed, selected.helpNeeded, selected.proposedSteps].filter(Boolean).join('\n'), actions, prepId: selected.id, at: now }
    if (selected.placementId) meeting.placementId = selected.placementId
    const outcome: MentorPrepRec['outcome'] = {}
    if (held.happened.trim()) outcome.happened = held.happened.trim()
    if (held.duration.trim()) outcome.durationMins = Math.max(0, Math.min(600, parseInt(held.duration, 10) || 0))
    if (held.nextReviewISO) outcome.nextReviewISO = held.nextReviewISO
    onUpdateAdmin((prev) => ({ ...prev, meetings: [...prev.meetings, meeting], preps: prev.preps.map((p) => (p.id === selected.id ? { ...p, state: 'held', meetingId: meeting.id, outcome, at: now } : p)) }))
    setHeld({ happened: '', duration: '', actions: '', nextReviewISO: '' })
  }

  return (
    <Dialog label="Mentor preparation" onClose={onClose} className="sheet-prep">
      <div className="sheet-header">
        <h2>Mentor preparation</h2>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><IconClose /></button>
      </div>
      <Field label="Plan a meeting">
        <div className="task-edit-row">
          <input type="date" className="date-input" aria-label="Meeting date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
          {placementOptions.length > 0 && (
            <select className="date-input" aria-label="Meeting placement" value={newPlacement} onChange={(e) => setNewPlacement(e.target.value)}>
              <option value="">Any placement</option>
              {placementOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          )}
          <button
            type="button"
            className="btn-primary"
            disabled={!newDate}
            onClick={() => {
              const rec: MentorPrepRec = { id: newAdminId(), dateISO: newDate, state: 'draft', exampleRefs: [], at: Date.now() }
              if (newPlacement) rec.placementId = newPlacement
              onUpdateAdmin((prev) => ({ ...prev, preps: [...prev.preps, rec] }))
              setSelectedId(rec.id)
            }}
          >
            New agenda
          </button>
        </div>
      </Field>
      {preps.length > 0 && (
        <ul className="workspace-list" aria-label="Meetings">
          {preps.map((p) => (
            <li key={p.id}>
              <button type="button" className="workspace-row" aria-current={p.id === selectedId ? 'true' : undefined} onClick={() => setSelectedId(p.id)}>
                <span>{fmt(p.dateISO)}{p.placementId ? ` · ${placementOptions.find((o) => o.value === p.placementId)?.label ?? ''}` : ''}</span>
                <span className="tag">{p.state === 'held' ? 'Held' : 'Agenda'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <section className="prep-editor" aria-label={`Agenda for ${fmt(selected.dateISO)}`}>
          <h3 className="subheading">{selected.state === 'held' ? 'Meeting held' : 'Agenda'} · {fmt(selected.dateISO)}</h3>
          {selected.state === 'draft' ? (
            <>
              <Field label="What changed since last time"><textarea className="placement-input" rows={2} value={selected.changed ?? ''} onChange={(e) => setPrep(selected.id, { changed: e.target.value })} /></Field>
              <Field label="Where I need help"><textarea className="placement-input" rows={2} value={selected.helpNeeded ?? ''} onChange={(e) => setPrep(selected.id, { helpNeeded: e.target.value })} /></Field>
              <FieldGroup label="Examples to bring (referenced, not copied)">
                {examples.length === 0 ? <p className="filter-hint">No lessons or feedback records yet.</p> : (
                  <ul className="setup-list" aria-label="Examples">
                    {examples.map((x) => (
                      <li key={x.id} className="setup-row">
                        <label className="toggle-row">
                          <input type="checkbox" checked={(selected.exampleRefs ?? []).includes(x.id)} onChange={(e) => setPrep(selected.id, { exampleRefs: e.target.checked ? [...(selected.exampleRefs ?? []), x.id] : (selected.exampleRefs ?? []).filter((r) => r !== x.id) })} />
                          <span>{x.label}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </FieldGroup>
              <Field label="Proposed next steps"><textarea className="placement-input" rows={2} value={selected.proposedSteps ?? ''} onChange={(e) => setPrep(selected.id, { proposedSteps: e.target.value })} /></Field>
              <FieldGroup label="Open actions already owed (from meeting records)">
                {openActions.length === 0 ? <p className="filter-hint">None open.</p> : (
                  <ul className="workspace-list" aria-label="Open actions">
                    {openActions.map((a) => (
                      <li key={a.id} className="workspace-row"><span>{a.text}</span><span className="filter-hint">{fmt(a.dateISO)}</span></li>
                    ))}
                  </ul>
                )}
              </FieldGroup>
              <h3 className="subheading">After the meeting</h3>
              <Field label="What happened"><textarea className="placement-input" rows={2} aria-label="What happened" value={held.happened} onChange={(e) => setHeld({ ...held, happened: e.target.value })} /></Field>
              <div className="task-edit-row">
                <Field label="Duration (min, optional)"><input type="number" className="date-input" min={0} max={600} value={held.duration} onChange={(e) => setHeld({ ...held, duration: e.target.value })} /></Field>
                <Field label="Next review date"><input type="date" className="date-input" aria-label="Next review date" value={held.nextReviewISO} onChange={(e) => setHeld({ ...held, nextReviewISO: e.target.value })} /></Field>
              </div>
              <Field label="Agreed actions (one per line — they live on the meeting record)"><textarea className="placement-input" rows={3} aria-label="Agreed actions" value={held.actions} onChange={(e) => setHeld({ ...held, actions: e.target.value })} /></Field>
              <div className="btn-row">
                <button type="button" className="btn-primary" onClick={markHeld}>Meeting held — save</button>
                <button type="button" className="btn-today-reset" onClick={() => { onUpdateAdmin((prev) => ({ ...prev, preps: prev.preps.filter((p) => p.id !== selected.id) })); setSelectedId(null) }}>Delete agenda</button>
              </div>
            </>
          ) : (
            <>
              {selected.outcome?.happened && <p>{selected.outcome.happened}</p>}
              <p className="filter-hint">
                {selected.outcome?.durationMins ? `${selected.outcome.durationMins} min · ` : ''}
                {(() => {
                  const m = admin.meetings.find((x) => x.id === selected.meetingId)
                  return m ? `${m.actions.length} agreed action${m.actions.length === 1 ? '' : 's'} on the meeting record (${m.actions.filter((a) => !a.done).length} open)` : 'Meeting record removed'
                })()}
                {selected.outcome?.nextReviewISO ? ` · next review ${fmt(selected.outcome.nextReviewISO)}` : ''}
              </p>
              {(selected.exampleRefs ?? []).length > 0 && <p className="filter-hint">Examples discussed: {(selected.exampleRefs ?? []).map((id) => examples.find((x) => x.id === id)?.label ?? 'record removed').join(' · ')}</p>}
            </>
          )}
        </section>
      )}
    </Dialog>
  )
}

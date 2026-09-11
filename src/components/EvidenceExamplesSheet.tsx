import { useState } from 'react'
import { Dialog, Field, FieldGroup, IconClose } from './ui'
import { EXAMPLE_CONTEXTS, ITTECF_AREAS, PART_TWO_CONTEXTS } from '../../shared/evidence.js'
import { newAdminId } from '../lib/admin'
import type { AdminFile, EvidenceExampleRec } from '../lib/admin'
import { TEACHERS_STANDARDS } from '../lib/standards'

interface Props {
  admin: AdminFile
  onUpdateAdmin: (updater: (prev: AdminFile) => AdminFile) => void
  onClose: () => void
}

const CONTEXT_LABEL: Record<string, string> = { 'course-curriculum': 'Course curriculum', 'practice-cycle': 'Practice cycle', 'provider-assessment': 'Provider assessment' }
const fmt = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

/**
 * Evidence examples (PG-06, G3): a narrative — situation, decision, what you
 * noticed, what you changed next — over REFERENCES to existing records (one
 * lesson can sit in many examples without a copy; deleting an example never
 * touches the lesson). ITTECF areas and Teachers' Standards are tagged as two
 * separate lists with no combined score; Part Two lists conduct contexts only.
 */
export function EvidenceExamplesSheet({ admin, onUpdateAdmin, onClose }: Props) {
  const [draft, setDraft] = useState<{ title: string; context: EvidenceExampleRec['context']; refs: string[]; narrative: { context: string; decision: string; noticed: string; changedNext: string }; ittecf: string[]; standards: string[]; partTwo: string[] }>({ title: '', context: 'course-curriculum', refs: [], narrative: { context: '', decision: '', noticed: '', changedNext: '' }, ittecf: [], standards: [], partTwo: [] })
  const candidates = [
    ...admin.lessons.map((l) => ({ key: `lesson:${l.id}`, label: `Lesson · ${fmt(l.dateISO)} · ${l.subject || 'Lesson'}` })),
    ...admin.observations.map((o) => ({ key: `observation:${o.id}`, label: `Feedback · ${fmt(o.dateISO)} · ${o.observer || o.subject || 'Observation'}` })),
    ...admin.meetings.map((m) => ({ key: `meeting:${m.id}`, label: `Mentor meeting · ${fmt(m.dateISO)}` })),
    ...admin.reflections.map((r) => ({ key: `reflection:${r.id}`, label: `Reflection · week of ${fmt(r.weekISO)}` })),
  ]
  const exists = (ref: { entityType: string; entityId: string }) => {
    const map: Record<string, { id: string }[]> = { lesson: admin.lessons, observation: admin.observations, meeting: admin.meetings, reflection: admin.reflections }
    return (map[ref.entityType] ?? []).some((r) => r.id === ref.entityId)
  }
  const labelOf = (ref: { entityType: string; entityId: string }) => candidates.find((c) => c.key === `${ref.entityType}:${ref.entityId}`)?.label ?? `${ref.entityType} no longer present`

  const add = () => {
    const rec: EvidenceExampleRec = { id: newAdminId(), title: draft.title.trim(), context: draft.context, refs: draft.refs.map((k) => ({ entityType: k.split(':')[0], entityId: k.split(':')[1] })), narrative: Object.fromEntries(Object.entries(draft.narrative).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()])), ittecf: draft.ittecf, standards: draft.standards, partTwo: draft.partTwo, at: Date.now() }
    onUpdateAdmin((prev) => ({ ...prev, examples: [...prev.examples, rec] }))
    setDraft({ title: '', context: 'course-curriculum', refs: [], narrative: { context: '', decision: '', noticed: '', changedNext: '' }, ittecf: [], standards: [], partTwo: [] })
  }

  return (
    <Dialog label="Evidence examples" onClose={onClose} className="sheet-examples">
      <div className="sheet-header">
        <h2>Evidence examples</h2>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><IconClose /></button>
      </div>
      <p className="filter-hint">A short narrative over records you already have. Frameworks are references you choose — two separate lists, never a rating.</p>
      <Field label="Title"><input type="text" className="placement-input" aria-label="Example title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></Field>
      <Field label="Context">
        <select className="date-input" aria-label="Example context" value={draft.context} onChange={(e) => setDraft({ ...draft, context: e.target.value as EvidenceExampleRec['context'] })}>
          {EXAMPLE_CONTEXTS.map((c) => (
            <option key={c} value={c}>{CONTEXT_LABEL[c]}</option>
          ))}
        </select>
      </Field>
      <FieldGroup label="Source records (referenced, not copied)">
        {candidates.length === 0 ? <p className="filter-hint">No lessons, feedback, meetings or reflections yet.</p> : (
          <ul className="setup-list" aria-label="Source records">
            {candidates.map((c) => (
              <li key={c.key} className="setup-row">
                <label className="toggle-row"><input type="checkbox" checked={draft.refs.includes(c.key)} onChange={() => setDraft({ ...draft, refs: toggle(draft.refs, c.key) })} /><span>{c.label}</span></label>
              </li>
            ))}
          </ul>
        )}
      </FieldGroup>
      {([['context', 'Situation'], ['decision', 'The decision I made'], ['noticed', 'What I noticed'], ['changedNext', 'What I changed next']] as const).map(([k, label]) => (
        <Field key={k} label={label}><textarea className="placement-input" rows={2} aria-label={label} value={draft.narrative[k]} onChange={(e) => setDraft({ ...draft, narrative: { ...draft.narrative, [k]: e.target.value } })} /></Field>
      ))}
      <FieldGroup label="ITTECF areas (reference only)">
        <div className="chip-grid ts-chips">
          {ITTECF_AREAS.map((a) => (
            <button key={a.id} type="button" className={`chip chip-small${draft.ittecf.includes(a.id) ? ' chip-on' : ''}`} aria-pressed={draft.ittecf.includes(a.id)} onClick={() => setDraft({ ...draft, ittecf: toggle(draft.ittecf, a.id) })}>{a.label}</button>
          ))}
        </div>
      </FieldGroup>
      <FieldGroup label="Teachers' Standards (reference only)">
        <div className="chip-grid ts-chips">
          {TEACHERS_STANDARDS.map((ts) => (
            <button key={ts.id} type="button" className={`chip chip-small${draft.standards.includes(ts.id) ? ' chip-on' : ''}`} aria-pressed={draft.standards.includes(ts.id)} title={ts.label} onClick={() => setDraft({ ...draft, standards: toggle(draft.standards, ts.id) })}>{ts.id}</button>
          ))}
        </div>
      </FieldGroup>
      <FieldGroup label="Part Two — conduct contexts this relates to">
        <div className="chip-grid ts-chips">
          {PART_TWO_CONTEXTS.map((c) => (
            <button key={c.id} type="button" className={`chip chip-small${draft.partTwo.includes(c.id) ? ' chip-on' : ''}`} aria-pressed={draft.partTwo.includes(c.id)} onClick={() => setDraft({ ...draft, partTwo: toggle(draft.partTwo, c.id) })}>{c.label}</button>
          ))}
        </div>
      </FieldGroup>
      <div className="btn-row"><button type="button" className="btn-primary" disabled={!draft.title.trim()} onClick={add}>Add example</button></div>

      {admin.examples.length > 0 && (
        <ul className="workspace-list practice-list" aria-label="Evidence examples">
          {admin.examples.map((e) => (
            <li key={e.id} className="practice-cycle">
              <div className="pgce-section-head"><h3>{e.title}</h3><span className="tag">{CONTEXT_LABEL[e.context]}</span></div>
              {(e.refs ?? []).length > 0 && <p className="filter-hint">{(e.refs ?? []).map((r) => (exists(r) ? labelOf(r) : `${r.entityType} no longer present`)).join(' · ')}</p>}
              {e.narrative?.changedNext && <p className="filter-hint"><strong>Changed next:</strong> {e.narrative.changedNext}</p>}
              <p className="filter-hint">
                {(e.ittecf ?? []).length ? `ITTECF: ${(e.ittecf ?? []).map((id) => ITTECF_AREAS.find((a) => a.id === id)?.label ?? id).join(', ')}` : 'No ITTECF reference'} · {(e.standards ?? []).length ? `TS: ${(e.standards ?? []).join(', ')}` : 'No Teachers’ Standards reference'}
                {(e.partTwo ?? []).length ? ` · Part Two: ${(e.partTwo ?? []).map((id) => PART_TWO_CONTEXTS.find((c) => c.id === id)?.label ?? id).join(', ')}` : ''}
              </p>
              <div className="btn-row"><button type="button" className="travel-link" onClick={() => onUpdateAdmin((prev) => ({ ...prev, examples: prev.examples.filter((x) => x.id !== e.id) }))}>Remove example (source records stay)</button></div>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}

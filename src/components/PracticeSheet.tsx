import { useState } from 'react'
import { Dialog, Field, IconClose } from './ui'
import { activateCycle, provenanceLabel } from '../../shared/practice.js'
import { newAdminId } from '../lib/admin'
import type { AdminFile, PracticeCycleRec } from '../lib/admin'

interface Props {
  admin: AdminFile
  onUpdateAdmin: (updater: (prev: AdminFile) => AdminFile) => void
  onOpenLesson: (lessonId: string) => void
  onClose: () => void
}

const STATE_LABEL: Record<PracticeCycleRec['state'], string> = { active: 'Active focus', paused: 'Paused', archived: 'Archived' }
const DECISION_LABEL: Record<string, string> = { continue: 'Keep going', adapt: 'Adapt the approach', close: 'Close this focus' }
const fmt = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/**
 * Practice cycles (PG-03, G1b): one active focus at a time, its attempts
 * (lessons carrying the focus), the feedback that informs it, a rehearsal
 * note and a review decision. Pausing or archiving is the learner's choice
 * and carries no failure label.
 */
export function PracticeSheet({ admin, onUpdateAdmin, onOpenLesson, onClose }: Props) {
  const [focus, setFocus] = useState('')
  const [curriculumRef, setCurriculumRef] = useState('')
  const cycles = [...admin.cycles].sort((a, b) => (a.state === b.state ? b.at - a.at : a.state === 'active' ? -1 : b.state === 'active' ? 1 : a.state === 'paused' ? -1 : 1))
  const setCycle = (id: string, patch: Partial<PracticeCycleRec>) => onUpdateAdmin((prev) => ({ ...prev, cycles: prev.cycles.map((c) => (c.id === id ? { ...c, ...patch, at: Date.now() } : c)) }))

  return (
    <Dialog label="Practice focus" onClose={onClose} className="sheet-practice">
      <div className="sheet-header">
        <h2>Practice focus</h2>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><IconClose /></button>
      </div>
      <p className="filter-hint">One thing you are working on at a time. Each attempt is a lesson planned with this focus; feedback you enter on those lessons collects here. Pause or close a focus whenever you decide — nothing is scored.</p>
      <Field label="New focus">
        <input type="text" className="placement-input" aria-label="Focus" placeholder="e.g. Cold-call every learner at least once" value={focus} onChange={(e) => setFocus(e.target.value)} />
        <input type="text" className="placement-input" aria-label="Curriculum reference (optional)" placeholder="Curriculum reference (optional)" value={curriculumRef} onChange={(e) => setCurriculumRef(e.target.value)} />
        <div className="btn-row">
          <button
            type="button"
            className="btn-primary"
            disabled={!focus.trim()}
            onClick={() => {
              const rec: PracticeCycleRec = { id: newAdminId(), focus: focus.trim(), state: 'active', at: Date.now() }
              if (curriculumRef.trim()) rec.curriculumRef = curriculumRef.trim()
              onUpdateAdmin((prev) => ({ ...prev, cycles: activateCycle([...prev.cycles, rec], rec.id, Date.now()) }))
              setFocus('')
              setCurriculumRef('')
            }}
          >
            Start focus
          </button>
        </div>
      </Field>
      {cycles.length === 0 ? (
        <p className="filter-hint">No focus yet.</p>
      ) : (
        <ul className="workspace-list practice-list" aria-label="Practice cycles">
          {cycles.map((c) => {
            const attempts = admin.lessons.filter((l) => l.cycleId === c.id).sort((a, b) => a.dateISO.localeCompare(b.dateISO))
            const feedback = admin.observations.filter((o) => o.cycleId === c.id)
            return (
              <li key={c.id} className={`practice-cycle practice-cycle--${c.state}`}>
                <div className="pgce-section-head">
                  <h3>{c.focus}</h3>
                  <span className={`tag${c.state === 'active' ? ' tag--teal' : ''}`}>{STATE_LABEL[c.state]}</span>
                </div>
                {c.curriculumRef && <p className="filter-hint">{c.curriculumRef}</p>}
                {c.pausedReason === 'one-focus' && c.state === 'paused' && <p className="filter-hint">Paused when another focus became active — resume it any time.</p>}
                {c.rehearsalNote && <p className="filter-hint">Rehearsal note: {c.rehearsalNote}</p>}
                <p className="filter-hint">
                  {attempts.length} attempt{attempts.length === 1 ? '' : 's'} · {feedback.length} feedback record{feedback.length === 1 ? '' : 's'}
                </p>
                {attempts.length > 0 && (
                  <ul className="workspace-list" aria-label={`Attempts: ${c.focus}`}>
                    {attempts.map((l) => (
                      <li key={l.id}>
                        <button type="button" className="workspace-row" onClick={() => onOpenLesson(l.id)}>
                          <span>{fmt(l.dateISO)} · {l.subject || 'Lesson'}{l.attempt && l.attempt > 1 ? ` · attempt ${l.attempt}` : ''}</span>
                          <span className="tag">{l.stage ?? 'plan'}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {feedback.slice(0, 3).map((o) => (
                  <p key={o.id} className="filter-hint"><span className="tag">{provenanceLabel(o.sourceType)}</span> {o.development || o.strengths}</p>
                ))}
                {c.state !== 'archived' && (
                  <div className="task-edit-row">
                    <Field label="Review decision">
                      <select className="date-input" aria-label={`Review decision: ${c.focus}`} value={c.reviewDecision ?? ''} onChange={(e) => setCycle(c.id, { reviewDecision: (e.target.value || undefined) as PracticeCycleRec['reviewDecision'] })}>
                        <option value="">Not decided yet</option>
                        {Object.entries(DECISION_LABEL).map(([v, l]) => (
                          <option key={v} value={v}>{l}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Note"><input type="text" className="placement-input" value={c.reviewNote ?? ''} onChange={(e) => setCycle(c.id, { reviewNote: e.target.value })} /></Field>
                  </div>
                )}
                <div className="btn-row">
                  {c.state !== 'active' && <button type="button" className="btn-today-reset" onClick={() => onUpdateAdmin((prev) => ({ ...prev, cycles: activateCycle(prev.cycles, c.id, Date.now()) }))}>{c.state === 'paused' ? 'Resume' : 'Reopen'}</button>}
                  {c.state === 'active' && <button type="button" className="btn-today-reset" onClick={() => setCycle(c.id, { state: 'paused', pausedReason: undefined })}>Pause</button>}
                  {c.state !== 'archived' && <button type="button" className="btn-today-reset" onClick={() => setCycle(c.id, { state: 'archived' })}>Archive</button>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Dialog>
  )
}

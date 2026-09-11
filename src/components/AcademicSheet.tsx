import { useState } from 'react'
import { Dialog, Field, IconClose } from './ui'
import { newAdminId } from '../lib/admin'
import type { AcademicProjectRec, AdminFile, ProjectStatus, ReadingNoteRec } from '../lib/admin'
import { sessionKey } from '../lib/diff'
import type { Session } from '../types'

interface Props {
  admin: AdminFile
  /** key dates from the timetable (deadlines are references to these, never copies) */
  keyDates: Session[]
  todayISO: string
  onUpdateAdmin: (updater: (prev: AdminFile) => AdminFile) => void
  onClose: () => void
}

const STATUS_LABEL: Record<ProjectStatus, string> = { draft: 'Draft', ready: 'Ready', submitted: 'Submitted (you confirmed)', feedback: 'Feedback received', result: 'Result recorded' }
const fmt = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * Academic workspace (PG-05, G2): each assignment or enquiry as a project —
 * brief, provider criteria, a deadline that REFERENCES an existing key date,
 * optional words/credits (no award arithmetic), milestones as ordinary tasks,
 * reading notes that separate quotation, paraphrase and interpretation with
 * their source and page, and an approval-planning section for classroom
 * enquiry (recorded, not an approval workflow). Status moves draft → ready →
 * submitted → feedback → result only on the learner's confirmation; a result
 * is a label with its source, never an award.
 */
export function AcademicSheet({ admin, keyDates, todayISO, onUpdateAdmin, onClose }: Props) {
  const [title, setTitle] = useState('')
  const [deadlineRef, setDeadlineRef] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(admin.projects.find((p) => p.status !== 'result')?.id ?? admin.projects[0]?.id ?? null)
  const [confirmSubmit, setConfirmSubmit] = useState(false)
  const [outcome, setOutcome] = useState({ text: '', source: '' })
  const [note, setNote] = useState<{ kind: ReadingNoteRec['kind']; source: string; page: string; text: string }>({ kind: 'paraphrase', source: '', page: '', text: '' })
  const [milestone, setMilestone] = useState({ title: '', dueISO: '' })
  const project = admin.projects.find((p) => p.id === selectedId) ?? null
  const setProject = (id: string, patch: Partial<AcademicProjectRec>) => onUpdateAdmin((prev) => ({ ...prev, projects: prev.projects.map((p) => (p.id === id ? { ...p, ...patch, at: Date.now() } : p)) }))
  const deadlines = keyDates.filter((k) => k.isKeyDate && !k.id.startsWith('custom-'))
  const deadlineOf = (p: AcademicProjectRec) => (p.deadlineRef ? deadlines.find((k) => sessionKey(k) === p.deadlineRef) ?? null : null)

  return (
    <Dialog label="Academic work" onClose={onClose} className="sheet-academic">
      <div className="sheet-header">
        <h2>Academic work</h2>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><IconClose /></button>
      </div>
      <Field label="New project">
        <input type="text" className="placement-input" aria-label="Project title" placeholder="e.g. Assignment 1 — Reflective account" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="task-edit-row">
          <select className="date-input" aria-label="Deadline (key date)" value={deadlineRef} onChange={(e) => setDeadlineRef(e.target.value)}>
            <option value="">Deadline: none linked</option>
            {deadlines.map((k) => (
              <option key={sessionKey(k)} value={sessionKey(k)}>{fmt(k.dateISO)} · {k.title}</option>
            ))}
          </select>
          <button
            type="button"
            className="btn-primary"
            disabled={!title.trim()}
            onClick={() => {
              const rec: AcademicProjectRec = { id: newAdminId(), title: title.trim(), status: 'draft', at: Date.now() }
              if (deadlineRef) rec.deadlineRef = deadlineRef
              onUpdateAdmin((prev) => ({ ...prev, projects: [...prev.projects, rec] }))
              setSelectedId(rec.id)
              setTitle('')
              setDeadlineRef('')
            }}
          >
            Add project
          </button>
        </div>
      </Field>
      {admin.projects.length > 0 && (
        <ul className="workspace-list" aria-label="Projects">
          {admin.projects.map((p) => {
            const d = deadlineOf(p)
            return (
              <li key={p.id}>
                <button type="button" className="workspace-row" aria-current={p.id === selectedId ? 'true' : undefined} onClick={() => setSelectedId(p.id)}>
                  <span>{p.title}{d ? <span className="filter-hint"> · due {fmt(d.dateISO)}</span> : p.deadlineRef ? <span className="filter-hint"> · deadline reference no longer in the timetable</span> : null}</span>
                  <span className="tag">{STATUS_LABEL[p.status]}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {project && (
        <section className="prep-editor" aria-label={`Project: ${project.title}`}>
          <h3 className="subheading">{project.title} · {STATUS_LABEL[project.status]}</h3>
          {(() => {
            const d = deadlineOf(project)
            return d ? <p className="filter-hint">Deadline: {fmt(d.dateISO)}{d.start ? ` ${d.start}` : ''} · {d.title} (from your key dates)</p> : <p className="filter-hint">No deadline linked. Deadlines come from your key dates, never typed here.</p>
          })()}
          <Field label="Brief"><textarea className="placement-input" rows={2} value={project.brief ?? ''} onChange={(e) => setProject(project.id, { brief: e.target.value })} /></Field>
          <Field label="Provider criteria"><textarea className="placement-input" rows={2} value={project.criteria ?? ''} onChange={(e) => setProject(project.id, { criteria: e.target.value })} /></Field>
          <div className="task-edit-row">
            <Field label="Words (optional)"><input type="number" className="date-input" min={0} aria-label="Words" value={project.words ?? ''} onChange={(e) => setProject(project.id, { words: e.target.value === '' ? undefined : Math.max(0, parseInt(e.target.value, 10) || 0) })} /></Field>
            <Field label="Credits (optional)"><input type="number" className="date-input" min={0} aria-label="Credits" value={project.credits ?? ''} onChange={(e) => setProject(project.id, { credits: e.target.value === '' ? undefined : Math.max(0, parseInt(e.target.value, 10) || 0) })} /></Field>
          </div>

          <h3 className="subheading">Status</h3>
          <div className="btn-row">
            {project.status === 'draft' && <button type="button" className="btn-primary" onClick={() => setProject(project.id, { status: 'ready' })}>Ready to submit</button>}
            {project.status === 'ready' && (
              <>
                <label className="toggle-row"><input type="checkbox" checked={confirmSubmit} onChange={(e) => setConfirmSubmit(e.target.checked)} /> I submitted this myself</label>
                <button type="button" className="btn-primary" disabled={!confirmSubmit} onClick={() => { setProject(project.id, { status: 'submitted', submittedISO: todayISO }); setConfirmSubmit(false) }}>Mark submitted</button>
                <button type="button" className="btn-today-reset" onClick={() => setProject(project.id, { status: 'draft' })}>Back to draft</button>
              </>
            )}
            {(project.status === 'submitted' || project.status === 'feedback') && (
              <Field label={project.status === 'submitted' ? 'Feedback received (text and who it came from)' : 'Result (as written by its source — a label, not an award)'}>
                <textarea className="placement-input" rows={2} aria-label={project.status === 'submitted' ? 'Feedback text' : 'Result text'} value={outcome.text} onChange={(e) => setOutcome({ ...outcome, text: e.target.value })} />
                <input type="text" className="placement-input" aria-label="Source" placeholder="Source (e.g. tutor email, 12 Jan)" value={outcome.source} onChange={(e) => setOutcome({ ...outcome, source: e.target.value })} />
                <div className="btn-row">
                  <button type="button" className="btn-primary" disabled={!outcome.text.trim() || !outcome.source.trim()} onClick={() => { setProject(project.id, project.status === 'submitted' ? { status: 'feedback', feedback: { text: outcome.text.trim(), source: outcome.source.trim() } } : { status: 'result', result: { text: outcome.text.trim(), source: outcome.source.trim() } }); setOutcome({ text: '', source: '' }) }}>
                    {project.status === 'submitted' ? 'Record feedback' : 'Record result'}
                  </button>
                </div>
              </Field>
            )}
          </div>
          {project.submittedISO && <p className="filter-hint">Submitted {fmt(project.submittedISO)} — recorded on your confirmation.</p>}
          {project.feedback && <p className="filter-hint"><strong>Feedback</strong> ({project.feedback.source}): {project.feedback.text}</p>}
          {project.result && <p className="filter-hint"><strong>Result</strong> ({project.result.source}): {project.result.text} — recorded by you from that source; nothing here awards anything.</p>}

          <h3 className="subheading">Milestones (tasks)</h3>
          {(() => {
            const mine = admin.tasks.filter((t) => t.projectId === project.id).sort((a, b) => a.dueISO.localeCompare(b.dueISO))
            return mine.length === 0 ? <p className="filter-hint">No milestones yet — they are ordinary tasks and appear on Tasks and in the workload planner.</p> : (
              <ul className="workspace-list" aria-label="Milestones">
                {mine.map((t) => (
                  <li key={t.id} className="workspace-row"><span>{fmt(t.dueISO)} · {t.title}</span><span className="tag">{t.status}</span></li>
                ))}
              </ul>
            )
          })()}
          <div className="task-edit-row">
            <input type="text" className="placement-input" aria-label="Milestone title" placeholder="Milestone" value={milestone.title} onChange={(e) => setMilestone({ ...milestone, title: e.target.value })} />
            <input type="date" className="date-input" aria-label="Milestone due" value={milestone.dueISO} onChange={(e) => setMilestone({ ...milestone, dueISO: e.target.value })} />
            <button type="button" className="btn-today-reset" disabled={!milestone.title.trim() || !milestone.dueISO} onClick={() => { onUpdateAdmin((prev) => ({ ...prev, tasks: [...prev.tasks, { id: newAdminId(), title: milestone.title.trim(), dueISO: milestone.dueISO, status: 'todo', projectId: project.id, at: Date.now() }] })); setMilestone({ title: '', dueISO: '' }) }}>Add milestone</button>
          </div>

          <h3 className="subheading">Reading notes</h3>
          {(() => {
            const notes = admin.readings.filter((n) => n.projectId === project.id).sort((a, b) => b.at - a.at)
            return notes.length === 0 ? <p className="filter-hint">No reading notes yet. Keep quotations, paraphrases and your interpretations apart, each with its source.</p> : (
              <ul className="workspace-list" aria-label="Reading notes">
                {notes.map((n) => (
                  <li key={n.id} className="workspace-row">
                    <span><span className="tag">{n.kind}</span> {n.kind === 'quotation' ? `“${n.text}”` : n.text}<span className="filter-hint"> — {n.source || 'source not given'}{n.page ? `, p.${n.page}` : ''}</span></span>
                    <button type="button" className="travel-link" onClick={() => onUpdateAdmin((prev) => ({ ...prev, readings: prev.readings.filter((x) => x.id !== n.id) }))}>Remove</button>
                  </li>
                ))}
              </ul>
            )
          })()}
          <div className="task-edit-row">
            <select className="date-input" aria-label="Note kind" value={note.kind} onChange={(e) => setNote({ ...note, kind: e.target.value as ReadingNoteRec['kind'] })}>
              <option value="quotation">Quotation</option>
              <option value="paraphrase">Paraphrase</option>
              <option value="interpretation">My interpretation</option>
            </select>
            <input type="text" className="placement-input" aria-label="Note source" placeholder="Source" value={note.source} onChange={(e) => setNote({ ...note, source: e.target.value })} />
            <input type="text" className="placement-input" aria-label="Page" placeholder="Page" value={note.page} onChange={(e) => setNote({ ...note, page: e.target.value })} />
          </div>
          <textarea className="placement-input" rows={2} aria-label="Note text" placeholder="Text" value={note.text} onChange={(e) => setNote({ ...note, text: e.target.value })} />
          <div className="btn-row">
            <button type="button" className="btn-today-reset" disabled={!note.text.trim()} onClick={() => { const rec: ReadingNoteRec = { id: newAdminId(), projectId: project.id, kind: note.kind, text: note.text.trim(), at: Date.now() }; if (note.source.trim()) rec.source = note.source.trim(); if (note.page.trim()) rec.page = note.page.trim(); onUpdateAdmin((prev) => ({ ...prev, readings: [...prev.readings, rec] })); setNote({ ...note, text: '', page: '' }) }}>Add note</button>
          </div>

          <h3 className="subheading">Classroom enquiry — approval planning (recorded, not an approval)</h3>
          {(['context', 'participants', 'consent', 'risks', 'approval'] as const).map((k) => (
            <Field key={k} label={k === 'approval' ? 'Approval status as told to you (and by whom)' : k[0].toUpperCase() + k.slice(1)}>
              <textarea className="placement-input" rows={2} value={project.enquiry?.[k] ?? ''} onChange={(e) => setProject(project.id, { enquiry: { ...(project.enquiry ?? {}), [k]: e.target.value } })} />
            </Field>
          ))}
        </section>
      )}
    </Dialog>
  )
}

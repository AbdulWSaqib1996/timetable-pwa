import { useMemo, useState } from 'react'
import { Dialog, Field, IconClose } from './ui'
import { formatMins, planWorkload } from '../../shared/workload.js'
import type { WorkloadProposal } from '../../shared/workload.js'
import type { PlanBusyInterval } from '../../shared/planWeek.js'
import { newAdminId } from '../lib/admin'
import type { AdminFile, ContactRec, CourseQuestionRec, ProtectedWindowRec } from '../lib/admin'
import type { Settings } from '../types'

interface Props {
  admin: AdminFile
  busy: PlanBusyInterval[]
  deadlines: { d: string; title: string }[]
  settings: Settings
  todayISO: string
  /** ids of the blocks added by the last accepted batch (undo target), if any */
  lastBatch: string[] | null
  onUpdateAdmin: (updater: (prev: AdminFile) => AdminFile) => void
  onAccept: (proposals: WorkloadProposal[]) => void
  onUndo: () => void
  onClose: () => void
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const fmt = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

/**
 * Workload and support (PG-08, G2). A deterministic needed-vs-available
 * reckoning over the next fortnight from the existing plan model, honouring
 * timetabled sessions with travel buffers, personal commitments, existing
 * blocks, quiet hours and the learner's protected windows. It reports the gap
 * plainly ("2 h unallocated") and proposes blocks as a diff that the learner
 * accepts or leaves; accepted blocks are ordinary plan blocks and the last
 * batch can be undone. Missing estimates are unknown, never guessed. Support
 * is what the learner writes: contacts, a private agenda, unanswered course
 * questions — no wellbeing score, no streaks, nothing sent to anyone.
 */
export function WorkloadSheet({ admin, busy, deadlines, settings, todayISO, lastBatch, onUpdateAdmin, onAccept, onUndo, onClose }: Props) {
  const [tab, setTab] = useState<'plan' | 'protected' | 'support'>('plan')
  const [win, setWin] = useState({ day: '1', start: '18:00', end: '20:00', label: '' })
  const [contact, setContact] = useState({ name: '', role: '', contact: '' })
  const [question, setQuestion] = useState({ text: '', askedTo: '' })
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const result = useMemo(
    () =>
      planWorkload({
        todayISO,
        busy,
        deadlines,
        protectedWindows: admin.protected,
        tasks: admin.tasks,
        plans: admin.plans,
        options: { start: settings.planRangeStart, end: settings.planRangeEnd, quietFrom: settings.quietFrom, quietTo: settings.quietTo },
      }),
    [todayISO, busy, deadlines, admin.protected, admin.tasks, admin.plans, settings.planRangeStart, settings.planRangeEnd, settings.quietFrom, settings.quietTo]
  )
  const agenda = admin.supportNotes.find((n) => n.id === 'agenda')
  const setAgenda = (text: string) => onUpdateAdmin((prev) => ({ ...prev, supportNotes: prev.supportNotes.some((n) => n.id === 'agenda') ? prev.supportNotes.map((n) => (n.id === 'agenda' ? { ...n, text, at: Date.now() } : n)) : [...prev.supportNotes, { id: 'agenda', text, at: Date.now() }] }))

  return (
    <Dialog label="Workload & support" onClose={onClose} className="sheet-workload">
      <div className="sheet-header">
        <h2>Workload &amp; support</h2>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><IconClose /></button>
      </div>
      <div className="segmented" role="tablist" aria-label="Workload sections">
        {([['plan', 'Next two weeks'], ['protected', `Protected time (${admin.protected.length})`], ['support', 'Support']] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`segment${tab === id ? ' segment-on' : ''}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {tab === 'plan' && (
        <div className="workload-plan">
          <dl className="kv workload-summary" aria-label="Workload summary">
            <div><dt>Needed</dt><dd>{formatMins(result.needed)} across {admin.tasks.filter((t) => t.status !== 'done').length} open task{admin.tasks.filter((t) => t.status !== 'done').length === 1 ? '' : 's'} (estimates you entered)</dd></div>
            <div><dt>Already planned</dt><dd>{formatMins(result.alreadyScheduled)} in blocks on the calendar</dd></div>
            <div><dt>Available</dt><dd>{formatMins(result.available)} free in {result.slots} gap{result.slots === 1 ? '' : 's'} to {fmt(result.endISO)}</dd></div>
            <div><dt>Proposed</dt><dd>{formatMins(result.proposedMins)}</dd></div>
            <div><dt className={result.unallocated > 0 ? 'tag--amber' : ''}>Gap</dt><dd>{result.unallocated > 0 ? `${formatMins(result.unallocated)} unallocated — not enough free time before the due dates` : 'Nothing unallocated'}</dd></div>
          </dl>
          {result.unknown.length > 0 && (
            <p className="filter-hint">No estimate, so unknown (not counted): {result.unknown.map((u) => u.title).join(' · ')}. Add subtasks with effort on the task to include them.</p>
          )}
          {result.late.length > 0 && <p className="filter-hint">Due date already passed (still open): {result.late.map((l) => `${l.title} (${fmt(l.dueISO)})`).join(' · ')}.</p>}
          {result.protectedMins > 0 && <p className="filter-hint">{formatMins(result.protectedMins)} of protected time kept free.</p>}
          {result.proposals.length === 0 ? (
            <p className="filter-hint">Nothing to propose{result.needed === 0 ? ' — no remaining estimated effort' : ''}.</p>
          ) : (
            <>
              <ul className="workspace-list" aria-label="Proposed blocks">
                {result.proposals.map((p, i) => (
                  <li key={i} className="workspace-row proposal-row"><span><span className="tag tag--teal">+ new</span> {fmt(p.dateISO)} {p.startTime}–{p.endTime}</span><span>{p.title}</span></li>
                ))}
              </ul>
              <p className="filter-hint">These are suggestions. Accepting adds them as ordinary blocks under each task — edit or delete them like any block, or undo the whole batch.</p>
            </>
          )}
          <div className="btn-row">
            <button type="button" className="btn-primary" disabled={result.proposals.length === 0} onClick={() => onAccept(result.proposals)}>Accept {result.proposals.length} proposal{result.proposals.length === 1 ? '' : 's'}</button>
            {lastBatch && lastBatch.length > 0 && <button type="button" className="btn-today-reset" onClick={onUndo}>Undo last accept ({lastBatch.length})</button>}
          </div>
        </div>
      )}

      {tab === 'protected' && (
        <div className="workload-protected">
          <p className="filter-hint">Weekly windows the planner never fills — family, rest, faith, anything. The week planner avoids them too.</p>
          {admin.protected.length > 0 && (
            <ul className="workspace-list" aria-label="Protected windows">
              {admin.protected.map((w) => (
                <li key={w.id} className="workspace-row"><span>{DAYS[w.day]} {w.start}–{w.end}{w.label ? ` · ${w.label}` : ''}</span><button type="button" className="travel-link" onClick={() => onUpdateAdmin((prev) => ({ ...prev, protected: prev.protected.filter((x) => x.id !== w.id) }))}>Remove</button></li>
              ))}
            </ul>
          )}
          <div className="task-edit-row">
            <select className="date-input" aria-label="Weekday" value={win.day} onChange={(e) => setWin({ ...win, day: e.target.value })}>
              {DAYS.map((d, i) => (
                <option key={d} value={i}>{d}</option>
              ))}
            </select>
            <input type="time" className="date-input" aria-label="Protected from" value={win.start} onChange={(e) => setWin({ ...win, start: e.target.value })} />
            <input type="time" className="date-input" aria-label="Protected until" value={win.end} onChange={(e) => setWin({ ...win, end: e.target.value })} />
            <input type="text" className="placement-input" aria-label="Protected label" placeholder="Label" value={win.label} onChange={(e) => setWin({ ...win, label: e.target.value })} />
          </div>
          <div className="btn-row">
            <button type="button" className="btn-primary" disabled={!win.start || !win.end || win.end <= win.start} onClick={() => { const rec: ProtectedWindowRec = { id: newAdminId(), day: Number(win.day), start: win.start, end: win.end, at: Date.now() }; if (win.label.trim()) rec.label = win.label.trim(); onUpdateAdmin((prev) => ({ ...prev, protected: [...prev.protected, rec] })); setWin({ ...win, label: '' }) }}>Add protected time</button>
          </div>
        </div>
      )}

      {tab === 'support' && (
        <div className="workload-support">
          <p className="filter-hint">Yours only: nothing here is rated, tracked or sent to anyone.</p>
          <h3 className="subheading">People who can help</h3>
          {admin.contacts.length > 0 && (
            <ul className="workspace-list" aria-label="Contacts">
              {admin.contacts.map((c) => (
                <li key={c.id} className="workspace-row"><span><strong>{c.name}</strong>{c.role ? ` · ${c.role}` : ''}{c.contact ? <span className="filter-hint"> · {c.contact}</span> : null}</span><button type="button" className="travel-link" onClick={() => onUpdateAdmin((prev) => ({ ...prev, contacts: prev.contacts.filter((x) => x.id !== c.id) }))}>Remove</button></li>
              ))}
            </ul>
          )}
          <div className="task-edit-row">
            <input type="text" className="placement-input" aria-label="Contact name" placeholder="Name" value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} />
            <input type="text" className="placement-input" aria-label="Contact role" placeholder="Role (mentor, tutor, wellbeing…)" value={contact.role} onChange={(e) => setContact({ ...contact, role: e.target.value })} />
            <input type="text" className="placement-input" aria-label="Contact details" placeholder="How to reach them" value={contact.contact} onChange={(e) => setContact({ ...contact, contact: e.target.value })} />
            <button type="button" className="btn-today-reset" disabled={!contact.name.trim()} onClick={() => { const rec: ContactRec = { id: newAdminId(), name: contact.name.trim(), at: Date.now() }; if (contact.role.trim()) rec.role = contact.role.trim(); if (contact.contact.trim()) rec.contact = contact.contact.trim(); onUpdateAdmin((prev) => ({ ...prev, contacts: [...prev.contacts, rec] })); setContact({ name: '', role: '', contact: '' }) }}>Add</button>
          </div>
          <Field label="Private agenda for a support conversation" hint="What you want to raise, in your words. Stays on your devices.">
            <textarea className="placement-input" rows={3} aria-label="Support agenda" value={agenda?.text ?? ''} onChange={(e) => setAgenda(e.target.value)} />
          </Field>
          <h3 className="subheading">Course questions you still need answered</h3>
          {admin.questions.length > 0 && (
            <ul className="workspace-list" aria-label="Course questions">
              {admin.questions.map((q) => (
                <li key={q.id} className="workspace-row requirement-row">
                  <span>{q.answered ? <span className="tag">Answered</span> : <span className="tag tag--amber">Open</span>} {q.text}{q.askedTo ? <span className="filter-hint"> · asked {q.askedTo}</span> : null}{q.answer ? <span className="filter-hint"> — {q.answer}</span> : null}</span>
                  {!q.answered && (
                    <span className="requirement-confirm">
                      <input type="text" className="placement-input" aria-label={`Answer: ${q.text}`} placeholder="Answer you got" value={answers[q.id] ?? ''} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} />
                      <button type="button" className="travel-link" onClick={() => onUpdateAdmin((prev) => ({ ...prev, questions: prev.questions.map((x) => (x.id === q.id ? { ...x, answered: true, ...(answers[q.id]?.trim() ? { answer: answers[q.id].trim() } : {}), at: Date.now() } : x)) }))}>Mark answered</button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="task-edit-row">
            <input type="text" className="placement-input" aria-label="Question" placeholder="Question" value={question.text} onChange={(e) => setQuestion({ ...question, text: e.target.value })} />
            <input type="text" className="placement-input" aria-label="Asked to" placeholder="Who you asked (optional)" value={question.askedTo} onChange={(e) => setQuestion({ ...question, askedTo: e.target.value })} />
            <button type="button" className="btn-today-reset" disabled={!question.text.trim()} onClick={() => { const rec: CourseQuestionRec = { id: newAdminId(), text: question.text.trim(), answered: false, at: Date.now() }; if (question.askedTo.trim()) rec.askedTo = question.askedTo.trim(); onUpdateAdmin((prev) => ({ ...prev, questions: [...prev.questions, rec] })); setQuestion({ text: '', askedTo: '' }) }}>Add question</button>
          </div>
        </div>
      )}
    </Dialog>
  )
}

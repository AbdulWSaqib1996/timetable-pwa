import { useMemo, useState } from 'react'
import { Dialog, Field, IconClose, tabKeys } from './ui'
import { formatMins, planWorkload } from '../../shared/workload.js'
import { applyChanges, basisHash, nextWeekFixed, reviewWeeks, thisWeekSummary, undoBatch, weeklyReview } from '../../shared/weeklyReview.js'
import { isPlacementTitle } from '../../shared/eligibility.js'
import type { WorkloadProposal } from '../../shared/workload.js'
import type { PlanBusyInterval } from '../../shared/planWeek.js'
import { newAdminId } from '../lib/admin'
import type { AdminFile, ContactRec, CourseQuestionRec, ProtectedWindowRec, WeeklyReviewRec } from '../lib/admin'
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
  const [tab, setTab] = useState<'plan' | 'review' | 'protected' | 'support'>('plan')
  const [selected, setSelected] = useState<string[] | null>(null)
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
  // E02 weekly review: this week, next week's fixed time and free slots, and the diff of proposals against existing blocks.
  const weeks = reviewWeeks(todayISO)
  const review = (admin.weeklyReviews ?? []).find((r) => r.weekISO === weeks.fromISO) ?? null
  const planOptions = { start: settings.planRangeStart, end: settings.planRangeEnd, quietFrom: settings.quietFrom, quietTo: settings.quietTo }
  const thisWeek = useMemo(() => thisWeekSummary({ todayISO, tasks: admin.tasks, plans: admin.plans }), [todayISO, admin.tasks, admin.plans])
  const fixed = useMemo(
    () => nextWeekFixed({ todayISO, busy, protectedWindows: admin.protected, options: planOptions, travel: { bufferMins: settings.arrivalBufferMins ?? 10, isPlacement: isPlacementTitle } }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [todayISO, busy, admin.protected, settings.planRangeStart, settings.planRangeEnd, settings.quietFrom, settings.quietTo, settings.arrivalBufferMins]
  )
  const nextWeek = useMemo(
    () => weeklyReview({ todayISO, busy, protectedWindows: admin.protected, deadlines, tasks: admin.tasks, plans: admin.plans, options: planOptions }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [todayISO, busy, admin.protected, deadlines, admin.tasks, admin.plans, settings.planRangeStart, settings.planRangeEnd, settings.quietFrom, settings.quietTo]
  )
  const diff = nextWeek
  const currentBasis = basisHash(busy)
  const basisChanged = !!review?.basisHash && review.basisHash !== currentBasis
  const chosenKeys = selected ?? diff.actionable.map((c) => c.key)
  const lastReviewBatch = review?.batches[review.batches.length - 1] ?? null
  const upsertReview = (prev: AdminFile, fn: (r: WeeklyReviewRec) => WeeklyReviewRec): AdminFile => {
    const list = prev.weeklyReviews ?? []
    const current = list.find((r) => r.weekISO === weeks.fromISO) ?? { id: newAdminId(), weekISO: weeks.fromISO, proposalRevision: 1, batches: [], at: Date.now() }
    const next = fn(current)
    return { ...prev, weeklyReviews: list.some((r) => r.id === current.id) ? list.map((r) => (r.id === current.id ? next : r)) : [...list, next] }
  }
  const acceptChanges = () => {
    const now = Date.now()
    const { batch, added, removedIds } = applyChanges({ changes: diff.changes, selectedKeys: chosenKeys, makeId: newAdminId, now })
    if (added.length === 0) return
    // The same selection accepted twice is a no-op: the diff already shows it as untouched, and the hash guards the edge.
    if (lastReviewBatch && lastReviewBatch.changesHash === batch.changesHash && lastReviewBatch.addedIds.every((id) => admin.plans.some((p) => p.id === id))) return
    const drop = new Set(removedIds)
    onUpdateAdmin((prev) => upsertReview({ ...prev, plans: [...prev.plans.filter((p) => !drop.has(p.id)), ...added] }, (r) => ({ ...r, batches: [...r.batches, batch], basisHash: currentBasis, proposalRevision: r.proposalRevision + 1, at: now })))
    setSelected(null)
  }
  const undoLast = () => {
    if (!lastReviewBatch) return
    onUpdateAdmin((prev) => upsertReview({ ...prev, plans: undoBatch(prev.plans, lastReviewBatch) }, (r) => ({ ...r, batches: r.batches.filter((b) => b.id !== lastReviewBatch.id), at: Date.now() })))
  }
  const setReflection = (reflection: string) => onUpdateAdmin((prev) => upsertReview(prev, (r) => ({ ...r, reflection, at: Date.now() })))
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  const agenda = admin.supportNotes.find((n) => n.id === 'agenda')
  const setAgenda = (text: string) => onUpdateAdmin((prev) => ({ ...prev, supportNotes: prev.supportNotes.some((n) => n.id === 'agenda') ? prev.supportNotes.map((n) => (n.id === 'agenda' ? { ...n, text, at: Date.now() } : n)) : [...prev.supportNotes, { id: 'agenda', text, at: Date.now() }] }))

  return (
    <Dialog label="Workload & support" onClose={onClose} className="sheet-workload">
      <div className="sheet-header">
        <h2>Workload &amp; support</h2>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><IconClose /></button>
      </div>
      <div className="segmented" role="tablist" aria-label="Workload sections">
        {([['plan', 'Next two weeks'], ['review', 'Weekly review'], ['protected', `Protected time (${admin.protected.length})`], ['support', 'Support']] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} className={`segment${tab === id ? ' segment-on' : ''}`} onClick={() => setTab(id)} onKeyDown={tabKeys(['plan', 'review', 'protected', 'support'] as const, tab, setTab)}>{label}</button>
        ))}
      </div>

      {tab === 'review' && (
        <div className="workload-review">
          <h3 className="subheading">This week · {fmt(weeks.fromISO)} – {fmt(weeks.toISO)}</h3>
          <dl className="kv workload-summary" aria-label="This week">
            <div><dt>Planned</dt><dd>{formatMins(thisWeek.plannedMins)} in {thisWeek.blocks.length} block{thisWeek.blocks.length === 1 ? '' : 's'}</dd></div>
            <div><dt>Logged</dt><dd>{formatMins(thisWeek.loggedMins)} ticked done</dd></div>
            <div><dt>Still open</dt><dd>{thisWeek.openCount} task{thisWeek.openCount === 1 ? '' : 's'}{thisWeek.openTasks.some((t) => t.remaining === null) ? ' · effort unknown for some (not guessed)' : ''}</dd></div>
          </dl>
          {thisWeek.openTasks.length > 0 && (
            <ul className="workspace-list" aria-label="Open tasks">
              {thisWeek.openTasks.map((t) => (
                <li key={t.id} className="workspace-row"><span>{t.title}{t.dueISO ? <span className="filter-hint"> · due {fmt(t.dueISO)}</span> : null}</span><span className={`tag${t.overdue ? ' tag--amber' : ''}`}>{t.remaining === null ? 'effort unknown' : `${formatMins(t.remaining)} left`}</span></li>
              ))}
            </ul>
          )}
          <Field label="Your reflection on the week" hint="Yours only — never scored, never sent.">
            <textarea className="placement-input" rows={2} aria-label="Weekly reflection" defaultValue={review?.reflection ?? ''} onBlur={(e) => { if (e.target.value !== (review?.reflection ?? '')) setReflection(e.target.value) }} />
          </Field>

          <h3 className="subheading">Next week · {fmt(weeks.nextFromISO)} – {fmt(weeks.nextToISO)}</h3>
          <dl className="kv workload-summary" aria-label="Next week">
            <div><dt>Fixed</dt><dd>{formatMins(fixed.days.reduce((n, d) => n + d.fixedMins, 0))} of sessions, placement travel, commitments and protected time</dd></div>
            <div><dt>Free</dt><dd>{formatMins(fixed.freeMins)} in {fixed.free.length} slot{fixed.free.length === 1 ? '' : 's'}</dd></div>
            <div><dt>Proposed</dt><dd>{formatMins(nextWeek.proposals.reduce((n, p) => n + p.effortMins, 0))}{nextWeek.unallocated > 0 ? ` · ${formatMins(nextWeek.unallocated)} still unallocated` : ''}</dd></div>
          </dl>
          <ul className="workspace-list" aria-label="Fixed commitments next week">
            {fixed.days.map((day) => (
              <li key={day.d} className="workspace-row review-day">
                <span><strong>{fmt(day.d)}</strong></span>
                <span className="filter-hint">{day.fixed.length ? day.fixed.map((f) => `${hhmm(f.from)}–${hhmm(f.to)} ${f.label}`).join(' · ') : 'nothing fixed'}</span>
              </li>
            ))}
          </ul>
          {basisChanged && <p className="filter-hint" role="status">Your timetable or commitments changed since you last accepted proposals — they were recalculated; this is the new diff.</p>}
          {nextWeek.unknown.length > 0 && <p className="filter-hint">Effort unknown, so not planned: {nextWeek.unknown.map((u) => u.title).join(' · ')}.</p>}
          <h4 className="subheading">Changes to next week's study blocks</h4>
          {diff.changes.length === 0 ? (
            <p className="filter-hint">Nothing to change — no remaining estimated effort lands next week.</p>
          ) : (
            <ul className="workspace-list" aria-label="Proposed changes">
              {diff.changes.map((c) => (
                <li key={c.key} className="workspace-row proposal-row" data-kind={c.kind}>
                  {c.kind === 'added' || c.kind === 'moved' ? (
                    <label className="cycle-obs">
                      <input type="checkbox" checked={chosenKeys.includes(c.key)} onChange={(e) => setSelected(e.target.checked ? [...chosenKeys, c.key] : chosenKeys.filter((k) => k !== c.key))} aria-label={`${c.kind === 'added' ? 'Add' : 'Move'}: ${c.proposal!.title} ${fmt(c.proposal!.dateISO)} ${c.proposal!.startTime}`} />
                      <span>
                        <span className={`tag ${c.kind === 'added' ? 'tag--teal' : 'tag--amber'}`}>{c.kind === 'added' ? '+ added' : '→ moved'}</span> {c.kind === 'moved' ? `${fmt(c.block!.dateISO)} ${c.block!.startTime} → ` : ''}{fmt(c.proposal!.dateISO)} {c.proposal!.startTime}–{c.proposal!.endTime} · {c.proposal!.title}
                      </span>
                    </label>
                  ) : (
                    <span><span className={`tag${c.kind === 'clash' ? ' tag--amber' : ''}`}>{c.kind === 'clash' ? 'clashes — no free slot found' : 'untouched'}</span> {fmt(c.block!.dateISO)} {c.block!.startTime}–{c.block!.endTime} · {c.block!.title}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="btn-row">
            <button type="button" className="btn-primary" disabled={chosenKeys.filter((k) => diff.actionable.some((c) => c.key === k)).length === 0} onClick={acceptChanges}>
              Accept {chosenKeys.filter((k) => diff.actionable.some((c) => c.key === k)).length} of {diff.actionable.length} change{diff.actionable.length === 1 ? '' : 's'}
            </button>
            {lastReviewBatch && <button type="button" className="btn-today-reset" onClick={undoLast}>Undo last accepted batch ({lastReviewBatch.addedIds.length})</button>}
          </div>
          <p className="filter-hint">Existing blocks are untouched unless a session or commitment now sits on top of one — then a move is offered and only happens if you tick it. Travel is an assumption from your arrival buffer. Nothing here rates you.</p>
        </div>
      )}

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

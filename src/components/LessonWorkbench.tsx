import { useEffect, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Dialog, Field, IconClose } from './ui'
import { LESSON_TEMPLATES, activateCycle, nextAttempt, provenanceLabel, withPlanRevision } from '../../shared/practice.js'
import { newAdminId } from '../lib/admin'
import type { AdminFile, Lesson, LessonStage, Observation, PracticeCycleRec } from '../lib/admin'
import { TEACHERS_STANDARDS } from '../lib/standards'
import { sessionKey } from '../lib/diff'
import type { Session } from '../types'

interface Props {
  lessonId: string
  admin: AdminFile
  /** course sessions, for linking the timetable occurrence on the lesson's date */
  sessions: Session[]
  placementOptions: { value: string; label: string }[]
  todayISO: string
  onUpdateAdmin: (updater: (prev: AdminFile) => AdminFile) => void
  onAddRehearsalBlock: (lesson: Lesson, block: { dateISO: string; startTime: string; endTime: string }) => void
  /** open on a given stage (a Today next step); otherwise the lesson's own stage */
  initialStage?: LessonStage
  onClose: () => void
}

const STAGES: { id: LessonStage; label: string }[] = [
  { id: 'plan', label: 'Plan' },
  { id: 'rehearse', label: 'Rehearse' },
  { id: 'teach', label: 'Teach' },
  { id: 'review', label: 'Review' },
]
type PlanDraft = Pick<Lesson, 'sessionRef' | 'unitRef' | 'intention' | 'priorKnowledge' | 'misconceptions' | 'sequence' | 'checks' | 'plannedResponses' | 'cycleId' | 'placementId' | 'dateISO' | 'subject' | 'classGroup'> & { resourcesText: string }

const draftOf = (l: Lesson): PlanDraft => ({
  dateISO: l.dateISO, subject: l.subject, classGroup: l.classGroup, sessionRef: l.sessionRef, unitRef: l.unitRef, intention: l.intention, priorKnowledge: l.priorKnowledge, misconceptions: l.misconceptions, sequence: l.sequence, checks: l.checks, plannedResponses: l.plannedResponses, cycleId: l.cycleId, placementId: l.placementId, resourcesText: (l.resources ?? []).join('\n'),
})
const fmt = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

/**
 * Lesson workbench (PG-02, G1b): Plan → Rehearse → Teach → Review as four
 * stage views over ONE lesson record. The plan side carries a revision; the
 * review names the revision that was taught, so planning and evaluation stay
 * distinct versions. Teach mode is the essential plan in large type — all
 * local, so it works offline once the app has loaded. Nothing here touches
 * attendance or any assessment. "Next attempt" duplicates the plan under a new
 * identity without copying outcomes. The quick retrospective lesson form in
 * the PGCE file is untouched.
 */
export function LessonWorkbench({ lessonId: initialId, admin, sessions, placementOptions, todayISO, onUpdateAdmin, onAddRehearsalBlock, initialStage, onClose }: Props) {
  const [lessonId, setLessonId] = useState(initialId)
  const lesson = admin.lessons.find((l) => l.id === lessonId)
  const [stage, setStage] = useState<LessonStage>(initialStage ?? lesson?.stage ?? 'plan')
  const [draft, setDraft] = useState<PlanDraft>(() => (lesson ? draftOf(lesson) : ({} as PlanDraft)))
  const [saved, setSaved] = useState<string | null>(null)
  const [evaluation, setEvaluation] = useState(lesson?.evaluation ?? '')
  const [standards, setStandards] = useState<string[]>(lesson?.standards ?? [])
  const [block, setBlock] = useState({ dateISO: lesson?.dateISO ?? todayISO, startTime: '16:00', endTime: '16:30' })
  const [feedback, setFeedback] = useState({ observer: '', focus: '', strengths: '', development: '' })
  const [newFocus, setNewFocus] = useState('')
  useEffect(() => {
    if (lesson) {
      setDraft(draftOf(lesson))
      setEvaluation(lesson.evaluation)
      setStandards(lesson.standards)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId])

  if (!lesson) {
    return (
      <Dialog label="Lesson workbench" onClose={onClose}>
        <div className="sheet-header"><h2>Lesson workbench</h2><button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><IconClose /></button></div>
        <p className="filter-hint">That lesson no longer exists.</p>
      </Dialog>
    )
  }

  const update = (fn: (l: Lesson) => Lesson) => onUpdateAdmin((prev) => ({ ...prev, lessons: prev.lessons.map((l) => (l.id === lesson.id ? fn(l) : l)) }))
  const cycles = admin.cycles.filter((c) => c.state !== 'archived')
  const cycle = admin.cycles.find((c) => c.id === lesson.cycleId)
  const dayOptions = sessions.filter((s) => !s.isKeyDate && s.dateISO === (draft.dateISO || lesson.dateISO))
  const feedbackList = admin.observations.filter((o) => o.lessonId === lesson.id).sort((a, b) => b.at - a.at)
  const planStale = lesson.taughtPlanRevision !== undefined && (lesson.planRevision ?? 0) > lesson.taughtPlanRevision

  const savePlan = () => {
    const now = Date.now()
    const resources = draft.resourcesText.split('\n').map((r) => r.trim()).filter(Boolean)
    update((l) => {
      const next: Lesson = { ...l, dateISO: draft.dateISO || l.dateISO, subject: draft.subject, classGroup: draft.classGroup, resources, stage: l.stage ?? 'plan' }
      for (const k of ['sessionRef', 'unitRef', 'intention', 'priorKnowledge', 'misconceptions', 'sequence', 'checks', 'plannedResponses', 'cycleId', 'placementId'] as const) {
        const v = draft[k]
        if (v) next[k] = v
        else delete next[k]
      }
      if (resources.length === 0) delete next.resources
      return withPlanRevision(l, next, now)
    })
    setSaved('Plan saved')
  }
  const applyTemplate = (id: string) => {
    const t = LESSON_TEMPLATES.find((x) => x.id === id)
    if (!t) return
    setDraft((d) => ({ ...d, sequence: d.sequence || t.sequence, checks: d.checks || t.checks }))
  }
  const createFocus = () => {
    const focus = newFocus.trim()
    if (!focus) return
    const rec: PracticeCycleRec = { id: newAdminId(), focus, state: 'active', at: Date.now() }
    onUpdateAdmin((prev) => ({ ...prev, cycles: activateCycle([...prev.cycles, rec], rec.id, Date.now()) }))
    setDraft((d) => ({ ...d, cycleId: rec.id }))
    setNewFocus('')
  }
  const addFeedback = () => {
    if (!feedback.strengths.trim() && !feedback.development.trim()) return
    const rec: Observation = { id: newAdminId(), dateISO: todayISO, observer: feedback.observer.trim(), subject: lesson.subject, focus: feedback.focus.trim(), strengths: feedback.strengths.trim(), development: feedback.development.trim(), sourceType: 'learner-entered', lessonId: lesson.id, revision: 0, at: Date.now() }
    if (lesson.cycleId) rec.cycleId = lesson.cycleId
    if (lesson.placementId) rec.placementId = lesson.placementId
    onUpdateAdmin((prev) => ({ ...prev, observations: [...prev.observations, rec] }))
    setFeedback({ observer: '', focus: '', strengths: '', development: '' })
  }
  const startNextAttempt = () => {
    const rec = nextAttempt(lesson, newAdminId(), todayISO, Date.now()) as Lesson
    onUpdateAdmin((prev) => ({ ...prev, lessons: [...prev.lessons, rec] }))
    setLessonId(rec.id)
    setStage('plan')
    setSaved(`Next attempt started — attempt ${rec.attempt}`)
  }
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = STAGES.findIndex((s) => s.id === stage)
    if (e.key === 'ArrowRight') setStage(STAGES[(i + 1) % STAGES.length].id)
    if (e.key === 'ArrowLeft') setStage(STAGES[(i + STAGES.length - 1) % STAGES.length].id)
  }
  const title = `${lesson.subject || 'Lesson'}${lesson.classGroup ? ` · ${lesson.classGroup}` : ''}`

  return (
    <Dialog label={`Lesson workbench: ${title}`} onClose={onClose} className="sheet-workbench">
      <div className="sheet-header">
        <h2>{title}</h2>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><IconClose /></button>
      </div>
      <p className="filter-hint workbench-meta">
        {lesson.dateISO ? fmt(lesson.dateISO) : 'Undated'}
        {lesson.attempt && lesson.attempt > 1 ? ` · attempt ${lesson.attempt}` : ''}
        {lesson.planRevision ? ` · plan rev ${lesson.planRevision}` : ' · no plan yet'}
        {cycle ? ` · focus: ${cycle.focus}` : ''}
      </p>
      <div className="segmented" role="tablist" aria-label="Lesson stages">
        {STAGES.map((s) => (
          <button key={s.id} id={`wb-tab-${s.id}`} type="button" role="tab" aria-selected={stage === s.id} aria-controls={`wb-panel-${s.id}`} tabIndex={stage === s.id ? 0 : -1} className={`segment${stage === s.id ? ' segment-on' : ''}`} onClick={() => setStage(s.id)} onKeyDown={onTabKey}>
            {s.label}
          </button>
        ))}
      </div>
      {saved && <p className="filter-hint saved-line" role="status">{saved}</p>}

      <div id="wb-panel-plan" role="tabpanel" aria-labelledby="wb-tab-plan" hidden={stage !== 'plan'}>
        <div className="task-edit-row">
          <Field label="Date"><input type="date" className="date-input" value={draft.dateISO ?? ''} onChange={(e) => setDraft({ ...draft, dateISO: e.target.value })} /></Field>
          <Field label="Class"><input type="text" className="placement-input" value={draft.classGroup ?? ''} onChange={(e) => setDraft({ ...draft, classGroup: e.target.value })} /></Field>
        </div>
        <Field label="Subject"><input type="text" className="placement-input" value={draft.subject ?? ''} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} /></Field>
        <div className="task-edit-row">
          <Field label="Timetable occurrence">
            <select className="date-input" value={draft.sessionRef ?? ''} onChange={(e) => setDraft({ ...draft, sessionRef: e.target.value })} aria-label="Timetable occurrence">
              <option value="">Not linked</option>
              {dayOptions.map((s) => (
                <option key={sessionKey(s)} value={sessionKey(s)}>{s.start} {s.title}</option>
              ))}
            </select>
          </Field>
          <Field label="Placement">
            <select className="date-input" value={draft.placementId ?? ''} onChange={(e) => setDraft({ ...draft, placementId: e.target.value })} aria-label="Placement">
              <option value="">Unassigned</option>
              {placementOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Practice focus" hint="One focus is active at a time; attempts collect under it.">
          <select className="date-input" value={draft.cycleId ?? ''} onChange={(e) => setDraft({ ...draft, cycleId: e.target.value })} aria-label="Practice focus">
            <option value="">No focus</option>
            {cycles.map((c) => (
              <option key={c.id} value={c.id}>{c.focus}{c.state === 'paused' ? ' (paused)' : ''}</option>
            ))}
          </select>
          <div className="btn-row">
            <input type="text" className="placement-input" placeholder="New focus, e.g. cold-calling every learner" aria-label="New focus" value={newFocus} onChange={(e) => setNewFocus(e.target.value)} />
            <button type="button" className="btn-today-reset" onClick={createFocus} disabled={!newFocus.trim()}>Add focus</button>
          </div>
        </Field>
        <Field label="Unit / sequence reference"><input type="text" className="placement-input" value={draft.unitRef ?? ''} onChange={(e) => setDraft({ ...draft, unitRef: e.target.value })} /></Field>
        <div className="btn-row">
          <span className="filter-hint">Start from a template:</span>
          {LESSON_TEMPLATES.map((t) => (
            <button key={t.id} type="button" className="btn-today-reset" onClick={() => applyTemplate(t.id)}>{t.label}</button>
          ))}
        </div>
        <Field label="Learning intention"><textarea className="placement-input" rows={2} value={draft.intention ?? ''} onChange={(e) => setDraft({ ...draft, intention: e.target.value })} /></Field>
        <Field label="Prior knowledge"><textarea className="placement-input" rows={2} value={draft.priorKnowledge ?? ''} onChange={(e) => setDraft({ ...draft, priorKnowledge: e.target.value })} /></Field>
        <Field label="Likely misconceptions"><textarea className="placement-input" rows={2} value={draft.misconceptions ?? ''} onChange={(e) => setDraft({ ...draft, misconceptions: e.target.value })} /></Field>
        <Field label="Sequence"><textarea className="placement-input" rows={5} value={draft.sequence ?? ''} onChange={(e) => setDraft({ ...draft, sequence: e.target.value })} /></Field>
        <Field label="Checks for understanding"><textarea className="placement-input" rows={2} value={draft.checks ?? ''} onChange={(e) => setDraft({ ...draft, checks: e.target.value })} /></Field>
        <Field label="Planned responses"><textarea className="placement-input" rows={2} value={draft.plannedResponses ?? ''} onChange={(e) => setDraft({ ...draft, plannedResponses: e.target.value })} /></Field>
        <Field label="Resources (one per line, links or names)"><textarea className="placement-input" rows={2} value={draft.resourcesText} onChange={(e) => setDraft({ ...draft, resourcesText: e.target.value })} /></Field>
        <div className="btn-row">
          <button type="button" className="btn-primary" onClick={savePlan}>Save plan</button>
          <button type="button" className="btn-today-reset" onClick={() => { savePlan(); setStage('rehearse') }}>Save and rehearse →</button>
        </div>
      </div>

      <div id="wb-panel-rehearse" role="tabpanel" aria-labelledby="wb-tab-rehearse" hidden={stage !== 'rehearse'}>
        {!lesson.sequence && !lesson.intention ? (
          <p className="filter-hint">Nothing to rehearse yet — save a plan first.</p>
        ) : (
          <div className="plan-summary">
            {lesson.intention && <p><strong>Intention</strong> {lesson.intention}</p>}
            {lesson.sequence && <pre className="plan-pre">{lesson.sequence}</pre>}
            {lesson.checks && <p><strong>Checks</strong> {lesson.checks}</p>}
          </div>
        )}
        {cycle ? (
          <Field label={`Rehearsal note for “${cycle.focus}”`} hint="What you will say or do, in your own words.">
            <textarea className="placement-input" rows={3} value={cycle.rehearsalNote ?? ''} onChange={(e) => onUpdateAdmin((prev) => ({ ...prev, cycles: prev.cycles.map((c) => (c.id === cycle.id ? { ...c, rehearsalNote: e.target.value } : c)) }))} />
          </Field>
        ) : (
          <p className="filter-hint">Link a practice focus in Plan to keep a rehearsal note with it.</p>
        )}
        <Field label="Add a rehearsal block to your Schedule" hint="Uses your work-plan model: a task with a timed block, editable like any other.">
          <div className="task-edit-row">
            <input type="date" className="date-input" aria-label="Rehearsal date" value={block.dateISO} onChange={(e) => setBlock({ ...block, dateISO: e.target.value })} />
            <input type="time" className="date-input" aria-label="Rehearsal starts" value={block.startTime} onChange={(e) => setBlock({ ...block, startTime: e.target.value })} />
            <input type="time" className="date-input" aria-label="Rehearsal ends" value={block.endTime} onChange={(e) => setBlock({ ...block, endTime: e.target.value })} />
          </div>
          <div className="btn-row">
            <button type="button" className="btn-today-reset" disabled={!block.dateISO || !block.startTime || !block.endTime || block.endTime <= block.startTime} onClick={() => { onAddRehearsalBlock(lesson, block); setSaved('Rehearsal block added to your Schedule') }}>Add rehearsal block</button>
            {lesson.rehearsalTaskId && <span className="filter-hint">A rehearsal block exists for this lesson.</span>}
          </div>
        </Field>
        <div className="btn-row">
          <button type="button" className="btn-primary" onClick={() => { update((l) => ({ ...l, rehearsedAt: Date.now(), stage: 'teach' })); setStage('teach'); setSaved('Rehearsed') }}>Mark rehearsed →</button>
        </div>
      </div>

      <div id="wb-panel-teach" role="tabpanel" aria-labelledby="wb-tab-teach" hidden={stage !== 'teach'} className="teach-mode">
        {!lesson.sequence && !lesson.intention ? (
          <p className="filter-hint">No plan saved yet — Teach mode shows the essential plan in large type.</p>
        ) : (
          <>
            {lesson.intention && <p className="teach-intention">{lesson.intention}</p>}
            {lesson.sequence && <pre className="plan-pre teach-sequence">{lesson.sequence}</pre>}
            {lesson.checks && <p><strong>Check:</strong> {lesson.checks}</p>}
            {lesson.plannedResponses && <p><strong>If stuck:</strong> {lesson.plannedResponses}</p>}
            {lesson.resources && lesson.resources.length > 0 && (
              <ul className="teach-resources" aria-label="Resources">
                {lesson.resources.map((r) => (
                  <li key={r}>{/^https?:\/\//.test(r) ? <a href={r} target="_blank" rel="noopener noreferrer">{r}</a> : r}</li>
                ))}
              </ul>
            )}
          </>
        )}
        <div className="btn-row">
          {!lesson.taughtAt ? (
            <button type="button" className="btn-primary btn-large" onClick={() => { update((l) => ({ ...l, taughtAt: Date.now(), taughtPlanRevision: l.planRevision ?? 0, stage: 'teach' })); setSaved('Teaching — plan revision pinned') }}>Start teaching</button>
          ) : (
            <button type="button" className="btn-primary btn-large" onClick={() => { update((l) => ({ ...l, stage: 'review' })); setStage('review') }}>Finished — review →</button>
          )}
        </div>
        <p className="filter-hint">Works offline. Teaching a lesson never records attendance or a judgement — those are yours to enter separately.</p>
      </div>

      <div id="wb-panel-review" role="tabpanel" aria-labelledby="wb-tab-review" hidden={stage !== 'review'}>
        {planStale && (
          <div className="callout callout--amber"><p>The plan changed after this lesson was taught (taught rev {lesson.taughtPlanRevision}, now rev {lesson.planRevision}). This review refers to the taught version.</p></div>
        )}
        <Field label="Evaluation (how did it go, what changes next time)">
          <textarea className="placement-input" rows={4} value={evaluation} onChange={(e) => setEvaluation(e.target.value)} />
        </Field>
        <Field label="Teachers' Standards evidenced (your tag, not a judgement)">
          <div className="chip-grid ts-chips">
            {TEACHERS_STANDARDS.map((ts) => (
              <button key={ts.id} type="button" className={`chip chip-small${standards.includes(ts.id) ? ' chip-on' : ''}`} aria-pressed={standards.includes(ts.id)} title={ts.label} onClick={() => setStandards((s) => (s.includes(ts.id) ? s.filter((x) => x !== ts.id) : [...s, ts.id].sort()))}>{ts.id}</button>
            ))}
          </div>
        </Field>
        <div className="btn-row">
          <button type="button" className="btn-primary" onClick={() => { update((l) => ({ ...l, evaluation: evaluation.trim(), standards, reviewAt: Date.now(), stage: 'review' })); setSaved('Review saved') }}>Save review</button>
          <button type="button" className="btn-today-reset" onClick={startNextAttempt}>Next attempt →</button>
        </div>
        <h3 className="subheading">Feedback on this lesson</h3>
        {feedbackList.length === 0 ? <p className="filter-hint">No feedback recorded yet.</p> : (
          <ul className="workspace-list" aria-label="Feedback">
            {feedbackList.map((o) => (
              <li key={o.id} className="workspace-row feedback-row">
                <span>
                  <span className="tag">{provenanceLabel(o.sourceType)}</span>{o.observer ? ` ${o.observer}` : ''}{o.revision ? <span className="filter-hint"> · rev {o.revision}</span> : null}
                  {o.strengths && <p><strong>Strengths</strong> {o.strengths}</p>}
                  {o.development && <p><strong>Develop</strong> {o.development}</p>}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Field label="Add feedback you received (entered by you)" hint="Recorded as entered by you — a mentor's own authenticated feedback needs the portal, which does not exist yet.">
          <input type="text" className="placement-input" placeholder="From (mentor, tutor…)" aria-label="Feedback from" value={feedback.observer} onChange={(e) => setFeedback({ ...feedback, observer: e.target.value })} />
          <textarea className="placement-input" rows={2} placeholder="Strengths…" aria-label="Feedback strengths" value={feedback.strengths} onChange={(e) => setFeedback({ ...feedback, strengths: e.target.value })} />
          <textarea className="placement-input" rows={2} placeholder="Development points…" aria-label="Feedback development" value={feedback.development} onChange={(e) => setFeedback({ ...feedback, development: e.target.value })} />
          <div className="btn-row"><button type="button" className="btn-today-reset" onClick={addFeedback} disabled={!feedback.strengths.trim() && !feedback.development.trim()}>Add feedback</button></div>
        </Field>
      </div>
    </Dialog>
  )
}

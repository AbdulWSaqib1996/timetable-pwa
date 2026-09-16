import { useState } from 'react'
import { Card, IconChevronLeft, PageHeader } from '../../components/ui'
import { newAdminId, placementLabel } from '../../lib/admin'
import type { AdminFile, LearningThreadRec, Lesson, LessonStage, Observation } from '../../lib/admin'
import { nextAttempt, provenanceLabel } from '../../../shared/practice.js'
import { THREAD_NEXT_ACTION_MAX, THREAD_STAGE_LABEL, threadLessons, threadSteps, threadsInformedBy, withNextAction, withNextLesson, withObservation } from '../../../shared/threads.js'

interface Props {
  thread: LearningThreadRec
  admin: AdminFile
  todayISO: string
  placementOptions: { value: string; label: string }[]
  onUpdateAdmin: (updater: (prev: AdminFile) => AdminFile) => void
  onOpenLesson: (lessonId: string, stage?: LessonStage) => void
  onOpenObservation: (observationId: string) => void
  onBack: () => void
}

const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}
const fmtAt = (ms?: number) => (ms ? new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')

const STATE_LABEL: Record<string, string> = { done: 'Done', missing: 'Missing', gone: 'Source no longer present' }

/**
 * "This teaching cycle" (audit E01, Pass 83): one visible thread from a lesson
 * plan to the taught lesson, the feedback the learner chose, the improvement
 * in their own words and the next attempt. Everything shown is derived from
 * the canonical lesson, observation and cycle records — the thread holds only
 * references, so attaching an observation here never copies it, and the same
 * observation can inform other threads. Nothing turns feedback into a target
 * or a judgement; the learner picks what informs what and what to try next.
 */
export function TeachingCyclePage({ thread, admin, todayISO, placementOptions, onUpdateAdmin, onOpenLesson, onOpenObservation, onBack }: Props) {
  const { steps, complete } = threadSteps(thread, admin)
  const { first, latest } = threadLessons(thread, admin.lessons) as { first: Lesson | null; latest: Lesson | null }
  const [nextAction, setNextAction] = useState(thread.nextAction ?? '')
  const [nextPlacement, setNextPlacement] = useState(latest?.placementId ?? thread.placementId ?? '')
  const [showAll, setShowAll] = useState(false)
  const placement = (admin.placements ?? []).find((p) => p.id === thread.placementId)
  const chip = placement ? placementLabel(placement, admin.schools ?? []) : 'No placement'

  const write = (fn: (t: LearningThreadRec) => LearningThreadRec) =>
    onUpdateAdmin((prev) => ({ ...prev, learningThreads: (prev.learningThreads ?? []).map((t) => (t.id === thread.id ? fn(t) : t)) }))

  // Feedback candidates: observations on this thread's lessons first, then the rest of the placement, then everything.
  const lessonIds = new Set(thread.lessonIds ?? [])
  const attached = new Set(thread.observationIds ?? [])
  const all = [...admin.observations].sort((a, b) => b.dateISO.localeCompare(a.dateISO) || b.at - a.at)
  const related = all.filter((o) => (o.lessonId && lessonIds.has(o.lessonId)) || (thread.placementId && o.placementId === thread.placementId) || attached.has(o.id))
  const candidates = showAll ? all : related
  const otherThreads = (o: Observation) => threadsInformedBy(admin.learningThreads ?? [], o.id).filter((t) => t.id !== thread.id).length

  const createNext = () => {
    const source = latest ?? first
    if (!source) return
    const now = Date.now()
    const rec = nextAttempt(source, newAdminId(), todayISO, now) as Lesson
    // A cross-placement next attempt: only the NEW lesson carries the new placement.
    if (nextPlacement) rec.placementId = nextPlacement
    else delete rec.placementId
    onUpdateAdmin((prev) => ({
      ...prev,
      lessons: [...prev.lessons, rec],
      learningThreads: (prev.learningThreads ?? []).map((t) => (t.id === thread.id ? withNextLesson(t, rec.id, now) : t)),
    }))
  }

  const stepFor = (stage: string) => steps.find((s) => s.stage === stage)!

  return (
    <div className="page page-pgce page-cycle">
      <button type="button" className="page-back" onClick={onBack}>
        <IconChevronLeft size={18} /> Lessons & practice
      </button>
      <PageHeader title="This teaching cycle" subtitle={thread.title || 'Teaching cycle'} />
      <p className="pgce-active-state cycle-chip-row">
        <span className="tag tag--teal">{chip}</span>
        <span className={`tag${thread.state === 'closed' ? '' : ' tag--ready'}`}>{thread.state === 'closed' ? 'Closed' : complete ? 'Complete' : 'In progress'}</span>
        <span className="filter-hint">revision {thread.revision}</span>
      </p>

      <ol className="cycle-steps" aria-label="Teaching cycle">
        {steps.map((s) => (
          <li key={s.stage} className={`cycle-step cycle-step--${s.state}`} data-state={s.state}>
            <div className="cycle-step-head">
              <strong>{THREAD_STAGE_LABEL[s.stage as keyof typeof THREAD_STAGE_LABEL]}</strong>
              <span className={`tag ${s.state === 'done' ? 'tag--ready' : s.state === 'gone' ? '' : 'tag--amber'}`}>{STATE_LABEL[s.state]}</span>
            </div>
            <p className="filter-hint cycle-step-reason">{s.reason}{s.at ? ` · ${fmtAt(s.at)}` : ''}</p>

            {s.stage === 'plan' && first && (
              <div className="btn-row">
                <button type="button" className="btn-today-reset" onClick={() => onOpenLesson(first.id, 'plan')}>Open plan · {first.subject || 'Lesson'} · {fmtDate(first.dateISO)}</button>
              </div>
            )}
            {s.stage === 'teach' && first && (
              <div className="btn-row">
                <button type="button" className="btn-today-reset" onClick={() => onOpenLesson(first.id, 'teach')}>Open Teach</button>
                {first.taughtAt ? <button type="button" className="btn-today-reset" onClick={() => onOpenLesson(first.id, 'review')}>Open review</button> : null}
              </div>
            )}

            {s.stage === 'feedback' && (
              <Card className="cycle-feedback">
                <p className="filter-hint">Choose which observations inform this thread. They stay where they are — one observation can inform several threads.</p>
                {candidates.length === 0 ? (
                  <p className="filter-hint">No observations recorded{showAll ? '' : ' for these lessons or this placement'} yet.</p>
                ) : (
                  <ul className="workspace-list" aria-label="Observations">
                    {candidates.map((o) => {
                      const others = otherThreads(o)
                      return (
                        <li key={o.id} className="workspace-row requirement-row">
                          <label className="cycle-obs">
                            <input type="checkbox" checked={attached.has(o.id)} onChange={(e) => write((t) => withObservation(t, o.id, e.target.checked, Date.now()))} aria-label={`Informs this thread: ${o.observer || 'Observation'} ${fmtDate(o.dateISO)}`} />
                            <span>
                              <strong>{o.observer || 'Observation'}</strong> <span className="filter-hint">· {fmtDate(o.dateISO)}{o.focus ? ` · ${o.focus}` : ''} · {provenanceLabel(o.sourceType)}{others ? ` · also informs ${others} other thread${others === 1 ? '' : 's'}` : ''}</span>
                            </span>
                          </label>
                          <button type="button" className="travel-link" onClick={() => onOpenObservation(o.id)} aria-label={`Open observation ${fmtDate(o.dateISO)}`}>Open</button>
                        </li>
                      )
                    })}
                  </ul>
                )}
                {!showAll && all.length > related.length ? (
                  <button type="button" className="travel-link" onClick={() => setShowAll(true)}>Show all {all.length} observations</button>
                ) : null}
              </Card>
            )}

            {s.stage === 'next' && (
              <Card className="cycle-next">
                <label className="ui-field">
                  <span className="ui-field-label">What to try next — in your own words</span>
                  <textarea className="placement-input" rows={3} maxLength={THREAD_NEXT_ACTION_MAX} value={nextAction} onChange={(e) => setNextAction(e.target.value)} onBlur={() => write((t) => withNextAction(t, nextAction, Date.now()))} placeholder="e.g. Cold-call after every modelled example, not only at the end" />
                  <span className="filter-hint">Feedback never becomes a target on its own; this is your decision.</span>
                </label>
                {thread.nextLessonId && stepFor('next').state === 'done' ? (
                  <div className="btn-row">
                    <button type="button" className="btn-primary" onClick={() => onOpenLesson(thread.nextLessonId!, 'plan')}>Open next lesson</button>
                  </div>
                ) : (
                  <>
                    <label className="ui-field">
                      <span className="ui-field-label">Placement for the next attempt</span>
                      <select className="date-input" value={nextPlacement} onChange={(e) => setNextPlacement(e.target.value)} aria-label="Placement for the next attempt">
                        <option value="">Unassigned</option>
                        {placementOptions.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                      <span className="filter-hint">The original lesson keeps its own placement whatever you choose here.</span>
                    </label>
                    <div className="btn-row">
                      <button type="button" className="btn-primary" disabled={!first} onClick={createNext}>Create next practice lesson</button>
                    </div>
                  </>
                )}
              </Card>
            )}
          </li>
        ))}
      </ol>

      <div className="btn-row">
        <button type="button" className="btn-today-reset" onClick={() => write((t) => ({ ...t, state: t.state === 'closed' ? 'open' : 'closed', revision: t.revision + 1, at: Date.now() }))}>
          {thread.state === 'closed' ? 'Reopen this cycle' : 'Close this cycle'}
        </button>
      </div>
      <p className="filter-hint">Private reflections stay out of mentor packs unless you add them to a pack yourself. Deleting a lesson or observation elsewhere leaves a "source no longer present" step here rather than removing the thread.</p>
    </div>
  )
}

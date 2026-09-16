import { useEffect, useMemo, useState } from 'react'
import { Field, FieldGroup } from './ui'
import { HOMEWORK_DETAILS_MAX, HOMEWORK_TITLE_MAX, makeHomework, resolveDue, titleFamily, validateHomeworkInput } from '../../shared/homework.js'
import { newAdminId } from '../lib/admin'
import type { AdminFile, HomeworkRec, Lesson } from '../lib/admin'
import { sessionKey } from '../lib/diff'
import { clearDraft, loadDraft, saveDraft } from '../lib/drafts'
import type { Session } from '../types'
import { DueChooser } from './DueChooser'
import type { DueChoice } from './DueChooser'

interface Props {
  /** the lesson record that set it, when there is one */
  lesson?: Lesson | null
  /** the timetable occurrence it was set in — the session detail always has one */
  session?: Session | null
  /** eligible course sessions (all dates) — real teaching occurrences homework can be due in */
  sessions: Session[]
  homework: HomeworkRec[]
  todayISO: string
  onUpdateAdmin: (updater: (prev: AdminFile) => AdminFile) => void
  /** group label: "…in this lesson" in the workbench, "…in this session" on a session */
  label?: string
  /** HW-05: drafts are kept per profile + source */
  profileId?: string
  /** HW-02: open one record's own page */
  onOpenHomework?: (id: string) => void
  /** HW-02: a removal the caller can offer Undo for */
  onRemove?: (h: HomeworkRec) => void
}

const fmtDay = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}
interface HomeworkDraft { title: string; details: string }
const DRAFT_KIND = 'homework-new'

/**
 * Homework set in one lesson or in one timetable session (owner request, 15
 * September 2026; HW-02/HW-05, Pass 87): a compact, readable list of what was
 * set here — each item opens its own page for editing and rescheduling — and
 * a form that keeps a draft per source, validates instead of truncating, and
 * offers a searchable due chooser over the whole timetable. The record owns
 * its completion, so the tick here, on the Tasks screen, on the Schedule and
 * on the session it is due in are all the same state.
 */
export function HomeworkPanel({ lesson, session, sessions, homework, todayISO, onUpdateAdmin, label: groupLabel, profileId, onOpenHomework, onRemove }: Props) {
  const source = useMemo(() => {
    if (session) return session
    const byRef = lesson?.sessionRef ? sessions.find((s) => sessionKey(s) === lesson.sessionRef) : undefined
    return byRef ?? null
  }, [session, lesson?.sessionRef, sessions])
  const sourceRef = source ? sessionKey(source) : lesson?.sessionRef
  const draftId = (sourceRef ?? lesson?.id ?? 'none').replace(/[^\w-]/g, '_').slice(0, 100)
  const pending = useMemo(() => (profileId ? loadDraft<HomeworkDraft>(profileId, DRAFT_KIND, draftId) : null), [profileId, draftId])
  const [title, setTitle] = useState(pending?.value.title ?? '')
  const [details, setDetails] = useState(pending?.value.details ?? '')
  const [choice, setChoice] = useState<DueChoice | null>(null)
  const [keepTarget, setKeepTarget] = useState(false)
  const [resetKey, setResetKey] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [draftNote, setDraftNote] = useState<string | null>(pending ? `Draft from ${new Date(pending.savedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} restored` : null)
  // HW-05: the draft follows the source — switching sessions never carries another source's words.
  useEffect(() => {
    if (!profileId) return
    if (!title && !details) {
      clearDraft(profileId, DRAFT_KIND, draftId)
      return
    }
    saveDraft<HomeworkDraft>(profileId, DRAFT_KIND, draftId, 0, { title, details })
  }, [profileId, draftId, title, details])

  const family = titleFamily(source?.title ?? lesson?.subject ?? '')
  const after = useMemo(() => (source ? { dateISO: source.dateISO, start: source.start } : { dateISO: lesson?.dateISO ?? todayISO, start: '23:59' }), [source, lesson?.dateISO, todayISO])
  // Everything this lesson OR this occurrence set — the two surfaces show the same list.
  const mine = homework.filter((h) => (lesson && h.lessonId === lesson.id) || (sourceRef && h.setSessionRef === sourceRef))
  const problem = validateHomeworkInput({ title, details })

  const add = () => {
    setError(null)
    try {
      const rec = makeHomework({
        id: newAdminId(),
        title,
        details,
        lesson: lesson ?? null,
        sourceRef,
        source: source ?? null,
        target: choice?.target ?? null,
        dueISO: choice?.target ? undefined : choice?.dueISO,
        todayISO,
        now: Date.now(),
      }) as HomeworkRec
      onUpdateAdmin((prev) => ({ ...prev, homework: [...(prev.homework ?? []), rec] }))
      setTitle('')
      setDetails('')
      setDraftNote(null)
      if (profileId) clearDraft(profileId, DRAFT_KIND, draftId)
      if (!keepTarget) setResetKey((k) => k + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add that homework.')
    }
  }
  const toggle = (h: HomeworkRec) =>
    onUpdateAdmin((prev) => ({
      ...prev,
      homework: (prev.homework ?? []).map((x) =>
        x.id === h.id ? { ...x, status: x.status === 'done' ? 'todo' : 'done', completedISO: x.status === 'done' ? x.completedISO : todayISO, at: Date.now() } : x
      ),
    }))
  const remove = (h: HomeworkRec) => {
    if (onRemove) return onRemove(h)
    onUpdateAdmin((prev) => ({ ...prev, homework: (prev.homework ?? []).filter((x) => x.id !== h.id) }))
  }

  return (
    <FieldGroup label={groupLabel ?? 'Homework set in this lesson'} hint="Schedule it against a later occurrence of this lesson — it then shows on that session, on Tasks and on the Schedule.">
      {mine.length > 0 && (
        <ul className="setup-list" aria-label="Homework set">
          {mine.map((h) => {
            const due = resolveDue(h, sessions, sessionKey)
            return (
              <li key={h.id} className="setup-row homework-row">
                <label className="toggle-row">
                  <input type="checkbox" checked={h.status === 'done'} onChange={() => toggle(h)} />
                  <span>
                    <span className={h.status === 'done' ? 'action-done' : undefined}>{h.title}</span>{' '}
                    <span className="filter-hint">
                      · due {due.state !== 'fixed' && (due.confirmed?.title ?? h.dueTitle) ? `in ${due.confirmed?.title ?? h.dueTitle} · ` : ''}
                      {fmtDay(due.effectiveISO)}
                      {due.state === 'changed' || due.state === 'missing' ? ' · needs review' : ''}
                      {h.status === 'done' && h.completedISO ? ` · completed ${fmtDay(h.completedISO)}` : ''}
                    </span>
                    {h.details && <span className="filter-hint homework-row-details"> — {h.details}</span>}
                  </span>
                </label>
                <span className="requirement-confirm">
                  {onOpenHomework && <button type="button" className="travel-link" aria-label={`Open homework: ${h.title}`} onClick={() => onOpenHomework(h.id)}>Open</button>}
                  <button type="button" className="travel-link" aria-label={`Remove homework: ${h.title}`} onClick={() => remove(h)}>Remove</button>
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {draftNote && <p className="filter-hint" role="status">{draftNote}</p>}
      {/* Counters sit outside the label so the controls keep their plain names. */}
      <Field label="Homework">
        <input type="text" className="placement-input" placeholder="e.g. Fractions worksheet, questions 1–8" value={title} onChange={(e) => setTitle(e.target.value)} aria-invalid={title.trim().length > HOMEWORK_TITLE_MAX || undefined} />
      </Field>
      <p className="filter-hint homework-counter">{title.trim().length}/{HOMEWORK_TITLE_MAX}</p>
      <Field label="Details (optional)">
        <textarea className="note-input" rows={2} value={details} onChange={(e) => setDetails(e.target.value)} aria-invalid={details.length > HOMEWORK_DETAILS_MAX || undefined} />
      </Field>
      <p className="filter-hint homework-counter">{details.length}/{HOMEWORK_DETAILS_MAX}</p>
      <DueChooser sessions={sessions} family={family} after={after} onChange={setChoice} resetKey={resetKey} idPrefix={groupLabel ?? 'due'} />
      <label className="toggle-row">
        <input type="checkbox" checked={keepTarget} onChange={(e) => setKeepTarget(e.target.checked)} />
        Use this due session for the next item too
      </label>
      {(error || (problem && title.trim())) && <p className="filter-hint field-error" role="alert">{error ?? problem}</p>}
      <div className="btn-row">
        <button type="button" className="btn-today-reset" disabled={!!problem || !choice} onClick={add}>
          Add homework
        </button>
      </div>
    </FieldGroup>
  )
}

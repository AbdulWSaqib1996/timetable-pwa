import { useMemo, useState } from 'react'
import { Card, IconCheck, IconChevronLeft, PageHeader, StatusMessage } from '../../components/ui'
import { HOMEWORK_DETAILS_MAX, HOMEWORK_TITLE_MAX, editHomework, followSession, keepDate, rescheduleHomework, resolveDue, resolveSource, teachableOccurrence, titleFamily, validateHomeworkInput } from '../../../shared/homework.js'
import type { DueResolution } from '../../../shared/homework.js'
import { sessionKey } from '../../lib/diff'
import type { AdminFile, HomeworkRec } from '../../lib/admin'
import type { Session } from '../../types'
import { DueChooser } from '../../components/DueChooser'

interface Props {
  homework: HomeworkRec
  admin: AdminFile
  /** eligible course sessions — real teaching occurrences only */
  sessions: Session[]
  todayISO: string
  onUpdateAdmin: (updater: (prev: AdminFile) => AdminFile) => void
  onSetStatus: (next: 'todo' | 'doing' | 'done') => void
  onOpenSession: (session: Session) => void
  onOpenLesson: (lessonId: string) => void
  /** remove with Undo — the caller keeps the record for the undo window */
  onRemove: () => void
  onBack: () => void
}

const fmtDay = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}
const fmtAt = (ms: number) => new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const STATE_LABEL: Record<DueResolution['state'], string> = { fixed: 'Fixed date', current: 'Due in a session', changed: 'Session changed — needs your decision', missing: 'Session no longer in the timetable' }

/**
 * Homework detail and editor (HW-02, Pass 87): one screen for one record —
 * the words, where it was set (the occurrence first, the lesson plan
 * separately), where it is due with the resolver's state, the status, the
 * change history, and Edit / Change due / Remove on the SAME id. A moved due
 * session is a question here — Follow this session or Keep the original date
 * — never an automatic move. Removing offers Undo through the caller.
 */
export function HomeworkDetailPage({ homework: hw, admin, sessions, todayISO, onUpdateAdmin, onSetStatus, onOpenSession, onOpenLesson, onRemove, onBack }: Props) {
  const due = resolveDue(hw, sessions, sessionKey)
  const source = resolveSource(hw, sessions, sessionKey)
  const lesson = hw.lessonId ? admin.lessons.find((l) => l.id === hw.lessonId) ?? null : null
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(hw.title)
  const [details, setDetails] = useState(hw.details ?? '')
  const [rescheduling, setRescheduling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const write = (fn: (h: HomeworkRec) => HomeworkRec) => onUpdateAdmin((prev) => ({ ...prev, homework: (prev.homework ?? []).map((h) => (h.id === hw.id ? fn(h) : h)) }))
  const family = titleFamily(source.session?.title ?? source.snapshot?.title ?? hw.dueTitle ?? hw.title)
  const after = useMemo(() => (source.session ? { dateISO: source.session.dateISO, start: source.session.start } : { dateISO: todayISO, start: '00:00' }), [source.session, todayISO])
  const problem = validateHomeworkInput({ title, details })

  const saveWords = () => {
    try {
      write((h) => editHomework(h, { title, details }, Date.now()) as HomeworkRec)
      setEditing(false)
      setError(null)
      setSaved('Saved — the same record, the same tick everywhere')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.')
    }
  }

  return (
    <div className="page page-homework">
      <button type="button" className="page-back" onClick={onBack}>
        <IconChevronLeft size={18} /> Back
      </button>
      <PageHeader title={hw.title} subtitle="Homework" />
      <p className="pgce-active-state">
        <span className="tag tag--amber">Homework</span>
        <span className={`tag${hw.status === 'done' ? ' tag--ready' : ''}`}>{hw.status === 'done' ? 'Done' : hw.status === 'doing' ? 'In progress' : 'To do'}</span>
        {due.state === 'changed' || due.state === 'missing' ? <span className="tag tag--amber">Needs review</span> : null}
      </p>
      {saved && <StatusMessage tone="success"><span>{saved}</span></StatusMessage>}

      <Card className="pgce-section">
        <div className="section-title"><h2 className="subheading">Instructions</h2></div>
        {editing ? (
          <>
            <label className="ui-field">
              <span className="ui-field-label">Homework</span>
              <input type="text" className="placement-input" value={title} onChange={(e) => setTitle(e.target.value)} aria-invalid={title.trim().length > HOMEWORK_TITLE_MAX || undefined} />
            </label>
            <p className="filter-hint homework-counter">{title.trim().length}/{HOMEWORK_TITLE_MAX}</p>
            <label className="ui-field">
              <span className="ui-field-label">Details</span>
              <textarea className="note-input" rows={4} value={details} onChange={(e) => setDetails(e.target.value)} aria-invalid={details.length > HOMEWORK_DETAILS_MAX || undefined} />
            </label>
            <p className="filter-hint homework-counter">{details.length}/{HOMEWORK_DETAILS_MAX}</p>
            {(problem || error) && <p className="setup-error" role="alert">{error ?? problem}</p>}
            <div className="btn-row">
              <button type="button" className="btn-primary" disabled={!!problem} onClick={saveWords}>Save</button>
              <button type="button" className="btn-ghost" onClick={() => { setEditing(false); setTitle(hw.title); setDetails(hw.details ?? ''); setError(null) }}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            {hw.details ? <p className="detail-note-text homework-details">{hw.details}</p> : <p className="filter-hint">No details recorded.</p>}
            <div className="btn-row">
              <button type="button" className="btn-today-reset" onClick={() => { setEditing(true); setSaved(null) }}>Edit</button>
            </div>
          </>
        )}
      </Card>

      <Card className="pgce-section">
        <div className="section-title"><h2 className="subheading">Set in</h2></div>
        {source.state === 'current' && source.session ? (
          <p className="detail-state">{source.session.title} · {fmtDay(source.session.dateISO)}{source.session.start ? ` ${source.session.start}` : ''}</p>
        ) : source.state === 'missing' && source.snapshot ? (
          <p className="detail-state">{source.snapshot.title} · {fmtDay(source.snapshot.dateISO)} <span className="tag tag--amber">Source no longer in timetable</span></p>
        ) : lesson ? (
          <p className="detail-state">Lesson: {lesson.subject || 'Lesson'} · {fmtDay(lesson.dateISO)}</p>
        ) : (
          <p className="filter-hint">Recorded on {fmtDay(hw.setISO)} without a source session.</p>
        )}
        <div className="btn-row">
          {source.session && <button type="button" className="btn-today-reset" onClick={() => onOpenSession(source.session!)}>Open source session</button>}
          {lesson && <button type="button" className="btn-today-reset" onClick={() => onOpenLesson(lesson.id)}>Open lesson plan</button>}
        </div>
      </Card>

      <Card className="pgce-section">
        <div className="section-title"><h2 className="subheading">Due</h2></div>
        <p className="detail-state" data-due-state={due.state}>
          <span className={`tag${due.state === 'changed' || due.state === 'missing' ? ' tag--amber' : ''}`}>{STATE_LABEL[due.state]}</span>{' '}
          {due.state === 'fixed' ? fmtDay(due.effectiveISO) : `${due.confirmed?.title ?? hw.dueTitle ?? ''} · ${fmtDay(due.effectiveISO)}${due.effectiveStart ? ` ${due.effectiveStart}` : ''}`}
        </p>
        {due.state === 'changed' && due.change && (
          <div className="callout callout--amber" role="group" aria-label="Due session changed">
            <p>
              {due.change.fromTitle} {due.change.moved ? `moved: ${fmtDay(due.change.fromISO)}${due.change.fromStart ? ` ${due.change.fromStart}` : ''} → ${fmtDay(due.change.toISO)}${due.change.toStart ? ` ${due.change.toStart}` : ''}` : ''}
              {due.change.retitled ? `${due.change.moved ? ' and ' : ' '}is now called “${due.change.toTitle}”` : ''}. The deadline stays {fmtDay(due.effectiveISO)} until you decide.
            </p>
            <div className="btn-row">
              <button type="button" className="btn-primary" onClick={() => { write((h) => followSession(h, due.session!, Date.now()) as HomeworkRec); setSaved('Following the session — the deadline moved with it') }}>Follow this session</button>
              <button type="button" className="btn-today-reset" onClick={() => { write((h) => keepDate(h, Date.now()) as HomeworkRec); setSaved('Kept the original date — this homework no longer follows the session') }}>Keep the original date</button>
            </div>
          </div>
        )}
        {due.state === 'missing' && (
          <div className="callout callout--amber" role="group" aria-label="Due session missing">
            <p>The session this was due in is no longer in the timetable. The deadline stays {fmtDay(due.effectiveISO)}; choose another session or a date, or keep it as a fixed date.</p>
            <div className="btn-row">
              <button type="button" className="btn-today-reset" onClick={() => { write((h) => keepDate(h, Date.now()) as HomeworkRec); setSaved('Kept as a fixed date') }}>Keep the date</button>
            </div>
          </div>
        )}
        <div className="btn-row">
          {due.session && !rescheduling && <button type="button" className="btn-today-reset" onClick={() => onOpenSession(due.session!)}>Open due session</button>}
          <button type="button" className="btn-today-reset" onClick={() => setRescheduling((r) => !r)}>{rescheduling ? 'Cancel change' : 'Change due session or date'}</button>
        </div>
        {rescheduling && (
          <DueChooser
            sessions={sessions.filter((s) => teachableOccurrence(s))}
            family={family}
            after={after}
            onChange={() => undefined}
            onSubmit={(choice) => {
              try {
                write((h) => rescheduleHomework(h, choice, Date.now()) as HomeworkRec)
                setRescheduling(false)
                setError(null)
                setSaved('Due changed on the same record')
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Could not change the due date.')
              }
            }}
          />
        )}
        {error && !editing && <p className="setup-error" role="alert">{error}</p>}
        {(hw.dueHistory ?? []).length > 0 && (
          <ul className="workspace-list" aria-label="Due history">
            {[...(hw.dueHistory ?? [])].reverse().map((h, i) => (
              <li key={i} className="workspace-row"><span>{h.reason === 'follow' ? 'Followed the session' : h.reason === 'keep' ? 'Kept the date' : 'Rescheduled'}: {fmtDay(h.fromISO)} → {fmtDay(h.toISO)}</span><span className="filter-hint">{fmtAt(h.at)}</span></li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="pgce-section">
        <div className="section-title"><h2 className="subheading">Status</h2></div>
        <div className="detail-attendance-options" role="group" aria-label="Homework status">
          {(['todo', 'doing', 'done'] as const).map((option) => (
            <button key={option} type="button" className={`btn-attend${hw.status === option ? ' is-on' : ''}`} aria-pressed={hw.status === option} onClick={() => onSetStatus(option)}>
              {option === 'done' && <IconCheck />}
              {option === 'todo' ? 'To do' : option === 'doing' ? 'In progress' : 'Done'}
            </button>
          ))}
        </div>
        <p className="filter-hint">The same tick as on Tasks, on the Schedule and on the session it is due in{hw.completedISO && hw.status === 'done' ? ` · completed ${fmtDay(hw.completedISO)}` : ''}. No attendance is recorded for homework.</p>
      </Card>

      <div className="btn-row">
        <button type="button" className="btn-ghost" onClick={onRemove}>Remove this homework</button>
      </div>
    </div>
  )
}

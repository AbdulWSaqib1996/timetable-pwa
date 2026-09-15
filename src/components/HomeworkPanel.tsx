import { useMemo, useState } from 'react'
import { Field, FieldGroup } from './ui'
import { laterOccurrences, makeHomework, titleFamily, upcomingOccurrences } from '../../shared/homework.js'
import { newAdminId } from '../lib/admin'
import type { AdminFile, HomeworkRec, Lesson } from '../lib/admin'
import { sessionKey } from '../lib/diff'
import type { Session } from '../types'

interface Props {
  lesson: Lesson
  /** course sessions (all dates) — the occurrences homework can be due in */
  sessions: Session[]
  homework: HomeworkRec[]
  todayISO: string
  onUpdateAdmin: (updater: (prev: AdminFile) => AdminFile) => void
}

const fmtDay = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}
const label = (s: Session) => `${s.title} · ${fmtDay(s.dateISO)}${s.start ? ` ${s.start}` : ''}`

/**
 * Homework set in one lesson (owner request, 15 September 2026): recorded
 * here and scheduled against a LATER OCCURRENCE of the same lesson — "Maths 1
 * gave me homework; it is due in Maths 2". Later occurrences of this lesson's
 * own title family are offered first, then any other upcoming session, then a
 * plain date for homework with no lesson to hand it in at. The record owns its
 * completion, so the tick here, on the Tasks screen, on the Schedule and on
 * the session it is due in are all the same state.
 */
export function HomeworkPanel({ lesson, sessions, homework, todayISO, onUpdateAdmin }: Props) {
  const [title, setTitle] = useState('')
  const [details, setDetails] = useState('')
  const [target, setTarget] = useState('')
  const [dueISO, setDueISO] = useState('')
  const [error, setError] = useState<string | null>(null)

  const source = useMemo(() => {
    const byRef = lesson.sessionRef ? sessions.find((s) => sessionKey(s) === lesson.sessionRef) : undefined
    return byRef ?? null
  }, [lesson.sessionRef, sessions])
  const family = titleFamily(source?.title ?? lesson.subject ?? '')
  // With the exact occurrence linked, a later slot the same day counts. Without it we
  // only know the lesson's date, so the whole of that day is behind us.
  const after = source ? { dateISO: source.dateISO, start: source.start } : { dateISO: lesson.dateISO, start: '23:59' }
  const later = useMemo(() => laterOccurrences(sessions, family, after), [sessions, family, after.dateISO, after.start])
  const others = useMemo(
    () => upcomingOccurrences(sessions, family, after).filter((o) => !o.sameFamily).slice(0, 40),
    [sessions, family, after.dateISO, after.start]
  )
  const mine = homework.filter((h) => h.lessonId === lesson.id)
  const chosen = target && target !== 'date' ? sessions.find((s) => sessionKey(s) === target) ?? null : null

  const add = () => {
    setError(null)
    try {
      const rec = makeHomework({
        id: newAdminId(),
        title,
        details,
        lesson,
        sourceRef: lesson.sessionRef,
        target: chosen ? { key: sessionKey(chosen), session: chosen } : null,
        dueISO: target === 'date' || !chosen ? dueISO : undefined,
        todayISO,
        now: Date.now(),
      }) as HomeworkRec
      onUpdateAdmin((prev) => ({ ...prev, homework: [...(prev.homework ?? []), rec] }))
      setTitle('')
      setDetails('')
      setDueISO('')
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
  const remove = (h: HomeworkRec) => onUpdateAdmin((prev) => ({ ...prev, homework: (prev.homework ?? []).filter((x) => x.id !== h.id) }))

  return (
    <FieldGroup label="Homework set in this lesson" hint="Schedule it against a later occurrence of this lesson — it then shows on that session, on Tasks and on the Schedule.">
      {mine.length > 0 && (
        <ul className="setup-list" aria-label="Homework set">
          {mine.map((h) => (
            <li key={h.id} className="setup-row">
              <label className="toggle-row">
                <input type="checkbox" checked={h.status === 'done'} onChange={() => toggle(h)} />
                <span>
                  <span className={h.status === 'done' ? 'action-done' : undefined}>{h.title}</span>{' '}
                  <span className="filter-hint">
                    · due {h.dueTitle ? `in ${h.dueTitle} · ` : ''}
                    {fmtDay(h.dueISO)}
                    {h.status === 'done' && h.completedISO ? ` · completed ${fmtDay(h.completedISO)}` : ''}
                  </span>
                </span>
              </label>
              <span className="requirement-confirm">
                <button type="button" className="travel-link" aria-label={`Remove homework: ${h.title}`} onClick={() => remove(h)}>Remove</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <Field label="Homework">
        <input type="text" className="placement-input" placeholder="e.g. Fractions worksheet, questions 1–8" value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Details (optional)">
        <textarea className="note-input" rows={2} value={details} onChange={(e) => setDetails(e.target.value)} />
      </Field>
      <Field label="Due in" hint={later.length === 0 ? 'No later occurrence of this lesson in the timetable — choose another session or a date.' : undefined}>
        <select className="date-input" value={target} onChange={(e) => { setTarget(e.target.value); setError(null) }}>
          <option value="">Choose the session it is due in…</option>
          {later.length > 0 && (
            <optgroup label="Later occurrences of this lesson">
              {later.map((s) => (
                <option key={sessionKey(s)} value={sessionKey(s)}>{label(s)}</option>
              ))}
            </optgroup>
          )}
          {others.length > 0 && (
            <optgroup label="Other upcoming sessions">
              {others.map((o) => (
                <option key={sessionKey(o.session)} value={sessionKey(o.session)}>{label(o.session)}</option>
              ))}
            </optgroup>
          )}
          <option value="date">A date instead…</option>
        </select>
      </Field>
      {target === 'date' && (
        <Field label="Due date">
          <input type="date" className="date-input" value={dueISO} onChange={(e) => setDueISO(e.target.value)} />
        </Field>
      )}
      {error && <p className="filter-hint field-error" role="alert">{error}</p>}
      <div className="btn-row">
        <button type="button" className="btn-today-reset" disabled={!title.trim() || (!chosen && !(target === 'date' && dueISO))} onClick={add}>
          Add homework
        </button>
      </div>
    </FieldGroup>
  )
}

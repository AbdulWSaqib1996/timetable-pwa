import { useEffect, useMemo, useState } from 'react'
import { Field } from './ui'
import { laterOccurrences, upcomingOccurrences } from '../../shared/homework.js'
import { sessionKey } from '../lib/diff'
import type { Session } from '../types'

export type DueChoice = { target?: { key: string; session: Session } | null; dueISO?: string }
interface Props {
  /** eligible teaching occurrences only */
  sessions: Session[]
  family: string
  after: { dateISO: string; start?: string }
  /** the current (complete) choice, or null while nothing usable is chosen */
  onChange: (choice: DueChoice | null) => void
  /** when given, a button submits the current choice */
  onSubmit?: (choice: DueChoice) => void
  submitLabel?: string
  /** label prefix for the controls, to keep several choosers apart */
  idPrefix?: string
  suggestedLabel?: string
  /** reset the selection after a submit (a "use this for the next item" toggle keeps it) */
  resetKey?: number
}

const fmtDay = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}
export const occurrenceLabel = (s: Session) => `${s.title} · ${fmtDay(s.dateISO)}${s.start ? ` ${s.start}` : ''}${s.tutor ? ` · ${s.tutor}` : ''}${s.groups ? ` · group ${s.groups}` : ''}`

/**
 * HW-05: a searchable due-session chooser. Suggested later occurrences of the
 * same title family come first (a ranking hint, never proof of the same
 * module), then every eligible session, then a date. Nothing is capped at 40:
 * the filter narrows the whole timetable by title, date, tutor or group.
 */
export function DueChooser({ sessions, family, after, onChange, onSubmit, submitLabel = 'Use this', idPrefix = 'due', suggestedLabel = 'Later occurrences of this lesson', resetKey = 0 }: Props) {
  const [query, setQuery] = useState('')
  const [target, setTarget] = useState('')
  const [dueISO, setDueISO] = useState('')
  useEffect(() => {
    if (resetKey > 0) {
      setTarget('')
      setDueISO('')
    }
  }, [resetKey])
  const suggested = useMemo(() => laterOccurrences(sessions, family, after, 1000), [sessions, family, after.dateISO, after.start]) // eslint-disable-line react-hooks/exhaustive-deps
  const all = useMemo(() => upcomingOccurrences(sessions, family, after, 100000).filter((o) => !o.sameFamily).map((o) => o.session), [sessions, family, after.dateISO, after.start]) // eslint-disable-line react-hooks/exhaustive-deps
  const q = query.trim().toLowerCase()
  const hit = (s: Session) => !q || `${s.title} ${s.dateISO} ${fmtDay(s.dateISO)} ${s.tutor} ${s.groups} ${s.room}`.toLowerCase().includes(q)
  const shownSuggested = suggested.filter(hit)
  const shownAll = all.filter(hit)
  const chosen = target && target !== 'date' ? sessions.find((s) => sessionKey(s) === target) ?? null : null
  const staleChoice = target && target !== 'date' && !chosen
  const choice: DueChoice | null = chosen ? { target: { key: sessionKey(chosen), session: chosen } } : target === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(dueISO) ? { target: null, dueISO } : null
  useEffect(() => {
    onChange(choice)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, dueISO, chosen?.id])
  return (
    <div className="due-chooser">
      <Field label="Find a session">
        <input type="search" className="placement-input" aria-label={`${idPrefix} search`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. Maths, 22 Sept, Dr Lee" />
      </Field>
      <p className="filter-hint">Type a subject, date, tutor or group to narrow the list.</p>
      <Field label="Due in">
        <select className="date-input" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">Choose the session it is due in…</option>
          {shownSuggested.length > 0 && (
            <optgroup label={suggestedLabel}>
              {shownSuggested.map((s) => (
                <option key={sessionKey(s)} value={sessionKey(s)}>{occurrenceLabel(s)}</option>
              ))}
            </optgroup>
          )}
          {shownAll.length > 0 && (
            <optgroup label={`All eligible sessions (${shownAll.length})`}>
              {shownAll.map((s) => (
                <option key={sessionKey(s)} value={sessionKey(s)}>{occurrenceLabel(s)}</option>
              ))}
            </optgroup>
          )}
          <option value="date">A date instead…</option>
        </select>
      </Field>
      <p className="filter-hint">{suggested.length === 0 ? 'No later occurrence of this session in the timetable — choose another session or a date.' : `${suggested.length} later occurrence${suggested.length === 1 ? '' : 's'} of this session, then every other eligible session.`}</p>
      {q && (
        <ul className="due-results" aria-label="Matching sessions">
          {[...shownSuggested.map((s) => ({ s, suggested: true })), ...shownAll.map((s) => ({ s, suggested: false }))].slice(0, 25).map(({ s, suggested }) => (
            <li key={sessionKey(s)}>
              <button type="button" className={`workspace-row${target === sessionKey(s) ? ' is-selected' : ''}`} aria-pressed={target === sessionKey(s)} onClick={() => setTarget(sessionKey(s))}>
                <span>{occurrenceLabel(s)}</span>
                {suggested ? <span className="tag tag--teal">later occurrence</span> : null}
              </button>
            </li>
          ))}
          {shownSuggested.length + shownAll.length === 0 && <li className="filter-hint">No session matches “{query.trim()}”.</li>}
          {shownSuggested.length + shownAll.length > 25 && <li className="filter-hint">{shownSuggested.length + shownAll.length - 25} more — keep typing to narrow the list.</li>}
        </ul>
      )}
      {staleChoice && <p className="setup-error" role="alert">That session is no longer available — choose again.</p>}
      {target === 'date' && (
        <Field label="Due date">
          <input type="date" className="date-input" value={dueISO} onChange={(e) => setDueISO(e.target.value)} />
        </Field>
      )}
      {onSubmit && (
        <div className="btn-row">
          <button type="button" className="btn-primary" disabled={!choice} onClick={() => choice && onSubmit(choice)}>
            {submitLabel}
          </button>
        </div>
      )}
    </div>
  )
}

import { useState } from 'react'
import { newAdminId } from '../lib/admin'
import type { PlanChildRec } from '../lib/admin'
import { formatRemaining } from '../lib/format'
import { Field } from './ui'

interface Props {
  parentId: string
  children_: PlanChildRec[]
  /** does a proposed study block overlap a timetabled session/commitment? */
  busyCheck?: (dateISO: string, startTime: string, endTime: string) => boolean
  onSave: (rec: PlanChildRec) => void
  onDelete: (id: string) => void
}

/**
 * Work plan under one parent deadline (P5-05): subtasks, milestones and
 * optional study blocks, each with a stable id and revision. A milestone is
 * never a duplicate deadline and a block always references its parent —
 * nothing here creates a second Tasks entry.
 */
export function WorkPlanSection({ parentId, children_, busyCheck, onSave, onDelete }: Props) {
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<PlanChildRec['kind']>('subtask')
  const [dateISO, setDateISO] = useState('')
  const [startTime, setStartTime] = useState('17:00')
  const [endTime, setEndTime] = useState('18:00')
  const [effort, setEffort] = useState('')

  const mine = [...children_].sort((a, b) => (a.dateISO ?? '9999').localeCompare(b.dateISO ?? '9999') || a.title.localeCompare(b.title))
  const subtasks = mine.filter((c) => c.kind === 'subtask')
  const doneCount = subtasks.filter((c) => c.done).length
  const effortTotal = mine.reduce((n, c) => n + (c.effortMins ?? 0), 0)

  function add() {
    const trimmed = title.trim()
    if (!trimmed) return
    const rec: PlanChildRec = {
      id: newAdminId(),
      parentId,
      kind,
      title: trimmed,
      done: false,
      effortMins: effort.trim() ? Math.max(0, parseInt(effort, 10) || 0) : undefined,
      dateISO: kind === 'subtask' ? undefined : dateISO || undefined,
      startTime: kind === 'block' ? startTime : undefined,
      endTime: kind === 'block' ? endTime : undefined,
      at: Date.now(),
    }
    onSave(rec)
    setTitle('')
    setEffort('')
  }

  return (
    <section className="workplan">
      <h3 className="subheading">Work plan</h3>
      {subtasks.length > 0 && (
        <p className="filter-hint">
          {doneCount}/{subtasks.length} subtasks done
          {effortTotal > 0 ? ` · ~${formatRemaining(effortTotal)} estimated` : ''}
        </p>
      )}
      <ul className="workplan-list">
        {mine.map((c) => {
          const clash =
            c.kind === 'block' && c.dateISO && c.startTime && c.endTime && busyCheck
              ? busyCheck(c.dateISO, c.startTime, c.endTime)
              : false
          return (
            <li key={c.id} className="workplan-row">
              {c.kind === 'subtask' ? (
                <label className="workplan-check">
                  <input
                    type="checkbox"
                    checked={c.done === true}
                    onChange={(e) => onSave({ ...c, done: e.target.checked, at: Date.now() })}
                  />
                  <span className={c.done ? 'action-done' : ''}>{c.title}</span>
                </label>
              ) : (
                <span className="workplan-label">
                  {c.kind === 'milestone' ? '◆' : '⏱'} {c.title}
                  {c.dateISO && ` · ${c.dateISO.split('-').reverse().slice(0, 2).join('/')}`}
                  {c.kind === 'block' && c.startTime && ` ${c.startTime}–${c.endTime}`}
                  {clash && <span className="badge badge-conflict"> ⚠ clashes with a session</span>}
                </span>
              )}
              {(c.effortMins ?? 0) > 0 && <span className="filter-hint">~{formatRemaining(c.effortMins!)}</span>}
              <button type="button" className="btn-icon" aria-label={`Remove ${c.kind}`} onClick={() => onDelete(c.id)}>
                ✕
              </button>
            </li>
          )
        })}
      </ul>
      <div className="workplan-add">
        <Field label="Add to plan">
          <input
            type="text"
            placeholder={kind === 'subtask' ? 'Subtask…' : kind === 'milestone' ? 'Milestone…' : 'Study block…'}
            value={title}
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <div className="task-edit-row">
          <Field label="Type">
            <select className="date-input" value={kind} onChange={(e) => setKind(e.target.value as PlanChildRec['kind'])}>
              <option value="subtask">Subtask</option>
              <option value="milestone">Milestone</option>
              <option value="block">Study block</option>
            </select>
          </Field>
          <Field label="Effort (min)">
            <input type="number" className="date-input" min={0} max={6000} value={effort} onChange={(e) => setEffort(e.target.value)} />
          </Field>
        </div>
        {kind !== 'subtask' && (
          <div className="task-edit-row">
            <Field label="Date">
              <input type="date" className="date-input" value={dateISO} onChange={(e) => setDateISO(e.target.value)} />
            </Field>
            {kind === 'block' && (
              <>
                <Field label="Starts">
                  <input type="time" className="date-input" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                </Field>
                <Field label="Ends">
                  <input type="time" className="date-input" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                </Field>
              </>
            )}
          </div>
        )}
        <button type="button" className="btn-secondary" disabled={!title.trim()} onClick={add}>
          ＋ Add {kind}
        </button>
      </div>
    </section>
  )
}

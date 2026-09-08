import { useEffect, useRef, useState } from 'react'
import { needsScheduling, validatePlanChild } from '../../shared/planValidation.js'
import { newAdminId } from '../lib/admin'
import type { PlanChildRec } from '../lib/admin'
import { formatRemaining } from '../lib/format'
import { Field } from './ui'

export interface BlockPrefill {
  dateISO: string
  startTime: string
  endTime: string
  /** where the prefill came from, shown so the user knows it is a suggestion */
  reason?: string
}

interface Props {
  parentId: string
  children_: PlanChildRec[]
  /** does a proposed study block overlap a timetabled session/commitment? (ignores the block being edited) */
  busyCheck?: (dateISO: string, startTime: string, endTime: string, ignorePlanId?: string) => boolean
  onSave: (rec: PlanChildRec) => void
  onDelete: (id: string) => void
  /** open straight into editing this child (NF-02: a calendar projection opens its block) */
  focusPlanId?: string
  /** prefill a NEW study block from a Plan-week suggestion (NF-03) — nothing saved until Add */
  prefillBlock?: BlockPrefill
}

const emptyForm = { title: '', kind: 'subtask' as PlanChildRec['kind'], dateISO: '', startTime: '17:00', endTime: '18:00', effort: '' }

/**
 * Work plan under one parent deadline (P5-05; R4 / NF-02 editing): subtasks,
 * milestones and optional study blocks, each with a stable id and revision.
 * A milestone is never a duplicate deadline and a block always references
 * its parent — nothing here creates a second Tasks entry. Existing children
 * are edited in place (same id, new revision) so every calendar projection
 * of a block follows the edit.
 */
export function WorkPlanSection({ parentId, children_, busyCheck, onSave, onDelete, focusPlanId, prefillBlock }: Props) {
  const [form, setForm] = useState(() =>
    prefillBlock
      ? { ...emptyForm, kind: 'block' as const, dateISO: prefillBlock.dateISO, startTime: prefillBlock.startTime, endTime: prefillBlock.endTime }
      : emptyForm
  )
  const { title, kind, dateISO, startTime, endTime, effort } = form
  const patch = (p: Partial<typeof emptyForm>) => setForm((f) => ({ ...f, ...p }))
  /** id of the child being edited; null = adding */
  const [editingId, setEditingId] = useState<string | null>(null)

  const mine = [...children_].sort((a, b) => (a.dateISO ?? '9999').localeCompare(b.dateISO ?? '9999') || a.title.localeCompare(b.title))
  const subtasks = mine.filter((c) => c.kind === 'subtask')
  const doneCount = subtasks.filter((c) => c.done).length
  const effortTotal = mine.reduce((n, c) => n + (c.effortMins ?? 0), 0)

  const [errors, setErrors] = useState<Record<string, string>>({})
  const titleRef = useRef<HTMLInputElement>(null)
  const dateRef = useRef<HTMLInputElement>(null)
  const startRef = useRef<HTMLInputElement>(null)
  const endRef = useRef<HTMLInputElement>(null)
  const effortRef = useRef<HTMLInputElement>(null)

  function startEdit(c: PlanChildRec, focus: 'title' | 'start' = 'title') {
    setEditingId(c.id)
    setErrors({})
    setForm({
      title: c.title,
      kind: c.kind,
      dateISO: c.dateISO ?? '',
      startTime: c.startTime ?? '17:00',
      endTime: c.endTime ?? '18:00',
      effort: c.effortMins ? String(c.effortMins) : '',
    })
    // Focus after the form re-renders for the chosen kind.
    setTimeout(() => (focus === 'start' ? startRef : titleRef).current?.focus(), 0)
  }

  // NF-02: a calendar projection opens its own block, ready to edit.
  useEffect(() => {
    if (!focusPlanId) return
    const target = children_.find((c) => c.id === focusPlanId)
    if (target) startEdit(target, 'start')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusPlanId])

  useEffect(() => {
    if (prefillBlock) setTimeout(() => titleRef.current?.focus(), 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function cancelEdit() {
    setEditingId(null)
    setErrors({})
    setForm(emptyForm)
  }

  function submit() {
    const trimmed = title.trim()
    const existing = editingId ? children_.find((c) => c.id === editingId) : undefined
    const rec: PlanChildRec = {
      id: existing?.id ?? newAdminId(),
      parentId,
      kind,
      title: trimmed,
      done: existing?.done ?? false,
      effortMins: effort.trim() ? parseInt(effort, 10) : undefined,
      dateISO: kind === 'subtask' ? undefined : dateISO || undefined,
      startTime: kind === 'block' ? startTime : undefined,
      endTime: kind === 'block' ? endTime : undefined,
      at: Date.now(),
    }
    // Shared validation (TT-10): nothing impossible can commit; the first
    // failing field is named and focused.
    const check = validatePlanChild(rec)
    if (!check.ok) {
      setErrors(check.errors)
      const first = Object.keys(check.errors)[0]
      ;({ title: titleRef, dateISO: dateRef, startTime: startRef, endTime: endRef, effortMins: effortRef }[first] ?? titleRef).current?.focus()
      return
    }
    setErrors({})
    onSave(rec)
    setEditingId(null)
    setForm(emptyForm)
  }

  const kindLabel = kind === 'subtask' ? 'subtask' : kind === 'milestone' ? 'milestone' : 'block'

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
          // A stored item that fails today's validation is kept and flagged
          // for correction — never deleted, never drawn as a timed block.
          const invalid = needsScheduling(c)
          const clash =
            !invalid && c.kind === 'block' && c.dateISO && c.startTime && c.endTime && busyCheck
              ? busyCheck(c.dateISO, c.startTime, c.endTime, c.id)
              : false
          return (
            <li key={c.id} className={`workplan-row${editingId === c.id ? ' workplan-row-editing' : ''}`}>
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
                  {c.kind === 'block' && c.done && <span className="badge badge-personal"> done</span>}
                  {invalid && <span className="badge badge-conflict"> Needs scheduling</span>}
                  {clash && <span className="badge badge-conflict"> ⚠ clashes with a session</span>}
                </span>
              )}
              {(c.effortMins ?? 0) > 0 && <span className="filter-hint">~{formatRemaining(c.effortMins!)}</span>}
              {c.kind === 'block' && (
                <label className="workplan-check workplan-done">
                  <input
                    type="checkbox"
                    checked={c.done === true}
                    aria-label={`Mark study block “${c.title}” done`}
                    onChange={(e) => onSave({ ...c, done: e.target.checked, at: Date.now() })}
                  />
                </label>
              )}
              <button type="button" className="btn-icon" aria-label={`Edit ${c.kind} “${c.title}”`} onClick={() => startEdit(c)}>
                ✎
              </button>
              <button type="button" className="btn-icon" aria-label={`Remove ${c.kind}`} onClick={() => onDelete(c.id)}>
                ✕
              </button>
            </li>
          )
        })}
      </ul>
      <div className="workplan-add">
        {prefillBlock && !editingId && (
          <p className="filter-hint">
            Prefilled from Plan week{prefillBlock.reason ? ` — ${prefillBlock.reason}` : ''}. Nothing is saved until you add it.
          </p>
        )}
        <Field label={editingId ? `Edit ${kindLabel}` : 'Add to plan'}>
          <input
            ref={titleRef}
            aria-invalid={!!errors.title}
            type="text"
            placeholder={kind === 'subtask' ? 'Subtask…' : kind === 'milestone' ? 'Milestone…' : 'Study block…'}
            value={title}
            maxLength={120}
            onChange={(e) => patch({ title: e.target.value })}
          />
        </Field>
        <div className="task-edit-row">
          <Field label="Type">
            <select className="date-input" value={kind} onChange={(e) => patch({ kind: e.target.value as PlanChildRec['kind'] })}>
              <option value="subtask">Subtask</option>
              <option value="milestone">Milestone</option>
              <option value="block">Study block</option>
            </select>
          </Field>
          <Field label="Effort (min)">
            <input
              ref={effortRef}
              aria-invalid={!!errors.effortMins}
              type="number"
              className="date-input"
              min={0}
              max={6000}
              value={effort}
              onChange={(e) => patch({ effort: e.target.value })}
            />
          </Field>
        </div>
        {kind !== 'subtask' && (
          <div className="task-edit-row">
            <Field label="Date">
              <input ref={dateRef} type="date" className="date-input" value={dateISO} aria-invalid={!!errors.dateISO} onChange={(e) => patch({ dateISO: e.target.value })} />
            </Field>
            {kind === 'block' && (
              <>
                <Field label="Starts">
                  <input ref={startRef} type="time" className="date-input" value={startTime} aria-invalid={!!errors.startTime} onChange={(e) => patch({ startTime: e.target.value })} />
                </Field>
                <Field label="Ends">
                  <input ref={endRef} type="time" className="date-input" value={endTime} aria-invalid={!!errors.endTime} onChange={(e) => patch({ endTime: e.target.value })} />
                </Field>
              </>
            )}
          </div>
        )}
        {Object.keys(errors).length > 0 && (
          <p className="setup-error" role="alert">
            {Object.values(errors)[0]}
          </p>
        )}
        <div className="btn-row">
          <button type="button" className="btn-secondary" disabled={!title.trim()} onClick={submit}>
            {editingId ? `Save ${kindLabel}` : `＋ Add ${kindLabel}`}
          </button>
          {editingId && (
            <button type="button" className="btn-ghost" onClick={cancelEdit}>
              Cancel edit
            </button>
          )}
        </div>
      </div>
    </section>
  )
}

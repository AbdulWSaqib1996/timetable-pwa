import { useMemo, useState } from 'react'
import { PLAN_RANGE_END, PLAN_RANGE_START, hhmm, suggestPlanWeek } from '../../shared/planWeek.js'
import type { TaskRecord } from '../lib/admin'
import type { Settings } from '../types'
import { Dialog, Field } from './ui'

export interface BusyInterval {
  d: string
  from: number
  to: number
  label: string
  kind: 'session' | 'personal' | 'plan' | 'free'
}

export interface PlanPrefill {
  dateISO: string
  startTime: string
  endTime: string
  reason: string
}

interface Props {
  anchorISO: string
  todayISO: string
  busy: BusyInterval[]
  deadlines: { d: string; title: string }[]
  settings: Settings
  /** open tasks a block can belong to */
  tasks: TaskRecord[]
  onUpdateSettings: (patch: Partial<Settings>) => void
  onPlanForTask: (taskId: string, prefill: PlanPrefill) => void
  onPlanPersonal: (prefill: PlanPrefill) => void
  onClose: () => void
}

const dayLabel = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}
const hours = (mins: number) => (mins === 0 ? '0h' : mins % 60 === 0 ? `${mins / 60}h` : `${Math.floor(mins / 60)}h ${mins % 60}m`)
const toMins = (hhmmStr: string) => {
  const [h, m] = hhmmStr.split(':').map(Number)
  return h * 60 + m
}

/**
 * "Plan week" (R4 / NF-03): classes, personal busy time, validated work
 * blocks and deadlines for the anchored week, with available gaps offered
 * as SUGGESTIONS. Every suggestion says why it fits and what was excluded;
 * choosing one only prefills an editor — nothing is created here.
 */
export function PlanWeekSheet({ anchorISO, todayISO, busy, deadlines, settings, tasks, onUpdateSettings, onPlanForTask, onPlanPersonal, onClose }: Props) {
  const start = settings.planRangeStart ?? PLAN_RANGE_START
  const end = settings.planRangeEnd ?? PLAN_RANGE_END
  const [target, setTarget] = useState<string>('personal')
  const plan = useMemo(
    () => suggestPlanWeek({ anchorISO, busy, deadlines, options: { start, end, quietFrom: settings.quietFrom, quietTo: settings.quietTo } }),
    [anchorISO, busy, deadlines, start, end, settings.quietFrom, settings.quietTo]
  )
  const weekDeadlines = deadlines.filter((k) => k.d >= plan.monday && k.d <= plan.days[6]).sort((a, b) => a.d.localeCompare(b.d))
  const openTasks = tasks.filter((t) => t.status !== 'done').sort((a, b) => a.dueISO.localeCompare(b.dueISO))

  const choose = (s: (typeof plan.suggestions)[number]) => {
    const prefill: PlanPrefill = { dateISO: s.d, startTime: hhmm(s.from), endTime: hhmm(s.to), reason: s.reasons[0] }
    if (target === 'personal') onPlanPersonal(prefill)
    else onPlanForTask(target, prefill)
  }

  return (
    <Dialog label="Plan week" onClose={onClose} className="plan-week-sheet">
      <div className="sheet-header">
        <h2>Plan week</h2>
        <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <p className="filter-hint">
        Week of {dayLabel(plan.monday)}. Gaps are suggestions from what is on your timetable now — not guaranteed free
        time. Choosing one prefills an editor; nothing is saved until you add it.
      </p>

      <div className="task-edit-row plan-week-range">
        <Field label="Plan from">
          <input
            type="time"
            className="date-input"
            value={hhmm(start)}
            onChange={(e) => e.target.value && onUpdateSettings({ planRangeStart: toMins(e.target.value) })}
          />
        </Field>
        <Field label="until">
          <input
            type="time"
            className="date-input"
            value={hhmm(end)}
            onChange={(e) => e.target.value && onUpdateSettings({ planRangeEnd: toMins(e.target.value) })}
          />
        </Field>
        <Field label="Plan as">
          <select className="date-input" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Plan as">
            <option value="personal">Personal study block</option>
            {openTasks.map((t) => (
              <option key={t.id} value={t.id}>
                Block for “{t.title}” (due {t.dueISO})
              </option>
            ))}
          </select>
        </Field>
      </div>

      {weekDeadlines.length > 0 && (
        <p className="filter-hint plan-week-deadlines">
          Due this week: {weekDeadlines.map((k) => `${k.title} (${dayLabel(k.d)})`).join(' · ')}
        </p>
      )}

      <ul className="plan-week-workload" aria-label="Workload by day">
        {plan.workload.map((w) => (
          <li key={w.d} className={w.d === todayISO ? 'today' : ''}>
            <span className="plan-week-day">{dayLabel(w.d)}</span>
            <span className="filter-hint">
              {hours(w.timetabledMins)} timetabled · {hours(w.plannedMins)} planned · {hours(w.personalMins)} personal
            </span>
          </li>
        ))}
      </ul>

      <h3 className="subheading">Suggested gaps</h3>
      {plan.suggestions.length === 0 ? (
        <p className="filter-hint">No gap of at least {plan.minMins} minutes between {hhmm(start)} and {hhmm(end)} this week.</p>
      ) : (
        <ul className="plan-week-suggestions" aria-label="Suggested gaps">
          {plan.suggestions.map((s) => (
            <li key={`${s.d}-${s.from}`}>
              <button type="button" className="plan-week-suggestion" onClick={() => choose(s)}>
                <span className="plan-week-when">
                  {dayLabel(s.d)} · {hhmm(s.from)}–{hhmm(s.to)} <span className="filter-hint">({hours(s.mins)}, estimate)</span>
                </span>
                <span className="filter-hint">{s.reasons.join(' · ')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="filter-hint">
        Not counted as free: {plan.excluded.length > 0 ? plan.excluded.join('; ') : 'nothing beyond your busy time'}. Blocks of at most{' '}
        {plan.maxMins} minutes are suggested at a time.
      </p>
    </Dialog>
  )
}

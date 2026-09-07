import { useState } from 'react'
import { Card, Dialog, EmptyState, Field, PageHeader } from '../../components/ui'
import { newAdminId } from '../../lib/admin'
import type { PlacementExceptionRec } from '../../lib/admin'
import { placementBlocks, placementPolicy } from '../../lib/placement'
import type { PlacementDayView } from '../../lib/placement'
import { formatRemaining } from '../../lib/format'
import type { MetaMap, Session, Settings } from '../../types'
import { sessionKey } from '../../lib/diff'

interface Props {
  profileName: string
  settings: Settings
  /** course sessions BEFORE exception filtering (the raw plan) */
  sessions: Session[]
  exceptions: PlacementExceptionRec[]
  metaMap: MetaMap
  todayISO: string
  onSaveException: (rec: PlacementExceptionRec) => void
  onDeleteException: (id: string) => void
  onUpdateSettings: (patch: Partial<Settings>) => void
  onBack: () => void
}

const fmt = (dateISO: string) => {
  const [y, m, d] = dateISO.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

const KIND_LABEL: Record<string, string> = {
  holiday: 'School holiday',
  inset: 'Inset/training day',
  'part-day': 'Part day',
  cancelled: 'Cancelled',
  hours: 'Hours correction',
}

const hoursLabel = (mins: number) => formatRemaining(mins)

/**
 * Placement overview (P5-03): planned vs logged days/hours per block, a day
 * list with explicit statuses (never colour alone), and a per-date exception/
 * log form. Inferred days say so until confirmed; the inset policy is an
 * explicit choice, not an assumption.
 */
export function PlacementPage({
  profileName,
  settings,
  sessions,
  exceptions,
  metaMap,
  todayISO,
  onSaveException,
  onDeleteException,
  onUpdateSettings,
  onBack,
}: Props) {
  const policy = placementPolicy(settings)
  const blocks = placementBlocks(sessions, exceptions, settings, (s) => metaMap[sessionKey(s)])
  const [editDay, setEditDay] = useState<PlacementDayView | null>(null)

  const dayStatus = (d: PlacementDayView): string => {
    if (d.excluded) return `${KIND_LABEL[d.exception!.kind]} — not counted`
    const bits: string[] = []
    if (d.exception?.kind === 'inset') bits.push('inset day (counts under your policy)')
    if (d.exception?.kind === 'part-day' || d.exception?.kind === 'hours')
      bits.push(`${KIND_LABEL[d.exception.kind]} · planned ${hoursLabel(d.plannedMins)}`)
    if (d.loggedMins !== null)
      bits.push(
        d.loggedFrom === 'correction'
          ? `logged ${hoursLabel(d.loggedMins)} (corrected)`
          : `logged ${hoursLabel(d.loggedMins)} (whole-day tick — not minute-accurate)`
      )
    else if (d.absent) bits.push('absent recorded')
    else bits.push(d.dateISO <= todayISO ? 'unrecorded' : 'planned')
    if (d.inferred) bits.push('inferred from timetable')
    return bits.join(' · ')
  }

  return (
    <div className="page page-placement">
      <button type="button" className="page-back" onClick={onBack}>
        ‹ PGCE file
      </button>
      <PageHeader title="Placement" subtitle={profileName} />

      <Card>
        <h3 className="subheading">Working hours & policy</h3>
        <div className="task-edit-row">
          <Field label="Day starts">
            <input
              type="time"
              className="date-input"
              value={policy.start}
              onChange={(e) =>
                onUpdateSettings({ placementHours: { ...settings.placementHours, start: e.target.value || '08:30', end: policy.end } })
              }
            />
          </Field>
          <Field label="Day ends">
            <input
              type="time"
              className="date-input"
              value={policy.end}
              onChange={(e) =>
                onUpdateSettings({ placementHours: { ...settings.placementHours, start: policy.start, end: e.target.value || '15:45' } })
              }
            />
          </Field>
          <Field label="Break (min)">
            <input
              type="number"
              className="date-input"
              min={0}
              max={240}
              value={policy.breakMins}
              onChange={(e) =>
                onUpdateSettings({
                  placementHours: {
                    start: policy.start,
                    end: policy.end,
                    breakMins: Math.max(0, Math.min(240, parseInt(e.target.value, 10) || 0)),
                  },
                })
              }
            />
          </Field>
        </div>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={policy.insetCounts}
            onChange={(e) => onUpdateSettings({ placementInsetCounts: e.target.checked })}
          />
          Inset/training days count toward planned school days
        </label>
        <p className="filter-hint">
          Courses differ on inset days — this choice is applied everywhere (statistics, calendar,
          binder) rather than assumed.
        </p>
      </Card>

      {blocks.length === 0 && (
        <EmptyState
          title="No placement blocks yet"
          hint="Placement blocks detected in your timetable appear here with planned vs logged days and hours."
        />
      )}

      {blocks.map((b) => (
        <Card key={b.tag} className="placement-block">
          <div className="pgce-section-head">
            <h2>{b.tag}</h2>
            <span className="filter-hint">
              Planned {b.plannedDays} day{b.plannedDays === 1 ? '' : 's'} ({hoursLabel(b.plannedMins)}) ·
              Logged {b.loggedDays} day{b.loggedDays === 1 ? '' : 's'} ({hoursLabel(b.loggedMins)})
            </span>
          </div>
          {b.inferredDays > 0 && (
            <p className="filter-hint">
              {b.inferredDays} day{b.inferredDays === 1 ? ' is' : 's are'} inferred from the block's date
              range — confirm or correct them below.
            </p>
          )}
          {b.excludedDays > 0 && (
            <p className="filter-hint">{b.excludedDays} excluded (holiday/cancelled{policy.insetCounts ? '' : '/inset'}).</p>
          )}
          <ul className="placement-day-list">
            {b.days.map((d) => (
              <li key={d.dateISO}>
                <button type="button" className="placement-day-row" onClick={() => setEditDay(d)}>
                  <span className={`placement-day-date${d.excluded ? ' excluded' : ''}`}>{fmt(d.dateISO)}</span>
                  <span className="placement-day-status">{dayStatus(d)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ))}

      {editDay && (
        <ExceptionDialog
          day={editDay}
          policy={policy}
          onSave={(rec) => {
            onSaveException(rec)
            setEditDay(null)
          }}
          onDelete={(id) => {
            onDeleteException(id)
            setEditDay(null)
          }}
          onClose={() => setEditDay(null)}
        />
      )}
    </div>
  )
}

function ExceptionDialog({
  day,
  policy,
  onSave,
  onDelete,
  onClose,
}: {
  day: PlacementDayView
  policy: { start: string; end: string }
  onSave: (rec: PlacementExceptionRec) => void
  onDelete: (id: string) => void
  onClose: () => void
}) {
  const existing = day.exception
  const [kind, setKind] = useState<PlacementExceptionRec['kind'] | 'none'>(existing?.kind ?? 'none')
  const [startTime, setStartTime] = useState(existing?.startTime ?? policy.start)
  const [endTime, setEndTime] = useState(existing?.endTime ?? policy.end)
  const [logged, setLogged] = useState(existing?.loggedMins != null ? String(existing.loggedMins) : '')
  const [note, setNote] = useState(existing?.note ?? '')
  const [error, setError] = useState<string | null>(null)

  function save() {
    setError(null)
    const loggedMins = logged.trim() === '' ? undefined : parseInt(logged, 10)
    if (loggedMins !== undefined && (!Number.isInteger(loggedMins) || loggedMins < 0 || loggedMins > 1440)) {
      setError('Logged minutes must be between 0 and 1440.')
      return
    }
    if (kind === 'none') {
      if (loggedMins === undefined) {
        if (existing) onDelete(existing.id)
        else onClose()
        return
      }
      // A pure hours correction without another exception kind.
      onSave({
        id: existing?.id ?? newAdminId(),
        tag: day.tag,
        dateISO: day.dateISO,
        kind: 'hours',
        loggedMins,
        note: note.trim() || undefined,
        at: Date.now(),
      })
      return
    }
    if ((kind === 'part-day' || kind === 'hours') && startTime && endTime && startTime >= endTime) {
      setError('The day must end after it starts.')
      return
    }
    onSave({
      id: existing?.id ?? newAdminId(),
      tag: day.tag,
      dateISO: day.dateISO,
      kind,
      startTime: kind === 'part-day' || kind === 'hours' ? startTime : undefined,
      endTime: kind === 'part-day' || kind === 'hours' ? endTime : undefined,
      loggedMins,
      note: note.trim() || undefined,
      at: Date.now(),
    })
  }

  return (
    <Dialog label={`Placement day ${day.dateISO}`} onClose={onClose}>
      <div className="sheet-header">
        <h2>
          {day.tag} · {fmt(day.dateISO)}
        </h2>
        <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      {day.inferred && (
        <p className="filter-hint">This day was inferred from the block's date range in the sheet.</p>
      )}
      <Field label="Exception">
        <select className="date-input" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="none">None — normal school day</option>
          <option value="holiday">School holiday (not counted)</option>
          <option value="inset">Inset/training day (policy decides)</option>
          <option value="part-day">Part day (custom hours)</option>
          <option value="cancelled">Cancelled (not counted)</option>
          <option value="hours">Different working hours</option>
        </select>
      </Field>
      {(kind === 'part-day' || kind === 'hours') && (
        <div className="task-edit-row">
          <Field label="Starts">
            <input type="time" className="date-input" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </Field>
          <Field label="Ends">
            <input type="time" className="date-input" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </Field>
        </div>
      )}
      <Field
        label="Logged minutes (optional correction)"
        hint="Overrides the whole-day tick with what you actually did — leave empty to keep day-level logging."
      >
        <input
          type="number"
          className="date-input"
          min={0}
          max={1440}
          value={logged}
          onChange={(e) => setLogged(e.target.value)}
        />
      </Field>
      <Field label="Note">
        <input type="text" className="placement-input" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {error && (
        <p className="setup-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button type="button" className="btn-primary" onClick={save}>
          Save day
        </button>
        {existing && (
          <button type="button" className="btn-secondary" onClick={() => onDelete(existing.id)}>
            Remove exception
          </button>
        )}
        <button type="button" className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  )
}

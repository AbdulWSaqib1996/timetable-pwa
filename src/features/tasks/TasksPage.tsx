import { useState } from 'react'
import { EmptyState, IconArrowRight, IconCheck, IconPlus, IconSearch, PageHeader, SettingsAction, StatusMessage } from '../../components/ui'
import type { Meeting, TaskRecord } from '../../lib/admin'
import { sessionKey } from '../../lib/diff'
import { daysUntil } from '../../lib/format'
import type { MetaMap, Session, SessionMeta } from '../../types'

interface Props {
  profileName: string
  /** merged key dates: sheet-imported sessions + personal tasks-as-sessions */
  keyDates: Session[]
  /** the personal task records behind `custom-` entries */
  tasks: TaskRecord[]
  /** mentor meetings — open actions project here as linked work (P5-01) */
  meetings: Meeting[]
  todayISO: string
  configured: boolean
  metaMap: MetaMap
  undoTask: TaskRecord | null
  onUndoDelete: (task: TaskRecord) => void
  onSelect: (session: Session) => void
  onSetStatus: (kd: Session, status: SessionMeta['status']) => void
  onEditTask: (task: TaskRecord) => void
  onSetTaskStatus: (task: TaskRecord, status: NonNullable<SessionMeta['status']>) => void
  onToggleAction: (meetingId: string, actionId: string) => void
  /** open the meeting record an action belongs to (TT-20: link back to the owner) */
  onOpenMeeting: (meetingId: string) => void
  onAddTask: () => void
  onOpenSettings: () => void
}

function formatDate(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function weekday(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long' })
}

/** The due badge text (V2): plain words, the full date stays in the meta line. */
export function dueBadge(days: number, status: SessionMeta['status']): string {
  if (status === 'done') return 'Completed'
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`
  if (days === 0) return 'Due today'
  if (days === 1) return 'Due tomorrow'
  return `Due in ${days} days`
}

/**
 * Tasks destination (P4-07 + P5-01; R3 / TT-20; V2 cards): Overdue / Today /
 * Upcoming / Completed over imported deadlines AND editable personal task
 * records, plus open mentor actions projected as linked work (completion
 * updates the meeting record — there is exactly one owner). Overdue is
 * derived, never a copied record. Order: overdue oldest first, today by due
 * time, upcoming by due date, completed newest completion first (falling back
 * to the due date when no completion date is known — no invented timestamp).
 */
export function TasksPage({
  profileName,
  keyDates,
  tasks,
  meetings,
  todayISO,
  configured,
  metaMap,
  undoTask,
  onUndoDelete,
  onSelect,
  onSetStatus,
  onEditTask,
  onSetTaskStatus,
  onToggleAction,
  onOpenMeeting,
  onAddTask,
  onOpenSettings,
}: Props) {
  const [query, setQuery] = useState('')
  const taskById = new Map(tasks.map((t) => [t.id, t]))
  const recordOf = (k: Session): TaskRecord | undefined =>
    k.id.startsWith('custom-') ? taskById.get(k.id.slice('custom-'.length)) : undefined
  const statusOf = (k: Session): SessionMeta['status'] =>
    recordOf(k)?.status ?? metaMap[sessionKey(k)]?.status ?? 'todo'
  const noteOf = (k: Session) => recordOf(k)?.notes ?? metaMap[sessionKey(k)]?.note ?? ''

  const needle = query.trim().toLowerCase()
  const matches = (k: Session) => !needle || `${k.title} ${noteOf(k)}`.toLowerCase().includes(needle)

  const sorted = [...keyDates].sort((a, b) => (a.dateISO + a.start).localeCompare(b.dateISO + b.start))
  const outstandingAll = sorted.filter((k) => statusOf(k) !== 'done')
  const completedAll = sorted.filter((k) => statusOf(k) === 'done')
  const overdueAll = outstandingAll.filter((k) => k.dateISO < todayISO)
  const overdue = overdueAll.filter(matches)
  const dueToday = outstandingAll.filter((k) => k.dateISO === todayISO && matches(k))
  const upcoming = outstandingAll.filter((k) => k.dateISO > todayISO && matches(k))
  const completed = completedAll
    .filter(matches)
    .sort((a, b) => (recordOf(b)?.completedISO ?? b.dateISO).localeCompare(recordOf(a)?.completedISO ?? a.dateISO))
  const nextFortnight = outstandingAll.filter((k) => k.dateISO >= todayISO && daysUntil(k.dateISO, todayISO) <= 14).length
  const openActions = meetings.flatMap((m) =>
    m.actions.filter((a) => !a.done && (!needle || a.text.toLowerCase().includes(needle))).map((a) => ({ meeting: m, action: a }))
  )
  const nothingMatches = needle && overdue.length + dueToday.length + upcoming.length + completed.length + openActions.length === 0

  const row = (k: Session) => {
    const days = daysUntil(k.dateISO, todayISO)
    const status = statusOf(k)
    const record = recordOf(k)
    const note = noteOf(k)
    const overdueNow = status !== 'done' && days < 0
    const soon = status !== 'done' && days >= 0 && days <= 7
    const dueLine =
      status === 'done' && record?.completedISO
        ? `Completed ${formatDate(record.completedISO)} · due ${formatDate(k.dateISO)}`
        : `Due ${formatDate(k.dateISO)}${k.start ? ` · ${k.start}` : ''}`
    return (
      <li key={k.id} className={`task-card${status === 'done' ? ' kd-done' : ''}${overdueNow ? ' task-card-overdue' : ''}`}>
        <div className="keydate-line">
          <button
            type="button"
            className="keydate-row"
            aria-label={`${k.title}, ${dueBadge(days, status).toLowerCase()}, ${dueLine.toLowerCase()}. Open`}
            onClick={() => (record ? onEditTask(record) : onSelect(k))}
          >
            <span className="task-card-top">
              <span className={`kd-chip${overdueNow ? ' kd-chip-overdue' : soon ? ' urgent' : ''}${status === 'done' ? ' kd-chip-done' : ''}`}>
                {dueBadge(days, status)}
                {soon && days > 1 ? ` · ${weekday(k.dateISO)}` : ''}
              </span>
              <span className="badge badge-source">{record ? 'Your task' : 'Key date'}</span>
            </span>
            <span className="change-title task-card-title">{k.title}</span>
            <span className="change-meta">
              {dueLine}
              {status === 'doing' && ' · in progress'}
              {note && ` — ${note}`}
            </span>
            <span className={`task-card-open${overdueNow ? ' task-card-open--primary' : ''}`} aria-hidden="true">
              <IconArrowRight size={16} /> {overdueNow ? 'Review task' : 'Open task'}
            </span>
          </button>
          <span className="kd-actions">
            <select
              className={`kd-status kd-status-${status}`}
              aria-label={`Status for ${k.title}`}
              value={status ?? 'todo'}
              onChange={(e) => {
                const next = e.target.value as 'todo' | 'doing' | 'done'
                if (record) onSetTaskStatus(record, next)
                else onSetStatus(k, next)
              }}
            >
              <option value="todo">To do</option>
              <option value="doing">In progress</option>
              <option value="done">Done</option>
            </select>
          </span>
        </div>
      </li>
    )
  }

  return (
    <div className="page page-tasks">
      <PageHeader
        title="Tasks"
        subtitle={`${profileName} · your deadlines, with a clear next step`}
        actions={
          <>
            <button type="button" className="btn-primary" onClick={onAddTask}>
              <IconPlus />
              Add task
            </button>
            <SettingsAction onOpen={onOpenSettings} />
          </>
        }
      />

      {undoTask && (
        <StatusMessage tone="info">
          <span>
            Deleted “{undoTask.title}”.{' '}
            <button type="button" className="travel-link" onClick={() => onUndoDelete(undoTask)}>
              Undo
            </button>
          </span>
        </StatusMessage>
      )}

      {keyDates.length === 0 && openActions.length === 0 && !needle && (
        <EmptyState
          title={configured ? 'No tasks yet' : 'No tasks here yet'}
          hint={
            configured
              ? 'Deadlines from your key-dates tab and personal tasks will appear here.'
              : 'Connect your submissions/key-dates tab in Settings → My timetable, or add your own tasks — they get the same reminders.'
          }
          action={
            <button type="button" className="btn-secondary" onClick={onAddTask}>
              Add your first task
            </button>
          }
        />
      )}

      {(keyDates.length > 0 || openActions.length > 0 || needle) && (
        <div className="task-summary">
          {overdueAll.length > 0 && (
            <span className="kd-chip kd-chip-overdue" aria-label={`${overdueAll.length} overdue`}>
              {overdueAll.length} overdue
            </span>
          )}
          <span className="kd-chip" aria-label={`${outstandingAll.length} outstanding`}>
            {outstandingAll.length} outstanding
          </span>
          <span className="kd-chip kd-chip-done" aria-label={`${completedAll.length} completed`}>
            {completedAll.length} completed
          </span>
        </div>
      )}
      {(keyDates.length > 0 || openActions.length > 0 || needle) && (
        <div className="searchbox">
          <IconSearch />
          <input
            type="search"
            className="task-search"
            aria-label="Search tasks"
            placeholder="Search tasks"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}

      {nothingMatches && <p className="filter-hint">No tasks match “{query.trim()}”.</p>}

      {overdue.length > 0 && (
        <section aria-label="Overdue tasks">
          <h3 className="subheading">Needs attention</h3>
          <p className="workload-line heavy">
            {overdue.length} overdue deadline{overdue.length === 1 ? '' : 's'} still outstanding.
          </p>
          <ul className="keydates-list">{overdue.map(row)}</ul>
        </section>
      )}

      {dueToday.length > 0 && (
        <section aria-label="Due today">
          <h3 className="subheading">Due today</h3>
          <ul className="keydates-list">{dueToday.map(row)}</ul>
        </section>
      )}

      {upcoming.length > 0 && (
        <section aria-label="Upcoming tasks">
          <h3 className="subheading">Coming up</h3>
          <p className={`workload-line${nextFortnight >= 3 ? ' heavy' : ''}`}>
            {nextFortnight === 0
              ? 'Nothing due in the next 14 days.'
              : `${nextFortnight} due in the next 14 days${nextFortnight >= 3 ? ' — busy stretch ahead' : ''}.`}
          </p>
          <ul className="keydates-list">{upcoming.map(row)}</ul>
        </section>
      )}

      {openActions.length > 0 && (
        <section aria-label="Mentor actions">
          <h3 className="subheading">From mentor meetings</h3>
          <p className="filter-hint">
            Ticking one here completes it on the meeting record — there is only ever one copy. Untick to reopen it.
          </p>
          <ul className="keydates-list">
            {openActions.map(({ meeting, action }) => (
              <li key={`${meeting.id}:${action.id}`} className="task-card">
                <div className="keydate-line">
                  <label className="keydate-line mentor-action-row">
                    <input
                      type="checkbox"
                      checked={action.done}
                      aria-label={`Mark “${action.text}” complete`}
                      onChange={() => onToggleAction(meeting.id, action.id)}
                    />
                    <div className="change-body">
                      <span className="change-title">{action.text}</span>
                      <span className="change-meta">Mentor action · meeting {formatDate(meeting.dateISO)}</span>
                    </div>
                  </label>
                  <span className="kd-actions">
                    <button type="button" className="btn-today-reset" onClick={() => onOpenMeeting(meeting.id)}>
                      Open meeting
                    </button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {keyDates.length > 0 && !needle && outstandingAll.length === 0 && (
        <p className="filter-hint">Everything is done — completed tasks are below.</p>
      )}

      {completed.length > 0 && (
        <details className="completed-tasks" open={!!needle || undefined}>
          <summary>
            <span className="ui-tile ui-tile--teal" aria-hidden="true">
              <IconCheck />
            </span>
            <span className="completed-tasks-text">
              Completed ({completed.length})
              <span className="completed-tasks-hint">kept for your records, never re-notified</span>
            </span>
          </summary>
          <ul className="keydates-list">{completed.map(row)}</ul>
        </details>
      )}
    </div>
  )
}

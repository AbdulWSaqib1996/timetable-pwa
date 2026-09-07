import { EmptyState, PageHeader, StatusMessage } from '../../components/ui'
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
  onCycleTask: (task: TaskRecord) => void
  onToggleAction: (meetingId: string, actionId: string) => void
  onAddTask: () => void
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

const STATUS_CYCLE: Record<string, SessionMeta['status']> = { todo: 'doing', doing: 'done', done: 'todo' }
const STATUS_LABEL: Record<string, string> = { todo: '○ to do', doing: '◐ in progress', done: '✓ done' }

/**
 * Tasks destination (P4-07 + P5-01): Overdue / Upcoming / Completed over
 * imported deadlines AND editable personal task records, plus open mentor
 * actions projected as linked work (completion updates the meeting record —
 * there is exactly one owner). Overdue is derived, never a copied record.
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
  onCycleTask,
  onToggleAction,
  onAddTask,
}: Props) {
  const taskById = new Map(tasks.map((t) => [t.id, t]))
  const recordOf = (k: Session): TaskRecord | undefined =>
    k.id.startsWith('custom-') ? taskById.get(k.id.slice('custom-'.length)) : undefined
  const statusOf = (k: Session): SessionMeta['status'] =>
    recordOf(k)?.status ?? metaMap[sessionKey(k)]?.status ?? 'todo'

  const sorted = [...keyDates].sort((a, b) => (a.dateISO + a.start).localeCompare(b.dateISO + b.start))
  const overdue = sorted.filter((k) => k.dateISO < todayISO && statusOf(k) !== 'done')
  const upcoming = sorted.filter((k) => k.dateISO >= todayISO && statusOf(k) !== 'done')
  const completed = sorted.filter((k) => statusOf(k) === 'done').reverse()
  const nextFortnight = upcoming.filter((k) => daysUntil(k.dateISO, todayISO) <= 14).length
  const openActions = meetings.flatMap((m) =>
    m.actions.filter((a) => !a.done).map((a) => ({ meeting: m, action: a }))
  )

  const row = (k: Session) => {
    const days = daysUntil(k.dateISO, todayISO)
    const status = statusOf(k)
    const record = recordOf(k)
    const note = record?.notes ?? metaMap[sessionKey(k)]?.note
    return (
      <li key={k.id} className={status === 'done' ? 'kd-done' : ''}>
        <div className="keydate-line">
          <button
            type="button"
            className="keydate-row"
            onClick={() => (record ? onEditTask(record) : onSelect(k))}
          >
            <span className={`kd-chip${days <= 7 && days >= 0 && status !== 'done' ? ' urgent' : ''}`}>
              {days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `in ${days}d`}
            </span>
            <div className="change-body">
              <span className="change-title">
                {record && '👤 '}
                {k.title}
                {note && ' 📝'}
              </span>
              <span className="change-meta">
                {formatDate(k.dateISO)}
                {k.start && ` · ${k.start}`}
                {` · ${STATUS_LABEL[status ?? 'todo']}`}
                {!record && configured && ' · from the key-dates sheet'}
                {note && ` — ${note}`}
              </span>
            </div>
          </button>
          <span className="kd-actions">
            <button
              type="button"
              className={`kd-status kd-status-${status}`}
              title="Cycle status"
              onClick={() => (record ? onCycleTask(record) : onSetStatus(k, STATUS_CYCLE[status ?? 'todo']))}
            >
              {STATUS_LABEL[status ?? 'todo']}
            </button>
          </span>
        </div>
      </li>
    )
  }

  return (
    <div className="page page-tasks">
      <PageHeader
        title="Tasks"
        subtitle={profileName}
        actions={
          <button type="button" className="btn-primary" onClick={onAddTask}>
            ＋ Add task
          </button>
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

      {keyDates.length === 0 && openActions.length === 0 && (
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

      {overdue.length > 0 && (
        <section aria-label="Overdue tasks">
          <p className="workload-line heavy">
            {overdue.length} overdue deadline{overdue.length === 1 ? '' : 's'} still outstanding.
          </p>
          <ul className="keydates-list">{overdue.map(row)}</ul>
        </section>
      )}

      {upcoming.length > 0 && (
        <section aria-label="Upcoming tasks">
          <h3 className="subheading">Upcoming</h3>
          <p className={`workload-line${nextFortnight >= 3 ? ' heavy' : ''}`}>
            {nextFortnight === 0
              ? 'Nothing due in the next 14 days.'
              : `${nextFortnight} due in the next 14 days${nextFortnight >= 3 ? ' — busy stretch ahead' : ''}. Tap the status to cycle it; tap a row to open it.`}
          </p>
          <ul className="keydates-list">{upcoming.map(row)}</ul>
        </section>
      )}

      {openActions.length > 0 && (
        <section aria-label="Mentor actions">
          <h3 className="subheading">From mentor meetings</h3>
          <p className="filter-hint">
            Ticking one here completes it on the meeting record — there is only ever one copy.
          </p>
          <ul className="keydates-list">
            {openActions.map(({ meeting, action }) => (
              <li key={`${meeting.id}:${action.id}`}>
                <label className="keydate-line mentor-action-row">
                  <input
                    type="checkbox"
                    checked={action.done}
                    onChange={() => onToggleAction(meeting.id, action.id)}
                  />
                  <div className="change-body">
                    <span className="change-title">{action.text}</span>
                    <span className="change-meta">Meeting {formatDate(meeting.dateISO)}</span>
                  </div>
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}

      {keyDates.length > 0 && overdue.length === 0 && upcoming.length === 0 && (
        <p className="filter-hint">Everything is done — completed tasks are below.</p>
      )}

      {completed.length > 0 && (
        <details className="completed-tasks">
          <summary>Completed ({completed.length}) — kept for your records, never re-notified</summary>
          <ul className="keydates-list">{completed.map(row)}</ul>
        </details>
      )}
    </div>
  )
}

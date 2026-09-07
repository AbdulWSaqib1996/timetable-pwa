import { EmptyState, PageHeader } from '../../components/ui'
import { sessionKey } from '../../lib/diff'
import { daysUntil } from '../../lib/format'
import type { MetaMap, Session, SessionMeta } from '../../types'

interface Props {
  profileName: string
  keyDates: Session[]
  todayISO: string
  configured: boolean
  metaMap: MetaMap
  onSelect: (session: Session) => void
  onSetStatus: (kd: Session, status: SessionMeta['status']) => void
  onDeleteCustom: (id: string) => void
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
 * Tasks destination (P4-07): Overdue, Upcoming and Completed groups over the
 * imported deadlines plus personal tasks. Completed records stay retrievable
 * and never re-enter overdue/reminder prompts; Add task is the labelled
 * primary action.
 */
export function TasksPage({
  profileName,
  keyDates,
  todayISO,
  configured,
  metaMap,
  onSelect,
  onSetStatus,
  onDeleteCustom,
  onAddTask,
}: Props) {
  const statusOf = (k: Session): SessionMeta['status'] => metaMap[sessionKey(k)]?.status ?? 'todo'
  const sorted = [...keyDates].sort((a, b) => (a.dateISO + a.start).localeCompare(b.dateISO + b.start))
  const overdue = sorted.filter((k) => k.dateISO < todayISO && statusOf(k) !== 'done')
  const upcoming = sorted.filter((k) => k.dateISO >= todayISO && statusOf(k) !== 'done')
  const completed = sorted.filter((k) => statusOf(k) === 'done').reverse()
  const nextFortnight = upcoming.filter((k) => daysUntil(k.dateISO, todayISO) <= 14).length

  const row = (k: Session) => {
    const days = daysUntil(k.dateISO, todayISO)
    const status = statusOf(k)
    const isCustom = k.id.startsWith('custom-')
    const note = metaMap[sessionKey(k)]?.note
    return (
      <li key={k.id} className={status === 'done' ? 'kd-done' : ''}>
        <div className="keydate-line">
          <button type="button" className="keydate-row" onClick={() => onSelect(k)}>
            <span className={`kd-chip${days <= 7 && days >= 0 && status !== 'done' ? ' urgent' : ''}`}>
              {days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `in ${days}d`}
            </span>
            <div className="change-body">
              <span className="change-title">
                {isCustom && '👤 '}
                {k.title}
                {note && ' 📝'}
              </span>
              <span className="change-meta">
                {formatDate(k.dateISO)}
                {k.start && ` · ${k.start}`}
                {` · ${STATUS_LABEL[status ?? 'todo']}`}
                {note && ` — ${note}`}
              </span>
            </div>
          </button>
          <span className="kd-actions">
            <button
              type="button"
              className={`kd-status kd-status-${status}`}
              title="Cycle status"
              onClick={() => onSetStatus(k, STATUS_CYCLE[status ?? 'todo'])}
            >
              {STATUS_LABEL[status ?? 'todo']}
            </button>
            {isCustom && (
              <button
                type="button"
                className="btn-icon"
                aria-label="Delete personal task"
                onClick={() => onDeleteCustom(k.id)}
              >
                ✕
              </button>
            )}
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
      {keyDates.length === 0 && (
        <EmptyState
          title={configured ? 'No tasks yet' : 'No tasks here yet'}
          hint={
            configured
              ? 'Deadlines from your key-dates tab and personal tasks will appear here.'
              : 'Connect your submissions/key-dates tab in Settings → Key dates, or add your own tasks — they get the same reminders.'
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
              : `${nextFortnight} due in the next 14 days${nextFortnight >= 3 ? ' — busy stretch ahead' : ''}. Tap the status to cycle it; tap a row for notes.`}
          </p>
          <ul className="keydates-list">{upcoming.map(row)}</ul>
        </section>
      )}

      {keyDates.length > 0 && overdue.length === 0 && upcoming.length === 0 && (
        <p className="filter-hint">Everything is done — completed tasks are below.</p>
      )}

      {completed.length > 0 && (
        <details className="completed-tasks">
          <summary>
            Completed ({completed.length}) — kept for your records, never re-notified
          </summary>
          <ul className="keydates-list">{completed.map(row)}</ul>
        </details>
      )}
    </div>
  )
}

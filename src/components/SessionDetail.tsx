import type { Session } from '../types'

interface Props {
  session: Session
  onClose: () => void
}

function formatLongDate(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function toMinutes(time: string): number | null {
  const m = time.match(/^(\d{1,2}):(\d{2})$/)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

function formatDuration(start: string, end: string): string | null {
  const s = toMinutes(start)
  const e = toMinutes(end)
  if (s === null || e === null || e <= s) return null
  const mins = e - s
  const hours = Math.floor(mins / 60)
  const rest = mins % 60
  if (hours === 0) return `${rest} minutes`
  const hourPart = `${hours} hour${hours === 1 ? '' : 's'}`
  return rest > 0 ? `${hourPart} ${rest} minutes` : hourPart
}

export function SessionDetail({ session, onClose }: Props) {
  const duration = formatDuration(session.start, session.end)
  const rows: { label: string; value: string }[] = [
    { label: 'Date', value: formatLongDate(session.dateISO) },
    {
      label: 'Time',
      value: session.start ? (session.end ? `${session.start} – ${session.end}` : session.start) : '',
    },
    { label: 'Duration', value: duration ?? '' },
    { label: 'Location', value: session.isSelfStudy ? '' : session.room },
    { label: 'Tutor', value: session.tutor === 'Self Study' ? '' : session.tutor },
    { label: 'Subject', value: session.subject !== session.title ? session.subject : '' },
    { label: 'Groups', value: session.groups },
  ].filter((r) => r.value !== '')

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card sheet" role="dialog" aria-label={session.title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2 className="detail-title">{session.title}</h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {session.isSpecialism && session.specialismName && (
          <span className="badge badge-specialism">Specialism · {session.specialismName}</span>
        )}
        {session.isSelfStudy && <span className="badge badge-selfstudy">Self study</span>}
        <dl className="detail-list">
          {rows.map(({ label, value }) => (
            <div className="detail-row" key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {session.link && (
          <a className="btn-primary btn-link" href={session.link} target="_blank" rel="noopener noreferrer">
            Open in Moodle ↗
          </a>
        )}
        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

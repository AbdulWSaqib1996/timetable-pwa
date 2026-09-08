import { EmptyState, PageHeader } from './ui'

interface Props {
  reason: 'malformed' | 'oversized' | 'unknown'
  onToday: () => void
  onSchedule: () => void
}

/**
 * Safe landing for an untrusted hash that could not be opened (R1 / TT-08).
 * The shell stays, the two main destinations stay one tap away, and nothing
 * about the offending link is echoed back (a session key can carry a title).
 */
export function InvalidLinkPage({ reason, onToday, onSchedule }: Props) {
  return (
    <div className="page page-invalid-link">
      <PageHeader title="This link could not be opened" />
      <EmptyState
        title={reason === 'unknown' ? 'That page does not exist in My Timetable.' : 'The link is damaged or too long.'}
        hint="Your timetable is still here — pick where to go."
        action={
          <div className="btn-row">
            <button type="button" className="btn-primary" onClick={onToday}>
              Today
            </button>
            <button type="button" className="btn-secondary" onClick={onSchedule}>
              Schedule
            </button>
          </div>
        }
      />
    </div>
  )
}

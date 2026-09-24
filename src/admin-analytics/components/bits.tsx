import type { ReactNode } from 'react'
import { freshnessISO } from '../lib/client'
import type { StatsV2 } from '../lib/client'
import { IconAlert, IconClock, IconRefresh } from './icons'

/** Small shared pieces: KPI card, status strip, explicit state panels, notices. */

export function Kpi({
  value,
  label,
  support,
  icon,
  tone = 'neutral',
}: {
  value: ReactNode
  label: string
  support?: string
  /** optional tile icon (V4): identity, never a status claim */
  icon?: ReactNode
  tone?: 'neutral' | 'v2'
}) {
  return (
    <div className={`card kpi kpi--${tone}`}>
      <div className="kpi-head">
        {icon && (
          <span className="kpi-tile" aria-hidden="true">
            {icon}
          </span>
        )}
        <div className="label">{label}</div>
      </div>
      <div className="value">{value}</div>
      {support && <div className="support">{support}</div>}
    </div>
  )
}

/** An attention or information notice with an icon; the text carries the meaning. */
export function Notice({ tone = 'attention', children }: { tone?: 'attention' | 'info'; children: ReactNode }) {
  return (
    <div className={`notice notice--${tone}`} role={tone === 'attention' ? 'status' : undefined}>
      {tone === 'attention' ? <IconAlert size={18} /> : <IconClock size={18} />}
      <div>{children}</div>
    </div>
  )
}

export const STALE_AFTER_MS = 30 * 60_000

/**
 * Snapshot status (§4.2 → V4): generation time, observed-through watermark,
 * UTC, partial-today and completeness as labelled chips beside a Refresh
 * control. The dot means "a snapshot is loaded" — never a service-health claim.
 */
export function StatusStrip({
  v2,
  onRefresh,
  refreshing,
}: {
  v2: StatsV2 | null
  onRefresh: () => void
  refreshing: boolean
}) {
  const generated = v2 ? new Date(v2.generatedAt) : null
  // Staleness follows the job heartbeat: numbers that simply haven't changed are not stale.
  const checked = v2 ? new Date(freshnessISO(v2)) : null
  const stale = checked !== null && Date.now() - checked.getTime() > STALE_AFTER_MS
  return (
    <div className="status-strip">
      <span className={`dot${stale ? ' stale' : ''}`} aria-hidden="true" />
      <span>
        {generated
          ? `Aggregated ${generated.toLocaleString('en-GB')}${
              v2?.checkedAt && checked && checked.getTime() > generated.getTime()
                ? ` · no changes since, last checked ${checked.toLocaleString('en-GB')}`
                : ''
            } (loaded snapshot — not proof clients reported now)`
          : 'No snapshot loaded'}
      </span>
      {stale && <span className="badge warn">stale (&gt;30 min)</span>}
      <span className="badge ok">
        <IconClock size={14} /> UTC reporting
      </span>
      <span className="badge attention">
        <IconAlert size={14} /> Today is partial
      </span>
      <span>Observed through: {v2 ? (v2.observedThrough ?? 'no observations yet') : 'unavailable'}</span>
      <span className="badge ok">Event dataset (v2 tokens)</span>
      {v2 && !v2.completeness.scanComplete && <span className="badge warn">scan incomplete</span>}
      <button type="button" onClick={onRefresh} disabled={refreshing} style={{ marginLeft: 'auto' }}>
        <IconRefresh size={16} /> {refreshing ? 'Refreshing…' : 'Refresh'}
      </button>
    </div>
  )
}

/** Explicit non-data states: never blank, never fake numbers. */
export function StatePanel({ tone = 'info', title, children }: { tone?: 'info' | 'error'; title: string; children?: ReactNode }) {
  return (
    <div className={tone === 'error' ? 'alertbox' : 'card section-gap'} role={tone === 'error' ? 'alert' : undefined}>
      <strong>{title}</strong>
      {children && <div className="support" style={{ marginTop: 6 }}>{children}</div>}
    </div>
  )
}

export function CompletenessWarnings({ v2 }: { v2: StatsV2 }) {
  const c = v2.completeness
  if (!c) return null
  const warnings: string[] = []
  if (!c.scanComplete) warnings.push('The storage scan hit its page cap — totals are INCOMPLETE lower bounds.')
  if (c.missingRows > 0) warnings.push(`${c.missingRows} listed row(s) could not be read and were excluded, not guessed.`)
  if (c.invalidRows > 0) warnings.push(`${c.invalidRows} row(s) failed validation and were excluded.`)
  if (c.status !== 'complete' && c.reasons.length > 0) warnings.push(`Completeness ${c.status}: ${c.reasons.join(', ')}.`)
  if (warnings.length === 0) return null
  return (
    <div className="alertbox" role="alert">
      {warnings.map((w) => (
        <div key={w}>
          <IconAlert size={16} /> {w}
        </div>
      ))}
    </div>
  )
}

import type { ReactNode } from 'react'
import type { LegacyStats, StatsV2 } from '../lib/client'

/** Small shared pieces: KPI card, status strip, explicit state panels. */

export function Kpi({ value, label, support }: { value: ReactNode; label: string; support?: string }) {
  return (
    <div className="card kpi">
      <div>
        <div className="label">{label}</div>
        {support && <div className="support">{support}</div>}
      </div>
      <div className="value">{value}</div>
    </div>
  )
}

export const STALE_AFTER_MS = 30 * 60_000

/**
 * Snapshot status (§4.2): generation time, observed-through watermark, UTC,
 * partial-today and completeness. The dot means "a snapshot is loaded" —
 * never a service-health claim.
 */
export function StatusStrip({
  legacy,
  v2,
  onRefresh,
  refreshing,
}: {
  legacy: LegacyStats | null
  v2: StatsV2 | null
  onRefresh: () => void
  refreshing: boolean
}) {
  const generated = legacy ? new Date(legacy.generatedAt) : null
  const stale = generated !== null && Date.now() - generated.getTime() > STALE_AFTER_MS
  return (
    <div className="status-strip">
      <span className={`dot${stale ? ' stale' : ''}`} aria-hidden="true" />
      <span>
        {generated
          ? `Aggregated ${generated.toLocaleString('en-GB')} (loaded snapshot — not proof clients reported now)`
          : 'No snapshot loaded'}
      </span>
      {stale && <span className="badge warn">stale (&gt;30 min)</span>}
      <span>UTC · today is partial</span>
      <span>
        v2 observed through: {v2 ? (v2.observedThrough ?? 'no v2 data yet') : 'unavailable'}
      </span>
      {legacy?.completeness && !legacy.completeness.scanComplete && <span className="badge warn">scan incomplete</span>}
      <button type="button" onClick={onRefresh} disabled={refreshing} style={{ marginLeft: 'auto' }}>
        {refreshing ? 'Refreshing…' : '↻ Refresh'}
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

export function CompletenessWarnings({ legacy }: { legacy: LegacyStats }) {
  const c = legacy.completeness
  if (!c) return null
  const warnings: string[] = []
  if (!c.scanComplete) warnings.push('The storage scan hit its page cap — totals are INCOMPLETE lower bounds.')
  if (c.missingRows > 0) warnings.push(`${c.missingRows} listed row(s) could not be read and were excluded, not guessed.`)
  if (c.invalidRows > 0) warnings.push(`${c.invalidRows} row(s) failed validation and were excluded.`)
  if (warnings.length === 0) return null
  return (
    <div className="alertbox" role="alert">
      {warnings.map((w) => (
        <div key={w}>⚠ {w}</div>
      ))}
    </div>
  )
}

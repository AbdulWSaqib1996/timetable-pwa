import { useMemo, useState } from 'react'
import { ACTION_CATALOGUE } from '../../../shared/analytics-contracts.js'
import type { LegacyStats, StatsV2 } from '../lib/client'
import { buildCsv, downloadCsv } from '../lib/csv'
import type { CsvRow } from '../lib/csv'
import { Kpi, StatePanel } from '../components/bits'

/**
 * Return visits (§4.4): the existing data ships as RETURN FREQUENCY with an
 * explicit denominator; weekly cohorts are honestly "not collected" until
 * A4's cohort aggregation exists.
 */
export function Returning({ legacy }: { legacy: LegacyStats }) {
  const r = legacy.retention
  const total = r.oneDay + r.twoToFourDays + r.fivePlusDays
  const pct = (n: number) => (total > 0 ? `${Math.round((n / total) * 100)}%` : '—')
  return (
    <>
      <div className="kpis">
        <Kpi value={total === 0 ? '—' : `${r.oneDay} (${pct(r.oneDay)})`} label="Observed on 1 day" support={`of ${total} tokens in this window — not lifetime trial`} />
        <Kpi value={total === 0 ? '—' : `${r.twoToFourDays} (${pct(r.twoToFourDays)})`} label="Observed 2–4 days" support="distinct observed days per token, this window" />
        <Kpi value={total === 0 ? '—' : `${r.fivePlusDays} (${pct(r.fivePlusDays)})`} label="Observed 5+ days" support="distinct observed days per token, this window" />
      </div>
      {total === 0 && <StatePanel title="No observations">No tokens were observed in this window.</StatePanel>}
      <StatePanel title="Weekly cohorts — not collected yet">
        Cohort retention (first-observed week → exact follow-on calendar weeks, UTC Monday
        boundaries) ships with the A4 aggregation. Frequency above is a different measure and stays
        alongside cohorts when they arrive. Nothing here will be backfilled.
      </StatePanel>
    </>
  )
}

export function Reliability() {
  return (
    <>
      <StatePanel title="Reliability — not collected yet">
        This section arrives with A5: worker-side acceptance/rejection reason counters, aggregation
        freshness with configured thresholds, and coarse client-reported outcomes — each labelled
        with its source and denominator. Until then nothing is shown, because an unobserved failure
        is not a zero failure rate.
      </StatePanel>
      <StatePanel title="What already exists">
        The status strip on Overview shows snapshot generation time and staleness, and completeness
        warnings appear whenever a scan is incomplete or rows were unreadable.
      </StatePanel>
    </>
  )
}

export function Releases({ legacy, v2 }: { legacy: LegacyStats; v2: StatsV2 | null }) {
  const versions = Object.entries(legacy.todayVersions).sort((a, b) => Number(b[0]) - Number(a[0]))
  return (
    <>
      <div className="card section-gap">
        <h2>Release-note markers seen today (legacy)</h2>
        {versions.length === 0 ? (
          <p className="support">No reports today yet.</p>
        ) : (
          versions.map(([v, n]) => (
            <p key={v}>
              <strong>marker {v}</strong> × {n} tokens
            </p>
          ))
        )}
        <p className="support">
          These are “What’s new” note markers, NOT build identities — the same marker spans many
          deploys and cannot support release comparisons.
        </p>
      </div>
      <StatePanel title="Build coverage — collecting under v2">
        v2 batches carry an immutable build id (the git commit). Latest-build attribution, unknown
        coverage and guarded equal-period comparisons ship in A5 once enough complete periods exist
        {v2?.observedThrough ? ` (v2 data observed through ${v2.observedThrough})` : ' (no v2 observations yet)'}.
        A new build without a complete period will show “Comparison unavailable”, never a delta.
      </StatePanel>
    </>
  )
}

const GLOSSARY: [string, string][] = [
  ['Active tokens', 'Distinct random browser identities with a valid observation in the stated period. Legacy uses the receipt date; v2 uses the observed UTC date. Tokens are browsers, not people.'],
  ['Active today', 'Same, for the current UTC date — always partial until the day closes.'],
  ['New tokens', 'First observed date falls on that date under the declared identity policy. v2 first-seen starts at v2 measurement start; nothing is backdated.'],
  ['Standalone share', 'Tokens reporting standalone display mode / tokens with a known mode. Self-reported; not confirmed installs.'],
  ['Feature adoption', 'Distinct eligible active tokens with a positive valid count / eligible active tokens. Unknown eligibility is excluded, not counted as no.'],
  ['Feature uses', 'Sum of deduplicated counts. Legacy “received uses” are dated by arrival, not use.'],
  ['Return frequency', 'Distinct observed days per token in the stated window — not lifetime trial or cohort retention.'],
  ['Foreground opens', 'Mount/resume observations — not sessions and not time spent.'],
]

/**
 * Data & access (§4.7): glossary, retention truth, session explanation and
 * the aggregate CSV export (definitions included, formula-safe, disabled
 * only by lock — this page IS behind the lock).
 */
export function DataAccess({ legacy, v2, onLock }: { legacy: LegacyStats; v2: StatsV2 | null; onLock: () => void }) {
  const [exported, setExported] = useState(false)
  const csv = useMemo(() => {
    const rows: CsvRow[] = []
    const completeness = legacy.completeness?.scanComplete === false ? 'incomplete-scan' : 'complete'
    const push = (metric: string, label: string, definition: string, value: number | string | null, source: string, numerator?: number | null, denominator?: number | null) =>
      rows.push({ metric, label, definition, value, numerator, denominator, source, completeness })
    push('active_7d', 'Active tokens (7d)', 'distinct tokens, fixed last 7 UTC days incl. partial today', legacy.activeLast7Days, 'legacy-receipt-day')
    push('active_30d', 'Active tokens (30d)', 'distinct tokens, fixed last 30 UTC days incl. partial today', legacy.activeLast30Days, 'legacy-receipt-day')
    const today = legacy.daily[0]
    push('active_today', 'Active today', 'distinct tokens on the current UTC date (partial)', today?.active ?? null, 'legacy-receipt-day')
    push('standalone_today', 'Standalone reports today', 'self-reported standalone mode / active today', today && today.active > 0 ? Math.round(((today.installed ?? 0) / today.active) * 100) : null, 'legacy-receipt-day', today?.installed ?? null, today?.active ?? null)
    push('tokens_ever', 'Tokens ever recorded', 'first-seen ledger size (no expiry at present)', legacy.totalDevicesEver, 'legacy-receipt-day')
    for (const d of legacy.daily) push(`daily_active_${d.date}`, `Daily active ${d.date}`, 'distinct tokens with a report received that UTC date', d.active, 'legacy-receipt-day', d.newDevices, undefined)
    for (const [id, f] of Object.entries(legacy.features)) {
      push(`feature_${id}`, ACTION_CATALOGUE[id]?.label ?? id, 'distinct tokens with a positive count, fixed last 7 days / weekly active', legacy.activeLast7Days > 0 ? Math.round((f.devices / legacy.activeLast7Days) * 100) : null, 'legacy-receipt-day', f.devices, legacy.activeLast7Days)
    }
    return buildCsv(
      {
        periodFrom: legacy.daily[legacy.daily.length - 1]?.date ?? '',
        periodTo: legacy.daily[0]?.date ?? '',
        generatedAt: legacy.generatedAt,
        observedThrough: v2?.observedThrough ?? null,
        schemaVersion: 2,
        partial: true,
      },
      rows
    )
  }, [legacy, v2])

  return (
    <>
      <div className="grid-2">
        <div className="card">
          <h2>Access & session</h2>
          <p className="support">
            The owner key is held in memory for this tab only and sent to your worker with each
            request. Locking, reloading, a 401 or 15 minutes of inactivity clears the key and every
            loaded figure. Inactivity locking is a local privacy safeguard, not server-side
            credential expiry. Change the key any time with wrangler (`statskey` in KV).
          </p>
          <button type="button" onClick={onLock}>
            🔒 Lock now
          </button>
        </div>
        <div className="card">
          <h2>Export</h2>
          <p className="support">
            Aggregate CSV of the loaded snapshot: period, UTC boundaries, generation and
            observed-through times, per-metric definitions, numerators and denominators. No tokens,
            no raw events, no secrets; spreadsheet formula prefixes are neutralised.
            {legacy.completeness?.scanComplete === false && ' The current snapshot is INCOMPLETE — the file says so on every row.'}
          </p>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              downloadCsv(`timetable-analytics-${new Date().toISOString().slice(0, 10)}.csv`, csv)
              setExported(true)
            }}
          >
            Download CSV
          </button>
          {exported && (
            <p className="support" role="status">
              Export prepared — check your downloads.
            </p>
          )}
        </div>
      </div>
      <div className="card section-gap">
        <h2>Collection & retention</h2>
        <p className="support">
          Clients keep coarse counters (opens and feature names with counts, by UTC day) plus
          standalone mode, platform class, build id and setup yes/nos, under a random token created
          on the device. No location, names, timetable content or notes — ever. Daily activity rows
          expire after 90 days. The first-seen token ledger currently has NO expiry — a bounded
          policy is proposed for A5 and will be labelled as a semantics change if adopted. Opting
          out in the app clears unsent counters and stops collection; batches already delivered
          cannot be unsent.
        </p>
      </div>
      <div className="card">
        <h2>Metric glossary</h2>
        <dl className="glossary">
          {GLOSSARY.map(([term, def]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{def}</dd>
            </div>
          ))}
        </dl>
      </div>
    </>
  )
}

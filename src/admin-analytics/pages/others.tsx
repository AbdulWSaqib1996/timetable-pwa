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
const SMALL_COHORT = 10

export function Returning({ legacy, v2 }: { legacy: LegacyStats; v2: StatsV2 | null }) {
  const cohorts = v2?.cohorts ?? []
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
      {cohorts.length === 0 ? (
        <StatePanel title="Weekly cohorts — no v2 observations yet">
          Cohort membership is a token's first OBSERVED week under v2 event-day collection (UTC
          Monday boundaries); rows appear as clients report under the new contract. Nothing is
          backfilled from legacy receipt-day data.
        </StatePanel>
      ) : (
        <div className="card section-gap">
          <h2>Weekly cohorts (v2 event-day)</h2>
          <p className="support">
            Membership: first v2-observed week, UTC Monday boundaries, under the retained-identity
            policy. A week-N return means at least one observation in that EXACT calendar week —
            not “returned at any later date”. Open weeks show a dash; cohorts under {SMALL_COHORT}
            tokens show counts without a headline percentage.
          </p>
          <div className="table-wrap">
            <table>
              <caption>Cohort returns by exact follow-on week</caption>
              <thead>
                <tr>
                  <th scope="col">Cohort week (Mon)</th>
                  <th scope="col">Size</th>
                  {[1, 2, 3, 4].map((n) => (
                    <th scope="col" key={n}>
                      Week {n}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cohorts.map((c) => (
                  <tr key={c.week}>
                    <th scope="row">
                      {c.week}
                      {!c.complete && <span className="badge" style={{ marginLeft: 6 }}>forming</span>}
                      {c.complete && c.size < SMALL_COHORT && <span className="badge" style={{ marginLeft: 6 }}>Small cohort</span>}
                    </th>
                    <td>{c.size}</td>
                    {c.weeks.map((w) => (
                      <td key={w.n}>
                        {!w.complete || w.returned === null ? (
                          <span className="muted" title="Not complete">— <span className="meta">Not complete</span></span>
                        ) : c.size >= SMALL_COHORT ? (
                          `${Math.round((w.returned / c.size) * 100)}% (${w.returned}/${c.size})`
                        ) : (
                          `${w.returned}/${c.size}`
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <StatePanel title="Frequency vs cohorts">
        Frequency (above) counts distinct observed DAYS per token inside one window; cohorts track
        whether a token comes back in later CALENDAR WEEKS. They answer different questions and
        will not match each other.
      </StatePanel>
    </>
  )
}

/**
 * Reliability (§4.5): separate sources with their own denominators —
 * aggregation freshness, worker-observed telemetry acceptance, and late
 * client-reported outcomes. Thresholds are shown beside the figures; rates
 * are suppressed below the denominator minimum; nothing here is a service
 * health claim, and unobserved offline failures are never "zero failures".
 */
export function Reliability({ legacy, v2 }: { legacy: LegacyStats; v2: StatsV2 | null }) {
  const rel = v2?.reliability
  if (!v2 || !rel) {
    return (
      <StatePanel title="Reliability — v2 aggregate unavailable">
        Worker-side acceptance counters and freshness diagnostics come from the published v2
        snapshot, which has not been served yet. Nothing is shown in its place, because an
        unobserved failure is not a zero failure rate.
      </StatePanel>
    )
  }
  const ageMin = Math.round((Date.now() - Date.parse(v2.generatedAt)) / 60_000)
  const stale = ageMin > rel.thresholds.staleAfterMinutes
  const lcd = rel.lastCompleteDay
  const sync = v2.features.find((f) => f.id === 'sync_outcome')
  const unknownBuild = v2.builds?.list.find((b) => b.buildId === 'unknown')
  const issues: string[] = []
  if (stale) issues.push(`Stale aggregate: the v2 snapshot is ${ageMin} min old (threshold ${rel.thresholds.staleAfterMinutes} min).`)
  if (lcd.status === 'alert') issues.push(`Schema rejections above ${rel.thresholds.rejectRatePct}% on ${lcd.date} (${lcd.refused}/${lcd.attempts}).`)
  if (unknownBuild && unknownBuild.tokens > 0) issues.push(`${unknownBuild.tokens} active token(s) report no build id (unknown build coverage).`)
  if (legacy.completeness && !legacy.completeness.scanComplete) issues.push('Legacy scan incomplete — legacy totals are lower bounds.')
  if (v2.completeness.status !== 'complete') issues.push(`v2 completeness: ${v2.completeness.status}${v2.completeness.reasons.length ? ` (${v2.completeness.reasons.join(', ')})` : ''}.`)
  return (
    <>
      {issues.length > 0 ? (
        <div className="alertbox" role="alert">
          <strong>Open issues</strong>
          {issues.map((i) => (
            <div key={i}>⚠ {i}</div>
          ))}
        </div>
      ) : (
        <StatePanel title="No open issues against the configured thresholds">
          This is the absence of observed problems in the sources below — not a statement that every
          client is healthy.
        </StatePanel>
      )}
      <div className="kpis">
        <Kpi
          value={stale ? `${ageMin} min` : `${ageMin} min`}
          label="Aggregate freshness"
          support={`source: snapshot job · stale after ${rel.thresholds.staleAfterMinutes} min · last accepted batch ${rel.lastAcceptedAt ? new Date(rel.lastAcceptedAt).toLocaleString('en-GB') : 'none yet'}`}
        />
        <Kpi
          value={lcd.ratePct === null ? '—' : `${lcd.ratePct}%`}
          label={`Refused attempts — ${lcd.date}`}
          support={
            lcd.status === 'insufficient'
              ? `source: worker ingestion · ${lcd.attempts}/${rel.thresholds.minAttempts} attempts — below the denominator minimum, rate suppressed`
              : `source: worker ingestion · ${lcd.refused}/${lcd.attempts} attempts (last complete UTC day) · alert above ${rel.thresholds.rejectRatePct}%`
          }
        />
        <Kpi
          value={sync && sync.uses.value !== null ? sync.uses.value : '—'}
          label="Client-reported sync outcomes (7d)"
          support="source: late client reports, counts only · a client that cannot report contributes nothing — offline failures are unobserved, not zero"
        />
      </div>
      <div className="card section-gap">
        <h2>Telemetry acceptance by day (worker-observed)</h2>
        <p className="support">
          Counting boundary: attempts that reached the worker. Rate-limited attempts are refused
          before any body is read and listed separately; duplicates are accepted replays, not
          failures.
        </p>
        <div className="table-wrap">
          <table>
            <caption>Reason counts per UTC day — aggregate only, never request samples</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Accepted</th>
                <th scope="col">Duplicate</th>
                <th scope="col">Schema-rejected</th>
                <th scope="col">Oversize</th>
                <th scope="col">Rate-limited</th>
              </tr>
            </thead>
            <tbody>
              {[...rel.days].reverse().map((d) => (
                <tr key={d.date}>
                  <th scope="row">{d.date}</th>
                  <td>{d.accepted}</td>
                  <td>{d.duplicate}</td>
                  <td>{d.rejected}</td>
                  <td>{d.oversize}</td>
                  <td>{d.rateLimited}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

/**
 * Releases (§4.6): immutable build ids, each active token attributed once
 * to its latest observed build, Unknown kept visible, comparisons only for
 * builds with enough eligible tokens over a complete equal period — no
 * deltas, no significance badges, no causal claims.
 */
export function Releases({ legacy, v2 }: { legacy: LegacyStats; v2: StatsV2 | null }) {
  const versions = Object.entries(legacy.todayVersions).sort((a, b) => Number(b[0]) - Number(a[0]))
  const builds = v2?.builds
  return (
    <>
      {builds && builds.list.length > 0 ? (
        <div className="card section-gap">
          <h2>Build coverage (v2, latest observed build per active token, 7 days)</h2>
          <p className="support">
            {builds.activeTokens} active tokens attributed once each. Comparisons show opens per
            token over the last complete 7 UTC days for builds with at least 20 eligible tokens —
            equal periods, eligible populations, and no claim that a release caused anything.
          </p>
          <div className="table-wrap">
            <table>
              <caption>Builds by latest observed attribution</caption>
              <thead>
                <tr>
                  <th scope="col">Build</th>
                  <th scope="col">Tokens</th>
                  <th scope="col">Share</th>
                  <th scope="col">First observed</th>
                  <th scope="col">Opens per token (complete 7d)</th>
                </tr>
              </thead>
              <tbody>
                {builds.list.map((b) => (
                  <tr key={b.buildId}>
                    <th scope="row">{b.buildId === 'unknown' ? <span className="badge">Unknown</span> : <code>{b.buildId}</code>}</th>
                    <td>{b.tokens}</td>
                    <td>{b.sharePct === null ? '—' : `${b.sharePct}%`}</td>
                    <td>{b.firstObserved ?? '—'}</td>
                    <td>
                      {'unavailable' in b.comparison
                        ? `Comparison unavailable (${b.comparison.eligibleTokens}/${b.comparison.minimum} eligible tokens)`
                        : `${b.comparison.opensPerToken} (${b.comparison.eligibleTokens} tokens, ${b.comparison.periodFrom} → ${b.comparison.periodTo})`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <StatePanel title="Build coverage — no v2 observations yet">
          v2 batches carry an immutable build id (the git commit). Rows appear as clients report;
          a new build without a complete period shows “Comparison unavailable”, never a delta.
        </StatePanel>
      )}
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
          expire after 90 days; worker acceptance counters after 30 days; idempotence records after 8
          days. A last-seen date per token is now recorded (self-expiring after 200 days). The
          first-seen token ledger currently has NO expiry. A bounded policy is PROPOSED and not
          active: tokens whose first-seen date is older than 180 days with no last-seen record would
          be removed, after which a returning browser counts as newly observed — “ever recorded”
          would become “recorded within retained history”. It runs only if the owner enables it,
          touches analytics-owned first-seen rows only, and deletes at most 200 per run. Opting out in
          the app clears unsent counters and stops collection; batches already delivered cannot be
          unsent.
        </p>
      </div>
      <div className="card section-gap">
        <h2>Collection start dates</h2>
        {v2 ? (
          <dl className="glossary">
            {[...new Map(v2.features.map((f) => [f.contractVersion, f.collectionStartedAt])).entries()]
              .sort((a, b) => a[0] - b[0])
              .map(([version, started]) => (
                <div key={version}>
                  <dt>Capability {version}</dt>
                  <dd>{started ? `collected since ${started} (UTC)` : 'no observations yet — not backdated'}</dd>
                </div>
              ))}
          </dl>
        ) : (
          <p className="support">Available once the v2 snapshot is served.</p>
        )}
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

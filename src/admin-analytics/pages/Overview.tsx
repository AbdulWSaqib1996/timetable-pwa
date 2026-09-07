import { ACTION_CATALOGUE } from '../../../shared/analytics-contracts.js'
import type { LegacyStats, StatsV2 } from '../lib/client'
import { ActivityChart } from '../components/ActivityChart'
import { CompletenessWarnings, Kpi } from '../components/bits'

const SETUP_LABELS: Record<string, string> = {
  push: 'Background push',
  location: 'Travel times',
  home: 'Home address',
  keyDates: 'Key dates',
  sync: 'Device sync',
  placements: 'Placement details',
}

/**
 * Overview (§4.2): three primary metrics with explicit windows, the daily
 * chart, context, top adoption and today's setup coverage. Legacy
 * receipt-day data is the labelled primary source until v2 accumulates;
 * fixed-window cards say their windows on the card.
 */
export function Overview({ legacy, v2 }: { legacy: LegacyStats; v2: StatsV2 | null }) {
  const daily = [...legacy.daily].reverse()
  const today = legacy.daily[0] ?? { active: 0, installed: 0, newDevices: 0, platforms: {} }
  const sumNew = daily.reduce((n, x) => n + x.newDevices, 0)
  const wau = Math.max(0, legacy.activeLast7Days)
  const topFeatures = Object.entries(legacy.features)
    .sort((a, b) => b[1].devices - a[1].devices)
    .slice(0, 5)
  const known = legacy.setup.known ?? {}

  return (
    <>
      <CompletenessWarnings legacy={legacy} />
      <div className="kpis">
        <Kpi value={legacy.activeLast7Days} label="Active tokens — last 7 days" support="fixed UTC window incl. partial today · legacy receipt-day" />
        <Kpi value={today.active} label="Active today" support="current UTC date — always partial until the day closes" />
        <Kpi
          value={today.active > 0 ? `${today.installed}/${today.active}` : '—'}
          label="Standalone reports today"
          support="self-reported display mode, not confirmed installs"
        />
      </div>
      <div className="two-col">
        <div className="card">
          <h2>Daily active tokens ({legacy.windowDays} days, UTC)</h2>
          <p className="support">Legacy receipt-day series — a use can be counted on the day its report arrived.</p>
          <ActivityChart daily={daily} />
        </div>
        <div>
          <div className="card section-gap">
            <h2>Context</h2>
            <p>
              <strong>{legacy.activeLast30Days}</strong> active in the fixed last 30 days
            </p>
            <p>
              <strong>{sumNew}</strong> new tokens in this window
            </p>
            <p>
              <strong>{legacy.totalDevicesEver}</strong> tokens ever recorded{' '}
              <span className="support">(first-seen ledger, currently no expiry)</span>
            </p>
            <p className="support">
              Tokens are anonymous browsers, not people — one person with two devices counts twice.
            </p>
          </div>
          <div className="card">
            <h2>v2 event-day collection</h2>
            {v2 ? (
              <p className="support">
                {v2.observedThrough
                  ? `Observed through ${v2.observedThrough} · ${String(v2.metrics.activeTokens7?.value ?? '—')} active tokens (7d) under the v2 contract.`
                  : 'No v2 observations yet — clients report under the new contract as they update. Nothing is backdated.'}
              </p>
            ) : (
              <p className="support">v2 aggregate unavailable — the snapshot job has not published yet.</p>
            )}
          </div>
        </div>
      </div>
      <div className="grid-2">
        <div className="card">
          <h2>Top feature adoption (fixed last 7 days)</h2>
          {topFeatures.length === 0 ? (
            <p className="support">No feature observations in the window.</p>
          ) : (
            topFeatures.map(([id, f]) => {
              const share = wau > 0 ? Math.round((f.devices / wau) * 100) : 0
              return (
                <div key={id} className="row" style={{ margin: '8px 0' }}>
                  <span style={{ flex: '0 0 180px' }}>{ACTION_CATALOGUE[id]?.label ?? id}</span>
                  <span className="adoption-bar" style={{ flex: 1 }}>
                    <span style={{ width: `${share}%` }} />
                  </span>
                  <span className="support">
                    {f.devices}/{wau} · {share}%
                  </span>
                </div>
              )
            })
          )}
          <p className="support">
            <a href="#adoption">All features →</a>
          </p>
        </div>
        <div className="card">
          <h2>Setup coverage (tokens seen today)</h2>
          {legacy.setup.devices === 0 ? (
            <p className="support">No setup reports today yet.</p>
          ) : (
            Object.entries(SETUP_LABELS).map(([k, label]) => {
              const denom = known[k] ?? 0
              const on = legacy.setup.counts[k] ?? 0
              return (
                <p key={k} style={{ margin: '6px 0' }}>
                  <strong>{denom === 0 ? '—' : `${Math.round((on / denom) * 100)}%`}</strong> {label}{' '}
                  <span className="support">{denom === 0 ? '(no reported values today)' : `(${on}/${denom} known)`}</span>
                </p>
              )
            })
          )}
          <p className="support">Unknown is never counted as “off”.</p>
        </div>
      </div>
    </>
  )
}

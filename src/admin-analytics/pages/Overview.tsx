import { ACTION_CATALOGUE } from '../../../shared/analytics-contracts.js'
import type { LegacyStats, StatsV2 } from '../lib/client'
import { ActivityChart } from '../components/ActivityChart'
import { CompletenessWarnings, Kpi, Notice } from '../components/bits'
import { IconArrowRight, IconChart, IconShield } from '../components/icons'

const SETUP_LABELS: Record<string, string> = {
  push: 'Background push',
  location: 'Travel times',
  home: 'Home address',
  keyDates: 'Key dates',
  sync: 'Device sync',
  placements: 'Placement details',
}

/**
 * Overview (§4.2 → V4): the two measurement sources are named once in a
 * notice, then three headline cards from the legacy receipt-day dataset
 * (fixed windows stated on the card), the daily chart with its dataset
 * badge, a context card, a separate v2 card that warns against direct
 * comparison, top adoption and today's setup coverage. Windows are fixed
 * by the metrics, so there is no date picker to mislead.
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
  const v2Active = v2?.metrics.activeTokens7?.value

  return (
    <>
      <CompletenessWarnings legacy={legacy} />
      <Notice>
        <strong>Two measurement sources are in use.</strong> Overview uses the legacy receipt-day dataset. The newer event dataset is
        shown separately below and must not be compared directly.
      </Notice>
      <div className="kpis">
        <Kpi
          icon={<IconChart />}
          tone="legacy"
          value={legacy.activeLast7Days}
          label="Active tokens — last 7 days"
          support="fixed UTC window incl. partial today · legacy receipt-day"
        />
        <Kpi icon={<IconChart />} tone="legacy" value={today.active} label="Active today" support="current UTC date — always partial until the day closes" />
        <Kpi
          icon={<IconChart />}
          tone="legacy"
          value={today.active > 0 ? `${today.installed}/${today.active}` : '—'}
          label="Standalone reports today"
          support="self-reported display mode, not confirmed installs"
        />
      </div>
      <div className="two-col">
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Daily active tokens</h2>
              <p className="support">
                {legacy.windowDays} days · counts by report receipt date (UTC)
              </p>
            </div>
            <span className="badge ok">Legacy dataset</span>
          </div>
          <ActivityChart daily={daily} />
        </div>
        <div>
          <div className="card section-gap">
            <div className="card-head card-head--start">
              <span className="kpi-tile kpi-tile--attention" aria-hidden="true">
                <IconShield />
              </span>
              <h2>Collection needs context</h2>
            </div>
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
              Tokens are anonymous browsers, not people — one person with two devices counts twice. Offline failures are unobserved:
              a recent accepted batch does not prove every client is reporting.
            </p>
            <p className="support">
              <a href="#reliability" className="inline-link">
                <IconArrowRight /> Review reliability
              </a>
            </p>
          </div>
          <div className="card kpi--v2">
            <div className="card-head card-head--start">
              <span className="kpi-tile kpi-tile--v2" aria-hidden="true">
                <IconChart />
              </span>
              <h2>New event dataset</h2>
            </div>
            {v2 ? (
              v2.observedThrough ? (
                <>
                  <p className="kpi-inline-value">{String(v2Active ?? '—')}</p>
                  <p className="support">Active tokens over 7 days · v2 event dataset · observed through {v2.observedThrough}</p>
                  <p className="support">
                    <strong>Different collection contract.</strong> Do not compare directly with the legacy total above.
                  </p>
                </>
              ) : (
                <p className="support">No v2 observations yet — clients report under the new contract as they update. Nothing is backdated.</p>
              )
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

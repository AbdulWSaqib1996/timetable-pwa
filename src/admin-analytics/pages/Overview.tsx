import { ACTION_CATALOGUE } from '../../../shared/analytics-contracts.js'
import type { StatsV2, StatsV2Ratio } from '../lib/client'
import { ActivityChart } from '../components/ActivityChart'
import { CompletenessWarnings, Kpi, Notice, StatePanel } from '../components/bits'
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
 * Overview (§4.2 → V4; single dataset from 16 September 2026): every figure
 * is the v2 event-day snapshot counted by the current token contract — there
 * is no second dataset on the page to confuse it with. Windows are fixed by
 * the metrics, so there is no date picker to mislead, and anything the
 * contract does not collect says so instead of borrowing an old number.
 */
export function Overview({ v2 }: { v2: StatsV2 }) {
  const m = v2.metrics
  const daily = v2.daily.map((d) => ({
    date: d.date,
    active: d.active.value ?? 0,
    newTokens: d.new.value ?? 0,
    returning: d.returning.value ?? 0,
  }))
  const active7 = m.activeTokens7?.value ?? null
  const standalone = m.standaloneToday as StatsV2Ratio | undefined
  const topFeatures = v2.features
    .filter((f) => f.measurement === 'available' && (f.adoption.numerator ?? 0) > 0)
    .sort((a, b) => (b.adoption.numerator ?? 0) - (a.adoption.numerator ?? 0))
    .slice(0, 5)
  const setup = v2.setup

  if (!v2.observedThrough) {
    return (
      <>
        <CompletenessWarnings v2={v2} />
        <StatePanel title="No observations yet under the current token contract">
          Clients report as they update; nothing is backdated and no older dataset is shown in its
          place. Figures appear here once the first batch is accepted.
        </StatePanel>
      </>
    )
  }

  return (
    <>
      <CompletenessWarnings v2={v2} />
      <Notice tone="info">
        <strong>One dataset.</strong> Every figure on this panel comes from the v2 event dataset, counted by observed UTC day under the
        current token contract — observed through {v2.observedThrough}.
      </Notice>
      <div className="kpis">
        <Kpi
          icon={<IconChart />}
          tone="v2"
          value={active7 ?? '—'}
          label="Active tokens — last 7 days"
          support="fixed UTC window incl. partial today · distinct tokens with an event-day observation"
        />
        <Kpi icon={<IconChart />} tone="v2" value={m.activeToday?.value ?? '—'} label="Active today" support="current UTC date — always partial until the day closes" />
        <Kpi
          icon={<IconChart />}
          tone="v2"
          value={standalone?.value === null || standalone?.value === undefined ? '—' : `${standalone.value}%`}
          label="Standalone reports today"
          support={
            standalone && standalone.denominator
              ? `${standalone.numerator ?? 0}/${standalone.denominator} tokens with a known display mode — self-reported, not confirmed installs`
              : 'no display mode reported today — never counted as “not installed”'
          }
        />
      </div>
      <div className="two-col">
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Daily active tokens</h2>
              <p className="support">
                {v2.period.from} → {v2.period.to} · counts by observed UTC day
              </p>
            </div>
            <span className="badge ok">Event dataset</span>
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
              <strong>{m.activeTokens30?.value ?? '—'}</strong> active in the fixed last 30 days
            </p>
            <p>
              <strong>{m.newTokensWindow?.value ?? '—'}</strong> new tokens in this window
            </p>
            <p>
              <strong>{m.tokensEver?.value ?? '—'}</strong> tokens ever observed{' '}
              <span className="support">(first-seen ledger under this contract, currently no expiry)</span>
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
        </div>
      </div>
      <div className="grid-2">
        <div className="card">
          <h2>Top feature adoption (fixed last 7 days)</h2>
          {topFeatures.length === 0 ? (
            <p className="support">No feature observations in the window yet.</p>
          ) : (
            topFeatures.map((f) => {
              const share = f.adoption.value
              return (
                <div key={f.id} className="row" style={{ margin: '8px 0' }}>
                  <span style={{ flex: '0 0 180px' }}>{ACTION_CATALOGUE[f.id]?.label ?? f.id}</span>
                  <span className="adoption-bar" style={{ flex: 1 }}>
                    <span style={{ width: `${share ?? 0}%` }} />
                  </span>
                  <span className="support">
                    {f.adoption.numerator ?? '—'}/{f.adoption.denominator ?? '—'} · {share === null ? '—' : `${share}%`}
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
          <h2>Setup coverage (active tokens, last 7 days)</h2>
          {!setup ? (
            <p className="support">Setup coverage is not in this snapshot yet — it appears after the next aggregation.</p>
          ) : setup.tokens === 0 ? (
            <p className="support">No setup values reported in this window.</p>
          ) : (
            Object.entries(SETUP_LABELS).map(([k, label]) => {
              const denom = setup.known[k] ?? 0
              const on = setup.on[k] ?? 0
              return (
                <p key={k} style={{ margin: '6px 0' }}>
                  <strong>{denom === 0 ? '—' : `${Math.round((on / denom) * 100)}%`}</strong> {label}{' '}
                  <span className="support">{denom === 0 ? '(no reported values)' : `(${on}/${denom} known)`}</span>
                </p>
              )
            })
          )}
          <p className="support">Each token counts once, with its most recent reported value. Unknown is never counted as “off”.</p>
        </div>
      </div>
    </>
  )
}

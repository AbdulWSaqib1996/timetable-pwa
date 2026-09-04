import { formatRemaining } from '../lib/format'
import { tflLineColor, tflModeIcon } from '../lib/tfl'
import type { TflDepartures, TflDisruption, TflRoute } from '../lib/tfl'

interface Props {
  route: TflRoute
  legDeps: Record<number, TflDepartures>
  /** disruptions already filtered to this route's lines */
  routeDisruptions?: TflDisruption[]
}

/**
 * The visual end-to-end journey: one row per leg with the line badge in its
 * official colour, from → to, per-leg minutes and the live departure board
 * (next arrivals at the boarding stop). Shared by session details and the
 * head-home dropdown.
 */
export function RouteSteps({ route, legDeps, routeDisruptions = [] }: Props) {
  return (
    <>
      {route.legs.length > 0 && (
        <div className="route-steps">
          <div className="route-steps-head">
            <span>Best route now</span>
            <span className="route-total">≈ {formatRemaining(route.minutes)}</span>
          </div>
          {route.legs.map((leg, i) => {
            const color = tflLineColor(leg.line, leg.mode)
            return (
              <div className="route-step" key={i} style={{ borderLeftColor: color }}>
                <span className="route-step-icon">{tflModeIcon(leg.mode)}</span>
                <span className="route-step-body">
                  {leg.mode === 'walking' ? (
                    <span className="route-step-title">
                      Walk{leg.to ? ` to ${leg.to}` : ''}
                    </span>
                  ) : (
                    <span className="route-step-title">
                      <span className="route-line-badge" style={{ background: color }}>
                        {leg.line}
                      </span>{' '}
                      {leg.from} → {leg.to}
                    </span>
                  )}
                  {legDeps[i] && (
                    <span className="route-step-deps">
                      🕐 {legDeps[i].mins.map((m) => (m === 0 ? 'due' : `${m}m`)).join(', ')} · {legDeps[i].stop}
                      <span className="route-live"> · live</span>
                    </span>
                  )}
                </span>
                {leg.minutes > 0 && <span className="route-step-mins">{formatRemaining(leg.minutes)}</span>}
              </div>
            )
          })}
        </div>
      )}
      {routeDisruptions.map((d) => (
        <p className="route-warning" key={d.line}>
          ⚠ {d.line}: {d.status}
          {d.reason ? ` — ${d.reason.length > 160 ? d.reason.slice(0, 160) + '…' : d.reason}` : ''}
        </p>
      ))}
    </>
  )
}

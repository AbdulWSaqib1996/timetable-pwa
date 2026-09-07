import { utcToZonedParts } from '../../shared/calendar-time.js'
import type { Itinerary } from '../../shared/journey.js'
import { formatRemaining } from '../lib/format'
import { tflLineColor, tflModeIcon } from '../lib/tfl'
import type { TflDepartures, TflDisruption } from '../lib/tfl'

interface Props {
  itinerary: Itinerary
  /** live departure boards per leg index (near-term journeys only) */
  legDeps: Record<number, TflDepartures>
  /** current line disruptions — matched to this itinerary's actual legs */
  disruptions: TflDisruption[]
  /** show provider leg times (arrive-by plans) */
  showTimes?: boolean
}

const t = (ms: number | null) => (ms !== null ? utcToZonedParts(ms).hhmm : null)

/**
 * The end-to-end itinerary (P6-01/03): one row per leg with real leg times
 * where planned, a live departure board (stop, direction and the relevant
 * service only), and disruption warnings adjacent to the leg they affect.
 */
export function ItinerarySteps({ itinerary, legDeps, disruptions, showTimes = false }: Props) {
  const legLineDisruptions = (line: string) =>
    line ? disruptions.filter((d) => line.toLowerCase().includes(d.line.toLowerCase())) : []
  return (
    <div className="route-steps">
      <div className="route-steps-head">
        <span>{showTimes ? 'Planned route' : 'Best route now'}</span>
        <span className="route-total">≈ {formatRemaining(itinerary.durationMins)}</span>
      </div>
      {itinerary.legs.map((leg, i) => {
        const color = tflLineColor(leg.line, leg.mode)
        const times = showTimes && leg.departMs !== null ? `${t(leg.departMs)}–${t(leg.arriveMs) ?? ''}` : null
        const lineWarnings = leg.mode === 'walking' ? [] : legLineDisruptions(leg.line)
        return (
          <div className="route-step" key={i} style={{ borderLeftColor: color }}>
            <span className="route-step-icon">{tflModeIcon(leg.mode)}</span>
            <span className="route-step-body">
              {leg.mode === 'walking' ? (
                <span className="route-step-title">
                  {leg.summary || `Walk${leg.to ? ` to ${leg.to}` : ''}`}
                </span>
              ) : (
                <span className="route-step-title">
                  <span className="route-line-badge" style={{ background: color }}>
                    {leg.line}
                  </span>{' '}
                  {leg.from} → {leg.to}
                </span>
              )}
              {times && <span className="route-step-deps">🕓 {times}</span>}
              {legDeps[i] && (
                <span className="route-step-deps">
                  🕐 {legDeps[i].mins.map((m) => (m === 0 ? 'due' : `${m}m`)).join(', ')} · {legDeps[i].stop}
                  {legDeps[i].towards ? ` towards ${legDeps[i].towards}` : ''}
                  <span className="route-live"> · live</span>
                </span>
              )}
              {/* Disruptions sit WITH the leg they affect (P6-03). */}
              {leg.disruptions.map((d, j) => (
                <span className="route-warning route-leg-warning" key={`d${j}`}>
                  ⚠ {d}
                </span>
              ))}
              {lineWarnings.map((d) => (
                <span className="route-warning route-leg-warning" key={`l${d.line}`}>
                  ⚠ {d.line}: {d.status}
                </span>
              ))}
            </span>
            {leg.minutes > 0 && <span className="route-step-mins">{formatRemaining(leg.minutes)}</span>}
          </div>
        )
      })}
    </div>
  )
}

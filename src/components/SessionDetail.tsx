import { useEffect, useState } from 'react'
import { TRAVEL_MODE_PHRASE, estimateTravel, osmEmbedUrl } from '../lib/campus'
import type { Coords, TravelMode } from '../lib/campus'
import { formatRemaining, googleCalendarUrl } from '../lib/format'
import { tflDisruptions, tflLineColor, tflModeIcon, tflRoute } from '../lib/tfl'
import type { TflDisruption, TflRoute } from '../lib/tfl'
import type { Session, SessionMeta } from '../types'

interface Props {
  session: Session
  meta?: SessionMeta
  /** device location when the user enabled travel times, else null */
  coords: Coords | null
  locationEnabled: boolean
  travelMode: TravelMode
  onMeta: (patch: Partial<SessionMeta>) => void
  onClose: () => void
}

function formatLongDate(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function toMinutes(time: string): number | null {
  const m = time.match(/^(\d{1,2}):(\d{2})$/)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

function formatDuration(start: string, end: string): string | null {
  const s = toMinutes(start)
  const e = toMinutes(end)
  if (s === null || e === null || e <= s) return null
  const mins = e - s
  const hours = Math.floor(mins / 60)
  const rest = mins % 60
  if (hours === 0) return `${rest} minutes`
  const hourPart = `${hours} hour${hours === 1 ? '' : 's'}`
  return rest > 0 ? `${hourPart} ${rest} minutes` : hourPart
}

export function SessionDetail({ session, meta, coords, locationEnabled, travelMode, onMeta, onClose }: Props) {
  const duration = formatDuration(session.start, session.end)
  const gcalUrl = googleCalendarUrl(session)
  const travel =
    session.room && !session.isSelfStudy ? estimateTravel(session.room, coords, travelMode) : null

  // Live TfL journey (time + recommended route, which already avoids closures/strikes),
  // plus current line disruptions filtered to the lines this route uses.
  const [route, setRoute] = useState<TflRoute | null>(null)
  const [disruptions, setDisruptions] = useState<TflDisruption[]>([])
  useEffect(() => {
    setRoute(null)
    setDisruptions([])
    if (travelMode !== 'transit' || !coords || !travel?.location) return
    let cancelled = false
    void tflRoute(coords, travel.location).then((r) => {
      if (!cancelled) setRoute(r)
    })
    void tflDisruptions().then((d) => {
      if (!cancelled) setDisruptions(d)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [travelMode, coords?.lat, coords?.lng, session.room])

  const shownMinutes = travelMode === 'transit' && route ? route.minutes : travel?.minutes ?? null
  const liveLabel = travelMode === 'transit' && route ? ' (live TfL)' : ''
  const routeDisruptions = route
    ? disruptions.filter((d) => route.lines.some((l) => l.toLowerCase().includes(d.line.toLowerCase())))
    : []
  const rows: { label: string; value: string }[] = [
    { label: 'Date', value: formatLongDate(session.dateISO) },
    {
      label: 'Time',
      value: session.start ? (session.end ? `${session.start} – ${session.end}` : session.start) : '',
    },
    { label: 'Duration', value: duration ?? '' },
    { label: 'Location', value: session.isSelfStudy ? '' : session.room },
    { label: 'Tutor', value: session.tutor === 'Self Study' ? '' : session.tutor },
    { label: 'Subject', value: session.subject !== session.title ? session.subject : '' },
    { label: 'Groups', value: session.groups },
  ].filter((r) => r.value !== '')

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card sheet" role="dialog" aria-label={session.title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2 className="detail-title">{session.title}</h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {session.isSpecialism && session.specialismName && (
          <span className="badge badge-specialism">Specialism · {session.specialismName}</span>
        )}
        {session.isSelfStudy && <span className="badge badge-selfstudy">Self study</span>}
        {session.isOptional && <span className="badge badge-optional">Optional</span>}
        <dl className="detail-list">
          {rows.map(({ label, value }) => (
            <div className="detail-row" key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {travel && (
          <div className="travel-row">
            <span className="travel-info">
              {travel.building
                ? shownMinutes !== null
                  ? `≈ ${formatRemaining(shownMinutes)} ${TRAVEL_MODE_PHRASE[travelMode]}${liveLabel} · ${travel.building}`
                  : locationEnabled
                    ? `${travel.building} (waiting for your location…)`
                    : `${travel.building} — enable travel times in Settings for an estimate`
                : 'Not matched to a UCL campus building'}
            </span>
            <a className="travel-link" href={travel.mapsUrl} target="_blank" rel="noopener noreferrer">
              Directions ↗
            </a>
          </div>
        )}
        {route && route.legs.length > 0 && (
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
                  </span>
                  {leg.minutes > 0 && <span className="route-step-mins">{formatRemaining(leg.minutes)}</span>}
                </div>
              )
            })}
          </div>
        )}
        {route && route.legs.length === 0 && travelMode === 'transit' && (
          <p className="route-info">Best option now: walk (no transit leg needed).</p>
        )}
        {routeDisruptions.map((d) => (
          <p className="route-warning" key={d.line}>
            ⚠ {d.line}: {d.status}
            {d.reason ? ` — ${d.reason.length > 160 ? d.reason.slice(0, 160) + '…' : d.reason}` : ''}
          </p>
        ))}
        {travel?.location && (
          <iframe
            className="map-embed"
            title={`Map of ${travel.building}`}
            loading="lazy"
            referrerPolicy="no-referrer"
            src={osmEmbedUrl(travel.location)}
          />
        )}
        {session.link && (
          <a className="btn-primary btn-link" href={session.link} target="_blank" rel="noopener noreferrer">
            Open in Moodle ↗
          </a>
        )}
        {gcalUrl && (
          <a className="btn-secondary btn-link" href={gcalUrl} target="_blank" rel="noopener noreferrer">
            Add to Google Calendar
          </a>
        )}
        <section className="detail-notes">
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={meta?.attended ?? false}
              onChange={(e) => onMeta({ attended: e.target.checked })}
            />
            Attended
          </label>
          <textarea
            className="note-input"
            placeholder="Notes for this session (saved on this device)…"
            rows={2}
            value={meta?.note ?? ''}
            onChange={(e) => onMeta({ note: e.target.value })}
          />
        </section>
        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

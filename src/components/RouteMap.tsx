import { useMemo } from 'react'
import type { Itinerary } from '../../shared/journey.js'
import { fitZoom, mercator, projectOffset, routeBounds } from '../../shared/route-geometry.js'
import type { LatLng } from '../../shared/route-geometry.js'
import type { Coords } from '../lib/campus'
import { tflLineColor } from '../lib/tfl'
import { MapState, useTileStatus } from './MapState'

interface Props {
  itinerary: Itinerary
  origin: Coords | null
  destination: Coords
  /** highlighted leg index (from the text steps), or null for the whole route */
  selectedLeg: number | null
  label?: string
  /** readable address for the no-tiles fallback (TT-16) */
  address?: string | null
}

const W = 640
const H = 240
const TILE = 256

/**
 * Full-route map (P7-03): OpenStreetMap raster tiles with the PROVIDER'S
 * route geometry drawn over them — legs TfL sent no lineString for are
 * simply absent (the text steps remain the complete, primary description;
 * a straight line between stops is not a navigable route and is never
 * drawn). The viewport is fitted once per itinerary with padding, so live
 * departure-board updates cannot make the map jump. Static by design: no
 * gesture handlers, nothing traps page scrolling; leg highlighting is done
 * from the keyboard-accessible text steps.
 */
export function RouteMap({ itinerary, origin, destination, selectedLeg, label, address }: Props) {
  const view = useMemo(() => {
    const pts: LatLng[] = itinerary.legs.flatMap((l) => l.geometry)
    if (origin) pts.push([origin.lat, origin.lng])
    pts.push([destination.lat, destination.lng])
    const bounds = routeBounds(pts)
    if (!bounds) return null
    const { zoom, center } = fitZoom(bounds, W, H, 28)
    return { zoom, center }
  }, [itinerary, origin?.lat, origin?.lng, destination.lat, destination.lng]) // eslint-disable-line react-hooks/exhaustive-deps

  // Tiles covering the viewport around the centre (world pixel space) —
  // computed before any early return so the tile-status hook order is stable.
  const tiles = useMemo(() => {
    if (!view) return [] as { tx: number; ty: number; left: number; top: number }[]
    const { zoom, center } = view
    const scale = 2 ** zoom
    const cMerc = mercator(center.lat, center.lng)
    const cWorld = { x: cMerc.x * TILE * scale, y: cMerc.y * TILE * scale }
    const out: { tx: number; ty: number; left: number; top: number }[] = []
    const firstTx = Math.floor((cWorld.x - W / 2) / TILE)
    const lastTx = Math.floor((cWorld.x + W / 2) / TILE)
    const firstTy = Math.floor((cWorld.y - H / 2) / TILE)
    const lastTy = Math.floor((cWorld.y + H / 2) / TILE)
    for (let tx = firstTx; tx <= lastTx; tx++) {
      for (let ty = firstTy; ty <= lastTy; ty++) {
        if (tx < 0 || ty < 0 || tx >= scale || ty >= scale) continue
        out.push({ tx, ty, left: tx * TILE - (cWorld.x - W / 2), top: ty * TILE - (cWorld.y - H / 2) })
      }
    }
    return out
  }, [view])
  const tracker = useTileStatus(tiles.length)

  if (!view) return null
  const { zoom, center } = view
  const px = (lat: number, lng: number) => {
    const o = projectOffset(lat, lng, center, zoom)
    return { x: W / 2 + o.x, y: H / 2 + o.y }
  }

  const drawnLegs = itinerary.legs
    .map((leg, i) => ({ leg, i }))
    .filter(({ leg }) => leg.geometry.length >= 2)
  const o = origin ? px(origin.lat, origin.lng) : null
  const d = px(destination.lat, destination.lng)

  return (
    <MapState tracker={tracker} address={address}>
    <div className="route-map-wrap">
      <a
        className="route-map"
        style={{ aspectRatio: `${W} / ${H}` }}
        href={`https://www.openstreetmap.org/?mlat=${destination.lat}&mlon=${destination.lng}#map=${zoom}/${center.lat}/${center.lng}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Route map${label ? ` to ${label}` : ''} (opens OpenStreetMap). The written steps above are the full directions.`}
      >
        <div className="route-map-tiles">
          {tiles.map((t) => (
            <img
              key={`${t.tx},${t.ty}`}
              src={`https://tile.openstreetmap.org/${zoom}/${t.tx}/${t.ty}.png${tracker.nonce ? `?r=${tracker.nonce}` : ''}`}
              onLoad={tracker.onLoad}
              onError={tracker.onError}
              style={{ left: `${(t.left / W) * 100}%`, top: `${(t.top / H) * 100}%`, width: `${(TILE / W) * 100}%`, height: `${(TILE / H) * 100}%` }}
              alt=""
              loading="lazy"
            />
          ))}
        </div>
        <svg className="route-map-overlay" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
          {drawnLegs.map(({ leg, i }) => {
            const points = leg.geometry.map(([lat, lng]) => {
              const p = px(lat, lng)
              return `${p.x.toFixed(1)},${p.y.toFixed(1)}`
            })
            const dimmed = selectedLeg !== null && selectedLeg !== i
            return (
              <polyline
                key={i}
                className="route-map-leg"
                data-leg={i}
                points={points.join(' ')}
                fill="none"
                stroke={tflLineColor(leg.line, leg.mode)}
                strokeWidth={selectedLeg === i ? 6 : 4}
                strokeOpacity={dimmed ? 0.35 : 0.9}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={leg.mode === 'walking' ? '2 7' : undefined}
              />
            )
          })}
          {o && <circle cx={o.x} cy={o.y} r={6} className="route-map-origin" />}
          <circle cx={d.x} cy={d.y} r={6} className="route-map-dest" />
        </svg>
        <span className="map-attrib">© OpenStreetMap · Powered by TfL Open Data</span>
      </a>
      {drawnLegs.length < itinerary.legs.length && (
        <p className="filter-hint">
          {drawnLegs.length === 0
            ? 'TfL sent no route line for this journey — follow the written steps above.'
            : 'Some steps have no route line from TfL — the written steps above are complete.'}
        </p>
      )}
    </div>
    </MapState>
  )
}

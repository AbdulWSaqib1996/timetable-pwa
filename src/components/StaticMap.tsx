import { MapState, useTileStatus } from './MapState'
/**
 * Keyless static map built from OpenStreetMap raster tiles fetched by THIS page
 * (unlike an iframe embed, these requests go through our service worker, so the
 * campus tiles work offline once cached).
 */

interface Props {
  lat: number
  lng: number
  label?: string
  /** readable address for the no-tiles fallback (TT-16) */
  address?: string | null
}

const Z = 16
const TILE = 256

export function StaticMap({ lat, lng, label, address }: Props) {
  const tiles9 = useTileStatus(9)
  const n = 2 ** Z
  const xFloat = ((lng + 180) / 360) * n
  const latRad = (lat * Math.PI) / 180
  const yFloat = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  const cx = Math.floor(xFloat)
  const cy = Math.floor(yFloat)
  const offX = (xFloat - cx) * TILE
  const offY = (yFloat - cy) * TILE

  const tiles: { dx: number; dy: number }[] = []
  for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) tiles.push({ dx, dy })

  return (
    <MapState tracker={tiles9} address={address}>
    <a
      className="static-map"
      href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label ? `Map of ${label} (opens OpenStreetMap)` : 'Map (opens OpenStreetMap)'}
    >
      {tiles.map(({ dx, dy }) => (
        <img
          key={`${dx},${dy}`}
          src={`https://tile.openstreetmap.org/${Z}/${cx + dx}/${cy + dy}.png${tiles9.nonce ? `?r=${tiles9.nonce}` : ''}`}
          style={{
            left: `calc(50% + ${dx * TILE - offX}px)`,
            top: `calc(50% + ${dy * TILE - offY}px)`,
          }}
          alt=""
          loading="lazy"
          onLoad={tiles9.onLoad}
          onError={tiles9.onError}
        />
      ))}
      <span className="map-pin" aria-hidden="true">
        📍
      </span>
      <span className="map-attrib">© OpenStreetMap</span>
    </a>
    </MapState>
  )
}

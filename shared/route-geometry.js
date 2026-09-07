/**
 * Route geometry model (P7-03): parsing provider polylines and fitting them
 * to a fixed-size Web-Mercator viewport. Pure math, runtime-neutral, unit
 * tested — the map component only projects and draws.
 *
 * TfL serves leg geometry as `path.lineString`, a JSON-encoded array of
 * [lat, lng] pairs (TfL Open Data; attribution required). Only actual
 * provider geometry is ever drawn — a missing lineString yields an empty
 * polyline, never a straight line between stops.
 */

const MAX_POINTS_PER_LEG = 400

/** Parse a provider lineString into [lat, lng] pairs; garbage → []. */
export function parseLineString(raw) {
  let parsed = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return []
    }
  }
  if (!Array.isArray(parsed)) return []
  const pts = []
  for (const p of parsed) {
    if (!Array.isArray(p) || p.length < 2) continue
    const lat = Number(p[0])
    const lng = Number(p[1])
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue
    pts.push([lat, lng])
  }
  // Downsample very long lines evenly, always keeping both endpoints.
  if (pts.length > MAX_POINTS_PER_LEG) {
    const step = (pts.length - 1) / (MAX_POINTS_PER_LEG - 1)
    const out = []
    for (let i = 0; i < MAX_POINTS_PER_LEG; i++) out.push(pts[Math.round(i * step)])
    return out
  }
  return pts
}

/** Smallest lat/lng box containing every point; null when there are none. */
export function routeBounds(points) {
  if (!Array.isArray(points) || points.length === 0) return null
  let minLat = Infinity
  let maxLat = -Infinity
  let minLng = Infinity
  let maxLng = -Infinity
  for (const [lat, lng] of points) {
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
  }
  return { minLat, maxLat, minLng, maxLng }
}

/** Web-Mercator world coordinates in [0, 1). */
export function mercator(lat, lng) {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat))
  const latRad = (clamped * Math.PI) / 180
  return {
    x: (lng + 180) / 360,
    y: (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2,
  }
}

/**
 * The integer zoom (capped to [3, 17]) at which `bounds` fits a w×h pixel
 * viewport with `padding` px kept clear on every side, plus the centre.
 * A degenerate single-point bounds gets a sensible close-up, not Infinity.
 */
export function fitZoom(bounds, wPx, hPx, padding = 24) {
  const a = mercator(bounds.minLat, bounds.minLng)
  const b = mercator(bounds.maxLat, bounds.maxLng)
  const spanX = Math.abs(b.x - a.x)
  const spanY = Math.abs(b.y - a.y)
  const usableW = Math.max(1, wPx - 2 * padding)
  const usableH = Math.max(1, hPx - 2 * padding)
  let zoom = 17
  if (spanX > 0 || spanY > 0) {
    const zx = spanX > 0 ? Math.log2(usableW / (spanX * 256)) : Infinity
    const zy = spanY > 0 ? Math.log2(usableH / (spanY * 256)) : Infinity
    zoom = Math.floor(Math.min(zx, zy))
  }
  zoom = Math.max(3, Math.min(17, zoom))
  return {
    zoom,
    center: {
      lat: (bounds.minLat + bounds.maxLat) / 2,
      lng: (bounds.minLng + bounds.maxLng) / 2,
    },
  }
}

/** Pixel offset of (lat, lng) from `center` at `zoom` (256px tiles). */
export function projectOffset(lat, lng, center, zoom) {
  const scale = 256 * 2 ** zoom
  const p = mercator(lat, lng)
  const c = mercator(center.lat, center.lng)
  return { x: (p.x - c.x) * scale, y: (p.y - c.y) * scale }
}

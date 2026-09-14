/**
 * External route links (audit B07, Pass 78). One builder for every "open in
 * Maps" control so the link always names BOTH ends of the journey the user
 * planned: a planned route carries the selected saved origin; the separate
 * "Navigate from my location" action omits the origin on purpose so Maps
 * starts from the device. Pure and runtime-neutral (client + tests).
 *
 * @typedef {{ lat: number, lng: number }} Coords
 * @typedef {'walking' | 'transit' | 'driving'} RouteMode
 */

const MODE = { walking: 'walking', transit: 'transit', driving: 'driving' }
const valid = (c) => !!c && Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lng))
const point = (c) => `${Number(c.lat)},${Number(c.lng)}`

/**
 * @param {{ origin?: Coords | null, destination: Coords, mode: RouteMode }} input
 * @returns {string} a Google Maps directions URL
 */
export function externalRouteUrl(input) {
  if (!input || !valid(input.destination)) throw new Error('externalRouteUrl needs a destination')
  const mode = MODE[input.mode] ?? 'transit'
  const origin = valid(input.origin) ? `&origin=${point(input.origin)}` : ''
  return `https://www.google.com/maps/dir/?api=1${origin}&destination=${point(input.destination)}&travelmode=${mode}`
}

/** What a link names — used by tests and by the UI caption. */
export function describeRouteUrl(url) {
  const u = new URL(url)
  const parse = (v) => (v ? { lat: Number(v.split(',')[0]), lng: Number(v.split(',')[1]) } : null)
  return { origin: parse(u.searchParams.get('origin')), destination: parse(u.searchParams.get('destination')), mode: u.searchParams.get('travelmode') }
}

export interface RouteCoords {
  lat: number
  lng: number
}
export type RouteMode = 'walking' | 'transit' | 'driving'

/** A Google Maps directions link naming the destination and, when given, the chosen origin (audit B07). */
export function externalRouteUrl(input: { origin?: RouteCoords | null; destination: RouteCoords; mode: RouteMode }): string
export function describeRouteUrl(url: string): { origin: RouteCoords | null; destination: RouteCoords | null; mode: string | null }

export type LatLng = [number, number]

export interface RouteBounds {
  minLat: number
  maxLat: number
  minLng: number
  maxLng: number
}

export function parseLineString(raw: unknown): LatLng[]
export function routeBounds(points: LatLng[]): RouteBounds | null
export function mercator(lat: number, lng: number): { x: number; y: number }
export function fitZoom(
  bounds: RouteBounds,
  wPx: number,
  hPx: number,
  padding?: number
): { zoom: number; center: { lat: number; lng: number } }
export function projectOffset(
  lat: number,
  lng: number,
  center: { lat: number; lng: number },
  zoom: number
): { x: number; y: number }

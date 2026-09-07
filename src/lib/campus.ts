/**
 * Campus gazetteer: matches the timetable's room strings to the ACTIVE
 * course's buildings (P7-01 — UCL Bloomsbury by default) with approximate
 * coordinates, for walking-time estimates and directions links. An unknown
 * room is NEVER geocoded to a similarly named building elsewhere — it keeps
 * its raw text and an external search link instead.
 */

import { activeCourse } from './course'
import type { CourseBuilding } from '../../shared/course.js'

type Building = CourseBuilding

export interface Coords {
  lat: number
  lng: number
}

export type TravelMode = 'walking' | 'transit' | 'driving'

/** route factor over straight line, door-to-door speed, fixed overhead (wait/park), Maps mode */
const MODE_PARAMS: Record<TravelMode, { routeFactor: number; metersPerMin: number; overheadMin: number; mapsMode: string }> = {
  walking: { routeFactor: 1.25, metersPerMin: 83.3, overheadMin: 0, mapsMode: 'walking' },
  transit: { routeFactor: 1.3, metersPerMin: 250, overheadMin: 8, mapsMode: 'transit' },
  driving: { routeFactor: 1.4, metersPerMin: 333, overheadMin: 5, mapsMode: 'driving' },
}

export const TRAVEL_MODE_ICON: Record<TravelMode, string> = {
  walking: '🚶',
  transit: '🚌',
  driving: '🚗',
}

export const TRAVEL_MODE_PHRASE: Record<TravelMode, string> = {
  walking: 'walk',
  transit: 'by public transport',
  driving: 'drive',
}

export interface TravelEstimate {
  /** matched course-building name, or null when the room isn't recognised */
  building: string | null
  /** estimated travel minutes from `from`, or null when no location available */
  minutes: number | null
  /** matched building coordinates (for the embedded map), or null */
  location: Coords | null
  mapsUrl: string
}

/** Keyless OpenStreetMap embed centred on a building with a marker. */
export function osmEmbedUrl({ lat, lng }: Coords): string {
  const bbox = [lng - 0.004, lat - 0.002, lng + 0.004, lat + 0.002].join('%2C')
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat}%2C${lng}`
}

export function matchBuilding(room: string): Building | null {
  const key = room.toLowerCase()
  return activeCourse().buildings.find((b) => b.keywords.some((k) => key.includes(k))) ?? null
}

export function haversineMeters(a: Coords, b: Coords): number {
  const R = 6371000
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Straight-line distance × route factor at the mode's door-to-door pace, plus overhead. */
function travelMinutes(from: Coords, to: Coords, mode: TravelMode): number {
  const p = MODE_PARAMS[mode]
  return Math.max(1, Math.ceil((haversineMeters(from, to) * p.routeFactor) / p.metersPerMin + p.overheadMin))
}

/** Travel estimate to arbitrary coordinates (e.g. a geocoded placement school). */
export function estimateTravelToCoords(
  dest: Coords,
  from: Coords | null,
  mode: TravelMode = 'walking',
  label = 'Destination'
): TravelEstimate {
  return {
    building: label,
    minutes: from ? travelMinutes(from, dest, mode) : null,
    location: dest,
    mapsUrl: `https://www.google.com/maps/dir/?api=1&destination=${dest.lat},${dest.lng}&travelmode=${MODE_PARAMS[mode].mapsMode}`,
  }
}

export function estimateTravel(room: string, from: Coords | null, mode: TravelMode = 'walking'): TravelEstimate {
  const building = matchBuilding(room)
  if (!building) {
    const suffix = activeCourse().campus.searchSuffix
    const query = encodeURIComponent(suffix ? `${room} ${suffix}` : room)
    return {
      building: null,
      minutes: null,
      location: null,
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${query}`,
    }
  }
  return {
    building: building.name,
    minutes: from ? travelMinutes(from, building, mode) : null,
    location: { lat: building.lat, lng: building.lng },
    mapsUrl: `https://www.google.com/maps/dir/?api=1&destination=${building.lat},${building.lng}&travelmode=${MODE_PARAMS[mode].mapsMode}`,
  }
}

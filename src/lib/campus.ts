/**
 * UCL Bloomsbury campus gazetteer: matches the timetable's room strings to buildings
 * with approximate coordinates, for walking-time estimates and directions links.
 */

interface Building {
  name: string
  keywords: string[]
  lat: number
  lng: number
}

const BUILDINGS: Building[] = [
  { name: 'IOE — 20 Bedford Way', keywords: ['bedford way'], lat: 51.5227, lng: -0.1276 },
  { name: 'Darwin Building', keywords: ['darwin'], lat: 51.5238, lng: -0.1319 },
  { name: 'Cruciform Building', keywords: ['cruciform'], lat: 51.5246, lng: -0.1339 },
  { name: 'Wilkins Building (Main Quad)', keywords: ['wilkins', 'main quad', 'octagon', 'gustave tuck'], lat: 51.5248, lng: -0.1336 },
  { name: 'Senate House', keywords: ['senate house'], lat: 51.5213, lng: -0.1287 },
  { name: 'Institute of Archaeology', keywords: ['archaeology'], lat: 51.5249, lng: -0.131 },
  { name: 'Chandler House', keywords: ['chandler'], lat: 51.5253, lng: -0.1228 },
  { name: 'Roberts Building', keywords: ['roberts'], lat: 51.523, lng: -0.1322 },
  { name: 'Christopher Ingold Building', keywords: ['ingold'], lat: 51.5253, lng: -0.1325 },
  { name: 'Medical Sciences / Anatomy', keywords: ['anatomy', 'medical sciences'], lat: 51.5237, lng: -0.1334 },
  { name: 'Bentham House', keywords: ['bentham'], lat: 51.5257, lng: -0.1307 },
  { name: 'Foster Court', keywords: ['foster court'], lat: 51.5243, lng: -0.1329 },
  { name: '25 Gordon Street', keywords: ['gordon street', 'gordon house'], lat: 51.5245, lng: -0.1317 },
  { name: 'Medawar Building', keywords: ['medawar'], lat: 51.5238, lng: -0.1326 },
  { name: '1–19 Torrington Place', keywords: ['torrington'], lat: 51.5218, lng: -0.1343 },
  { name: 'Tavistock Square area', keywords: ['tavistock'], lat: 51.5253, lng: -0.1289 },
  { name: 'Birkbeck / Malet Street', keywords: ['birkbeck', 'malet street'], lat: 51.5217, lng: -0.1303 },
  { name: 'Student Centre', keywords: ['student centre'], lat: 51.5246, lng: -0.1325 },
  { name: 'Drayton House', keywords: ['drayton'], lat: 51.525, lng: -0.132 },
  { name: 'Gordon Square', keywords: ['gordon square'], lat: 51.5244, lng: -0.13 },
  { name: 'UCL (IOE)', keywords: ['ioe'], lat: 51.5227, lng: -0.1276 },
]

export interface Coords {
  lat: number
  lng: number
}

export interface TravelEstimate {
  /** matched UCL building name, or null when the room isn't recognised */
  building: string | null
  /** estimated walking minutes from `from`, or null when no location available */
  minutes: number | null
  mapsUrl: string
}

export function matchBuilding(room: string): Building | null {
  const key = room.toLowerCase()
  return BUILDINGS.find((b) => b.keywords.some((k) => key.includes(k))) ?? null
}

function haversineMeters(a: Coords, b: Coords): number {
  const R = 6371000
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Straight-line distance × 1.25 route factor at ~5 km/h walking pace. */
function walkMinutes(from: Coords, to: Coords): number {
  return Math.max(1, Math.ceil((haversineMeters(from, to) * 1.25) / 83.3))
}

export function estimateTravel(room: string, from: Coords | null): TravelEstimate {
  const building = matchBuilding(room)
  if (!building) {
    const query = encodeURIComponent(`${room} UCL London`)
    return { building: null, minutes: null, mapsUrl: `https://www.google.com/maps/search/?api=1&query=${query}` }
  }
  return {
    building: building.name,
    minutes: from ? walkMinutes(from, building) : null,
    mapsUrl: `https://www.google.com/maps/dir/?api=1&destination=${building.lat},${building.lng}&travelmode=walking`,
  }
}

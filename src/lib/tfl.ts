import type { Coords } from './campus'

/**
 * TfL Unified API (free, CORS-enabled, no key needed at light usage).
 * - Journey Planner: live journey times that already route around closures/strikes,
 *   with the stations and lines the recommended route uses.
 * - Line Status: live disruptions (strikes, closures, delays) for tube/overground/DLR/Elizabeth line.
 */

export interface TflLeg {
  /** tfl mode: walking, bus, tube, overground, dlr, elizabeth-line, national-rail, tram… */
  mode: string
  /** line/route name (e.g. "Victoria", "73"); empty for walking */
  line: string
  from: string
  to: string
  minutes: number
  /** departure point coordinates (used to find the stop for live departures) */
  fromLat?: number
  fromLng?: number
}

export interface TflRoute {
  minutes: number
  legs: TflLeg[]
  /** line names the route uses, for matching against disruptions */
  lines: string[]
}

const MODE_ICONS: Record<string, string> = {
  walking: '🚶',
  bus: '🚌',
  tube: '🚇',
  overground: '🚆',
  'elizabeth-line': '🚆',
  'national-rail': '🚆',
  dlr: '🚈',
  tram: '🚊',
  'river-bus': '⛴',
  cycle: '🚲',
}

export function tflModeIcon(mode: string): string {
  return MODE_ICONS[mode] ?? '🚌'
}

/** Official-ish TfL line colours for the route timeline. */
const LINE_COLORS: Record<string, string> = {
  bakerloo: '#B36305',
  central: '#E32017',
  circle: '#FFD300',
  district: '#00782A',
  'hammersmith & city': '#F3A9BB',
  jubilee: '#A0A5A9',
  metropolitan: '#9B0056',
  northern: '#5c5f66',
  piccadilly: '#003688',
  victoria: '#0098D4',
  'waterloo & city': '#95CDBA',
  elizabeth: '#6950A1',
  dlr: '#00A4A7',
  tram: '#84B817',
}

export function tflLineColor(line: string, mode: string): string {
  const key = line.toLowerCase()
  if (LINE_COLORS[key]) return LINE_COLORS[key]
  if (mode === 'bus' || /^\w?\d+$/.test(line)) return '#DC241F'
  if (mode === 'overground' || key.includes('windrush') || key.includes('mildmay') || key.includes('lioness') || key.includes('weaver') || key.includes('suffragette') || key.includes('liberty')) return '#EE7C0E'
  if (mode === 'walking') return '#9aa1b5'
  return '#6950A1'
}

const routeCache = new Map<string, { at: number; route: TflRoute | null }>()

const routeKey = (from: Coords, to: Coords) =>
  `${from.lat.toFixed(3)},${from.lng.toFixed(3)}|${to.lat.toFixed(4)},${to.lng.toFixed(4)}`

/** Synchronous cache lookup of a live journey time (for the leave-alert loop). */
export function cachedRouteMinutes(from: Coords, to: Coords): number | null {
  const hit = routeCache.get(routeKey(from, to))
  return hit && Date.now() - hit.at < 10 * 60_000 ? hit.route?.minutes ?? null : null
}

function cleanStop(name?: string): string {
  let cleaned = (name ?? '').replace(/ (Underground|Rail|DLR) Station$/i, '').trim()
  // TfL returns street addresses in ALL CAPS — title-case those.
  if (cleaned.length > 3 && cleaned === cleaned.toUpperCase()) {
    cleaned = cleaned.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase())
  }
  return cleaned
}

export async function tflRoute(from: Coords, to: Coords): Promise<TflRoute | null> {
  const key = routeKey(from, to)
  const hit = routeCache.get(key)
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.route
  let route: TflRoute | null = null
  try {
    const res = await fetch(
      `https://api.tfl.gov.uk/Journey/JourneyResults/${from.lat},${from.lng}/to/${to.lat},${to.lng}`
    )
    if (res.ok) {
      const json = (await res.json()) as {
        journeys?: {
          duration?: number
          legs?: {
            duration?: number
            mode?: { name?: string }
            routeOptions?: { name?: string }[]
            departurePoint?: { commonName?: string; lat?: number; lon?: number }
            arrivalPoint?: { commonName?: string }
          }[]
        }[]
      }
      const journey = json.journeys?.[0]
      if (journey && typeof journey.duration === 'number' && journey.duration > 0) {
        const legs: TflLeg[] = []
        const lines: string[] = []
        for (const leg of journey.legs ?? []) {
          const mode = leg.mode?.name ?? ''
          const line = mode === 'walking' ? '' : leg.routeOptions?.[0]?.name || mode
          legs.push({
            mode,
            line,
            from: cleanStop(leg.departurePoint?.commonName),
            to: cleanStop(leg.arrivalPoint?.commonName),
            minutes: leg.duration ?? 0,
            fromLat: leg.departurePoint?.lat,
            fromLng: leg.departurePoint?.lon,
          })
          if (line) lines.push(line)
        }
        route = { minutes: journey.duration, legs, lines }
      }
    }
  } catch {
    /* offline or API hiccup — caller falls back to the heuristic */
  }
  routeCache.set(key, { at: Date.now(), route })
  return route
}

/** Back-compat helper: just the live journey minutes. */
export async function tflTransitMinutes(from: Coords, to: Coords): Promise<number | null> {
  return (await tflRoute(from, to))?.minutes ?? null
}

export interface TflDepartures {
  stop: string
  mins: number[]
}

/**
 * Live departures of a line near a point: find the closest StopPoint that serves the
 * line (journey legs don't carry a usable stop id), then read its arrivals board.
 */
export async function tflDeparturesNear(lat: number, lng: number, line: string): Promise<TflDepartures | null> {
  try {
    const stopsRes = await fetch(
      `https://api.tfl.gov.uk/StopPoint?lat=${lat}&lon=${lng}&stopTypes=NaptanPublicBusCoachTram,NaptanMetroStation,NaptanRailStation&radius=180`
    )
    if (!stopsRes.ok) return null
    const stopsJson = (await stopsRes.json()) as {
      stopPoints?: { naptanId?: string; commonName?: string; stopLetter?: string; lines?: { name?: string }[] }[]
    }
    const stop = (stopsJson.stopPoints ?? []).find((sp) =>
      (sp.lines ?? []).some((l) => (l.name ?? '').toLowerCase() === line.toLowerCase())
    )
    if (!stop?.naptanId) return null
    const arrRes = await fetch(`https://api.tfl.gov.uk/StopPoint/${encodeURIComponent(stop.naptanId)}/Arrivals`)
    if (!arrRes.ok) return null
    const arrivals = (await arrRes.json()) as { lineName?: string; timeToStation?: number }[]
    const mins = arrivals
      .filter((a) => (a.lineName ?? '').toLowerCase() === line.toLowerCase())
      .map((a) => Math.max(0, Math.round((a.timeToStation ?? 0) / 60)))
      .sort((a, b) => a - b)
      .slice(0, 3)
    if (mins.length === 0) return null
    return {
      stop: `${stop.commonName ?? 'stop'}${stop.stopLetter ? ` (Stop ${stop.stopLetter})` : ''}`,
      mins,
    }
  } catch {
    return null
  }
}

export interface TflDisruption {
  line: string
  status: string
  reason?: string
}

let statusCache: { at: number; items: TflDisruption[] } | null = null

/** Lines currently NOT running a good service (strikes, closures, delays), cached 2 min. */
export async function tflDisruptions(): Promise<TflDisruption[]> {
  if (statusCache && Date.now() - statusCache.at < 2 * 60_000) return statusCache.items
  try {
    const res = await fetch('https://api.tfl.gov.uk/Line/Mode/tube,elizabeth-line,overground,dlr/Status')
    if (!res.ok) throw new Error('bad status')
    type LineStatus = { statusSeverity?: number; statusSeverityDescription?: string; reason?: string }
    const lines = (await res.json()) as { name?: string; lineStatuses?: LineStatus[] }[]
    const items: TflDisruption[] = []
    for (const line of lines) {
      const worst = (line.lineStatuses ?? []).reduce<LineStatus | null>(
        (acc, s) => ((s.statusSeverity ?? 11) < (acc?.statusSeverity ?? 11) ? s : acc),
        null
      )
      if (worst && worst.statusSeverity !== undefined && worst.statusSeverity < 10 && line.name) {
        items.push({
          line: line.name,
          status: worst.statusSeverityDescription ?? 'Disrupted',
          reason: worst.reason,
        })
      }
    }
    statusCache = { at: Date.now(), items }
    return items
  } catch {
    return statusCache?.items ?? []
  }
}

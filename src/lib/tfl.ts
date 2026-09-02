import type { Coords } from './campus'

/**
 * TfL Unified API (free, CORS-enabled, no key needed at light usage).
 * - Journey Planner: live journey times that already route around closures/strikes,
 *   with the stations and lines the recommended route uses.
 * - Line Status: live disruptions (strikes, closures, delays) for tube/overground/DLR/Elizabeth line.
 */

export interface TflRoute {
  minutes: number
  /** human route legs, e.g. "Victoria line: King's Cross → Euston" (walking legs omitted) */
  via: string[]
  /** line names the route uses, for matching against disruptions */
  lines: string[]
}

const routeCache = new Map<string, { at: number; route: TflRoute | null }>()

function cleanStop(name?: string): string {
  return (name ?? '').replace(/ (Underground|Rail|DLR) Station$/i, '').trim()
}

export async function tflRoute(from: Coords, to: Coords): Promise<TflRoute | null> {
  const key = `${from.lat.toFixed(3)},${from.lng.toFixed(3)}|${to.lat.toFixed(4)},${to.lng.toFixed(4)}`
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
            mode?: { name?: string }
            routeOptions?: { name?: string }[]
            departurePoint?: { commonName?: string }
            arrivalPoint?: { commonName?: string }
          }[]
        }[]
      }
      const journey = json.journeys?.[0]
      if (journey && typeof journey.duration === 'number' && journey.duration > 0) {
        const via: string[] = []
        const lines: string[] = []
        for (const leg of journey.legs ?? []) {
          const mode = leg.mode?.name ?? ''
          if (mode === 'walking') continue
          const line = leg.routeOptions?.[0]?.name || mode
          via.push(`${line}: ${cleanStop(leg.departurePoint?.commonName)} → ${cleanStop(leg.arrivalPoint?.commonName)}`)
          lines.push(line)
        }
        route = { minutes: journey.duration, via, lines }
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

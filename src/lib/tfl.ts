import type { Coords } from './campus'

/**
 * Live public-transport journey time from TfL's Journey Planner API (free, CORS-enabled,
 * no key needed at light usage). Results are cached for 5 minutes per origin/destination.
 */
const cache = new Map<string, { at: number; mins: number | null }>()

export async function tflTransitMinutes(from: Coords, to: Coords): Promise<number | null> {
  const key = `${from.lat.toFixed(3)},${from.lng.toFixed(3)}|${to.lat.toFixed(4)},${to.lng.toFixed(4)}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.mins
  let mins: number | null = null
  try {
    const res = await fetch(
      `https://api.tfl.gov.uk/Journey/JourneyResults/${from.lat},${from.lng}/to/${to.lat},${to.lng}`
    )
    if (res.ok) {
      const json = (await res.json()) as { journeys?: { duration?: number }[] }
      const duration = json.journeys?.[0]?.duration
      if (typeof duration === 'number' && duration > 0) mins = duration
    }
  } catch {
    /* offline or API hiccup — caller falls back to the heuristic */
  }
  cache.set(key, { at: Date.now(), mins })
  return mins
}

import type { Coords } from './campus'

/**
 * Keyless UK geocoding for placement addresses: postcodes.io when the text
 * contains a UK postcode (fast, exact), Nominatim search otherwise.
 */
export async function geocodeAddress(query: string): Promise<Coords | null> {
  const trimmed = query.trim()
  if (!trimmed) return null
  const postcode = trimmed.match(/[A-Z]{1,2}\d[A-Z0-9]?\s*\d[A-Z]{2}/i)?.[0]
  if (postcode) {
    try {
      const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode.replace(/\s+/g, ''))}`)
      if (res.ok) {
        const json = (await res.json()) as { result?: { latitude?: number; longitude?: number } }
        if (typeof json.result?.latitude === 'number' && typeof json.result?.longitude === 'number') {
          return { lat: json.result.latitude, lng: json.result.longitude }
        }
      }
    } catch {
      /* fall through to Nominatim */
    }
  }
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=gb&q=${encodeURIComponent(trimmed)}`
    )
    if (res.ok) {
      const json = (await res.json()) as { lat?: string; lon?: string }[]
      const hit = json[0]
      if (hit?.lat && hit?.lon) return { lat: Number(hit.lat), lng: Number(hit.lon) }
    }
  } catch {
    /* offline */
  }
  return null
}

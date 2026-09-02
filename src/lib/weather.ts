/**
 * Campus weather via Open-Meteo (free, keyless, CORS-enabled).
 * One forecast fetch covers 3 days of hourly data, cached for 30 minutes.
 */

export interface HourWeather {
  tempC: number
  rainProb: number
  code: number
}

const CAMPUS = { lat: 51.523, lng: -0.13 }
let cache: { at: number; hours: Map<string, HourWeather> } | null = null
let inflight: Promise<void> | null = null

async function loadForecast(): Promise<void> {
  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${CAMPUS.lat}&longitude=${CAMPUS.lng}&hourly=temperature_2m,precipitation_probability,weather_code&forecast_days=3&timezone=Europe%2FLondon`
    )
    if (!res.ok) return
    const json = (await res.json()) as {
      hourly?: { time?: string[]; temperature_2m?: number[]; precipitation_probability?: number[]; weather_code?: number[] }
    }
    const hours = new Map<string, HourWeather>()
    ;(json.hourly?.time ?? []).forEach((t, i) => {
      hours.set(t, {
        tempC: json.hourly?.temperature_2m?.[i] ?? 0,
        rainProb: json.hourly?.precipitation_probability?.[i] ?? 0,
        code: json.hourly?.weather_code?.[i] ?? 0,
      })
    })
    if (hours.size > 0) cache = { at: Date.now(), hours }
  } catch {
    /* offline — weather is decorative */
  }
}

/** Forecast for a local hour ("2026-09-03", 9 → 09:00 that day); fetches when stale. */
export async function weatherForHour(dateISO: string, hour: number): Promise<HourWeather | null> {
  if (!cache || Date.now() - cache.at > 30 * 60_000) {
    if (!inflight) inflight = loadForecast().finally(() => (inflight = null))
    await inflight
  }
  return cache?.hours.get(`${dateISO}T${String(hour).padStart(2, '0')}:00`) ?? null
}

/** Same lookup but cache-only (for synchronous paths like notification bodies). */
export function cachedWeatherForHour(dateISO: string, hour: number): HourWeather | null {
  return cache?.hours.get(`${dateISO}T${String(hour).padStart(2, '0')}:00`) ?? null
}

export function weatherEmoji(code: number): string {
  if (code === 0) return '☀️'
  if (code <= 2) return '🌤️'
  if (code === 3) return '☁️'
  if (code <= 48) return '🌫️'
  if (code <= 57) return '🌦️'
  if (code <= 67) return '🌧️'
  if (code <= 77) return '🌨️'
  if (code <= 82) return '🌧️'
  if (code <= 86) return '🌨️'
  return '⛈️'
}

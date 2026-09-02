import type { CachedData, Settings } from '../types'

const SETTINGS_KEY = 'timetable.settings.v1'
const CACHE_KEY = 'timetable.cache.v1'

export function loadSettings(): Settings | null {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    return raw ? (JSON.parse(raw) as Settings) : null
  } catch {
    return null
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    /* storage unavailable — app still works, just won't persist */
  }
}

export function clearSettings(): void {
  try {
    localStorage.removeItem(SETTINGS_KEY)
    localStorage.removeItem(CACHE_KEY)
  } catch {
    /* ignore */
  }
}

export function loadCache(): CachedData | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? (JSON.parse(raw) as CachedData) : null
  } catch {
    return null
  }
}

export function saveCache(cache: CachedData): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    /* ignore */
  }
}

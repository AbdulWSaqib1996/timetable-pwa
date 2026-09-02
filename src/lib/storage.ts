import type { CachedData, MetaMap, ProfileStore, SessionChange, Settings } from '../types'

const STORE_KEY = 'timetable.store.v2'
const LEGACY_SETTINGS_KEY = 'timetable.settings.v1'
const LEGACY_CACHE_KEY = 'timetable.cache.v1'
const NOTIFIED_KEY = 'timetable.notified.v2'

const cacheKey = (pid: string) => `timetable.cache.v2.${pid}`
const metaKey = (pid: string) => `timetable.meta.v2.${pid}`
const changesKey = (pid: string) => `timetable.changes.v2.${pid}`

function readJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable — app still works, just won't persist */
  }
}

function removeKey(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

export function newProfileId(): string {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

/** Migrate the legacy single reminderMinutes field into the reminderOffsets list. */
function normalizeStore(store: ProfileStore): ProfileStore {
  let changed = false
  for (const p of store.profiles) {
    if (p.settings.reminderMinutes && !p.settings.reminderOffsets) {
      p.settings.reminderOffsets = [p.settings.reminderMinutes]
      delete p.settings.reminderMinutes
      changed = true
    }
  }
  if (changed) writeJSON(STORE_KEY, store)
  return store
}

/** Load the profile store, migrating a pre-profiles (v1) setup into a single profile. */
export function loadStore(): ProfileStore | null {
  const store = readJSON<ProfileStore>(STORE_KEY)
  if (store && store.profiles.length > 0) return normalizeStore(store)
  const legacy = readJSON<Settings>(LEGACY_SETTINGS_KEY)
  if (!legacy) return null
  const id = newProfileId()
  const migrated: ProfileStore = {
    activeId: id,
    profiles: [{ id, name: 'My timetable', settings: legacy }],
  }
  writeJSON(STORE_KEY, migrated)
  const oldCache = readJSON<CachedData>(LEGACY_CACHE_KEY)
  if (oldCache) writeJSON(cacheKey(id), oldCache)
  removeKey(LEGACY_SETTINGS_KEY)
  removeKey(LEGACY_CACHE_KEY)
  return migrated
}

export function saveStore(store: ProfileStore): void {
  writeJSON(STORE_KEY, store)
}

export function clearStore(): void {
  removeKey(STORE_KEY)
}

/** Remove a profile's cached data (call when deleting a profile). */
export function clearProfileData(pid: string): void {
  removeKey(cacheKey(pid))
  removeKey(metaKey(pid))
  removeKey(changesKey(pid))
}

export function loadCache(pid: string): CachedData | null {
  return readJSON<CachedData>(cacheKey(pid))
}

export function saveCache(pid: string, cache: CachedData): void {
  writeJSON(cacheKey(pid), cache)
}

export function loadMeta(pid: string): MetaMap {
  return readJSON<MetaMap>(metaKey(pid)) ?? {}
}

export function saveMeta(pid: string, meta: MetaMap): void {
  writeJSON(metaKey(pid), meta)
}

export function loadChanges(pid: string): SessionChange[] {
  return readJSON<SessionChange[]>(changesKey(pid)) ?? []
}

export function saveChanges(pid: string, changes: SessionChange[]): void {
  writeJSON(changesKey(pid), changes.slice(0, 100))
}

/** Everything worth keeping, as a downloadable JSON backup. */
export function exportBackup(): string {
  const store = readJSON<ProfileStore>(STORE_KEY)
  const meta: Record<string, MetaMap> = {}
  for (const p of store?.profiles ?? []) meta[p.id] = loadMeta(p.id)
  return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), store, meta }, null, 2)
}

/** Restore a backup produced by exportBackup. Returns false if the file isn't one. */
export function importBackup(text: string): boolean {
  try {
    const data = JSON.parse(text) as { store?: ProfileStore; meta?: Record<string, MetaMap> }
    if (!data.store || !Array.isArray(data.store.profiles) || data.store.profiles.length === 0) return false
    writeJSON(STORE_KEY, data.store)
    for (const [pid, m] of Object.entries(data.meta ?? {})) writeJSON(metaKey(pid), m)
    return true
  } catch {
    return false
  }
}

/** Reminder bookkeeping: sessionKey → timestamp notified. */
export function loadNotified(): Record<string, number> {
  return readJSON<Record<string, number>>(NOTIFIED_KEY) ?? {}
}

export function saveNotified(map: Record<string, number>): void {
  const cutoff = Date.now() - 2 * 24 * 3600_000
  const pruned: Record<string, number> = {}
  for (const [k, v] of Object.entries(map)) if (v > cutoff) pruned[k] = v
  writeJSON(NOTIFIED_KEY, pruned)
}

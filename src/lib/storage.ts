import { withDataLock } from './attachments'
import { canonical, syncSettings } from '../../shared/merge.js'
import { requireSavedData, persistJSON, persistValue } from './persistence'
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

function writeJSON(key: string, value: unknown): void { persistJSON(key, value) }
function removeKey(key: string): void { persistValue(key, null) }

export function newProfileId(): string {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

/** Migrate the legacy single reminderMinutes field into the reminderOffsets list,
 *  and seed the separated reminder-eligibility choices from the old behaviour
 *  (reminders used to follow the optional/self-study display filters — keep
 *  whatever each profile effectively had, never silently enable more). */
function normalizeStore(store: ProfileStore): ProfileStore {
  let changed = false
  for (const p of store.profiles) {
    if (p.settings.reminderMinutes && !p.settings.reminderOffsets) {
      p.settings.reminderOffsets = [p.settings.reminderMinutes]
      delete p.settings.reminderMinutes
      changed = true
    }
    if (p.settings.remindOptional === undefined && p.settings.filters?.showOptional === false) {
      p.settings.remindOptional = false
      changed = true
    }
    if (p.settings.remindSelfStudy === undefined && p.settings.filters?.showSelfStudy === false) {
      p.settings.remindSelfStudy = false
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
  const oldCache = readJSON<CachedData>(LEGACY_CACHE_KEY)
  // Copy first; never remove the legacy recovery copy after a failed write.
  const cacheSaved = !oldCache || persistJSON(cacheKey(id), oldCache)
  const storeSaved = cacheSaved && persistJSON(STORE_KEY, migrated)
  if (storeSaved) {
    removeKey(LEGACY_SETTINGS_KEY)
    removeKey(LEGACY_CACHE_KEY)
  }
  return migrated
}

export function saveStore(store: ProfileStore): void {
  const previous = readJSON<ProfileStore>(STORE_KEY)
  const profiles = store.profiles.map(p => {
    const old = previous?.profiles.find(x => x.id === p.id)
    return !old || canonical({name:p.name,settings:syncSettings(p.settings)}) !== canonical({name:old.name,settings:syncSettings(old.settings)})
      ? { ...p, at: Math.max(Date.now(), (old?.at ?? 0) + 1) } : { ...p, at: old.at }
  })
  writeJSON(STORE_KEY, { ...store, profiles, deletedProfiles: { ...previous?.deletedProfiles, ...store.deletedProfiles } })
}

export function clearStore(): void {
  removeKey(STORE_KEY)
}

/** Delete all local owners atomically; keep a sync tombstone. */
export async function clearProfileData(pid: string): Promise<void> {
  const { restoreWithRecovery } = await import('./recovery')
  const { readAttachments } = await import('./attachments')
  await restoreWithRecovery(async () => {
    const store = readJSON<ProfileStore>(STORE_KEY)
    const metadata: Record<string,string|null> = {}
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!
      if (key.startsWith('timetable.') && key.endsWith('.' + pid)) metadata[key] = null
    }
    if (store) {
      const profiles = store.profiles.filter(p => p.id !== pid)
      metadata[STORE_KEY] = JSON.stringify({ ...store, profiles, activeId: store.activeId === pid ? profiles[0]?.id ?? '' : store.activeId, deletedProfiles: { ...store.deletedProfiles, [pid]: Date.now() } })
    }
    return { metadata, photos: (await readAttachments('photos')).filter(x => x.owner.split('|')[0] !== pid), wallet: (await readAttachments('wallet')).filter(x => x.owner.split('|')[0] !== pid) }
  })
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
  const previous = loadMeta(pid)
  const next = { ...meta }
  for (const key of Object.keys(previous)) if (!(key in next)) next[key] = { deleted: true, at: Math.max(Date.now(), (previous[key].at ?? 0) + 1) }
  writeJSON(metaKey(pid), next)
}

export function loadChanges(pid: string): SessionChange[] {
  return readJSON<SessionChange[]>(changesKey(pid)) ?? []
}

export function saveChanges(pid: string, changes: SessionChange[]): void {
  writeJSON(changesKey(pid), changes.slice(0, 100))
}

/** Everything worth keeping (profiles, notes, attendance, photos, PGCE admin file, wallet). */
export interface ExportScope {
  /** export only these profiles (owner ids are kept exactly); omit for all */
  profileIds?: string[]
}

/**
 * Plain backup JSON. With a scope (R5a / NF-05) only the chosen profiles and
 * the attachments they own are included; owner ids are never remapped, so a
 * scoped backup restores back onto the same profile identity.
 */
export async function exportBackup(scope: ExportScope = {}): Promise<string> {
  requireSavedData()
  return withDataLock(async () => {
  const full = readJSON<ProfileStore>(STORE_KEY)
  if (!full) throw new Error('No timetable to back up.')
  const wanted = scope.profileIds ? new Set(scope.profileIds) : null
  const profiles = wanted ? full.profiles.filter((p) => wanted.has(p.id)) : full.profiles
  if (profiles.length === 0) throw new Error('No matching profile to back up.')
  const store: ProfileStore = {
    ...full,
    profiles,
    activeId: profiles.some((p) => p.id === full.activeId) ? full.activeId : profiles[0].id,
  }
  const ownerIn = (owner: string) => !wanted || wanted.has(owner.split('|')[0])
  const cache: Record<string, CachedData> = {}
  const changes: Record<string, SessionChange[]> = {}
  const meta: Record<string, MetaMap> = {}
  const admin: Record<string, unknown> = {}
  for (const p of profiles) {
    meta[p.id] = loadMeta(p.id)
    const snapshot = loadCache(p.id)
    if (snapshot) cache[p.id] = snapshot
    changes[p.id] = loadChanges(p.id)
    const rawAdmin = readJSON<unknown>(`timetable.admin.v1.${p.id}`)
    if (rawAdmin) admin[p.id] = rawAdmin
  }
  const { exportPhotos } = await import('./photos')
  const photos = (await exportPhotos()).filter((p) => ownerIn(p.owner))
  const { exportWallet } = await import('./wallet')
  const wallet = (await exportWallet()).filter((w) => ownerIn(w.owner))
  const json = JSON.stringify(
    { version: 4, cache, changes, exportedAt: new Date().toISOString(), store, meta, admin, photos, wallet },
    null,
    2
  )
  const { validateBackup } = await import('./backup')
  validateBackup(json)
  return json
  })
}

/** Validate and restore with a durable undo journal. Errors are shown by the caller. */
export async function importBackup(text: string): Promise<boolean> {
  const { validateBackup, restoreBackup } = await import('./backup')
  await restoreBackup(validateBackup(text))
  return true
}

/* ---------- backup nudge bookkeeping ---------- */
const BACKUP_KEY = 'timetable.backup.v1'

/** When a backup file was last GENERATED on this device (never proof it was kept). */
export function lastBackupAt(): number | null {
  return readJSON<{ lastBackupAt?: number }>(BACKUP_KEY)?.lastBackupAt ?? null
}

export function markBackedUp(): void {
  const state = readJSON<{ lastBackupAt?: number; lastNudgeAt?: number }>(BACKUP_KEY) ?? {}
  writeJSON(BACKUP_KEY, { ...state, lastBackupAt: Date.now() })
}

export function snoozeBackupNudge(): void {
  const state = readJSON<{ lastBackupAt?: number; lastNudgeAt?: number }>(BACKUP_KEY) ?? {}
  writeJSON(BACKUP_KEY, { ...state, lastNudgeAt: Date.now() })
}

/** Show the nudge when there's meaningful local data and no backup for 30 days. */
export function shouldNudgeBackup(hasData: boolean): boolean {
  if (!hasData) return false
  const state = readJSON<{ lastBackupAt?: number; lastNudgeAt?: number }>(BACKUP_KEY) ?? {}
  const month = 30 * 24 * 3600 * 1000
  const week = 7 * 24 * 3600 * 1000
  if (state.lastBackupAt && Date.now() - state.lastBackupAt < month) return false
  if (state.lastNudgeAt && Date.now() - state.lastNudgeAt < week) return false
  return true
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

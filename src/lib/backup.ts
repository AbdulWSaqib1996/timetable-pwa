import { MAX_BACKUP_BYTES, assert, object, validatePayload } from '../../shared/contracts.js'
import type { ProfileStore, MetaMap, CachedData, SessionChange } from '../types'
import { readAttachments } from './attachments'
import { preparePhotos, type PhotoExport } from './photos'
import { prepareWallet, type WalletExport } from './wallet'
import { restoreWithRecovery } from './recovery'
import { deviceSettings } from '../../shared/merge.js'
export interface Backup {
  version: number; store: ProfileStore; meta?: Record<string, MetaMap>; admin?: Record<string, unknown>
  cache?: Record<string, CachedData>; changes?: Record<string, SessionChange[]>; photos?: PhotoExport[]; wallet?: WalletExport[]
}
export function validateBackup(text: string): Backup {
  assert(new Blob([text]).size <= MAX_BACKUP_BYTES, 'Backup exceeds the 50 MB limit.')
  const data = validatePayload(JSON.parse(text)) as Backup
  assert([2,3,4].includes(data.version), 'Unsupported backup version. Use a version 2, 3 or 4 backup.')
  const ids = new Set(data.store.profiles.map(p => p.id))
  for (const kind of ['photos','wallet'] as const) {
    assert(data[kind] === undefined || Array.isArray(data[kind]), 'Invalid attachments.')
    assert((data[kind]?.length ?? 0) <= 10000, 'Too many attachments in one backup.')
    for (const file of data[kind] ?? []) {
      assert(object(file) && typeof file.owner === 'string' && ids.has(file.owner.split('|')[0]) && Number.isFinite(file.at) && typeof file.data === 'string', 'Invalid attachment owner or data.')
      assert(file.uid === undefined || typeof file.uid === 'string', 'Invalid attachment identity.')
      if (kind === 'photos') {
        assert(file.owner.includes('|') && /^data:image\/[\w.+-]+;base64,[A-Za-z0-9+/]*={0,2}$/.test(file.data), 'Invalid photo data.')
        const caption = (file as { caption?: unknown }).caption
        if (caption !== undefined) assert(typeof caption === 'string' && caption.length <= 300, 'Invalid photo caption.')
      } else {
        assert(typeof (file as WalletExport).name === 'string' && typeof (file as WalletExport).type === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(file.data) && file.data.length <= 14 * 1024 * 1024, 'Invalid wallet file.')
      }
    }
  }
  return data
}
export interface BackupSummary {
  version: number
  profiles: { id: string; name: string; records: number; events: number; adminRecords: number; photos: number; wallet: number }[]
  photos: number
  wallet: number
}
/** Structured contents of a backup for previews before export or restore (R5a). */
export function backupSummary(data: Backup): BackupSummary {
  const countAdmin = (a: unknown) =>
    a && typeof a === 'object' ? Object.values(a as Record<string, unknown>).reduce<number>((n, v) => n + (Array.isArray(v) ? v.length : 0), 0) : 0
  return {
    version: data.version,
    profiles: data.store.profiles.map((p) => ({
      id: p.id,
      name: p.name,
      records: Object.keys(data.meta?.[p.id] ?? {}).length,
      events: (data.cache?.[p.id]?.sessions.length ?? 0) + (data.cache?.[p.id]?.keyDates?.length ?? 0),
      adminRecords: countAdmin(data.admin?.[p.id]),
      photos: (data.photos ?? []).filter((f) => f.owner.split('|')[0] === p.id).length,
      wallet: (data.wallet ?? []).filter((f) => f.owner.split('|')[0] === p.id).length,
    })),
    photos: data.photos?.length ?? 0,
    wallet: data.wallet?.length ?? 0,
  }
}
export function backupPreview(data: Backup): string {
  const records = Object.values(data.meta ?? {}).reduce((n, m) => n + Object.keys(m).length, 0)
  const events = Object.values(data.cache ?? {}).reduce((n,c) => n + c.sessions.length + (c.keyDates?.length ?? 0), 0)
  return `Restore ${data.store.profiles.length} profile(s): ${data.store.profiles.map(p => p.name).join(', ')}\n${records} session records, ${events} cached events, ${data.photos?.length ?? 0} photos, ${data.wallet?.length ?? 0} wallet files.\nMatching profiles and records will be replaced. Other profiles stay on this device. Attachments are merged without duplicates.\n${data.version < 4 ? 'This older backup has no complete event history. ' : ''}Export a current backup first if you want a separate undo copy.`
}
export async function restoreBackup(data: Backup): Promise<void> {
  await restoreWithRecovery(async () => {
    const local = JSON.parse(localStorage.getItem('timetable.store.v2') ?? 'null') as ProfileStore | null
    const incoming = new Set(data.store.profiles.map(p => p.id))
    // Device-local settings (push, location, theme, reminders, cloud-backup
    // bookkeeping…) belong to THIS device: a restore brings records back, it
    // must not flip this device's own switches (R5b).
    const restored = data.store.profiles.map(p => {
      const mine = local?.profiles.find(x => x.id === p.id)
      if (!mine) return p
      const settings = { ...p.settings } as Record<string, unknown>
      const own = mine.settings as unknown as Record<string, unknown>
      for (const key of deviceSettings) { delete settings[key]; if (key in own) settings[key] = own[key] }
      return { ...p, settings: settings as unknown as typeof p.settings }
    })
    const profiles = [...(local?.profiles ?? []).filter(p => !incoming.has(p.id)), ...restored]
    const deletedProfiles = {...local?.deletedProfiles,...data.store.deletedProfiles}
    for (const p of data.store.profiles) delete deletedProfiles[p.id]
    const metadata: Record<string,string|null> = { 'timetable.store.v2': JSON.stringify({ ...local, ...data.store, deletedProfiles, profiles }) }
    for (const [group, prefix] of Object.entries({meta:'meta.v2', admin:'admin.v1', cache:'cache.v2', changes:'changes.v2'})) {
      for (const [pid, value] of Object.entries(data[group as 'meta'] ?? {})) metadata[`timetable.${prefix}.${pid}`] = JSON.stringify(value)
    }
    return { metadata, photos: await preparePhotos(await readAttachments('photos'), data.photos ?? []), wallet: await prepareWallet(await readAttachments('wallet'), data.wallet ?? []) }
  })
}

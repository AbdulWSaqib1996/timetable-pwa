import { eventKey } from '../../shared/identity.js'
import type { Session } from '../types'
import { loadCache } from './storage'
import { validatePayload, safeURL, MAX_SYNC_BYTES } from '../../shared/contracts.js'
import { canonical, mergeRecords, mergeStores, deviceSettings, syncSettings } from '../../shared/merge.js'
import { persistValue, requireSavedData } from './persistence'
import { restoreWithRecovery } from './recovery'
import type { MetaMap, ProfileStore } from '../types'
import { loadAdminFile, mergeAdminFiles } from './admin'
import type { AdminFile } from './admin'
import { loadMeta, loadStore } from './storage'
import { telemetryTrack } from './telemetry'

/**
 * Cross-device sync via a shared code: the whole profile store + per-profile
 * notes/attendance are encrypted on this device (AES-GCM, key derived from the
 * code) and stored as an opaque blob in a revision-protected sync object. The worker only
 * ever sees ciphertext keyed by a hash of the code; photos stay local (size).
 * Deletion-aware records merge before writes; stale revisions are retried.
 */

const SYNC_STATE_KEY = 'timetable.sync.v1'

export interface SyncState {
  code: string
  /** timestamp of the newest state this device has pushed or applied */
  lastAt: number
}

export interface SyncPayload {
  identities?: Record<string, Session[]>
  store: ProfileStore
  meta: Record<string, MetaMap>
  /** PGCE admin file per profile (absent in pre-round-9 blobs) */
  admin?: Record<string, AdminFile>
}

export function loadSyncState(): SyncState | null {
  try {
    const raw = localStorage.getItem(SYNC_STATE_KEY)
    return raw ? (JSON.parse(raw) as SyncState) : null
  } catch {
    return null
  }
}

export function saveSyncState(state: SyncState): void { persistValue(SYNC_STATE_KEY, JSON.stringify(state)) }
export function clearSyncState(): void { persistValue(SYNC_STATE_KEY, null) }
export const SYNC_STATUS_EVENT = 'timetable-sync-status'
export const SYNC_APPLIED_EVENT = 'timetable-sync-applied'
let syncStatus = ''
let syncStatusAt = 0
export function getSyncStatus() { return syncStatus }
/** The current status with when it was set — for the data-health list (10 Sep 2026). */
export function getSyncStatusDetail(): { message: string; at: number; failed: boolean; busy: boolean } {
  return { message: syncStatus, at: syncStatusAt, failed: syncStatus.startsWith('Sync failed'), busy: syncStatus.startsWith('Sync server busy') }
}
export function setSyncStatus(message: string) { syncStatus = message; syncStatusAt = Date.now(); window.dispatchEvent(new Event(SYNC_STATUS_EVENT)) }

/** Sync requests must never hang: a stalled mobile connection used to block
 *  every later sync on the device (queue + Web Lock) until a restart. */
export const SYNC_FETCH_TIMEOUT_MS = 15_000
export class SyncBusyError extends Error {
  retryAfterMs: number
  constructor(retryAfterMs = 60_000) { super('Sync server busy — the app will retry shortly.'); this.retryAfterMs = retryAfterMs }
}
async function syncFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), SYNC_FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal })
    if (res.status === 429) {
      const after = Number(res.headers.get('retry-after'))
      throw new SyncBusyError(Number.isFinite(after) && after > 0 ? after * 1000 : 60_000)
    }
    return res
  } catch (error) {
    if (error instanceof SyncBusyError) throw error
    if ((error as Error)?.name === 'AbortError') throw new Error('Sync timed out after 15 seconds. Your changes remain on this device; it will retry.')
    throw error
  } finally {
    clearTimeout(t)
  }
}

/** 8 chars from an unambiguous alphabet (no 0/O/1/I/L). */
export function newSyncCode(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  let code = ''
  for (const b of crypto.getRandomValues(new Uint8Array(8))) code += chars[b % chars.length]
  return code
}

const utf8 = (s: string) => new TextEncoder().encode(s)
const b64 = (buf: ArrayBuffer | Uint8Array) =>
  btoa(Array.from(new Uint8Array(buf as ArrayBuffer), c => String.fromCharCode(c)).join(''))
const b64decode = (s: string) => Uint8Array.from([...atob(s)].map((c) => c.charCodeAt(0)))

/** Server-side lookup id: SHA-256 of the code with a purpose prefix (never the code itself). */
export async function syncId(code: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', utf8(`timetable-sync-id:${code}`))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function deriveKey(code: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', utf8(code), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: utf8('timetable-sync-v1'), iterations: 100_000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

/** gzip/gunzip via CompressionStream where available (Safari 16.4+, Chrome, Firefox). */
async function pipeThrough(
  bytes: Uint8Array,
  stream: { readable: ReadableStream; writable: WritableStream }
): Promise<Uint8Array<ArrayBuffer>> {
  const compressed = new Blob([bytes as BlobPart]).stream().pipeThrough(stream as ReadableWritablePair)
  const reader = compressed.getReader()
  const chunks: Uint8Array[] = []; let length = 0
  for (;;) { const {done,value} = await reader.read(); if (done) break; length += value.length; if (length > MAX_SYNC_BYTES) { await reader.cancel(); throw new Error('Sync data exceeds the size limit.') } chunks.push(value) }
  const out = new Uint8Array(length); let offset=0; for (const chunk of chunks) { out.set(chunk,offset); offset+=chunk.length }
  return out
}

async function encrypt(code: string, payload: SyncPayload): Promise<string> {
  let plain = utf8(JSON.stringify(payload))
  // Compress before encrypting (encrypted data doesn't compress) to stay well
  // under the server's blob cap as notes accumulate.
  if (typeof CompressionStream !== 'undefined') {
    try {
      plain = await pipeThrough(plain, new CompressionStream('gzip'))
    } catch {
      /* uncompressed is still fine */
    }
  }
  const key = await deriveKey(code)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain as BufferSource)
  const out = new Uint8Array(iv.length + ciphertext.byteLength)
  out.set(iv, 0)
  out.set(new Uint8Array(ciphertext), iv.length)
  return b64(out)
}

async function decrypt(code: string, blob: string): Promise<SyncPayload | null> {
  try {
    const raw = b64decode(blob)
    const key = await deriveKey(code)
    let plain = new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, key, raw.slice(12))
    )
    // gzip magic bytes → decompress; otherwise it's a pre-compression blob.
    if (plain[0] === 0x1f && plain[1] === 0x8b && typeof DecompressionStream !== 'undefined') {
      plain = await pipeThrough(plain, new DecompressionStream('gzip'))
    }
    if (plain.byteLength > MAX_SYNC_BYTES) throw new Error('Sync data exceeds the size limit.')
    return validatePayload(JSON.parse(new TextDecoder().decode(plain))) as SyncPayload
  } catch {
    return null
  }
}

/** Everything synced: profile store, notes/attendance and PGCE admin file per profile. */
export function collectSyncPayload(): SyncPayload | null {
  const store = loadStore() ?? JSON.parse(localStorage.getItem('timetable.store.v2') ?? 'null') as ProfileStore | null
  if (!store) return null
  const identities: Record<string, Session[]> = {}
  const meta: Record<string, MetaMap> = {}
  const admin: Record<string, AdminFile> = {}
  for (const p of store.profiles) {
    const cache = loadCache(p.id)
    identities[p.id] = cache?.identityHistory ?? [...(cache?.sessions ?? []), ...(cache?.keyDates ?? [])]
    meta[p.id] = loadMeta(p.id)
    admin[p.id] = loadAdminFile(p.id)
  }
  return { identities, store: { ...store, activeId:[...store.profiles].sort((a,b) => a.id.localeCompare(b.id))[0]?.id ?? '', profiles: store.profiles.map(p => ({ ...p, settings: syncSettings(p.settings) })) }, meta, admin }
}

const trim = (base: string) => {
  if (!safeURL(base)) throw new Error('Invalid sync server URL.')
  return base.replace(/\/+$/, '')
}
interface Remote { payload?: SyncPayload; at: number; revision: number; deleted?: boolean }
async function readRemote(base: string, code: string): Promise<Remote> {
  const res = await syncFetch(`${trim(base)}/sync-v2?id=${await syncId(code)}`)
  if (!res.ok) throw new Error('Sync could not be read. Check your connection and app/server version.')
  const rec = await res.json() as { blob?: string; at?: number; revision: number; deleted?: boolean }
  if (!Number.isSafeInteger(rec.revision) || (rec.blob?.length ?? 0) > 400000) throw new Error('Invalid sync response.')
  const payload = rec.blob ? await decrypt(code, rec.blob) : undefined
  if (rec.blob && !payload) throw new Error('The sync data could not be decrypted or validated. Local data is unchanged.')
  return { payload: payload ?? undefined, revision:rec.revision, at:rec.at ?? 0, deleted:rec.deleted }
}
export function mergePayload(local: SyncPayload, remote: SyncPayload): SyncPayload {
  const store = mergeStores(local.store, remote.store)
  store.activeId = store.profiles[0]?.id ?? ''
  const identities: Record<string, Session[]> = {}
  const meta: Record<string, MetaMap> = {}, admin: Record<string, AdminFile> = {}
  for (const p of store.profiles) {
    const identityMap = new Map<string,Session>()
    for (const item of [...(remote.identities?.[p.id] ?? []), ...(local.identities?.[p.id] ?? [])]) { const old = identityMap.get(eventKey(item)); if (!old || (item.identityAt ?? 0) > (old.identityAt ?? 0) || ((item.identityAt ?? 0) === (old.identityAt ?? 0) && canonical(item) > canonical(old))) identityMap.set(eventKey(item),item) }
    identities[p.id] = [...identityMap.values()].sort((a,b) => eventKey(a).localeCompare(eventKey(b)))
    meta[p.id] = mergeRecords(local.meta[p.id] ?? {}, remote.meta[p.id] ?? {})
    admin[p.id] = mergeAdminFiles(local.admin?.[p.id] ?? loadAdminFile(''), remote.admin?.[p.id] ?? loadAdminFile(''))
  }
  return { store, meta, admin, identities }
}
/** Merge before every write; retry revision conflicts. No stale payload is blindly posted. */
async function exchange(base: string, code: string): Promise<number | null> {
  requireSavedData()
  setSyncStatus('Syncing…')
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const remote = await readRemote(base, code)
      if (remote.deleted) throw new Error('This sync code was disconnected. Create or join a new code.')
      const local = collectSyncPayload()
      if (!local) return null
      const merged = remote.payload ? mergePayload(local, remote.payload) : local
      let at = remote.at
      if (!remote.payload || canonical(merged) !== canonical(remote.payload)) {
        if (new Blob([JSON.stringify(merged)]).size > MAX_SYNC_BYTES) throw new Error('Sync is too large. Export a backup to transfer your data.')
        const blob = await encrypt(code, merged)
        if (blob.length > 400000) throw new Error('Encrypted sync exceeds the server limit. Export a backup instead.')
        const res = await syncFetch(`${trim(base)}/sync-v2`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({id:await syncId(code), blob, revision:remote.revision}) })
        if (res.status === 409) continue
        if (!res.ok) throw new Error('The sync server rejected the update.')
        at = (await res.json()).at
      }
      // An edit during encryption/network I/O must take part in the next exchange.
      const current = collectSyncPayload()
      if (canonical(current) !== canonical(local)) continue
      if (canonical(merged) !== canonical(local)) {
        if (document.querySelector('[role="dialog"]')) {
          setSyncStatus('Saved to sync. Close the open panel to load changes from other devices.')
          return at
        }
        await applySyncPayload(merged)
      }
      setSyncStatus('Synced. Photos and wallet files stay on this device; use Backup to transfer them.')
      return at
    }
    throw new Error('Sync is busy with newer edits. Your changes remain local; retry shortly.')
  } catch (error) {
    if (error instanceof SyncBusyError) setSyncStatus(error.message)
    else setSyncStatus('Sync failed: ' + (error instanceof Error ? error.message : String(error)))
    throw error
  }
}
let syncQueue: Promise<unknown> = Promise.resolve()
export function pushSync(base: string, code: string, _opts?: {force?: boolean}): Promise<number | null> {
  const work = async () => navigator.locks ? await navigator.locks.request('timetable-sync', () => exchange(base,code)) : exchange(base,code)
  const next = syncQueue.then(work,work)
  syncQueue = next.catch(() => {})
  return next
}
export async function pullSync(base: string, code: string): Promise<{payload:SyncPayload;at:number}|null> {
  const remote = await readRemote(base,code)
  return remote.payload ? {payload:remote.payload,at:remote.at} : null
}
export async function applySyncPayload(payload: SyncPayload): Promise<void> {
  validatePayload(payload)
  await restoreWithRecovery(async () => {
    const local = collectSyncPayload()
    const merged = local ? mergePayload(local,payload) : payload
    const localStore = loadStore()
    const store = { ...merged.store, activeId: merged.store.profiles.some(p => p.id === localStore?.activeId) ? localStore!.activeId : merged.store.activeId,
      profiles: merged.store.profiles.map(p => {
        const mine = localStore?.profiles.find(x => x.id === p.id)
        const settings = {...p.settings}
        for (const key of deviceSettings) { delete (settings as any)[key]; if (mine && key in mine.settings) (settings as any)[key] = (mine.settings as any)[key] }
        return {...p,settings}
      }) }
    const metadata: Record<string,string|null> = {'timetable.store.v2':JSON.stringify(store)}
    for (const [pid,m] of Object.entries(merged.meta)) metadata[`timetable.meta.v2.${pid}`] = JSON.stringify(m)
    for (const [pid,a] of Object.entries(merged.admin ?? {})) metadata[`timetable.admin.v1.${pid}`] = JSON.stringify(a)
    for (const [pid,history] of Object.entries(merged.identities ?? {})) metadata[`timetable.cache.v2.${pid}`] = JSON.stringify({...loadCache(pid),fetchedAt:loadCache(pid)?.fetchedAt ?? 0,sessions:loadCache(pid)?.sessions ?? [],identityHistory:history})
    // A remotely deleted profile loses all of its local owners as well.
    const removed = new Set((localStore?.profiles ?? []).filter(p => !store.profiles.some(x => x.id === p.id)).map(p => p.id))
    for (let i=0;i<localStorage.length;i++) { const key = localStorage.key(i)!; if ([...removed].some(pid => key.startsWith('timetable.') && key.endsWith('.'+pid))) metadata[key] = null }
    const { readAttachments } = await import('./attachments')
    return {metadata, ...(removed.size ? {photos:(await readAttachments('photos')).filter(x => !removed.has(x.owner.split('|')[0])),wallet:(await readAttachments('wallet')).filter(x => !removed.has(x.owner.split('|')[0]))} : {})}
  })
  window.dispatchEvent(new Event(SYNC_APPLIED_EVENT))
}
export async function syncPullApply(base: string): Promise<boolean> {
  const state = loadSyncState()
  if (!state) return false
  // A4: one coarse outcome count after the operation actually settles —
  // no codes, payloads, endpoints or identifiers travel with it.
  const at = await pushSync(base,state.code).finally(() => telemetryTrack('sync_outcome'))
  if (at) saveSyncState({...state,lastAt:at})
  return false // UI receives a data event, never a destructive page reload.
}
export async function deleteSync(base: string, code: string): Promise<void> {
  const remote = await readRemote(base,code)
  const res = await syncFetch(`${trim(base)}/sync-v2/delete`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:await syncId(code),revision:remote.revision})})
  if (!res.ok) throw new Error('Sync changed while disconnecting. Retry before rotating your code.')
}

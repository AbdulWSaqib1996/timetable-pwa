import type { MetaMap, ProfileStore } from '../types'
import { loadMeta, loadStore } from './storage'

/**
 * Cross-device sync via a shared code: the whole profile store + per-profile
 * notes/attendance are encrypted on this device (AES-GCM, key derived from the
 * code) and parked as an opaque blob in the push worker's KV. The worker only
 * ever sees ciphertext keyed by a hash of the code; photos stay local (size).
 * Last write wins — the freshest `at` is applied on app start.
 */

const SYNC_STATE_KEY = 'timetable.sync.v1'

export interface SyncState {
  code: string
  /** timestamp of the newest state this device has pushed or applied */
  lastAt: number
}

export interface SyncPayload {
  store: ProfileStore
  meta: Record<string, MetaMap>
}

export function loadSyncState(): SyncState | null {
  try {
    const raw = localStorage.getItem(SYNC_STATE_KEY)
    return raw ? (JSON.parse(raw) as SyncState) : null
  } catch {
    return null
  }
}

export function saveSyncState(state: SyncState): void {
  try {
    localStorage.setItem(SYNC_STATE_KEY, JSON.stringify(state))
  } catch {
    /* storage unavailable */
  }
}

export function clearSyncState(): void {
  try {
    localStorage.removeItem(SYNC_STATE_KEY)
  } catch {
    /* ignore */
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
  btoa(String.fromCharCode(...new Uint8Array(buf as ArrayBuffer)))
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
  return new Uint8Array(await new Response(compressed).arrayBuffer())
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
    return JSON.parse(new TextDecoder().decode(plain)) as SyncPayload
  } catch {
    return null
  }
}

/** Everything synced: the profile store plus notes/attendance for each profile. */
export function collectSyncPayload(): SyncPayload | null {
  const store = loadStore()
  if (!store) return null
  const meta: Record<string, MetaMap> = {}
  for (const p of store.profiles) meta[p.id] = loadMeta(p.id)
  return { store, meta }
}

const trim = (base: string) => base.replace(/\/+$/, '')

/** Encrypt the current local state and park it on the worker. Returns the write timestamp. */
export async function pushSync(base: string, code: string): Promise<number | null> {
  const payload = collectSyncPayload()
  if (!payload) return null
  const at = Date.now()
  const res = await fetch(`${trim(base)}/sync`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: await syncId(code), blob: await encrypt(code, payload), at }),
  })
  if (!res.ok) throw new Error('The sync server rejected the update.')
  return at
}

/** Fetch and decrypt the parked state for a code; null when none exists. */
export async function pullSync(base: string, code: string): Promise<{ payload: SyncPayload; at: number } | null> {
  const res = await fetch(`${trim(base)}/sync?id=${await syncId(code)}`)
  if (!res.ok) return null
  const rec = (await res.json()) as { blob?: string; at?: number }
  if (!rec.blob || typeof rec.at !== 'number') return null
  const payload = await decrypt(code, rec.blob)
  return payload ? { payload, at: rec.at } : null
}

/** Union of two meta maps; where both edited the same session, the newer `at` wins. */
function mergeMeta(local: MetaMap, remote: MetaMap): MetaMap {
  const merged: MetaMap = { ...local }
  for (const [key, entry] of Object.entries(remote)) {
    const mine = merged[key]
    if (!mine || (entry.at ?? 0) >= (mine.at ?? 0)) merged[key] = entry
  }
  return merged
}

/**
 * Write a pulled payload into localStorage. The profile store takes the remote
 * copy (it carried the newer timestamp); notes/attendance merge per session so
 * neither device's edits are dropped. Caller reloads the app afterwards.
 */
export function applySyncPayload(payload: SyncPayload): void {
  try {
    localStorage.setItem('timetable.store.v2', JSON.stringify(payload.store))
    for (const [pid, m] of Object.entries(payload.meta)) {
      localStorage.setItem(`timetable.meta.v2.${pid}`, JSON.stringify(mergeMeta(loadMeta(pid), m)))
    }
  } catch {
    /* storage unavailable */
  }
}

/**
 * The full pull cycle: fetch the parked state, and when it's newer than what this
 * device last saw, merge it in, park the merged result back (so the other device
 * gets the union too) and return true — the caller should reload the UI.
 */
export async function syncPullApply(base: string): Promise<boolean> {
  const state = loadSyncState()
  if (!state) return false
  const remote = await pullSync(base, state.code)
  if (!remote || remote.at <= state.lastAt) return false
  applySyncPayload(remote.payload)
  const at = await pushSync(base, state.code).catch(() => null)
  saveSyncState({ ...state, lastAt: at ?? remote.at })
  return true
}

/** Remove the parked blob for a code (used when rotating or turning sync off). */
export async function deleteSync(base: string, code: string): Promise<void> {
  await fetch(`${trim(base)}/sync/delete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: await syncId(code) }),
  }).catch(() => {})
}

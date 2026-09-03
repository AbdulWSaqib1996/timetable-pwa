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

async function encrypt(code: string, payload: SyncPayload): Promise<string> {
  const key = await deriveKey(code)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, utf8(JSON.stringify(payload)))
  const out = new Uint8Array(iv.length + ciphertext.byteLength)
  out.set(iv, 0)
  out.set(new Uint8Array(ciphertext), iv.length)
  return b64(out)
}

async function decrypt(code: string, blob: string): Promise<SyncPayload | null> {
  try {
    const raw = b64decode(blob)
    const key = await deriveKey(code)
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: raw.slice(0, 12) },
      key,
      raw.slice(12)
    )
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

/** Write a pulled payload into localStorage (caller reloads the app afterwards). */
export function applySyncPayload(payload: SyncPayload): void {
  try {
    localStorage.setItem('timetable.store.v2', JSON.stringify(payload.store))
    for (const [pid, m] of Object.entries(payload.meta)) {
      localStorage.setItem(`timetable.meta.v2.${pid}`, JSON.stringify(m))
    }
  } catch {
    /* storage unavailable */
  }
}

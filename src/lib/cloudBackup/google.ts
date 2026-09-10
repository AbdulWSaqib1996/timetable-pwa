import { GOOGLE_OAUTH_CLIENT_ID, googleClientId } from '../config'
import { sha256Hex, snapshotFileName, snapshotsToPrune } from './snapshot'
import type { AuthState, CloudProvider, ProgressStep, RemoteSnapshot, SnapshotMeta } from './types'
import { CloudBackupError } from './types'

/**
 * Google Drive adapter (R5b / NF-09): Google Identity Services token model,
 * `drive.appdata` scope only, snapshots in `appDataFolder`. The access token
 * lives in this module's memory — never localStorage, logs, backups, the
 * service worker or a URL. An expired token becomes "Reconnect to back up";
 * nothing here ever opens a popup without a user gesture.
 * Docs: https://developers.google.com/workspace/drive/api/guides/appdata
 *       https://developers.google.com/identity/oauth2/web/guides/use-token-model
 */

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata'
const GIS_SRC = 'https://accounts.google.com/gsi/client'
const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
const FIELDS = 'id,name,size,createdTime,appProperties'

interface TokenClient {
  requestAccessToken: (opts?: { prompt?: string }) => void
  callback: (resp: TokenResponse) => void
}
interface TokenResponse {
  access_token?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}
interface Gis {
  accounts: {
    oauth2: {
      initTokenClient: (cfg: { client_id: string; scope: string; callback: (r: TokenResponse) => void; error_callback?: (e: { type?: string }) => void }) => TokenClient
      revoke: (token: string, done?: () => void) => void
      hasGrantedAllScopes?: (r: TokenResponse, ...scopes: string[]) => boolean
    }
  }
}

let token: { value: string; expiresAt: number } | null = null
let client: TokenClient | null = null

function gis(): Gis | null {
  return (window as unknown as { google?: Gis }).google ?? null
}

async function loadGis(): Promise<Gis> {
  const existing = gis()
  if (existing?.accounts?.oauth2) return existing
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = GIS_SRC
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new CloudBackupError('network', 'Could not load Google sign-in. Check your connection and try again.'))
    document.head.appendChild(s)
  })
  const loaded = gis()
  if (!loaded?.accounts?.oauth2) throw new CloudBackupError('network', 'Google sign-in did not initialise.')
  return loaded
}

export function googleAuthState(): AuthState {
  if (!googleClientId()) return { kind: 'not-configured' }
  if (!token) return { kind: 'disconnected' }
  if (Date.now() >= token.expiresAt - 30_000) return { kind: 'expired' }
  return { kind: 'connected', expiresAt: token.expiresAt }
}

/** Access token for a call, or a typed error the UI turns into "Reconnect". */
function bearer(): string {
  const state = googleAuthState()
  if (state.kind === 'not-configured') throw new CloudBackupError('not-configured', 'Google Drive is not configured for this build.')
  if (state.kind !== 'connected') throw new CloudBackupError('expired', 'Reconnect Google Drive to continue — the sign-in has expired.')
  return token!.value
}

async function driveFetch(url: string, init: RequestInit = {}, timeoutMs = 60_000): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${bearer()}` }, signal: ctrl.signal })
    if (res.status === 401) {
      // Keep an expired marker (not "disconnected") so the card offers Reconnect.
      token = { value: '', expiresAt: 0 }
      throw new CloudBackupError('expired', 'Reconnect Google Drive to continue — the sign-in has expired.')
    }
    if (res.status === 403) throw new CloudBackupError('missing-scope', 'Google Drive refused the request. Reconnect and allow the app-data permission.')
    if (!res.ok) throw new CloudBackupError('provider', `Google Drive returned ${res.status}.`)
    return res
  } catch (error) {
    if (error instanceof CloudBackupError) throw error
    throw new CloudBackupError('network', (error as Error)?.name === 'AbortError' ? 'Google Drive did not respond in time.' : 'Could not reach Google Drive.')
  } finally {
    clearTimeout(t)
  }
}

function metaFromFile(f: { id: string; size?: string; createdTime?: string; appProperties?: Record<string, string> }): RemoteSnapshot | null {
  const p = f.appProperties ?? {}
  if (!p.backupId || !p.installationId || !p.sha256) return null
  return {
    objectId: f.id,
    backupId: p.backupId,
    formatVersion: Number(p.formatVersion) || 0,
    installationId: p.installationId,
    scopeId: p.scopeId ?? 'all',
    createdAt: p.createdAt ?? f.createdTime ?? '',
    size: Number(p.size ?? f.size) || 0,
    sha256: p.sha256,
    profileCount: Number(p.profileCount) || 0,
    recordCount: Number(p.recordCount) || 0,
    attachmentCount: Number(p.attachmentCount) || 0,
    deviceLabel: p.deviceLabel ?? 'unknown device',
    appVersion: p.appVersion ?? '',
    verified: p.verified === '1' ? 'verified' : 'unknown',
  }
}

export const googleProvider: CloudProvider = {
  id: 'google',
  label: 'Google Drive (app data)',
  capabilities: { list: true, upload: true, download: true, deleteOwned: true, fileExport: false, fileImport: false },
  authState: googleAuthState,

  async authorize() {
    const clientId = googleClientId()
    if (!clientId) throw new CloudBackupError('not-configured', 'Google Drive is not configured for this build.')
    const g = await loadGis()
    return new Promise<void>((resolve, reject) => {
      client = g.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: DRIVE_SCOPE,
        callback: (resp) => {
          if (resp.error || !resp.access_token) {
            reject(new CloudBackupError(resp.error === 'access_denied' ? 'cancelled' : 'provider', resp.error_description || 'Google sign-in did not complete.'))
            return
          }
          if (g.accounts.oauth2.hasGrantedAllScopes && !g.accounts.oauth2.hasGrantedAllScopes(resp, DRIVE_SCOPE)) {
            reject(new CloudBackupError('missing-scope', 'The app-data permission was not granted, so backups cannot be stored.'))
            return
          }
          token = { value: resp.access_token, expiresAt: Date.now() + (resp.expires_in ?? 3600) * 1000 }
          resolve()
        },
        error_callback: (e) => reject(new CloudBackupError(e?.type === 'popup_closed' ? 'cancelled' : 'provider', e?.type === 'popup_closed' ? 'Sign-in was cancelled.' : 'Google sign-in failed.')),
      })
      client.requestAccessToken()
    })
  },

  async listBackups() {
    const res = await driveFetch(`${API}/files?spaces=appDataFolder&pageSize=100&orderBy=createdTime desc&fields=files(${FIELDS})`)
    const json = (await res.json()) as { files?: { id: string; size?: string; createdTime?: string; appProperties?: Record<string, string> }[] }
    return (json.files ?? []).map(metaFromFile).filter((x): x is RemoteSnapshot => x !== null)
  },

  async upload(envelopeText, meta, onProgress) {
    onProgress('uploading')
    const boundary = `mt-${meta.backupId}`
    const metadata = {
      name: snapshotFileName(meta),
      parents: ['appDataFolder'],
      appProperties: Object.fromEntries(Object.entries(meta).map(([k, v]) => [k, String(v)])),
    }
    const body =
      `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\ncontent-type: application/json\r\n\r\n${envelopeText}\r\n--${boundary}--`
    const res = await driveFetch(`${UPLOAD}/files?uploadType=multipart&fields=${FIELDS}`, { method: 'POST', headers: { 'content-type': `multipart/related; boundary=${boundary}` }, body }, 180_000)
    const created = (await res.json()) as { id: string; size?: string; createdTime?: string; appProperties?: Record<string, string> }
    // Verify: read the object back and compare its checksum before anything is called complete.
    onProgress('verifying')
    const back = await this.download(created.id)
    if ((await sha256Hex(back)) !== meta.sha256 || back !== envelopeText) {
      await this.deleteOwnedBackup(created.id).catch(() => {})
      throw new CloudBackupError('verify-failed', 'The uploaded backup did not read back intact, so it was discarded. The previous backup is untouched.')
    }
    await driveFetch(`${API}/files/${created.id}?fields=${FIELDS}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ appProperties: { verified: '1' } }) })
    onProgress('complete')
    const snap = metaFromFile({ ...created, appProperties: { ...metadata.appProperties, verified: '1' } })
    if (!snap) throw new CloudBackupError('provider', 'Google Drive returned an unexpected object.')
    return snap
  },

  async download(objectId) {
    const res = await driveFetch(`${API}/files/${encodeURIComponent(objectId)}?alt=media`, {}, 180_000)
    return res.text()
  },

  async deleteOwnedBackup(objectId) {
    await driveFetch(`${API}/files/${encodeURIComponent(objectId)}`, { method: 'DELETE' })
  },

  async disconnect() {
    const current = token
    token = null
    client = null
    const g = gis()
    if (current && g?.accounts?.oauth2?.revoke) {
      await new Promise<void>((resolve) => g.accounts.oauth2.revoke(current.value, () => resolve()))
    }
  },
}

/** Prune this installation's older snapshots beyond `keep`; other installations' objects are never touched. */
export async function pruneGoogleSnapshots(keep = 10, mine: string): Promise<number> {
  const all = await googleProvider.listBackups()
  const old = snapshotsToPrune(all, mine, keep)
  for (const s of old) await googleProvider.deleteOwnedBackup(s.objectId)
  return old.length
}

export { GOOGLE_OAUTH_CLIENT_ID }
export type { ProgressStep, SnapshotMeta }

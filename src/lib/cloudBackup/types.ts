/**
 * Cloud backup provider contract (R5b / NF-09). One interface for Google
 * Drive (app-data folder), the iCloud Drive file path and any later CloudKit
 * adapter. Every adapter works on the SAME archive bytes: the plain backup
 * JSON sealed in the reviewed encrypted envelope (`shared/backupEnvelope.js`).
 * Unsupported operations are explicit capabilities, never faked.
 */

export type ProviderId = 'google' | 'icloud'

export interface ProviderCapabilities {
  /** can enumerate snapshots it holds */
  list: boolean
  /** can upload and read back an object */
  upload: boolean
  /** can download a chosen snapshot */
  download: boolean
  /** can delete a snapshot this app created */
  deleteOwned: boolean
  /** hands the archive to the OS share/file flow (no remote listing or verification) */
  fileExport: boolean
  /** restores from a file the user picks */
  fileImport: boolean
}

/** Metadata stored WITH the snapshot (provider-visible) — never names or content. */
export interface SnapshotMeta {
  backupId: string
  formatVersion: number
  installationId: string
  /** 'all' or 'profile:<id>' */
  scopeId: string
  createdAt: string
  /** ciphertext byte size */
  size: number
  /** SHA-256 of the sealed envelope text, hex */
  sha256: string
  profileCount: number
  recordCount: number
  attachmentCount: number
  /** originating device label, e.g. "iPhone · Safari" */
  deviceLabel: string
  appVersion: string
}

export interface RemoteSnapshot extends SnapshotMeta {
  /** provider object id */
  objectId: string
  /** verified read-back at upload time (this installation) or unknown */
  verified: 'verified' | 'unknown'
}

export type AuthState =
  | { kind: 'not-configured' }
  | { kind: 'disconnected' }
  | { kind: 'connected'; expiresAt: number }
  | { kind: 'expired' }

export interface CloudProvider {
  id: ProviderId
  label: string
  capabilities: ProviderCapabilities
  authState(): AuthState
  /** user-gesture only; resolves when a token is held in memory */
  authorize(): Promise<void>
  listBackups(): Promise<RemoteSnapshot[]>
  /** upload to a NEW object, then read it back and verify before resolving */
  upload(envelopeText: string, meta: SnapshotMeta, onProgress: (step: ProgressStep) => void): Promise<RemoteSnapshot>
  download(objectId: string): Promise<string>
  deleteOwnedBackup(objectId: string): Promise<void>
  /** forgets the in-memory token (and revokes it where the provider allows); never deletes snapshots */
  disconnect(): Promise<void>
}

export type ProgressStep = 'preparing' | 'encrypting' | 'uploading' | 'verifying' | 'complete'

export class CloudBackupError extends Error {
  code: 'not-configured' | 'cancelled' | 'missing-scope' | 'expired' | 'network' | 'verify-failed' | 'too-large' | 'provider'
  constructor(code: CloudBackupError['code'], message: string) {
    super(message)
    this.code = code
  }
}

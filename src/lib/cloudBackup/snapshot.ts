import { ENVELOPE_VERSION, sealBackup } from '../../../shared/backupEnvelope.js'
import { backupSummary, validateBackup } from '../backup'
import type { BackupSummary } from '../backup'
import { exportBackup } from '../storage'
import type { ExportScope } from '../storage'
import type { ProfileStore, Settings } from '../../types'
import { deviceLabel, installationId, newBackupId } from './installation'
import type { SnapshotMeta } from './types'
import { CloudBackupError } from './types'

/** Drive app-data objects are limited well below this; the app's own cap is 50 MB for plain backups. */
export const MAX_SNAPSHOT_BYTES = 45 * 1024 * 1024

/**
 * Settings keys that must never leave the device inside a cloud archive:
 * device/provider credentials and cloud-backup bookkeeping. The plain local
 * backup keeps `groupToken` (same device); a cloud object does not.
 */
export const CLOUD_ARCHIVE_SETTINGS_DENYLIST = ['groupToken', 'groupMemberId', 'cloudBackups'] as const

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Typed projection: removes ONLY the optional credential/bookkeeping keys; every required Settings key survives. */
export function stripSettingsForCloud(settings: Settings): Settings {
  // Destructure the denylisted optional keys away; the rest is still a Settings.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { groupToken, groupMemberId, cloudBackups, ...rest } = settings
  return rest
}

export function stripForCloud(json: string): string {
  const data = JSON.parse(json) as { store: ProfileStore }
  data.store = { ...data.store, profiles: data.store.profiles.map((p) => ({ ...p, settings: stripSettingsForCloud(p.settings) })) }
  return JSON.stringify(data)
}

export interface PreparedSnapshot {
  envelopeText: string
  meta: SnapshotMeta
  summary: BackupSummary
}

/**
 * Build the archive every provider uploads: scoped plain backup → credential
 * denylist → reviewed envelope → metadata (opaque id, checksum, counts).
 * Size limits fail here with a clear message, before any transfer.
 */
export async function prepareSnapshot(scope: ExportScope, passphrase: string, appVersion: string): Promise<PreparedSnapshot> {
  const plain = stripForCloud(await exportBackup(scope))
  const summary = backupSummary(validateBackup(plain))
  const envelopeText = await sealBackup(plain, passphrase)
  const size = new Blob([envelopeText]).size
  if (size > MAX_SNAPSHOT_BYTES) {
    throw new CloudBackupError('too-large', `This backup is ${(size / 1048576).toFixed(1)} MB sealed — above the ${MAX_SNAPSHOT_BYTES / 1048576} MB cloud limit. Back up a single timetable, or export a local backup instead.`)
  }
  const meta: SnapshotMeta = {
    backupId: newBackupId(),
    formatVersion: ENVELOPE_VERSION,
    installationId: installationId(),
    scopeId: scope.profileIds?.length === 1 ? `profile:${scope.profileIds[0]}` : 'all',
    createdAt: new Date().toISOString(),
    size,
    sha256: await sha256Hex(envelopeText),
    profileCount: summary.profiles.length,
    recordCount: summary.profiles.reduce((n, p) => n + p.records + p.adminRecords, 0),
    attachmentCount: summary.photos + summary.wallet,
    deviceLabel: deviceLabel(),
    appVersion,
  }
  return { envelopeText, meta, summary }
}

/** Provider-visible filename: opaque id + timestamp only. */
export const snapshotFileName = (meta: SnapshotMeta) => `mt-${meta.backupId}-${meta.createdAt.replace(/[:.]/g, '-')}.json`

/** Retention: the newest `keep` snapshots of THIS installation survive; other installations are untouched. */
export function snapshotsToPrune<T extends { installationId: string; createdAt: string }>(all: T[], mine: string, keep = 10): T[] {
  return all
    .filter((s) => s.installationId === mine)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(keep)
}

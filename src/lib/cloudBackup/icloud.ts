import { downloadFile } from '../files'
import type { CloudProvider, SnapshotMeta } from './types'
import { CloudBackupError } from './types'
import { snapshotFileName } from './snapshot'

/**
 * iCloud Drive file path (R5b / NF-09): the honest option a browser has —
 * hand the sealed archive to the OS share sheet ("Save to Files → iCloud
 * Drive") when file sharing is supported, otherwise a normal download with
 * instructions. The browser cannot list, verify or delete anything in iCloud
 * Drive, so those capabilities are false, and a dismissed share sheet or a
 * download is NEVER reported as a completed cloud backup.
 */

export type FileExportOutcome = 'shared' | 'downloaded' | 'cancelled'

export function fileShareSupported(): boolean {
  try {
    const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean }
    if (typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false
    const probe = new File(['x'], 'probe.json', { type: 'application/json' })
    return nav.canShare({ files: [probe] })
  } catch {
    return false
  }
}

export async function exportArchiveFile(envelopeText: string, meta: SnapshotMeta): Promise<FileExportOutcome> {
  const name = snapshotFileName(meta)
  if (fileShareSupported()) {
    try {
      const file = new File([envelopeText], name, { type: 'application/json' })
      await (navigator as Navigator).share({ files: [file], title: 'My Timetable encrypted backup' })
      return 'shared'
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') return 'cancelled'
      // Share failed for another reason: fall back to the download below.
    }
  }
  downloadFile(name, envelopeText, 'application/json')
  return 'downloaded'
}

export const icloudProvider: CloudProvider = {
  id: 'icloud',
  label: 'iCloud Drive (file)',
  capabilities: { list: false, upload: false, download: false, deleteOwned: false, fileExport: true, fileImport: true },
  authState: () => ({ kind: 'disconnected' }),
  authorize: async () => {
    /* no account: the OS file flow needs none */
  },
  listBackups: async () => {
    throw new CloudBackupError('provider', 'The browser cannot list files in iCloud Drive.')
  },
  upload: async () => {
    throw new CloudBackupError('provider', 'iCloud Drive backups go through the share sheet or a download, not an upload.')
  },
  download: async () => {
    throw new CloudBackupError('provider', 'Pick the file from iCloud Drive with Restore from file.')
  },
  deleteOwnedBackup: async () => {
    throw new CloudBackupError('provider', 'Delete iCloud Drive files in the Files app.')
  },
  disconnect: async () => {
    /* nothing held */
  },
}

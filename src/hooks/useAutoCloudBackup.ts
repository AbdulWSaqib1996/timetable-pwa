import { useEffect, useRef } from 'react'
import { googleAuthState, googleProvider } from '../lib/cloudBackup/google'
import { onPassphraseChange, unlockedPassphrase } from '../lib/cloudBackup/session'
import { prepareSnapshot } from '../lib/cloudBackup/snapshot'
import { DATA_CHANGED_EVENT } from '../lib/persistence'
import type { Settings } from '../types'

export const AUTO_BACKUP_MIN_INTERVAL_MS = 24 * 3_600_000
/** settled writes are debounced before a snapshot is taken */
export const AUTO_BACKUP_DEBOUNCE_MS = 30_000

declare const __BUILD_ID__: string

/**
 * "Back up when I use the app" (R5b / NF-09, optional automatic mode): a
 * foreground Google Drive snapshot at most once per 24 hours, only after
 * data changed, only while online, signed in AND unlocked in this session.
 * Single-flight, no popups (an expired sign-in simply waits for the person
 * to reconnect), and never a promise about the app being closed.
 */
export function useAutoCloudBackup(settings: Settings | null, onUpdateSettings: (patch: Partial<Settings>) => void) {
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const updateRef = useRef(onUpdateSettings)
  updateRef.current = onUpdateSettings
  const runningRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const eligible = () => {
      const g = settingsRef.current?.cloudBackups?.google
      if (!g?.autoBackup) return false
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
      if (googleAuthState().kind !== 'connected') return false
      if (!unlockedPassphrase()) return false
      if (g.lastAutoAt && Date.now() - g.lastAutoAt < AUTO_BACKUP_MIN_INTERVAL_MS) return false
      return true
    }
    const run = async () => {
      if (runningRef.current || !eligible()) return
      runningRef.current = true
      try {
        const passphrase = unlockedPassphrase()!
        const prepared = await prepareSnapshot({}, passphrase, typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev')
        const snap = await googleProvider.upload(prepared.envelopeText, prepared.meta, () => {})
        const current = settingsRef.current?.cloudBackups ?? {}
        updateRef.current({
          cloudBackups: { ...current, google: { ...current.google, lastBackupAt: Date.now(), lastBackupId: snap.backupId, lastAutoAt: Date.now() } },
        })
      } catch {
        /* the manual card shows the live state; nothing is retried in a loop */
      } finally {
        runningRef.current = false
      }
    }
    const schedule = () => {
      if (!eligible()) return
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => void run(), AUTO_BACKUP_DEBOUNCE_MS)
    }
    window.addEventListener(DATA_CHANGED_EVENT, schedule)
    const off = onPassphraseChange(schedule)
    return () => {
      window.removeEventListener(DATA_CHANGED_EVENT, schedule)
      off()
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])
}

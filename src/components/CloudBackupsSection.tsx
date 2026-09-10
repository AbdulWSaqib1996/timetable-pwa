import { useEffect, useMemo, useState } from 'react'
import { MIN_PASSPHRASE_LENGTH } from '../../shared/backupEnvelope.js'
import { backupSummary, validateBackup } from '../lib/backup'
import type { BackupSummary } from '../lib/backup'
import { googleAuthState, googleProvider, pruneGoogleSnapshots } from '../lib/cloudBackup/google'
import { exportArchiveFile, fileShareSupported } from '../lib/cloudBackup/icloud'
import { installationId } from '../lib/cloudBackup/installation'
import { onPassphraseChange, setUnlockedPassphrase, unlockedPassphrase } from '../lib/cloudBackup/session'
import { prepareSnapshot } from '../lib/cloudBackup/snapshot'
import type { ProgressStep, RemoteSnapshot } from '../lib/cloudBackup/types'
import { CloudBackupError } from '../lib/cloudBackup/types'
import { readAttachments } from '../lib/attachments'
import { exportBackup, markBackedUp } from '../lib/storage'
import { telemetryTrack } from '../lib/telemetry'
import type { ProfileStore, Settings } from '../types'
import { Card, Field, IconClose } from './ui'

declare const __BUILD_ID__: string

interface Props {
  settings: Settings
  store: ProfileStore
  onUpdateSettings: (patch: Partial<Settings>) => void
  /** hand an archive to the existing restore preview (passphrase pre-unlocked when known) */
  onRestore: (text: string, passphrase?: string) => void
}

const STEPS: { id: ProgressStep; label: string }[] = [
  { id: 'preparing', label: 'Preparing' },
  { id: 'encrypting', label: 'Encrypting' },
  { id: 'uploading', label: 'Uploading' },
  { id: 'verifying', label: 'Verifying' },
  { id: 'complete', label: 'Complete' },
]

const when = (ms: number) => new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const whenISO = (iso: string) => (iso ? when(Date.parse(iso)) : 'unknown time')
const sizeOf = (bytes: number) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

/**
 * Settings → Data & devices → Cloud backups (R5b / NF-09). Two honest cards:
 * Google Drive (app-data folder, listed/verified/restorable in the app) and
 * iCloud Drive (a file handed to the share sheet or downloaded — the app
 * cannot see or verify it). Both use the same passphrase-sealed archive; the
 * passphrase and the Google token live only in memory for this session.
 * Only a completed, verified upload changes "Last cloud backup".
 */
export function CloudBackupsSection({ settings, store, onUpdateSettings, onRestore }: Props) {
  const active = store.profiles.find((p) => p.id === store.activeId)
  const cb = settings.cloudBackups ?? {}
  const [auth, setAuth] = useState(googleAuthState())
  const [passInput, setPassInput] = useState('')
  const [unlocked, setUnlocked] = useState(unlockedPassphrase() !== null)
  const [scope, setScope] = useState<'all' | 'active'>('all')
  const [summary, setSummary] = useState<BackupSummary | null>(null)
  const [missingPhotos, setMissingPhotos] = useState<number | null>(null)
  const [step, setStep] = useState<ProgressStep | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null)
  const [snapshots, setSnapshots] = useState<RemoteSnapshot[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [icloudMsg, setIcloudMsg] = useState<string | null>(null)
  const mine = useMemo(() => installationId(), [])

  useEffect(() => onPassphraseChange(() => setUnlocked(unlockedPassphrase() !== null)), [])
  useEffect(() => {
    const t = setInterval(() => setAuth(googleAuthState()), 30_000)
    return () => clearInterval(t)
  }, [])

  // Scope preview: what the archive will contain, and which recorded photos
  // are NOT on this device (they cannot be in it).
  useEffect(() => {
    let live = true
    const scopeArg = scope === 'active' && active ? { profileIds: [active.id] } : {}
    void exportBackup(scopeArg)
      .then(async (json) => {
        if (!live) return
        const data = validateBackup(json)
        setSummary(backupSummary(data))
        const recorded = Object.values(data.meta ?? {}).reduce((n, m) => n + Object.values(m).reduce((k, e) => k + (e.deleted ? 0 : e.photos ?? 0), 0), 0)
        const local = (await readAttachments('photos')).filter((p) => !scopeArg.profileIds || scopeArg.profileIds.includes(p.owner.split('|')[0])).length
        if (live) setMissingPhotos(Math.max(0, recorded - local))
      })
      .catch(() => live && setSummary(null))
    return () => {
      live = false
    }
  }, [scope, active?.id, store])

  const refreshList = async () => {
    try {
      setSnapshots(await googleProvider.listBackups())
    } catch (e) {
      setSnapshots(null)
      if (e instanceof CloudBackupError && e.code === 'expired') setAuth(googleAuthState())
    }
  }
  useEffect(() => {
    if (auth.kind === 'connected') void refreshList()
    else setSnapshots(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.kind])

  const fail = (e: unknown) => {
    const err = e instanceof CloudBackupError ? e : null
    setMessage({ tone: 'warn', text: err ? err.message : `Something went wrong: ${String(e)}` })
    setAuth(googleAuthState())
  }

  async function connect() {
    setMessage(null)
    setBusy(true)
    try {
      await googleProvider.authorize()
      setAuth(googleAuthState())
      setMessage({ tone: 'ok', text: 'Google Drive connected for this session. Snapshots are app-managed backups in your Drive app-data folder — not visible files in a Drive folder.' })
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  function unlock() {
    if (passInput.length < MIN_PASSPHRASE_LENGTH) {
      setMessage({ tone: 'warn', text: `Use a backup passphrase of at least ${MIN_PASSPHRASE_LENGTH} characters. It cannot be recovered and it is not your sync code.` })
      return
    }
    setUnlockedPassphrase(passInput)
    setPassInput('')
    setMessage({ tone: 'ok', text: 'Passphrase unlocked for this session only — it is never stored. Keep it somewhere safe, independent of Google.' })
  }

  async function backUpNow() {
    const passphrase = unlockedPassphrase()
    if (!passphrase) return setMessage({ tone: 'warn', text: 'Unlock a backup passphrase first.' })
    setMessage(null)
    setBusy(true)
    try {
      setStep('preparing')
      const prepared = await prepareSnapshot(scope === 'active' && active ? { profileIds: [active.id] } : {}, passphrase, typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev')
      setStep('encrypting')
      const snap = await googleProvider.upload(prepared.envelopeText, prepared.meta, setStep)
      const current = settings.cloudBackups ?? {}
      onUpdateSettings({ cloudBackups: { ...current, google: { ...current.google, lastBackupAt: Date.now(), lastBackupId: snap.backupId } } })
      markBackedUp({ profiles: scope === 'active' && active ? [active.id] : store.profiles.map((p) => p.id), all: scope === 'all', kind: 'cloud' })
      telemetryTrack('export_prepared')
      let pruned = 0
      if (cb.google?.prune) pruned = await pruneGoogleSnapshots(10, mine).catch(() => 0)
      setMessage({ tone: 'ok', text: `Backup complete and verified: ${snap.profileCount} timetable${snap.profileCount === 1 ? '' : 's'}, ${snap.recordCount} records, ${snap.attachmentCount} attachments, ${sizeOf(snap.size)}.${pruned ? ` ${pruned} older snapshot${pruned === 1 ? '' : 's'} from this device removed.` : ''}` })
      await refreshList()
    } catch (e) {
      fail(e)
    } finally {
      setStep(null)
      setBusy(false)
    }
  }

  async function restoreSnapshot(s: RemoteSnapshot) {
    setMessage(null)
    setBusy(true)
    try {
      const text = await googleProvider.download(s.objectId)
      const current = settings.cloudBackups ?? {}
      onUpdateSettings({ cloudBackups: { ...current, google: { ...current.google, restores: [{ at: Date.now(), backupId: s.backupId, createdAt: s.createdAt }, ...(current.google?.restores ?? [])].slice(0, 10) } } })
      onRestore(text, unlockedPassphrase() ?? undefined)
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  async function deleteSnapshot(s: RemoteSnapshot) {
    if (!window.confirm(`Delete the snapshot from ${whenISO(s.createdAt)} (${s.deviceLabel})? Other snapshots stay.`)) return
    setBusy(true)
    try {
      await googleProvider.deleteOwnedBackup(s.objectId)
      await refreshList()
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  async function disconnect() {
    await googleProvider.disconnect()
    setAuth(googleAuthState())
    setMessage({ tone: 'ok', text: 'Disconnected. Your snapshots stay in Google Drive; connect again to see or restore them.' })
  }

  async function saveToICloud() {
    const passphrase = unlockedPassphrase()
    if (!passphrase) return setIcloudMsg('Unlock a backup passphrase above first — the file is sealed with it.')
    setBusy(true)
    setIcloudMsg(null)
    try {
      const prepared = await prepareSnapshot(scope === 'active' && active ? { profileIds: [active.id] } : {}, passphrase, typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev')
      const outcome = await exportArchiveFile(prepared.envelopeText, prepared.meta)
      const current = settings.cloudBackups ?? {}
      if (outcome === 'cancelled') setIcloudMsg('Share cancelled — nothing was saved.')
      else {
        onUpdateSettings({ cloudBackups: { ...current, icloud: { lastExportAt: Date.now(), lastOutcome: outcome } } })
        markBackedUp({ profiles: scope === 'active' && active ? [active.id] : store.profiles.map((p) => p.id), all: scope === 'all', kind: 'file' })
        telemetryTrack('export_prepared')
        setIcloudMsg(
          outcome === 'shared'
            ? 'File handed to the share sheet — choose Save to Files → iCloud Drive. The app cannot confirm it was saved there.'
            : 'Downloaded to this device — move the file into iCloud Drive in Files or Finder. This is not a confirmed cloud backup.'
        )
      }
    } catch (e) {
      setIcloudMsg(e instanceof CloudBackupError ? e.message : `Could not prepare the file: ${String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const scopeChips = (
    <div className="chip-grid" role="group" aria-label="Cloud backup scope">
      <button type="button" className={`chip${scope === 'all' ? ' chip-on' : ''}`} aria-pressed={scope === 'all'} onClick={() => setScope('all')}>
        Everything on this device
      </button>
      <button type="button" className={`chip${scope === 'active' ? ' chip-on' : ''}`} aria-pressed={scope === 'active'} onClick={() => setScope('active')}>
        Only “{active?.name ?? 'this timetable'}”
      </button>
    </div>
  )

  const google = cb.google ?? {}
  return (
    <section className="filter-section" id="cloud-backups" aria-labelledby="cloud-backups-heading">
      <h3 id="cloud-backups-heading" tabIndex={-1}>Cloud backups</h3>
      <p className="filter-hint">
        Versioned recovery snapshots, off by default. They complement device sync, never replace it. Every snapshot is sealed
        with a backup passphrase before it leaves this device; connecting a provider never restores or overwrites anything.
      </p>

      <Field label="Backup passphrase (this session)">
        <div className="feed-row">
          <input
            type="password"
            autoComplete="off"
            placeholder={unlocked ? 'Unlocked for this session' : `At least ${MIN_PASSPHRASE_LENGTH} characters`}
            aria-label="Backup passphrase"
            value={passInput}
            onChange={(e) => setPassInput(e.target.value)}
          />
          <button type="button" className="btn-secondary" onClick={unlock} disabled={!passInput}>
            {unlocked ? 'Change' : 'Unlock'}
          </button>
        </div>
      </Field>
      <p className="filter-hint">
        {unlocked ? 'Unlocked for this session — forgotten when the app closes.' : 'Not unlocked. '}
        The passphrase is never stored or sent anywhere, cannot be recovered, and is not your sync code. Keep it somewhere
        independent of Google or Apple.
      </p>
      {scopeChips}
      <p className="filter-hint">
        {summary
          ? `Will contain: ${summary.profiles.map((p) => `${p.name} (${p.records + p.adminRecords} records, ${p.photos} photos, ${p.wallet} documents)`).join(' · ')}.`
          : 'Preparing preview…'}
        {missingPhotos ? ` ${missingPhotos} photo${missingPhotos === 1 ? '' : 's'} recorded on another device are not on this one and cannot be included.` : ''}
      </p>

      <Card className="cloud-card">
        <div className="pgce-section-head">
          <h2>Google Drive</h2>
          <span className="filter-hint cloud-state">
            {auth.kind === 'not-configured'
              ? 'not configured for this build'
              : auth.kind === 'connected'
                ? `connected this session until ${new Date(auth.expiresAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
                : auth.kind === 'expired'
                  ? 'sign-in expired — reconnect to back up'
                  : 'not connected'}
          </span>
        </div>
        <p className="filter-hint">
          App-managed snapshots in your Drive app-data folder (permission: app data only, never your Drive files). Last cloud
          backup:{' '}
          {google.lastBackupAt ? `${when(google.lastBackupAt)} (verified)` : 'none from this device'}.
        </p>
        {auth.kind === 'not-configured' && (
          <p className="filter-hint">
            This build has no Google OAuth client id, so Google Drive stays off. The owner sets VITE_GOOGLE_OAUTH_CLIENT_ID at
            build time (see GOOGLE_DRIVE_SETUP.md); nothing else changes.
          </p>
        )}
        <div className="btn-row">
          {auth.kind !== 'connected' ? (
            <button type="button" className="btn-primary" disabled={auth.kind === 'not-configured' || busy} onClick={() => void connect()}>
              {auth.kind === 'expired' ? 'Reconnect to back up' : 'Connect Google Drive'}
            </button>
          ) : (
            <>
              <button type="button" className="btn-primary" disabled={busy || !unlocked} onClick={() => void backUpNow()}>
                {busy && step ? 'Backing up…' : 'Back up now'}
              </button>
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => void refreshList()}>
                Refresh list
              </button>
              <button type="button" className="btn-ghost" disabled={busy} onClick={() => void disconnect()}>
                Disconnect (keeps snapshots)
              </button>
            </>
          )}
        </div>
        {step && (
          <ol className="cloud-progress" aria-label="Backup progress" aria-live="polite">
            {STEPS.map((s) => {
              const idx = STEPS.findIndex((x) => x.id === step)
              const i = STEPS.findIndex((x) => x.id === s.id)
              return (
                <li key={s.id} className={i < idx ? 'done' : i === idx ? 'current' : ''}>
                  {i < idx ? '✓ ' : i === idx ? '… ' : ''}
                  {s.label}
                </li>
              )
            })}
          </ol>
        )}
        {message && (
          <p className={message.tone === 'warn' ? 'setup-error' : 'filter-hint'} role={message.tone === 'warn' ? 'alert' : 'status'}>
            {message.text}
          </p>
        )}
        {auth.kind === 'connected' && (
          <>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={google.autoBackup === true}
                onChange={(e) => onUpdateSettings({ cloudBackups: { ...cb, google: { ...google, autoBackup: e.target.checked } } })}
              />
              Back up when I use the app (at most once a day, only while connected and unlocked in this session — never with the app closed)
            </label>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={google.prune === true}
                onChange={(e) => onUpdateSettings({ cloudBackups: { ...cb, google: { ...google, prune: e.target.checked } } })}
              />
              Keep only this device’s latest 10 snapshots (other devices’ snapshots are never touched)
            </label>
            <h4 className="subheading">Snapshots in Drive</h4>
            {snapshots === null ? (
              <p className="filter-hint">Loading…</p>
            ) : snapshots.length === 0 ? (
              <p className="filter-hint">No snapshots yet.</p>
            ) : (
              <ul className="cloud-snapshots" aria-label="Snapshots in Google Drive">
                {snapshots.map((s) => (
                  <li key={s.objectId}>
                    <div className="change-body">
                      <span className="change-title">
                        {whenISO(s.createdAt)} · {s.deviceLabel}
                        {s.installationId === mine ? ' (this device)' : ''}
                      </span>
                      <span className="change-meta">
                        format v{s.formatVersion} · {s.scopeId === 'all' ? 'everything' : 'one timetable'} · {s.profileCount} timetable
                        {s.profileCount === 1 ? '' : 's'} · {s.recordCount} records · {s.attachmentCount} attachments · {sizeOf(s.size)} ·{' '}
                        {s.verified === 'verified' ? 'verified' : 'verification unknown'}
                        {s.appVersion ? ` · build ${s.appVersion.slice(0, 8)}` : ''}
                      </span>
                    </div>
                    <span className="kd-actions">
                      <button type="button" className="btn-secondary" disabled={busy} onClick={() => void restoreSnapshot(s)}>
                        Restore…
                      </button>
                      {s.installationId === mine && (
                        <button type="button" className="btn-icon" aria-label={`Delete snapshot from ${whenISO(s.createdAt)}`} disabled={busy} onClick={() => void deleteSnapshot(s)}>
                          <IconClose />
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {(google.restores?.length ?? 0) > 0 && (
              <p className="filter-hint">
                Restore history: {google.restores!.map((r) => `${when(r.at)} ← snapshot of ${whenISO(r.createdAt)}`).join(' · ')}
              </p>
            )}
          </>
        )}
      </Card>

      <Card className="cloud-card">
        <div className="pgce-section-head">
          <h2>iCloud Drive</h2>
          <span className="filter-hint cloud-state">{fileShareSupported() ? 'share sheet available' : 'download only on this browser'}</span>
        </div>
        <p className="filter-hint">
          The browser cannot see iCloud Drive. This hands the sealed backup file to the system{' '}
          {fileShareSupported() ? 'share sheet (choose Save to Files → iCloud Drive)' : 'download (move it into iCloud Drive yourself)'};
          restore by picking the file. Last file export:{' '}
          {cb.icloud?.lastExportAt ? `${when(cb.icloud.lastExportAt)} (${cb.icloud.lastOutcome === 'shared' ? 'handed to share sheet' : 'downloaded'}) — not a confirmed cloud backup` : 'none'}.
        </p>
        <div className="btn-row">
          <button type="button" className="btn-primary" disabled={busy || !unlocked} onClick={() => void saveToICloud()}>
            Save to iCloud Drive
          </button>
          <label className="btn-secondary cloud-file-label">
            Restore from file…
            <input
              type="file"
              accept="application/json,.json"
              hidden
              aria-label="Restore from an iCloud Drive file"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void file.text().then((text) => onRestore(text, unlockedPassphrase() ?? undefined))
                e.target.value = ''
              }}
            />
          </label>
        </div>
        {icloudMsg && (
          <p className="filter-hint" role="status">
            {icloudMsg}
          </p>
        )}
      </Card>
    </section>
  )
}

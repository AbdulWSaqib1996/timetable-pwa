import { useEffect, useState } from 'react'
import { MIN_PASSPHRASE_LENGTH, isEnvelope, openBackup, sealBackup } from '../../shared/backupEnvelope.js'
import { backupSummary, restoreImpact, validateBackup } from '../lib/backup'
import type { BackupSummary, RestoreImpact } from '../lib/backup'
import { readAttachments, attachmentUid } from '../lib/attachments'
import { loadAdminFile } from '../lib/admin'
import { loadMeta, loadStore } from '../lib/storage'
import { downloadFile } from '../lib/files'
import { reportPersistenceFailure } from '../lib/persistence'
import { exportBackup, importBackup, markBackedUp } from '../lib/storage'
import type { ProfileStore } from '../types'
import { Dialog, Field, StatusMessage } from './ui'

const sizeOf = (text: string) => {
  const bytes = new Blob([text]).size
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function SummaryList({ summary }: { summary: BackupSummary }) {
  return (
    <ul className="notif-overview backup-summary" aria-label="Backup contents">
      {summary.profiles.map((p) => (
        <li key={p.id}>
          <span>{p.name}</span>
          <span className="notif-state">
            {p.records} session record{p.records === 1 ? '' : 's'} · {p.events} cached event{p.events === 1 ? '' : 's'} · {p.adminRecords} PGCE/task record
            {p.adminRecords === 1 ? '' : 's'} · {p.photos} photo{p.photos === 1 ? '' : 's'} · {p.wallet} document{p.wallet === 1 ? '' : 's'}
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Backup export with a preview first (R5a / NF-05): explicit scope (all
 * profiles by default, or only the active one — owner ids are kept), an
 * optional passphrase-sealed envelope, and an honest result: "Backup
 * generated", never "safely backed up" — a download is proof of nothing
 * until the file is visible where it was saved.
 */
export function BackupSheet({ store, onClose }: { store: ProfileStore; onClose: () => void }) {
  const active = store.profiles.find((p) => p.id === store.activeId)
  const [scope, setScope] = useState<'all' | 'active'>('all')
  const [encrypt, setEncrypt] = useState(false)
  const [pass, setPass] = useState('')
  const [pass2, setPass2] = useState('')
  const [json, setJson] = useState<string | null>(null)
  const [summary, setSummary] = useState<BackupSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const [done, setDone] = useState<{ name: string; size: string; encrypted: boolean } | null>(null)

  useEffect(() => {
    let live = true
    setJson(null)
    setSummary(null)
    setDone(null)
    void exportBackup(scope === 'active' && active ? { profileIds: [active.id] } : {})
      .then((text) => {
        if (!live) return
        setJson(text)
        setSummary(backupSummary(validateBackup(text)))
      })
      .catch((e) => live && setError(String(e)))
    return () => {
      live = false
    }
  }, [scope, active])

  async function generate() {
    if (!json) return
    setError(null)
    if (encrypt) {
      if (pass.length < MIN_PASSPHRASE_LENGTH) return setError(`Use a passphrase of at least ${MIN_PASSPHRASE_LENGTH} characters.`)
      if (pass !== pass2) return setError('The two passphrases do not match.')
    }
    setWorking(true)
    try {
      const stamp = new Date().toISOString().slice(0, 10)
      const name = `my-timetable-backup-${stamp}${scope === 'active' && active ? `-${active.name.replace(/[^\w-]+/g, '_').slice(0, 30)}` : ''}${encrypt ? '.encrypted' : ''}.json`
      const text = encrypt ? await sealBackup(json, pass) : json
      downloadFile(name, text, 'application/json')
      markBackedUp({ profiles: scope === 'active' && active ? [active.id] : store.profiles.map((p) => p.id), all: scope === 'all' })
      setDone({ name, size: sizeOf(text), encrypted: encrypt })
    } catch (e) {
      reportPersistenceFailure('Backup export failed: ' + String(e))
      setError('Backup could not be generated: ' + String(e))
    } finally {
      setWorking(false)
    }
  }

  return (
    <Dialog label="Back up" onClose={onClose}>
      <div className="sheet-header">
        <h2>Back up</h2>
        <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <Field label="What to include">
        <div className="chip-grid" role="group" aria-label="Backup scope">
          <button type="button" className={`chip${scope === 'all' ? ' chip-on' : ''}`} aria-pressed={scope === 'all'} onClick={() => setScope('all')}>
            Everything on this device ({store.profiles.length} timetable{store.profiles.length === 1 ? '' : 's'})
          </button>
          <button type="button" className={`chip${scope === 'active' ? ' chip-on' : ''}`} aria-pressed={scope === 'active'} onClick={() => setScope('active')}>
            Only “{active?.name ?? 'this timetable'}”
          </button>
        </div>
      </Field>
      <p className="filter-hint">
        A complete backup is the recovery option to keep. A single-timetable backup keeps that timetable’s own identity, so it
        restores back onto the same timetable — other timetables on a device are never touched by it.
      </p>
      <h3 className="subheading">Preview</h3>
      {summary ? <SummaryList summary={summary} /> : <p className="filter-hint">Preparing preview…</p>}
      <label className="toggle-row">
        <input type="checkbox" checked={encrypt} onChange={(e) => setEncrypt(e.target.checked)} />
        Encrypt with a passphrase (portable encrypted backup)
      </label>
      {encrypt && (
        <>
          <div className="task-edit-row">
            <Field label="Passphrase">
              <input type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} />
            </Field>
            <Field label="Repeat passphrase">
              <input type="password" autoComplete="new-password" value={pass2} onChange={(e) => setPass2(e.target.value)} />
            </Field>
          </div>
          <p className="filter-hint">
            At least {MIN_PASSPHRASE_LENGTH} characters. AES-256-GCM with a PBKDF2-SHA-256 key; the same passphrase opens the file on any
            device. It is NOT your sync code and it cannot be recovered — if you lose it, the backup is unreadable.
          </p>
        </>
      )}
      {error && (
        <p className="setup-error" role="alert">
          {error}
        </p>
      )}
      {done && (
        <StatusMessage tone="success">
          <span>
            Backup generated: {done.name} ({done.size}){done.encrypted ? ', encrypted' : ''}. It is only safe once you can see the file
            where you saved it — the download prompt is not proof it was kept anywhere.
          </span>
        </StatusMessage>
      )}
      <div className="modal-actions">
        <button type="button" className="btn-primary" disabled={!json || working} onClick={() => void generate()}>
          {working ? 'Generating…' : done ? 'Generate again' : 'Generate backup'}
        </button>
        <button type="button" className="btn-ghost" onClick={onClose}>
          {done ? 'Done' : 'Cancel'}
        </button>
      </div>
    </Dialog>
  )
}

/**
 * Restore with a preview (R5a): an encrypted envelope asks for its
 * passphrase (wrong passphrase and corruption are reported as one honest
 * state, nothing on the device changes); a plain or unlocked backup is
 * validated and previewed before Restore commits it through the recovery
 * journal. Other profiles on the device are never deleted by a restore.
 */
export function RestoreSheet({ text, passphrase, onClose, onRestored }: { text: string; /** a passphrase already unlocked this session (cloud restore) */ passphrase?: string; onClose: () => void; onRestored: () => void }) {
  const encrypted = isEnvelope(text)
  const [pass, setPass] = useState(passphrase ?? '')
  const [plain, setPlain] = useState<string | null>(encrypted ? null : text)
  const [summary, setSummary] = useState<BackupSummary | null>(null)
  const [impact, setImpact] = useState<RestoreImpact | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  // A session-unlocked passphrase opens the archive straight away; a wrong one
  // simply leaves the prompt on screen.
  useEffect(() => {
    if (encrypted && passphrase && plain === null) void unlock()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (plain === null) return
    let live = true
    try {
      const data = validateBackup(plain)
      setSummary(backupSummary(data))
      setError(null)
      // Impact plan (FA-07): computed against THIS device's data.
      void (async () => {
        const uids = new Set<string>()
        for (const kind of ['photos', 'wallet'] as const) for (const a of await readAttachments(kind).catch(() => [])) uids.add(await attachmentUid(a))
        if (!live) return
        setImpact(restoreImpact(data, loadStore(), loadMeta, (pid) => loadAdminFile(pid) as unknown as Record<string, unknown[]>, uids))
      })()
    } catch (e) {
      setSummary(null)
      setImpact(null)
      setError('This file is not a usable backup: ' + String(e))
    }
    return () => {
      live = false
    }
  }, [plain])

  async function unlock() {
    setWorking(true)
    setError(null)
    const result = await openBackup(text, pass)
    setWorking(false)
    if (!result.ok) {
      setError(
        result.reason === 'wrong-passphrase-or-corrupt'
          ? 'Could not unlock: either the passphrase is wrong or the file is corrupt. Nothing on this device changed.'
          : result.reason === 'unsupported-version'
            ? 'This encrypted backup uses a newer format than this app understands.'
            : 'This file is not a valid encrypted backup.'
      )
      return
    }
    setPlain(result.plaintext)
  }

  async function restore() {
    if (!plain) return
    setWorking(true)
    setError(null)
    try {
      await importBackup(plain, impact ?? undefined)
      onRestored()
    } catch (e) {
      setError('Restore did not finish: ' + String(e))
      setWorking(false)
    }
  }

  return (
    <Dialog label="Restore backup" onClose={onClose}>
      <div className="sheet-header">
        <h2>Restore backup</h2>
        <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      {plain === null ? (
        <>
          <p className="filter-hint">This backup is encrypted. Enter the passphrase it was sealed with — it is not your sync code.</p>
          <Field label="Passphrase">
            <input
              type="password"
              autoComplete="current-password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void unlock()
              }}
            />
          </Field>
        </>
      ) : summary ? (
        <>
          <p className="filter-hint">
            Version {summary.version} backup. Matching timetables and records are replaced; other timetables on this device stay as
            they are; photos and documents merge without duplicates.
            {summary.version < 4 ? ' This older backup has no complete event history.' : ''}
          </p>
          <SummaryList summary={summary} />
          {impact && (
            <ul className="notif-overview restore-impact" aria-label="What restoring will do">
              {impact.profiles.map((p) => {
                const word = (e: string) => (e === 'replace' ? 'replaced' : e === 'replace-with-empty' ? 'replaced with an empty set' : 'not in the file — kept as it is')
                return (
                  <li key={p.id}>
                    <span>
                      {p.name} ({p.status === 'new' ? 'new on this device' : 'existing'})
                    </span>
                    <span className={`notif-state${p.newerLocalEdits ? ' warn' : ''}`}>
                      session records {word(p.sections.meta)} · PGCE/tasks {word(p.sections.admin)} · cached timetable {word(p.sections.cache)} · change history {word(p.sections.changes)} ·{' '}
                      {p.attachments.incoming} attachment{p.attachments.incoming === 1 ? '' : 's'} merge ({p.attachments.alreadyPresent} already here)
                      {p.newerLocalEdits ? ' · ⚠ this device has edits newer than the backup that would be replaced' : ''}
                    </span>
                  </li>
                )
              })}
              <li>
                <span>Other timetables on this device</span>
                <span className="notif-state">{impact.unrelatedKept.length === 0 ? 'none' : `${impact.unrelatedKept.join(', ')} — untouched`}</span>
              </li>
              <li>
                <span>Backup created</span>
                <span className="notif-state">{impact.exportedAt ? new Date(impact.exportedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'unknown (older format)'} · version {impact.version}</span>
              </li>
            </ul>
          )}
          <p className="filter-hint">Export a current backup first if you want a separate undo copy.</p>
        </>
      ) : null}
      {error && (
        <p className="setup-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        {plain === null ? (
          <button type="button" className="btn-primary" disabled={working || !pass} onClick={() => void unlock()}>
            {working ? 'Unlocking…' : 'Unlock'}
          </button>
        ) : (
          <button type="button" className="btn-primary" disabled={working || !summary} onClick={() => void restore()}>
            {working ? 'Restoring…' : 'Restore'}
          </button>
        )}
        <button type="button" className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  )
}

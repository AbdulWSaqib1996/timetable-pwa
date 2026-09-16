import { useEffect, useMemo, useState } from 'react'
import { IconShield } from './ui'
import { attachmentUid, readAttachments } from '../lib/attachments'
import { backupHistory, loadMeta } from '../lib/storage'
import { downloadFile } from '../lib/files'
import { collections } from '../../shared/contracts.js'
import { backupSummaryState, buildRecoveryGuide, fileRows, relinkUid, shareSummary, syncSummary } from '../../shared/dataCentre.js'
import type { FileRow } from '../../shared/dataCentre.js'
import type { AdminFile } from '../lib/admin'
import type { ProfileStore, Settings } from '../types'
import type { SyncState } from '../lib/sync'

interface Props {
  store: ProfileStore
  admin: AdminFile
  settings: Settings
  online: boolean
  syncState: SyncState | null
  syncDetail: { message: string; at: number; failed: boolean; busy: boolean }
  onUpdateAdmin: (updater: (prev: AdminFile) => AdminFile) => void
}

type LocalFile = { uid: string; name: string; kind: 'photo' | 'wallet'; size?: number }

const fmtAt = (ms: number) => new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const fmtDay = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const REF_LABEL: Record<string, string> = { pack: 'review pack', 'project-draft': 'assignment draft', 'project-receipt': 'submission receipt', 'project-feedback': 'assignment feedback', 'homework-resource': 'homework resource', 'placement-resource': 'placement resource' }

/**
 * Data & sharing centre (audit E05, Pass 85). Four states from CONFIRMED
 * results only — a persisted save, the server-acknowledged sync time, a backup
 * generation recorded here with the file identities it carried, and shares the
 * mentor service acknowledged — each with its last confirmed result and scope.
 * "Review details" opens a per-file table: where it is, whether a generated
 * backup contained its bytes, which share revision includes it and when the
 * portal copy expires; a referenced file that is not on this device is listed
 * as missing with a Relink. The recovery guide is plain language with no
 * code, token or key in it. Nothing here calls a download prompt a backup or
 * an attempt a share.
 */
export function DataCentre({ store, admin, settings, online, syncState, syncDetail, onUpdateAdmin }: Props) {
  const pid = store.activeId
  const profile = store.profiles.find((p) => p.id === pid)
  const [files, setFiles] = useState<LocalFile[] | null>(null)
  const [open, setOpen] = useState(false)
  const [relink, setRelink] = useState<Record<string, string>>({})
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    void Promise.all([readAttachments('photos'), readAttachments('wallet')])
      .then(async ([photos, wallet]) => {
        const mine = (owner: string) => owner.split('|')[0] === pid
        const out: LocalFile[] = []
        for (const p of photos.filter((x) => mine(x.owner))) out.push({ uid: await attachmentUid(p), name: p.name ?? 'Photo', kind: 'photo', size: p.size ?? p.blob.size })
        for (const w of wallet.filter((x) => mine(x.owner))) out.push({ uid: await attachmentUid(w), name: w.name ?? 'Document', kind: 'wallet', size: w.size ?? w.blob.size })
        if (live) setFiles(out)
      })
      .catch(() => live && setFiles([]))
    return () => {
      live = false
    }
  }, [pid, tick])

  const now = Date.now()
  const meta = useMemo(() => loadMeta(pid), [pid, admin])
  const records = useMemo(() => {
    const rows: { at?: number }[] = Object.values(meta)
    for (const key of collections) for (const r of ((admin as unknown as Record<string, { at?: number }[]>)[key] ?? [])) rows.push(r)
    return rows
  }, [meta, admin])
  const adminCount = collections.reduce((n, key) => n + (((admin as unknown as Record<string, unknown[]>)[key] ?? []).length), 0)
  const history = backupHistory()
  const sync = syncSummary({ enabled: !!syncState, lastAt: syncState?.lastAt ?? null, failed: syncDetail.failed, busy: syncDetail.busy, records, now })
  const backup = backupSummaryState({ history, profileId: pid, records, now })
  const share = shareSummary(admin, now)
  const mentorsOn = !!settings.mentorSpaceId && !settings.mentorAccessPaused
  const rows: FileRow[] = files ? fileRows({ files, admin, history, now }) : []
  const missing = rows.filter((r) => !r.present)
  const walletFiles = (files ?? []).filter((f) => f.kind === 'wallet')

  const guide = () => {
    const text = buildRecoveryGuide({
      generatedAt: now,
      profiles: store.profiles.map((p) => ({ name: p.name, records: p.id === pid ? Object.keys(meta).length : Object.keys(loadMeta(p.id)).length, adminRecords: p.id === pid ? adminCount : 0, photos: p.id === pid ? (files ?? []).filter((f) => f.kind === 'photo').length : 0, documents: p.id === pid ? walletFiles.length : 0 })),
      sync: { enabled: !!syncState },
      backup: { lastAt: backup.lastAt, files: backup.files },
      mentors: { enabled: mentorsOn, packsShared: share.shared },
      appUrl: typeof window !== 'undefined' ? window.location.origin + window.location.pathname : undefined,
    })
    downloadFile('my-timetable-recovery-guide.txt', text, 'text/plain;charset=utf-8')
  }

  const cards = [
    {
      id: 'device',
      title: 'On this device',
      tone: 'ready',
      state: `${Object.keys(meta).length} session record${Object.keys(meta).length === 1 ? '' : 's'} · ${adminCount} PGCE record${adminCount === 1 ? '' : 's'} · ${files === null ? '…' : `${files.length} file${files.length === 1 ? '' : 's'}`}`,
      detail: 'Stored in this browser only. Clearing site data removes it unless a backup or your other devices have it.',
    },
    {
      id: 'synced',
      title: 'Synced to my devices',
      tone: sync.state === 'confirmed' ? 'ready' : sync.state === 'off' ? '' : 'amber',
      state: sync.state === 'off' ? 'Off — this device only' : sync.state === 'failed' ? `Last attempt failed${sync.lastAt ? ` · last confirmed ${fmtAt(sync.lastAt)}` : ''}` : sync.state === 'working' ? 'Working…' : sync.state === 'never' ? 'On, but nothing confirmed yet' : sync.state === 'pending' ? `${sync.pending} record${sync.pending === 1 ? '' : 's'} edited since the last confirmed sync (${fmtAt(sync.lastAt!)})` : `Confirmed ${fmtAt(sync.lastAt!)}`,
      detail: sync.state === 'off' ? 'Turn it on below to copy records, encrypted, to your other devices.' : `Records only — photos and documents never sync.${online ? '' : ' Offline: nothing can be confirmed until the connection returns.'}`,
    },
    {
      id: 'backup',
      title: 'Backed up',
      tone: backup.state === 'covered' ? 'ready' : 'amber',
      state: backup.state === 'never' ? 'No backup generated on this device' : `${backup.state === 'covered' ? 'Generated' : 'Generated'} ${fmtAt(backup.lastAt!)} — ${backup.files === null ? 'files unknown (older record)' : backup.files === 0 ? 'records only, no files' : `records and ${backup.files} file${backup.files === 1 ? '' : 's'}`}${backup.editsSince > 0 ? ` · ${backup.editsSince} record${backup.editsSince === 1 ? '' : 's'} edited since` : ''}`,
      detail: 'A generation is recorded here; only you can confirm the file was kept where you saved it.',
    },
    {
      id: 'shared',
      title: 'Shared with mentors',
      tone: share.expired > 0 ? 'amber' : share.shared > 0 ? 'ready' : '',
      state: !mentorsOn && share.shared === 0 ? 'Nothing shared' : `${share.shared} pack${share.shared === 1 ? '' : 's'} shared${share.lastAt ? ` · last confirmed ${fmtAt(share.lastAt)}` : ''}${share.expired > 0 ? ` · ${share.expired} with portal copies expired` : ''}`,
      detail: share.shared > 0 ? 'From the mentor service’s acknowledgements. Portal copies of attachments are served for 60 days from each share.' : mentorsOn ? 'Mentor access is on; no pack has been shared yet.' : 'Mentor access is off.',
    },
  ]

  return (
    <section className="filter-section" id="data-centre">
      <div className="section-head">
        <span className="ui-tile ui-tile--teal" aria-hidden="true">
          <IconShield />
        </span>
        <h3 tabIndex={-1}>Data &amp; sharing centre</h3>
      </div>
      <ul className="data-cards" aria-label="Data and sharing status">
        {cards.map((c) => (
          <li key={c.id} className={`data-card data-card--${c.tone || 'plain'}`} data-state={c.tone || 'plain'}>
            <span className="data-card-title">{c.title}</span>
            <span className={`data-card-state data-card-state--${c.tone || 'plain'}`}>{c.state}</span>
            <span className="filter-hint">{c.detail}</span>
          </li>
        ))}
      </ul>
      <div className="btn-row">
        <button type="button" className="btn-today-reset" aria-expanded={open} aria-controls="data-centre-details" onClick={() => setOpen((o) => !o)}>{open ? 'Hide details' : 'Review details'}</button>
        <a className="btn-today-reset" href="#backup">Review backup</a>
        <a className="btn-today-reset" href="#/pgce/packs">Manage sharing</a>
        <button type="button" className="btn-today-reset" onClick={guide}>Download recovery guide</button>
      </div>
      {open && (
        <div id="data-centre-details" className="data-centre-details">
          <p className="filter-hint">{profile?.name ?? 'This timetable'}: {Object.keys(meta).length} session records and {adminCount} PGCE records on this device{sync.state === 'off' ? '' : ` · ${sync.pending} not yet confirmed by sync`}{backup.lastAt ? ` · ${backup.editsSince} edited since the last generated backup` : ' · no generated backup'}.</p>
          {files === null ? (
            <p className="filter-hint">Reading files on this device…</p>
          ) : rows.length === 0 ? (
            <p className="filter-hint">No photos or documents on this device, and no record refers to one.</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table" aria-label="Files and records">
                <thead>
                  <tr><th scope="col">File</th><th scope="col">Where</th><th scope="col">In a backup?</th><th scope="col">Shared</th><th scope="col">Portal copy</th></tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.uid} data-state={r.present ? 'present' : 'missing'}>
                      <td>
                        {r.name}
                        {r.refs.length ? <span className="filter-hint"> · used by {r.refs.map((x) => `${REF_LABEL[x.kind]} “${x.title}”`).join(', ')}</span> : null}
                      </td>
                      <td>{r.present ? (r.kind === 'photo' ? 'this device (photo)' : 'this device (document)') : <span className="tag tag--amber">missing on this device</span>}</td>
                      <td>{r.backedUp ? `yes — generated ${fmtDay(r.backedUp.at)}` : 'no generated backup contains it'}</td>
                      <td>{r.shares.length ? r.shares.map((s) => `“${s.title}” v${s.revision}`).join(', ') : 'not shared'}</td>
                      <td>{r.shares.length ? r.shares.map((s) => (s.expired ? `expired ${fmtDay(s.expiresAt)}` : `until ${fmtDay(s.expiresAt)}`)).join(', ') : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {missing.length > 0 && (
            <ul className="workspace-list" aria-label="Missing files">
              {missing.map((r) => (
                <li key={r.uid} className="workspace-row requirement-row">
                  <span><span className="tag tag--amber">Missing</span> {r.name} <span className="filter-hint">· {r.refs.map((x) => `${REF_LABEL[x.kind]} “${x.title}”`).join(', ')}</span></span>
                  {walletFiles.length ? (
                    <span className="requirement-confirm">
                      <select className="date-input" aria-label={`Relink: ${r.name}`} value={relink[r.uid] ?? ''} onChange={(e) => setRelink({ ...relink, [r.uid]: e.target.value })}>
                        <option value="">Choose the original file…</option>
                        {walletFiles.map((w) => (
                          <option key={w.uid} value={w.uid}>{w.name}</option>
                        ))}
                      </select>
                      <button type="button" className="travel-link" disabled={!relink[r.uid]} onClick={() => { onUpdateAdmin((prev) => relinkUid(prev, r.uid, relink[r.uid], Date.now())); setRelink({ ...relink, [r.uid]: '' }); setTick((t) => t + 1) }}>Relink</button>
                    </span>
                  ) : (
                    <span className="filter-hint">Restore a backup that has it, or add it to your wallet and relink.</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {share.packs.length > 0 && (
            <ul className="workspace-list" aria-label="Shared packs">
              {share.packs.map((p) => (
                <li key={p.id} className="workspace-row"><span><strong>{p.title}</strong> <span className="filter-hint">· v{p.revision} · {p.mentors} mentor{p.mentors === 1 ? '' : 's'} · {p.files} file{p.files === 1 ? '' : 's'} · confirmed {fmtAt(p.sharedAt)}</span></span><span className={`tag${p.expired && p.files ? ' tag--amber' : ''}`}>{p.files ? (p.expired ? `portal copies expired ${fmtDay(p.expiresAt)}` : `portal copies until ${fmtDay(p.expiresAt)}`) : 'text only'}</span></li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

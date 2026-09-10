import { useEffect, useState } from 'react'
import type { AdminFile } from '../lib/admin'
import { readAttachments } from '../lib/attachments'
import { sessionKey } from '../lib/diff'
import { printBinder } from '../lib/printBinder'
import type { BinderSection } from '../lib/printBinder'
import { telemetryTrack } from '../lib/telemetry'
import { trackUse } from '../lib/usage'
import type { MetaMap, Session } from '../types'
import { Dialog, Field, IconClose, IconPrint } from './ui'

export const BINDER_SECTIONS: { id: BinderSection; label: string }[] = [
  { id: 'attendance', label: 'Attendance & placement days' },
  { id: 'evidence', label: 'Evidence by Teachers’ Standard' },
  { id: 'targets', label: 'Targets' },
  { id: 'meetings', label: 'Mentor meetings' },
  { id: 'observations', label: 'Observations' },
  { id: 'lessons', label: 'Lessons taught' },
  { id: 'audits', label: 'Subject-knowledge audits' },
]

interface Props {
  profileId: string
  profileName: string
  sessions: Session[]
  metaMap: MetaMap
  admin: AdminFile
  placementTargetDays?: number
  todayISO: string
  /** evidence keys chosen in the journal (R5a / NF-08); the binder then prints exactly these */
  selection?: string[]
  onClose: () => void
}

/**
 * Binder preview (P5-04; R5a / NF-08 selections): date range, section
 * choice with live counts, optional field controls and honest file
 * availability BEFORE anything prints. The preview states exactly what the
 * output will contain: selected records, photos embedded from this device,
 * photos recorded elsewhere (labelled missing in the output, never dropped)
 * and "no photos" as a distinct state. Wallet documents and home/location
 * details are never part of the binder. Generating never mutates a record.
 */
export function BinderPreviewSheet({ profileId, profileName, sessions, metaMap, admin, placementTargetDays, todayISO, selection, onClose }: Props) {
  const [fromISO, setFromISO] = useState('')
  const [toISO, setToISO] = useState('')
  const [sections, setSections] = useState<BinderSection[]>(selection ? ['evidence'] : BINDER_SECTIONS.map((s) => s.id))
  const [includeCaptions, setIncludeCaptions] = useState(true)
  const [includeObserverNames, setIncludeObserverNames] = useState(true)
  const [localByKey, setLocalByKey] = useState<Map<string, number> | null>(null)
  const [printing, setPrinting] = useState(false)
  useEffect(() => {
    let live = true
    void readAttachments('photos')
      .then((all) => {
        if (!live) return
        const map = new Map<string, number>()
        for (const p of all) {
          if (!p.owner.startsWith(profileId + '|')) continue
          const key = p.owner.slice(profileId.length + 1)
          map.set(key, (map.get(key) ?? 0) + 1)
        }
        setLocalByKey(map)
      })
      .catch(() => live && setLocalByKey(null))
    return () => {
      live = false
    }
  }, [profileId])

  const inRange = (d: string) => (!fromISO || d >= fromISO) && (!toISO || d <= toISO)
  const selected = selection ? new Set(selection) : null
  const seenSessions = new Set<string>()
  const evidenceKeys: { key: string; date: string; photos: number }[] = []
  for (const s of sessions) {
    const key = sessionKey(s)
    if (seenSessions.has(key)) continue
    const m = metaMap[key]
    if (!m || m.deleted || (!m.note && !(m.photos ?? 0) && !(m.standards ?? []).length)) continue
    seenSessions.add(key)
    evidenceKeys.push({ key, date: s.dateISO, photos: m.photos ?? 0 })
  }
  for (const [key, m] of Object.entries(metaMap)) {
    if (seenSessions.has(key) || m.deleted || (!m.note && !m.photos)) continue
    const date = key.split('|')[0]
    evidenceKeys.push({ key, date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '1970-01-01', photos: m.photos ?? 0 })
  }
  for (const r of admin.reflections) evidenceKeys.push({ key: `refl-${r.id}`, date: r.weekISO, photos: 0 })
  for (const l of admin.lessons) if (l.evaluation || l.standards.length > 0) evidenceKeys.push({ key: `les-${l.id}`, date: l.dateISO, photos: 0 })
  const evidenceIncluded = evidenceKeys.filter((e) => (selected ? selected.has(e.key) : inRange(e.date)))
  const recordedPhotos = evidenceIncluded.reduce((n, e) => n + e.photos, 0)
  const availablePhotos = localByKey ? evidenceIncluded.reduce((n, e) => n + Math.min(e.photos, localByKey.get(e.key) ?? 0), 0) : null
  const missingPhotos = availablePhotos === null ? null : recordedPhotos - availablePhotos

  const counts: Record<BinderSection, number> = {
    attendance: sessions.filter((s) => inRange(s.dateISO)).length,
    evidence: evidenceIncluded.length,
    targets: admin.targets.filter((t) => inRange(t.setISO)).length,
    meetings: admin.meetings.filter((m) => inRange(m.dateISO)).length,
    observations: admin.observations.filter((o) => inRange(o.dateISO)).length,
    lessons: admin.lessons.filter((l) => inRange(l.dateISO)).length,
    audits: admin.audits.filter((a) => inRange(a.dateISO)).length,
  }

  return (
    <Dialog label="Binder preview" onClose={onClose}>
      <div className="sheet-header">
        <h2>Binder preview</h2>
        <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
          <IconClose />
        </button>
      </div>
      {selection ? (
        <p className="filter-hint">
          From your selection: {selection.length} record{selection.length === 1 ? '' : 's'} chosen in the journal. Only those
          evidence records print; other sections stay optional below.
        </p>
      ) : (
        <div className="task-edit-row">
          <Field label="From">
            <input type="date" className="date-input" value={fromISO} onChange={(e) => setFromISO(e.target.value)} />
          </Field>
          <Field label="To">
            <input type="date" className="date-input" value={toISO} onChange={(e) => setToISO(e.target.value)} />
          </Field>
        </div>
      )}
      {BINDER_SECTIONS.map((s) => (
        <label className="toggle-row" key={s.id}>
          <input
            type="checkbox"
            checked={sections.includes(s.id)}
            onChange={(e) => setSections((prev) => (e.target.checked ? [...prev, s.id] : prev.filter((x) => x !== s.id)))}
          />
          {s.label} ({counts[s.id]})
        </label>
      ))}
      <h3 className="subheading">What the output will contain</h3>
      <ul className="notif-overview binder-contents" aria-label="Binder contents">
        <li>
          <span>Evidence records</span>
          <span className="notif-state">{evidenceIncluded.length}</span>
        </li>
        <li>
          <span>Photos embedded from this device</span>
          <span className="notif-state">{availablePhotos === null ? 'checking…' : recordedPhotos === 0 ? 'no photos in these records' : availablePhotos}</span>
        </li>
        <li>
          <span>Photos recorded elsewhere</span>
          <span className={`notif-state${missingPhotos ? ' warn' : ''}`}>
            {missingPhotos === null ? 'checking…' : missingPhotos > 0 ? `${missingPhotos} unavailable on this device — labelled as missing in the output` : 'none'}
          </span>
        </li>
      </ul>
      <label className="toggle-row">
        <input type="checkbox" checked={includeCaptions} onChange={(e) => setIncludeCaptions(e.target.checked)} />
        Include photo captions
      </label>
      <label className="toggle-row">
        <input type="checkbox" checked={includeObserverNames} onChange={(e) => setIncludeObserverNames(e.target.checked)} />
        Include observer names on observation records
      </label>
      <p className="filter-hint">
        Wallet documents and home/location details are never part of the binder. Generating it changes nothing in your
        records, and clearing a selection never deletes evidence.
      </p>
      <div className="modal-actions">
        <button
          type="button"
          className="btn-primary"
          disabled={printing || sections.length === 0}
          onClick={() => {
            setPrinting(true)
            trackUse('binder')
            void printBinder({
              profileId,
              profileName,
              sessions,
              metaMap,
              admin,
              placementTargetDays,
              todayISO,
              options: { fromISO: fromISO || undefined, toISO: toISO || undefined, sections, selection, includeCaptions, includeObserverNames },
            })
              // A4: "prepared" fires only after the artifact was generated —
              // it never claims a print completed or a file was saved.
              .then(() => telemetryTrack('export_prepared'))
              .catch(() => {})
              .finally(() => setPrinting(false))
          }}
        >
          {printing ? 'Preparing…' : <><IconPrint /> Print / save as PDF</>}
        </button>
        <button type="button" className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  )
}

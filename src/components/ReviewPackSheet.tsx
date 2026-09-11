import { useEffect, useState } from 'react'
import { Dialog, Field, FieldGroup, IconClose } from './ui'
import { buildReviewPackText, pinRecord, pinStale } from '../../shared/evidence.js'
import { newAdminId } from '../lib/admin'
import type { AdminFile, ReviewPackItem, ReviewPackRec } from '../lib/admin'
import { downloadFile } from '../lib/files'
import { getWalletFiles } from '../lib/wallet'

interface Props {
  admin: AdminFile
  profileId: string
  todayISO: string
  onUpdateAdmin: (updater: (prev: AdminFile) => AdminFile) => void
  onClose: () => void
}

const fmt = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/**
 * Review packs (PG-09, G3). A pack pins the canonical JSON of each selected
 * record at selection time, so it stays readable after the source changes
 * (and says when it has). Attachments are listed by name with their state —
 * on this device only, or missing — never copied into synced data. The
 * preview and the exported file come from the same function, so what leaves
 * the device is exactly what was shown. Selected → Draft → Discussed is the
 * learner's own marking.
 */
export function ReviewPackSheet({ admin, profileId, todayISO, onUpdateAdmin, onClose }: Props) {
  const [title, setTitle] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(admin.reviewPacks[0]?.id ?? null)
  const [picked, setPicked] = useState<string[]>([])
  const [wallet, setWallet] = useState<{ id: string; name: string }[]>([])
  const [discussedISO, setDiscussedISO] = useState(todayISO)
  useEffect(() => {
    let live = true
    void getWalletFiles(profileId).then((files) => live && setWallet(files.map((f) => ({ id: String((f as { id?: number }).id ?? ''), name: f.name })))).catch(() => live && setWallet([]))
    return () => { live = false }
  }, [profileId])
  const pack = admin.reviewPacks.find((p) => p.id === selectedId) ?? null
  const attachmentState = (id: string): 'local-only' | 'missing' => (wallet.some((w) => w.id === id) ? 'local-only' : 'missing')
  const setPack = (id: string, patch: Partial<ReviewPackRec>) => onUpdateAdmin((prev) => ({ ...prev, reviewPacks: prev.reviewPacks.map((p) => (p.id === id ? { ...p, ...patch, at: Date.now() } : p)) }))
  const live = (kind: ReviewPackItem['kind'], id: string) => {
    const map = { example: admin.examples, lesson: admin.lessons, observation: admin.observations, meeting: admin.meetings, reflection: admin.reflections } as Record<string, { id: string; at: number }[]>
    return map[kind].find((r) => r.id === id)
  }
  const candidates = [
    ...admin.examples.map((e) => ({ kind: 'example' as const, id: e.id, label: `Example · ${e.title}` })),
    ...admin.lessons.map((l) => ({ kind: 'lesson' as const, id: l.id, label: `Lesson · ${fmt(l.dateISO)} · ${l.subject || 'Lesson'}` })),
    ...admin.observations.map((o) => ({ kind: 'observation' as const, id: o.id, label: `Feedback · ${fmt(o.dateISO)} · ${o.observer || 'Observation'}` })),
    ...admin.meetings.map((m) => ({ kind: 'meeting' as const, id: m.id, label: `Mentor meeting · ${fmt(m.dateISO)}` })),
    ...admin.reflections.map((r) => ({ kind: 'reflection' as const, id: r.id, label: `Reflection · week of ${fmt(r.weekISO)}` })),
  ]
  // Attachment states are checked live against this device's wallet; the preview and the
  // export are built from the SAME object so they cannot differ.
  const packForText = pack ? { ...pack, attachments: (pack.attachments ?? []).map((a) => ({ ...a, state: attachmentState(a.id) })) } : null
  const text = packForText ? buildReviewPackText(packForText) : ''
  const pin = () => {
    if (!pack) return
    const items = [...pack.items]
    for (const key of picked) {
      const [kind, id] = key.split(':') as [ReviewPackItem['kind'], string]
      if (items.some((i) => i.kind === kind && i.id === id)) continue
      const rec = live(kind, id)
      if (rec) items.push(pinRecord(kind, rec) as ReviewPackItem)
    }
    setPack(pack.id, { items })
    setPicked([])
  }

  return (
    <Dialog label="Review packs" onClose={onClose} className="sheet-packs">
      <div className="sheet-header">
        <h2>Review packs</h2>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><IconClose /></button>
      </div>
      <Field label="New pack">
        <div className="task-edit-row">
          <input type="text" className="placement-input" aria-label="Pack title" placeholder="e.g. Progress review 1" value={title} onChange={(e) => setTitle(e.target.value)} />
          <button type="button" className="btn-primary" disabled={!title.trim()} onClick={() => { const rec: ReviewPackRec = { id: newAdminId(), title: title.trim(), state: 'selected', createdISO: todayISO, items: [], attachments: [], at: Date.now() }; onUpdateAdmin((prev) => ({ ...prev, reviewPacks: [...prev.reviewPacks, rec] })); setSelectedId(rec.id); setTitle('') }}>Create pack</button>
        </div>
      </Field>
      {admin.reviewPacks.length > 0 && (
        <ul className="workspace-list" aria-label="Packs">
          {admin.reviewPacks.map((p) => (
            <li key={p.id}><button type="button" className="workspace-row" aria-current={p.id === selectedId ? 'true' : undefined} onClick={() => setSelectedId(p.id)}><span>{p.title} <span className="filter-hint">· {p.items.length} item{p.items.length === 1 ? '' : 's'}</span></span><span className="tag">{p.state === 'selected' ? 'Selected' : p.state === 'draft' ? 'Draft' : 'Discussed'}</span></button></li>
          ))}
        </ul>
      )}
      {pack && (
        <section className="prep-editor" aria-label={`Pack: ${pack.title}`}>
          <h3 className="subheading">{pack.title}</h3>
          <FieldGroup label="Add records (pinned as they are now)">
            <ul className="setup-list" aria-label="Pack candidates">
              {candidates.filter((c) => !pack.items.some((i) => i.kind === c.kind && i.id === c.id)).map((c) => (
                <li key={`${c.kind}:${c.id}`} className="setup-row"><label className="toggle-row"><input type="checkbox" checked={picked.includes(`${c.kind}:${c.id}`)} onChange={(e) => setPicked(e.target.checked ? [...picked, `${c.kind}:${c.id}`] : picked.filter((x) => x !== `${c.kind}:${c.id}`))} /><span>{c.label}</span></label></li>
              ))}
            </ul>
            <div className="btn-row"><button type="button" className="btn-today-reset" disabled={picked.length === 0} onClick={pin}>Pin selection ({picked.length})</button></div>
          </FieldGroup>
          {pack.items.length > 0 && (
            <ul className="workspace-list" aria-label="Pinned items">
              {pack.items.map((item) => {
                const cur = live(item.kind, item.id)
                return (
                  <li key={`${item.kind}:${item.id}`} className="workspace-row requirement-row">
                    <span>
                      <span className="tag">{item.kind}</span> {candidates.find((c) => c.kind === item.kind && c.id === item.id)?.label ?? `${item.kind} (source removed — pinned copy kept)`}
                      {item.provenance && <span className="filter-hint"> · {item.provenance}</span>}
                      {cur && pinStale(item, cur) && <span className="filter-hint"> · source changed since pinned — the pack keeps the pinned version</span>}
                    </span>
                    <span className="requirement-confirm">
                      <input type="text" className="placement-input" aria-label={`Caption: ${item.kind} ${item.id}`} placeholder="Caption" value={item.caption ?? ''} onChange={(e) => setPack(pack.id, { items: pack.items.map((i) => (i === item ? { ...i, caption: e.target.value || undefined } : i)) })} />
                      <button type="button" className="travel-link" onClick={() => setPack(pack.id, { items: pack.items.filter((i) => i !== item) })}>Unpin</button>
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
          <FieldGroup label="Attachments from your wallet (listed by name; files never leave this device with the pack)">
            {wallet.length === 0 && (pack.attachments ?? []).length === 0 ? <p className="filter-hint">No wallet files on this device.</p> : (
              <ul className="setup-list" aria-label="Attachments">
                {[...wallet.filter((w) => !(pack.attachments ?? []).some((a) => a.id === w.id)).map((w) => ({ ...w, chosen: false, state: 'local-only' as const })), ...(pack.attachments ?? []).map((a) => ({ id: a.id, name: a.name, chosen: true, state: attachmentState(a.id) }))].map((a) => (
                  <li key={a.id} className="setup-row">
                    <label className="toggle-row"><input type="checkbox" checked={a.chosen} onChange={(e) => setPack(pack.id, { attachments: e.target.checked ? [...(pack.attachments ?? []), { id: a.id, name: a.name, state: 'local-only' }] : (pack.attachments ?? []).filter((x) => x.id !== a.id) })} /><span>{a.name} <span className={`tag${a.state === 'missing' ? ' tag--amber' : ''}`}>{a.state === 'missing' ? 'Missing on this device' : 'On this device only'}</span></span></label>
                  </li>
                ))}
              </ul>
            )}
          </FieldGroup>
          <Field label="Notes for the pack"><textarea className="placement-input" rows={2} aria-label="Pack notes" value={pack.notes ?? ''} onChange={(e) => setPack(pack.id, { notes: e.target.value || undefined })} /></Field>
          <div className="btn-row">
            {pack.state === 'selected' && <button type="button" className="btn-today-reset" onClick={() => setPack(pack.id, { state: 'draft' })}>Mark as draft</button>}
            {pack.state === 'draft' && (
              <>
                <input type="date" className="date-input" aria-label="Discussed on" value={discussedISO} onChange={(e) => setDiscussedISO(e.target.value)} />
                <button type="button" className="btn-today-reset" onClick={() => setPack(pack.id, { state: 'discussed', discussedISO })}>Mark as discussed</button>
              </>
            )}
            <button type="button" className="btn-today-reset" onClick={() => onUpdateAdmin((prev) => ({ ...prev, reviewPacks: prev.reviewPacks.filter((p) => p.id !== pack.id) }))}>Delete pack</button>
          </div>
          <h3 className="subheading">Exactly what leaves the device</h3>
          <pre className="plan-pre pack-preview-text" aria-label="Pack preview">{text}</pre>
          <div className="btn-row"><button type="button" className="btn-primary" onClick={() => downloadFile(`review-pack-${pack.title.replace(/[^\w-]+/g, '-').toLowerCase()}.txt`, text, 'text/plain')}>Export this text</button></div>
        </section>
      )}
    </Dialog>
  )
}

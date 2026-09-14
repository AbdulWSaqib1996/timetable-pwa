import { useEffect, useMemo, useState } from 'react'
import { Dialog, Field, FieldGroup, IconClose, SegmentedControl, StatusMessage } from './ui'
import { buildReviewPackText, pinRecord, pinStale } from '../../shared/evidence.js'
import { newAdminId, placementLabel } from '../lib/admin'
import type { AdminFile, ReviewPackItem, ReviewPackRec } from '../lib/admin'
import { downloadFile } from '../lib/files'
import { getWalletFiles } from '../lib/wallet'
import { attachmentUid } from '../lib/attachments'
import { StaleShareError, absorbInbox, fetchInbox, fileToBytes, listMentors, packTextHash, sharePack, unsharePack } from '../lib/mentor'
import type { MentorListing, MentorSpace } from '../lib/mentor'
import type { Settings } from '../types'

interface Props {
  admin: AdminFile
  profileId: string
  todayISO: string
  settings: Settings
  onUpdateSettings: (patch: Partial<Settings>) => void
  onUpdateAdmin: (updater: (prev: AdminFile) => AdminFile) => void
  /** U05: `#/pgce/packs/<id>` opens straight on one pack */
  initialPackId?: string
  onClose: () => void
}

/** A wallet file with its stable identity resolved. */
interface WalletEntry { uid: string; localId: string; name: string; size: number; blob: Blob }
type PackAttachment = NonNullable<ReviewPackRec['attachments']>[number]

/** Everything transient about ONE pack's editing (audit B01): never shared between packs. */
interface Draft { picked: string[]; shareWith: string[]; shareAtt: string[]; msg: string | null; failed: boolean; step: Step }
type Step = 'content' | 'people' | 'check'
const emptyDraft = (): Draft => ({ picked: [], shareWith: [], shareAtt: [], msg: null, failed: false, step: 'content' })

/** The immutable command built when the learner asks to review a share (audit B01). */
interface ShareCommand { packId: string; packAt: number; revision: number; text: string; textHash: string; recipients: string[]; files: { uid: string; name: string; size: number; blob: Blob }[] }
/** B06: loading, ready and error are three different things — never "no files" for a blocked store. */
type WalletState = { status: 'loading' } | { status: 'ready'; entries: WalletEntry[] } | { status: 'error'; message: string }
type MentorsState = { status: 'idle' } | { status: 'loading' } | { status: 'ready'; listing: MentorListing } | { status: 'error'; message: string }

const fmt = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
const STEPS: { value: Step; label: string }[] = [
  { value: 'content', label: 'Content' },
  { value: 'people', label: 'People' },
  { value: 'check', label: 'Check & share' },
]
const KIND_LABEL: Record<ReviewPackItem['kind'], string> = { example: 'Example', lesson: 'Lesson', observation: 'Feedback', meeting: 'Mentor meeting', reflection: 'Reflection' }

/**
 * Review packs (PG-09, G3; sharing reworked in Pass 77 for audit B01–B03;
 * staged editor in Pass 79 for audit U02). Packs on the left, one pack on the
 * right (a split view from 768px; on phones the list is a strip above the
 * full-width detail), edited in three steps — Content → People → Check &
 * share. Content searches the candidate records by placement, date and type
 * and pins them as they are now; the preview and the export are ONE text.
 * People chooses recipients and the current pack's resolvable files only.
 * Check & share shows exactly what changes against the prior share before
 * "Share this version". The learner's state (Selected/Draft/Discussed) and the
 * sharing state (Never shared / Shared v N / Changes not shared / Failed) sit
 * beside each other and never stand in for one another.
 */
export function ReviewPackSheet({ admin, profileId, todayISO, settings, onUpdateSettings, onUpdateAdmin, initialPackId, onClose }: Props) {
  const [title, setTitle] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>((initialPackId && admin.reviewPacks.some((p) => p.id === initialPackId) ? initialPackId : null) ?? admin.reviewPacks[0]?.id ?? null)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [walletState, setWalletState] = useState<WalletState>({ status: 'loading' })
  const [discussedISO, setDiscussedISO] = useState(todayISO)
  const [discussedError, setDiscussedError] = useState<string | null>(null)
  const [relink, setRelink] = useState<Record<string, string>>({})
  const [command, setCommand] = useState<ShareCommand | null>(null)
  const [busy, setBusy] = useState(false)
  const space: MentorSpace | null = settings.mentorSpaceId && settings.mentorOwnerToken ? { spaceId: settings.mentorSpaceId, ownerToken: settings.mentorOwnerToken } : null
  const paused = !!space && !!settings.mentorAccessPaused
  const [mentorsState, setMentorsState] = useState<MentorsState>({ status: 'idle' })
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [confirmUnshare, setConfirmUnshare] = useState<string | null>(null)
  const [undo, setUndo] = useState<ReviewPackRec | null>(null)
  const [walletTick, setWalletTick] = useState(0)
  const [mentorsTick, setMentorsTick] = useState(0)
  // U02: candidate search — text, type, placement, from-date.
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState<'all' | ReviewPackItem['kind']>('all')
  const [placementFilter, setPlacementFilter] = useState('all')
  const [fromISO, setFromISO] = useState('')

  useEffect(() => {
    let live = true
    setWalletState({ status: 'loading' })
    void getWalletFiles(profileId)
      .then(async (files) => {
        const out: WalletEntry[] = []
        for (const f of files) {
          const rec = f as { id?: number; uid?: string; blob: Blob }
          out.push({ uid: rec.uid ?? (await attachmentUid({ ...f, uid: undefined })), localId: String(rec.id ?? ''), name: f.name, size: f.size, blob: rec.blob })
        }
        if (live) setWalletState({ status: 'ready', entries: out })
      })
      .catch((e) => live && setWalletState({ status: 'error', message: `Could not read your wallet on this device${e instanceof Error && e.message ? ` (${e.message})` : ''} — storage may be blocked in this browser mode.` }))
    return () => {
      live = false
    }
  }, [profileId, walletTick])
  useEffect(() => {
    let live = true
    if (!space || paused) {
      setMentorsState({ status: 'idle' })
      return
    }
    setMentorsState({ status: 'loading' })
    void listMentors(settings, space)
      .then((listing) => live && setMentorsState({ status: 'ready', listing }))
      .catch((e) => live && setMentorsState({ status: 'error', message: e instanceof Error ? e.message : 'Could not load your mentors.' }))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.mentorSpaceId, settings.pushServerBase, paused, mentorsTick])
  const wallet = walletState.status === 'ready' ? walletState.entries : null
  const mentors = mentorsState.status === 'ready' ? mentorsState.listing : null

  const pack = admin.reviewPacks.find((p) => p.id === selectedId) ?? null
  const draft: Draft = (pack && drafts[pack.id]) || emptyDraft()
  const setDraft = (patch: Partial<Draft>) => pack && setDrafts((d) => ({ ...d, [pack.id]: { ...(d[pack.id] ?? emptyDraft()), ...patch } }))
  const step: Step = draft.step
  const setStep = (s: Step) => setDraft({ step: s })
  const selectPack = (id: string) => {
    // B01: a context switch shows that pack's own draft (or none) — nothing carries over.
    setSelectedId(id)
    setCommand(null)
    setDiscussedError(null)
  }
  const setPack = (id: string, patch: Partial<ReviewPackRec>) => onUpdateAdmin((prev) => ({ ...prev, reviewPacks: prev.reviewPacks.map((p) => (p.id === id ? { ...p, ...patch, at: Date.now() } : p)) }))
  const live = (kind: ReviewPackItem['kind'], id: string) => {
    const map = { example: admin.examples, lesson: admin.lessons, observation: admin.observations, meeting: admin.meetings, reflection: admin.reflections } as Record<string, { id: string; at: number }[]>
    return map[kind].find((r) => r.id === id)
  }
  const placements = admin.placements ?? []
  const pLabel = (id?: string) => (id ? placements.find((p) => p.id === id) : undefined)
  const candidates = useMemo(
    () => [
      ...admin.examples.map((e) => ({ kind: 'example' as const, id: e.id, label: `Example · ${e.title}`, dateISO: '', placementId: undefined as string | undefined, text: e.title })),
      ...admin.lessons.map((l) => ({ kind: 'lesson' as const, id: l.id, label: `Lesson · ${fmt(l.dateISO)} · ${l.subject || 'Lesson'}`, dateISO: l.dateISO, placementId: l.placementId, text: `${l.subject} ${l.classGroup} ${l.evaluation}` })),
      ...admin.observations.map((o) => ({ kind: 'observation' as const, id: o.id, label: `Feedback · ${fmt(o.dateISO)} · ${o.observer || 'Observation'}`, dateISO: o.dateISO, placementId: o.placementId, text: `${o.observer} ${o.subject} ${o.focus} ${o.development}` })),
      ...admin.meetings.map((m) => ({ kind: 'meeting' as const, id: m.id, label: `Mentor meeting · ${fmt(m.dateISO)}`, dateISO: m.dateISO, placementId: m.placementId, text: m.discussed })),
      ...admin.reflections.map((r) => ({ kind: 'reflection' as const, id: r.id, label: `Reflection · week of ${fmt(r.weekISO)}`, dateISO: r.weekISO, placementId: undefined as string | undefined, text: `${r.wentWell} ${r.challenges} ${r.focus}` })),
    ],
    [admin.examples, admin.lessons, admin.observations, admin.meetings, admin.reflections]
  )
  const q = search.trim().toLowerCase()
  const unpinned = pack ? candidates.filter((c) => !pack.items.some((i) => i.kind === c.kind && i.id === c.id)) : []
  const matching = unpinned.filter((c) => {
    if (kindFilter !== 'all' && c.kind !== kindFilter) return false
    if (placementFilter === 'unassigned' ? !!c.placementId : placementFilter !== 'all' && c.placementId !== placementFilter) return false
    if (fromISO && c.dateISO && c.dateISO < fromISO) return false
    if (q && !`${c.label} ${c.text}`.toLowerCase().includes(q)) return false
    return true
  })
  const candidateLabel = (kind: ReviewPackItem['kind'], id: string) => candidates.find((c) => c.kind === kind && c.id === id)?.label

  /** B03: resolve a pack attachment by stable identity only. */
  const resolveAttachment = (a: PackAttachment): WalletEntry | null => (a.uid && wallet ? wallet.find((w) => w.uid === a.uid) ?? null : null)
  const attachmentState = (a: PackAttachment): 'local-only' | 'missing' | 'unresolved' => (!a.uid ? 'unresolved' : resolveAttachment(a) ? 'local-only' : 'missing')
  const packForText = pack ? { ...pack, attachments: (pack.attachments ?? []).map((a) => ({ ...a, state: attachmentState(a) === 'local-only' ? ('local-only' as const) : ('missing' as const) })) } : null
  const text = packForText ? buildReviewPackText(packForText) : ''
  const [textHash, setTextHash] = useState<string | null>(null)
  useEffect(() => {
    let liveHash = true
    void packTextHash(text).then((h) => liveHash && setTextHash(h))
    return () => {
      liveHash = false
    }
  }, [text])

  const pin = () => {
    if (!pack) return
    const items = [...pack.items]
    for (const key of draft.picked) {
      const [kind, id] = key.split(':') as [ReviewPackItem['kind'], string]
      if (items.some((i) => i.kind === kind && i.id === id)) continue
      const rec = live(kind, id)
      if (rec) items.push(pinRecord(kind, rec) as ReviewPackItem)
    }
    setPack(pack.id, { items })
    setDraft({ picked: [] })
  }

  const activeMentors = mentors?.mentors.filter((m) => !m.revokedAt) ?? []
  const shareableFiles = pack ? (pack.attachments ?? []).filter((a) => attachmentState(a) === 'local-only') : []

  /** U02: sharing state, separate from the learner's own state. */
  const sharingState = (p: ReviewPackRec, d: Draft | undefined): { label: string; tone: string } => {
    if (d?.failed) return { label: 'Failed — not shared', tone: 'tag--amber' }
    if (!p.sharing) return { label: 'Never shared', tone: '' }
    if (p.sharing.mentorIds.length === 0) return { label: 'Not shared', tone: '' }
    const currentHash = p.id === pack?.id ? textHash : null
    const filesNow = (p.attachments ?? []).filter((a) => a.uid && attachmentState(a) === 'local-only').map((a) => a.uid).sort().join(',')
    const filesShared = [...p.sharing.attachmentUids].sort().join(',')
    if ((currentHash && currentHash !== p.sharing.textHash) || (p.id === pack?.id && filesNow !== filesShared && filesShared !== '')) return { label: `Changes not shared (v${p.sharing.revision} sent)`, tone: 'tag--amber' }
    return { label: `Shared v${p.sharing.revision}`, tone: 'tag--teal' }
  }

  const reviewShare = async () => {
    if (!pack) return
    const files = []
    for (const a of pack.attachments ?? []) {
      if (!a.uid || !draft.shareAtt.includes(a.uid)) continue
      const w = resolveAttachment(a)
      if (w) files.push({ uid: w.uid, name: w.name, size: w.size, blob: w.blob })
    }
    const recipients = draft.shareWith.filter((id) => activeMentors.some((m) => m.id === id))
    setCommand({ packId: pack.id, packAt: pack.at, revision: (pack.sharing?.revision ?? 0) + 1, text, textHash: await packTextHash(text), recipients, files })
    setDraft({ step: 'check', msg: null })
  }
  const send = async () => {
    if (!pack || !command || !space) return
    if (command.packId !== pack.id || command.packAt !== pack.at) {
      setDraft({ msg: 'The pack changed since you reviewed this share — review it again.' })
      setCommand(null)
      return
    }
    setBusy(true)
    setDraft({ msg: null })
    try {
      const bytes = []
      for (const f of command.files) bytes.push({ uid: f.uid, name: f.name, bytes: await fileToBytes(f.blob) })
      const res = await sharePack(settings, space, { id: pack.id, title: pack.title, text: command.text }, command.recipients, bytes, command.revision)
      setPack(pack.id, { sharing: { revision: res.revision, sharedAt: res.sharedAt, mentorIds: command.recipients, attachmentUids: command.files.map((f) => f.uid), textHash: command.textHash } })
      setDraft({ msg: `Shared version ${res.revision} with ${command.recipients.length} mentor${command.recipients.length === 1 ? '' : 's'}${command.files.length ? ` and ${command.files.length} file${command.files.length === 1 ? '' : 's'}` : ''}. Copies already downloaded cannot be recalled.`, shareWith: [], shareAtt: [], failed: false })
      setCommand(null)
    } catch (e) {
      setDraft({ msg: e instanceof StaleShareError ? `${e.message} (server has version ${e.revision})` : e instanceof Error ? e.message : 'Could not share the pack.', failed: true })
      setCommand(null)
    } finally {
      setBusy(false)
    }
  }
  /** B10: take the pack away from every mentor; the local pack and its sharing history stay. */
  const unshare = async () => {
    if (!pack || !space) return
    setBusy(true)
    setDraft({ msg: null })
    try {
      const res = await unsharePack(settings, space, pack.id)
      const prev = pack.sharing
      setPack(pack.id, { sharing: { revision: Math.max(res.revision, prev?.revision ?? 0), sharedAt: prev?.sharedAt ?? Date.now(), mentorIds: [], attachmentUids: [], textHash: prev?.textHash ?? '', unsharedAt: res.unsharedAt ?? Date.now() } })
      setConfirmUnshare(null)
      setCommand(null)
      setDraft({ msg: 'Unshared. Mentors can no longer open this pack or its files in the portal. Copies they already downloaded are not recalled.' })
    } catch (e) {
      setDraft({ msg: e instanceof Error ? e.message : 'Could not unshare the pack.' })
    } finally {
      setBusy(false)
    }
  }
  const deletePack = (p: ReviewPackRec) => {
    setUndo(p)
    setConfirmDelete(null)
    setCommand(null)
    onUpdateAdmin((prev) => ({ ...prev, reviewPacks: prev.reviewPacks.filter((x) => x.id !== p.id) }))
    setSelectedId(admin.reviewPacks.find((x) => x.id !== p.id)?.id ?? null)
  }
  const checkInbox = async () => {
    if (!space) return
    setBusy(true)
    try {
      const items = await fetchInbox(settings, space, 0)
      const added = absorbInbox(admin, items, todayISO).added
      onUpdateAdmin((prev) => absorbInbox(prev, items, todayISO).file)
      onUpdateSettings({ mentorInboxAt: Date.now() })
      setDraft({ msg: added > 0 ? `${added} new feedback record${added === 1 ? '' : 's'} added (reviewer-authenticated).` : 'No new feedback.' })
    } catch (e) {
      setDraft({ msg: e instanceof Error ? e.message : 'Could not check for feedback.' })
    } finally {
      setBusy(false)
    }
  }
  const markDiscussed = () => {
    if (!pack) return
    if (!/^\d{4}-\d{2}-\d{2}$/.test(discussedISO) || Number.isNaN(new Date(discussedISO).getTime())) {
      setDiscussedError('Pick the date it was discussed before marking it discussed.')
      return
    }
    setDiscussedError(null)
    setPack(pack.id, { state: 'discussed', discussedISO })
  }

  const diff = pack && command ? (() => {
    const prev = pack.sharing
    const prevRec = new Set(prev?.mentorIds ?? [])
    const prevFiles = new Set(prev?.attachmentUids ?? [])
    const name = (id: string) => mentors?.mentors.find((m) => m.id === id)?.name ?? id
    return {
      first: !prev,
      textChanged: !prev || prev.textHash !== command.textHash,
      addedRecipients: command.recipients.filter((id) => !prevRec.has(id)).map(name),
      removedRecipients: [...prevRec].filter((id) => !command.recipients.includes(id)).map(name),
      addedFiles: command.files.filter((f) => !prevFiles.has(f.uid)).map((f) => f.name),
      removedFiles: [...prevFiles].filter((uid) => !command.files.some((f) => f.uid === uid)).map((uid) => (pack.attachments ?? []).find((a) => a.uid === uid)?.name ?? 'a file'),
    }
  })() : null

  const attachmentRows = pack && wallet
    ? [
        ...wallet.filter((w) => !(pack.attachments ?? []).some((a) => a.uid === w.uid)).map((w) => ({ key: `w:${w.uid}`, name: w.name, chosen: false, state: 'local-only' as const, uid: w.uid, size: w.size, ref: null as PackAttachment | null })),
        ...(pack.attachments ?? []).map((a) => ({ key: `a:${a.uid ?? a.id}`, name: a.name, chosen: true, state: attachmentState(a), uid: a.uid ?? '', size: a.size ?? 0, ref: a as PackAttachment | null })),
      ]
    : []
  const learnerState = (p: ReviewPackRec) => (p.state === 'selected' ? 'Selected' : p.state === 'draft' ? 'Draft' : 'Discussed')

  return (
    <Dialog label="Review packs" onClose={onClose} className="sheet-packs">
      <div className="sheet-header">
        <h2>Review packs</h2>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><IconClose /></button>
      </div>
      <div className="packs-layout">
        <aside className="packs-list" aria-label="Pack list">
          <Field label="New pack">
            <div className="task-edit-row">
              <input type="text" className="placement-input" aria-label="Pack title" placeholder="e.g. Progress review 1" value={title} onChange={(e) => setTitle(e.target.value)} />
              <button type="button" className="btn-primary" disabled={!title.trim()} onClick={() => { const rec: ReviewPackRec = { id: newAdminId(), title: title.trim(), state: 'selected', createdISO: todayISO, items: [], attachments: [], at: Date.now() }; onUpdateAdmin((prev) => ({ ...prev, reviewPacks: [...prev.reviewPacks, rec] })); selectPack(rec.id); setTitle('') }}>Create pack</button>
            </div>
          </Field>
          {admin.reviewPacks.length > 0 && (
            <ul className="workspace-list packs-list-items" aria-label="Packs">
              {admin.reviewPacks.map((p) => {
                const s = sharingState(p, drafts[p.id])
                return (
                  <li key={p.id}>
                    <button type="button" className="workspace-row" aria-current={p.id === selectedId ? 'true' : undefined} onClick={() => selectPack(p.id)}>
                      <span>{p.title} <span className="filter-hint">· {p.items.length} item{p.items.length === 1 ? '' : 's'}</span></span>
                      <span className="packs-tags"><span className="tag">{learnerState(p)}</span> <span className={`tag ${s.tone}`.trim()}>{s.label}</span></span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </aside>
        {pack ? (
          <section className="prep-editor packs-detail" aria-label={`Pack: ${pack.title}`}>
            <div className="packs-detail-head">
              <h3 className="subheading">{pack.title}</h3>
              <p className="packs-tags" aria-label="Pack states">
                <span className="tag">{learnerState(pack)}</span> <span className={`tag ${sharingState(pack, draft).tone}`.trim()} data-sharing-state>{sharingState(pack, draft).label}</span>
              </p>
            </div>
            <SegmentedControl label="Pack steps" value={step} options={STEPS} onChange={setStep} />

            {step === 'content' && (
              <div role="tabpanel" aria-label="Content">
                <FieldGroup label="Add records (pinned as they are now)">
                  <div className="packs-search">
                    <input type="search" className="placement-input" aria-label="Search records" placeholder="Search by title, subject or text" value={search} onChange={(e) => setSearch(e.target.value)} />
                    <select className="date-input" aria-label="Record type" value={kindFilter} onChange={(e) => setKindFilter(e.target.value as typeof kindFilter)}>
                      <option value="all">All types</option>
                      {(Object.keys(KIND_LABEL) as ReviewPackItem['kind'][]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                    </select>
                    {placements.length > 0 && (
                      <select className="date-input" aria-label="Placement filter" value={placementFilter} onChange={(e) => setPlacementFilter(e.target.value)}>
                        <option value="all">All placements</option>
                        {placements.map((p) => <option key={p.id} value={p.id}>{placementLabel(p, admin.schools ?? [])}</option>)}
                        <option value="unassigned">Unassigned</option>
                      </select>
                    )}
                    <input type="date" className="date-input" aria-label="From date" value={fromISO} onChange={(e) => setFromISO(e.target.value)} />
                  </div>
                  <p className="filter-hint" role="status" aria-live="polite">{matching.length} of {unpinned.length} record{unpinned.length === 1 ? '' : 's'} match{draft.picked.length ? ` · ${draft.picked.length} selected` : ''}</p>
                  <ul className="setup-list packs-candidates" aria-label="Pack candidates">
                    {matching.slice(0, 60).map((c) => (
                      <li key={`${c.kind}:${c.id}`} className="setup-row"><label className="toggle-row"><input type="checkbox" checked={draft.picked.includes(`${c.kind}:${c.id}`)} onChange={(e) => setDraft({ picked: e.target.checked ? [...draft.picked, `${c.kind}:${c.id}`] : draft.picked.filter((x) => x !== `${c.kind}:${c.id}`) })} /><span>{c.label}{pLabel(c.placementId) ? <span className="filter-hint"> · {pLabel(c.placementId)!.code}</span> : null}</span></label></li>
                    ))}
                    {matching.length > 60 && <li className="filter-hint">Showing the first 60 — narrow the search to find the rest.</li>}
                  </ul>
                  <div className="btn-row"><button type="button" className="btn-today-reset" disabled={draft.picked.length === 0} onClick={pin}>Pin selection ({draft.picked.length})</button></div>
                </FieldGroup>
                {pack.items.length > 0 && (
                  <ul className="workspace-list" aria-label="Pinned items">
                    {pack.items.map((item) => {
                      const cur = live(item.kind, item.id)
                      return (
                        <li key={`${item.kind}:${item.id}`} className="workspace-row requirement-row">
                          <span>
                            <span className="tag">{item.kind}</span> {candidateLabel(item.kind, item.id) ?? `${item.kind} (source removed — pinned copy kept)`}
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
                <FieldGroup label="Attachments from your wallet (listed by name; a file is only uploaded when you tick it under People and share)">
                  {walletState.status === 'loading' ? (
                    <p className="filter-hint" aria-busy="true">Reading your wallet…</p>
                  ) : walletState.status === 'error' || wallet === null ? (
                    <p className="filter-hint" role="alert">{walletState.status === 'error' ? walletState.message : 'Could not read your wallet.'} <button type="button" className="travel-link" onClick={() => setWalletTick((n) => n + 1)}>Retry</button></p>
                  ) : attachmentRows.length === 0 ? (
                    <p className="filter-hint">No wallet files on this device.</p>
                  ) : (
                    <ul className="setup-list" aria-label="Attachments">
                      {attachmentRows.map((a) => (
                        <li key={a.key} className="setup-row">
                          <label className="toggle-row">
                            <input type="checkbox" checked={a.chosen} onChange={(e) => setPack(pack.id, { attachments: e.target.checked ? [...(pack.attachments ?? []), { id: '', uid: a.uid, name: a.name, size: a.size, state: 'local-only' }] : (pack.attachments ?? []).filter((x) => x !== a.ref) })} />
                            <span>
                              {a.name} <span className={`tag${a.state !== 'local-only' ? ' tag--amber' : ''}`}>{a.state === 'missing' ? 'Missing on this device' : a.state === 'unresolved' ? 'Missing — choose the original file' : 'On this device only'}</span>
                            </span>
                          </label>
                          {a.state !== 'local-only' && wallet.length > 0 && (
                            <span className="requirement-confirm">
                              <select className="date-input" aria-label={`Relink: ${a.name}`} value={relink[a.key] ?? ''} onChange={(e) => setRelink({ ...relink, [a.key]: e.target.value })}>
                                <option value="">Choose the original file…</option>
                                {wallet.map((w) => (
                                  <option key={w.uid} value={w.uid}>{w.name} ({Math.max(1, Math.round(w.size / 1024))} KB)</option>
                                ))}
                              </select>
                              <button type="button" className="travel-link" disabled={!relink[a.key]} onClick={() => { const w = wallet.find((x) => x.uid === relink[a.key]); if (w && a.ref) setPack(pack.id, { attachments: (pack.attachments ?? []).map((x) => (x === a.ref ? { id: '', uid: w.uid, name: w.name, size: w.size, state: 'local-only' } : x)) }) }}>Relink</button>
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </FieldGroup>
                <Field label="Notes for the pack"><textarea className="placement-input" rows={2} aria-label="Pack notes" value={pack.notes ?? ''} onChange={(e) => setPack(pack.id, { notes: e.target.value || undefined })} /></Field>
                {pack.sharing && pack.sharing.mentorIds.length > 0 && <p className="filter-hint">Notes and pins you change now stay on this device until you share a new version.</p>}
                <div className="btn-row">
                  {pack.state === 'selected' && <button type="button" className="btn-today-reset" onClick={() => setPack(pack.id, { state: 'draft' })}>Mark as draft</button>}
                  {pack.state === 'draft' && (
                    <>
                      <input type="date" className="date-input" aria-label="Discussed on" aria-invalid={!!discussedError} value={discussedISO} onChange={(e) => { setDiscussedISO(e.target.value); setDiscussedError(null) }} />
                      <button type="button" className="btn-today-reset" onClick={markDiscussed}>Mark as discussed</button>
                    </>
                  )}
                  <button type="button" className="btn-today-reset" aria-expanded={confirmDelete === pack.id} onClick={() => setConfirmDelete(confirmDelete === pack.id ? null : pack.id)}>Delete local pack</button>
                </div>
                {discussedError && <p className="filter-hint field-error" role="alert">{discussedError}</p>}
                {confirmDelete === pack.id && (
                  <div className="callout callout--amber" aria-label="Confirm pack deletion">
                    <p>
                      Delete “{pack.title}” from this device and your synced copies?{' '}
                      {pack.sharing && pack.sharing.mentorIds.length > 0
                        ? `It is still shared (version ${pack.sharing.revision}) with ${pack.sharing.mentorIds.length} mentor${pack.sharing.mentorIds.length === 1 ? '' : 's'}${pack.sharing.attachmentUids.length ? ` and ${pack.sharing.attachmentUids.length} file${pack.sharing.attachmentUids.length === 1 ? '' : 's'}` : ''} — deleting here does not take it out of the portal; use Unshare for that.`
                        : pack.sharing
                          ? 'It is not shared with anyone at the moment.'
                          : 'It has never been shared.'}{' '}
                      You can undo straight after.
                    </p>
                    <div className="btn-row">
                      <button type="button" className="btn-primary" onClick={() => deletePack(pack)}>Delete pack</button>
                      <button type="button" className="btn-ghost" onClick={() => setConfirmDelete(null)}>Keep</button>
                    </div>
                  </div>
                )}
                <h3 className="subheading">Exactly what leaves the device</h3>
                <pre className="plan-pre pack-preview-text" aria-label="Pack preview">{text}</pre>
                <div className="btn-row">
                  <button type="button" className="btn-today-reset" onClick={() => downloadFile(`review-pack-${pack.title.replace(/[^\w-]+/g, '-').toLowerCase()}.txt`, text, 'text/plain')}>Export this text</button>
                  <button type="button" className="btn-primary" onClick={() => setStep('people')}>Next: People</button>
                </div>
              </div>
            )}

            {step === 'people' && (
              <div role="tabpanel" aria-label="People">
                {!space ? (
                  <p className="filter-hint">Turn on mentor access in Settings → Data &amp; devices to share this pack with a mentor through the portal. A private draft never needs a recipient.</p>
                ) : paused ? (
                  <p className="filter-hint">Mentor access is paused on this device — resume it in Settings → Data &amp; devices → Mentor access to share from here. Mentors keep what they already have.</p>
                ) : mentorsState.status === 'loading' || mentorsState.status === 'idle' ? (
                  <p className="filter-hint" aria-busy="true">Loading your mentors…</p>
                ) : mentorsState.status === 'error' || !mentors ? (
                  <p className="filter-hint" role="alert">{mentorsState.status === 'error' ? mentorsState.message : 'Could not load your mentors.'} <button type="button" className="travel-link" onClick={() => setMentorsTick((n) => n + 1)}>Retry</button></p>
                ) : mentors.closedAt ? (
                  <p className="filter-hint">Mentor access is ended for every mentor — reopen it in Settings → Data &amp; devices → Mentor access to share again.</p>
                ) : activeMentors.length === 0 ? (
                  <p className="filter-hint">No active mentor yet — create an invitation in Settings → Data &amp; devices → Mentor access.</p>
                ) : (
                  <>
                    <FieldGroup label="Share with">
                      <ul className="setup-list" aria-label="Share with">
                        {activeMentors.map((m) => (
                          <li key={m.id} className="setup-row"><label className="toggle-row"><input type="checkbox" checked={draft.shareWith.includes(m.id)} onChange={(e) => { setCommand(null); setDraft({ shareWith: e.target.checked ? [...draft.shareWith, m.id] : draft.shareWith.filter((x) => x !== m.id) }) }} /><span>{m.name}</span></label></li>
                        ))}
                      </ul>
                    </FieldGroup>
                    {shareableFiles.length > 0 && (
                      <FieldGroup label="This pack's files (encrypted on this device before upload, up to 2 MB each)">
                        <ul className="setup-list" aria-label="Attachments to share">
                          {shareableFiles.map((a) => (
                            <li key={a.uid} className="setup-row"><label className="toggle-row"><input type="checkbox" checked={draft.shareAtt.includes(a.uid ?? '')} onChange={(e) => { setCommand(null); setDraft({ shareAtt: e.target.checked ? [...draft.shareAtt, a.uid ?? ''] : draft.shareAtt.filter((x) => x !== a.uid) }) }} /><span>{a.name}</span></label></li>
                          ))}
                        </ul>
                      </FieldGroup>
                    )}
                    <p className="filter-hint">A share replaces what the portal holds for this pack: the text from Content, the mentors ticked and the files ticked — nothing else. Feedback they write comes back signed as reviewer-authenticated.</p>
                  </>
                )}
                <div className="btn-row">
                  <button type="button" className="btn-ghost" onClick={() => setStep('content')}>Back</button>
                  {space && !paused && activeMentors.length > 0 && <button type="button" className="btn-primary" disabled={busy || draft.shareWith.length === 0} onClick={() => void reviewShare()}>Review share</button>}
                </div>
              </div>
            )}

            {step === 'check' && (
              <div role="tabpanel" aria-label="Share step">
                {pack.sharing && (pack.sharing.mentorIds.length > 0 ? (
                  <p className="filter-hint">Shared version {pack.sharing.revision} on {new Date(pack.sharing.sharedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} with {pack.sharing.mentorIds.length} mentor{pack.sharing.mentorIds.length === 1 ? '' : 's'}{pack.sharing.attachmentUids.length ? ` and ${pack.sharing.attachmentUids.length} file${pack.sharing.attachmentUids.length === 1 ? '' : 's'}` : ''}.</p>
                ) : (
                  <p className="filter-hint">Not shared with anyone at the moment{pack.sharing.unsharedAt ? ` (unshared ${new Date(pack.sharing.unsharedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })})` : ''}.</p>
                ))}
                {command && diff && command.packId === pack.id ? (
                  <div className="callout callout--amber" aria-label="Check and share">
                    <p><strong>Version {command.revision}</strong> to {command.recipients.length} mentor{command.recipients.length === 1 ? '' : 's'} ({command.recipients.map((id) => mentors?.mentors.find((m) => m.id === id)?.name ?? id).join(', ')}), {command.files.length} file{command.files.length === 1 ? '' : 's'} ({Math.round(command.files.reduce((n, f) => n + f.size, 0) / 1024)} KB).</p>
                    <ul>
                      <li>{diff.first ? 'First share of this pack.' : diff.textChanged ? 'Text changed since the last share.' : 'Text unchanged.'}</li>
                      {diff.addedRecipients.length > 0 && <li>Now shared with: {diff.addedRecipients.join(', ')}</li>}
                      {diff.removedRecipients.length > 0 && <li>No longer shared with: {diff.removedRecipients.join(', ')}</li>}
                      {diff.addedFiles.length > 0 && <li>Files added: {diff.addedFiles.join(', ')}</li>}
                      {diff.removedFiles.length > 0 && <li>Files removed: {diff.removedFiles.join(', ')} (copies already downloaded cannot be recalled)</li>}
                    </ul>
                    <details className="journey-steps">
                      <summary><span>Show the exact text</span></summary>
                      <pre className="plan-pre pack-preview-text">{command.text}</pre>
                    </details>
                    <div className="btn-row">
                      <button type="button" className="btn-primary" disabled={busy} onClick={() => void send()}>Share this version</button>
                      <button type="button" className="btn-ghost" onClick={() => { setCommand(null); setStep('people') }}>Back</button>
                    </div>
                  </div>
                ) : (
                  <p className="filter-hint">Nothing reviewed yet — choose people first, then Review share. <button type="button" className="travel-link" onClick={() => setStep('people')}>Choose people</button></p>
                )}
                <div className="btn-row">
                  {space && !paused && <button type="button" className="btn-today-reset" disabled={busy} onClick={() => void checkInbox()}>Check for feedback</button>}
                  {space && pack.sharing && pack.sharing.mentorIds.length > 0 && !paused && (
                    <button type="button" className="btn-today-reset" disabled={busy} aria-expanded={confirmUnshare === pack.id} onClick={() => setConfirmUnshare(confirmUnshare === pack.id ? null : pack.id)}>Unshare from mentors</button>
                  )}
                </div>
                {confirmUnshare === pack.id && (
                  <div className="callout callout--amber" aria-label="Confirm unshare">
                    <p>Take “{pack.title}” away from all {pack.sharing?.mentorIds.length ?? 0} mentor{(pack.sharing?.mentorIds.length ?? 0) === 1 ? '' : 's'}? They can no longer open it or its files in the portal. Copies already downloaded are not recalled, and feedback already collected stays in your PGCE file.</p>
                    <div className="btn-row">
                      <button type="button" className="btn-primary" disabled={busy} onClick={() => void unshare()}>Unshare now</button>
                      <button type="button" className="btn-ghost" onClick={() => setConfirmUnshare(null)}>Keep sharing</button>
                    </div>
                  </div>
                )}
              </div>
            )}
            {draft.msg && <p className="filter-hint" role="status">{draft.msg}</p>}
          </section>
        ) : (
          <section className="packs-detail packs-detail--empty" aria-label="No pack selected">
            <p className="filter-hint">{admin.reviewPacks.length ? 'Choose a pack from the list.' : 'Create your first pack to start collecting the records you want a mentor or tutor to see.'}</p>
          </section>
        )}
      </div>
      {undo && (
        <StatusMessage tone="info">
          <span>
            Pack “{undo.title}” deleted.{' '}
            <button
              type="button"
              className="travel-link"
              onClick={() => {
                // Undo writes a revision NEWER than the tombstone (same rule as the PGCE file).
                const restored = { ...undo, at: Date.now() }
                onUpdateAdmin((prev) => ({ ...prev, reviewPacks: [...prev.reviewPacks.filter((p) => p.id !== restored.id), restored] }))
                setSelectedId(restored.id)
                setUndo(null)
              }}
            >
              Undo
            </button>
          </span>
        </StatusMessage>
      )}
    </Dialog>
  )
}

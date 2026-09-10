import { useEffect, useMemo, useState } from 'react'
import { useCourseClock } from '../hooks/useCourseClock'
import { sessionKey } from '../lib/diff'
import { toMinutes } from '../lib/format'
import { addPhoto, compressImage, getPhotos } from '../lib/photos'
import { listSharedPhotos, removeSharedPhoto } from '../lib/shareTarget'
import type { SharedPhoto } from '../lib/shareTarget'
import { telemetryTrack } from '../lib/telemetry'
import type { Session, SessionMeta } from '../types'
import { Dialog, Field, IconClose, StatusMessage } from './ui'

interface Props {
  profileId: string
  profileName: string
  /** course sessions (all dates) for the destination picker */
  sessions: Session[]
  onMeta: (session: Session, patch: Partial<SessionMeta>) => void
  onOpenSession: (session: Session) => void
  onClose: () => void
}

type ItemState = { item: SharedPhoto; status: 'pending' | 'saving' | 'saved' | 'failed'; error?: string }

const shortDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

/**
 * Shared-photo inbox (FA-05): photos shared into the app wait here until the
 * person confirms which session they belong to. Each photo is removed from
 * the inbox only after its write succeeded; a failure keeps it with a Retry;
 * Discard is an explicit action with confirmation. The photo count on the
 * session is reconciled from the files actually stored, never from a guess.
 */
export function SharedPhotosSheet({ profileId, profileName, sessions, onMeta, onOpenSession, onClose }: Props) {
  const clock = useCourseClock()
  const [items, setItems] = useState<ItemState[] | null>(null)
  const [targetId, setTargetId] = useState<string>('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    void listSharedPhotos().then((list) => live && setItems(list.map((item) => ({ item, status: 'pending' }))))
    return () => {
      live = false
    }
  }, [])

  // Candidates: today's sessions and the previous seven days, latest first;
  // the default is the current or most recently started session on the
  // COURSE clock — offered, never assumed.
  const candidates = useMemo(() => {
    const cutoff = new Date(Date.parse(clock.todayISO) - 7 * 86_400_000).toISOString().slice(0, 10)
    return sessions
      .filter((s) => !s.isKeyDate && !s.isSelfStudy && s.dateISO <= clock.todayISO && s.dateISO >= cutoff)
      .sort((a, b) => (b.dateISO + (b.start || '')).localeCompare(a.dateISO + (a.start || '')))
  }, [sessions, clock.todayISO])
  useEffect(() => {
    if (targetId || candidates.length === 0) return
    const started = candidates.find((s) => s.dateISO < clock.todayISO || ((toMinutes(s.start) ?? 9999) <= clock.nowMins))
    setTargetId((started ?? candidates[0]).id)
  }, [candidates, clock.todayISO, clock.nowMins, targetId])
  const target = candidates.find((s) => s.id === targetId) ?? null

  async function attach() {
    if (!target || !items) return
    setBusy(true)
    const key = sessionKey(target)
    let saved = 0
    for (const entry of items) {
      if (entry.status === 'saved') continue
      setItems((prev) => prev!.map((e) => (e.item.id === entry.item.id ? { ...e, status: 'saving' } : e)))
      try {
        const blob = await compressImage(new File([entry.item.blob], 'shared.jpg', { type: entry.item.blob.type || 'image/jpeg' }))
        await addPhoto(profileId, key, blob)
        await removeSharedPhoto(entry.item.id)
        saved++
        telemetryTrack('evidence_photo_saved')
        setItems((prev) => prev!.map((e) => (e.item.id === entry.item.id ? { ...e, status: 'saved' } : e)))
      } catch (error) {
        setItems((prev) => prev!.map((e) => (e.item.id === entry.item.id ? { ...e, status: 'failed', error: String(error) } : e)))
      }
    }
    // Reconcile the count from what is actually stored.
    const stored = await getPhotos(profileId, key).catch(() => [])
    if (saved > 0) onMeta(target, { photos: stored.length })
    setBusy(false)
    const remaining = await listSharedPhotos()
    if (remaining.length === 0) {
      onClose()
      onOpenSession(target)
    }
  }

  async function discard(entry: ItemState) {
    if (!window.confirm('Discard this shared photo? It is removed from the app’s inbox only — your photo library is untouched.')) return
    await removeSharedPhoto(entry.item.id).catch(() => {})
    setItems((prev) => prev!.filter((e) => e.item.id !== entry.item.id))
  }

  const pending = items?.filter((e) => e.status !== 'saved') ?? []
  return (
    <Dialog label="Shared photos" onClose={onClose}>
      <div className="sheet-header">
        <h2>Shared photos</h2>
        <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
          <IconClose />
        </button>
      </div>
      {items === null ? (
        <p className="filter-hint">Reading the inbox…</p>
      ) : items.length === 0 ? (
        <p className="filter-hint">No shared photos are waiting.</p>
      ) : (
        <>
          <p className="filter-hint">
            {pending.length} photo{pending.length === 1 ? '' : 's'} shared into My Timetable ({profileName}). Choose the session they belong to; nothing is
            attached or discarded until you say so.
          </p>
          {candidates.length === 0 ? (
            <StatusMessage tone="info">
              <span>No session in the last seven days to attach to. The photos stay in the inbox; add a personal event or wait for a session, or discard them below.</span>
            </StatusMessage>
          ) : (
            <Field label="Attach to session">
              <select className="date-input" value={targetId} onChange={(e) => setTargetId(e.target.value)} aria-label="Attach to session">
                {candidates.map((s) => (
                  <option key={s.id} value={s.id}>
                    {shortDate(s.dateISO)} {s.start} · {s.title}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <ul className="shared-inbox" aria-label="Shared photos waiting">
            {items.map((e) => (
              <li key={e.item.id} className={`shared-inbox-item shared-${e.status}`}>
                <span className="change-body">
                  <span className="change-title">
                    Photo · {Math.round(e.item.blob.size / 1024)} KB · shared {new Date(e.item.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="change-meta">
                    {e.status === 'pending' ? 'waiting' : e.status === 'saving' ? 'saving…' : e.status === 'saved' ? '✓ attached' : `failed: ${e.error} — kept in the inbox`}
                  </span>
                </span>
                {e.status !== 'saved' && (
                  <button type="button" className="btn-ghost" disabled={busy} onClick={() => void discard(e)}>
                    Discard
                  </button>
                )}
              </li>
            ))}
          </ul>
          <div className="modal-actions">
            <button type="button" className="btn-primary" disabled={busy || !target || pending.length === 0} onClick={() => void attach()}>
              {busy ? 'Attaching…' : items.some((e) => e.status === 'failed') ? `Retry (${pending.length})` : `Attach ${pending.length} photo${pending.length === 1 ? '' : 's'}`}
            </button>
            <button type="button" className="btn-ghost" onClick={onClose}>
              Later
            </button>
          </div>
        </>
      )}
    </Dialog>
  )
}

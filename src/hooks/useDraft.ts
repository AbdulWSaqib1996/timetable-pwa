import { useEffect, useRef, useState } from 'react'
import { clearDraft, loadDraft, saveDraft } from '../lib/drafts'
import type { DraftEnvelope } from '../lib/drafts'
import { newRecordDrafts } from '../lib/draftIndex'

export interface DraftApi<T> {
  value: T
  setValue: (updater: (prev: T) => T) => void
  /** 'idle' until edited; 'saving' between debounce ticks; 'saved' only after
   *  a successful persist; 'failed' keeps being retried on the next edit */
  draftStatus: 'idle' | 'saving' | 'saved' | 'failed'
  /** a pre-existing draft found on mount, awaiting an explicit choice */
  pendingDraft: DraftEnvelope<T> | null
  resumeDraft: () => void
  discardDraft: () => void
  /** remove the draft after a successful commit */
  commitClear: () => void
  /** revision the CURRENT editing session started from */
  baseRevision: number
  /** the record id to COMMIT under — a recovered new-record draft's intended id (TT-07) */
  recordId: string
  /** further recoverable new-record drafts beyond the one offered */
  otherDraftCount: number
}

/**
 * Form drafts (P5-02): debounced local persistence with honest status, an
 * explicit Continue/Discard choice for a recovered draft, and the base
 * revision captured when editing began (for conflict checks at save).
 */
export function useDraft<T>(
  pid: string,
  kind: string,
  initialRecordId: string,
  savedRevision: number,
  initial: T,
  opts: { existingIds?: Set<string> } = {}
): DraftApi<T> {
  const [value, setValueState] = useState<T>(initial)
  const [draftStatus, setDraftStatus] = useState<DraftApi<T>['draftStatus']>('idle')
  // For a NEW record (revision 0) with no draft under its freshly minted id,
  // look up recoverable new-record drafts of this kind: the newest is
  // offered, and resuming ADOPTS its intended record id (TT-07).
  const discover = (): { draft: DraftEnvelope<T> | null; others: number } => {
    const own = loadDraft<T>(pid, kind, initialRecordId)
    if (own) return { draft: own, others: 0 }
    if (savedRevision !== 0) return { draft: null, others: 0 }
    const found = newRecordDrafts<T>(pid, kind, opts.existingIds ?? new Set())
    return { draft: found[0]?.envelope ?? null, others: Math.max(0, found.length - 1) }
  }
  const [recordId, setRecordId] = useState(initialRecordId)
  const [pendingDraft, setPendingDraft] = useState<DraftEnvelope<T> | null>(() => discover().draft)
  const [otherDraftCount, setOtherDraftCount] = useState(() => discover().others)
  const baseRevisionRef = useRef(savedRevision)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestRef = useRef(value)
  latestRef.current = value
  const recordIdRef = useRef(recordId)
  recordIdRef.current = recordId

  // A different record/profile: reset the editing session.
  useEffect(() => {
    setValueState(initial)
    setDraftStatus('idle')
    setRecordId(initialRecordId)
    const d = discover()
    setPendingDraft(d.draft)
    setOtherDraftCount(d.others)
    baseRevisionRef.current = savedRevision
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid, kind, initialRecordId])

  // Flush a pending (debounced) write when the page hides or the editor
  // unmounts, instead of cancelling the only write that would have saved
  // it. No promise is made for edits the flush itself fails to persist.
  const flush = () => {
    if (!timerRef.current) return
    clearTimeout(timerRef.current)
    timerRef.current = null
    const ok = saveDraft(pid, kind, recordIdRef.current, baseRevisionRef.current, latestRef.current)
    setDraftStatus(ok ? 'saved' : 'failed')
  }
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onHide)
      flush()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setValue = (updater: (prev: T) => T) => {
    setValueState((prev) => {
      const next = updater(prev)
      latestRef.current = next
      setDraftStatus('saving')
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        const ok = saveDraft(pid, kind, recordIdRef.current, baseRevisionRef.current, latestRef.current)
        setDraftStatus(ok ? 'saved' : 'failed')
      }, 500)
      return next
    })
  }

  return {
    value,
    setValue,
    draftStatus,
    pendingDraft,
    resumeDraft: () => {
      if (!pendingDraft) return
      setValueState(pendingDraft.value)
      latestRef.current = pendingDraft.value
      baseRevisionRef.current = pendingDraft.baseRevision
      // Continue under the draft's intended id, so the eventual save commits
      // the SAME record the user was creating, not a second one.
      setRecordId(pendingDraft.recordId)
      recordIdRef.current = pendingDraft.recordId
      setPendingDraft(null)
      setDraftStatus('saved')
    },
    discardDraft: () => {
      clearDraft(pid, kind, pendingDraft?.recordId ?? recordId)
      const d = discover()
      setPendingDraft(d.draft)
      setOtherDraftCount(d.others)
    },
    commitClear: () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      clearDraft(pid, kind, recordId)
      setDraftStatus('idle')
    },
    baseRevision: baseRevisionRef.current,
    recordId,
    otherDraftCount,
  }
}

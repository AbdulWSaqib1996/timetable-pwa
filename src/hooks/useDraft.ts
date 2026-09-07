import { useEffect, useRef, useState } from 'react'
import { clearDraft, loadDraft, saveDraft } from '../lib/drafts'
import type { DraftEnvelope } from '../lib/drafts'

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
}

/**
 * Form drafts (P5-02): debounced local persistence with honest status, an
 * explicit Continue/Discard choice for a recovered draft, and the base
 * revision captured when editing began (for conflict checks at save).
 */
export function useDraft<T>(
  pid: string,
  kind: string,
  recordId: string,
  savedRevision: number,
  initial: T
): DraftApi<T> {
  const [value, setValueState] = useState<T>(initial)
  const [draftStatus, setDraftStatus] = useState<DraftApi<T>['draftStatus']>('idle')
  const [pendingDraft, setPendingDraft] = useState<DraftEnvelope<T> | null>(() =>
    loadDraft<T>(pid, kind, recordId)
  )
  const baseRevisionRef = useRef(savedRevision)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestRef = useRef(value)
  latestRef.current = value

  // A different record/profile: reset the editing session.
  useEffect(() => {
    setValueState(initial)
    setDraftStatus('idle')
    setPendingDraft(loadDraft<T>(pid, kind, recordId))
    baseRevisionRef.current = savedRevision
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid, kind, recordId])

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    []
  )

  const setValue = (updater: (prev: T) => T) => {
    setValueState((prev) => {
      const next = updater(prev)
      latestRef.current = next
      setDraftStatus('saving')
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        const ok = saveDraft(pid, kind, recordId, baseRevisionRef.current, latestRef.current)
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
      setPendingDraft(null)
      setDraftStatus('saved')
    },
    discardDraft: () => {
      clearDraft(pid, kind, recordId)
      setPendingDraft(null)
    },
    commitClear: () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      clearDraft(pid, kind, recordId)
      setDraftStatus('idle')
    },
    baseRevision: baseRevisionRef.current,
  }
}

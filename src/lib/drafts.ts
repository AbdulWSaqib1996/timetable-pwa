import { persistJSON, persistValue } from './persistence'

/**
 * Local draft envelopes (P5-02): per profile + record kind + record id, with
 * the saved revision editing began from. Drafts persist through the checked
 * persistence layer — "Draft saved" is only ever claimed after a successful
 * write. Keys end with the profile id so profile deletion sweeps them with
 * the same ownership policy as every other record.
 */

export interface DraftEnvelope<T> {
  version: 1
  profileId: string
  recordKind: string
  recordId: string
  /** saved revision when editing began (0 for a new record) */
  baseRevision: number
  savedAt: number
  value: T
}

const MAX_DRAFT_BYTES = 64 * 1024

const draftKey = (pid: string, kind: string, id: string) => `timetable.draft.v1.${kind}.${id}.${pid}`

export function loadDraft<T>(pid: string, kind: string, id: string): DraftEnvelope<T> | null {
  try {
    const raw = localStorage.getItem(draftKey(pid, kind, id))
    if (!raw) return null
    const parsed = JSON.parse(raw) as DraftEnvelope<T>
    if (parsed.version !== 1 || parsed.profileId !== pid) return null
    return parsed
  } catch {
    return null
  }
}

/** Persist a draft; returns false (never claiming success) on quota/failure
 *  or when the draft exceeds the bounded size. */
export function saveDraft<T>(
  pid: string,
  kind: string,
  id: string,
  baseRevision: number,
  value: T
): boolean {
  const envelope: DraftEnvelope<T> = {
    version: 1,
    profileId: pid,
    recordKind: kind,
    recordId: id,
    baseRevision,
    savedAt: Date.now(),
    value,
  }
  try {
    if (JSON.stringify(envelope).length > MAX_DRAFT_BYTES) return false
  } catch {
    return false
  }
  return persistJSON(draftKey(pid, kind, id), envelope)
}

export function clearDraft(pid: string, kind: string, id: string): void {
  persistValue(draftKey(pid, kind, id), null)
}

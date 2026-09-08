import type { DraftEnvelope } from './drafts'

/**
 * Draft discovery (R1 / TT-07). Envelopes already carry profile, kind,
 * intended record id, base revision and saved time; this indexes them by
 * scanning the durable key space so a NEW-record draft (base revision 0)
 * can be found again after reload even though a fresh form minted a
 * different random id. Nothing here trusts arbitrary localStorage JSON —
 * every candidate is shape-checked before it is offered.
 */

const PREFIX = 'timetable.draft.v1.'

export interface DraftSummary<T = unknown> {
  key: string
  envelope: DraftEnvelope<T>
}

function isEnvelope(x: unknown): x is DraftEnvelope<unknown> {
  const e = x as DraftEnvelope<unknown>
  return (
    !!e &&
    typeof e === 'object' &&
    e.version === 1 &&
    typeof e.profileId === 'string' &&
    typeof e.recordKind === 'string' &&
    typeof e.recordId === 'string' &&
    typeof e.baseRevision === 'number' &&
    typeof e.savedAt === 'number' &&
    e.value !== null &&
    typeof e.value === 'object'
  )
}

/** All valid drafts for a profile (optionally one kind), newest first. */
export function listDrafts<T = unknown>(pid: string, kind?: string): DraftSummary<T>[] {
  const out: DraftSummary<T>[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !key.startsWith(PREFIX) || !key.endsWith(`.${pid}`)) continue
      if (kind && !key.startsWith(`${PREFIX}${kind}.`)) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(localStorage.getItem(key) ?? 'null')
      } catch {
        continue
      }
      if (!isEnvelope(parsed) || parsed.profileId !== pid) continue
      if (kind && parsed.recordKind !== kind) continue
      out.push({ key, envelope: parsed as DraftEnvelope<T> })
    }
  } catch {
    /* storage unavailable: no drafts to offer */
  }
  return out.sort((a, b) => b.envelope.savedAt - a.envelope.savedAt)
}

/**
 * New-record drafts of a kind: base revision 0 and not belonging to any
 * record that already exists (`existingIds`). Newest first.
 */
export function newRecordDrafts<T = unknown>(pid: string, kind: string, existingIds: Set<string>): DraftSummary<T>[] {
  return listDrafts<T>(pid, kind).filter((d) => d.envelope.baseRevision === 0 && !existingIds.has(d.envelope.recordId))
}

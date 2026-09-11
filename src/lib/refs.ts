import type { AdminFile } from './admin'

/**
 * Typed references (G0). One record can point at many things — a lesson at
 * its placement, an observation at a lesson, a target at the meeting that set
 * it — and every pointer carries the profile and entity type so a dangling id
 * can be shown as "Unassigned" rather than silently resolved to the wrong
 * record. `revision` pins the referenced record's `at` when that matters
 * (an observation of a lesson as it was, not as later edited).
 */
export type EntityType = 'placement' | 'school' | 'lesson' | 'observation' | 'meeting' | 'target' | 'reflection' | 'audit' | 'task' | 'session'

export interface EntityRef {
  profileId: string
  entityType: EntityType
  entityId: string
  revision?: number
}

const collectionOf: Partial<Record<EntityType, keyof AdminFile>> = {
  placement: 'placements',
  school: 'schools',
  lesson: 'lessons',
  observation: 'observations',
  meeting: 'meetings',
  target: 'targets',
  reflection: 'reflections',
  audit: 'audits',
  task: 'tasks',
}

export function makeRef(profileId: string, entityType: EntityType, entityId: string, revision?: number): EntityRef {
  return revision === undefined ? { profileId, entityType, entityId } : { profileId, entityType, entityId, revision }
}

export const sameRef = (a: EntityRef | undefined, b: EntityRef | undefined): boolean =>
  !!a && !!b && a.profileId === b.profileId && a.entityType === b.entityType && a.entityId === b.entityId

/** A stable string key ("profile/type/id") for maps and dedupe. */
export const refKey = (ref: EntityRef): string => `${ref.profileId}/${ref.entityType}/${ref.entityId}`

export function parseRefKey(key: string): EntityRef | null {
  const m = /^([\w-]+)\/([a-z]+)\/([\w-]+)$/.exec(key)
  return m ? { profileId: m[1], entityType: m[2] as EntityType, entityId: m[3] } : null
}

export type Resolved<T> = { status: 'found'; record: T; stale: boolean } | { status: 'unassigned' } | { status: 'other-profile' }

/**
 * Resolve a reference against a profile's admin file. Missing or tombstoned
 * targets resolve to 'unassigned' — callers render that label, never a guess.
 * `stale` is true when the record has moved on from the pinned revision.
 */
export function resolveRef<T extends { id: string; at: number }>(profileId: string, admin: AdminFile, ref: EntityRef | undefined): Resolved<T> {
  if (!ref) return { status: 'unassigned' }
  if (ref.profileId !== profileId) return { status: 'other-profile' }
  const collection = collectionOf[ref.entityType]
  if (!collection) return { status: 'unassigned' }
  const rows = (admin[collection] ?? []) as unknown as T[]
  const record = Array.isArray(rows) ? rows.find((r) => r.id === ref.entityId) : undefined
  if (!record || admin.deleted?.[`${collection}:${ref.entityId}`]) return { status: 'unassigned' }
  return { status: 'found', record, stale: ref.revision !== undefined && record.at > ref.revision }
}

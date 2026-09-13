import { isPlacementSession, placementTag } from './format'
import { placementForTag, placementSetupState, schoolOf } from './admin'
import type { AdminFile, PlacementRec, PlacementSetupState, SchoolLocationRec } from './admin'
import type { Session, Settings } from '../types'

/**
 * One source of truth for school details (audit B04, Pass 77). The canonical
 * path is block tag → placement (`admin.placements`, by `mappedBlockTags`) →
 * school (`admin.schools`). The legacy per-tag map in `settings.placements`
 * is read ONLY for blocks no placement has claimed, and callers can show that
 * provenance. Every consumer that used to read `settings.placements[tag]` —
 * the session detail's travel tab, the Schedule school-day card, Today's
 * hero travel, the reminder hook and the push worker config — now reads the
 * projection built here, so editing SE2's school updates all of them and
 * nothing else.
 */

export type PlacementProvenance = 'canonical' | 'legacy' | 'none'

/** The shape those consumers already understand. */
export interface PlacementInfo {
  school?: string
  address?: string
  mentor?: string
  notes?: string
  lat?: number
  lng?: number
}

export interface ResolvedPlacement {
  tag: string
  provenance: PlacementProvenance
  placement?: PlacementRec
  school?: SchoolLocationRec
  /** false when the coordinates come from a legacy entry or an unconfirmed pin */
  confirmed: boolean
  setupState: PlacementSetupState
  info: PlacementInfo
}

export function resolvePlacementForTag(tag: string, admin: Pick<AdminFile, 'placements' | 'schools'>, settings: Pick<Settings, 'placements'> | null | undefined): ResolvedPlacement {
  const placement = placementForTag(admin.placements ?? [], tag)
  if (placement) {
    const school = schoolOf(placement, admin.schools ?? [])
    const info: PlacementInfo = {}
    if (school?.name) info.school = school.name
    if (school?.address) info.address = school.address
    if (placement.mentorName) info.mentor = placement.mentorName
    if (placement.notes || school?.entranceNote) info.notes = [placement.notes, school?.entranceNote].filter(Boolean).join(' · ')
    if (school?.lat != null && school?.lng != null) {
      info.lat = school.lat
      info.lng = school.lng
    }
    return { tag, provenance: 'canonical', placement, school, confirmed: !!school?.confirmedAt, setupState: placementSetupState(placement, school), info }
  }
  const legacy = settings?.placements?.[tag]
  if (legacy && (legacy.school || legacy.address || legacy.mentor || legacy.notes || legacy.lat != null)) {
    return { tag, provenance: 'legacy', confirmed: false, setupState: 'not-set-up', info: { ...legacy } }
  }
  return { tag, provenance: 'none', confirmed: false, setupState: 'not-set-up', info: {} }
}

export function resolvePlacementForSession(session: Session, admin: Pick<AdminFile, 'placements' | 'schools'>, settings: Pick<Settings, 'placements'> | null | undefined): ResolvedPlacement | null {
  if (session.isKeyDate || !isPlacementSession(session)) return null
  return resolvePlacementForTag(placementTag(session.title), admin, settings)
}

/**
 * The per-tag map every legacy consumer reads, projected from canonical data
 * first. Tags come from the timetable, the legacy map and every mapped block.
 */
export function effectivePlacementMap(admin: Pick<AdminFile, 'placements' | 'schools'>, settings: Pick<Settings, 'placements'> | null | undefined, sessions: Session[]): NonNullable<Settings['placements']> {
  const tags = new Set<string>()
  for (const s of sessions) if (!s.isKeyDate && isPlacementSession(s)) tags.add(placementTag(s.title))
  for (const t of Object.keys(settings?.placements ?? {})) tags.add(t)
  for (const p of admin.placements ?? []) for (const t of p.mappedBlockTags) tags.add(t)
  const out: NonNullable<Settings['placements']> = {}
  for (const tag of tags) {
    const r = resolvePlacementForTag(tag, admin, settings)
    if (r.provenance !== 'none') out[tag] = r.info
  }
  return out
}

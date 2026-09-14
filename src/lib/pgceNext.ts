import { nextSteps } from '../../shared/practice.js'
import { PLACEMENT_CODES, placementSetupState, placementTiming, schoolOf } from './admin'
import type { AdminFile, PlacementCode, PlacementRec, SchoolLocationRec } from './admin'
import { loadNextStepPrefs } from './nextSteps'
import type { PgceSection } from './navigationState'

/**
 * The PGCE landing's ONE recommended next action (audit U01, Pass 79) and
 * the per-profile memory of the last section visited. Precedence is fixed
 * and explicit: an unresolved data/access issue → a near dated commitment →
 * unfinished recently edited work → empty-state onboarding. Nothing here
 * scores the learner or makes an unconfirmed requirement look like a
 * failure; the recommendation never gates access to any record.
 */

export interface Recommendation {
  kind: 'setup' | 'lesson' | 'prep' | 'record' | 'onboard'
  label: string
  reason: string
  /** which rule produced it — shown in tests and the "why this" line */
  rule: 'data' | 'dated' | 'unfinished' | 'onboarding'
  placementCode?: PlacementCode | string
  placementId?: string
  lessonId?: string
  stage?: 'plan' | 'rehearse' | 'review'
  prepId?: string
  tab?: 'lessons' | 'overview'
  focusAdd?: boolean
}

export interface ActivePlacement {
  placement: PlacementRec | undefined
  code: PlacementCode | string
  school: SchoolLocationRec | undefined
  state: ReturnType<typeof placementSetupState>
  timing: ReturnType<typeof placementTiming>
}

/** The placement that matters today: current by dates, else the next upcoming, else the first recorded, else SE1. */
export function activePlacement(admin: Pick<AdminFile, 'placements' | 'schools'>, todayISO: string): ActivePlacement {
  const placements = admin.placements ?? []
  const schools = admin.schools ?? []
  const by = (t: string) => placements.find((p) => placementTiming(p, todayISO) === t)
  const placement = by('current') ?? placements.filter((p) => placementTiming(p, todayISO) === 'upcoming').sort((a, b) => (a.startISO ?? '').localeCompare(b.startISO ?? ''))[0] ?? placements[0]
  const code = placement?.code ?? PLACEMENT_CODES[0]
  const school = schoolOf(placement, schools)
  return { placement, code, school, state: placementSetupState(placement, school), timing: placementTiming(placement, todayISO) }
}

export function recommendNext(admin: AdminFile, todayISO: string, profileId: string, hasPlacementBlocks: boolean): Recommendation {
  // 1. Unresolved data issue: the placement in play is not ready, or blocks exist with no placement at all.
  const active = activePlacement(admin, todayISO)
  if ((active.placement || hasPlacementBlocks) && active.state !== 'ready') {
    return {
      kind: 'setup',
      rule: 'data',
      label: active.placement ? `Finish setting up ${active.code}` : 'Set up your placements',
      reason: active.placement ? 'Journeys, reminders and the school-day card need a confirmed school for this placement.' : 'Your timetable has placement blocks that are not yet mapped to a school.',
      placementCode: active.code,
      placementId: active.placement?.id,
    }
  }
  // 2. A near dated commitment (the shared next-steps rule: dated work only, never overdue).
  const dated = nextSteps(admin, todayISO, loadNextStepPrefs(profileId)).find((s) => s.dateISO)
  if (dated) {
    if (dated.kind === 'prep' && dated.prepId) return { kind: 'prep', rule: 'dated', label: dated.label, reason: `${dated.detail} — the nearest dated item in your file.`, prepId: dated.prepId }
    if (dated.lessonId) return { kind: 'lesson', rule: 'dated', label: dated.label, reason: `${dated.detail} — the nearest dated item in your file.`, lessonId: dated.lessonId, stage: dated.kind === 'review' ? 'review' : dated.kind === 'rehearse' ? 'rehearse' : 'plan' }
  }
  // 3. Unfinished recently edited work: a taught lesson without its review, a draft mentor prep, a lesson without a plan.
  const byRecent = <T extends { at: number }>(xs: T[]) => [...xs].sort((a, b) => b.at - a.at)
  const unreviewed = byRecent(admin.lessons).find((l) => l.taughtAt && !l.evaluation)
  if (unreviewed) return { kind: 'lesson', rule: 'unfinished', label: `Review ${unreviewed.subject || 'your lesson'}`, reason: 'Taught, but the review is still empty — the most recently edited unfinished record.', lessonId: unreviewed.id, stage: 'review' }
  const draftPrep = byRecent(admin.preps ?? []).find((p) => p.state === 'draft')
  if (draftPrep) return { kind: 'prep', rule: 'unfinished', label: 'Finish your mentor preparation', reason: `Started for ${draftPrep.dateISO}, not yet held.`, prepId: draftPrep.id }
  const unplanned = byRecent(admin.lessons).find((l) => !l.intention && !l.sequence && !l.taughtAt)
  if (unplanned) return { kind: 'lesson', rule: 'unfinished', label: `Plan ${unplanned.subject || 'your lesson'}`, reason: 'Recorded without a plan yet.', lessonId: unplanned.id, stage: 'plan' }
  // 4. Onboarding: one setup action, never a screen of zero counters.
  if (admin.lessons.length === 0) return { kind: 'onboard', rule: 'onboarding', label: 'Add your first lesson', reason: 'Lessons are the thread that practice, feedback and evidence attach to.', tab: 'lessons', focusAdd: true }
  return { kind: 'record', rule: 'onboarding', label: 'Open all records', reason: 'Nothing is waiting — browse what you have collected.', tab: 'overview' }
}

const KEY = (pid: string) => `timetable.pgce.section.v1.${pid}`
export function loadLastSection(pid: string): PgceSection | null {
  try {
    const v = localStorage.getItem(KEY(pid))
    return v === 'lessons' || v === 'mentor' || v === 'evidence' || v === 'academic' ? v : null
  } catch {
    return null
  }
}
export function saveLastSection(pid: string, section: PgceSection): void {
  try {
    localStorage.setItem(KEY(pid), section)
  } catch {
    /* device convenience only */
  }
}

export const SECTION_LABEL: Record<PgceSection, string> = { lessons: 'Lessons & practice', mentor: 'Mentor & feedback', evidence: 'Evidence & reviews', academic: 'Academic work & programme' }

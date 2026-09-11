import { persistJSON, persistValue } from './persistence'
import { ADMIN_SCHEMA_VERSION, collections } from '../../shared/contracts.js'
import { canonical, mergeAdmin } from '../../shared/merge.js'
/**
 * The PGCE admin file: everything the course makes a student log — weekly
 * reflections, mentor-set targets, meeting records with actions, observation
 * records, lessons taught with evaluations, and subject-knowledge audits.
 * One record per profile in localStorage; synced and backed up like meta.
 */

export interface Reflection {
  id: string
  /** Monday of the week reflected on (yyyy-mm-dd) */
  weekISO: string
  wentWell: string
  challenges: string
  focus: string
  standards: string[]
  at: number
}

export interface TargetItem {
  id: string
  text: string
  standards: string[]
  setISO: string
  status: 'open' | 'progress' | 'met'
  metISO?: string
  /** where it came from, for the binder */
  source?: 'meeting' | 'observation' | 'manual'
  at: number
}

export interface MeetingAction {
  id: string
  text: string
  done: boolean
  /** G0: optional link when an action belongs to a different placement from its meeting */
  placementId?: string
}

export interface Meeting {
  id: string
  dateISO: string
  discussed: string
  actions: MeetingAction[]
  /** G0: which placement this meeting belongs to (a placements-collection id); absent = Unassigned */
  placementId?: string
  /** G1b: the preparation this meeting came from */
  prepId?: string
  at: number
}

/** G0 feedback provenance. Only the first two can be written by this client;
 *  'reviewer-authenticated' is reserved for a future portal and is never
 *  settable here (the wire contract rejects it). */
export type FeedbackSourceType = 'personal-reflection' | 'learner-entered' | 'reviewer-authenticated'

export interface Observation {
  id: string
  dateISO: string
  observer: string
  subject: string
  focus: string
  strengths: string
  development: string
  /** G0: who recorded this observation record (default 'learner-entered') */
  sourceType?: FeedbackSourceType
  placementId?: string
  /** G1b: the lesson this feedback is about, and the practice focus it informs */
  lessonId?: string
  cycleId?: string
  /** bumped on every edit after the first save — a reviewed record never changes silently */
  revision?: number
  at: number
}

export type LessonStage = 'plan' | 'rehearse' | 'teach' | 'review'

export interface Lesson {
  id: string
  dateISO: string
  classGroup: string
  subject: string
  /** the review side: written after teaching, distinct from the plan revision */
  evaluation: string
  standards: string[]
  placementId?: string
  // G1b workbench (all additive; the quick retrospective form never sets them)
  /** typed ref to the timetable occurrence (session key) */
  sessionRef?: string
  unitRef?: string
  intention?: string
  priorKnowledge?: string
  misconceptions?: string
  sequence?: string
  checks?: string
  plannedResponses?: string
  resources?: string[]
  stage?: LessonStage
  planRevision?: number
  planAt?: number
  rehearsedAt?: number
  rehearsalTaskId?: string
  taughtAt?: number
  /** the plan revision that was actually taught — the review refers to it */
  taughtPlanRevision?: number
  reviewAt?: number
  cycleId?: string
  attempt?: number
  duplicatedFrom?: string
  at: number
}

export type AuditStage = 'baseline' | 'revisited' | 'secure'

export interface AuditEntry {
  id: string
  subject: string
  stage: AuditStage
  note: string
  dateISO: string
  at: number
}

/** A personal task (P5-01). Source-imported deadlines stay source-owned
 *  sessions with progress metadata — these records are user-owned only. */
export interface TaskRecord {
  id: string
  title: string
  dueISO: string
  /** optional due time HH:MM */
  dueTime?: string
  status: 'todo' | 'doing' | 'done'
  notes?: string
  /** completion date, kept for history when reopened/edited */
  completedISO?: string
  at: number
}

/** A per-date placement exception or hours correction (P5-03). */
export interface PlacementExceptionRec {
  id: string
  /** placement block tag (SE1A…) */
  tag: string
  dateISO: string
  kind: 'holiday' | 'inset' | 'part-day' | 'cancelled' | 'hours'
  /** custom working hours for part-day/hours kinds */
  startTime?: string
  endTime?: string
  /** minutes actually logged on this date (refines the whole-day tick) */
  loggedMins?: number
  note?: string
  at: number
}

/** A work-plan child under a parent task (P5-05). */
export interface PlanChildRec {
  id: string
  /** parent: a tasks-collection id, or an imported deadline's stable event key */
  parentId: string
  kind: 'subtask' | 'milestone' | 'block'
  title: string
  done?: boolean
  effortMins?: number
  dateISO?: string
  startTime?: string
  endTime?: string
  at: number
}

/** A personal commitment/study block (P5-06) — imports never overwrite these. */
export interface CommitmentRec {
  id: string
  title: string
  dateISO: string
  startTime: string
  endTime: string
  kind: 'appointment' | 'work' | 'study'
  location?: string
  /** counts as busy time for clashes/group availability (default true) */
  busy?: boolean
  /** include in session reminders (default off) */
  remind?: boolean
  notes?: string
  at: number
}

/** School experience placements as recorded on the course: SE1, SE2, SE3. */
export const PLACEMENT_CODES = ['SE1', 'SE2', 'SE3'] as const
export type PlacementCode = (typeof PLACEMENT_CODES)[number]

/** A confirmed school location (G0). Coordinates are only trusted once the
 *  learner confirms them (confirmedAt); an imported guess stays unconfirmed. */
export interface SchoolLocationRec {
  id: string
  name: string
  address?: string
  lat?: number
  lng?: number
  confirmedAt?: number
  entranceNote?: string
  at: number
}

/** A placement entity (G0): the thing lessons, observations and meetings are
 *  linked to, mapped onto the imported timetable's block tags (SE1A, SE1B…).
 *  Nothing is inferred from it automatically — no attendance, no outcomes. */
export interface PlacementRec {
  id: string
  code: PlacementCode | string
  label?: string
  schoolLocationId?: string
  startISO?: string
  endISO?: string
  /** imported block tags whose sessions belong to this placement */
  mappedBlockTags: string[]
  mentorName?: string
  mentorContact?: string
  /** working-pattern override for this placement (else settings.placementHours) */
  workingHours?: { start: string; end: string }
  insetCountsAsSchoolDay?: boolean
  arrivalBufferMins?: number
  /** where the learner returns to after school (home by default) */
  returnPlaceId?: string
  notes?: string
  at: number
}

/** PG-01 (G1a): the learner's course profile — facts entered by them, one record (id 'course'). */
export interface ProgrammeProfileRec {
  id: string
  route: 'pgce-qts' | 'pgce' | 'qts-only' | 'other'
  jurisdiction?: string
  academicYear?: string
  providerLabel?: string
  phase?: 'primary' | 'secondary' | 'other'
  subject?: string
  ageRange?: string
  startISO?: string
  endISO?: string
  mode?: 'full-time' | 'part-time'
  at: number
}

/** An imported requirements pack: who wrote it and which version is applied. */
export interface ProgrammePackRec {
  id: string
  label: string
  ownerSource: 'provider' | 'dfe' | 'school' | 'self' | 'other'
  url?: string
  fileRef?: string
  version: number
  importedAt?: number
  notes?: string
  at: number
}

/** One requirement from a pack. Verification is the learner's act only. */
export interface RequirementRec {
  id: string
  packId: string
  packVersion?: number
  section: string
  title: string
  applicability?: string
  effectiveFromISO?: string
  effectiveToISO?: string
  plannedValue?: string
  unit?: string
  verification: 'unconfirmed' | 'confirmed'
  confirmedSource?: string
  confirmedAt?: number
  at: number
}

/** A dated programme milestone; `done` is set by the learner, never inferred. */
export interface MilestoneRec {
  id: string
  packId?: string
  packVersion?: number
  kind: 'academic' | 'training' | 'review'
  title: string
  dateISO: string
  sourceRef?: string
  state: 'planned' | 'done'
  doneISO?: string
  notes?: string
  at: number
}

/** PG-03 practice cycle (G1b): one focus at a time, attempts are lessons with
 *  this cycleId, feedback is observations with it; paused/closed by the learner. */
export interface PracticeCycleRec {
  id: string
  focus: string
  curriculumRef?: string
  rehearsalNote?: string
  state: 'active' | 'paused' | 'archived'
  pausedReason?: string
  reviewDecision?: 'continue' | 'adapt' | 'close'
  reviewNote?: string
  at: number
}

/** PG-03 mentor preparation: the agenda before, the outcome after. Agreed
 *  actions stay owned by the Meeting record it creates. */
export interface MentorPrepRec {
  id: string
  /** planned meeting date */
  dateISO: string
  changed?: string
  helpNeeded?: string
  /** lesson/observation ids selected as examples */
  exampleRefs?: string[]
  proposedSteps?: string
  state: 'draft' | 'held'
  meetingId?: string
  outcome?: { happened?: string; durationMins?: number; nextReviewISO?: string }
  placementId?: string
  at: number
}

export interface AdminFile {
  /** written by this client (contracts ADMIN_SCHEMA_VERSION); older files have none */
  schemaVersion?: number
  deleted?: Record<string, number>
  reflections: Reflection[]
  targets: TargetItem[]
  meetings: Meeting[]
  observations: Observation[]
  lessons: Lesson[]
  audits: AuditEntry[]
  tasks: TaskRecord[]
  exceptions: PlacementExceptionRec[]
  plans: PlanChildRec[]
  commitments: CommitmentRec[]
  placements: PlacementRec[]
  schools: SchoolLocationRec[]
  programmes: ProgrammeProfileRec[]
  packs: ProgrammePackRec[]
  requirements: RequirementRec[]
  milestones: MilestoneRec[]
  cycles: PracticeCycleRec[]
  preps: MentorPrepRec[]
}

export const EMPTY_ADMIN: AdminFile = {
  reflections: [],
  targets: [],
  meetings: [],
  observations: [],
  lessons: [],
  audits: [],
  tasks: [],
  exceptions: [],
  plans: [],
  commitments: [],
  placements: [],
  schools: [],
  programmes: [],
  packs: [],
  requirements: [],
  milestones: [],
  cycles: [],
  preps: [],
}

const adminKey = (pid: string) => `timetable.admin.v1.${pid}`

export function newAdminId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

export function loadAdminFile(pid: string): AdminFile {
  try {
    const raw = localStorage.getItem(adminKey(pid))
    if (!raw) return EMPTY_ADMIN
    const parsed = JSON.parse(raw) as Partial<AdminFile>
    // Unknown (newer) fields ride along untouched: an older build never strips them.
    return { ...EMPTY_ADMIN, ...parsed }
  } catch {
    return EMPTY_ADMIN
  }
}

export function saveAdminFile(pid: string, file: AdminFile): void {
  const previous = loadAdminFile(pid)
  const next = { ...previous, ...file, deleted: { ...previous.deleted, ...file.deleted }, schemaVersion: Math.max(ADMIN_SCHEMA_VERSION, previous.schemaVersion ?? 0) }
  const now = Date.now()
  for (const key of collections) {
    for (const item of previous[key]) if (!file[key].some(x => x.id === item.id)) next.deleted[key + ':' + item.id] = now
    // Stamp edits here too: a form cannot accidentally save an old revision.
    next[key] = file[key].map(item => {
      const old = previous[key].find(x => x.id === item.id)
      return !old || canonical({...old,at:0}) !== canonical({...item,at:0}) ? { ...item, at: Math.max(now, (old?.at ?? 0) + 1) } : old
    }) as never
  }
  persistJSON(adminKey(pid), next)
}

export function clearAdminFile(pid: string): void { persistValue(adminKey(pid), null) }

/** Provenance of an observation record. Records written before G0 carry no
 *  field and read as learner-entered — no rewrite, so their `at` and sync
 *  identity are untouched. */
export const observationSourceType = (o: Pick<Observation, 'sourceType'>): FeedbackSourceType => o.sourceType ?? 'learner-entered'

/** Proposed placement for an imported block tag by its prefix: SE1A/SE1B → SE1.
 *  A proposal only — the learner confirms in the setup sheet, never silently. */
export function proposePlacementCode(tag: string): PlacementCode | '' {
  const m = /^SE(\d)/i.exec(tag)
  const code = m ? `SE${m[1]}` : ''
  return (PLACEMENT_CODES as readonly string[]).includes(code) ? (code as PlacementCode) : ''
}

/** The placement a block tag is currently mapped to, if any. */
export function placementForTag(placements: PlacementRec[], tag: string): PlacementRec | undefined {
  return placements.find((p) => p.mappedBlockTags.includes(tag))
}

/** Display label: "SE1 · Riverside Primary" when the school is known, else the code. */
export function placementLabel(placement: PlacementRec, schools: SchoolLocationRec[]): string {
  const school = schools.find((s) => s.id === placement.schoolLocationId)
  return school?.name ? `${placement.code} · ${school.name}` : placement.label ? `${placement.code} · ${placement.label}` : placement.code
}

export interface PlacementSetupResult { placements: PlacementRec[]; schools: SchoolLocationRec[] }

export type PlacementSetupState = 'not-set-up' | 'incomplete' | 'ready'
export type PlacementTiming = 'undated' | 'upcoming' | 'current' | 'finished'

/** Setup state shown on the chooser: Not set up / School details incomplete / Ready to plan.
 *  "Ready" needs a named school with a pin the learner has confirmed — an
 *  address alone is never treated as verified. */
export function placementSetupState(placement: PlacementRec | undefined, school: SchoolLocationRec | undefined): PlacementSetupState {
  if (!placement) return 'not-set-up'
  if (!school?.name || school.lat == null || school.lng == null || !school.confirmedAt) return 'incomplete'
  return 'ready'
}

export function placementTiming(placement: PlacementRec | undefined, todayISO: string): PlacementTiming {
  if (!placement?.startISO || !placement.endISO) return 'undated'
  if (todayISO < placement.startISO) return 'upcoming'
  if (todayISO > placement.endISO) return 'finished'
  return 'current'
}

export const PLACEMENT_STATE_LABEL: Record<PlacementSetupState, string> = { 'not-set-up': 'Not set up', incomplete: 'School details incomplete', ready: 'Ready to plan' }
export const PLACEMENT_TIMING_LABEL: Record<PlacementTiming, string> = { undated: 'Dates not set', upcoming: 'Upcoming', current: 'Current', finished: 'Finished' }

export const schoolOf = (placement: PlacementRec | undefined, schools: SchoolLocationRec[]): SchoolLocationRec | undefined =>
  placement?.schoolLocationId ? schools.find((s) => s.id === placement.schoolLocationId) : undefined

/**
 * Save one placement's setup (G1a). Pure: the returned arrays hold the SAME
 * object references for every other placement and school, so saving SE2 can
 * never modify SE1 or SE3 (the test compares them byte for byte).
 */
export function savePlacementSetup(
  current: PlacementSetupResult,
  placement: PlacementRec,
  school: SchoolLocationRec | null
): PlacementSetupResult {
  const placements = current.placements.some((p) => p.id === placement.id)
    ? current.placements.map((p) => (p.id === placement.id ? placement : p))
    : [...current.placements, placement]
  const schools = !school
    ? current.schools
    : current.schools.some((s) => s.id === school.id)
      ? current.schools.map((s) => (s.id === school.id ? school : s))
      : [...current.schools, school]
  return { placements, schools }
}

/**
 * Apply a confirmed tag → placement assignment (G0 migration sheet). Pure and
 * idempotent: existing placement/school records keep their ids and every field
 * not derived here; school and mentor details come from the imported tag's
 * settings.placements entry only when the record has none yet (never
 * overwritten, settings never deleted). Tags assigned '' stay Unassigned.
 */
export function applyPlacementAssignment(
  current: PlacementSetupResult,
  assignment: Record<string, PlacementCode | ''>,
  tagDetails: Record<string, { school?: string; address?: string; mentor?: string; lat?: number; lng?: number } | undefined>,
  makeId: () => string = newAdminId
): PlacementSetupResult {
  const schools = current.schools.map((s) => ({ ...s }))
  const placements = current.placements.map((p) => ({ ...p, mappedBlockTags: [...p.mappedBlockTags] }))
  const byCode = new Map<string, Record<string, unknown>[]>()
  for (const [tag, code] of Object.entries(assignment)) {
    // Remove the tag from every placement, then re-add to the chosen one.
    for (const p of placements) p.mappedBlockTags = p.mappedBlockTags.filter((t) => t !== tag)
    if (!code) continue
    byCode.set(code, [...(byCode.get(code) ?? []), { tag }])
  }
  for (const code of PLACEMENT_CODES) {
    const tags = (byCode.get(code) ?? []).map((x) => x.tag as string).sort()
    let rec = placements.find((p) => p.code === code)
    if (!rec) {
      if (tags.length === 0) continue
      rec = { id: makeId(), code, mappedBlockTags: [], at: 0 }
      placements.push(rec)
    }
    rec.mappedBlockTags = [...new Set([...rec.mappedBlockTags, ...tags])].sort()
    const detail = rec.mappedBlockTags.map((t) => tagDetails[t]).find((d) => d?.school)
    if (detail?.school && !rec.schoolLocationId) {
      let school = schools.find((s) => s.name === detail.school)
      if (!school) {
        school = { id: makeId(), name: detail.school, at: 0 }
        if (detail.address) school.address = detail.address
        if (Number.isFinite(detail.lat) && Number.isFinite(detail.lng)) { school.lat = detail.lat; school.lng = detail.lng }
        schools.push(school)
      }
      rec.schoolLocationId = school.id
    }
    const mentor = rec.mappedBlockTags.map((t) => tagDetails[t]?.mentor).find(Boolean)
    if (mentor && !rec.mentorName) rec.mentorName = mentor
  }
  return { placements, schools }
}
export const mergeAdminFiles = mergeAdmin

/** Monday of a date's week (yyyy-mm-dd). */
export function mondayOfISO(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7))
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Consecutive weeks (ending this week or last) with a reflection logged. */
export function reflectionStreak(reflections: Reflection[], todayISO: string): number {
  const weeks = new Set(reflections.map((r) => r.weekISO))
  let cursor = mondayOfISO(todayISO)
  // The current week doesn't break the streak if it just hasn't been written yet.
  let streak = 0
  if (weeks.has(cursor)) streak++
  for (;;) {
    const [y, m, d] = cursor.split('-').map(Number)
    const prev = new Date(y, m - 1, d - 7)
    cursor = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-${String(prev.getDate()).padStart(2, '0')}`
    if (weeks.has(cursor)) streak++
    else break
  }
  return streak
}

/** Compact outstanding-admin counts, synced to the push worker for the Friday digest. */
export function adminSummary(pid: string): { openTargets: number; openActions: number; lastReflectionWeek: string } {
  const file = loadAdminFile(pid)
  return {
    openTargets: file.targets.filter((t) => t.status !== 'met').length,
    openActions: file.meetings.reduce((n, m) => n + m.actions.filter((a) => !a.done).length, 0),
    lastReflectionWeek: [...file.reflections.map((r) => r.weekISO)].sort().pop() ?? '',
  }
}

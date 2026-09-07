import { persistJSON, persistValue } from './persistence'
import { collections } from '../../shared/contracts.js'
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
}

export interface Meeting {
  id: string
  dateISO: string
  discussed: string
  actions: MeetingAction[]
  at: number
}

export interface Observation {
  id: string
  dateISO: string
  observer: string
  subject: string
  focus: string
  strengths: string
  development: string
  at: number
}

export interface Lesson {
  id: string
  dateISO: string
  classGroup: string
  subject: string
  evaluation: string
  standards: string[]
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

export interface AdminFile {
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
    return { ...EMPTY_ADMIN, ...parsed }
  } catch {
    return EMPTY_ADMIN
  }
}

export function saveAdminFile(pid: string, file: AdminFile): void {
  const previous = loadAdminFile(pid)
  const next = { ...file, deleted: { ...previous.deleted, ...file.deleted } }
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

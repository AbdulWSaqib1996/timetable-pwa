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

export interface AdminFile {
  reflections: Reflection[]
  targets: TargetItem[]
  meetings: Meeting[]
  observations: Observation[]
  lessons: Lesson[]
  audits: AuditEntry[]
}

export const EMPTY_ADMIN: AdminFile = {
  reflections: [],
  targets: [],
  meetings: [],
  observations: [],
  lessons: [],
  audits: [],
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
  try {
    localStorage.setItem(adminKey(pid), JSON.stringify(file))
  } catch {
    /* storage unavailable */
  }
}

export function clearAdminFile(pid: string): void {
  try {
    localStorage.removeItem(adminKey(pid))
  } catch {
    /* ignore */
  }
}

/** Merge two admin files per item id, newest `at` wins (no tombstones: a
 * deletion on one device can be resurrected by a merge — acceptable trade). */
export function mergeAdminFiles(local: AdminFile, remote: AdminFile): AdminFile {
  const mergeList = <T extends { id: string; at: number }>(a: T[], b: T[]): T[] => {
    const byId = new Map<string, T>()
    for (const item of a) byId.set(item.id, item)
    for (const item of b) {
      const mine = byId.get(item.id)
      if (!mine || item.at >= mine.at) byId.set(item.id, item)
    }
    return [...byId.values()]
  }
  return {
    reflections: mergeList(local.reflections, remote.reflections),
    targets: mergeList(local.targets, remote.targets),
    meetings: mergeList(local.meetings, remote.meetings),
    observations: mergeList(local.observations, remote.observations),
    lessons: mergeList(local.lessons, remote.lessons),
    audits: mergeList(local.audits, remote.audits),
  }
}

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

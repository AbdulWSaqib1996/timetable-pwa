export interface HomeworkSessionLike {
  id: string
  title: string
  dateISO: string
  start: string
  isKeyDate?: boolean
  isFreeTime?: boolean
}
export interface HomeworkLike {
  id: string
  title: string
  details?: string
  lessonId?: string
  setSessionRef?: string
  setISO: string
  dueSessionRef?: string
  dueTitle?: string
  dueISO: string
  dueMode?: 'session' | 'date'
  dueSnapshot?: { dateISO: string; start?: string; title: string; at: number }
  sourceSnapshot?: { dateISO: string; start?: string; title: string; at: number }
  dueHistory?: { at: number; fromISO: string; toISO: string; reason: 'follow' | 'keep' | 'edit' }[]
  status: 'todo' | 'doing' | 'done'
  completedISO?: string
  at: number
}
export interface DueResolution<T extends HomeworkSessionLike = HomeworkSessionLike> {
  state: 'fixed' | 'current' | 'changed' | 'missing'
  effectiveISO: string
  effectiveStart: string
  session: T | null
  confirmed?: { dateISO: string; start?: string; title: string }
  change?: { fromISO: string; fromStart: string; fromTitle: string; toISO: string; toStart: string; toTitle: string; moved: boolean; retitled: boolean }
}

export const HOMEWORK_TITLE_MAX: number
export const HOMEWORK_DETAILS_MAX: number
export const HOMEWORK_STATES: readonly ('todo' | 'doing' | 'done')[]

export function titleFamily(title: string): string
export function teachableOccurrence(session: HomeworkSessionLike | null | undefined): boolean
export function laterOccurrences<T extends HomeworkSessionLike>(sessions: T[], family: string, after: { dateISO: string; start?: string }, limit?: number): T[]
export function upcomingOccurrences<T extends HomeworkSessionLike>(sessions: T[], family: string, after: { dateISO: string; start?: string }, limit?: number): { session: T; sameFamily: boolean }[]
export function homeworkForSession<T extends HomeworkLike>(homework: T[] | undefined, sessionRef: string | undefined): T[]
export function homeworkOfLesson<T extends HomeworkLike>(homework: T[] | undefined, lessonId: string | undefined): T[]
export function sortHomework<T extends HomeworkLike>(list: T[]): T[]
export function makeHomework(input: {
  id: string
  title: string
  details?: string
  lesson?: { id: string } | null
  sourceRef?: string
  source?: HomeworkSessionLike | null
  target?: { key: string; session: HomeworkSessionLike } | null
  dueISO?: string
  todayISO: string
  now: number
}): HomeworkLike
export function validateHomeworkInput(input: { title?: string; details?: string }): string | null
export function resolveDue<T extends HomeworkSessionLike>(hw: HomeworkLike, sessions: T[], keyOf: (s: T) => string): DueResolution<T>
export function resolveSource<T extends HomeworkSessionLike>(hw: HomeworkLike, sessions: T[], keyOf: (s: T) => string): { state: 'current' | 'missing' | 'none'; session: T | null; snapshot: { dateISO: string; start?: string; title: string } | null }
export function followSession<H extends HomeworkLike>(hw: H, session: HomeworkSessionLike, now: number): H
export function keepDate<H extends HomeworkLike>(hw: H, now: number): H
export function rescheduleHomework<H extends HomeworkLike>(hw: H, change: { target?: { key: string; session: HomeworkSessionLike } | null; dueISO?: string }, now: number): H
export function editHomework<H extends HomeworkLike>(hw: H, words: { title: string; details?: string }, now: number): H
export function homeworkPlanItem(hw: HomeworkLike & { effortMins?: number }, due: { effectiveISO: string }): { id: string; planKind: 'homework'; title: string; dueISO: string; status: 'todo' | 'doing' | 'done'; effortMins?: number }
export function withStatus<H extends HomeworkLike>(hw: H, next: 'todo' | 'doing' | 'done', todayISO: string, now: number): H
export interface HomeworkChangeLike { id: string; homeworkId: string; kind: 'moved' | 'retitled' | 'deadline' | 'missing'; previous: { dateISO: string; start?: string; title: string }; current?: { dateISO: string; start?: string; title: string }; sourceRevision?: number; decision?: 'follow' | 'keep' | 'reschedule'; decidedAt?: number; at: number }
export function detectHomeworkChanges<T extends HomeworkSessionLike>(input: { homework: HomeworkLike[]; changes: HomeworkChangeLike[] | undefined; targets: T[]; all: T[]; keyOf: (s: T) => string; makeId: () => string; now: number }): HomeworkChangeLike[]
export function decideChange<C extends HomeworkChangeLike>(change: C, decision: 'follow' | 'keep' | 'reschedule', now: number): C
export function openChangesFor<C extends HomeworkChangeLike>(changes: C[] | undefined, homeworkId: string): C[]
export function reconcileChanges<C extends HomeworkChangeLike, T extends HomeworkSessionLike>(input: { homework: HomeworkLike[]; changes: C[] | undefined; targets: T[]; keyOf: (s: T) => string; now: number }): C[]

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

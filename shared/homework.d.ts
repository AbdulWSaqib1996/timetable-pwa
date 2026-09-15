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
  status: 'todo' | 'doing' | 'done'
  completedISO?: string
  at: number
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
  target?: { key: string; session: HomeworkSessionLike } | null
  dueISO?: string
  todayISO: string
  now: number
}): HomeworkLike

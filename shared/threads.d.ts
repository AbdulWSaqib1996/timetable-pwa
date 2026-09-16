export const THREAD_STATES: readonly ['open', 'closed']
export const THREAD_STAGES: readonly ['plan', 'teach', 'feedback', 'next']
export const THREAD_STAGE_LABEL: { plan: string; teach: string; feedback: string; next: string }
export const THREAD_NEXT_ACTION_MAX: number
export const THREAD_TITLE_MAX: number
export const THREAD_REFS_MAX: number

export interface ThreadStep {
  stage: 'plan' | 'teach' | 'feedback' | 'next'
  state: 'done' | 'missing' | 'gone'
  reason: string
  at?: number
  lessonId?: string
  observationIds?: string[]
}

export function makeThread(lesson: any, id: string, now: number, cycleId?: string): any
export function threadOfLesson<T extends { lessonIds?: string[] }>(threads: T[] | undefined, lessonId: string): T | null
export function threadLessons(thread: any, lessons: any[]): { first: any | null; latest: any | null; missingIds: string[] }
export function threadSteps(thread: any, admin: any): { steps: ThreadStep[]; missingLessonIds: string[]; complete: boolean }
export function withObservation<T>(thread: T, observationId: string, attached: boolean, now: number): T
export function withNextAction<T>(thread: T, text: string, now: number): T
export function withNextLesson<T>(thread: T, lessonId: string, now: number): T
export function threadsInformedBy<T extends { observationIds?: string[] }>(threads: T[] | undefined, observationId: string): T[]

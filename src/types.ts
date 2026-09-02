export interface Session {
  id: string
  title: string
  day: string
  /** yyyy-mm-dd (local) */
  dateISO: string
  /** HH:MM, may be '' if unparseable */
  start: string
  end: string
  room: string
  groups: string
  tutor: string
  subject: string
  link?: string
  isSpecialism: boolean
  specialismName?: string
  isSelfStudy: boolean
}

export type DateRange = 'today' | 'week' | 'all'

export type ViewMode = 'day' | 'week' | 'month'

export interface Filters {
  dateRange: DateRange
  subjects: string[]
  tutors: string[]
  rooms: string[]
  showSelfStudy: boolean
}

export interface Settings {
  sheetUrl: string
  sheetId: string
  gid: string | null
  demo?: boolean
  /** true once the one-time specialism picker has been answered (or skipped) */
  specialismsChosen?: boolean
  /** specialisms the user attends; empty = show all */
  mySpecialisms?: string[]
  /** hide specialism sessions not in mySpecialisms (default true) */
  hideOtherSpecialisms?: boolean
  filters?: Filters
  /** last-used view, restored on open */
  activeView?: ViewMode
  /** base URL of a deployed ics-feed worker (optional, enables the subscribable feed) */
  icsFeedBase?: string
}

export interface CachedData {
  fetchedAt: number
  sessions: Session[]
}

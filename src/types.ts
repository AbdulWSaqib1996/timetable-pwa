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
  /** group tokens (e.g. "2") to keep when a sheet mixes groups; empty = all */
  myGroups?: string[]
  /** term start date enabling "Wk N" labels */
  termStartISO?: string
  /** minutes before a session to fire a notification; unset/0 = off */
  reminderMinutes?: number
}

/** One saved timetable (sheet + all its choices). */
export interface ProfileEntry {
  id: string
  name: string
  settings: Settings
}

export interface ProfileStore {
  activeId: string
  profiles: ProfileEntry[]
}

/** Per-session attendance/note, keyed by sessionKey(). */
export interface SessionMeta {
  attended?: boolean
  note?: string
}

export type MetaMap = Record<string, SessionMeta>

export interface SessionChange {
  type: 'added' | 'removed' | 'changed'
  dateISO: string
  start: string
  title: string
  detail?: string
  at: number
  seen: boolean
}

export interface CachedData {
  fetchedAt: number
  sessions: Session[]
}

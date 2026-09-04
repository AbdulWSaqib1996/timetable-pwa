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
  /** title contains "(optional)" */
  isOptional: boolean
  /** entry comes from the key-dates (submissions) tab */
  isKeyDate?: boolean
}

export type DateRange = 'today' | 'week' | 'all'

export type ViewMode = 'day' | 'week' | 'month'

export interface Filters {
  dateRange: DateRange
  subjects: string[]
  tutors: string[]
  rooms: string[]
  showSelfStudy: boolean
  /** show sessions marked "(optional)" (default true) */
  showOptional: boolean
  /** show key dates as highlighted blocks in the timetable (default true) */
  showKeyDates: boolean
  /** quick filter: show only placement (school experience) sessions */
  placementsOnly?: boolean
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
  /** legacy single reminder offset — migrated into reminderOffsets on load */
  reminderMinutes?: number
  /** minutes-before offsets to fire notifications at (e.g. [60, 15]); empty/unset = off */
  reminderOffsets?: number[]
  /** "did you attend?" notification at each session's end time (default off) */
  attendancePrompts?: boolean
  /** quiet hours: no notifications between these hours (24h, wraps midnight); both unset = off */
  quietFrom?: number
  quietTo?: number
  /** use device location to estimate travel time to session locations */
  locationEnabled?: boolean
  /** how travel-time estimates are calculated (default walking) */
  travelMode?: 'walking' | 'transit' | 'driving'
  /** home address (geocoded once) — powers the end-of-day "head home" card */
  homeAddress?: string
  homeLat?: number
  homeLng?: number
  /** minutes of head start before the computed leave-by time (start − travel) to notify at */
  leaveAlertOffsets?: number[]
  /** key-dates (submission deadlines) tab: source sheet/tab plus the pasted URL for display */
  keyDatesUrl?: string
  keyDatesSheetId?: string
  keyDatesGid?: string | null
  /** days-before offsets for key-date reminder notifications (e.g. [7, 3, 1]) */
  keyDateReminderDays?: number[]
  /** cohort-notices tab (Date/Message/Link) rendered as dismissible banners */
  noticesUrl?: string
  noticesSheetId?: string
  noticesGid?: string | null
  /** additional timetable tabs merged into this profile's sessions */
  extraTabs?: { sheetId: string; gid: string | null; url: string }[]
  /** colour theme override (default follows the system) */
  theme?: 'system' | 'light' | 'dark'
  /** base URL of a deployed push worker (enables background notifications) */
  pushServerBase?: string
  /** true once this device subscribed to background push */
  pushEnabled?: boolean
  /** include the 07:00 morning briefing push (default true) */
  morningBriefing?: boolean
  /** push timetable changes (rooms/times/added/cancelled) in the background (default true) */
  changeAlerts?: boolean
  /** Friday-afternoon outstanding-admin digest push (default true when push is on) */
  fridayDigest?: boolean
  /** background leave alerts: cache the last app-open location to the push worker (default off) */
  bgLeaveAlerts?: boolean
  /** user-added personal deadlines, merged into the key-dates views */
  customKeyDates?: { id: string; title: string; dateISO: string; start?: string }[]
  /** study group membership */
  groupCode?: string
  groupName?: string
  /** setup checklist card permanently dismissed */
  checklistDismissed?: boolean
  /** anonymous daily usage ping to the push worker (default on; off switch in Settings) */
  usagePing?: boolean
  /** user-entered placement details, keyed by placement tag (SE1B, SE2…) */
  placements?: Record<
    string,
    { school?: string; address?: string; mentor?: string; notes?: string; lat?: number; lng?: number }
  >
  /** required assessed school days for the course (drives the placement progress line) */
  placementTargetDays?: number
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
  /** recorded absence (mutually exclusive with attended) */
  absent?: boolean
  absentReason?: string
  note?: string
  /** number of photos attached (blobs live in IndexedDB) */
  photos?: number
  /** assignment status for key dates */
  status?: 'todo' | 'doing' | 'done'
  /** Teachers' Standards this note/photo evidences (e.g. ["TS1","TS4"]) */
  standards?: string[]
  /** last local edit time, used by cross-device sync to merge (newest wins per session) */
  at?: number
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
  keyDates?: Session[]
}

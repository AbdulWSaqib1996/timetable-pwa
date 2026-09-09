import { useRef, useState } from 'react'
import { attendanceSummary, isCompleted, isEligibleSession } from '../../shared/eligibility.js'
import { sessionKey } from '../lib/diff'
import { isPlacementSession, placementTag } from '../lib/format'
import { downloadICS } from '../lib/ics'
import { buildShareUrl } from '../lib/share'
import { parseSheetUrl } from '../lib/sheetUrl'
import { telemetryPending, telemetryTrack } from '../lib/telemetry'
import { WHATSNEW_VERSION } from '../lib/changelog'
import { geocodeAddress } from '../lib/geocode'
import { needsIosInstall } from '../lib/platform'
import { subscribePush, unsubscribePush } from '../lib/push'
import { runPushSelfCheck, sendTestPush } from '../lib/pushCheck'
import type { CheckRow } from '../lib/pushCheck'
import {
  applySyncPayload,
  clearSyncState,
  deleteSync,
  loadSyncState,
  newSyncCode,
  pullSync,
  pushSync,
  saveSyncState,
} from '../lib/sync'
import type { SyncState } from '../lib/sync'
import type { SourceStatus } from '../../shared/refresh.js'
import type { PlacementExceptionRec } from '../lib/admin'
import { placementBlocks as computePlacementBlocks } from '../lib/placement'
import { WHATSNEW } from '../lib/changelog'
import { IconBack, PageHeader } from './ui'
import { BackupSheet, RestoreSheet } from './BackupSheets'
import { lastBackupAt } from '../lib/storage'
import { listDrafts } from '../lib/draftIndex'
import { hasPendingSaves, persistenceFailure } from '../lib/persistence'
import { readAttachments } from '../lib/attachments'
import { useEffect } from 'react'
import type { MetaMap, ProfileStore, Session, Settings } from '../types'

export type SettingsSection =
  | 'timetable'
  | 'reminders'
  | 'travel'
  | 'calendars'
  | 'data'
  | 'appearance'
  | 'help'

interface Props {
  /** focused page to show; undefined = the category index */
  section?: SettingsSection
  onOpenSection: (section: SettingsSection) => void
  /** per-source refresh outcomes for the data-health list */
  sources: SourceStatus[]
  /** placement exceptions, for provenance in the day-log export */
  exceptions: PlacementExceptionRec[]
  /** personal commitments as sessions — included in the .ics only by explicit choice */
  personalSessions: Session[]
  settings: Settings
  store: ProfileStore
  /** sessions with the user's filters applied (specialisms etc.), all dates */
  courseSessions: Session[]
  keyDates: Session[]
  metaMap: MetaMap
  todayISO: string
  /** per-block placement day counts (tag, attended, total) */
  placementBlocks: { tag: string; attended: number; total: number }[]
  /** present when the browser offered an install prompt (Android/desktop Chrome) */
  onInstall?: () => void
  onUpdateSettings: (patch: Partial<Settings>) => void
  onOpenStats: () => void
  onOpenGroup: () => void
  onOpenCourse: () => void
  onRechooseSpecialisms: () => void
  onSwitchProfile: (id: string) => void
  onAddProfile: () => void
  onDeleteProfile: (id: string) => void
  onClose: () => void
}

import { DEFAULT_ICS_FEED_BASE, DEFAULT_PUSH_BASE } from '../lib/config'
import { activeCourse, courseZone } from '../lib/course'
import { downloadFile } from '../lib/files'

/** Build the subscribable feed URL for a deployed ics-feed worker. */
export function buildFeedUrl(base: string, settings: Settings, calendarName?: string): string {
  const url = new URL(base)
  url.searchParams.set('id', settings.sheetId)
  if (calendarName) url.searchParams.set('name', calendarName)
  if (settings.gid) url.searchParams.set('gid', settings.gid)
  const specialisms = settings.mySpecialisms ?? []
  if (specialisms.length > 0 && settings.hideOtherSpecialisms !== false) {
    url.searchParams.set('spec', specialisms.join(','))
  }
  if (settings.filters?.showSelfStudy === false) url.searchParams.set('selfstudy', '0')
  if (settings.keyDatesSheetId) {
    if (settings.keyDatesSheetId !== settings.sheetId) url.searchParams.set('kdid', settings.keyDatesSheetId)
    if (settings.keyDatesGid) url.searchParams.set('kdgid', settings.keyDatesGid)
  }
  // Placement details so the feed can put the school on each expanded school day.
  const plc = Object.fromEntries(
    Object.entries(settings.placements ?? {})
      .filter(([, p]) => p.school || p.address)
      .map(([tag, p]) => [tag, { s: p.school ?? '', a: p.address ?? '' }])
  )
  if (Object.keys(plc).length > 0) url.searchParams.set('plc', JSON.stringify(plc))
  // A configured non-London course keeps its subscribed feed on course wall time.
  if (courseZone() !== 'Europe/London') url.searchParams.set('tz', courseZone())
  return url.toString()
}

const REMINDER_OPTIONS = [
  { value: 5, label: '5 min' },
  { value: 10, label: '10 min' },
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hour' },
  { value: 120, label: '2 hours' },
]

const KEY_DATE_REMINDER_OPTIONS = [
  { value: 7, label: '7 days before' },
  { value: 3, label: '3 days before' },
  { value: 1, label: '1 day before' },
] as const

/**
 * Local Settings search (R3 / audit §5): a static index of every setting
 * with plain-language synonyms (home/address, backup/export, sync/device,
 * notifications/reminders). A result opens the real setting and focuses its
 * heading; nothing is sent anywhere.
 */
const SEARCH_ENTRIES: { section: SettingsSection; anchor: SettingsAnchor; title: string; keywords: string[] }[] = [
  { section: 'timetable', anchor: 'profiles', title: 'Timetables & profiles', keywords: ['profile', 'switch', 'timetable', 'sheet', 'merge', 'remove', 'add another'] },
  { section: 'timetable', anchor: 'key-dates-source', title: 'Key dates source', keywords: ['key dates', 'deadline', 'submission', 'source', 'sheet', 'tab'] },
  { section: 'timetable', anchor: 'notices', title: 'Notices (cohort broadcasts)', keywords: ['notice', 'broadcast', 'announcement', 'cohort', 'banner'] },
  { section: 'timetable', anchor: 'specialisms', title: 'Specialisms', keywords: ['specialism', 'group', 'subject', 'choose', 'filter'] },
  { section: 'reminders', anchor: 'session-reminders', title: 'Session reminders', keywords: ['reminder', 'notification', 'notify', 'session', 'attend', 'attendance', 'prompt', 'minutes before'] },
  { section: 'reminders', anchor: 'key-date-reminders', title: 'Key-date reminders', keywords: ['key date', 'deadline', 'reminder', 'notification', 'days before', 'submission'] },
  { section: 'reminders', anchor: 'quiet-hours', title: 'Quiet hours', keywords: ['quiet', 'night', 'silence', 'do not disturb', 'notification', 'sleep'] },
  { section: 'reminders', anchor: 'leave-alerts', title: 'Leave alerts', keywords: ['leave', 'set off', 'travel', 'alert', 'notification', 'head start'] },
  { section: 'reminders', anchor: 'background-push', title: 'Background push', keywords: ['push', 'background', 'closed', 'notification', 'morning briefing', 'week ahead'] },
  { section: 'travel', anchor: 'travel-mode', title: 'Travel mode & location', keywords: ['travel', 'walk', 'walking', 'bus', 'transit', 'drive', 'driving', 'journey', 'tfl', 'location', 'gps', 'map'] },
  { section: 'travel', anchor: 'home-address', title: 'Home address', keywords: ['home', 'address', 'postcode', 'head home', 'journey home', 'origin'] },
  { section: 'calendars', anchor: 'calendar-feed', title: 'Calendar feed', keywords: ['calendar', 'feed', 'subscribe', 'ics', 'google calendar', 'apple', 'outlook', 'url'] },
  { section: 'calendars', anchor: 'calendar-export', title: 'Calendar export', keywords: ['export', 'ics', 'download', 'calendar', 'file'] },
  { section: 'data', anchor: 'data-health', title: 'Data health', keywords: ['saved', 'storage', 'health', 'device', 'data', 'quota', 'space'] },
  { section: 'data', anchor: 'backup', title: 'Backup', keywords: ['backup', 'export', 'import', 'restore', 'file', 'device', 'json'] },
  { section: 'data', anchor: 'sync', title: 'Sync between devices', keywords: ['sync', 'device', 'devices', 'phone', 'laptop', 'code', 'encrypted'] },
  { section: 'appearance', anchor: 'theme', title: 'Theme', keywords: ['theme', 'dark', 'light', 'appearance', 'colour', 'color', 'system'] },
  { section: 'appearance', anchor: 'density', title: 'Density', keywords: ['density', 'compact', 'comfortable', 'spacing', 'appearance', 'size'] },
  { section: 'help', anchor: 'whats-new', title: "What's new", keywords: ['new', 'changelog', 'version', 'update', 'release'] },
  { section: 'help', anchor: 'install', title: 'Install the app', keywords: ['install', 'home screen', 'app', 'ios', 'android', 'add to'] },
]

const SEARCH_SYNONYMS: Record<string, string[]> = {
  address: ['home'],
  home: ['address'],
  backup: ['export'],
  export: ['backup'],
  sync: ['device'],
  device: ['sync'],
  devices: ['sync'],
  notification: ['reminder'],
  notifications: ['reminders', 'reminder'],
  reminder: ['notification'],
  reminders: ['notifications', 'notification'],
}

export function searchSettings(query: string): typeof SEARCH_ENTRIES {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return []
  const expanded = tokens.map((t) => [t, ...(SEARCH_SYNONYMS[t] ?? [])])
  return SEARCH_ENTRIES.filter((entry) => {
    const haystack = [entry.title, ...entry.keywords].join(' ').toLowerCase()
    return expanded.every((variants) => variants.some((v) => haystack.includes(v)))
  })
}

/** Stable in-page anchors that section links and Settings search can open. */
export type SettingsAnchor =
  | 'profiles'
  | 'key-dates-source'
  | 'notices'
  | 'specialisms'
  | 'key-date-reminders'
  | 'session-reminders'
  | 'quiet-hours'
  | 'leave-alerts'
  | 'background-push'
  | 'travel-mode'
  | 'home-address'
  | 'calendar-feed'
  | 'calendar-export'
  | 'data-health'
  | 'backup'
  | 'sync'
  | 'theme'
  | 'density'
  | 'whats-new'
  | 'install'

function focusAnchor(anchor: SettingsAnchor) {
  const el = document.getElementById(anchor)
  if (!el) return
  const heading = el.matches('h2, h3') ? el : el.querySelector<HTMLElement>('h3, h2')
  el.scrollIntoView({ block: 'start' })
  heading?.focus({ preventScroll: true })
}

export function SettingsSheet({
  section,
  onOpenSection,
  sources,
  exceptions,
  personalSessions,
  settings,
  store,
  courseSessions,
  keyDates,
  metaMap,
  todayISO,
  placementBlocks,
  onInstall,
  onUpdateSettings,
  onOpenStats,
  onOpenGroup,
  onOpenCourse,
  onRechooseSpecialisms,
  onSwitchProfile,
  onAddProfile,
  onDeleteProfile,
  onClose,
}: Props) {
  const [feedBase, setFeedBase] = useState(settings.icsFeedBase ?? DEFAULT_ICS_FEED_BASE)
  const [searchQuery, setSearchQuery] = useState('')
  const searchResults = searchSettings(searchQuery)
  // Section links (TT-21) and search results open a section through the
  // existing settings navigation, then focus the target heading once it has
  // rendered — no new route, so `#/settings/<section>` stays the only form.
  const pendingAnchor = useRef<SettingsAnchor | null>(null)
  const openAt = (target: SettingsSection, anchor: SettingsAnchor) => {
    if (target === section) {
      focusAnchor(anchor)
      return
    }
    pendingAnchor.current = anchor
    onOpenSection(target)
  }
  useEffect(() => {
    const anchor = pendingAnchor.current
    if (!anchor) return
    pendingAnchor.current = null
    focusAnchor(anchor)
  }, [section])
  // Local telemetry queue status (coarse counts only; nothing is sent here).
  const [telemetry, setTelemetry] = useState<{ openSegments: number; claimedSegments: number; dropped: number } | null>(null)
  useEffect(() => {
    let cancelled = false
    void telemetryPending().then((t) => {
      if (!cancelled) setTelemetry(t)
    })
    return () => {
      cancelled = true
    }
  }, [settings.usagePing])
  const [keyDatesUrl, setKeyDatesUrl] = useState(settings.keyDatesUrl ?? '')
  const [keyDatesError, setKeyDatesError] = useState(false)
  const [noticesUrl, setNoticesUrl] = useState(settings.noticesUrl ?? '')
  const [noticesError, setNoticesError] = useState(false)
  const [mergeUrl, setMergeUrl] = useState('')
  const [mergeError, setMergeError] = useState(false)
  const [pushBase, setPushBase] = useState(settings.pushServerBase ?? DEFAULT_PUSH_BASE)
  const [pushBusy, setPushBusy] = useState(false)
  const [pushMessage, setPushMessage] = useState<string | null>(null)
  const [checkRows, setCheckRows] = useState<CheckRow[] | null>(null)
  const [checkBusy, setCheckBusy] = useState(false)
  const [syncState, setSyncState] = useState<SyncState | null>(loadSyncState)
  const [syncInput, setSyncInput] = useState('')
  const [syncBusy, setSyncBusy] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const syncBase = settings.pushServerBase ?? DEFAULT_PUSH_BASE
  const [homeAddr, setHomeAddr] = useState(settings.homeAddress ?? '')
  const [homeGeoStatus, setHomeGeoStatus] = useState<'working' | 'ok' | 'fail' | null>(null)
  const [storageEstimate, setStorageEstimate] = useState<string | null>(null)
  const [backupOpen, setBackupOpen] = useState(false)
  const [restoreText, setRestoreText] = useState<string | null>(null)
  const [localFiles, setLocalFiles] = useState<{ photos: number; wallet: number } | null>(null)
  useEffect(() => {
    if (section !== 'data') return
    let live = true
    void Promise.all([readAttachments('photos'), readAttachments('wallet')])
      .then(([photos, wallet]) => {
        if (!live) return
        const mine = (owner: string) => owner.split('|')[0] === store.activeId
        setLocalFiles({ photos: photos.filter((p) => mine(p.owner)).length, wallet: wallet.filter((w) => mine(w.owner)).length })
      })
      .catch(() => live && setLocalFiles(null))
    return () => {
      live = false
    }
  }, [section, store.activeId])
  useEffect(() => {
    if (section !== 'data') return
    if (!navigator.storage?.estimate) {
      setStorageEstimate('Storage estimate unavailable — not reported by this browser')
      return
    }
    void navigator.storage
      .estimate()
      .then((e) => {
        const mb = (n?: number) => (n != null ? `${Math.round(n / 1048576)} MB` : '?')
        setStorageEstimate(`${mb(e.usage)} used of ~${mb(e.quota)} available (browser estimate, not a guarantee)`)
      })
      .catch(() => setStorageEstimate('Storage estimate unavailable — not reported by this browser'))
  }, [section])

  function saveHomeAddress() {
    const address = homeAddr.trim()
    if (!address) {
      setHomeGeoStatus(null)
      onUpdateSettings({ homeAddress: undefined, homeLat: undefined, homeLng: undefined })
      return
    }
    if (address === settings.homeAddress && settings.homeLat != null) return
    setHomeGeoStatus('working')
    void geocodeAddress(address).then((located) => {
      if (located) {
        onUpdateSettings({ homeAddress: address, homeLat: located.lat, homeLng: located.lng })
        setHomeGeoStatus('ok')
      } else {
        onUpdateSettings({ homeAddress: address, homeLat: undefined, homeLng: undefined })
        setHomeGeoStatus('fail')
      }
    })
  }

  async function enableSync() {
    setSyncBusy(true)
    setSyncMsg(null)
    try {
      const code = newSyncCode()
      const at = await pushSync(syncBase, code, { force: true })
      const state: SyncState = { code, lastAt: at ?? Date.now() }
      saveSyncState(state)
      setSyncState(state)
      setSyncMsg('Sync is on — enter this code on your other device to connect it.')
    } catch (err) {
      setSyncMsg(err instanceof Error ? err.message : 'Could not reach the sync server.')
    } finally {
      setSyncBusy(false)
    }
  }

  async function connectSync() {
    const code = syncInput.trim().toUpperCase()
    if (!code) return
    setSyncBusy(true)
    setSyncMsg(null)
    try {
      const remote = await pullSync(syncBase, code)
      if (!remote) {
        setSyncMsg('No synced data found for that code — check it and try again.')
        return
      }
      await applySyncPayload(remote.payload)
      // Park the merged result so the other device gets this one's notes too.
      const at = await pushSync(syncBase, code, { force: true }).catch(() => null)
      saveSyncState({ code, lastAt: at ?? remote.at })
      window.location.reload()
    } catch {
      setSyncMsg('Could not reach the sync server.')
    } finally {
      setSyncBusy(false)
    }
  }

  async function syncNow() {
    if (!syncState) return
    setSyncBusy(true)
    setSyncMsg(null)
    try {
      const at = await pushSync(syncBase, syncState.code, { force: true })
      if (at) {
        const next = { ...syncState, lastAt: at }
        saveSyncState(next)
        setSyncState(next)
      }
      setSyncMsg('Synced. ✓')
    } catch {
      setSyncMsg('Could not reach the sync server.')
    } finally {
      setSyncBusy(false)
    }
  }

  // Rotate: new code, park under it, delete the old blob — the old code stops working.
  async function rotateSyncCode() {
    if (!syncState) return
    setSyncBusy(true)
    setSyncMsg(null)
    try {
      const code = newSyncCode()
      const at = await pushSync(syncBase, code, { force: true })
      await deleteSync(syncBase, syncState.code)
      const next = { code, lastAt: at ?? Date.now() }
      saveSyncState(next)
      setSyncState(next)
      setSyncMsg('Code rotated — the old code no longer works. Enter the new one on your other devices.')
    } catch {
      setSyncMsg('Could not reach the sync server.')
    } finally {
      setSyncBusy(false)
    }
  }

  function disableSync() {
    clearSyncState()
    setSyncState(null)
    setSyncMsg('Sync is off on this device. The parked copy expires by itself after 90 days.')
  }

  async function handlePush(enable: boolean) {
    const base = pushBase.trim()
    if (enable && !base) return
    setPushBusy(true)
    setPushMessage(null)
    try {
      if (enable) {
        await subscribePush(base, settings, store.activeId, { force: true })
        onUpdateSettings({ pushServerBase: base, pushEnabled: true })
        setPushMessage('Background push enabled on this device. ✓')
      } else {
        await unsubscribePush(settings.pushServerBase ?? base)
        onUpdateSettings({ pushEnabled: false })
        setPushMessage('Background push disabled.')
      }
    } catch (err) {
      setPushMessage(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setPushBusy(false)
    }
  }
  const [copied, setCopied] = useState<'feed' | 'share' | null>(null)
  const importInput = useRef<HTMLInputElement | null>(null)
  const feedCopiedKey = `timetable.feedcopied.${store.activeId}`
  const [feedCopiedUrl, setFeedCopiedUrl] = useState<string | null>(() => {
    try {
      return localStorage.getItem(feedCopiedKey)
    } catch {
      return null
    }
  })

  function addMergeTab() {
    const trimmed = mergeUrl.trim()
    if (!trimmed) return
    const parsed = parseSheetUrl(trimmed)
    if (!parsed) {
      setMergeError(true)
      return
    }
    setMergeError(false)
    setMergeUrl('')
    onUpdateSettings({
      extraTabs: [...(settings.extraTabs ?? []), { sheetId: parsed.sheetId, gid: parsed.gid, url: trimmed }],
    })
  }

  function handleImportFile(file: File) {
    void (async () => {
      if (file.size > 50 * 1024 * 1024) throw new Error('Backup exceeds the 50 MB limit.')
      // Plain or encrypted — the restore sheet unlocks, validates and
      // previews before anything is committed (R5a).
      setRestoreText(await file.text())
    })().catch((error) => window.alert('Could not read that file: ' + String(error)))
  }

  // Attendance insights over eligible completed sessions — the same shared
  // definition Stats and the binder use (P3-06). The CSV keeps one row per
  // eligible completed session so its totals match the summary exactly.
  const attendance = attendanceSummary(courseSessions, (s) => metaMap[sessionKey(s)], todayISO)
  const pastSessions = courseSessions.filter(
    (s) => isEligibleSession(s) && isCompleted(s, todayISO)
  )
  const bySubject = new Map<string, { attended: number; total: number }>()
  for (const s of pastSessions) {
    const key = s.subject || s.title
    const entry = bySubject.get(key) ?? { attended: 0, total: 0 }
    entry.total++
    if (metaMap[sessionKey(s)]?.attended) entry.attended++
    bySubject.set(key, entry)
  }
  const subjectRows = [...bySubject.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 8)

  function downloadAttendanceCSV() {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`
    const rows = ['Date,Start,Title,Subject,Room,Attended,Absent,Reason,Note']
    for (const s of pastSessions) {
      const m = metaMap[sessionKey(s)]
      rows.push(
        [
          s.dateISO,
          s.start,
          esc(s.title),
          esc(s.subject || s.title),
          esc(s.room),
          m?.attended ? 'yes' : 'no',
          m?.absent ? 'yes' : 'no',
          esc(m?.absentReason ?? ''),
          esc(m?.note ?? ''),
        ].join(',')
      )
    }
    downloadFile('attendance.csv', rows.join('\r\n'), 'text/csv;charset=utf-8')
  }

  // Placement day log: one row per school day per block with provenance
  // (P5-03) — planned vs logged, exception kind, inferred/corrected flags.
  function downloadPlacementLog() {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`
    const rows = [
      'Date,Block,School,Planned mins,Logged mins,Provenance,Exception,Inferred,Attended,Absent,Reason,Note',
    ]
    const blocks = computePlacementBlocks(courseSessions, exceptions, settings, (s) => metaMap[sessionKey(s)])
    for (const b of blocks) {
      const school = (settings.placements ?? {})[b.tag]?.school ?? ''
      for (const d of b.days) {
        const meta = courseSessions
          .filter((s) => !s.isKeyDate && isPlacementSession(s) && placementTag(s.title) === b.tag && s.dateISO === d.dateISO)
          .map((s) => metaMap[sessionKey(s)])
          .find(Boolean)
        rows.push(
          [
            d.dateISO,
            b.tag,
            esc(school),
            String(d.plannedMins),
            d.loggedMins === null ? '' : String(d.loggedMins),
            d.loggedFrom === 'correction' ? 'corrected entry' : d.loggedFrom === 'day-tick' ? 'whole-day tick' : 'unrecorded',
            d.exception ? d.exception.kind : '',
            d.inferred ? 'inferred from timetable' : 'from sheet row',
            d.attended ? 'yes' : 'no',
            d.absent ? 'yes' : 'no',
            esc(meta?.absentReason ?? ''),
            esc(d.exception?.note ?? meta?.note ?? ''),
          ].join(',')
        )
      }
    }
    downloadFile('placement-day-log.csv', rows.join('\r\n'), 'text/csv;charset=utf-8')
  }

  function saveKeyDatesUrl() {
    const trimmed = keyDatesUrl.trim()
    if (!trimmed) {
      setKeyDatesError(false)
      onUpdateSettings({ keyDatesUrl: undefined, keyDatesSheetId: undefined, keyDatesGid: undefined })
      return
    }
    const parsed = parseSheetUrl(trimmed)
    if (!parsed) {
      setKeyDatesError(true)
      return
    }
    setKeyDatesError(false)
    onUpdateSettings({ keyDatesUrl: trimmed, keyDatesSheetId: parsed.sheetId, keyDatesGid: parsed.gid })
  }

  function saveNoticesUrl() {
    const trimmed = noticesUrl.trim()
    if (!trimmed) {
      setNoticesError(false)
      onUpdateSettings({ noticesUrl: undefined, noticesSheetId: undefined, noticesGid: undefined })
      return
    }
    const parsed = parseSheetUrl(trimmed)
    if (!parsed) {
      setNoticesError(true)
      return
    }
    setNoticesError(false)
    onUpdateSettings({ noticesUrl: trimmed, noticesSheetId: parsed.sheetId, noticesGid: parsed.gid })
  }

  const activeProfile = store.profiles.find((p) => p.id === store.activeId)

  async function copy(text: string, which: 'feed' | 'share') {
    if (which === 'feed') {
      // Remember what was copied so we can flag when filters/placements change the URL.
      try {
        localStorage.setItem(feedCopiedKey, text)
      } catch {
        /* ignore */
      }
      setFeedCopiedUrl(text)
    }
    try {
      await navigator.clipboard.writeText(text)
      setCopied(which)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      try {
        window.prompt('Copy this link:', text)
      } catch {
        /* dialogs unavailable — the URL is shown above the button anyway */
      }
    }
  }

  function handleDelete() {
    if (!activeProfile) return
    if (window.confirm(`Remove "${activeProfile.name}"? Its saved filters and notes are cleared on this device.`)) {
      onDeleteProfile(activeProfile.id)
    }
  }

  async function toggleOffset(field: 'reminderOffsets' | 'leaveAlertOffsets' | 'keyDateReminderDays', mins: number) {
    const current = settings[field] ?? []
    const next = current.includes(mins)
      ? current.filter((m) => m !== mins)
      : [...current, mins].sort((a, b) => a - b)
    if (next.length > 0 && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      await Notification.requestPermission()
    }
    onUpdateSettings({ [field]: next })
  }

  function toggleLocation(enabled: boolean) {
    if (enabled && 'geolocation' in navigator) {
      // Poke once so the permission prompt appears while the user is looking at the toggle.
      navigator.geolocation.getCurrentPosition(
        () => {},
        () => {}
      )
    }
    onUpdateSettings({ locationEnabled: enabled })
  }

  const notifBlocked = typeof Notification !== 'undefined' && Notification.permission === 'denied'
  const feedUrl = !settings.demo
    ? buildFeedUrl(settings.icsFeedBase ?? DEFAULT_ICS_FEED_BASE, settings, activeProfile?.name)
    : null

  const CATEGORIES: { id: SettingsSection; title: string; hint: string }[] = [
    { id: 'timetable', title: 'My timetable', hint: 'Profiles, sources, notices, specialisms, study group' },
    { id: 'reminders', title: 'Reminders', hint: 'Notification offsets, quiet hours, background push' },
    { id: 'travel', title: 'Travel & home', hint: 'Location, mode, home address, placements' },
    { id: 'calendars', title: 'Connected calendars', hint: 'Subscribed feed, .ics export, what they contain' },
    { id: 'data', title: 'Data & devices', hint: 'Save state, sync, backup, exports, storage' },
    { id: 'appearance', title: 'Appearance', hint: 'Theme and density' },
    { id: 'help', title: 'Help & privacy', hint: 'What’s new, install, usage ping, support' },
  ]

  if (!section) {
    return (
      <div className="page page-settings">
        <PageHeader
          title="Settings"
          subtitle={activeProfile?.name}
          actions={
            <button type="button" className="btn-ghost" onClick={onClose}>
              Done
            </button>
          }
        />
        {store.profiles.length > 1 && (
          <p className="filter-hint settings-profile-line">
            Showing settings for <strong>{activeProfile?.name}</strong>.{' '}
            <button type="button" className="travel-link" onClick={() => openAt('timetable', 'profiles')}>
              Switch timetable
            </button>
          </p>
        )}
        <div className="searchbar settings-search">
          <input
            type="search"
            aria-label="Search settings"
            placeholder="Search settings (e.g. address, backup)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        {searchQuery.trim() && (
          <ul className="settings-index settings-results" aria-label="Search results">
            {searchResults.length === 0 && (
              <li className="filter-hint settings-no-results">Nothing matches “{searchQuery.trim()}” — try another word, or browse the categories below.</li>
            )}
            {searchResults.map((r) => (
              <li key={r.anchor}>
                <button type="button" className="settings-index-row" onClick={() => openAt(r.section, r.anchor)}>
                  <span className="settings-index-title">{r.title}</span>
                  <span className="filter-hint">{CATEGORIES.find((c) => c.id === r.section)?.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <ul className="settings-index">
          {CATEGORIES.map((c) => (
            <li key={c.id}>
              <button type="button" className="settings-index-row" onClick={() => onOpenSection(c.id)}>
                <span className="settings-index-title">{c.title}</span>
                <span className="filter-hint">{c.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  const title = CATEGORIES.find((c) => c.id === section)?.title ?? 'Settings'
  return (
    <div className="page page-settings">
      <button type="button" className="page-back" onClick={onClose}>
        <IconBack size={18} /> Settings
      </button>
      <PageHeader title={title} />
      <div className="settings-body">
      {section === 'timetable' && (
        <>

        <section className="filter-section" id="profiles">
          <h3 tabIndex={-1}>Timetables</h3>
          <div className="chip-grid">
            {store.profiles.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`chip${p.id === store.activeId ? ' chip-on' : ''}`}
                onClick={() => onSwitchProfile(p.id)}
              >
                {p.name}
              </button>
            ))}
          </div>
          <div className="btn-row">
            <button type="button" className="btn-secondary" onClick={onAddProfile}>
              Add another timetable
            </button>
            <button type="button" className="btn-secondary" onClick={handleDelete}>
              Remove this one
            </button>
          </div>
          {settings.demo ? (
            <p className="filter-hint">This timetable uses built-in demo data.</p>
          ) : (
            <p className="settings-url" title={settings.sheetUrl}>
              {settings.sheetUrl}
            </p>
          )}
          {!settings.demo && (
            <>
              {(settings.extraTabs ?? []).map((tab, i) => (
                <div className="merged-tab" key={`${tab.sheetId}-${tab.gid}-${i}`}>
                  <span className="settings-url">merged: {tab.url}</span>
                  <button
                    type="button"
                    className="btn-icon"
                    aria-label="Remove merged tab"
                    onClick={() =>
                      onUpdateSettings({ extraTabs: (settings.extraTabs ?? []).filter((_, j) => j !== i) })
                    }
                  >
                    ✕
                  </button>
                </div>
              ))}
              <div className="feed-row">
                <input
                  type="url"
                  placeholder="Merge another tab: paste its URL (with #gid=…)"
                  value={mergeUrl}
                  onChange={(e) => setMergeUrl(e.target.value)}
                />
              </div>
              {mergeError && <p className="setup-error">That doesn’t look like a Google Sheets link.</p>}
              <button type="button" className="btn-secondary" onClick={addMergeTab} disabled={!mergeUrl.trim()}>
                Merge tab into this timetable
              </button>
            </>
          )}
        </section>


        {!settings.demo && (
          <section className="filter-section">
            <h3>Share this setup</h3>
            <p className="filter-hint">
              Sends someone a link that opens the app already configured with this sheet and your
              specialism/group choices.
            </p>
            <button type="button" className="btn-secondary" onClick={() => copy(buildShareUrl(settings), 'share')}>
              {copied === 'share' ? 'Copied!' : 'Copy share link'}
            </button>
          </section>
        )}


        {!settings.demo && (
          <section className="filter-section" id="key-dates-source">
            <h3 tabIndex={-1}>Key dates</h3>
            <p className="filter-hint">
              Paste the link to the submissions/key-dates tab (open that tab so the URL contains its
              gid). Upcoming deadlines get a countdown strip on the day view.
            </p>
            <div className="feed-row">
              <input
                type="url"
                placeholder="https://docs.google.com/spreadsheets/d/…#gid=…"
                value={keyDatesUrl}
                onChange={(e) => setKeyDatesUrl(e.target.value)}
                onBlur={saveKeyDatesUrl}
              />
            </div>
            {keyDatesError && <p className="setup-error">That doesn’t look like a Google Sheets link.</p>}
            {settings.keyDatesSheetId && !keyDatesError && (
              <p className="filter-hint">Key dates connected — they refresh with the timetable.</p>
            )}
            {settings.keyDatesSheetId && (
              <p className="filter-hint">
                {/* Reminder timing lives with the other reminder settings (TT-21). */}
                <button type="button" className="travel-link" onClick={() => openAt('reminders', 'key-date-reminders')}>
                  Configure key-date reminders →
                </button>
              </p>
            )}
          </section>
        )}


        {!settings.demo && (
          <section className="filter-section" id="notices">
            <h3 tabIndex={-1}>Notices (cohort broadcasts)</h3>
            <p className="filter-hint">
              A tab with Date / Message / Link columns becomes dismissible announcement banners for
              everyone using that sheet. Background delivery uses the push worker.
            </p>
            <div className="feed-row">
              <input
                type="url"
                placeholder="https://docs.google.com/spreadsheets/d/…#gid=…"
                value={noticesUrl}
                onChange={(e) => setNoticesUrl(e.target.value)}
                onBlur={saveNoticesUrl}
              />
            </div>
            {noticesError && <p className="setup-error">That doesn’t look like a Google Sheets link.</p>}
            {settings.noticesSheetId && !noticesError && (
              <p className="filter-hint">Notices connected — new rows appear as banners on the day view.</p>
            )}
          </section>
        )}


        <section className="filter-section" id="specialisms">
          <h3 tabIndex={-1}>Specialisms</h3>
          <p className="filter-hint">
            {(settings.mySpecialisms ?? []).length > 0
              ? `Showing: ${(settings.mySpecialisms ?? []).join(', ')}`
              : 'Showing all specialisms.'}
          </p>
          <button type="button" className="btn-secondary" onClick={onRechooseSpecialisms}>
            Choose specialisms again
          </button>
        </section>


        <section className="filter-section">
          <h3>Term start (week numbers)</h3>
          <p className="filter-hint">Set the first day of term to show "Wk N" labels on days and weeks.</p>
          <input
            type="date"
            className="date-input"
            value={settings.termStartISO ?? ''}
            onChange={(e) => onUpdateSettings({ termStartISO: e.target.value || undefined })}
          />
        </section>


        <section className="filter-section">
          <h3>Course</h3>
          <p className="filter-hint">
            {activeCourse().name} · timezone {courseZone()} — campus, buildings, terminology and
            sections come from the course configuration; import a template or set up another
            course without touching your personal data.
          </p>
          <button type="button" className="btn-secondary" onClick={onOpenCourse}>
            🎓 Course setup
          </button>
        </section>

        <section className="filter-section">
          <h3>Study group</h3>
          <p className="filter-hint">
            {settings.groupCode
              ? `In group ${settings.groupCode} as ${settings.groupName}.`
              : 'Find common free slots with coursemates by sharing a code.'}
          </p>
          <button type="button" className="btn-secondary" onClick={onOpenGroup}>
            👥 {settings.groupCode ? 'Open study group' : 'Set up a study group'}
          </button>
        </section>

        </>
      )}
      {section === 'reminders' && (
        <>

        <section className="filter-section">
          <h3>Notifications at a glance</h3>
          <ul className="notif-overview">
            {(
              [
                ['Session reminders', (settings.reminderOffsets ?? []).length > 0 ? (settings.reminderOffsets ?? []).map((m) => (m >= 60 ? `${m / 60}h` : `${m}m`)).join(', ') + ' before' : 'off'],
                ['“Did you attend?” prompts', settings.attendancePrompts ? 'at each session’s end' : 'off'],
                ['Leave alerts', (settings.leaveAlertOffsets ?? []).length > 0 && settings.locationEnabled ? 'on' : 'off'],
                ['Key-date reminders', (settings.keyDateReminderDays ?? []).length > 0 ? (settings.keyDateReminderDays ?? []).join('/') + ' days before' : 'off'],
                ['Morning briefing (07:00) & week ahead (Sun)', settings.pushEnabled ? (settings.morningBriefing !== false ? 'on' : 'off') : 'needs background push'],
                ['Timetable changes & cohort notices', settings.pushEnabled ? (settings.changeAlerts !== false ? 'on' : 'off') : 'needs background push'],
              ] as const
            ).map(([label, state]) => (
              <li key={label}>
                <span>{label}</span>
                <span className={`notif-state${state === 'off' ? ' off' : ''}`}>{state}</span>
              </li>
            ))}
          </ul>
          <h3 className="subheading" id="quiet-hours" tabIndex={-1}>Quiet hours</h3>
          <p className="filter-hint">No notifications during these hours (in-app and push).</p>
          <div className="chip-grid">
            {(
              [
                { label: 'Off', from: undefined, to: undefined },
                { label: '21:00–07:00', from: 21, to: 7 },
                { label: '22:00–07:00', from: 22, to: 7 },
                { label: '23:00–08:00', from: 23, to: 8 },
              ] as const
            ).map(({ label, from, to }) => {
              const on = settings.quietFrom === from && settings.quietTo === to
              return (
                <button
                  key={label}
                  type="button"
                  className={`chip${on ? ' chip-on' : ''}`}
                  aria-pressed={on}
                  onClick={() => {
                    onUpdateSettings({ quietFrom: from, quietTo: to })
                    if (settings.pushEnabled) {
                      void subscribePush(settings.pushServerBase ?? DEFAULT_PUSH_BASE, {
                        ...settings,
                        quietFrom: from,
                        quietTo: to,
                      }, store.activeId).catch(() => {})
                    }
                  }}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </section>


        <section className="filter-section" id="session-reminders">
          <h3 tabIndex={-1}>Session reminders</h3>
          <p className="filter-hint">
            Pick as many as you like — e.g. 1 hour and 15 min gives two notifications before each
            session. Select none to turn reminders off.
          </p>
          <div className="chip-grid">
            {REMINDER_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                className={`chip${(settings.reminderOffsets ?? []).includes(value) ? ' chip-on' : ''}`}
                aria-pressed={(settings.reminderOffsets ?? []).includes(value)}
                onClick={() => void toggleOffset('reminderOffsets', value)}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="filter-hint">
            {notifBlocked
              ? 'Notifications are blocked for this site — allow them in your browser settings.'
              : (settings.reminderOffsets ?? []).length === 0
                ? 'Reminders are off.'
                : `Notifying ${(settings.reminderOffsets ?? []).map((m) => (m >= 60 ? `${m / 60}h` : `${m}m`)).join(', ')} before each session, while the app is open (or installed and running). For guaranteed alerts anywhere, subscribe to the calendar feed below and use your calendar app’s own reminders.`}
          </p>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={settings.attendancePrompts === true}
              onChange={(e) => {
                const next = e.target.checked
                if (next && typeof Notification !== 'undefined' && Notification.permission === 'default') {
                  void Notification.requestPermission()
                }
                onUpdateSettings({ attendancePrompts: next })
                if (settings.pushEnabled) {
                  void subscribePush(settings.pushServerBase ?? DEFAULT_PUSH_BASE, {
                    ...settings,
                    attendancePrompts: next,
                  }, store.activeId).catch(() => {})
                }
              }}
            />
            Ask “did you attend?” when each session ends
          </label>
          <p className="filter-hint">
            Answer with ✓ Attended or ✗ Absent on the notification, or tap it to answer in the app
            (a card on Today offers the same two answers for a session that just ended). A session
            you have already answered is never asked. Works in the background too when push is enabled.
          </p>
        </section>


        <section className="filter-section" id="key-date-reminders" aria-labelledby="key-date-reminders-heading">
          <h3 id="key-date-reminders-heading" tabIndex={-1}>Key-date reminders</h3>
          {settings.keyDatesSheetId ? (
            <>
              <p className="filter-hint">
                Deadlines from your key-dates tab. Pick as many as you like; select none to turn them off.
              </p>
              <div className="chip-grid" role="group" aria-label="Days before each key date">
                {KEY_DATE_REMINDER_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    className={`chip${(settings.keyDateReminderDays ?? []).includes(value) ? ' chip-on' : ''}`}
                    aria-pressed={(settings.keyDateReminderDays ?? []).includes(value)}
                    onClick={() => void toggleOffset('keyDateReminderDays', value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="filter-hint">
                {notifBlocked
                  ? 'Notifications are blocked for this site — allow them in your browser settings.'
                  : (settings.keyDateReminderDays ?? []).length === 0
                    ? 'Key-date reminders are off.'
                    : `Notifying ${(settings.keyDateReminderDays ?? []).map((d) => `${d} day${d === 1 ? '' : 's'}`).join(', ')} before each deadline while the app is open (or installed and running)${settings.pushEnabled ? ', and in the background through push' : ''}. A selected timing is not a delivery guarantee — for alerts anywhere, use your calendar app’s own reminders on the subscribed feed.`}
              </p>
            </>
          ) : (
            <>
              <p className="filter-hint">
                These need a connected submissions/key-dates tab — none is connected for this timetable yet.
              </p>
              <button type="button" className="travel-link" onClick={() => openAt('timetable', 'key-dates-source')}>
                Connect key dates →
              </button>
            </>
          )}
        </section>


        <section className="filter-section" id="leave-alerts">
          <h3 tabIndex={-1}>Leave alerts</h3>
          <p className="filter-hint">
            Notifies you when it's time to set off: session start minus your live travel estimate,
            with the head start you pick (e.g. "10 min" alerts 10 minutes before you need to leave).
            Nothing is sent when you are already at the session's location.
          </p>
          {settings.locationEnabled ? (
            <div className="chip-grid">
              {(
                [
                  { value: 0, label: 'When it’s time to leave' },
                  { value: 5, label: '5 min head start' },
                  { value: 10, label: '10 min' },
                  { value: 15, label: '15 min' },
                  { value: 30, label: '30 min' },
                ] as const
              ).map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  className={`chip${(settings.leaveAlertOffsets ?? []).includes(value) ? ' chip-on' : ''}`}
                  aria-pressed={(settings.leaveAlertOffsets ?? []).includes(value)}
                  onClick={() => void toggleOffset('leaveAlertOffsets', value)}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : (
            <p className="filter-hint">Enable travel times above first — leave alerts need your location.</p>
          )}
          {settings.locationEnabled && (settings.leaveAlertOffsets ?? []).length === 0 && (
            <p className="filter-hint">Leave alerts are off.</p>
          )}
        </section>


        {!settings.demo && (
          <section className="filter-section" id="background-push">
            <h3 tabIndex={-1}>Background push (works with the app closed)</h3>
            <p className="filter-hint">
              Session and key-date reminders arrive even when the app isn't open. The push server is
              already deployed — just tap Enable (the URL below only needs changing for a different
              deployment).
            </p>
            {needsIosInstall() && !settings.pushEnabled ? (
              <div className="ios-install-guide">
                <p className="filter-hint">
                  <strong>On iPhone/iPad, notifications need the app on your Home Screen first:</strong>
                </p>
                <ol className="ios-install-steps">
                  <li>
                    Tap the <strong>Share</strong> button in Safari's toolbar
                  </li>
                  <li>
                    Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>
                  </li>
                  <li>Open My Timetable from your Home Screen and tap Enable here</li>
                </ol>
              </div>
            ) : (
              <>
                <div className="feed-row">
                  <input
                    type="url"
                    placeholder="https://timetable-push.<you>.workers.dev"
                    value={pushBase}
                    onChange={(e) => setPushBase(e.target.value)}
                  />
                </div>
                <div className="btn-row">
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={pushBusy || !pushBase.trim() || settings.pushEnabled}
                    onClick={() => void handlePush(true)}
                  >
                    {pushBusy ? 'Working…' : settings.pushEnabled ? 'Enabled ✓' : 'Enable on this device'}
                  </button>
                  {settings.pushEnabled && (
                    <button type="button" className="btn-secondary" disabled={pushBusy} onClick={() => void handlePush(false)}>
                      Disable
                    </button>
                  )}
                </div>
              </>
            )}
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={settings.morningBriefing !== false}
                onChange={(e) => {
                  const next = e.target.checked
                  onUpdateSettings({ morningBriefing: next })
                  if (settings.pushEnabled) {
                    // re-sync the server-side config with the new preference
                    void subscribePush(settings.pushServerBase ?? DEFAULT_PUSH_BASE, {
                      ...settings,
                      morningBriefing: next,
                    }, store.activeId).catch(() => {})
                  }
                }}
              />
              07:00 morning briefing (first session, weather, next deadline)
            </label>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={settings.changeAlerts !== false}
                onChange={(e) => {
                  const next = e.target.checked
                  onUpdateSettings({ changeAlerts: next })
                  if (settings.pushEnabled) {
                    void subscribePush(settings.pushServerBase ?? DEFAULT_PUSH_BASE, {
                      ...settings,
                      changeAlerts: next,
                    }, store.activeId).catch(() => {})
                  }
                }}
              />
              Push timetable changes (rooms, times, added/cancelled sessions)
            </label>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={settings.fridayDigest !== false}
                onChange={(e) => {
                  const next = e.target.checked
                  onUpdateSettings({ fridayDigest: next })
                  if (settings.pushEnabled) {
                    void subscribePush(settings.pushServerBase ?? DEFAULT_PUSH_BASE, { ...settings, fridayDigest: next }, store.activeId).catch(() => {})
                  }
                }}
              />
              Friday admin digest (open targets, mentor actions, missing reflection)
            </label>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={settings.bgLeaveAlerts === true}
                onChange={(e) => {
                  const next = e.target.checked
                  onUpdateSettings({ bgLeaveAlerts: next })
                  if (settings.pushEnabled) {
                    void subscribePush(settings.pushServerBase ?? DEFAULT_PUSH_BASE, {
                      ...settings,
                      bgLeaveAlerts: next,
                    }, store.activeId).catch(() => {})
                  }
                }}
              />
              Background leave alerts (uses your last app-open location)
            </label>
            {settings.bgLeaveAlerts && (
              <p className="filter-hint">
                {!settings.locationEnabled
                  ? 'Enable travel times above so the app can capture your location while open.'
                  : (settings.leaveAlertOffsets ?? []).length === 0
                    ? 'Pick head starts under Leave alerts above — they set when these fire.'
                    : 'The location captured while the app is open is stored in your own push worker and used to compute “time to leave” pushes with the app closed. Alerts say how old the location is when it isn’t fresh.'}
              </p>
            )}
            <div className="btn-row">
              <button
                type="button"
                className="btn-secondary"
                disabled={checkBusy}
                onClick={() => {
                  setCheckBusy(true)
                  void runPushSelfCheck(pushBase.trim() || DEFAULT_PUSH_BASE).then((rows) => {
                    setCheckRows(rows)
                    setCheckBusy(false)
                  })
                }}
              >
                {checkBusy ? 'Checking…' : '🩺 Run self-check'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  void sendTestPush(pushBase.trim() || DEFAULT_PUSH_BASE).then(setPushMessage)
                }}
              >
                Send test to this device
              </button>
            </div>
            {checkRows && (
              <ul className="check-list">
                {checkRows.map((r) => (
                  <li key={r.label} className={r.ok ? 'check-ok' : 'check-bad'}>
                    {r.ok ? '✓' : '✗'} {r.label}
                    {r.detail ? ` — ${r.detail}` : ''}
                  </li>
                ))}
              </ul>
            )}
            {pushMessage && <p className="filter-hint">{pushMessage}</p>}
          </section>
        )}

        </>
      )}
      {section === 'travel' && (
        <>

        <section className="filter-section" id="travel-mode">
          <h3 tabIndex={-1}>Travel times</h3>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={settings.locationEnabled ?? false}
              onChange={(e) => toggleLocation(e.target.checked)}
            />
            Use my location for travel times
          </label>
          <div className="chip-grid">
            {(
              [
                { value: 'walking', label: '🚶 Walking' },
                { value: 'transit', label: '🚌 Public transport' },
                { value: 'driving', label: '🚗 Driving' },
              ] as const
            ).map(({ value, label }) => (
              <button
                key={value}
                type="button"
                className={`chip${(settings.travelMode ?? 'walking') === value ? ' chip-on' : ''}`}
                aria-pressed={(settings.travelMode ?? 'walking') === value}
                onClick={() => onUpdateSettings({ travelMode: value })}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="filter-hint">
            Shows an estimated journey from where you are to each session's UCL building, on the
            timetable cards and in session details (rooms are matched against the Bloomsbury
            campus). Estimates are approximate — the Directions link gives the exact route. Your
            location and destination are sent to TfL for transit routes; map areas are requested from
            OpenStreetMap. Background leave alerts additionally store your last app-open location
            in the push worker.
          </p>
          <h3 className="subheading" id="home-address" tabIndex={-1}>Home</h3>
          <div className="feed-row">
            <input
              type="text"
              placeholder="Home address / postcode"
              aria-label="Home address"
              value={homeAddr}
              onChange={(e) => setHomeAddr(e.target.value)}
              onBlur={saveHomeAddress}
            />
          </div>
          {homeGeoStatus === 'working' && <p className="filter-hint">📍 Locating home…</p>}
          {homeGeoStatus === 'fail' && (
            <p className="filter-hint">Couldn't locate that address — try adding the postcode.</p>
          )}
          {(homeGeoStatus === 'ok' || (homeGeoStatus === null && settings.homeLat != null)) && (
            <p className="filter-hint">📍 Home set — a "🏠 Head home" card shows whenever you're away from home.</p>
          )}
          <p className="filter-hint">
            The card shows the live journey home — time, TfL route and arrival estimate — any time
            you're out (it hides itself when you're home). Address lookup sends the postcode to
            postcodes.io or the address to OpenStreetMap Nominatim. Home coordinates are used in
            TfL and map requests. Saved home settings are included in encrypted sync and backups.
          </p>
        </section>


        {(placementBlocks.length > 0 || Object.keys(settings.placements ?? {}).length > 0) && (
          <section className="filter-section">
            <h3>Placements</h3>
            <p className="filter-hint">
              {placementBlocks.length > 0
                ? `${placementBlocks.reduce((n, b) => n + b.attended, 0)} school day${
                    placementBlocks.reduce((n, b) => n + b.attended, 0) === 1 ? '' : 's'
                  } logged${settings.placementTargetDays ? ` of ${settings.placementTargetDays} required` : ''} (${placementBlocks
                    .map((b) => `${b.tag} ${b.attended}/${b.total}`)
                    .join(' · ')}). Tick “Attended” on a placement day to log it.`
                : 'No placement blocks detected in this timetable yet.'}
            </p>
            <label className="toggle-row placement-target-row">
              Required school days for the course
              <input
                type="number"
                className="date-input placement-target"
                min={0}
                max={999}
                placeholder="e.g. 120"
                value={settings.placementTargetDays ?? ''}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10)
                  onUpdateSettings({ placementTargetDays: Number.isFinite(n) && n > 0 ? n : undefined })
                }}
              />
            </label>
            <button
              type="button"
              className="btn-secondary"
              disabled={placementBlocks.length === 0}
              onClick={downloadPlacementLog}
            >
              Export placement day log (CSV)
            </button>
          </section>
        )}

        </>
      )}
      {section === 'calendars' && (
        <>

        <section className="filter-section" id="calendar-feed">
          <h3 tabIndex={-1}>Calendar feed (stays in sync)</h3>
          {settings.demo ? (
            <p className="filter-hint">Load a real sheet to use the calendar feed.</p>
          ) : (
            <>
              <p className="filter-hint">
                Add the feed URL below to your calendar app ("subscribe by URL" / "from internet")
                and it stays in sync with the sheet — sessions, your specialism choices, and key
                dates included.
              </p>
              <div className="feed-row">
                <input
                  type="url"
                  placeholder="https://timetable-ics.<you>.workers.dev"
                  value={feedBase}
                  onChange={(e) => setFeedBase(e.target.value)}
                  onBlur={() => onUpdateSettings({ icsFeedBase: feedBase.trim() || undefined })}
                />
              </div>
              {feedUrl && (
                <>
                  <p className="settings-url">{feedUrl}</p>
                  {feedCopiedUrl && feedCopiedUrl !== feedUrl && (
                    <p className="filter-hint feed-stale">
                      ⚠ Your feed URL has changed since you last copied it (filters or placement
                      details changed) — re-copy it and update the subscription in your calendar app.
                    </p>
                  )}
                  <button type="button" className="btn-secondary" onClick={() => copy(feedUrl, 'feed')}>
                    {copied === 'feed' ? 'Copied!' : 'Copy feed URL'}
                  </button>
                </>
              )}
            </>
          )}
        </section>


        <section className="filter-section" id="calendar-export">
          <h3 tabIndex={-1}>Calendar export</h3>
          <p className="filter-hint">
            Downloads your timetable — your groups and specialisms, all dates, regardless of
            display filters ({courseSessions.length} sessions
            {keyDates.length > 0 ? ` + ${keyDates.length} key dates` : ''}) as an .ics file you can
            import into Google, Apple or Outlook calendars. Key dates export as all-day 📌 events.
          </p>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={settings.includePersonalInExport === true}
              onChange={(e) => onUpdateSettings({ includePersonalInExport: e.target.checked })}
            />
            Include personal events ({personalSessions.length}) in the download
          </label>
          <p className="filter-hint">
            Personal events only ever leave this device in this file when you tick the box — the
            subscribed public feed never contains them.
          </p>
          <button
            type="button"
            className="btn-secondary"
            disabled={courseSessions.length === 0 && keyDates.length === 0 && personalSessions.length === 0}
            onClick={() => {
              downloadICS(
                [
                  ...courseSessions,
                  ...(settings.includePersonalInExport ? personalSessions : []),
                  ...keyDates,
                ],
                'My Timetable'
              )
              // A4: the .ics artifact was generated and handed to the browser.
              telemetryTrack('export_prepared')
            }}
          >
            Download .ics file
          </button>
        </section>

        </>
      )}
      {section === 'data' && (
        <>
        <section className="filter-section" id="data-health">
          <h3 tabIndex={-1}>Data health</h3>
          <ul className="notif-overview" aria-label="Data health">
            <li>
              <span>Saved on this device</span>
              <span className={`notif-state${hasPendingSaves() || persistenceFailure() ? ' warn' : ''}`}>
                {hasPendingSaves()
                  ? 'changes are waiting to save — keep this tab open'
                  : persistenceFailure()
                    ? `last save failed: ${persistenceFailure()}`
                    : 'all changes written to this device'}
              </span>
            </li>
            <li>
              <span>Synced records</span>
              <span className={`notif-state${syncState ? '' : ' off'}`}>
                {syncState
                  ? `at ${new Date(syncState.lastAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} — records only, never photos or documents`
                  : 'off (this device only)'}
              </span>
            </li>
            <li>
              <span>Photos & documents</span>
              <span className="notif-state">
                {localFiles
                  ? `${localFiles.photos} photo${localFiles.photos === 1 ? '' : 's'}, ${localFiles.wallet} document${localFiles.wallet === 1 ? '' : 's'} on this device only — not part of sync; move them with a backup`
                  : 'on this device only — not part of sync'}
              </span>
            </li>
            <li>
              <span>Last backup generated</span>
              <span className={`notif-state${lastBackupAt() ? '' : ' warn'}`}>
                {lastBackupAt()
                  ? `${new Date(lastBackupAt()!).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} — generated here; only you can confirm the file was kept`
                  : 'never on this device'}
              </span>
            </li>
            <li>
              <span>Recoverable drafts</span>
              <span className="notif-state">
                {(() => {
                  const n = listDrafts(store.activeId).length
                  return n === 0 ? 'none' : `${n} unsaved draft${n === 1 ? '' : 's'} kept on this device — reopen the record to continue`
                })()}
              </span>
            </li>
            {sources.map((src) => (
              <li key={src.id}>
                <span>{src.label} source</span>
                <span className={`notif-state${src.status !== 'ok' ? ' warn' : ''}`}>
                  {src.status === 'ok'
                    ? `updated ${src.lastSuccessAt ? new Date(src.lastSuccessAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : 'this session'}`
                    : src.status === 'stale'
                      ? 'showing last saved rows'
                      : 'not loading'}
                </span>
              </li>
            ))}
            <li>
              <span>Storage</span>
              <span className="notif-state">{storageEstimate ?? '…'}</span>
            </li>
          </ul>
          <p className="filter-hint">
            A downloaded backup is only safe once you can see the file where you saved it — the
            download prompt alone is not proof it was kept.
          </p>
        </section>

        {attendance.eligible > 0 && (
          <section className="filter-section">
            <h3>Attendance</h3>
            <p className="attendance-headline" aria-label={`${attendance.attendedPct}% attended`}>
              {attendance.attendedPct}%
            </p>
            <p className="filter-hint">
              {attendance.sentence} Unrecorded sessions are not absences.
            </p>
            {subjectRows.length > 0 && (
              <ul className="attendance-list">
                {subjectRows.map(([subject, { attended, total }]) => (
                  <li key={subject}>
                    <span className="attendance-subject">{subject}</span>
                    <span className="attendance-count">
                      {attended}/{total} · {Math.round((attended / total) * 100)}%
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="btn-row">
              <button type="button" className="btn-secondary" onClick={onOpenStats}>
                📊 Term stats
              </button>
              <button type="button" className="btn-secondary" onClick={downloadAttendanceCSV}>
                Export attendance CSV
              </button>
            </div>
          </section>
        )}


        <section className="filter-section" id="backup">
          <h3 tabIndex={-1}>Backup</h3>
          <p className="filter-hint">
            Everything lives on this device only. Generate a backup (timetables, filters, notes,
            attendance, photos and documents) and restore it on a new device or after clearing browser
            data. You choose the scope and can seal it with a passphrase; a preview shows exactly what is
            inside before anything is generated or restored.
          </p>
          {backupOpen && <BackupSheet store={store} onClose={() => setBackupOpen(false)} />}
          {restoreText !== null && (
            <RestoreSheet text={restoreText} onClose={() => setRestoreText(null)} onRestored={() => window.location.reload()} />
          )}
          <div className="btn-row">
            <button type="button" className="btn-primary" onClick={() => setBackupOpen(true)}>
              Back up… (preview first)
            </button>
            <button type="button" className="btn-secondary" onClick={() => importInput.current?.click()}>
              Restore from backup…
            </button>
            <input
              ref={importInput}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleImportFile(file)
                e.target.value = ''
              }}
            />
          </div>
        </section>


        <section className="filter-section" id="sync">
          <h3 tabIndex={-1}>Sync between devices</h3>
          <p className="filter-hint">
            Keeps your timetables, filters, notes and attendance the same on your phone and laptop
            via a shared code. Everything is encrypted on this device before it leaves — the server
            only ever sees scrambled data. Photo and document files stay on each device (use Backup to move them).
          </p>
          {syncState ? (
            <>
              <p className="settings-url sync-code">
                Code: <strong>{syncState.code}</strong>
              </p>
              <div className="btn-row">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    void navigator.clipboard?.writeText(syncState.code).catch(() => {})
                    setSyncMsg('Code copied — enter it on your other device under “Sync between devices”.')
                  }}
                >
                  Copy code
                </button>
                <button type="button" className="btn-secondary" disabled={syncBusy} onClick={() => void syncNow()}>
                  {syncBusy ? 'Working…' : 'Sync now'}
                </button>
                <button type="button" className="btn-secondary" disabled={syncBusy} onClick={() => void rotateSyncCode()}>
                  Rotate code
                </button>
                <button type="button" className="btn-ghost" onClick={disableSync}>
                  Turn off
                </button>
              </div>
              <p className="filter-hint">
                Changes sync automatically a few seconds after you make them, and again when you
                return to the app. Notes and attendance merge per session (newest edit wins), so both
                devices' entries survive. Rotate the code if it leaks.
              </p>
            </>
          ) : (
            <>
              <button type="button" className="btn-secondary" disabled={syncBusy} onClick={() => void enableSync()}>
                {syncBusy ? 'Working…' : 'Turn on sync (creates a code)'}
              </button>
              <div className="feed-row">
                <input
                  type="text"
                  placeholder="Or enter a code from another device"
                  aria-label="Sync code from another device"
                  value={syncInput}
                  onChange={(e) => setSyncInput(e.target.value.toUpperCase())}
                />
              </div>
              <button
                type="button"
                className="btn-secondary"
                disabled={syncBusy || syncInput.trim().length < 4}
                onClick={() => void connectSync()}
              >
                Connect to that device
              </button>
              <p className="filter-hint">
                Connecting brings in the synced timetables and merges notes/attendance with this
                device's own.
              </p>
            </>
          )}
          {syncMsg && <p className="filter-hint">{syncMsg}</p>}
        </section>

        </>
      )}
      {section === 'appearance' && (
        <>

        <section className="filter-section" id="theme">
          <h3 tabIndex={-1}>Theme</h3>
          <div className="chip-grid">
            {(
              [
                { value: 'system', label: 'System' },
                { value: 'light', label: '☀️ Light' },
                { value: 'dark', label: '🌙 Dark' },
              ] as const
            ).map(({ value, label }) => (
              <button
                key={value}
                type="button"
                className={`chip${(settings.theme ?? 'system') === value ? ' chip-on' : ''}`}
                aria-pressed={(settings.theme ?? 'system') === value}
                onClick={() => onUpdateSettings({ theme: value })}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        <section className="filter-section" id="density">
          <h3 tabIndex={-1}>Density</h3>
          <div className="chip-grid">
            {(
              [
                { value: undefined, label: 'Comfortable' },
                { value: 'compact', label: 'Compact' },
              ] as const
            ).map(({ value, label }) => (
              <button
                key={label}
                type="button"
                className={`chip${(settings.density ?? undefined) === value ? ' chip-on' : ''}`}
                aria-pressed={(settings.density ?? undefined) === value}
                onClick={() => onUpdateSettings({ density: value })}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="filter-hint">Compact tightens card spacing — controls and text stay full size.</p>
        </section>
        </>
      )}
      {section === 'help' && (
        <>
        <section className="filter-section" id="whats-new">
          <h3 tabIndex={-1}>What's new</h3>
          <ul className="whatsnew-list">
            {WHATSNEW.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </section>

        {onInstall && (
          <section className="filter-section" id="install">
            <h3 tabIndex={-1}>Install the app</h3>
            <p className="filter-hint">
              Put My Timetable on your Home Screen / desktop — it opens full-screen, works offline
              and can receive background push.
            </p>
            <button type="button" className="btn-secondary" onClick={onInstall}>
              📲 Install
            </button>
          </section>
        )}


        <section className="filter-section">
          <h3>Support this app</h3>
          <p className="filter-hint">
            My Timetable is free and runs on free hosting. If it saves you time, you can buy the
            developer a coffee.
          </p>
          <a
            className="btn-secondary btn-link kofi-link"
            href="https://ko-fi.com/awsaqib"
            target="_blank"
            rel="noopener noreferrer"
          >
            ☕ Support on Ko-fi ↗
          </a>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={settings.usagePing !== false}
              onChange={(e) => onUpdateSettings({ usagePing: e.target.checked })}
            />
            Share anonymous usage counts
          </label>
          <p className="filter-hint">
            The app keeps coarse local counters — opens and feature names with counts, by UTC day —
            and sends them to its own server as small batches: a random token (a pseudonymous
            identifier created on this device), whether the app runs installed, the platform type,
            the build id and which settings are switched on (yes/no only). No location, name,
            timetable content or notes are ever included. Switching this off clears anything not yet
            sent and stops collection; batches already delivered cannot be unsent.
            {settings.usagePing !== false && telemetry &&
              ` Status: ${
                telemetry.openSegments + telemetry.claimedSegments === 0
                  ? 'nothing waiting to send ✓'
                  : `${telemetry.openSegments + telemetry.claimedSegments} day batch(es) queued — they send on the next open or within 15 minutes.`
              }`}
          </p>
          <p className="filter-hint">
            App version {WHATSNEW_VERSION} · build {__BUILD_TIME__} — updates apply automatically on
            the next open.
          </p>
        </section>

        </>
      )}
      </div>
    </div>
  )
}

import { SyncNotice } from './components/SyncNotice'
import { DATA_CHANGED_EVENT } from './lib/persistence'
import { SYNC_APPLIED_EVENT, setSyncStatus } from './lib/sync'
import { reportPersistenceFailure } from './lib/persistence'
import { markBackedUp } from './lib/storage'
import { PersistenceNotice } from './components/PersistenceNotice'
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { AppShell } from './components/AppShell'
import { SessionDetail } from './components/SessionDetail'
import { SetupScreen } from './components/SetupScreen'
import type { SetupResult } from './components/SetupScreen'
import { SpecialismPicker } from './components/SpecialismPicker'
import { PGCEPage } from './features/pgce/PGCEPage'
import type { AdminTab } from './features/pgce/PGCEPage'
import { SchedulePage } from './features/schedule/SchedulePage'
import { TasksPage } from './features/tasks/TasksPage'
import { JourneyHomePage } from './features/today/JourneyHomePage'
import { TodayPage } from './features/today/TodayPage'
import { parseRoute, useRoute } from './lib/router'
import { hasInternalPredecessor } from './lib/navigationState'
import { buildProjection } from './lib/scheduleProjection'
import { InvalidLinkPage } from './components/InvalidLinkPage'
import type { Route } from './lib/router'

// The bottom sheets are modal and rarely part of first paint — split them out
// of the initial bundle (they load on first open).
const AdminSheet = lazy(() => import('./components/AdminSheet').then((m) => ({ default: m.AdminSheet })))
const ChangesSheet = lazy(() => import('./components/ChangesSheet').then((m) => ({ default: m.ChangesSheet })))
const FilterSheet = lazy(() => import('./components/FilterSheet').then((m) => ({ default: m.FilterSheet })))
const JournalSheet = lazy(() => import('./components/JournalSheet').then((m) => ({ default: m.JournalSheet })))
const SettingsSheet = lazy(() => import('./components/SettingsSheet').then((m) => ({ default: m.SettingsSheet })))
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type SettingsSection = import('./components/SettingsSheet').SettingsSection
const StatsSheet = lazy(() => import('./components/StatsSheet').then((m) => ({ default: m.StatsSheet })))
const StudyGroupSheet = lazy(() => import('./components/StudyGroupSheet').then((m) => ({ default: m.StudyGroupSheet })))
const CourseSheet = lazy(() => import('./components/CourseSheet').then((m) => ({ default: m.CourseSheet })))
import { sendTelemetry } from './lib/analytics'
import { configureTelemetry } from './lib/telemetry'
import { loadSyncState as loadSyncStateForPing } from './lib/sync'
import { trackOpen, trackUse } from './lib/usage'
import { telemetryTrack } from './lib/telemetry'
import { UpdateToast } from './components/UpdateToast'
import { legacyKey } from '../shared/identity.js'
import { sessionKey } from './lib/diff'
import {
  DEFAULT_FILTERS,
  activeFilterCount,
  applyFilters,
  deriveOptions,
  getFilters,
  localTodayISO,
  selectCourseSessions,
  selectReminderSessions,
} from './lib/filters'
import { daysUntil, isPlacementSession, placementTag } from './lib/format'
import { expandPlacementSpans } from './lib/placementSpans'
import { parseShareHash } from './lib/share'
import { DEFAULT_PUSH_BASE } from './lib/config'
import { subscribePush } from './lib/push'
import { EMPTY_ADMIN, loadAdminFile, saveAdminFile } from './lib/admin'
import type { AdminFile, CommitmentRec, PlanChildRec, TaskRecord } from './lib/admin'
import { duplicateTask, migrateCustomKeyDates, overlayTaskMeta, taskEventKey, taskToSession } from './lib/tasks'
import { applyPlacementExceptions } from './lib/placement'
import { availableOrigins } from './lib/origins'
import { busyCommitmentSessions, commitmentToSession, remindableCommitmentSessions } from './lib/commitments'
import { CommitmentSheet } from './components/CommitmentSheet'
import { PlacementPage } from './features/pgce/PlacementPage'
import { TaskEditSheet } from './components/TaskEditSheet'
import { fetchNotices, loadDismissedNotices, dismissNotice } from './lib/notices'
import type { Notice } from './lib/notices'
import { loadSyncState, pushSync, syncPullApply } from './lib/sync'
import { downloadFile } from './lib/files'
import { useNotifications } from './hooks/useNotifications'
import { useTimetableData } from './hooks/useTimetableData'
import { useTravel } from './hooks/useTravel'
import { activeCourse, setActiveCourse } from './lib/course'
import {
  clearProfileData,
  exportBackup,
  loadStore,
  loadMeta,
  newProfileId,
  saveCache,
  saveChanges,
  saveMeta,
  saveStore,
  shouldNudgeBackup,
  snoozeBackupNudge,
} from './lib/storage'
import type {
  Filters,
  ProfileStore,
  Session,
  SessionMeta,
  Settings,
  ViewMode,
} from './types'

type SheetName = 'none' | 'filters' | 'changes' | 'stats' | 'group' | 'journal' | 'admin' | 'course'

/** Initial store: saved profiles, plus a profile imported from a #setup= share link if present. */
function initStore(): ProfileStore | null {
  let store = loadStore()
  const shared = parseShareHash(window.location.hash)
  if (shared) {
    const id = newProfileId()
    const name = `Shared timetable${store ? ` ${store.profiles.length + 1}` : ''}`
    store = {
      activeId: id,
      profiles: [...(store?.profiles ?? []), { id, name, settings: shared }],
    }
    saveStore(store)
    history.replaceState(null, '', window.location.pathname + window.location.search)
  }
  return store
}

export default function App() {
  const [store, setStore] = useState<ProfileStore | null>(initStore)
  const [addingProfile, setAddingProfile] = useState(false)
  const [openSheet, setOpenSheet] = useState<SheetName>('none')
  const [rechoosing, setRechoosing] = useState(false)
  // One date-selection model shared by Day/Week/Month (null = follow today).
  const [selectedDateISO, setSelectedDateISO] = useState<string | null>(null)
  const [showBackupNudge, setShowBackupNudge] = useState(false)
  const [notices, setNotices] = useState<Notice[]>([])
  // A notification tap carrying an owner: switch to that profile, then open
  // the stable event (P3-05). Falls back to a safe notice when it's gone.
  const [pendingOpen, setPendingOpen] = useState<{ profileId: string; key: string } | null>(null)
  const [openNotice, setOpenNotice] = useState<string | null>(null)
  const [dismissedNotices, setDismissedNotices] = useState<Set<string>>(() => loadDismissedNotices())
  const [adminFile, setAdminFile] = useState<AdminFile>(EMPTY_ADMIN)
  const [adminTab, setAdminTab] = useState<AdminTab>('overview')
  // Task editor: null = closed, { task: null } = create (P5-01).
  const [taskEdit, setTaskEdit] = useState<{ task: TaskRecord | null } | null>(null)
  const [taskUndo, setTaskUndo] = useState<TaskRecord | null>(null)
  // Personal-event editor (P5-06): null closed; commitment null = create.
  const [commitmentEdit, setCommitmentEdit] = useState<{ commitment: CommitmentRec | null; dateISO: string } | null>(null)
  const [commitmentUndo, setCommitmentUndo] = useState<CommitmentRec | null>(null)

  const active = store?.profiles.find((p) => p.id === store.activeId) ?? null
  const settings = active?.settings ?? null
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  // Activate this profile's course configuration BEFORE anything derives
  // today/zone/campus from it (P7-01); idempotent, falls back to UCL built-in.
  setActiveCourse(settings?.courseConfig)
  const course = activeCourse()
  // Course-timezone today, refreshed each minute so midnight rollover moves the
  // Today marker without touching the user's date selection; a course/timezone
  // change recomputes it immediately.
  const [todayISO, setTodayISO] = useState(() => localTodayISO())
  useEffect(() => {
    setTodayISO(localTodayISO())
    const t = setInterval(() => {
      const next = localTodayISO()
      setTodayISO((prev) => (prev === next ? prev : next))
    }, 60_000)
    return () => clearInterval(t)
  }, [course.timezone])

  // Phase 4 shell: hash routing across Today · Schedule · Tasks · PGCE file.
  const [route, navigate, routeNotice] = useRoute()
  // Desktop keeps the detail as an accessible dialog sheet; phones get a full
  // page that replaces the bottom navigation (P4-05).
  const [detailAsSheet, setDetailAsSheet] = useState(() => window.matchMedia('(min-width: 1024px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const onChange = (e: MediaQueryListEvent) => setDetailAsSheet(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  // Back only walks history when the previous entry is OURS: an external
  // deep link (notification, share) has history but no in-app predecessor,
  // and history.back() there would leave the PWA (R1 / TT-08).
  const goBackOr = (fallback: Route) => {
    if (hasInternalPredecessor()) window.history.back()
    else navigate(fallback, { replace: true })
  }
  // An unknown settings section lands on the index with a small notice and a
  // clean hash, never an empty page.
  useEffect(() => {
    if (routeNotice) {
      setOpenNotice(routeNotice)
      navigate({ name: 'settings' }, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeNotice])
  function handleNavigate(r: Route) {
    navigate(r)
  }

  const {
    sessions,
    keyDates,
    fetchedAt,
    refreshing,
    error,
    metaMap,
    metaReady,
    setMetaMap,
    changes,
    setChanges,
    refresh,
    identityReview,
    sources,
  } = useTimetableData(active)

  // Close any open detail/date selection when the active profile switches,
  // and run the one-time customKeyDates → task-records migration (P5-01):
  // old ids and calendar identity are preserved; saved status/notes adopt.
  useEffect(() => {
    if (parseRoute(window.location.hash).name === 'session') navigate({ name: 'today' }, { replace: true })
    setSelectedDateISO(null)
    setTaskEdit(null)
    setTaskUndo(null)
    if (!active) {
      setAdminFile(EMPTY_ADMIN)
      return
    }
    const loaded = loadAdminFile(active.id)
    const { admin: migratedAdmin, migrated } = migrateCustomKeyDates(active.settings, loadMeta(active.id), loaded)
    if (migrated) {
      saveAdminFile(active.id, migratedAdmin)
      setAdminFile(loadAdminFile(active.id))
      updateSettings({ customKeyDates: undefined })
    } else {
      setAdminFile(loaded)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id])

  const PGCE_COLLECTIONS = ['reflections', 'targets', 'meetings', 'observations', 'lessons', 'audits'] as const
  function updateAdmin(updater: (prev: AdminFile) => AdminFile) {
    if (!active) return
    setAdminFile((prev) => {
      const next = updater(prev)
      saveAdminFile(active.id, next)
      // A4: pgce_record_saved counts once per successful save that added or
      // updated a PGCE record — every tab's create/edit/undo flow funnels
      // through here, and deletes don't fire. Counts only; never record
      // content or type.
      const savedRecord = PGCE_COLLECTIONS.some((c) => {
        const before = new Map((prev[c] as { id: string; at: number }[]).map((r) => [r.id, r.at]))
        return (next[c] as { id: string; at: number }[]).some((r) => before.get(r.id) !== r.at)
      })
      if (savedRecord) telemetryTrack('pgce_record_saved')
      return next
    })
  }

  function saveTask(record: TaskRecord): boolean {
    if (!active) return false
    // A4 success events, decided against the CURRENT store before the write:
    // a brand-new id is a creation; a status transition to done is a
    // completion. Retries of the same save cannot double-fire.
    const existing = adminFile.tasks.find((t) => t.id === record.id)
    if (!existing) telemetryTrack('task_created')
    if (record.status === 'done' && existing?.status !== 'done') telemetryTrack('task_completed')
    updateAdmin((prev) => ({ ...prev, tasks: [...prev.tasks.filter((t) => t.id !== record.id), record] }))
    return true
  }

  function deleteTask(task: TaskRecord) {
    // Removal writes a tombstone via saveAdminFile; Undo saves a NEWER
    // revision, deliberately beating the tombstone (never just hiding it).
    updateAdmin((prev) => ({ ...prev, tasks: prev.tasks.filter((t) => t.id !== task.id) }))
    setTaskUndo(task)
  }

  function saveCommitment(rec: CommitmentRec): boolean {
    if (!active) return false
    updateAdmin((prev) => ({ ...prev, commitments: [...prev.commitments.filter((c) => c.id !== rec.id), rec] }))
    return true
  }

  function deleteCommitment(rec: CommitmentRec) {
    updateAdmin((prev) => ({ ...prev, commitments: prev.commitments.filter((c) => c.id !== rec.id) }))
    setCommitmentUndo(rec)
  }

  function savePlanChild(rec: PlanChildRec) {
    updateAdmin((prev) => ({ ...prev, plans: [...prev.plans.filter((c) => c.id !== rec.id), rec] }))
  }

  function deletePlanChild(id: string) {
    updateAdmin((prev) => ({ ...prev, plans: prev.plans.filter((c) => c.id !== id) }))
  }

  function setTaskStatus(task: TaskRecord, next: 'todo' | 'doing' | 'done') {
    if (task.status === next) return
    saveTask({
      ...task,
      status: next,
      // Completion is stamped with the COURSE day, not the device's UTC date.
      completedISO: next === 'done' ? localTodayISO() : task.completedISO,
      at: Date.now(),
    })
  }

  // Notification taps and queued 'open' actions arrive here with their owner.
  useEffect(() => {
    const onOpenRequest = (e: Event) => {
      const d = (e as CustomEvent).detail as { profileId?: string; key?: string }
      if (d?.profileId && d?.key) setPendingOpen({ profileId: d.profileId, key: d.key })
    }
    const onSwMessage = (event: MessageEvent) => {
      const msg = event.data as { type?: string; profileId?: string; key?: string }
      if (msg?.type !== 'timetable-open' || !msg.key) return
      const profiles = loadStore()?.profiles ?? []
      const owner = msg.profileId ?? (profiles.length === 1 ? profiles[0].id : undefined)
      if (owner) setPendingOpen({ profileId: owner, key: msg.key })
    }
    window.addEventListener('timetable-open-request', onOpenRequest)
    if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', onSwMessage)
    return () => {
      window.removeEventListener('timetable-open-request', onOpenRequest)
      if ('serviceWorker' in navigator) navigator.serviceWorker.removeEventListener('message', onSwMessage)
    }
  }, [])

  // Manual theme override (default: follow the system).
  useEffect(() => {
    const theme = settings?.theme ?? 'system'
    if (theme === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', theme)
  }, [settings?.theme])

  // Compact density tightens spacing only — controls stay full size.
  useEffect(() => {
    if (settings?.density === 'compact') document.documentElement.setAttribute('data-density', 'compact')
    else document.documentElement.removeAttribute('data-density')
  }, [settings?.density])

  // App-icon badge with the unseen-changes count, where the Badging API exists.
  useEffect(() => {
    const n = changes.filter((c) => !c.seen).length
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nav = navigator as any
    try {
      if (n > 0) void nav.setAppBadge?.(n)
      else void nav.clearAppBadge?.()
    } catch {
      /* unsupported */
    }
  }, [changes])

  // Consent gate (A2 / ADM-07): telemetry reads the ACTIVE profile's consent
  // on every call; switching to demo/opted-out clears pending counters and
  // starts a fresh collection generation. Gating both here AND inside the
  // collector means no ungated call site can leak an opted-out action.
  useEffect(() => {
    const s = settingsRef.current
    configureTelemetry(!!s && s.demo !== true && s.usagePing !== false)
  }, [active?.id, settings?.demo, settings?.usagePing])

  // Anonymous usage reporting (consent-gated inside; off switch in Settings).
  // Fires on open AND on resume — installed PWAs usually resume rather than
  // relaunch. Counters queue under their UTC observed date and travel as
  // immutable batches the worker deduplicates; a flush is always safe.
  useEffect(() => {
    const ping = (countOpen: boolean) => {
      const s = settingsRef.current
      if (!s || s.demo || s.usagePing === false) return
      if (countOpen) trackOpen()
      void sendTelemetry(s.pushServerBase ?? DEFAULT_PUSH_BASE, {
        push: s.pushEnabled === true,
        location: s.locationEnabled === true,
        home: s.homeLat != null,
        keyDates: !!s.keyDatesSheetId,
        sync: loadSyncStateForPing() !== null,
        placements: Object.keys(s.placements ?? {}).length > 0,
      })
    }
    ping(true)
    // Flush again on resume, on restored connectivity, and on a coarse
    // 15-minute interval while foregrounded with pending data.
    const onVisible = () => {
      if (document.visibilityState === 'visible') ping(true)
    }
    const onOnline = () => ping(false)
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') ping(false)
    }, 15 * 60_000)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
      clearInterval(interval)
    }
  }, [active?.id])

  // Feature-use counters (names only, never content) for the ping.
  useEffect(() => {
    if (openSheet !== 'none') trackUse(openSheet)
  }, [openSheet])
  useEffect(() => {
    if (route.name === 'session') trackUse('detail')
    // A4 route views: real navigations only (deps dedupe rerenders); no
    // query strings or record identifiers ever accompany these.
    const viewEvent = ({ today: 'view_today', schedule: 'view_schedule', tasks: 'view_tasks', pgce: 'view_pgce' } as Record<string, string>)[route.name]
    if (viewEvent) telemetryTrack(viewEvent)
  }, [route.name])
  const viewForTrack = settings?.activeView ?? 'day'
  useEffect(() => {
    if (viewForTrack !== 'day') trackUse(viewForTrack)
  }, [viewForTrack])

  // PWA shortcut deep-link (?view=keydates) — consume it once.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('view') === 'keydates') navigate({ name: 'tasks' }, { replace: true })
    if (params.has('view')) {
      history.replaceState(null, '', window.location.pathname)
    }
  }, [])

  // Monthly backup nudge: notes/attendance/photos exist only on this device.
  useEffect(() => {
    setShowBackupNudge(shouldNudgeBackup(Object.keys(metaMap).length > 0))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, Object.keys(metaMap).length > 0])

  // Cohort notices: a Date/Message/Link tab rendered as dismissible banners.
  useEffect(() => {
    setNotices([])
    if (!settings?.noticesSheetId) return
    let live = true
    void fetchNotices(settings.noticesSheetId, settings.noticesGid ?? null)
      .then((list) => {
        if (live) setNotices(list)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [settings?.noticesSheetId, settings?.noticesGid, fetchedAt])

  // Cross-device sync (opt-in): on start — and again when the tab comes back into
  // view — merge in a newer state parked by another device; after local edits,
  // park this device's state (debounced, encrypted).
  useEffect(() => {
    const pull = () => {
      const base = settingsRef.current?.pushServerBase ?? DEFAULT_PUSH_BASE
      void syncPullApply(base)
        .then((applied) => {
          if (applied) window.location.reload()
        })
        .catch(() => {})
    }
    pull()
    let lastPull = Date.now()
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastPull < 60_000) return
      lastPull = Date.now()
      pull()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const changed = () => {
      if (!loadSyncState()) return
      setSyncStatus('Changes saved on this device. Sync queued…')
      clearTimeout(timer)
      timer = setTimeout(() => { void syncPullApply(settingsRef.current?.pushServerBase ?? DEFAULT_PUSH_BASE).catch(() => {}) }, 2000)
    }
    window.addEventListener(DATA_CHANGED_EVENT, changed)
    return () => { clearTimeout(timer); window.removeEventListener(DATA_CHANGED_EVENT, changed) }
  }, [])
  const externalRefreshPending = useRef(false)
  useEffect(() => {
    const applied = () => {
      if (document.querySelector('[role="dialog"]')) { externalRefreshPending.current = true; setSyncStatus('Changes arrived from another tab. Close the open panel to load them.'); return }
      externalRefreshPending.current = false
      const next = loadStore()
      setStore(next)
      if (next) { setMetaMap(loadMeta(next.activeId)); setAdminFile(loadAdminFile(next.activeId)) }
    }
    window.addEventListener(SYNC_APPLIED_EVENT, applied)
    return () => window.removeEventListener(SYNC_APPLIED_EVENT, applied)
  }, [setMetaMap])
  const detailOpen = route.name === 'session'
  useEffect(() => {
    if (openSheet === 'none' && !detailOpen && externalRefreshPending.current) window.dispatchEvent(new Event(SYNC_APPLIED_EVENT))
    if (openSheet === 'none' && !detailOpen) void syncPullApply(settingsRef.current?.pushServerBase ?? DEFAULT_PUSH_BASE).catch(() => {})
  }, [openSheet, detailOpen])

  // Keep the push worker's copy of placement details and admin-summary counts
  // fresh (they feed background briefings/leave alerts and the Friday digest).
  const placementsConfigKey = JSON.stringify(settings?.placements ?? {})
  const adminSummaryKey = JSON.stringify({
    t: adminFile.targets.filter((t) => t.status !== 'met').length,
    a: adminFile.meetings.reduce((n, m) => n + m.actions.filter((a) => !a.done).length, 0),
    r: [...adminFile.reflections.map((r) => r.weekISO)].sort().pop() ?? '',
  })
  const activeIdForSync = active?.id
  const placementsSyncedOnce = useRef(false)
  useEffect(() => {
    if (!settings?.pushEnabled) return
    if (!placementsSyncedOnce.current) {
      placementsSyncedOnce.current = true
      return
    }
    const t = setTimeout(() => {
      const s = settingsRef.current
      if (s?.pushEnabled) {
        void subscribePush(s.pushServerBase ?? DEFAULT_PUSH_BASE, s, activeIdForSync).catch(() => {})
      }
    }, 5000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placementsConfigKey, adminSummaryKey])

  function updateSettings(patch: Partial<Settings>) {
    setStore((prev) => {
      if (!prev) return prev
      const next: ProfileStore = {
        ...prev,
        profiles: prev.profiles.map((p) =>
          p.id === prev.activeId ? { ...p, settings: { ...p.settings, ...patch } } : p
        ),
      }
      saveStore(next)
      return next
    })
  }

  function updateFilters(patch: Partial<Filters>) {
    if (!settings) return
    updateSettings({ filters: { ...getFilters(settings), ...patch } })
  }

  function addProfileToStore(newSettings: Settings, name: string): string {
    const id = newProfileId()
    setStore((prev) => {
      const next: ProfileStore = {
        activeId: id,
        profiles: [...(prev?.profiles ?? []), { id, name, settings: newSettings }],
      }
      saveStore(next)
      return next
    })
    return id
  }

  // Onboarding commits ONLY after the validated preview (P4-09): membership
  // choices ride along, so the separate specialism picker never re-asks.
  function handleSetupComplete(result: SetupResult) {
    const s: Settings = {
      sheetUrl: result.url,
      sheetId: result.sheetId,
      gid: result.gid,
      mySpecialisms: result.mySpecialisms,
      hideOtherSpecialisms: true,
      myGroups: result.myGroups,
      specialismsChosen: true,
    }
    const id = addProfileToStore(s, result.name)
    saveCache(id, { fetchedAt: Date.now(), sessions: expandPlacementSpans(result.sessions) })
    setAddingProfile(false)
  }

  function handleDemo() {
    addProfileToStore({ sheetUrl: '', sheetId: '', gid: null, demo: true }, 'Demo')
    setAddingProfile(false)
  }

  async function handleDeleteProfile(id: string) {
    try {
      await clearProfileData(id)
      setStore(loadStore())
      setOpenSheet('none')
      const state = loadSyncState()
      if (state) await pushSync(settingsRef.current?.pushServerBase ?? DEFAULT_PUSH_BASE, state.code)
    } catch (error) { reportPersistenceFailure('Profile deletion failed: ' + String(error)) }
  }

  function handleSwitchProfile(id: string) {
    setStore((prev) => {
      if (!prev || prev.activeId === id) return prev
      const next = { ...prev, activeId: id }
      saveStore(next)
      return next
    })
  }

  function handleMeta(session: Session, patch: Partial<SessionMeta>) {
    if (!active) return
    setMetaMap((prev) => {
      const key = sessionKey(session)
      const entry = { ...prev[key], deleted: undefined, ...patch, at: Math.max(Date.now(), (prev[key]?.at ?? 0) + 1) }
      const next = { ...prev, [key]: entry }
      if (
        !entry.attended &&
        !entry.absent &&
        !entry.note &&
        !entry.photos &&
        (!entry.status || entry.status === 'todo') &&
        (entry.standards ?? []).length === 0
      ) {
        delete next[key]
      }
      saveMeta(active.id, next)
      return next
    })
  }

  const options = useMemo(() => deriveOptions(sessions ?? []), [sessions])
  const view: ViewMode = settings?.activeView ?? 'day'

  // Temporary display filters over course membership; the selected-day list
  // and week/month views narrow by date themselves (the old date-range
  // display filter retired with the Day tab).
  const filteredSessions = useMemo(
    () =>
      sessions && settings
        ? applyPlacementExceptions(
            applyFilters(sessions, settings, todayISO, { ignoreDateRange: true }),
            adminFile.exceptions,
            settings
          )
        : [],
    [sessions, settings, todayISO, adminFile.exceptions]
  )

  // Course membership only (specialisms + groups), all dates, BEFORE placement
  // exceptions — the Placement page needs the raw plan to show excluded days.
  const rawCourseSessions = useMemo(
    () => (sessions && settings ? selectCourseSessions(sessions, settings) : []),
    [sessions, settings]
  )

  // The agreed view everywhere else (schedule, stats, calendar, reminders):
  // placement exceptions applied after span expansion (P5-03).
  const courseSessions = useMemo(
    () => (settings ? applyPlacementExceptions(rawCourseSessions, adminFile.exceptions, settings) : rawCourseSessions),
    [rawCourseSessions, adminFile.exceptions, settings]
  )

  // What notifications may fire for: membership plus the explicit optional/
  // self-study reminder preferences — independent of any display filter.
  const reminderSessions = useMemo(
    () =>
      sessions && settings
        ? applyPlacementExceptions(selectReminderSessions(sessions, settings), adminFile.exceptions, settings)
        : [],
    [sessions, settings, adminFile.exceptions]
  )

  // Sheet key dates + the user's personal tasks (task records), merged into
  // the shared key-date pipeline (calendar, reminders, Today strip).
  const allKeyDates = useMemo(() => {
    const custom = adminFile.tasks.map(taskToSession)
    return [...keyDates, ...custom].sort((a, b) => (a.dateISO + a.start).localeCompare(b.dateISO + b.start))
  }, [keyDates, adminFile.tasks])

  // Task status/notes overlaid on session metadata for display consumers —
  // writes always go through the task records, never these entries.
  const effectiveMeta = useMemo(() => overlayTaskMeta(metaMap, adminFile.tasks), [metaMap, adminFile.tasks])

  // Personal commitments as clearly-marked sessions (P5-06): all of them for
  // display; the busy subset for clashes and group availability; the
  // reminder-enabled subset for notifications.
  const personalSessions = useMemo(() => adminFile.commitments.map(commitmentToSession), [adminFile.commitments])
  const commitmentIds = useMemo(() => new Set(adminFile.commitments.map((c) => c.id)), [adminFile.commitments])
  const taskIds = useMemo(() => new Set(adminFile.tasks.map((t) => t.id)), [adminFile.tasks])
  const busyPersonal = useMemo(() => busyCommitmentSessions(adminFile.commitments), [adminFile.commitments])
  const remindablePersonal = useMemo(
    () => remindableCommitmentSessions(adminFile.commitments),
    [adminFile.commitments]
  )
  const withPersonal = useMemo(
    () =>
      [...courseSessions, ...personalSessions].sort((a, b) =>
        (a.dateISO + (a.start || '99')).localeCompare(b.dateISO + (b.start || '99'))
      ),
    [courseSessions, personalSessions]
  )
  // Does a proposed interval overlap timetabled/busy time? (work-plan blocks)
  const busyCheck = (dateISO: string, startTime: string, endTime: string) =>
    [...courseSessions, ...busyPersonal].some((x) => {
      if (x.dateISO !== dateISO || x.isKeyDate || x.isSelfStudy || x.isFreeTime) return false
      const xs = x.start || '00:00'
      const xe = x.end || x.start || '00:00'
      return xs < endTime && startTime < xe
    })

  // The open session detail is a ROUTE (#/session/<key>): Back returns to the
  // caller, notification opens deep-link, and profile switches clear it.
  const openSession = (s: Session) => navigate({ name: 'session', key: sessionKey(s) })
  const selected = useMemo(() => {
    if (route.name !== 'session' || sessions === null) return null
    const all = [...sessions, ...allKeyDates, ...personalSessions]
    return all.find((x) => sessionKey(x) === route.key) ?? all.find((x) => legacyKey(x) === route.key) ?? null
  }, [route, sessions, allKeyDates, personalSessions])
  // A session link that no longer resolves gets a safe notice, not a blank page.
  useEffect(() => {
    if (route.name === 'session' && sessions !== null && !selected) {
      setOpenNotice('That session is no longer on your timetable — Changes shows what moved or was cancelled.')
      navigate({ name: 'today' }, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, sessions, selected])

  // Resolve a pending open once the owning profile's sessions are loaded.
  useEffect(() => {
    if (!pendingOpen || !active) return
    if (active.id !== pendingOpen.profileId) {
      if (store?.profiles.some((p) => p.id === pendingOpen.profileId)) {
        handleSwitchProfile(pendingOpen.profileId)
      } else {
        setOpenNotice('That notification belongs to a timetable no longer on this device.')
        setPendingOpen(null)
      }
      return
    }
    if (sessions === null) return
    const all = [...sessions, ...allKeyDates]
    const target =
      all.find((x) => sessionKey(x) === pendingOpen.key) ?? all.find((x) => legacyKey(x) === pendingOpen.key)
    if (target) {
      openSession(target)
    } else {
      setOpenNotice('That session is no longer on your timetable — Changes shows what moved or was cancelled.')
      setOpenSheet('changes')
    }
    setPendingOpen(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingOpen, active?.id, sessions, allKeyDates])

  // Schedule rows: filtered sessions with key dates woven in as highlighted
  // blocks (toggle in Filters); the selected-day list slices these by date.
  // Canonical display/search projection (R1 / TT-02, TT-03): one decision
  // about what each view shows, deduplicated by owner identity. Personal
  // events follow their own toggle; course filters never touch them.
  const projection = useMemo(
    () =>
      buildProjection({
        filteredCourse: filteredSessions,
        courseAll: courseSessions,
        personal: personalSessions,
        keyDates: allKeyDates,
        showPersonal: settings ? getFilters(settings).showPersonal !== false : true,
        showKeyDates: settings ? getFilters(settings).showKeyDates : true,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredSessions, courseSessions, personalSessions, allKeyDates, settings]
  )
  const scheduleSessions = useMemo(
    () => [...projection.calendar, ...projection.pins].sort((a, b) => (a.dateISO + (a.start || '99')).localeCompare(b.dateISO + (b.start || '99'))),
    [projection]
  )

  const keyDateDays = useMemo(() => new Set(allKeyDates.map((k) => k.dateISO)), [allKeyDates])

  // Placement progress: unique school days per block, attended via the ✓ tick.
  const placementStats = useMemo(() => {
    const byTag = new Map<string, { total: Set<string>; attended: Set<string> }>()
    for (const s of courseSessions) {
      if (s.isKeyDate || !isPlacementSession(s)) continue
      const tag = placementTag(s.title)
      const e = byTag.get(tag) ?? { total: new Set<string>(), attended: new Set<string>() }
      e.total.add(s.dateISO)
      if (metaMap[sessionKey(s)]?.attended) e.attended.add(s.dateISO)
      byTag.set(tag, e)
    }
    const blocks = [...byTag.entries()]
      .map(([tag, e]) => ({ tag, attended: e.attended.size, total: e.total.size }))
      .sort((a, b) => a.tag.localeCompare(b.tag))
    return {
      blocks,
      attended: blocks.reduce((n, b) => n + b.attended, 0),
      totalDays: blocks.reduce((n, b) => n + b.total, 0),
    }
  }, [courseSessions, metaMap])

  // Month-grid extras: fully-placement days (tinted) and the first day of each break (🏖).
  const monthExtras = useMemo(() => {
    const byDate = new Map<string, { placement: number; real: number }>()
    for (const s of filteredSessions) {
      if (s.isKeyDate) continue
      const e = byDate.get(s.dateISO) ?? { placement: 0, real: 0 }
      e.real++
      if (isPlacementSession(s)) e.placement++
      byDate.set(s.dateISO, e)
    }
    const placementDays = new Set(
      [...byDate.entries()].filter(([, e]) => e.real > 0 && e.placement === e.real).map(([d]) => d)
    )
    const sorted = [...byDate.keys()].sort()
    const breakStarts = new Map<string, number>()
    for (let i = 1; i < sorted.length; i++) {
      const gap = daysUntil(sorted[i], sorted[i - 1]) - 1
      if (gap >= 7) {
        const [y, m, d] = sorted[i - 1].split('-').map(Number)
        const first = new Date(y, m - 1, d + 1)
        breakStarts.set(
          `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}-${String(first.getDate()).padStart(2, '0')}`,
          gap
        )
      }
    }
    return { placementDays, breakStarts }
  }, [filteredSessions])

  // Android/desktop install prompt: captured so Settings can offer an Install button.
  const installEvtRef = useRef<{ prompt: () => Promise<void> } | null>(null)
  const [canInstall, setCanInstall] = useState(false)
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()
      installEvtRef.current = e as unknown as { prompt: () => Promise<void> }
      setCanInstall(true)
    }
    const onInstalled = () => {
      installEvtRef.current = null
      setCanInstall(false)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])
  const handleInstall = () => {
    void installEvtRef.current?.prompt().then(() => {
      installEvtRef.current = null
      setCanInstall(false)
    })
  }

  // Share-target intake: photos shared into the PWA land in IndexedDB (sw-push.js);
  // attach them to today's current/most recent session once sessions have loaded.
  const [pendingShare, setPendingShare] = useState(false)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('share') === 'photo') {
      setPendingShare(true)
      history.replaceState(null, '', window.location.pathname)
    }
  }, [])
  useEffect(() => {
    if (!pendingShare || !active || courseSessions.length === 0) return
    setPendingShare(false)
    void (async () => {
      const { getAndClearSharedPhotos } = await import('./lib/shareTarget')
      const blobs = await getAndClearSharedPhotos()
      if (blobs.length === 0) return
      const now = new Date()
      const nowMins = now.getHours() * 60 + now.getMinutes()
      // Today's latest already-started session; else the most recent past session.
      const started = courseSessions.filter((s) => {
        if (s.isKeyDate || s.isSelfStudy) return false
        if (s.dateISO < todayISO) return true
        if (s.dateISO !== todayISO || !s.start) return false
        const m = s.start.match(/^(\d{1,2}):(\d{2})$/)
        return m !== null && Number(m[1]) * 60 + Number(m[2]) <= nowMins
      })
      const target = started[started.length - 1]
      if (!target) return
      const { addPhoto, compressImage } = await import('./lib/photos')
      const key = sessionKey(target)
      for (const blob of blobs) {
        await addPhoto(active.id, key, await compressImage(new File([blob], 'shared.jpg', { type: blob.type || 'image/jpeg' })))
        telemetryTrack('evidence_photo_saved')
      }
      handleMeta(target, { photos: (metaMap[key]?.photos ?? 0) + blobs.length })
      openSession(target)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingShare, active?.id, courseSessions.length])

  const { coords, coordsAt, tubeStatus, locationEnabled, travelMode } = useTravel(settings, courseSessions, todayISO)

  // Explicit journey origins (P6-02): device fix + saved home/campus/placements.
  const journeyOrigins = useMemo(
    () => (settings ? availableOrigins(settings, coords, coordsAt) : []),
    [settings, coords, coordsAt]
  )

  useNotifications({
    metaReady,
    profileId: active?.id ?? null,
    settings,
    reminderSessions: [...reminderSessions, ...remindablePersonal],
    allKeyDates,
    metaMap: effectiveMeta,
    coords,
    travelMode,
    locationEnabled,
    tubeStatus,
    onMark: (key, kind, ownerPid) => {
      // A personal task's notification action updates the task RECORD.
      if (kind === 'done' && key.startsWith('task:')) {
        const record = adminFile.tasks.find((t) => taskEventKey(t) === key)
        if (record && record.status !== 'done') {
          saveTask({ ...record, status: 'done', completedISO: localTodayISO(), at: Date.now() })
        }
        return
      }
      const target = ownerPid ?? active?.id
      if (!target) return
      const patch = (entry: SessionMeta | undefined): SessionMeta =>
        kind === 'done'
          ? { ...entry, deleted: undefined, status: 'done', at: Date.now() }
          : { ...entry, deleted: undefined, attended: kind === 'attended', absent: kind === 'absent', at: Date.now() }
      if (target !== active?.id) {
        // Action owned by another profile: update that profile's saved records
        // directly — never the active one's (P3-05).
        const other = loadMeta(target)
        saveMeta(target, { ...other, [key]: patch(other[key]) })
        return
      }
      setMetaMap((prev) => {
        const next = { ...prev, [key]: patch(prev[key]) }
        saveMeta(target, next)
        return next
      })
    },
  })

  if (!active || !settings || addingProfile) {
    return (
      <SetupScreen
        defaultName={`Timetable ${(store?.profiles.length ?? 0) + 1}`}
        onComplete={handleSetupComplete}
        onDemo={handleDemo}
        onCancel={addingProfile && active ? () => setAddingProfile(false) : undefined}
      />
    )
  }

  const filters = getFilters(settings)
  const showPicker =
    rechoosing || (!settings.specialismsChosen && sessions !== null && options.specialisms.length > 0)
  const unseenChanges = changes.filter((c) => !c.seen).length

  function openChanges() {
    setOpenSheet('changes')
    if (active && unseenChanges > 0) {
      const seen = changes.map((c) => ({ ...c, seen: true }))
      setChanges(seen)
      saveChanges(active.id, seen)
    }
  }

  return (
    <AppShell
      route={route}
      onNavigate={handleNavigate}
      profileName={active.name}
      hideNav={(route.name === 'session' || route.name === 'homeJourney') && !detailAsSheet}
    >
      <PersistenceNotice />
      <SyncNotice />

      {identityReview.length > 0 && (
        <button
          type="button"
          className="backup-banner identity-banner"
          onClick={() => openSession(identityReview[0])}
        >
          <span>
            🔗 {identityReview.length} event{identityReview.length === 1 ? '' : 's'} need
            {identityReview.length === 1 ? 's' : ''} an identity review (a sheet edit matched more
            than one saved event) — <strong>tap to open the first</strong>:{' '}
            {identityReview[0].dateISO.split('-').reverse().slice(0, 2).join('/')} ·{' '}
            {identityReview[0].title.slice(0, 40)}. Affected sessions carry a 🔗 badge.
          </span>
        </button>
      )}

      {commitmentUndo && (
        <div className="backup-banner notice-banner">
          <span>
            Deleted “{commitmentUndo.title}”.{' '}
            <button
              type="button"
              className="travel-link"
              onClick={() => {
                saveCommitment({ ...commitmentUndo, at: Date.now() })
                setCommitmentUndo(null)
              }}
            >
              Undo
            </button>
          </span>
          <button type="button" className="btn-icon" aria-label="Dismiss" onClick={() => setCommitmentUndo(null)}>
            ✕
          </button>
        </div>
      )}

      {openNotice && (
        <div className="backup-banner notice-banner">
          <span>🔔 {openNotice}</span>
          <button type="button" className="btn-icon" aria-label="Dismiss" onClick={() => setOpenNotice(null)}>
            ✕
          </button>
        </div>
      )}

      {error && (
        <div className="banner-error">
          {error}
          {sessions && sessions.length > 0 && ' Showing your last saved timetable.'}
        </div>
      )}

      {notices
        .filter((n) => !dismissedNotices.has(n.id))
        .slice(0, 3)
        .map((n) => (
          <div className="backup-banner notice-banner" key={n.id}>
            <span>
              📣 {n.dateISO ? `${n.dateISO.split('-').reverse().slice(0, 2).join('/')} — ` : ''}
              {n.message}
              {n.link && (
                <>
                  {' '}
                  <a href={n.link} target="_blank" rel="noopener noreferrer">
                    More ↗
                  </a>
                </>
              )}
            </span>
            <button
              type="button"
              className="btn-icon"
              aria-label="Dismiss notice"
              onClick={() => {
                dismissNotice(n.id)
                setDismissedNotices((prev) => new Set([...prev, n.id]))
              }}
            >
              ✕
            </button>
          </div>
        ))}

      {!settings.checklistDismissed &&
        sessions !== null &&
        (() => {
          const all = [
            ...(canInstall ? [{ done: false, label: 'Install the app on this device', act: handleInstall }] : []),
            { done: !!settings.specialismsChosen || options.specialisms.length === 0, label: 'Pick your specialism', act: () => setRechoosing(true) },
            { done: !!settings.keyDatesSheetId, label: 'Connect key dates (Settings → Key dates)', act: () => navigate({ name: 'settings' }) },
            { done: !!settings.pushEnabled, label: 'Enable background push (Settings)', act: () => navigate({ name: 'settings' }) },
            { done: !!settings.locationEnabled, label: 'Turn on travel times (Settings)', act: () => navigate({ name: 'settings' }) },
          ]
          const items = all.filter((i) => !i.done)
          if (items.length === 0) return null
          return (
            <div className="backup-banner checklist">
              <div>
                <strong>Finish setting up ({all.length - items.length}/{all.length} done)</strong>
                <ul className="whatsnew-list">
                  {items.map((i) => (
                    <li key={i.label}>
                      <button type="button" className="checklist-link" onClick={i.act}>
                        ☐ {i.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => updateSettings({ checklistDismissed: true })}
              >
                Hide
              </button>
            </div>
          )
        })()}

      {showBackupNudge && (
        <div className="backup-banner">
          <span>💾 Your notes, attendance and photos live only on this device.</span>
          <span className="backup-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                void exportBackup().then((json) => { downloadFile('my-timetable-backup.json', json, 'application/json'); markBackedUp() }).catch(error => reportPersistenceFailure('Backup export failed: ' + String(error)))
                setShowBackupNudge(false)
              }}
            >
              Back up now
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                snoozeBackupNudge()
                setShowBackupNudge(false)
              }}
            >
              Later
            </button>
          </span>
        </div>
      )}

      {route.name === 'today' && sessions !== null && travelMode === 'transit' && tubeStatus.length > 0 && (
        <details className="tfl-banner">
          <summary>
            ⚠ TfL disruptions: {tubeStatus.slice(0, 3).map((d) => d.line).join(', ')}
            {tubeStatus.length > 3 && ` +${tubeStatus.length - 3} more`}
          </summary>
          {tubeStatus.map((d) => (
            <p key={d.line}>
              <strong>{d.line}</strong> — {d.status}
              {d.reason ? `: ${d.reason.length > 200 ? d.reason.slice(0, 200) + '…' : d.reason}` : ''}
            </p>
          ))}
        </details>
      )}

      {selected && !detailAsSheet ? null : route.name === 'invalid' ? (
        <InvalidLinkPage
          reason={route.reason}
          onToday={() => navigate({ name: 'today' }, { replace: true })}
          onSchedule={() => navigate({ name: 'schedule' }, { replace: true })}
        />
      ) : route.name === 'homeJourney' ? (
        <JourneyHomePage
          settings={settings}
          coords={coords}
          locationEnabled={locationEnabled}
          travelMode={travelMode}
          origins={journeyOrigins}
          onBack={() => goBackOr({ name: 'today' })}
          onOpenSettings={() => navigate({ name: 'settings' })}
          onUpdateSettings={updateSettings}
        />
      ) : route.name === 'settings' && store ? (
        <Suspense fallback={null}>
          <SettingsSheet
            section={route.section as SettingsSection | undefined}
            onOpenSection={(sec) => navigate({ name: 'settings', section: sec })}
            sources={sources}
            exceptions={adminFile.exceptions}
            personalSessions={personalSessions}
            settings={settings}
            store={store}
            courseSessions={courseSessions}
            keyDates={allKeyDates}
            onOpenGroup={() => setOpenSheet('group')}
            onOpenCourse={() => setOpenSheet('course')}
            metaMap={metaMap}
            todayISO={todayISO}
            placementBlocks={placementStats.blocks}
            onInstall={canInstall ? handleInstall : undefined}
            onUpdateSettings={updateSettings}
            onOpenStats={() => setOpenSheet('stats')}
            onRechooseSpecialisms={() => {
              setRechoosing(true)
            }}
            onSwitchProfile={(id) => {
              handleSwitchProfile(id)
            }}
            onAddProfile={() => {
              setAddingProfile(true)
            }}
            onDeleteProfile={handleDeleteProfile}
            onClose={() => {
              if (route.section) navigate({ name: 'settings' })
              else goBackOr({ name: 'today' })
            }}
          />
        </Suspense>
      ) : route.name === 'placement' ? (
        <PlacementPage
          profileName={active.name}
          settings={settings}
          sessions={rawCourseSessions}
          exceptions={adminFile.exceptions}
          metaMap={metaMap}
          todayISO={todayISO}
          onSaveException={(rec) =>
            updateAdmin((prev) => ({
              ...prev,
              exceptions: [...prev.exceptions.filter((e) => e.id !== rec.id), rec],
            }))
          }
          onDeleteException={(id) =>
            updateAdmin((prev) => ({ ...prev, exceptions: prev.exceptions.filter((e) => e.id !== id) }))
          }
          onUpdateSettings={updateSettings}
          onBack={() => goBackOr({ name: 'pgce' })}
        />
      ) : route.name === 'tasks' ? (
        <TasksPage
          profileName={active.name}
          keyDates={allKeyDates}
          tasks={adminFile.tasks}
          meetings={adminFile.meetings}
          todayISO={todayISO}
          configured={!!settings.keyDatesSheetId}
          metaMap={effectiveMeta}
          undoTask={taskUndo}
          onUndoDelete={(t) => {
            saveTask({ ...t, at: Date.now() })
            setTaskUndo(null)
          }}
          onSelect={openSession}
          onSetStatus={(kd, status) => handleMeta(kd, { status })}
          onEditTask={(t) => setTaskEdit({ task: t })}
          onSetTaskStatus={setTaskStatus}
          onToggleAction={(meetingId, actionId) =>
            updateAdmin((prev) => ({
              ...prev,
              meetings: prev.meetings.map((m) =>
                m.id === meetingId
                  ? { ...m, actions: m.actions.map((a) => (a.id === actionId ? { ...a, done: !a.done } : a)) }
                  : m
              ),
            }))
          }
          onAddTask={() => setTaskEdit({ task: null })}
        />
      ) : route.name === 'pgce' ? (
        <PGCEPage
          profileId={active.id}
          profileName={active.name}
          admin={adminFile}
          metaMap={metaMap}
          placement={{
            attendedDays: placementStats.attended,
            totalDays: placementStats.totalDays,
            targetDays: settings.placementTargetDays,
            blocks: placementStats.blocks.length,
          }}
          onOpenAdmin={(tab) => {
            setAdminTab(tab)
            setOpenSheet('admin')
          }}
          onOpenJournal={() => setOpenSheet('journal')}
          onOpenStats={() => setOpenSheet('stats')}
          onOpenPlacements={() => navigate({ name: 'placement' })}
        />
      ) : route.name === 'schedule' ? (
        <SchedulePage
          settings={settings}
          profileName={active.name}
          todayISO={todayISO}
          view={view}
          selectedDateISO={selectedDateISO}
          onSelectDate={setSelectedDateISO}
          filteredSessions={projection.calendar}
          searchCorpus={projection.searchCorpus}
          scheduleSessions={scheduleSessions}
          courseSessions={courseSessions}
          allKeyDates={allKeyDates}
          keyDateDays={keyDateDays}
          monthExtras={monthExtras}
          metaMap={metaMap}
          coords={coords}
          travelMode={travelMode}
          activeCount={activeFilterCount(settings)}
          filters={filters}
          sessionsLoaded={sessions !== null}
          onView={(v) => updateSettings({ activeView: v })}
          onTogglePlacements={() => updateFilters({ placementsOnly: !filters.placementsOnly })}
          onOpenFilters={() => setOpenSheet('filters')}
          onClearFilters={() => updateSettings({ filters: { ...DEFAULT_FILTERS } })}
          onSelect={openSession}
          onMeta={handleMeta}
          onAddPersonal={(dateISO) => setCommitmentEdit({ commitment: null, dateISO })}
        />
      ) : sessions === null && !settings.demo && !error ? (
        <div className="empty-state">Loading timetable…</div>
      ) : (
        <TodayPage
          profileName={active.name}
          todayISO={todayISO}
          fetchedAt={fetchedAt}
          refreshing={refreshing}
          demo={settings.demo === true}
          onRefresh={() => refresh(settings, active.id)}
          courseSessions={withPersonal}
          allKeyDates={allKeyDates}
          metaMap={effectiveMeta}
          unseenChanges={unseenChanges}
          latestChange={changes.find((c) => !c.seen) ?? null}
          settings={settings}
          coords={coords}
          travelMode={travelMode}
          locationEnabled={locationEnabled}
          onSelect={openSession}
          onOpenChanges={openChanges}
          onOpenSettings={() => navigate({ name: 'settings' })}
          onOpenTasks={() => navigate({ name: 'tasks' })}
          onOpenSchedule={() => navigate({ name: 'schedule' })}
          personalSessions={settings && getFilters(settings).showPersonal === false ? [] : personalSessions}
          onOpenHomeJourney={() => navigate({ name: 'homeJourney' })}
        />
      )}

      {taskEdit && active && (
        <TaskEditSheet
          profileId={active.id}
          task={taskEdit.task}
          latest={taskEdit.task ? adminFile.tasks.find((t) => t.id === taskEdit.task!.id) ?? null : null}
          onSave={saveTask}
          existingIds={taskIds}
          onDuplicate={(t) => saveTask(duplicateTask(t))}
          onDelete={deleteTask}
          planChildren={taskEdit.task ? adminFile.plans.filter((c) => c.parentId === taskEdit.task!.id) : []}
          onSavePlan={savePlanChild}
          onDeletePlan={deletePlanChild}
          busyCheck={busyCheck}
          onClose={() => setTaskEdit(null)}
        />
      )}

      {commitmentEdit && active && (
        <CommitmentSheet
          profileId={active.id}
          commitment={commitmentEdit.commitment}
          defaultDateISO={commitmentEdit.dateISO}
          latest={
            commitmentEdit.commitment
              ? adminFile.commitments.find((c) => c.id === commitmentEdit.commitment!.id) ?? null
              : null
          }
          onSave={saveCommitment}
          existingIds={commitmentIds}
          onDelete={deleteCommitment}
          onClose={() => setCommitmentEdit(null)}
        />
      )}

      {selected && selected.id.startsWith('cmt-') ? (
        <CommitmentSheet
          profileId={active.id}
          commitment={adminFile.commitments.find((c) => c.id === selected.id.slice('cmt-'.length)) ?? null}
          defaultDateISO={selected.dateISO}
          latest={adminFile.commitments.find((c) => c.id === selected.id.slice('cmt-'.length)) ?? null}
          onSave={saveCommitment}
          existingIds={commitmentIds}
          onDelete={deleteCommitment}
          onClose={() => goBackOr({ name: 'today' })}
        />
      ) : selected && selected.id.startsWith('custom-') ? (
        // A personal task opens its dedicated editable detail (P5-01), not the
        // session sheet.
        <TaskEditSheet
          profileId={active.id}
          task={adminFile.tasks.find((t) => t.id === selected.id.slice('custom-'.length)) ?? null}
          latest={adminFile.tasks.find((t) => t.id === selected.id.slice('custom-'.length)) ?? null}
          onSave={saveTask}
          onDuplicate={(t) => saveTask(duplicateTask(t))}
          onDelete={deleteTask}
          planChildren={adminFile.plans.filter((c) => c.parentId === selected.id.slice('custom-'.length))}
          onSavePlan={savePlanChild}
          onDeletePlan={deletePlanChild}
          busyCheck={busyCheck}
          onClose={() => goBackOr({ name: 'today' })}
        />
      ) : selected && (
        <SessionDetail
          session={selected}
          presentation={detailAsSheet ? 'sheet' : 'page'}
          backLabel="Back"
          origins={journeyOrigins}
          arrivalBufferMins={settings.arrivalBufferMins ?? 10}
          onSetArrivalBuffer={(mins) => updateSettings({ arrivalBufferMins: mins })}
          meta={metaMap[sessionKey(selected)]}
          coords={coords}
          locationEnabled={locationEnabled}
          travelMode={travelMode}
          profileId={active.id}
          placementInfo={
            isPlacementSession(selected) ? (settings.placements ?? {})[placementTag(selected.title)] : undefined
          }
          onPlacementInfo={(patch) => {
            const tag = placementTag(selected.title)
            updateSettings({
              placements: {
                ...(settings.placements ?? {}),
                [tag]: { ...(settings.placements ?? {})[tag], ...patch },
              },
            })
          }}
          onMeta={(patch) => handleMeta(selected, patch)}
          onClose={() => goBackOr({ name: 'today' })}
        />
      )}

      {showPicker && (
        <SpecialismPicker
          specialisms={options.specialisms}
          initial={settings.mySpecialisms ?? []}
          onSave={(chosen) => {
            updateSettings({
              mySpecialisms: chosen,
              specialismsChosen: true,
              hideOtherSpecialisms: chosen.length > 0 ? true : settings.hideOtherSpecialisms,
            })
            setRechoosing(false)
          }}
        />
      )}

      <Suspense fallback={null}>
      {openSheet === 'filters' && (
        <FilterSheet
          settings={settings}
          filters={filters}
          options={options}
          hasKeyDates={allKeyDates.length > 0}
          onUpdateSettings={updateSettings}
          onUpdateFilters={updateFilters}
          onOpenKeyDates={() => {
            setOpenSheet('none')
            navigate({ name: 'tasks' })
          }}
          onClear={() =>
            // Clear only temporary display narrowing — group and specialism
            // membership is enrolment and stays as chosen.
            updateSettings({ filters: { ...DEFAULT_FILTERS } })
          }
          onClose={() => setOpenSheet('none')}
        />
      )}

      {openSheet === 'stats' && (
        <StatsSheet
          sessions={courseSessions}
          metaMap={metaMap}
          todayISO={todayISO}
          keyDates={allKeyDates}
          placementTargetDays={settings.placementTargetDays}
          adminCounts={{ observations: adminFile.observations.length, lessons: adminFile.lessons.length }}
          onClose={() => setOpenSheet('none')}
        />
      )}

      {openSheet === 'admin' && (
        <AdminSheet
          initialTab={adminTab}
          profileId={active.id}
          profileName={active.name}
          admin={adminFile}
          onUpdateAdmin={updateAdmin}
          sessions={courseSessions}
          metaMap={metaMap}
          keyDates={allKeyDates}
          placementTargetDays={settings.placementTargetDays}
          todayISO={todayISO}
          onClose={() => setOpenSheet('none')}
        />
      )}

      {openSheet === 'journal' && (
        <JournalSheet
          sessions={[...courseSessions, ...allKeyDates]}
          metaMap={metaMap}
          profileId={active.id}
          admin={adminFile}
          onSelect={openSession}
          onClose={() => setOpenSheet('none')}
        />
      )}

      {openSheet === 'course' && settings && (
        <CourseSheet
          settings={settings}
          onUpdateSettings={updateSettings}
          onClose={() => setOpenSheet('none')}
        />
      )}

      {openSheet === 'group' && (
        <StudyGroupSheet
          settings={settings}
          sessions={[...courseSessions, ...busyPersonal]}
          todayISO={todayISO}
          onUpdateSettings={updateSettings}
          onClose={() => setOpenSheet('none')}
        />
      )}

      {openSheet === 'changes' && (
        <ChangesSheet
          changes={changes}
          onClear={() => {
            setChanges([])
            saveChanges(active.id, [])
          }}
          onClose={() => setOpenSheet('none')}
        />
      )}

      </Suspense>

      {route.name === 'today' && (
        <button
          type="button"
          className="fab-add"
          aria-label="Add a personal deadline"
          title="Add a personal deadline"
          onClick={() => setTaskEdit({ task: null })}
        >
          ＋
        </button>
      )}

      <UpdateToast />
    </AppShell>
  )
}

import { SyncNotice } from './components/SyncNotice'
import { DATA_CHANGED_EVENT } from './lib/persistence'
import { SYNC_APPLIED_EVENT, setSyncStatus } from './lib/sync'
import { reportPersistenceFailure } from './lib/persistence'
import { markBackedUp } from './lib/storage'
import { PersistenceNotice } from './components/PersistenceNotice'
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { AgendaView } from './components/AgendaView'
import { FilterBar } from './components/FilterBar'
import { HomePill } from './components/HomeCard'
import { MonthView } from './components/MonthView'
import { NowNextCard } from './components/NowNextCard'
import { SessionDetail } from './components/SessionDetail'
import { SetupScreen } from './components/SetupScreen'
import { SpecialismPicker } from './components/SpecialismPicker'

// The bottom sheets are modal and rarely part of first paint — split them out
// of the initial bundle (they load on first open).
const AdminSheet = lazy(() => import('./components/AdminSheet').then((m) => ({ default: m.AdminSheet })))
const AddDeadlineSheet = lazy(() => import('./components/AddDeadlineSheet').then((m) => ({ default: m.AddDeadlineSheet })))
const ChangesSheet = lazy(() => import('./components/ChangesSheet').then((m) => ({ default: m.ChangesSheet })))
const FilterSheet = lazy(() => import('./components/FilterSheet').then((m) => ({ default: m.FilterSheet })))
const JournalSheet = lazy(() => import('./components/JournalSheet').then((m) => ({ default: m.JournalSheet })))
const KeyDatesSheet = lazy(() => import('./components/KeyDatesSheet').then((m) => ({ default: m.KeyDatesSheet })))
const SettingsSheet = lazy(() => import('./components/SettingsSheet').then((m) => ({ default: m.SettingsSheet })))
const StatsSheet = lazy(() => import('./components/StatsSheet').then((m) => ({ default: m.StatsSheet })))
const StudyGroupSheet = lazy(() => import('./components/StudyGroupSheet').then((m) => ({ default: m.StudyGroupSheet })))
import { WHATSNEW, WHATSNEW_VERSION, dismissWhatsNew, shouldShowWhatsNew } from './lib/changelog'
import { maybePing } from './lib/analytics'
import { loadSyncState as loadSyncStateForPing } from './lib/sync'
import { trackOpen, trackUse } from './lib/usage'
import { UpdateToast } from './components/UpdateToast'
import { WeekView } from './components/WeekView'
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
  weekBounds,
} from './lib/filters'
import { daysUntil, isPlacementSession, placementTag } from './lib/format'
import { fetchGvizTable } from './lib/gviz'
import { parseTimetable } from './lib/parseTimetable'
import { expandPlacementSpans } from './lib/placementSpans'
import { parseSheetUrl } from './lib/sheetUrl'
import { parseShareHash } from './lib/share'
import { DEFAULT_PUSH_BASE } from './lib/config'
import { subscribePush } from './lib/push'
import { EMPTY_ADMIN, loadAdminFile, saveAdminFile } from './lib/admin'
import type { AdminFile } from './lib/admin'
import { fetchNotices, loadDismissedNotices, dismissNotice } from './lib/notices'
import type { Notice } from './lib/notices'
import { loadSyncState, pushSync, syncPullApply } from './lib/sync'
import { downloadFile } from './lib/files'
import { useNotifications } from './hooks/useNotifications'
import { useTimetableData } from './hooks/useTimetableData'
import { useTravel } from './hooks/useTravel'
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

function formatAge(fetchedAt: number): string {
  const mins = Math.round((Date.now() - fetchedAt) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function matchesQuery(s: Session, q: string): boolean {
  const needle = q.toLowerCase()
  return [s.title, s.subject, s.tutor, s.room].some((f) => f && f.toLowerCase().includes(needle))
}

type SheetName = 'none' | 'filters' | 'settings' | 'changes' | 'keydates' | 'stats' | 'group' | 'adddl' | 'journal' | 'admin'

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
  const [selected, setSelected] = useState<Session | null>(null)
  // One date-selection model shared by Day/Week/Month (null = follow today).
  const [selectedDateISO, setSelectedDateISO] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [showBackupNudge, setShowBackupNudge] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showWhatsNew, setShowWhatsNew] = useState(() => shouldShowWhatsNew())
  const [notices, setNotices] = useState<Notice[]>([])
  // A notification tap carrying an owner: switch to that profile, then open
  // the stable event (P3-05). Falls back to a safe notice when it's gone.
  const [pendingOpen, setPendingOpen] = useState<{ profileId: string; key: string } | null>(null)
  const [openNotice, setOpenNotice] = useState<string | null>(null)
  const [dismissedNotices, setDismissedNotices] = useState<Set<string>>(() => loadDismissedNotices())
  const [adminFile, setAdminFile] = useState<AdminFile>(EMPTY_ADMIN)

  const active = store?.profiles.find((p) => p.id === store.activeId) ?? null
  const settings = active?.settings ?? null
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  // Course-timezone today, refreshed each minute so midnight rollover moves the
  // Today marker without touching the user's date selection.
  const [todayISO, setTodayISO] = useState(() => localTodayISO())
  useEffect(() => {
    const t = setInterval(() => {
      const next = localTodayISO()
      setTodayISO((prev) => (prev === next ? prev : next))
    }, 60_000)
    return () => clearInterval(t)
  }, [])

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
  } = useTimetableData(active)

  // Close any open detail/date selection when the active profile switches.
  useEffect(() => {
    setSelected(null)
    setSelectedDateISO(null)
    setAdminFile(active ? loadAdminFile(active.id) : EMPTY_ADMIN)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id])

  function updateAdmin(updater: (prev: AdminFile) => AdminFile) {
    if (!active) return
    setAdminFile((prev) => {
      const next = updater(prev)
      saveAdminFile(active.id, next)
      return next
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

  // Anonymous daily usage ping (throttled inside; off switch in Settings).
  // Fires on open AND on resume — installed PWAs usually resume rather than
  // relaunch, so a mount-only ping would miss whole days. Feature/opens
  // counters accumulate locally and travel with the next ping.
  useEffect(() => {
    const ping = (countOpen: boolean) => {
      const s = settingsRef.current
      if (!s || s.demo || s.usagePing === false) return
      if (countOpen) trackOpen()
      void maybePing(s.pushServerBase ?? DEFAULT_PUSH_BASE, WHATSNEW_VERSION, {
        push: s.pushEnabled === true,
        location: s.locationEnabled === true,
        home: s.homeLat != null,
        keyDates: !!s.keyDatesSheetId,
        sync: loadSyncStateForPing() !== null,
        placements: Object.keys(s.placements ?? {}).length > 0,
      })
    }
    ping(true)
    const onVisible = () => {
      if (document.visibilityState === 'visible') ping(true)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [active?.id])

  // Feature-use counters (names only, never content) for the ping.
  useEffect(() => {
    if (openSheet !== 'none') trackUse(openSheet)
  }, [openSheet])
  useEffect(() => {
    if (selected) trackUse('detail')
  }, [selected])
  const viewForTrack = settings?.activeView ?? 'day'
  useEffect(() => {
    if (viewForTrack !== 'day') trackUse(viewForTrack)
  }, [viewForTrack])
  useEffect(() => {
    if (searchOpen) trackUse('search')
  }, [searchOpen])
  useEffect(() => {
    if (showHistory) trackUse('historyview')
  }, [showHistory])

  // PWA shortcut deep-link (?view=keydates) — consume it once.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('view') === 'keydates') setOpenSheet('keydates')
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
  useEffect(() => {
    if (openSheet === 'none' && !selected && externalRefreshPending.current) window.dispatchEvent(new Event(SYNC_APPLIED_EVENT))
    if (openSheet === 'none' && !selected) void syncPullApply(settingsRef.current?.pushServerBase ?? DEFAULT_PUSH_BASE).catch(() => {})
  }, [openSheet, selected])

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

  async function handleSetup(url: string) {
    const parsed = parseSheetUrl(url)
    if (!parsed) {
      throw new Error('That doesn’t look like a Google Sheets link. It should contain /spreadsheets/d/…')
    }
    // Validate by fetching before saving anything.
    const table = await fetchGvizTable(parsed.sheetId, parsed.gid)
    const parsedSessions = expandPlacementSpans(parseTimetable(table).sessions)
    const s: Settings = { sheetUrl: url, sheetId: parsed.sheetId, gid: parsed.gid }
    const name = `Timetable ${(store?.profiles.length ?? 0) + 1}`
    const id = addProfileToStore(s, name)
    saveCache(id, { fetchedAt: Date.now(), sessions: parsedSessions })
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

  // Day view honours the date-range filter; week/month navigate dates themselves.
  const filteredSessions = useMemo(
    () =>
      sessions && settings
        ? applyFilters(sessions, settings, todayISO, { ignoreDateRange: view !== 'day' })
        : [],
    [sessions, settings, todayISO, view]
  )

  // Course membership only (specialisms + groups), all dates: the base set for
  // exports, search, stats, journal, Now/Next and group availability. Temporary
  // display filters (rooms, subjects…) never narrow this.
  const courseSessions = useMemo(
    () => (sessions && settings ? selectCourseSessions(sessions, settings) : []),
    [sessions, settings]
  )

  // What notifications may fire for: membership plus the explicit optional/
  // self-study reminder preferences — independent of any display filter.
  const reminderSessions = useMemo(
    () => (sessions && settings ? selectReminderSessions(sessions, settings) : []),
    [sessions, settings]
  )

  // Sheet key dates + the user's personal deadlines, merged.
  const allKeyDates = useMemo(() => {
    const custom = (settings?.customKeyDates ?? []).map(
      (c): Session => ({
        id: `custom-${c.id}`,
        title: c.title,
        day: '',
        dateISO: c.dateISO,
        start: c.start ?? '',
        end: '',
        room: '',
        groups: '',
        tutor: '',
        subject: c.title,
        isSpecialism: false,
        isSelfStudy: false,
        isOptional: false,
        isKeyDate: true,
      })
    )
    return [...keyDates, ...custom].sort((a, b) => (a.dateISO + a.start).localeCompare(b.dateISO + b.start))
  }, [keyDates, settings?.customKeyDates])

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
      setSelected(target)
    } else {
      setOpenNotice('That session is no longer on your timetable — Changes shows what moved or was cancelled.')
      setOpenSheet('changes')
    }
    setPendingOpen(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingOpen, active?.id, sessions, allKeyDates])

  const searchResults = useMemo(() => {
    const q = query.trim()
    return q ? [...courseSessions, ...allKeyDates].filter((s) => matchesQuery(s, q)) : null
  }, [courseSessions, allKeyDates, query])

  // Day view weaves key dates in as highlighted blocks (toggle in Filters); they follow
  // the same date-range choice as the rest of the day view.
  const dayViewSessions = useMemo(() => {
    if (!settings) return filteredSessions
    const f = getFilters(settings)
    if (view !== 'day' || !f.showKeyDates || allKeyDates.length === 0) return filteredSessions
    const week = f.dateRange === 'week' ? weekBounds(todayISO) : null
    const inRange = allKeyDates.filter((k) => {
      if (f.dateRange === 'today') return k.dateISO === todayISO
      if (week) return k.dateISO >= week.from && k.dateISO <= week.to
      return true
    })
    return [...filteredSessions, ...inRange].sort((a, b) =>
      (a.dateISO + (a.start || '99')).localeCompare(b.dateISO + (b.start || '99'))
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredSessions, allKeyDates, settings, view, todayISO])

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
      }
      handleMeta(target, { photos: (metaMap[key]?.photos ?? 0) + blobs.length })
      setSelected(target)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingShare, active?.id, courseSessions.length])

  const { coords, tubeStatus, locationEnabled, travelMode } = useTravel(settings, courseSessions, todayISO)

  useNotifications({
    metaReady,
    profileId: active?.id ?? null,
    settings,
    reminderSessions,
    allKeyDates,
    metaMap,
    coords,
    travelMode,
    locationEnabled,
    tubeStatus,
    onMark: (key, kind, ownerPid) => {
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
        onSubmit={handleSetup}
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
    <div className="app">
      <PersistenceNotice />
      <SyncNotice />
      <header className="header-stack">
        <div className="topbar">
          <div className="topbar-title">
            <h1>My Timetable</h1>
            {fetchedAt && (
              <span className="updated">
                {settings.demo ? 'demo data' : `updated ${formatAge(fetchedAt)}`}
              </span>
            )}
          </div>
          <div className="topbar-actions">
            {settings.homeLat != null && settings.homeLng != null && (
              <HomePill
                home={{ lat: settings.homeLat, lng: settings.homeLng }}
                coords={coords}
                locationEnabled={locationEnabled}
                travelMode={travelMode}
              />
            )}
            <button
              type="button"
              className="btn-icon"
              onClick={() => setOpenSheet('admin')}
              aria-label="My PGCE file"
              title="My PGCE file"
            >
              🎓
            </button>
            <button
              type="button"
              className="btn-icon"
              onClick={() => {
                setSearchOpen((v) => !v)
                setQuery('')
              }}
              aria-label="Search"
              title="Search"
            >
              🔍
            </button>
            <button type="button" className="btn-icon btn-bell" onClick={openChanges} aria-label="Changes" title="Changes">
              🔔
              {unseenChanges > 0 && <span className="bell-badge">{unseenChanges}</span>}
            </button>
            <button
              type="button"
              className="btn-icon"
              onClick={() => refresh(settings, active.id)}
              disabled={refreshing}
              aria-label="Refresh"
              title="Refresh"
            >
              {refreshing ? '…' : '↻'}
            </button>
            <button
              type="button"
              className="btn-icon"
              onClick={() => setOpenSheet('settings')}
              aria-label="Settings"
              title="Settings"
            >
              ⚙
            </button>
          </div>
        </div>
        {searchOpen && (
          <div className="searchbar">
            <input
              type="search"
              placeholder="Search title, tutor or room…"
              aria-label="Search sessions"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            {searchResults && <span className="search-count">{searchResults.length}</span>}
          </div>
        )}
        <FilterBar
          view={view}
          activeCount={activeFilterCount(settings)}
          placementsOnly={filters.placementsOnly === true}
          historyOn={showHistory}
          onToggleHistory={() => setShowHistory((v) => !v)}
          onView={(v) => {
            // View switches preserve the selected date (one shared model).
            updateSettings({ activeView: v })
          }}
          onTogglePlacements={() => updateFilters({ placementsOnly: !filters.placementsOnly })}
          onOpenFilters={() => setOpenSheet('filters')}
        />
      </header>

      {identityReview.length > 0 && (
        <button
          type="button"
          className="backup-banner identity-banner"
          onClick={() => setSelected(identityReview[0])}
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

      {showWhatsNew && (
        <div className="backup-banner whatsnew">
          <div>
            <strong>What's new</strong>
            <ul className="whatsnew-list">
              {WHATSNEW.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              dismissWhatsNew()
              setShowWhatsNew(false)
            }}
          >
            Got it
          </button>
        </div>
      )}

      {!settings.checklistDismissed &&
        sessions !== null &&
        (() => {
          const all = [
            ...(canInstall ? [{ done: false, label: 'Install the app on this device', act: handleInstall }] : []),
            { done: !!settings.specialismsChosen || options.specialisms.length === 0, label: 'Pick your specialism', act: () => setRechoosing(true) },
            { done: !!settings.keyDatesSheetId, label: 'Connect key dates (Settings → Key dates)', act: () => setOpenSheet('settings') },
            { done: !!settings.pushEnabled, label: 'Enable background push (Settings)', act: () => setOpenSheet('settings') },
            { done: !!settings.locationEnabled, label: 'Turn on travel times (Settings)', act: () => setOpenSheet('settings') },
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

      {sessions !== null && view === 'day' && !searchResults && travelMode === 'transit' && tubeStatus.length > 0 && (
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

      {sessions !== null && view === 'day' && !searchResults && (
        <NowNextCard sessions={courseSessions} onSelect={setSelected} />
      )}

      {sessions !== null &&
        view === 'day' &&
        !searchResults &&
        (() => {
          const next = allKeyDates
            .filter((k) => metaMap[sessionKey(k)]?.status !== 'done')
            .sort((a, b) => a.dateISO.localeCompare(b.dateISO))[0]
          if (!next) return null
          const days = daysUntil(next.dateISO, todayISO)
          return (
            <button type="button" className="keydate-strip" onClick={() => setOpenSheet('keydates')}>
              <span className="keydate-title">📌 {next.title}</span>
              <span className={`kd-chip${days <= 7 ? ' urgent' : ''}`}>
                {days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `in ${days}d`}
              </span>
            </button>
          )
        })()}

      {sessions === null ? (
        <div className="empty-state">Loading timetable…</div>
      ) : searchResults ? (
        <AgendaView
          sessions={searchResults}
          onSelect={setSelected}
          metaMap={metaMap}
          termStartISO={settings.termStartISO}
          coords={coords}
          travelMode={travelMode}
          placements={settings.placements}
          emptyMessage={`No sessions match “${query.trim()}”.`}
        />
      ) : view === 'week' ? (
        <WeekView
          sessions={filteredSessions}
          keyDates={getFilters(settings).showKeyDates ? allKeyDates : []}
          todayISO={todayISO}
          anchorISO={selectedDateISO ?? todayISO}
          onNavigate={(iso) => setSelectedDateISO(iso === todayISO ? null : iso)}
          onSelect={setSelected}
          termStartISO={settings.termStartISO}
          coords={coords}
          travelMode={travelMode}
          placements={settings.placements}
        />
      ) : view === 'month' ? (
        <MonthView
          sessions={filteredSessions}
          todayISO={todayISO}
          anchorISO={selectedDateISO ?? todayISO}
          onNavigate={(iso) => setSelectedDateISO(iso === todayISO ? null : iso)}
          keyDateDays={getFilters(settings).showKeyDates ? keyDateDays : undefined}
          placementDays={monthExtras.placementDays}
          breakStarts={monthExtras.breakStarts}
          onPickDay={(dateISO) => {
            setSelectedDateISO(dateISO === todayISO ? null : dateISO)
            // A "Today only"/"This week" display range must never hide a date
            // the user just chose — widen it rather than show an empty day.
            if (dateISO !== todayISO && getFilters(settings).dateRange !== 'all') {
              updateFilters({ dateRange: 'all' })
            }
            updateSettings({ activeView: 'day' })
          }}
        />
      ) : (
        <AgendaView
          sessions={dayViewSessions}
          scrollTo={selectedDateISO}
          todayISO={todayISO}
          onToday={() => setSelectedDateISO(null)}
          onSelect={setSelected}
          metaMap={metaMap}
          termStartISO={settings.termStartISO}
          coords={coords}
          travelMode={travelMode}
          placements={settings.placements}
          placementProgress={
            placementStats.totalDays > 0
              ? {
                  attended: placementStats.attended,
                  target: settings.placementTargetDays,
                  openTargets: adminFile.targets.filter((t) => t.status !== 'met').length,
                }
              : undefined
          }
          windowed
          showAllPast={showHistory}
          emptyMessage={
            sessions.length === 0
              ? 'No sessions found in this sheet.'
              : filters.dateRange === 'today'
                ? 'Nothing on today. 🎉'
                : 'No sessions match your filters.'
          }
        />
      )}

      {selected && (
        <SessionDetail
          session={selected}
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
          onClose={() => setSelected(null)}
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
          onOpenKeyDates={() => setOpenSheet('keydates')}
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
          onSelect={setSelected}
          onClose={() => setOpenSheet('none')}
        />
      )}

      {openSheet === 'keydates' && (
        <KeyDatesSheet
          keyDates={allKeyDates}
          todayISO={todayISO}
          configured={!!settings.keyDatesSheetId}
          metaMap={metaMap}
          onSelect={setSelected}
          onSetStatus={(kd, status) => handleMeta(kd, { status })}
          onDeleteCustom={(id) =>
            updateSettings({
              customKeyDates: (settings.customKeyDates ?? []).filter((c) => `custom-${c.id}` !== id),
            })
          }
          onClose={() => setOpenSheet('none')}
        />
      )}

      {openSheet === 'adddl' && (
        <AddDeadlineSheet
          onAdd={(title, dateISO, start) =>
            updateSettings({
              customKeyDates: [
                ...(settings.customKeyDates ?? []),
                { id: Date.now().toString(36), title, dateISO, start },
              ],
            })
          }
          onClose={() => setOpenSheet('none')}
        />
      )}

      {openSheet === 'group' && (
        <StudyGroupSheet
          settings={settings}
          sessions={courseSessions}
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

      {openSheet === 'settings' && store && (
        <SettingsSheet
          settings={settings}
          store={store}
          courseSessions={courseSessions}
          keyDates={allKeyDates}
          onOpenGroup={() => setOpenSheet('group')}
          metaMap={metaMap}
          todayISO={todayISO}
          placementBlocks={placementStats.blocks}
          onInstall={canInstall ? handleInstall : undefined}
          onUpdateSettings={updateSettings}
          onOpenStats={() => setOpenSheet('stats')}
          onOpenJournal={() => setOpenSheet('journal')}
          onRechooseSpecialisms={() => {
            setOpenSheet('none')
            setRechoosing(true)
          }}
          onSwitchProfile={(id) => {
            handleSwitchProfile(id)
            setOpenSheet('none')
          }}
          onAddProfile={() => {
            setOpenSheet('none')
            setAddingProfile(true)
          }}
          onDeleteProfile={handleDeleteProfile}
          onClose={() => setOpenSheet('none')}
        />
      )}
      </Suspense>

      {view === 'day' && !searchResults && (
        <button
          type="button"
          className="fab-add"
          aria-label="Add a personal deadline"
          title="Add a personal deadline"
          onClick={() => setOpenSheet('adddl')}
        >
          ＋
        </button>
      )}

      <UpdateToast />
    </div>
  )
}

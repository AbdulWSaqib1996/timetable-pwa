import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AgendaView } from './components/AgendaView'
import { ChangesSheet } from './components/ChangesSheet'
import { FilterBar } from './components/FilterBar'
import { FilterSheet } from './components/FilterSheet'
import { KeyDatesSheet } from './components/KeyDatesSheet'
import { MonthView } from './components/MonthView'
import { NowNextCard } from './components/NowNextCard'
import { SessionDetail } from './components/SessionDetail'
import { SettingsSheet } from './components/SettingsSheet'
import { SetupScreen } from './components/SetupScreen'
import { SpecialismPicker } from './components/SpecialismPicker'
import { UpdateToast } from './components/UpdateToast'
import { WeekView } from './components/WeekView'
import type { Coords } from './lib/campus'
import { TRAVEL_MODE_PHRASE, estimateTravel } from './lib/campus'
import { buildDemoSessions } from './lib/demo'
import { diffSessions, sessionKey } from './lib/diff'
import {
  DEFAULT_FILTERS,
  activeFilterCount,
  applyFilters,
  deriveOptions,
  getFilters,
  localTodayISO,
  weekBounds,
} from './lib/filters'
import { daysUntil, formatRemaining, shortenRoom, toMinutes } from './lib/format'
import { fetchGvizTable } from './lib/gviz'
import { parseTimetable } from './lib/parseTimetable'
import { parseSheetUrl } from './lib/sheetUrl'
import { parseShareHash } from './lib/share'
import { tflDisruptions } from './lib/tfl'
import type { TflDisruption } from './lib/tfl'
import {
  clearProfileData,
  clearStore,
  loadCache,
  loadChanges,
  loadMeta,
  loadNotified,
  loadStore,
  newProfileId,
  saveCache,
  saveChanges,
  saveMeta,
  saveNotified,
  saveStore,
} from './lib/storage'
import type {
  Filters,
  MetaMap,
  ProfileStore,
  Session,
  SessionChange,
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

type SheetName = 'none' | 'filters' | 'settings' | 'changes' | 'keydates'

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
  const [sessions, setSessions] = useState<Session[] | null>(null)
  const [fetchedAt, setFetchedAt] = useState<number | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openSheet, setOpenSheet] = useState<SheetName>('none')
  const [rechoosing, setRechoosing] = useState(false)
  const [selected, setSelected] = useState<Session | null>(null)
  const [jumpDate, setJumpDate] = useState<string | null>(null)
  const [metaMap, setMetaMap] = useState<MetaMap>({})
  const [changes, setChanges] = useState<SessionChange[]>([])
  const [keyDates, setKeyDates] = useState<Session[]>([])
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [coords, setCoords] = useState<Coords | null>(null)
  const [tubeStatus, setTubeStatus] = useState<TflDisruption[]>([])

  const active = store?.profiles.find((p) => p.id === store.activeId) ?? null
  const settings = active?.settings ?? null
  const todayISO = localTodayISO()

  const refresh = useCallback(
    async (s: Settings, pid: string) => {
      if (s.demo) {
        setSessions(buildDemoSessions())
        setFetchedAt(Date.now())
        setError(null)
        return
      }
      setRefreshing(true)
      try {
        const table = await fetchGvizTable(s.sheetId, s.gid)
        let parsed = parseTimetable(table).sessions
        // Merge any extra tabs into the same timetable, deduplicating identical rows.
        for (const [i, tab] of (s.extraTabs ?? []).entries()) {
          try {
            const extra = await fetchGvizTable(tab.sheetId, tab.gid)
            parsed = parsed.concat(
              parseTimetable(extra).sessions.map((x) => ({ ...x, id: `t${i}-${x.id}` }))
            )
          } catch {
            /* a broken extra tab shouldn't take down the main timetable */
          }
        }
        if ((s.extraTabs ?? []).length > 0) {
          const seen = new Set<string>()
          parsed = parsed.filter((x) => {
            const k = `${x.dateISO}|${x.start}|${x.title.toLowerCase()}|${x.room}`
            if (seen.has(k)) return false
            seen.add(k)
            return true
          })
          parsed.sort((a, b) => (a.dateISO + (a.start || '99')).localeCompare(b.dateISO + (b.start || '99')))
        }
        const prev = loadCache(pid)
        if (prev) {
          // Diff the user's own view of old vs new (their specialism/group filters applied).
          const newChanges = diffSessions(
            applyFilters(prev.sessions, s, todayISO, { ignoreDateRange: true }),
            applyFilters(parsed, s, todayISO, { ignoreDateRange: true }),
            todayISO
          )
          if (newChanges.length > 0) {
            const merged = [...newChanges, ...loadChanges(pid)]
            saveChanges(pid, merged)
            setChanges(merged.slice(0, 100))
          }
        }
        // Key dates live in a second tab; failures there never break the main timetable.
        let kd: Session[] | undefined
        if (s.keyDatesSheetId) {
          try {
            const kdTable = await fetchGvizTable(s.keyDatesSheetId, s.keyDatesGid ?? null)
            kd = parseTimetable(kdTable).sessions.map((k) => ({ ...k, id: `kd-${k.id}`, isKeyDate: true }))
          } catch {
            kd = prev?.keyDates
          }
        }
        setSessions(parsed)
        setKeyDates(kd ?? [])
        const now = Date.now()
        setFetchedAt(now)
        setError(null)
        saveCache(pid, { fetchedAt: now, sessions: parsed, keyDates: kd })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to refresh.')
      } finally {
        setRefreshing(false)
      }
    },
    [todayISO]
  )

  // When the active profile changes (startup or switch): load its cache/meta/changes, then refresh.
  useEffect(() => {
    if (!active) return
    const cached = loadCache(active.id)
    setSessions(cached && !active.settings.demo ? cached.sessions : null)
    setFetchedAt(cached && !active.settings.demo ? cached.fetchedAt : null)
    setMetaMap(loadMeta(active.id))
    setChanges(loadChanges(active.id))
    setKeyDates((cached?.keyDates ?? []).map((k) => ({ ...k, isKeyDate: true })))
    setSelected(null)
    setJumpDate(null)
    setError(null)
    void refresh(active.settings, active.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id])

  // Refetch when the key-dates tab or merged tabs change in Settings.
  const extraTabsKey = JSON.stringify(settings?.extraTabs ?? [])
  useEffect(() => {
    if (active && sessions !== null && (active.settings.keyDatesSheetId || (active.settings.extraTabs ?? []).length > 0)) {
      void refresh(active.settings, active.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.keyDatesSheetId, settings?.keyDatesGid, extraTabsKey])

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

  // PWA shortcut deep-link (?view=keydates) — consume it once.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('view') === 'keydates') setOpenSheet('keydates')
    if (params.has('view')) {
      history.replaceState(null, '', window.location.pathname)
    }
  }, [])

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
    const { sessions: parsedSessions } = parseTimetable(table)
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

  function handleDeleteProfile(id: string) {
    clearProfileData(id)
    setStore((prev) => {
      if (!prev) return prev
      const remaining = prev.profiles.filter((p) => p.id !== id)
      if (remaining.length === 0) {
        clearStore()
        return null
      }
      const next: ProfileStore = {
        activeId: prev.activeId === id ? remaining[0].id : prev.activeId,
        profiles: remaining,
      }
      saveStore(next)
      return next
    })
    setOpenSheet('none')
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
      const entry = { ...prev[key], ...patch }
      const next: MetaMap = { ...prev, [key]: entry }
      if (!entry.attended && !entry.note) delete next[key]
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

  // For export, search, reminders and the Now/Next card: user's filters, all dates.
  const exportSessions = useMemo(
    () =>
      sessions && settings ? applyFilters(sessions, settings, todayISO, { ignoreDateRange: true }) : [],
    [sessions, settings, todayISO]
  )

  const searchResults = useMemo(() => {
    const q = query.trim()
    return q ? [...exportSessions, ...keyDates].filter((s) => matchesQuery(s, q)) : null
  }, [exportSessions, keyDates, query])

  // Day view weaves key dates in as highlighted blocks (toggle in Filters); they follow
  // the same date-range choice as the rest of the day view.
  const dayViewSessions = useMemo(() => {
    if (!settings) return filteredSessions
    const f = getFilters(settings)
    if (view !== 'day' || !f.showKeyDates || keyDates.length === 0) return filteredSessions
    const week = f.dateRange === 'week' ? weekBounds(todayISO) : null
    const inRange = keyDates.filter((k) => {
      if (f.dateRange === 'today') return k.dateISO === todayISO
      if (week) return k.dateISO >= week.from && k.dateISO <= week.to
      return true
    })
    return [...filteredSessions, ...inRange].sort((a, b) =>
      (a.dateISO + (a.start || '99')).localeCompare(b.dateISO + (b.start || '99'))
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredSessions, keyDates, settings, view, todayISO])

  const keyDateDays = useMemo(() => new Set(keyDates.map((k) => k.dateISO)), [keyDates])

  // Device location for travel-time estimates (only while enabled in Settings).
  const locationEnabled = settings?.locationEnabled ?? false
  const travelMode = settings?.travelMode ?? 'walking'

  // Live TfL line status while public transport is the chosen mode (strikes, closures, delays).
  useEffect(() => {
    if (travelMode !== 'transit') {
      setTubeStatus([])
      return
    }
    let live = true
    const load = () =>
      void tflDisruptions().then((d) => {
        if (live) setTubeStatus(d)
      })
    load()
    const t = setInterval(load, 5 * 60_000)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [travelMode])
  const tubeStatusRef = useRef(tubeStatus)
  tubeStatusRef.current = tubeStatus

  // Session reminders + leave alerts: checked every 30s while the app is running.
  // Multiple offsets are supported (e.g. 60 and 15 → two notifications); when several
  // offsets are due at once (say the app was just opened), only one fires per session.
  const exportRef = useRef(exportSessions)
  exportRef.current = exportSessions
  const keyDatesRef = useRef(keyDates)
  keyDatesRef.current = keyDates
  const travelRef = useRef({ coords, travelMode, locationEnabled })
  travelRef.current = { coords, travelMode, locationEnabled }
  const offsetsKey = JSON.stringify(settings?.reminderOffsets ?? [])
  const leaveKey = JSON.stringify(settings?.leaveAlertOffsets ?? [])
  const kdDaysKey = JSON.stringify(settings?.keyDateReminderDays ?? [])
  useEffect(() => {
    const offsets = (JSON.parse(offsetsKey) as number[]).sort((a, b) => a - b)
    const leaveOffsets = (JSON.parse(leaveKey) as number[]).sort((a, b) => a - b)
    const kdDays = (JSON.parse(kdDaysKey) as number[]).sort((a, b) => a - b)
    if (
      (offsets.length === 0 && leaveOffsets.length === 0 && kdDays.length === 0) ||
      typeof Notification === 'undefined'
    )
      return
    const notify = (title: string, body: string) => {
      try {
        new Notification(title, { body })
      } catch {
        /* notification constructor unavailable (some mobile browsers) */
      }
    }
    const check = () => {
      if (Notification.permission !== 'granted') return
      const now = new Date()
      const today = localTodayISO()
      const nowMins = now.getHours() * 60 + now.getMinutes()
      const notified = loadNotified()
      let dirty = false
      const { coords: here, travelMode: mode, locationEnabled: locEnabled } = travelRef.current
      for (const s of exportRef.current) {
        if (s.dateISO !== today || !s.start) continue
        const start = toMinutes(s.start)
        if (start === null) continue
        const delta = start - nowMins
        if (delta <= 0) continue

        // Fixed "before the session" reminders.
        const due = offsets.filter((m) => delta <= m && !notified[`${sessionKey(s)}#${m}`])
        if (due.length > 0) {
          notify(
            s.title,
            `Starts ${s.start} (in ${formatRemaining(delta)})${s.room && !s.isSelfStudy ? ` · ${shortenRoom(s.room)}` : ''}`
          )
          for (const m of due) notified[`${sessionKey(s)}#${m}`] = Date.now()
          dirty = true
        }

        // "Time to leave" alerts: leave-by = start − live travel estimate; alert with head start.
        if (leaveOffsets.length > 0 && locEnabled && here && s.room && !s.isSelfStudy) {
          const est = estimateTravel(s.room, here, mode)
          if (est.minutes !== null) {
            const untilLeave = delta - est.minutes
            const leaveDue = leaveOffsets.filter(
              (m) => untilLeave <= m && !notified[`${sessionKey(s)}#leave#${m}`]
            )
            if (leaveDue.length > 0) {
              const disruptionNote =
                mode === 'transit' && tubeStatusRef.current.length > 0
                  ? ` · ⚠ TfL: ${tubeStatusRef.current
                      .slice(0, 2)
                      .map((d) => `${d.line} ${d.status.toLowerCase()}`)
                      .join(', ')}`
                  : ''
              notify(
                untilLeave <= 0 ? `Time to leave — ${s.title}` : `Leave in ${formatRemaining(untilLeave)} — ${s.title}`,
                `≈ ${formatRemaining(est.minutes)} ${TRAVEL_MODE_PHRASE[mode]} to ${est.building ?? shortenRoom(s.room)} · starts ${s.start}${disruptionNote}`
              )
              for (const m of leaveDue) notified[`${sessionKey(s)}#leave#${m}`] = Date.now()
              dirty = true
            }
          }
        }
      }
      // Key-date reminders: N days before each deadline (one notification per offset).
      if (kdDays.length > 0) {
        const today = localTodayISO()
        for (const kd of keyDatesRef.current) {
          if (kd.dateISO < today) continue
          const days = daysUntil(kd.dateISO, today)
          const due = kdDays.filter((d) => days <= d && !notified[`${sessionKey(kd)}#kd#${d}`])
          if (due.length === 0) continue
          notify(
            `📌 ${kd.title}`,
            days === 0
              ? `Due today${kd.start ? ` at ${kd.start}` : ''}`
              : `Due in ${days} day${days === 1 ? '' : 's'} (${kd.dateISO.split('-').reverse().join('/')})`
          )
          for (const d of due) notified[`${sessionKey(kd)}#kd#${d}`] = Date.now()
          dirty = true
        }
      }
      if (dirty) saveNotified(notified)
    }
    check()
    const t = setInterval(check, 30_000)
    return () => clearInterval(t)
  }, [offsetsKey, leaveKey, kdDaysKey])
  useEffect(() => {
    if (!locationEnabled || !('geolocation' in navigator)) {
      setCoords(null)
      return
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setCoords(null),
      { enableHighAccuracy: false, maximumAge: 120_000 }
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [locationEnabled])

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
          onView={(v) => {
            setJumpDate(null)
            updateSettings({ activeView: v })
          }}
          onOpenFilters={() => setOpenSheet('filters')}
        />
      </header>

      {error && (
        <div className="banner-error">
          {error}
          {sessions && sessions.length > 0 && ' Showing your last saved timetable.'}
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
        <NowNextCard sessions={exportSessions} onSelect={setSelected} />
      )}

      {sessions !== null &&
        view === 'day' &&
        !searchResults &&
        (() => {
          const next = keyDates
            .filter((k) => k.dateISO >= todayISO)
            .sort((a, b) => a.dateISO.localeCompare(b.dateISO))[0]
          if (!next) return null
          const days = daysUntil(next.dateISO, todayISO)
          return (
            <button type="button" className="keydate-strip" onClick={() => setOpenSheet('keydates')}>
              <span className="keydate-title">📌 {next.title}</span>
              <span className={`kd-chip${days <= 7 ? ' urgent' : ''}`}>
                {days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `in ${days}d`}
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
          emptyMessage={`No sessions match “${query.trim()}”.`}
        />
      ) : view === 'week' ? (
        <WeekView
          sessions={filteredSessions}
          todayISO={todayISO}
          onSelect={setSelected}
          termStartISO={settings.termStartISO}
          coords={coords}
          travelMode={travelMode}
        />
      ) : view === 'month' ? (
        <MonthView
          sessions={filteredSessions}
          todayISO={todayISO}
          keyDateDays={getFilters(settings).showKeyDates ? keyDateDays : undefined}
          onPickDay={(dateISO) => {
            setJumpDate(dateISO)
            updateSettings({ activeView: 'day' })
          }}
        />
      ) : (
        <AgendaView
          sessions={dayViewSessions}
          scrollTo={jumpDate}
          onSelect={setSelected}
          metaMap={metaMap}
          termStartISO={settings.termStartISO}
          coords={coords}
          travelMode={travelMode}
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

      {openSheet === 'filters' && (
        <FilterSheet
          settings={settings}
          filters={filters}
          options={options}
          hasKeyDates={keyDates.length > 0}
          onUpdateSettings={updateSettings}
          onUpdateFilters={updateFilters}
          onOpenKeyDates={() => setOpenSheet('keydates')}
          onClear={() =>
            updateSettings({
              filters: { ...DEFAULT_FILTERS },
              mySpecialisms: [],
              hideOtherSpecialisms: true,
              myGroups: [],
            })
          }
          onClose={() => setOpenSheet('none')}
        />
      )}

      {openSheet === 'keydates' && (
        <KeyDatesSheet
          keyDates={keyDates}
          todayISO={todayISO}
          configured={!!settings.keyDatesSheetId}
          onSelect={setSelected}
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
          exportSessions={exportSessions}
          keyDates={keyDates}
          metaMap={metaMap}
          todayISO={todayISO}
          onUpdateSettings={updateSettings}
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

      <UpdateToast />
    </div>
  )
}

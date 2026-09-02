import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AgendaView } from './components/AgendaView'
import { ChangesSheet } from './components/ChangesSheet'
import { FilterBar } from './components/FilterBar'
import { FilterSheet } from './components/FilterSheet'
import { MonthView } from './components/MonthView'
import { NowNextCard } from './components/NowNextCard'
import { SessionDetail } from './components/SessionDetail'
import { SettingsSheet } from './components/SettingsSheet'
import { SetupScreen } from './components/SetupScreen'
import { SpecialismPicker } from './components/SpecialismPicker'
import { UpdateToast } from './components/UpdateToast'
import { WeekView } from './components/WeekView'
import type { Coords } from './lib/campus'
import { buildDemoSessions } from './lib/demo'
import { diffSessions, sessionKey } from './lib/diff'
import {
  DEFAULT_FILTERS,
  activeFilterCount,
  applyFilters,
  deriveOptions,
  getFilters,
  localTodayISO,
} from './lib/filters'
import { formatRemaining, shortenRoom, toMinutes } from './lib/format'
import { fetchGvizTable } from './lib/gviz'
import { parseTimetable } from './lib/parseTimetable'
import { parseSheetUrl } from './lib/sheetUrl'
import { parseShareHash } from './lib/share'
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

type SheetName = 'none' | 'filters' | 'settings' | 'changes'

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
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [coords, setCoords] = useState<Coords | null>(null)

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
        const { sessions: parsed } = parseTimetable(table)
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
        setSessions(parsed)
        const now = Date.now()
        setFetchedAt(now)
        setError(null)
        saveCache(pid, { fetchedAt: now, sessions: parsed })
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
    setSelected(null)
    setJumpDate(null)
    setError(null)
    void refresh(active.settings, active.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id])

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
    return q ? exportSessions.filter((s) => matchesQuery(s, q)) : null
  }, [exportSessions, query])

  // Session reminders: check every 30s while the app is running. Multiple offsets are
  // supported (e.g. 60 and 15 → two notifications); when several offsets are due at once
  // (say the app was just opened), only the most imminent one fires.
  const exportRef = useRef(exportSessions)
  exportRef.current = exportSessions
  const offsetsKey = JSON.stringify(settings?.reminderOffsets ?? [])
  useEffect(() => {
    const offsets = (JSON.parse(offsetsKey) as number[]).sort((a, b) => a - b)
    if (offsets.length === 0 || typeof Notification === 'undefined') return
    const check = () => {
      if (Notification.permission !== 'granted') return
      const now = new Date()
      const today = localTodayISO()
      const nowMins = now.getHours() * 60 + now.getMinutes()
      const notified = loadNotified()
      let dirty = false
      for (const s of exportRef.current) {
        if (s.dateISO !== today || !s.start) continue
        const start = toMinutes(s.start)
        if (start === null) continue
        const delta = start - nowMins
        if (delta <= 0) continue
        const due = offsets.filter((m) => delta <= m && !notified[`${sessionKey(s)}#${m}`])
        if (due.length === 0) continue
        try {
          new Notification(s.title, {
            body: `Starts ${s.start} (in ${formatRemaining(delta)})${s.room && !s.isSelfStudy ? ` · ${shortenRoom(s.room)}` : ''}`,
          })
        } catch {
          /* notification constructor unavailable (some mobile browsers) */
        }
        for (const m of due) notified[`${sessionKey(s)}#${m}`] = Date.now()
        dirty = true
      }
      if (dirty) saveNotified(notified)
    }
    check()
    const t = setInterval(check, 30_000)
    return () => clearInterval(t)
  }, [offsetsKey])

  // Device location for walking-time estimates (only while enabled in Settings).
  const locationEnabled = settings?.locationEnabled ?? false
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

      {sessions !== null && view === 'day' && !searchResults && (
        <NowNextCard sessions={exportSessions} onSelect={setSelected} />
      )}

      {sessions === null ? (
        <div className="empty-state">Loading timetable…</div>
      ) : searchResults ? (
        <AgendaView
          sessions={searchResults}
          onSelect={setSelected}
          metaMap={metaMap}
          termStartISO={settings.termStartISO}
          emptyMessage={`No sessions match “${query.trim()}”.`}
        />
      ) : view === 'week' ? (
        <WeekView
          sessions={filteredSessions}
          todayISO={todayISO}
          onSelect={setSelected}
          termStartISO={settings.termStartISO}
        />
      ) : view === 'month' ? (
        <MonthView
          sessions={filteredSessions}
          todayISO={todayISO}
          onPickDay={(dateISO) => {
            setJumpDate(dateISO)
            updateSettings({ activeView: 'day' })
          }}
        />
      ) : (
        <AgendaView
          sessions={filteredSessions}
          scrollTo={jumpDate}
          onSelect={setSelected}
          metaMap={metaMap}
          termStartISO={settings.termStartISO}
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
          onUpdateSettings={updateSettings}
          onUpdateFilters={updateFilters}
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

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AgendaView } from './components/AgendaView'
import { FilterBar } from './components/FilterBar'
import { FilterSheet } from './components/FilterSheet'
import { MonthView } from './components/MonthView'
import { NowNextCard } from './components/NowNextCard'
import { SessionDetail } from './components/SessionDetail'
import { SettingsSheet } from './components/SettingsSheet'
import { SetupScreen } from './components/SetupScreen'
import { SpecialismPicker } from './components/SpecialismPicker'
import { WeekView } from './components/WeekView'
import { buildDemoSessions } from './lib/demo'
import {
  DEFAULT_FILTERS,
  activeFilterCount,
  applyFilters,
  deriveOptions,
  getFilters,
  localTodayISO,
} from './lib/filters'
import { fetchGvizTable } from './lib/gviz'
import { parseTimetable } from './lib/parseTimetable'
import { parseSheetUrl } from './lib/sheetUrl'
import { clearSettings, loadCache, loadSettings, saveCache, saveSettings } from './lib/storage'
import type { Filters, Session, Settings, ViewMode } from './types'

function formatAge(fetchedAt: number): string {
  const mins = Math.round((Date.now() - fetchedAt) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

type SheetName = 'none' | 'filters' | 'settings'

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(() => loadSettings())
  const [sessions, setSessions] = useState<Session[] | null>(null)
  const [fetchedAt, setFetchedAt] = useState<number | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openSheet, setOpenSheet] = useState<SheetName>('none')
  const [rechoosing, setRechoosing] = useState(false)
  const [selected, setSelected] = useState<Session | null>(null)
  const [jumpDate, setJumpDate] = useState<string | null>(null)

  const refresh = useCallback(async (s: Settings) => {
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
      setSessions(parsed)
      const now = Date.now()
      setFetchedAt(now)
      setError(null)
      saveCache({ fetchedAt: now, sessions: parsed })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh.')
    } finally {
      setRefreshing(false)
    }
  }, [])

  // On startup with a saved sheet: show cached data instantly, then refresh in the background.
  useEffect(() => {
    if (!settings) return
    const cached = loadCache()
    if (cached && !settings.demo) {
      setSessions(cached.sessions)
      setFetchedAt(cached.fetchedAt)
    }
    void refresh(settings)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function updateSettings(patch: Partial<Settings>) {
    setSettings((prev) => {
      if (!prev) return prev
      const next = { ...prev, ...patch }
      saveSettings(next)
      return next
    })
  }

  function updateFilters(patch: Partial<Filters>) {
    if (!settings) return
    updateSettings({ filters: { ...getFilters(settings), ...patch } })
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
    saveSettings(s)
    const now = Date.now()
    saveCache({ fetchedAt: now, sessions: parsedSessions })
    setSettings(s)
    setSessions(parsedSessions)
    setFetchedAt(now)
    setError(null)
  }

  function handleDemo() {
    const s: Settings = { sheetUrl: '', sheetId: '', gid: null, demo: true }
    saveSettings(s)
    setSettings(s)
    setSessions(buildDemoSessions())
    setFetchedAt(Date.now())
  }

  function handleChangeSheet() {
    clearSettings()
    setSettings(null)
    setSessions(null)
    setFetchedAt(null)
    setError(null)
    setOpenSheet('none')
    setRechoosing(false)
    setSelected(null)
    setJumpDate(null)
  }

  const options = useMemo(() => deriveOptions(sessions ?? []), [sessions])
  const todayISO = localTodayISO()
  const view: ViewMode = settings?.activeView ?? 'day'

  // Day view honours the date-range filter; week/month navigate dates themselves.
  const filteredSessions = useMemo(
    () =>
      sessions && settings
        ? applyFilters(sessions, settings, todayISO, { ignoreDateRange: view !== 'day' })
        : [],
    [sessions, settings, todayISO, view]
  )

  // For export: user's filters, all dates.
  const exportSessions = useMemo(
    () =>
      sessions && settings ? applyFilters(sessions, settings, todayISO, { ignoreDateRange: true }) : [],
    [sessions, settings, todayISO]
  )

  if (!settings) {
    return <SetupScreen onSubmit={handleSetup} onDemo={handleDemo} />
  }

  const filters = getFilters(settings)
  const showPicker =
    rechoosing || (!settings.specialismsChosen && sessions !== null && options.specialisms.length > 0)

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
              onClick={() => refresh(settings)}
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

      {sessions !== null && view === 'day' && (
        <NowNextCard sessions={exportSessions} onSelect={setSelected} />
      )}

      {sessions === null ? (
        <div className="empty-state">Loading timetable…</div>
      ) : view === 'week' ? (
        <WeekView sessions={filteredSessions} todayISO={todayISO} onSelect={setSelected} />
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
          emptyMessage={
            sessions.length === 0
              ? 'No sessions found in this sheet.'
              : filters.dateRange === 'today'
                ? 'Nothing on today. 🎉'
                : 'No sessions match your filters.'
          }
        />
      )}

      {selected && <SessionDetail session={selected} onClose={() => setSelected(null)} />}

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
            updateSettings({ filters: { ...DEFAULT_FILTERS }, mySpecialisms: [], hideOtherSpecialisms: true })
          }
          onClose={() => setOpenSheet('none')}
        />
      )}

      {openSheet === 'settings' && (
        <SettingsSheet
          settings={settings}
          exportSessions={exportSessions}
          onUpdateSettings={updateSettings}
          onRechooseSpecialisms={() => {
            setOpenSheet('none')
            setRechoosing(true)
          }}
          onChangeSheet={handleChangeSheet}
          onClose={() => setOpenSheet('none')}
        />
      )}
    </div>
  )
}

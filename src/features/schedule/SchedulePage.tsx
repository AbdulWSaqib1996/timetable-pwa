import { useEffect, useMemo, useState } from 'react'
import { addDaysISO, mondayOfISO } from '../../../shared/calendar-time.js'
import { AgendaView } from '../../components/AgendaView'
import { MonthView } from '../../components/MonthView'
import { WeekView } from '../../components/WeekView'
import { IconSearch, PageHeader, SegmentedControl } from '../../components/ui'
import type { Coords, TravelMode } from '../../lib/campus'
import { sessionKey as panelKey } from '../../lib/diff'
import { getFilters } from '../../lib/filters'
import { trackUse } from '../../lib/usage'
import type { Filters, MetaMap, Session, SessionMeta, Settings, ViewMode } from '../../types'
import { DayList } from './DayList'
import { SessionPanel } from './SessionPanel'
import { WeekStrip } from './WeekStrip'

interface Props {
  settings: Settings
  profileName: string
  todayISO: string
  view: ViewMode
  selectedDateISO: string | null
  onSelectDate: (iso: string | null) => void
  filteredSessions: Session[]
  /** filtered sessions with in-range key dates woven in, time-sorted */
  scheduleSessions: Session[]
  /** membership set (all dates) — kept for callers; search uses `searchCorpus` */
  courseSessions: Session[]
  /** canonical search corpus: course members + personal events + task pins, all dates (TT-03) */
  searchCorpus: Session[]
  allKeyDates: Session[]
  keyDateDays: Set<string>
  monthExtras: { placementDays: Set<string>; breakStarts: Map<string, number> }
  metaMap: MetaMap
  coords: Coords | null
  travelMode: TravelMode
  activeCount: number
  filters: Filters
  sessionsLoaded: boolean
  onView: (v: ViewMode) => void
  onTogglePlacements: () => void
  onOpenFilters: () => void
  onClearFilters: () => void
  onSelect: (s: Session) => void
  onMeta: (session: Session, patch: Partial<SessionMeta>) => void
  /** add a personal event/study block on the given date (P5-06) */
  onAddPersonal: (dateISO: string) => void
}

function matchesQuery(s: Session, q: string): boolean {
  const needle = q.toLowerCase()
  return [s.title, s.subject, s.tutor, s.room].some((f) => f && f.toLowerCase().includes(needle))
}

const longDay = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })
}

function useMinWidth(px: number): boolean {
  const [match, setMatch] = useState(() => window.matchMedia(`(min-width: ${px}px)`).matches)
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${px}px)`)
    const onChange = (e: MediaQueryListEvent) => setMatch(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [px])
  return match
}

/**
 * Schedule destination. Mobile (P4-03): Week/Month control, seven-day strip
 * (or month grid) driving ONE selected-day list below. Desktop (P4-04 host):
 * the positioned week grid. Search and temporary filters live here.
 */
export function SchedulePage({
  settings,
  profileName,
  todayISO,
  view,
  selectedDateISO,
  onSelectDate,
  filteredSessions,
  scheduleSessions,
  searchCorpus,
  allKeyDates,
  keyDateDays,
  monthExtras,
  metaMap,
  coords,
  travelMode,
  activeCount,
  filters,
  sessionsLoaded,
  onView,
  onTogglePlacements,
  onOpenFilters,
  onClearFilters,
  onSelect,
  onMeta,
  onAddPersonal,
}: Props) {
  const wide = useMinWidth(1024)
  // ≥1280px: selection fills the side panel instead of opening the full
  // detail, so the calendar never jumps (P4-04).
  const hasPanel = useMinWidth(1280)
  // The panel stores a stable EVENT KEY, never a session object: the record
  // is resolved against current data on every render, so a refreshed room or
  // time shows up and a vanished record shows an honest notice (TT-15).
  const [panelKeySel, setPanelKeySel] = useState<string | null>(null)
  const [panelPinned, setPanelPinned] = useState(false)
  const panel = useMemo(
    () => (panelKeySel ? [...filteredSessions, ...allKeyDates].find((s) => panelKey(s) === panelKeySel) ?? null : null),
    [panelKeySel, filteredSessions, allKeyDates]
  )
  const setPanel = (s: Session | null) => {
    setPanelKeySel(s ? panelKey(s) : null)
    if (!s) setPanelPinned(false)
  }
  // Changing week closes the panel unless deliberately pinned.
  const weekOf = mondayOfISO(selectedDateISO ?? todayISO)
  useEffect(() => {
    if (!panelPinned) setPanelKeySel(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekOf])
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const mode: 'week' | 'month' = view === 'month' ? 'month' : 'week'
  const anchorISO = selectedDateISO ?? todayISO
  const handleSelect = (s: Session) => {
    if (wide && hasPanel && mode === 'week') setPanel(s)
    else onSelect(s)
  }

  // Search the canonical corpus (course members + personal + task pins) across
  // all dates, independent of temporary display filters, deduplicated by
  // owner identity upstream (TT-03). Query text never leaves the device.
  const searchResults = useMemo(() => {
    const q = query.trim()
    return q ? searchCorpus.filter((s) => matchesQuery(s, q)) : null
  }, [searchCorpus, query])

  const busyDays = useMemo(() => new Set(scheduleSessions.map((s) => s.dateISO)), [scheduleSessions])
  const daySessions = useMemo(
    () => scheduleSessions.filter((s) => s.dateISO === anchorISO),
    [scheduleSessions, anchorISO]
  )

  const dayHeading = (
    <div className="day-list-heading">
      <h2>
        {longDay(anchorISO)}
        {anchorISO === todayISO && <span className="badge badge-today">Today</span>}
      </h2>
      <span className="day-heading-actions">
        <span className="filter-hint">
          {daySessions.length === 0 ? 'No sessions' : `${daySessions.length} session${daySessions.length === 1 ? '' : 's'}`}
        </span>
        <button
          type="button"
          className="btn-icon"
          aria-label="Add a personal event on this day"
          title="Add a personal event on this day"
          onClick={() => onAddPersonal(anchorISO)}
        >
          ＋
        </button>
      </span>
    </div>
  )

  const emptyDay = (
    <div className="day-list-empty-wrap">
      <p className="week-free">No sessions on this day.</p>
      {activeCount > 0 && (
        <button type="button" className="btn-secondary" onClick={onClearFilters}>
          Clear filters ({activeCount} active)
        </button>
      )}
    </div>
  )

  return (
    <div className={`page page-schedule${wide ? ' page--wide' : ''}`}>
      <PageHeader
        title="Schedule"
        subtitle={profileName}
        actions={
          <>
            <button
              type="button"
              className="btn-icon"
              aria-label="Search"
              title="Search"
              onClick={() => {
                setSearchOpen((v) => {
                  if (!v) trackUse('search')
                  return !v
                })
                setQuery('')
              }}
            >
              <IconSearch />
            </button>
            <button type="button" className="btn-today-reset" onClick={() => onSelectDate(null)} title="Back to today">
              Today
            </button>
          </>
        }
      />
      <div className="header-stack schedule-toolbar">
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
        <div className="filterbar">
          <SegmentedControl
            label="View"
            value={mode}
            options={[
              { value: 'week', label: 'Week' },
              { value: 'month', label: 'Month' },
            ]}
            onChange={(v) => onView(v)}
          />
          <button
            type="button"
            className={`btn-filters btn-placements${filters.placementsOnly ? ' on' : ''}`}
            aria-pressed={filters.placementsOnly === true}
            title={filters.placementsOnly ? 'Showing placements only — tap to show everything' : 'Show placements only'}
            onClick={onTogglePlacements}
          >
            🏫
          </button>
          <button type="button" className="btn-filters" onClick={onOpenFilters}>
            Filters
            {activeCount > 0 && <span className="filter-count">{activeCount}</span>}
          </button>
        </div>
      </div>

      {!sessionsLoaded ? (
        <div className="empty-state">Loading timetable…</div>
      ) : searchResults ? (
        <>
        <p className="filter-hint search-scope-note">All dates; display filters not applied.</p>
        <AgendaView
          sessions={searchResults}
          onSelect={onSelect}
          metaMap={metaMap}
          todayISO={todayISO}
          termStartISO={settings.termStartISO}
          coords={coords}
          travelMode={travelMode}
          placements={settings.placements}
          emptyMessage={`No sessions match “${query.trim()}”.`}
        />
        </>
      ) : wide && mode === 'week' ? (
        <div className={`schedule-desktop${panelKeySel && hasPanel ? ' with-panel' : ''}`}>
          <div className="schedule-desktop-grid">
            <WeekView
              sessions={filteredSessions}
              keyDates={getFilters(settings).showKeyDates ? allKeyDates : []}
              todayISO={todayISO}
              anchorISO={anchorISO}
              onNavigate={(iso) => onSelectDate(iso === todayISO ? null : iso)}
              onSelect={handleSelect}
              termStartISO={settings.termStartISO}
              coords={coords}
              travelMode={travelMode}
              placements={settings.placements}
            />
          </div>
          {panel && hasPanel && (
            <SessionPanel
              session={panel}
              meta={metaMap[panelKey(panel)]}
              travelMode={travelMode}
              onMeta={onMeta}
              onOpenFull={(s) => onSelect(s)}
              onClose={() => setPanel(null)}
              pinned={panelPinned}
              onTogglePin={() => setPanelPinned((v) => !v)}
            />
          )}
          {!panel && panelKeySel && hasPanel && (
            <aside className="session-panel" aria-label="Selected session changed">
              <div className="session-panel-head">
                <span className="session-panel-kicker">Selected session</span>
                <button type="button" className="btn-icon" aria-label="Close panel" onClick={() => setPanel(null)}>
                  ✕
                </button>
              </div>
              <p className="filter-hint">This session changed or is no longer visible. Pick it again from the calendar.</p>
            </aside>
          )}
        </div>
      ) : mode === 'month' ? (
        <>
          <MonthView
            sessions={filteredSessions}
            todayISO={todayISO}
            anchorISO={anchorISO}
            onNavigate={(iso) => onSelectDate(iso === todayISO ? null : iso)}
            keyDateDays={getFilters(settings).showKeyDates ? keyDateDays : undefined}
            placementDays={monthExtras.placementDays}
            breakStarts={monthExtras.breakStarts}
            onPickDay={(dateISO) => {
              // Selection drives the shared date; desktop jumps to the week
              // grid, mobile keeps the list right below the calendar.
              onSelectDate(dateISO === todayISO ? null : dateISO)
              if (wide) onView('week')
            }}
          />
          {!wide && (
            <section aria-live="polite">
              {dayHeading}
              {daySessions.length === 0 ? (
                emptyDay
              ) : (
                <DayList
                  sessions={daySessions}
                  metaMap={metaMap}
                  coords={coords}
                  travelMode={travelMode}
                  placements={settings.placements}
                  emptyMessage="No sessions on this day."
                  onSelect={onSelect}
                />
              )}
            </section>
          )}
        </>
      ) : (
        <>
          <WeekStrip
            anchorISO={anchorISO}
            todayISO={todayISO}
            busyDays={busyDays}
            onSelect={(iso) => onSelectDate(iso === todayISO ? null : iso)}
            onShiftWeek={(delta) => {
              const next = addDaysISO(anchorISO, delta)
              onSelectDate(next === todayISO ? null : next)
            }}
          />
          <section aria-live="polite">
            {dayHeading}
            {daySessions.length === 0 ? (
              emptyDay
            ) : (
              <DayList
                sessions={daySessions}
                metaMap={metaMap}
                coords={coords}
                travelMode={travelMode}
                placements={settings.placements}
                emptyMessage="No sessions on this day."
                onSelect={onSelect}
              />
            )}
          </section>
        </>
      )}
    </div>
  )
}

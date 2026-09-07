import { useMemo, useState } from 'react'
import { AgendaView } from '../../components/AgendaView'
import { FilterBar } from '../../components/FilterBar'
import { MonthView } from '../../components/MonthView'
import { WeekView } from '../../components/WeekView'
import { IconSearch, PageHeader } from '../../components/ui'
import type { Coords, TravelMode } from '../../lib/campus'
import { getFilters } from '../../lib/filters'
import type { Filters, MetaMap, Session, Settings, ViewMode } from '../../types'

interface Props {
  settings: Settings
  profileName: string
  todayISO: string
  view: ViewMode
  selectedDateISO: string | null
  onSelectDate: (iso: string | null) => void
  filteredSessions: Session[]
  dayViewSessions: Session[]
  /** membership set (all dates) — the search corpus */
  courseSessions: Session[]
  allKeyDates: Session[]
  keyDateDays: Set<string>
  monthExtras: { placementDays: Set<string>; breakStarts: Map<string, number> }
  metaMap: MetaMap
  coords: Coords | null
  travelMode: TravelMode
  showHistory: boolean
  onToggleHistory: () => void
  activeCount: number
  filters: Filters
  sessionsLoaded: boolean
  emptyMessage: string
  placementProgress?: { attended: number; target?: number; openTargets?: number }
  onView: (v: ViewMode) => void
  onTogglePlacements: () => void
  onOpenFilters: () => void
  onSelect: (s: Session) => void
  onUpdateFilters: (patch: Partial<Filters>) => void
}

function matchesQuery(s: Session, q: string): boolean {
  const needle = q.toLowerCase()
  return [s.title, s.subject, s.tutor, s.room].some((f) => f && f.toLowerCase().includes(needle))
}

/**
 * Schedule destination (P4-03/P4-04 host): Week/Month with the shared selected
 * date, search and filters scoped here, Today reset in the header.
 */
export function SchedulePage({
  settings,
  profileName,
  todayISO,
  view,
  selectedDateISO,
  onSelectDate,
  filteredSessions,
  dayViewSessions,
  courseSessions,
  allKeyDates,
  keyDateDays,
  monthExtras,
  metaMap,
  coords,
  travelMode,
  showHistory,
  onToggleHistory,
  activeCount,
  filters,
  sessionsLoaded,
  emptyMessage,
  placementProgress,
  onView,
  onTogglePlacements,
  onOpenFilters,
  onSelect,
}: Props) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')

  const searchResults = useMemo(() => {
    const q = query.trim()
    return q ? [...courseSessions, ...allKeyDates].filter((s) => matchesQuery(s, q)) : null
  }, [courseSessions, allKeyDates, query])

  return (
    <div className="page page-schedule">
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
                setSearchOpen((v) => !v)
                setQuery('')
              }}
            >
              <IconSearch />
            </button>
            <button
              type="button"
              className="btn-today-reset"
              onClick={() => onSelectDate(null)}
              title="Back to today"
            >
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
        <FilterBar
          view={view}
          activeCount={activeCount}
          placementsOnly={filters.placementsOnly === true}
          historyOn={showHistory}
          onToggleHistory={onToggleHistory}
          onView={onView}
          onTogglePlacements={onTogglePlacements}
          onOpenFilters={onOpenFilters}
        />
      </div>

      {!sessionsLoaded ? (
        <div className="empty-state">Loading timetable…</div>
      ) : searchResults ? (
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
      ) : view === 'week' ? (
        <WeekView
          sessions={filteredSessions}
          keyDates={getFilters(settings).showKeyDates ? allKeyDates : []}
          todayISO={todayISO}
          anchorISO={selectedDateISO ?? todayISO}
          onNavigate={(iso) => onSelectDate(iso === todayISO ? null : iso)}
          onSelect={onSelect}
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
          onNavigate={(iso) => onSelectDate(iso === todayISO ? null : iso)}
          keyDateDays={getFilters(settings).showKeyDates ? keyDateDays : undefined}
          placementDays={monthExtras.placementDays}
          breakStarts={monthExtras.breakStarts}
          onPickDay={(dateISO) => {
            onSelectDate(dateISO === todayISO ? null : dateISO)
            onView('day')
          }}
        />
      ) : (
        <AgendaView
          sessions={dayViewSessions}
          scrollTo={selectedDateISO}
          todayISO={todayISO}
          onToday={() => onSelectDate(null)}
          onSelect={onSelect}
          metaMap={metaMap}
          termStartISO={settings.termStartISO}
          coords={coords}
          travelMode={travelMode}
          placements={settings.placements}
          placementProgress={placementProgress}
          windowed
          showAllPast={showHistory}
          emptyMessage={emptyMessage}
        />
      )}
    </div>
  )
}

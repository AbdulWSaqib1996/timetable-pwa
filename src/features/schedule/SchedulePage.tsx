import { useEffect, useMemo, useState } from 'react'
import { addDaysISO } from '../../../shared/calendar-time.js'
import { AgendaView } from '../../components/AgendaView'
import { MonthView } from '../../components/MonthView'
import { WeekView } from '../../components/WeekView'
import { IconSearch, PageHeader, SegmentedControl } from '../../components/ui'
import type { Coords, TravelMode } from '../../lib/campus'
import { getFilters } from '../../lib/filters'
import { trackUse } from '../../lib/usage'
import type { Filters, MetaMap, Session, Settings, ViewMode } from '../../types'
import { DayList } from './DayList'
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
  /** membership set (all dates) — the search corpus */
  courseSessions: Session[]
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
}

function matchesQuery(s: Session, q: string): boolean {
  const needle = q.toLowerCase()
  return [s.title, s.subject, s.tutor, s.room].some((f) => f && f.toLowerCase().includes(needle))
}

const longDay = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })
}

function useWide(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 1024px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const onChange = (e: MediaQueryListEvent) => setWide(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return wide
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
  courseSessions,
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
}: Props) {
  const wide = useWide()
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const mode: 'week' | 'month' = view === 'month' ? 'month' : 'week'
  const anchorISO = selectedDateISO ?? todayISO

  const searchResults = useMemo(() => {
    const q = query.trim()
    return q ? [...courseSessions, ...allKeyDates].filter((s) => matchesQuery(s, q)) : null
  }, [courseSessions, allKeyDates, query])

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
      <span className="filter-hint">
        {daySessions.length === 0 ? 'No sessions' : `${daySessions.length} session${daySessions.length === 1 ? '' : 's'}`}
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
      ) : wide && mode === 'week' ? (
        <WeekView
          sessions={filteredSessions}
          keyDates={getFilters(settings).showKeyDates ? allKeyDates : []}
          todayISO={todayISO}
          anchorISO={anchorISO}
          onNavigate={(iso) => onSelectDate(iso === todayISO ? null : iso)}
          onSelect={onSelect}
          termStartISO={settings.termStartISO}
          coords={coords}
          travelMode={travelMode}
          placements={settings.placements}
        />
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

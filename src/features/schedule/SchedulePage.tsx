import { useEffect, useMemo, useState } from 'react'
import { addDaysISO, mondayOfISO } from '../../../shared/calendar-time.js'
import { AgendaView } from '../../components/AgendaView'
import { MonthView } from '../../components/MonthView'
import { WeekView } from '../../components/WeekView'
import { IconClose, IconPlus, IconSchool, IconSearch, PageHeader, QuickMenu, SegmentedControl, SettingsAction, StatusMessage } from '../../components/ui'
import type { PlanChildRec } from '../../lib/admin'
import type { Coords, TravelMode } from '../../lib/campus'
import { sessionKey as panelKey } from '../../lib/diff'
import { getFilters } from '../../lib/filters'
import { courseZone } from '../../lib/course'
import { formatRemaining, toMinutes } from '../../lib/format'
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
  onOpenSettings: () => void
  /** Plan week suggestions over this week (R4 / NF-03) */
  onPlanWeek: () => void
  /** the local Find anything page (R4 / NF-01) */
  onFindAnything: () => void
  /** a study block just added from a suggestion — Undo removes it */
  planUndo: PlanChildRec | null
  onUndoPlan: (block: PlanChildRec) => void
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
  onOpenSettings,
  onPlanWeek,
  onFindAnything,
  planUndo,
  onUndoPlan,
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
  const mode: 'week' | 'month' | 'list' = view === 'month' ? 'month' : view === 'list' ? 'list' : 'week'
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

  // Day summary (V2): a count and the scheduled hours — a sum of real
  // durations, never a workload estimate. Key dates and free time don't count.
  const dayTimed = daySessions.filter((s) => !s.isKeyDate && !s.isFreeTime)
  const dayMinutes = dayTimed.reduce((sum, s) => {
    const a = toMinutes(s.start)
    const b = toMinutes(s.end)
    return a !== null && b !== null && b > a ? sum + (b - a) : sum
  }, 0)
  const daySummary =
    dayTimed.length === 0
      ? daySessions.length === 0
        ? 'No sessions'
        : `${daySessions.length} item${daySessions.length === 1 ? '' : 's'}`
      : `${dayTimed.length} session${dayTimed.length === 1 ? '' : 's'}${dayMinutes > 0 ? ` · ${formatRemaining(dayMinutes)} scheduled` : ''}`
  const dayHeading = (
    <div className="day-list-heading">
      <div className="day-list-heading-text">
        <h2>
          {longDay(anchorISO)}
          {anchorISO === todayISO && <span className="badge badge-today">Today</span>}
        </h2>
        <p className="day-summary">{daySummary}</p>
      </div>
      <span className="day-heading-actions">
        <button
          type="button"
          className="btn-icon"
          aria-label="Add a personal event on this day"
          title="Add a personal event on this day"
          onClick={() => onAddPersonal(anchorISO)}
        >
          <IconPlus />
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
        subtitle={`${profileName} · ${courseZone() === 'Europe/London' ? 'London time' : courseZone()}`}
        actions={
          <>
            <button
              type="button"
              className="btn-icon"
              aria-label="Search"
              title="Search"
              onClick={() => {
                // Blur first: removing a focused input while the keyboard is up
                // leaves iOS fixed elements stuck at the keyboard's edge.
                ;(document.activeElement as HTMLElement | null)?.blur?.()
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
            <SettingsAction onOpen={onOpenSettings} />
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
            <button type="button" className="travel-link search-everything" onClick={onFindAnything}>
              Search everything →
            </button>
          </div>
        )}
        <div className="filterbar">
          <SegmentedControl
            label="View"
            value={mode}
            options={[
              { value: 'week', label: 'Week' },
              { value: 'month', label: 'Month' },
              { value: 'list', label: 'List' },
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
            <IconSchool />
            <span>Placements</span>
          </button>
          <button type="button" className="btn-filters" onClick={onOpenFilters}>
            Filters
            {activeCount > 0 && <span className="filter-count">{activeCount}</span>}
          </button>
          {wide ? (
            <button type="button" className="btn-filters" onClick={onPlanWeek} title="Suggested gaps this week">
              Plan week
            </button>
          ) : (
            // Mobile (V2): secondary functions live in a labelled More menu —
            // grouped, never removed.
            <QuickMenu
              label="More"
              tone="secondary"
              items={[
                { label: 'Plan week', onSelect: onPlanWeek },
                { label: 'Search everything', onSelect: onFindAnything },
                { label: 'Add a personal event', onSelect: () => onAddPersonal(anchorISO) },
              ]}
            />
          )}
        </div>
      </div>

      {planUndo && (
        <div className="schedule-undo">
          <StatusMessage tone="info">
            <span>
              Added study block “{planUndo.title}” on {planUndo.dateISO} {planUndo.startTime}–{planUndo.endTime}.{' '}
              <button type="button" className="travel-link" onClick={() => onUndoPlan(planUndo)}>
                Undo
              </button>
            </span>
          </StatusMessage>
        </div>
      )}

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
      ) : mode === 'list' ? (
        // List (R3 / §5): a first-class accessible alternative over the SAME
        // filtered data and shared date anchor as Week and Month — the strip
        // moves the anchor, the agenda scrolls to it, every record stays a
        // focusable button opening the same detail.
        <section className="schedule-list" aria-label="List view">
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
          <p className="filter-hint search-scope-note">
            Every day from {longDay(anchorISO)} onward, with your display filters applied
            {activeCount > 0 ? ` (${activeCount} active)` : ''}.
          </p>
          <AgendaView
            sessions={scheduleSessions}
            onSelect={onSelect}
            metaMap={metaMap}
            todayISO={todayISO}
            onToday={() => onSelectDate(null)}
            scrollTo={anchorISO}
            termStartISO={settings.termStartISO}
            coords={coords}
            travelMode={travelMode}
            placements={settings.placements}
            windowed
            showAllPast={anchorISO < todayISO}
            emptyMessage="No sessions match the current filters."
          />
        </section>
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
                  <IconClose />
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
            {!wide && (
              <button type="button" className="btn-secondary btn-wide schedule-plan-cta" onClick={onPlanWeek}>
                Plan study time this week
              </button>
            )}
          </section>
        </>
      )}
    </div>
  )
}

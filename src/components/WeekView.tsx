import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { addDaysISO, mondayOfISO } from '../../shared/calendar-time.js'
import { assignLanesByComponent } from '../../shared/intervals.js'
import type { Coords, TravelMode } from '../lib/campus'
import { isPlacementSession, placementTag, sessionKindLabel, subjectColor, toMinutes as toMins, weekNumber } from '../lib/format'
import { parseLocation, shortBuildingName } from '../lib/location'
import { cachedWeatherForHour, weatherForHour } from '../lib/weather'
import { shareWeekImage } from '../lib/weekImage'
import type { Session } from '../types'
import { SessionCard } from './SessionCard'
import { Dialog, IconChevronLeft, IconChevronRight, IconClose, IconShare } from './ui'

interface Props {
  sessions: Session[]
  /** merged key dates (sheet + personal) shown as pins on their day */
  keyDates?: Session[]
  todayISO: string
  /** the single selected date shared with Day/Month (defaults to today) */
  anchorISO: string
  /** week navigation moves the shared selected date */
  onNavigate: (dateISO: string) => void
  onSelect: (session: Session) => void
  termStartISO?: string
  coords?: Coords | null
  travelMode?: TravelMode
  /** user-entered placement details, for the school name on placement events */
  placements?: Record<string, { school?: string }>
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fromISO(dateISO: string): Date {
  const [y, m, d] = dateISO.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function addDays(dateISO: string, days: number): string {
  const d = fromISO(dateISO)
  d.setDate(d.getDate() + days)
  return iso(d)
}

function mondayOf(dateISO: string): string {
  const d = fromISO(dateISO)
  const dow = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - dow)
  return iso(d)
}

function toMinutes(time: string): number | null {
  const m = time.match(/^(\d{1,2}):(\d{2})$/)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

type Timed = { session: Session; start: number; end: number }
type Component = { items: Timed[]; start: number; end: number; lanes: number; placed: { session: Session; lane: number; lanes: number }[] }

/**
 * Connected overlap components (R2 / TT-14 → V2): the same sweep the shared
 * lane assignment uses, so a component is exactly the set of records that
 * would share lanes. `lanes` is the component's maximum concurrency.
 */
function componentsOf(daySessions: Session[]): Component[] {
  const items: Timed[] = daySessions.map((session) => {
    const start = toMinutes(session.start) ?? 0
    return { session, start, end: Math.max(toMinutes(session.end) ?? start + 60, start + 1) }
  })
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end)
  const out: Component[] = []
  let current: Timed[] = []
  let currentEnd = -Infinity
  const flush = () => {
    if (current.length === 0) return
    const placed = assignLanesByComponent(current).map(({ item, lane, lanes }) => ({ session: (item as Timed).session, lane, lanes }))
    out.push({
      items: current,
      start: Math.min(...current.map((x) => x.start)),
      end: Math.max(...current.map((x) => x.end)),
      lanes: placed[0]?.lanes ?? 1,
      placed,
    })
    current = []
    currentEnd = -Infinity
  }
  for (const x of sorted) {
    if (current.length > 0 && x.start >= currentEnd) flush()
    current.push(x)
    currentEnd = Math.max(currentEnd, x.end)
  }
  flush()
  return out
}

function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 639px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)')
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return narrow
}

/** Appearance → Density drives the grid's hour height (comfortable 68px, compact 56px). */
function useCompactDensity(): boolean {
  const read = () => document.documentElement.getAttribute('data-density') === 'compact'
  const [compact, setCompact] = useState(read)
  useEffect(() => {
    const obs = new MutationObserver(() => setCompact(read()))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-density'] })
    return () => obs.disconnect()
  }, [])
  return compact
}

const HOUR_PX_COMFORTABLE = 68
const HOUR_PX_COMPACT = 56
const HOURS_COL_PX = 52
/** Below this measured lane width, overlapping records are grouped (V-09). */
export const MIN_LANE_PX = 100

const hhmmRange = (s: Session) => `${s.start}${s.end && s.end !== s.start ? `–${s.end}` : ''}`

export function WeekView({ sessions, keyDates = [], todayISO, anchorISO, onNavigate, onSelect, termStartISO, coords, travelMode, placements }: Props) {
  const weekStart = mondayOfISO(anchorISO)
  const isNarrow = useIsNarrow()
  const compact = useCompactDensity()
  const hourPx = compact ? HOUR_PX_COMPACT : HOUR_PX_COMFORTABLE
  const wkNum = termStartISO ? weekNumber(weekStart, termStartISO) : null

  const [weatherReady, setWeatherReady] = useState(false)
  useEffect(() => {
    void weatherForHour(todayISO, 12).then((w) => setWeatherReady(w !== null))
  }, [todayISO])
  const weatherFor = (s: Session) => {
    if (!weatherReady || s.dateISO < todayISO || !s.start) return null
    const mins = toMins(s.start)
    return mins === null ? null : cachedWeatherForHour(s.dateISO, Math.floor(mins / 60))
  }

  // Visible days: weekdays always, a weekend day whenever ANY visible record
  // (timed event OR deadline pin) falls on it — a Saturday-only deadline can
  // never vanish (TT-04). `showWeekend` forces all seven.
  const [showWeekend, setShowWeekend] = useState(false)
  const weekDays = useMemo(() => {
    const base = [0, 1, 2, 3, 4].map((i) => addDays(weekStart, i))
    const weekend = [5, 6].map((i) => addDays(weekStart, i))
    const withRecords = new Set([...sessions.map((s) => s.dateISO), ...keyDates.map((k) => k.dateISO)])
    return [...base, ...weekend.filter((d) => showWeekend || withRecords.has(d))]
  }, [sessions, keyDates, weekStart, showWeekend])
  const [expandedPins, setExpandedPins] = useState<string | null>(null)

  const byDay = useMemo(() => {
    const map = new Map<string, Session[]>()
    for (const s of sessions) {
      if (weekDays.includes(s.dateISO)) {
        map.set(s.dateISO, [...(map.get(s.dateISO) ?? []), s])
      }
    }
    return map
  }, [sessions, weekDays])

  const keyDatesByDay = useMemo(() => {
    const map = new Map<string, Session[]>()
    for (const kd of keyDates) {
      if (weekDays.includes(kd.dateISO)) map.set(kd.dateISO, [...(map.get(kd.dateISO) ?? []), kd])
    }
    return map
  }, [keyDates, weekDays])

  const { minHour, maxHour } = useMemo(() => {
    let min = 9
    let max = 17
    for (const list of byDay.values()) {
      for (const s of list) {
        const start = toMinutes(s.start)
        const end = toMinutes(s.end)
        if (start !== null) min = Math.min(min, Math.floor(start / 60))
        if (end !== null) max = Math.max(max, Math.ceil(end / 60))
      }
    }
    return { minHour: min, maxHour: max }
  }, [byDay])

  // Measured column width decides whether a component's lanes stay readable
  // (V-09): grouping is a measurement, never a guess from the viewport.
  const gridRef = useRef<HTMLDivElement>(null)
  const [gridWidth, setGridWidth] = useState<number | null>(null)
  useLayoutEffect(() => {
    const el = gridRef.current
    if (!el) return
    setGridWidth(el.getBoundingClientRect().width)
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setGridWidth(entry.contentRect.width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [isNarrow])
  const columnWidth = gridWidth === null ? null : (gridWidth - HOURS_COL_PX) / Math.max(1, weekDays.length)

  const [group, setGroup] = useState<{ dateISO: string; items: Session[] } | null>(null)
  // A grouped selection follows identity: if the week changes, the dialog closes.
  useEffect(() => setGroup(null), [weekStart])

  // Legend from the canonical subjects actually visible this week — never a
  // guess from titles; self study and placements have their own fixed keys.
  const legend = useMemo(() => {
    const seen = new Map<string, { label: string; color: string; className?: string }>()
    for (const list of byDay.values()) {
      for (const s of list) {
        if (s.isSelfStudy) seen.set('self-study', { label: 'Self study', color: 'var(--text-muted)' })
        else if (isPlacementSession(s)) seen.set('placement', { label: 'Placement', color: 'var(--saved-text)' })
        else {
          const key = (s.subject || s.title).trim()
          const color = subjectColor(s)
          if (color && !seen.has(key)) seen.set(key, { label: key, color })
        }
      }
    }
    return [...seen.values()]
  }, [byDay])

  const isCurrentWeek = weekStart === mondayOf(todayISO)
  const weekLabel = `${fromISO(weekStart).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${fromISO(addDays(weekStart, 6)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`

  const nav = (
    <div className="week-nav">
      <button type="button" className="btn-icon" onClick={() => onNavigate(addDaysISO(anchorISO, -7))} aria-label="Previous week">
        <IconChevronLeft />
      </button>
      <button
        type="button"
        className={`week-label${isCurrentWeek ? '' : ' clickable'}`}
        onClick={() => onNavigate(todayISO)}
        title={isCurrentWeek ? undefined : 'Back to this week'}
      >
        {weekLabel}
        {wkNum !== null && <span className="week-current"> · Wk {wkNum}</span>}
        {isCurrentWeek && <span className="week-current"> · this week</span>}
      </button>
      <button type="button" className="btn-icon" onClick={() => onNavigate(addDaysISO(anchorISO, 7))} aria-label="Next week">
        <IconChevronRight />
      </button>
      <button
        type="button"
        className="btn-icon"
        onClick={() =>
          void shareWeekImage(
            weekDays.map((dateISO) => ({
              label: fromISO(dateISO).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' }),
              sessions: byDay.get(dateISO) ?? [],
            })),
            weekLabel
          )
        }
        aria-label="Share week as image"
        title="Share week as image"
      >
        <IconShare />
      </button>
    </div>
  )

  if (isNarrow) {
    return (
      <div className="week-view">
        {nav}
        {weekDays.map((dateISO) => {
          const list = byDay.get(dateISO) ?? []
          return (
            <section key={dateISO} className={`agenda-day${dateISO < todayISO ? ' past' : ''}${dateISO === anchorISO && anchorISO !== todayISO ? ' selected-day' : ''}`}>
              <h2 className="day-header day-header-flat">
                <span>{fromISO(dateISO).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}</span>
                {dateISO === todayISO && <span className="badge badge-today">Today</span>}
              </h2>
              {(keyDatesByDay.get(dateISO) ?? []).map((kd) => (
                <SessionCard key={kd.id} session={kd} onSelect={onSelect} />
              ))}
              {list.length === 0 ? (
                <p className="week-free">No sessions</p>
              ) : (
                <div className="day-sessions">
                  {list.map((s) => (
                    <SessionCard
                      key={s.id}
                      session={s}
                      coords={coords}
                      travelMode={travelMode}
                      weather={weatherFor(s)}
                      onSelect={onSelect}
                    />
                  ))}
                </div>
              )}
            </section>
          )
        })}
      </div>
    )
  }

  const hours = Array.from({ length: maxHour - minHour }, (_, i) => minHour + i)
  const gridHeight = (maxHour - minHour) * hourPx
  const eventPlace = (s: Session): string | null => {
    if (s.isSelfStudy || !s.room) return null
    const loc = parseLocation(s.room)
    if (loc.building && loc.room) return `${shortBuildingName(loc)} · ${loc.room}`
    if (loc.note) return 'Room TBC'
    return s.room
  }

  return (
    <div className="week-view">
      {nav}
      <p className="filter-hint week-days-toggle">
        <button type="button" className="travel-link" aria-pressed={showWeekend} onClick={() => setShowWeekend((v) => !v)}>
          {showWeekend ? 'Hide empty weekend' : 'Show all seven days'}
        </button>
      </p>
      <div ref={gridRef} className={`week-grid${compact ? ' week-grid--compact' : ''}`} style={{ gridTemplateColumns: `${HOURS_COL_PX}px repeat(${weekDays.length}, minmax(0, 1fr))` }}>
        <div />
        {weekDays.map((dateISO) => (
          <div key={dateISO} className={`week-col-head${dateISO === todayISO ? ' today' : ''}${dateISO === anchorISO && anchorISO !== todayISO ? ' selected' : ''}`}>
            <span className="week-col-head-day">
              {fromISO(dateISO).toLocaleDateString('en-GB', { weekday: 'short' })} <strong>{fromISO(dateISO).getDate()}</strong>
            </span>
            {(() => {
              const pins = keyDatesByDay.get(dateISO) ?? []
              const open = expandedPins === dateISO
              const shown = open ? pins : pins.slice(0, 2)
              return (
                <>
                  {shown.map((kd) => (
                    <button key={kd.id} type="button" className="week-keydate" title={kd.title} onClick={() => onSelect(kd)}>
                      {kd.title.length > 18 ? kd.title.slice(0, 18) + '…' : kd.title}
                    </button>
                  ))}
                  {pins.length > 2 && (
                    <button
                      type="button"
                      className="week-keydate week-keydate-more"
                      aria-expanded={open}
                      aria-label={open ? `Show fewer deadlines for ${dateISO}` : `${pins.length - 2} more deadlines on ${dateISO}`}
                      onClick={() => setExpandedPins(open ? null : dateISO)}
                    >
                      {open ? 'Show fewer' : `+${pins.length - 2} more`}
                    </button>
                  )}
                </>
              )
            })()}
          </div>
        ))}
        <div className="week-hours" style={{ height: gridHeight }}>
          {hours.map((h) => (
            <div key={h} className="week-hour" style={{ top: (h - minHour) * hourPx }}>
              {String(h).padStart(2, '0')}:00
            </div>
          ))}
        </div>
        {weekDays.map((dateISO) => (
          <div key={dateISO} className={`week-col${dateISO === todayISO ? ' today' : ''}`} style={{ height: gridHeight }}>
            {hours.map((h) => (
              <div key={h} className="week-hour-line" style={{ top: (h - minHour) * hourPx }} />
            ))}
            {componentsOf(byDay.get(dateISO) ?? []).flatMap((component) => {
              const laneWidth = columnWidth === null ? Infinity : columnWidth / component.lanes
              if (component.lanes >= 2 && laneWidth < MIN_LANE_PX) {
                // Unreadable lanes → one honest group covering the component's
                // real time span. The count is exact; every record stays
                // reachable from the dialog it opens (V-09).
                const n = component.items.length
                const top = ((component.start - minHour * 60) / 60) * hourPx
                const height = Math.max(40, ((component.end - component.start) / 60) * hourPx - 2)
                const titles = component.items.map((x) => x.session.title)
                const kind = component.lanes === n ? 'parallel' : 'overlapping'
                const range = `${String(Math.floor(component.start / 60)).padStart(2, '0')}:${String(component.start % 60).padStart(2, '0')}–${String(Math.floor(component.end / 60)).padStart(2, '0')}:${String(component.end % 60).padStart(2, '0')}`
                return [
                  <button
                    key={`group-${dateISO}-${component.start}`}
                    type="button"
                    className="week-group"
                    style={{ top, height }}
                    aria-haspopup="dialog"
                    aria-label={`${n} ${kind} sessions, ${range}: ${titles.join('; ')}. Opens a list`}
                    onClick={() => setGroup({ dateISO, items: component.items.map((x) => x.session) })}
                  >
                    <span className="week-event-time">{range}</span>
                    <span className="week-group-count">
                      {n} {kind} sessions
                    </span>
                    <span className="week-group-titles">{titles.join(' · ')}</span>
                  </button>,
                ]
              }
              return component.placed.map(({ session, lane, lanes }) => {
                const start = toMinutes(session.start) ?? minHour * 60
                const end = toMinutes(session.end) ?? start + 60
                const top = ((start - minHour * 60) / 60) * hourPx
                const height = Math.max(24, ((end - start) / 60) * hourPx - 2)
                const placement = !session.isKeyDate && isPlacementSession(session)
                const color = placement ? 'var(--saved-text)' : subjectColor(session)
                const school = placement ? placements?.[placementTag(session.title)]?.school : undefined
                const place = eventPlace(session)
                return (
                  <button
                    key={session.id}
                    type="button"
                    className={`week-event${session.isSelfStudy ? ' self-study' : ''}${placement ? ' placement' : ''}`}
                    style={{
                      top,
                      height,
                      left: `calc(${(lane / lanes) * 100}% + 1px)`,
                      width: `calc(${100 / lanes}% - 3px)`,
                      ...(color ? { borderLeftColor: color } : {}),
                    }}
                    onClick={() => onSelect(session)}
                    title={school ? `${session.title} · ${school}` : session.title}
                  >
                    <span className="week-event-time">{height >= 40 ? hhmmRange(session) : session.start}</span>
                    <span className="week-event-title">{session.title}</span>
                    {height >= 64 && (school || place) && <span className="week-event-meta">{school ?? place}</span>}
                    {height >= 88 && !school && <span className="week-event-meta">{sessionKindLabel(session)}</span>}
                  </button>
                )
              })
            })}
          </div>
        ))}
      </div>
      {legend.length > 0 && (
        <ul className="week-legend" aria-label="Colour key">
          {legend.map((item) => (
            <li key={item.label}>
              <span className="week-legend-swatch" style={{ background: item.color }} aria-hidden="true" />
              {item.label}
            </li>
          ))}
        </ul>
      )}
      <p className="filter-hint week-grid-note">Grouped sessions open a list of every option. All events keep their real start and end times.</p>
      {group && (
        <Dialog label={`${group.items.length} sessions on ${fromISO(group.dateISO).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}`} onClose={() => setGroup(null)}>
          <div className="sheet-header">
            <h2>
              {group.items.length} sessions · {fromISO(group.dateISO).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
            </h2>
            <button type="button" className="btn-icon" onClick={() => setGroup(null)} aria-label="Close">
              <IconClose />
            </button>
          </div>
          <p className="filter-hint">These sessions overlap, so the calendar shows them as one group. Each keeps its own record.</p>
          <div className="day-sessions week-group-list">
            {group.items.map((s) => (
              <SessionCard
                key={s.id}
                session={s}
                coords={coords}
                travelMode={travelMode}
                weather={weatherFor(s)}
                onSelect={(picked) => {
                  setGroup(null)
                  onSelect(picked)
                }}
              />
            ))}
          </div>
        </Dialog>
      )}
    </div>
  )
}

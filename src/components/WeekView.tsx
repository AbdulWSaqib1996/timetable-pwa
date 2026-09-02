import { useEffect, useMemo, useState } from 'react'
import type { Coords, TravelMode } from '../lib/campus'
import { subjectColor, toMinutes as toMins, weekNumber } from '../lib/format'
import { cachedWeatherForHour, weatherForHour } from '../lib/weather'
import { shareWeekImage } from '../lib/weekImage'
import type { Session } from '../types'
import { SessionCard } from './SessionCard'

interface Props {
  sessions: Session[]
  todayISO: string
  onSelect: (session: Session) => void
  termStartISO?: string
  coords?: Coords | null
  travelMode?: TravelMode
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

/** Assign overlapping sessions to side-by-side lanes within a day column. */
function assignLanes(daySessions: Session[]): { session: Session; lane: number; lanes: number }[] {
  const sorted = [...daySessions].sort((a, b) => (a.start || '').localeCompare(b.start || ''))
  const laneEnds: number[] = []
  const placed = sorted.map((session) => {
    const start = toMinutes(session.start) ?? 0
    const end = toMinutes(session.end) ?? start + 60
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(end)
    } else {
      laneEnds[lane] = end
    }
    return { session, lane, end }
  })
  const lanes = Math.max(1, laneEnds.length)
  return placed.map(({ session, lane }) => ({ session, lane, lanes }))
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

const HOUR_PX = 56

export function WeekView({ sessions, todayISO, onSelect, termStartISO, coords, travelMode }: Props) {
  const [weekStart, setWeekStart] = useState(() => mondayOf(todayISO))
  const isNarrow = useIsNarrow()
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

  const weekDays = useMemo(() => {
    const base = [0, 1, 2, 3, 4].map((i) => addDays(weekStart, i))
    const weekend = [5, 6].map((i) => addDays(weekStart, i))
    const withSessions = new Set(sessions.map((s) => s.dateISO))
    return [...base, ...weekend.filter((d) => withSessions.has(d))]
  }, [weekStart, sessions])

  const byDay = useMemo(() => {
    const map = new Map<string, Session[]>()
    for (const s of sessions) {
      if (weekDays.includes(s.dateISO)) {
        map.set(s.dateISO, [...(map.get(s.dateISO) ?? []), s])
      }
    }
    return map
  }, [sessions, weekDays])

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

  const isCurrentWeek = weekStart === mondayOf(todayISO)
  const weekLabel = `${fromISO(weekStart).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${fromISO(addDays(weekStart, 6)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`

  const nav = (
    <div className="week-nav">
      <button type="button" className="btn-icon" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Previous week">
        ‹
      </button>
      <button
        type="button"
        className={`week-label${isCurrentWeek ? '' : ' clickable'}`}
        onClick={() => setWeekStart(mondayOf(todayISO))}
        title={isCurrentWeek ? undefined : 'Back to this week'}
      >
        {weekLabel}
        {wkNum !== null && <span className="week-current"> · Wk {wkNum}</span>}
        {isCurrentWeek && <span className="week-current"> · this week</span>}
      </button>
      <button type="button" className="btn-icon" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Next week">
        ›
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
        📸
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
            <section key={dateISO} className={dateISO < todayISO ? 'agenda-day past' : 'agenda-day'}>
              <h2 className="day-header day-header-flat">
                <span>{fromISO(dateISO).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}</span>
                {dateISO === todayISO && <span className="badge badge-today">Today</span>}
              </h2>
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
  const gridHeight = (maxHour - minHour) * HOUR_PX

  return (
    <div className="week-view">
      {nav}
      <div className="week-grid" style={{ gridTemplateColumns: `48px repeat(${weekDays.length}, 1fr)` }}>
        <div />
        {weekDays.map((dateISO) => (
          <div key={dateISO} className={`week-col-head${dateISO === todayISO ? ' today' : ''}`}>
            {fromISO(dateISO).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })}
          </div>
        ))}
        <div className="week-hours" style={{ height: gridHeight }}>
          {hours.map((h) => (
            <div key={h} className="week-hour" style={{ top: (h - minHour) * HOUR_PX }}>
              {String(h).padStart(2, '0')}:00
            </div>
          ))}
        </div>
        {weekDays.map((dateISO) => (
          <div key={dateISO} className={`week-col${dateISO === todayISO ? ' today' : ''}`} style={{ height: gridHeight }}>
            {hours.map((h) => (
              <div key={h} className="week-hour-line" style={{ top: (h - minHour) * HOUR_PX }} />
            ))}
            {assignLanes(byDay.get(dateISO) ?? []).map(({ session, lane, lanes }) => {
              const start = toMinutes(session.start) ?? minHour * 60
              const end = toMinutes(session.end) ?? start + 60
              const top = ((start - minHour * 60) / 60) * HOUR_PX
              const height = Math.max(24, ((end - start) / 60) * HOUR_PX - 2)
              const color = subjectColor(session)
              return (
                <button
                  key={session.id}
                  type="button"
                  className={`week-event${session.isSelfStudy ? ' self-study' : ''}`}
                  style={{
                    top,
                    height,
                    left: `calc(${(lane / lanes) * 100}% + 1px)`,
                    width: `calc(${100 / lanes}% - 3px)`,
                    ...(color ? { borderLeftColor: color } : {}),
                  }}
                  onClick={() => onSelect(session)}
                  title={session.title}
                >
                  <span className="week-event-time">{session.start}</span>
                  <span className="week-event-title">{session.title}</span>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

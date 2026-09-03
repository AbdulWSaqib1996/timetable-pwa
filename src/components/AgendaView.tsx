import { useEffect, useMemo, useRef, useState } from 'react'
import type { Coords, TravelMode } from '../lib/campus'
import { sessionKey } from '../lib/diff'
import { toMinutes, weekNumber } from '../lib/format'
import { cachedWeatherForHour, weatherForHour } from '../lib/weather'
import type { MetaMap, Session } from '../types'
import { SessionCard } from './SessionCard'

interface Props {
  sessions: Session[]
  emptyMessage?: string
  onSelect: (session: Session) => void
  /** Scroll target (yyyy-mm-dd); defaults to today / next day with sessions. */
  scrollTo?: string | null
  metaMap?: MetaMap
  termStartISO?: string
  coords?: Coords | null
  travelMode?: TravelMode
  /** limit rendering to a window around today, with show-earlier/show-later controls */
  windowed?: boolean
}

function addDaysISO(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split('-').map(Number)
  const date = new Date(y, m - 1, d + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function localTodayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatDayHeader(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  })
}

export function AgendaView({
  sessions,
  emptyMessage,
  onSelect,
  scrollTo,
  metaMap,
  termStartISO,
  coords,
  travelMode,
  windowed,
}: Props) {
  const todayISO = localTodayISO()
  const anchorRef = useRef<HTMLElement | null>(null)
  const [pastDays, setPastDays] = useState(7)
  const [futureDays, setFutureDays] = useState(60)

  // Warm the 7-day forecast once so per-card lookups are synchronous.
  const [weatherReady, setWeatherReady] = useState(false)
  useEffect(() => {
    void weatherForHour(todayISO, 12).then((w) => setWeatherReady(w !== null))
  }, [todayISO])
  const weatherFor = (s: Session) => {
    if (!weatherReady || s.dateISO < todayISO || !s.start) return null
    const mins = toMinutes(s.start)
    return mins === null ? null : cachedWeatherForHour(s.dateISO, Math.floor(mins / 60))
  }

  const allDays = useMemo(() => {
    const byDate = new Map<string, Session[]>()
    for (const s of sessions) {
      const list = byDate.get(s.dateISO) ?? []
      list.push(s)
      byDate.set(s.dateISO, list)
    }
    return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [sessions])

  // Rendering all ~440 sessions at once is heavy on older phones; window around today
  // and extend on demand. The window always stretches to include a jump target.
  const { days, hiddenEarlier, hiddenLater } = useMemo(() => {
    if (!windowed) return { days: allDays, hiddenEarlier: 0, hiddenLater: 0 }
    let from = addDaysISO(todayISO, -pastDays)
    let to = addDaysISO(todayISO, futureDays)
    if (scrollTo) {
      if (scrollTo < from) from = scrollTo
      if (scrollTo > to) to = scrollTo
    }
    const visible = allDays.filter(([d]) => d >= from && d <= to)
    return {
      days: visible,
      hiddenEarlier: allDays.filter(([d]) => d < from).length,
      hiddenLater: allDays.filter(([d]) => d > to).length,
    }
  }, [allDays, windowed, todayISO, pastDays, futureDays, scrollTo])

  // Sessions that overlap another real session on the same day (key dates and
  // self-study excluded) get a clash badge.
  const conflictIds = useMemo(() => {
    const ids = new Set<string>()
    for (const [, list] of days) {
      const timed = list.filter((s) => !s.isKeyDate && !s.isSelfStudy && toMinutes(s.start) !== null)
      for (let i = 0; i < timed.length; i++) {
        for (let j = i + 1; j < timed.length; j++) {
          const aStart = toMinutes(timed[i].start)!
          const aEnd = toMinutes(timed[i].end) ?? aStart + 60
          const bStart = toMinutes(timed[j].start)!
          const bEnd = toMinutes(timed[j].end) ?? bStart + 60
          if (aStart < bEnd && bStart < aEnd) {
            ids.add(timed[i].id)
            ids.add(timed[j].id)
          }
        }
      }
    }
    return ids
  }, [days])

  // The day to scroll to: the requested date (or today), else the next day with sessions.
  const anchorISO = useMemo(() => {
    const target = scrollTo ?? todayISO
    const future = days.find(([date]) => date >= target)
    return future ? future[0] : null
  }, [days, scrollTo, todayISO])

  // Scroll so the day's header lands just below the sticky header stack
  // (plain scrollIntoView hides the top of the section behind it).
  function scrollToAnchor(behavior: ScrollBehavior) {
    const el = anchorRef.current
    if (!el) return
    const headerH = document.querySelector('.header-stack')?.getBoundingClientRect().height ?? 0
    const top = el.getBoundingClientRect().top + window.scrollY - headerH - 6
    window.scrollTo({ top: Math.max(0, top), behavior })
  }

  useEffect(() => {
    scrollToAnchor('auto')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorISO])

  const scrollToToday = () => scrollToAnchor('smooth')

  if (days.length === 0) {
    return <div className="empty-state">{emptyMessage ?? 'No sessions found in this sheet.'}</div>
  }

  return (
    <div className="agenda">
      {hiddenEarlier > 0 && (
        <button type="button" className="btn-window" onClick={() => setPastDays((p) => p + 90)}>
          ↑ Show earlier ({hiddenEarlier} more days)
        </button>
      )}
      {days.map(([dateISO, daySessions]) => {
        const isToday = dateISO === todayISO
        const isPast = dateISO < todayISO
        const isAnchor = dateISO === anchorISO
        return (
          <section
            key={dateISO}
            className={`agenda-day${isPast ? ' past' : ''}`}
            ref={isAnchor ? anchorRef : undefined}
          >
            <h2 className="day-header">
              <span>{formatDayHeader(dateISO)}</span>
              {termStartISO && weekNumber(dateISO, termStartISO) !== null && (
                <span className="week-badge">Wk {weekNumber(dateISO, termStartISO)}</span>
              )}
              {isToday && <span className="badge badge-today">Today</span>}
            </h2>
            <div className="day-sessions">
              {daySessions.map((s, i) => {
                // Free-slot finder: surface usable gaps between real sessions.
                const prev = i > 0 ? daySessions[i - 1] : null
                let gapMins = 0
                if (
                  prev &&
                  !prev.isKeyDate &&
                  !s.isKeyDate &&
                  toMinutes(prev.end) !== null &&
                  toMinutes(s.start) !== null
                ) {
                  gapMins = toMinutes(s.start)! - toMinutes(prev.end)!
                }
                return (
                  <div key={s.id} className="session-slot">
                    {gapMins >= 45 && (
                      <div className="free-gap">
                        ☕ {Math.floor(gapMins / 60) > 0 ? `${Math.floor(gapMins / 60)}h ` : ''}
                        {gapMins % 60 > 0 ? `${gapMins % 60}m ` : ''}free
                      </div>
                    )}
                    <SessionCard
                      session={s}
                      meta={metaMap?.[sessionKey(s)]}
                      coords={coords}
                      travelMode={travelMode}
                      conflict={conflictIds.has(s.id)}
                      weather={weatherFor(s)}
                      onSelect={onSelect}
                    />
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}
      {hiddenLater > 0 && (
        <button type="button" className="btn-window" onClick={() => setFutureDays((f) => f + 90)}>
          ↓ Show later ({hiddenLater} more days)
        </button>
      )}
      {anchorISO && (
        <button type="button" className="fab-today" onClick={scrollToToday} aria-label="Scroll to today">
          Today
        </button>
      )}
    </div>
  )
}

import { useEffect, useMemo, useRef } from 'react'
import { sessionKey } from '../lib/diff'
import { weekNumber } from '../lib/format'
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

export function AgendaView({ sessions, emptyMessage, onSelect, scrollTo, metaMap, termStartISO }: Props) {
  const todayISO = localTodayISO()
  const anchorRef = useRef<HTMLElement | null>(null)

  const days = useMemo(() => {
    const byDate = new Map<string, Session[]>()
    for (const s of sessions) {
      const list = byDate.get(s.dateISO) ?? []
      list.push(s)
      byDate.set(s.dateISO, list)
    }
    return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [sessions])

  // The day to scroll to: the requested date (or today), else the next day with sessions.
  const anchorISO = useMemo(() => {
    const target = scrollTo ?? todayISO
    const future = days.find(([date]) => date >= target)
    return future ? future[0] : null
  }, [days, scrollTo, todayISO])

  useEffect(() => {
    if (anchorRef.current) {
      anchorRef.current.scrollIntoView({ block: 'start' })
    }
  }, [anchorISO])

  function scrollToToday() {
    anchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  if (days.length === 0) {
    return <div className="empty-state">{emptyMessage ?? 'No sessions found in this sheet.'}</div>
  }

  return (
    <div className="agenda">
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
              {daySessions.map((s) => (
                <SessionCard key={s.id} session={s} meta={metaMap?.[sessionKey(s)]} onSelect={onSelect} />
              ))}
            </div>
          </section>
        )
      })}
      {anchorISO && (
        <button type="button" className="fab-today" onClick={scrollToToday} aria-label="Scroll to today">
          Today
        </button>
      )}
    </div>
  )
}

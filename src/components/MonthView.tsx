import { useMemo, useState } from 'react'
import type { Session } from '../types'

interface Props {
  sessions: Session[]
  todayISO: string
  /** days (yyyy-mm-dd) that carry a key date, marked distinctly */
  keyDateDays?: Set<string>
  /** days that are entirely school-experience (tinted green) */
  placementDays?: Set<string>
  /** first day of each ≥7-day session gap → total gap days (marked 🏖) */
  breakStarts?: Map<string, number>
  onPickDay: (dateISO: string) => void
}

function iso(y: number, monthIndex: number, d: number): string {
  return `${y}-${String(monthIndex + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function MonthView({ sessions, todayISO, keyDateDays, placementDays, breakStarts, onPickDay }: Props) {
  const [ty, tm] = todayISO.split('-').map(Number)
  const [year, setYear] = useState(ty)
  const [month, setMonth] = useState(tm - 1) // 0-based

  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of sessions) map.set(s.dateISO, (map.get(s.dateISO) ?? 0) + 1)
    return map
  }, [sessions])

  function shiftMonth(delta: number) {
    const d = new Date(year, month + delta, 1)
    setYear(d.getFullYear())
    setMonth(d.getMonth())
  }

  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7 // Monday-first
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (string | null)[] = [
    ...Array.from({ length: firstDow }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => iso(year, month, i + 1)),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  const monthLabel = new Date(year, month, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  const isCurrentMonth = year === ty && month === tm - 1

  return (
    <div className="month-view">
      <div className="week-nav">
        <button type="button" className="btn-icon" onClick={() => shiftMonth(-1)} aria-label="Previous month">
          ‹
        </button>
        <button
          type="button"
          className={`week-label${isCurrentMonth ? '' : ' clickable'}`}
          onClick={() => {
            setYear(ty)
            setMonth(tm - 1)
          }}
          title={isCurrentMonth ? undefined : 'Back to this month'}
        >
          {monthLabel}
        </button>
        <button type="button" className="btn-icon" onClick={() => shiftMonth(1)} aria-label="Next month">
          ›
        </button>
      </div>
      <div className="month-grid">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <div key={d} className="month-dow">
            {d}
          </div>
        ))}
        {cells.map((dateISO, i) =>
          dateISO === null ? (
            <div key={`blank-${i}`} className="month-cell blank" />
          ) : (
            <button
              key={dateISO}
              type="button"
              className={`month-cell${dateISO === todayISO ? ' today' : ''}${(counts.get(dateISO) ?? 0) > 0 ? ' has-sessions' : ''}${placementDays?.has(dateISO) ? ' placement' : ''}`}
              onClick={() => onPickDay(dateISO)}
            >
              <span className="month-daynum">{Number(dateISO.slice(-2))}</span>
              {keyDateDays?.has(dateISO) && (
                <span className="month-keydate" aria-label="Key date">
                  📌
                </span>
              )}
              {breakStarts?.has(dateISO) && (
                <span className="month-break" aria-label={`${breakStarts.get(dateISO)}-day break starts`} title={`${breakStarts.get(dateISO)}-day break`}>
                  🏖
                </span>
              )}
              {(counts.get(dateISO) ?? 0) > 0 && (
                <span className="month-dots" aria-label={`${counts.get(dateISO)} sessions`}>
                  {Array.from({ length: Math.min(counts.get(dateISO) ?? 0, 3) }, (_, j) => (
                    <span key={j} className="month-dot" />
                  ))}
                  {(counts.get(dateISO) ?? 0) > 3 && <span className="month-more">+</span>}
                </span>
              )}
            </button>
          )
        )}
      </div>
      <p className="filter-hint month-hint">Tap a day to open it in the day view.</p>
    </div>
  )
}

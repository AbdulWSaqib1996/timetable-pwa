import { useEffect, useRef } from 'react'
import { addDaysISO, mondayOfISO } from '../../../shared/calendar-time.js'
import { IconChevronLeft, IconChevronRight } from '../../components/ui'

interface Props {
  /** the shared selected date */
  anchorISO: string
  todayISO: string
  /** dates (yyyy-mm-dd) that have at least one visible session */
  busyDays: Set<string>
  onSelect: (dateISO: string) => void
  onShiftWeek: (deltaDays: number) => void
}

const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', opts)
}

/**
 * Seven equal-width day controls, Monday–Sunday (P4-03 → V2): short weekday,
 * date number, subtle event dot. Selected day gets the accent treatment and
 * `aria-selected`; today keeps a distinct marker (`aria-current`) even when
 * another day is selected. Keyboard: the selected day is the tab stop; Left /
 * Right move a day (crossing into the next week), Home / End jump to Monday /
 * Sunday. Every button's accessible name is the full spoken date.
 */
export function WeekStrip({ anchorISO, todayISO, busyDays, onSelect, onShiftWeek }: Props) {
  const monday = mondayOfISO(anchorISO)
  const days = Array.from({ length: 7 }, (_, i) => addDaysISO(monday, i))
  const label = `${fmt(monday, { day: 'numeric', month: 'short' })}–${fmt(addDaysISO(monday, 6), { day: 'numeric', month: 'short' })}`
  const stripRef = useRef<HTMLDivElement>(null)
  const focusPending = useRef(false)
  useEffect(() => {
    if (!focusPending.current) return
    focusPending.current = false
    stripRef.current?.querySelector<HTMLButtonElement>('.week-strip-day.selected')?.focus()
  }, [anchorISO])
  const move = (iso: string) => {
    focusPending.current = true
    onSelect(iso)
  }
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight') move(addDaysISO(anchorISO, 1))
    else if (e.key === 'ArrowLeft') move(addDaysISO(anchorISO, -1))
    else if (e.key === 'Home') move(monday)
    else if (e.key === 'End') move(addDaysISO(monday, 6))
    else return
    e.preventDefault()
  }
  return (
    <div className="week-strip-wrap">
      <div className="week-nav">
        <button type="button" className="btn-icon" onClick={() => onShiftWeek(-7)} aria-label="Previous week">
          <IconChevronLeft />
        </button>
        <span className="week-label">{label}</span>
        <button type="button" className="btn-icon" onClick={() => onShiftWeek(7)} aria-label="Next week">
          <IconChevronRight />
        </button>
      </div>
      <div ref={stripRef} className="week-strip" role="listbox" aria-label={`Pick a day, ${label}`} onKeyDown={onKey}>
        {days.map((iso) => {
          const selected = iso === anchorISO
          const isToday = iso === todayISO
          return (
            <button
              key={iso}
              type="button"
              role="option"
              aria-selected={selected}
              aria-current={isToday ? 'date' : undefined}
              tabIndex={selected ? 0 : -1}
              aria-label={`${fmt(iso, { weekday: 'long', day: 'numeric', month: 'long' })}${isToday ? ', today' : ''}${busyDays.has(iso) ? '' : ', nothing scheduled'}`}
              className={`week-strip-day${selected ? ' selected' : ''}${isToday ? ' today' : ''}`}
              onClick={() => onSelect(iso)}
            >
              <span className="week-strip-dow">{fmt(iso, { weekday: 'short' }).slice(0, 3)}</span>
              <span className="week-strip-num">{Number(iso.slice(-2))}</span>
              <span className={`week-strip-dot${busyDays.has(iso) ? ' on' : ''}`} aria-hidden="true" />
            </button>
          )
        })}
      </div>
    </div>
  )
}

import { addDaysISO, mondayOfISO } from '../../../shared/calendar-time.js'

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
 * Seven equal-width day controls, Monday–Sunday (P4-03): short weekday, date
 * number, subtle event dot. Selected day gets the accent treatment; today
 * keeps a distinct marker even when another day is selected.
 */
export function WeekStrip({ anchorISO, todayISO, busyDays, onSelect, onShiftWeek }: Props) {
  const monday = mondayOfISO(anchorISO)
  const days = Array.from({ length: 7 }, (_, i) => addDaysISO(monday, i))
  const label = `${fmt(monday, { day: 'numeric', month: 'short' })}–${fmt(addDaysISO(monday, 6), { day: 'numeric', month: 'short' })}`
  return (
    <div className="week-strip-wrap">
      <div className="week-nav">
        <button type="button" className="btn-icon" onClick={() => onShiftWeek(-7)} aria-label="Previous week">
          ‹
        </button>
        <span className="week-label">{label}</span>
        <button type="button" className="btn-icon" onClick={() => onShiftWeek(7)} aria-label="Next week">
          ›
        </button>
      </div>
      <div className="week-strip" role="listbox" aria-label="Pick a day">
        {days.map((iso) => {
          const selected = iso === anchorISO
          const isToday = iso === todayISO
          return (
            <button
              key={iso}
              type="button"
              role="option"
              aria-selected={selected}
              aria-label={fmt(iso, { weekday: 'long', day: 'numeric', month: 'long' })}
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

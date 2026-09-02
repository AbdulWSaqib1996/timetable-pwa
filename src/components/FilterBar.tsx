import type { ViewMode } from '../types'

interface Props {
  view: ViewMode
  activeCount: number
  onView: (view: ViewMode) => void
  onOpenFilters: () => void
}

const VIEWS: { value: ViewMode; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
]

export function FilterBar({ view, activeCount, onView, onOpenFilters }: Props) {
  return (
    <div className="filterbar">
      <div className="segmented" role="tablist" aria-label="View">
        {VIEWS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={view === value}
            className={`segment${view === value ? ' segment-on' : ''}`}
            onClick={() => onView(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <button type="button" className="btn-filters" onClick={onOpenFilters}>
        Filters
        {activeCount > 0 && <span className="filter-count">{activeCount}</span>}
      </button>
    </div>
  )
}

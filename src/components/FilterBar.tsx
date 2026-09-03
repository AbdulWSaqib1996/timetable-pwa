import type { ViewMode } from '../types'

interface Props {
  view: ViewMode
  activeCount: number
  placementsOnly: boolean
  onView: (view: ViewMode) => void
  onTogglePlacements: () => void
  onOpenFilters: () => void
}

const VIEWS: { value: ViewMode; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
]

export function FilterBar({ view, activeCount, placementsOnly, onView, onTogglePlacements, onOpenFilters }: Props) {
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
      <button
        type="button"
        className={`btn-filters btn-placements${placementsOnly ? ' on' : ''}`}
        aria-pressed={placementsOnly}
        title={placementsOnly ? 'Showing placements only — tap to show everything' : 'Show placements only'}
        onClick={onTogglePlacements}
      >
        🏫
      </button>
      <button type="button" className="btn-filters" onClick={onOpenFilters}>
        Filters
        {activeCount > 0 && <span className="filter-count">{activeCount}</span>}
      </button>
    </div>
  )
}

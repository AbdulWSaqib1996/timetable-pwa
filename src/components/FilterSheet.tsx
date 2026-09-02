import type { FilterOptions } from '../lib/filters'
import type { DateRange, Filters, Settings } from '../types'

const RANGES: { value: DateRange; label: string }[] = [
  { value: 'today', label: 'Today only' },
  { value: 'week', label: 'This week' },
  { value: 'all', label: 'All dates' },
]

interface Props {
  settings: Settings
  filters: Filters
  options: FilterOptions
  onUpdateSettings: (patch: Partial<Settings>) => void
  onUpdateFilters: (patch: Partial<Filters>) => void
  onClear: () => void
  onClose: () => void
}

function toggleValue(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

function ChipList({
  values,
  selected,
  onToggle,
}: {
  values: string[]
  selected: string[]
  onToggle: (value: string) => void
}) {
  return (
    <div className="chip-grid">
      {values.map((value) => (
        <button
          key={value}
          type="button"
          className={`chip${selected.includes(value) ? ' chip-on' : ''}`}
          aria-pressed={selected.includes(value)}
          onClick={() => onToggle(value)}
        >
          {value}
        </button>
      ))}
    </div>
  )
}

export function FilterSheet({
  settings,
  filters,
  options,
  onUpdateSettings,
  onUpdateFilters,
  onClear,
  onClose,
}: Props) {
  const mySpecialisms = settings.mySpecialisms ?? []

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card sheet" role="dialog" aria-label="Filters" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>Filters</h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {options.specialisms.length > 0 && (
          <section className="filter-section">
            <h3>My specialisms</h3>
            <ChipList
              values={options.specialisms}
              selected={mySpecialisms}
              onToggle={(v) => onUpdateSettings({ mySpecialisms: toggleValue(mySpecialisms, v) })}
            />
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={settings.hideOtherSpecialisms !== false}
                onChange={(e) => onUpdateSettings({ hideOtherSpecialisms: e.target.checked })}
              />
              Hide other specialisms automatically
            </label>
            {mySpecialisms.length === 0 && (
              <p className="filter-hint">No specialism selected — all are shown.</p>
            )}
          </section>
        )}

        {options.groups.length > 1 && (
          <section className="filter-section">
            <h3>My group</h3>
            <ChipList
              values={options.groups}
              selected={settings.myGroups ?? []}
              onToggle={(v) => onUpdateSettings({ myGroups: toggleValue(settings.myGroups ?? [], v) })}
            />
            <p className="filter-hint">
              Hides sessions not listed for your group. Sessions with no group set are always shown.
            </p>
          </section>
        )}

        <section className="filter-section">
          <h3>Date range (day view)</h3>
          <div className="chip-grid">
            {RANGES.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                className={`chip${filters.dateRange === value ? ' chip-on' : ''}`}
                aria-pressed={filters.dateRange === value}
                onClick={() => onUpdateFilters({ dateRange: value })}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        <section className="filter-section">
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={filters.showSelfStudy}
              onChange={(e) => onUpdateFilters({ showSelfStudy: e.target.checked })}
            />
            Show self-study blocks
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={filters.showOptional}
              onChange={(e) => onUpdateFilters({ showOptional: e.target.checked })}
            />
            Show optional sessions
          </label>
        </section>

        {options.subjects.length > 0 && (
          <details className="filter-section" open={filters.subjects.length > 0}>
            <summary>
              Subjects{filters.subjects.length > 0 && ` (${filters.subjects.length})`}
            </summary>
            <ChipList
              values={options.subjects}
              selected={filters.subjects}
              onToggle={(v) => onUpdateFilters({ subjects: toggleValue(filters.subjects, v) })}
            />
          </details>
        )}

        {options.tutors.length > 0 && (
          <details className="filter-section" open={filters.tutors.length > 0}>
            <summary>Tutors{filters.tutors.length > 0 && ` (${filters.tutors.length})`}</summary>
            <ChipList
              values={options.tutors}
              selected={filters.tutors}
              onToggle={(v) => onUpdateFilters({ tutors: toggleValue(filters.tutors, v) })}
            />
          </details>
        )}

        {options.rooms.length > 0 && (
          <details className="filter-section" open={filters.rooms.length > 0}>
            <summary>Rooms{filters.rooms.length > 0 && ` (${filters.rooms.length})`}</summary>
            <ChipList
              values={options.rooms}
              selected={filters.rooms}
              onToggle={(v) => onUpdateFilters({ rooms: toggleValue(filters.rooms, v) })}
            />
          </details>
        )}

        <p className="filter-hint">
          Selecting nothing in a section shows everything. Choices are saved on this device.
        </p>

        <div className="modal-actions">
          <button type="button" className="btn-primary" onClick={onClose}>
            Done
          </button>
          <button type="button" className="btn-ghost" onClick={onClear}>
            Clear all filters
          </button>
        </div>
      </div>
    </div>
  )
}

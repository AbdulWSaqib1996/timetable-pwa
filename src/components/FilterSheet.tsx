import { useModalA11y } from '../lib/a11y'
import { activeCourse } from '../lib/course'
import type { FilterOptions } from '../lib/filters'
import type { Filters, Settings } from '../types'
import { IconClose } from './ui'

interface Props {
  settings: Settings
  filters: Filters
  options: FilterOptions
  hasKeyDates: boolean
  onUpdateSettings: (patch: Partial<Settings>) => void
  onUpdateFilters: (patch: Partial<Filters>) => void
  onOpenKeyDates: () => void
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
  hasKeyDates,
  onUpdateSettings,
  onUpdateFilters,
  onOpenKeyDates,
  onClear,
  onClose,
}: Props) {
  const dialogRef = useModalA11y<HTMLDivElement>(onClose)
  const mySpecialisms = settings.mySpecialisms ?? []

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div ref={dialogRef} className="modal-card sheet" role="dialog" aria-modal="true" aria-label="Filters" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>Filters</h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </div>

        {options.specialisms.length > 0 && (
          <section className="filter-section">
            <h3>My {activeCourse().terminology.specialism.toLowerCase()}s (membership)</h3>
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
              Hide other {activeCourse().terminology.specialism.toLowerCase()}s automatically
            </label>
            {mySpecialisms.length === 0 && (
              <p className="filter-hint">No {activeCourse().terminology.specialism.toLowerCase()} selected — all are shown.</p>
            )}
          </section>
        )}

        {options.groups.length > 1 && (
          <section className="filter-section">
            <h3>My {activeCourse().terminology.group.toLowerCase()} (membership)</h3>
            <ChipList
              values={options.groups}
              selected={settings.myGroups ?? []}
              onToggle={(v) => onUpdateSettings({ myGroups: toggleValue(settings.myGroups ?? [], v) })}
            />
            <p className="filter-hint">
              Hides sessions not listed for your group — group lists and ranges like “1-10” are
              understood. Sessions with no group set are always shown. Membership also decides
              reminders and exports, and is kept when you clear filters.
            </p>
          </section>
        )}

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
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={settings.remindOptional !== false}
              onChange={(e) => onUpdateSettings({ remindOptional: e.target.checked })}
            />
            Remind me about optional sessions
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={settings.remindSelfStudy !== false}
              onChange={(e) => onUpdateSettings({ remindSelfStudy: e.target.checked })}
            />
            Remind me about self-study blocks
          </label>
          <p className="filter-hint">
            Hiding sessions here only changes the display — the two reminder choices above decide
            what notifications cover.
          </p>
          {hasKeyDates && (
            <>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={filters.showKeyDates}
                  onChange={(e) => onUpdateFilters({ showKeyDates: e.target.checked })}
                />
                Show key dates in the timetable
              </label>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={filters.showPersonal !== false}
                  onChange={(e) => onUpdateFilters({ showPersonal: e.target.checked })}
                />
                Show personal events (appointments, work, study blocks)
              </label>
              <button type="button" className="btn-secondary" onClick={onOpenKeyDates}>
                📌 View all key dates
              </button>
            </>
          )}
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
            Clear display filters
          </button>
        </div>
      </div>
    </div>
  )
}

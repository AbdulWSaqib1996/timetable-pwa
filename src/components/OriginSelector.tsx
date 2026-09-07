import type { OriginOption } from '../lib/origins'

interface Props {
  options: OriginOption[]
  selectedId: string | null
  onSelect: (id: string) => void
}

/**
 * Explicit origin choice (P6-02). The device row states its fix age or that
 * no fix exists — a missing/denied fix is selectable only once a fix
 * arrives, and is never silently presented as "current location".
 */
export function OriginSelector({ options, selectedId, onSelect }: Props) {
  return (
    <label className="ui-field origin-selector">
      <span className="ui-field-label">From</span>
      <select
        className="date-input"
        value={selectedId ?? ''}
        onChange={(e) => onSelect(e.target.value)}
        aria-label="Journey origin"
      >
        {selectedId === null && <option value="">Choose an origin…</option>}
        {options.map((o) => (
          <option key={o.id} value={o.id} disabled={!o.coords}>
            {o.label}
            {o.detail ? ` — ${o.detail}` : ''}
          </option>
        ))}
      </select>
    </label>
  )
}

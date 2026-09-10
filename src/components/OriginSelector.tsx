import type { RefObject } from 'react'
import type { OriginOption } from '../lib/origins'

interface Props {
  options: OriginOption[]
  selectedId: string | null
  onSelect: (id: string) => void
  /** lets a "Choose starting point" primary action move focus here (V3) */
  selectRef?: RefObject<HTMLSelectElement>
}

/**
 * Explicit origin choice (P6-02). The device row states its fix age or that
 * no fix exists — a missing/denied fix is selectable only once a fix
 * arrives, and is never silently presented as "current location". A real
 * labelled native control, never a decorative panel.
 */
export function OriginSelector({ options, selectedId, onSelect, selectRef }: Props) {
  return (
    <label className="ui-field origin-selector">
      <span className="ui-field-label">Starting point</span>
      <select
        ref={selectRef}
        className="date-input"
        value={selectedId ?? ''}
        onChange={(e) => onSelect(e.target.value)}
        aria-label="Journey origin"
      >
        {selectedId === null && <option value="">Choose a starting point…</option>}
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

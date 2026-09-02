import { useState } from 'react'

interface Props {
  specialisms: string[]
  initial: string[]
  onSave: (chosen: string[]) => void
}

/** One-time onboarding: pick your specialism(s); all others are hidden automatically. */
export function SpecialismPicker({ specialisms, initial, onSave }: Props) {
  const [chosen, setChosen] = useState<string[]>(initial)

  function toggle(name: string) {
    setChosen((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]))
  }

  return (
    <div className="modal-overlay">
      <div className="modal-card" role="dialog" aria-label="Choose your specialisms">
        <h2>Which specialism are you in?</h2>
        <p className="modal-lead">
          Your timetable lists every specialism option. Pick yours and the rest will be hidden
          automatically — you can change this any time in Filters.
        </p>
        <div className="chip-grid">
          {specialisms.map((name) => (
            <button
              key={name}
              type="button"
              className={`chip${chosen.includes(name) ? ' chip-on' : ''}`}
              aria-pressed={chosen.includes(name)}
              onClick={() => toggle(name)}
            >
              {name}
            </button>
          ))}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn-primary" disabled={chosen.length === 0} onClick={() => onSave(chosen)}>
            {chosen.length === 0
              ? 'Select your specialism'
              : `Show only ${chosen.length === 1 ? chosen[0] : `${chosen.length} specialisms`}`}
          </button>
          <button type="button" className="btn-ghost" onClick={() => onSave([])}>
            Show all specialisms
          </button>
        </div>
      </div>
    </div>
  )
}

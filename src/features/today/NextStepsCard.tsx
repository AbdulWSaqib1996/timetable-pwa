import { IconPinTack } from '../../components/ui'
import type { NextStep } from '../../../shared/practice.js'

interface Props {
  steps: NextStep[]
  onOpen: (step: NextStep) => void
  onDismiss: (id: string) => void
  onPin: (id: string, pinned: boolean) => void
}

/**
 * Today's next steps (PG-02/03, G1b): at most three suggestions derived only
 * from dated work and the active practice focus — never from a score, and
 * nothing undated is ever "overdue". Dismiss hides a step for today; pin keeps
 * it first.
 */
export function NextStepsCard({ steps, onOpen, onDismiss, onPin }: Props) {
  if (steps.length === 0) return null
  return (
    <section className="ui-card next-steps" aria-label="Next steps">
      <p className="travel-od-title">Next steps</p>
      <ul className="next-steps-list">
        {steps.map((s) => (
          <li key={s.id} className={`next-step next-step--${s.kind}`}>
            <button type="button" className="next-step-main" onClick={() => onOpen(s)}>
              <strong>{s.label}</strong>
              <span className="filter-hint">{s.detail}</span>
            </button>
            <span className="next-step-actions">
              <button type="button" className={`btn-icon${s.pinned ? ' is-on' : ''}`} aria-label={s.pinned ? `Unpin: ${s.label}` : `Pin: ${s.label}`} aria-pressed={s.pinned} onClick={() => onPin(s.id, !s.pinned)}>
                <IconPinTack size={16} />
              </button>
              <button type="button" className="travel-link" aria-label={`Dismiss for today: ${s.label}`} onClick={() => onDismiss(s.id)}>
                Dismiss
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

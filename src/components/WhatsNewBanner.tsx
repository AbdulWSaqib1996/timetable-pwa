import { useState } from 'react'
import { WHATSNEW_ENTRIES, dismissWhatsNew, shouldShowWhatsNew } from '../lib/changelog'

/**
 * "What's new" (owner instruction, 11 Sep 2026: updated with every release):
 * the latest changelog entry, shown once per version on Today and dismissed
 * with one tap; the full history stays in Settings → Help & privacy.
 */
export function WhatsNewBanner({ onOpenHelp }: { onOpenHelp: () => void }) {
  const [open, setOpen] = useState(() => shouldShowWhatsNew())
  if (!open) return null
  const latest = WHATSNEW_ENTRIES[0]
  const close = () => {
    dismissWhatsNew()
    setOpen(false)
  }
  return (
    <section className="ui-card whatsnew-banner" aria-label="What's new">
      <p className="travel-od-title">What's new · {latest.title}</p>
      <ul className="whatsnew-list">
        {latest.items.map((n, i) => (
          <li key={i}>{n}</li>
        ))}
      </ul>
      <div className="btn-row">
        <button type="button" className="btn-primary" onClick={close}>Got it</button>
        <button type="button" className="btn-today-reset" onClick={() => { close(); onOpenHelp() }}>Earlier releases</button>
      </div>
    </section>
  )
}

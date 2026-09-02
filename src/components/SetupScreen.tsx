import { useState } from 'react'
import type { FormEvent } from 'react'

interface Props {
  onSubmit: (url: string) => Promise<void>
  onDemo: () => void
  onCancel?: () => void
}

export function SetupScreen({ onSubmit, onDemo, onCancel }: Props) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!url.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit(url.trim())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong loading that sheet.')
      setBusy(false)
    }
  }

  return (
    <div className="setup">
      <div className="setup-card">
        <h1>My Timetable</h1>
        <p className="setup-lead">
          Paste the link to your timetable Google Sheet. Open the sheet on the tab you want (e.g.{' '}
          <em>Group 2 Timetable</em>) and copy the URL from the address bar — it remembers which tab
          you chose.
        </p>
        <form onSubmit={handleSubmit}>
          <input
            type="url"
            inputMode="url"
            placeholder="https://docs.google.com/spreadsheets/d/…/edit#gid=…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={busy}
            required
          />
          <button type="submit" className="btn-primary" disabled={busy || !url.trim()}>
            {busy ? 'Loading…' : 'Load timetable'}
          </button>
        </form>
        {error && <p className="setup-error">{error}</p>}
        <p className="setup-note">
          The sheet must be shared as <strong>“anyone with the link can view”</strong>. Your URL is
          saved on this device only — you won’t be asked again.
        </p>
        <button type="button" className="btn-ghost" onClick={onDemo} disabled={busy}>
          Or try it with demo data
        </button>
        {onCancel && (
          <button type="button" className="btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}

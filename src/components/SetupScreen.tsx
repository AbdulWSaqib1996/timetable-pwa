import { useState } from 'react'
import type { FormEvent } from 'react'

interface Props {
  onSubmit: (url: string) => Promise<void>
  onDemo: () => void
  onCancel?: () => void
}

const FEATURES: { icon: string; title: string; text: string }[] = [
  { icon: '🔄', title: 'Always up to date', text: 'Reads the sheet directly — edits appear on the next refresh, no re-import.' },
  { icon: '📅', title: 'Day, week & month views', text: 'A clean agenda with your filters, clash warnings and free-slot finder.' },
  { icon: '🔔', title: 'Smart reminders', text: 'Session, deadline and “time to leave” alerts — even with the app closed.' },
  { icon: '🚇', title: 'Live travel times', text: 'TfL routes, departures and disruption warnings to every session.' },
  { icon: '🏫', title: 'Placement-aware', text: 'School-experience blocks, day counting and directions to your school.' },
  { icon: '📲', title: 'Installs like an app', text: 'Free, no account, works offline; your data stays on your device.' },
]

export function SetupScreen({ onSubmit, onDemo, onCancel }: Props) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const firstRun = !onCancel

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
        {firstRun && (
          <p className="setup-tagline">
            Turn any Google Sheet timetable into a fast, installable app — reminders, travel times
            and calendar sync included. Built for course cohorts; free forever.
          </p>
        )}
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
        {firstRun && (
          <>
            <div className="setup-features">
              {FEATURES.map((f) => (
                <div className="setup-feature" key={f.title}>
                  <span className="setup-feature-icon" aria-hidden="true">
                    {f.icon}
                  </span>
                  <span>
                    <strong>{f.title}</strong>
                    <br />
                    {f.text}
                  </span>
                </div>
              ))}
            </div>
            <p className="setup-footer">
              Got a share link from a coursemate instead? Just open it — everything configures
              itself. ·{' '}
              <a href="https://ko-fi.com/awsaqib" target="_blank" rel="noopener noreferrer">
                Support the app ☕
              </a>
            </p>
          </>
        )}
      </div>
    </div>
  )
}

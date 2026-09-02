import { useState } from 'react'
import { downloadICS } from '../lib/ics'
import type { Session, Settings } from '../types'

interface Props {
  settings: Settings
  /** sessions with the user's filters applied (specialisms etc.), all dates */
  exportSessions: Session[]
  onUpdateSettings: (patch: Partial<Settings>) => void
  onRechooseSpecialisms: () => void
  onChangeSheet: () => void
  onClose: () => void
}

/** Build the subscribable feed URL for a deployed ics-feed worker. */
export function buildFeedUrl(base: string, settings: Settings): string {
  const url = new URL(base)
  url.searchParams.set('id', settings.sheetId)
  if (settings.gid) url.searchParams.set('gid', settings.gid)
  const specialisms = settings.mySpecialisms ?? []
  if (specialisms.length > 0 && settings.hideOtherSpecialisms !== false) {
    url.searchParams.set('spec', specialisms.join(','))
  }
  if (settings.filters?.showSelfStudy === false) url.searchParams.set('selfstudy', '0')
  return url.toString()
}

export function SettingsSheet({
  settings,
  exportSessions,
  onUpdateSettings,
  onRechooseSpecialisms,
  onChangeSheet,
  onClose,
}: Props) {
  const [feedBase, setFeedBase] = useState(settings.icsFeedBase ?? '')
  const [copied, setCopied] = useState(false)

  function handleChangeSheet() {
    if (window.confirm('Change sheet? This clears your saved URL and filter choices on this device.')) {
      onChangeSheet()
    }
  }

  const feedUrl =
    !settings.demo && settings.icsFeedBase ? buildFeedUrl(settings.icsFeedBase, settings) : null

  async function copyFeed() {
    if (!feedUrl) return
    try {
      await navigator.clipboard.writeText(feedUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard unavailable — URL is still shown as text */
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card sheet" role="dialog" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>Settings</h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <section className="filter-section">
          <h3>Timetable source</h3>
          {settings.demo ? (
            <p className="filter-hint">Using built-in demo data.</p>
          ) : (
            <p className="settings-url" title={settings.sheetUrl}>
              {settings.sheetUrl}
            </p>
          )}
          <button type="button" className="btn-secondary" onClick={handleChangeSheet}>
            {settings.demo ? 'Use a real sheet' : 'Change sheet'}
          </button>
        </section>

        <section className="filter-section">
          <h3>Specialisms</h3>
          <p className="filter-hint">
            {(settings.mySpecialisms ?? []).length > 0
              ? `Showing: ${(settings.mySpecialisms ?? []).join(', ')}`
              : 'Showing all specialisms.'}
          </p>
          <button type="button" className="btn-secondary" onClick={onRechooseSpecialisms}>
            Choose specialisms again
          </button>
        </section>

        <section className="filter-section">
          <h3>Calendar export</h3>
          <p className="filter-hint">
            Downloads your filtered timetable ({exportSessions.length} sessions) as an .ics file you
            can import into Google, Apple or Outlook calendars.
          </p>
          <button
            type="button"
            className="btn-secondary"
            disabled={exportSessions.length === 0}
            onClick={() => downloadICS(exportSessions, 'My Timetable')}
          >
            Download .ics file
          </button>
        </section>

        <section className="filter-section">
          <h3>Calendar feed (stays in sync)</h3>
          {settings.demo ? (
            <p className="filter-hint">Load a real sheet to use the calendar feed.</p>
          ) : (
            <>
              <p className="filter-hint">
                Deploy the ics-feed worker (see the project README), then paste its URL here to get a
                feed link your calendar app keeps in sync.
              </p>
              <div className="feed-row">
                <input
                  type="url"
                  placeholder="https://timetable-ics.<you>.workers.dev"
                  value={feedBase}
                  onChange={(e) => setFeedBase(e.target.value)}
                  onBlur={() => onUpdateSettings({ icsFeedBase: feedBase.trim() || undefined })}
                />
              </div>
              {feedUrl && (
                <>
                  <p className="settings-url">{feedUrl}</p>
                  <button type="button" className="btn-secondary" onClick={copyFeed}>
                    {copied ? 'Copied!' : 'Copy feed URL'}
                  </button>
                </>
              )}
            </>
          )}
        </section>

        <div className="modal-actions">
          <button type="button" className="btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

import { useRef, useState } from 'react'
import { sessionKey } from '../lib/diff'
import { downloadICS } from '../lib/ics'
import { buildShareUrl } from '../lib/share'
import { parseSheetUrl } from '../lib/sheetUrl'
import { exportBackup, importBackup } from '../lib/storage'
import type { MetaMap, ProfileStore, Session, Settings } from '../types'

interface Props {
  settings: Settings
  store: ProfileStore
  /** sessions with the user's filters applied (specialisms etc.), all dates */
  exportSessions: Session[]
  keyDates: Session[]
  metaMap: MetaMap
  todayISO: string
  onUpdateSettings: (patch: Partial<Settings>) => void
  onRechooseSpecialisms: () => void
  onSwitchProfile: (id: string) => void
  onAddProfile: () => void
  onDeleteProfile: (id: string) => void
  onClose: () => void
}

function downloadFile(name: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
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
  if (settings.keyDatesSheetId) {
    if (settings.keyDatesSheetId !== settings.sheetId) url.searchParams.set('kdid', settings.keyDatesSheetId)
    if (settings.keyDatesGid) url.searchParams.set('kdgid', settings.keyDatesGid)
  }
  return url.toString()
}

const REMINDER_OPTIONS = [
  { value: 5, label: '5 min' },
  { value: 10, label: '10 min' },
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hour' },
  { value: 120, label: '2 hours' },
]

export function SettingsSheet({
  settings,
  store,
  exportSessions,
  keyDates,
  metaMap,
  todayISO,
  onUpdateSettings,
  onRechooseSpecialisms,
  onSwitchProfile,
  onAddProfile,
  onDeleteProfile,
  onClose,
}: Props) {
  const [feedBase, setFeedBase] = useState(settings.icsFeedBase ?? '')
  const [keyDatesUrl, setKeyDatesUrl] = useState(settings.keyDatesUrl ?? '')
  const [keyDatesError, setKeyDatesError] = useState(false)
  const [mergeUrl, setMergeUrl] = useState('')
  const [mergeError, setMergeError] = useState(false)
  const [copied, setCopied] = useState<'feed' | 'share' | null>(null)
  const importInput = useRef<HTMLInputElement | null>(null)

  function addMergeTab() {
    const trimmed = mergeUrl.trim()
    if (!trimmed) return
    const parsed = parseSheetUrl(trimmed)
    if (!parsed) {
      setMergeError(true)
      return
    }
    setMergeError(false)
    setMergeUrl('')
    onUpdateSettings({
      extraTabs: [...(settings.extraTabs ?? []), { sheetId: parsed.sheetId, gid: parsed.gid, url: trimmed }],
    })
  }

  function handleImportFile(file: File) {
    void file.text().then((text) => {
      if (importBackup(text)) {
        window.location.reload()
      } else {
        window.alert('That file doesn’t look like a My Timetable backup.')
      }
    })
  }

  // Attendance insights over past sessions (self-study excluded).
  const pastSessions = exportSessions.filter((s) => s.dateISO <= todayISO && !s.isSelfStudy)
  const attendedCount = pastSessions.filter((s) => metaMap[sessionKey(s)]?.attended).length
  const bySubject = new Map<string, { attended: number; total: number }>()
  for (const s of pastSessions) {
    const key = s.subject || s.title
    const entry = bySubject.get(key) ?? { attended: 0, total: 0 }
    entry.total++
    if (metaMap[sessionKey(s)]?.attended) entry.attended++
    bySubject.set(key, entry)
  }
  const subjectRows = [...bySubject.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 8)

  function downloadAttendanceCSV() {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`
    const rows = ['Date,Start,Title,Subject,Room,Attended,Note']
    for (const s of pastSessions) {
      const m = metaMap[sessionKey(s)]
      rows.push(
        [s.dateISO, s.start, esc(s.title), esc(s.subject || s.title), esc(s.room), m?.attended ? 'yes' : 'no', esc(m?.note ?? '')].join(',')
      )
    }
    downloadFile('attendance.csv', rows.join('\r\n'), 'text/csv;charset=utf-8')
  }

  function saveKeyDatesUrl() {
    const trimmed = keyDatesUrl.trim()
    if (!trimmed) {
      setKeyDatesError(false)
      onUpdateSettings({ keyDatesUrl: undefined, keyDatesSheetId: undefined, keyDatesGid: undefined })
      return
    }
    const parsed = parseSheetUrl(trimmed)
    if (!parsed) {
      setKeyDatesError(true)
      return
    }
    setKeyDatesError(false)
    onUpdateSettings({ keyDatesUrl: trimmed, keyDatesSheetId: parsed.sheetId, keyDatesGid: parsed.gid })
  }

  const activeProfile = store.profiles.find((p) => p.id === store.activeId)

  async function copy(text: string, which: 'feed' | 'share') {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(which)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      window.prompt('Copy this link:', text)
    }
  }

  function handleDelete() {
    if (!activeProfile) return
    if (window.confirm(`Remove "${activeProfile.name}"? Its saved filters and notes are cleared on this device.`)) {
      onDeleteProfile(activeProfile.id)
    }
  }

  async function toggleOffset(field: 'reminderOffsets' | 'leaveAlertOffsets' | 'keyDateReminderDays', mins: number) {
    const current = settings[field] ?? []
    const next = current.includes(mins)
      ? current.filter((m) => m !== mins)
      : [...current, mins].sort((a, b) => a - b)
    if (next.length > 0 && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      await Notification.requestPermission()
    }
    onUpdateSettings({ [field]: next })
  }

  function toggleLocation(enabled: boolean) {
    if (enabled && 'geolocation' in navigator) {
      // Poke once so the permission prompt appears while the user is looking at the toggle.
      navigator.geolocation.getCurrentPosition(
        () => {},
        () => {}
      )
    }
    onUpdateSettings({ locationEnabled: enabled })
  }

  const notifBlocked = typeof Notification !== 'undefined' && Notification.permission === 'denied'
  const feedUrl =
    !settings.demo && settings.icsFeedBase ? buildFeedUrl(settings.icsFeedBase, settings) : null

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
          <h3>Timetables</h3>
          <div className="chip-grid">
            {store.profiles.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`chip${p.id === store.activeId ? ' chip-on' : ''}`}
                onClick={() => onSwitchProfile(p.id)}
              >
                {p.name}
              </button>
            ))}
          </div>
          <div className="btn-row">
            <button type="button" className="btn-secondary" onClick={onAddProfile}>
              Add another timetable
            </button>
            <button type="button" className="btn-secondary" onClick={handleDelete}>
              Remove this one
            </button>
          </div>
          {settings.demo ? (
            <p className="filter-hint">This timetable uses built-in demo data.</p>
          ) : (
            <p className="settings-url" title={settings.sheetUrl}>
              {settings.sheetUrl}
            </p>
          )}
          {!settings.demo && (
            <>
              {(settings.extraTabs ?? []).map((tab, i) => (
                <div className="merged-tab" key={`${tab.sheetId}-${tab.gid}-${i}`}>
                  <span className="settings-url">merged: {tab.url}</span>
                  <button
                    type="button"
                    className="btn-icon"
                    aria-label="Remove merged tab"
                    onClick={() =>
                      onUpdateSettings({ extraTabs: (settings.extraTabs ?? []).filter((_, j) => j !== i) })
                    }
                  >
                    ✕
                  </button>
                </div>
              ))}
              <div className="feed-row">
                <input
                  type="url"
                  placeholder="Merge another tab: paste its URL (with #gid=…)"
                  value={mergeUrl}
                  onChange={(e) => setMergeUrl(e.target.value)}
                />
              </div>
              {mergeError && <p className="setup-error">That doesn’t look like a Google Sheets link.</p>}
              <button type="button" className="btn-secondary" onClick={addMergeTab} disabled={!mergeUrl.trim()}>
                Merge tab into this timetable
              </button>
            </>
          )}
        </section>

        {!settings.demo && (
          <section className="filter-section">
            <h3>Share this setup</h3>
            <p className="filter-hint">
              Sends someone a link that opens the app already configured with this sheet and your
              specialism/group choices.
            </p>
            <button type="button" className="btn-secondary" onClick={() => copy(buildShareUrl(settings), 'share')}>
              {copied === 'share' ? 'Copied!' : 'Copy share link'}
            </button>
          </section>
        )}

        {!settings.demo && (
          <section className="filter-section">
            <h3>Key dates</h3>
            <p className="filter-hint">
              Paste the link to the submissions/key-dates tab (open that tab so the URL contains its
              gid). Upcoming deadlines get a countdown strip on the day view.
            </p>
            <div className="feed-row">
              <input
                type="url"
                placeholder="https://docs.google.com/spreadsheets/d/…#gid=…"
                value={keyDatesUrl}
                onChange={(e) => setKeyDatesUrl(e.target.value)}
                onBlur={saveKeyDatesUrl}
              />
            </div>
            {keyDatesError && <p className="setup-error">That doesn’t look like a Google Sheets link.</p>}
            {settings.keyDatesSheetId && !keyDatesError && (
              <p className="filter-hint">Key dates connected — they refresh with the timetable.</p>
            )}
            {settings.keyDatesSheetId && (
              <>
                <h3 className="subheading">Key-date reminders</h3>
                <div className="chip-grid">
                  {(
                    [
                      { value: 7, label: '7 days before' },
                      { value: 3, label: '3 days' },
                      { value: 1, label: '1 day' },
                    ] as const
                  ).map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      className={`chip${(settings.keyDateReminderDays ?? []).includes(value) ? ' chip-on' : ''}`}
                      aria-pressed={(settings.keyDateReminderDays ?? []).includes(value)}
                      onClick={() => void toggleOffset('keyDateReminderDays', value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="filter-hint">
                  Notifies you the chosen number of days before each deadline, while the app is open
                  or installed and running.
                </p>
              </>
            )}
          </section>
        )}

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
          <h3>Theme</h3>
          <div className="chip-grid">
            {(
              [
                { value: 'system', label: 'System' },
                { value: 'light', label: '☀️ Light' },
                { value: 'dark', label: '🌙 Dark' },
              ] as const
            ).map(({ value, label }) => (
              <button
                key={value}
                type="button"
                className={`chip${(settings.theme ?? 'system') === value ? ' chip-on' : ''}`}
                aria-pressed={(settings.theme ?? 'system') === value}
                onClick={() => onUpdateSettings({ theme: value })}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        <section className="filter-section">
          <h3>Term start (week numbers)</h3>
          <p className="filter-hint">Set the first day of term to show "Wk N" labels on days and weeks.</p>
          <input
            type="date"
            className="date-input"
            value={settings.termStartISO ?? ''}
            onChange={(e) => onUpdateSettings({ termStartISO: e.target.value || undefined })}
          />
        </section>

        <section className="filter-section">
          <h3>Session reminders</h3>
          <p className="filter-hint">
            Pick as many as you like — e.g. 1 hour and 15 min gives two notifications before each
            session. Select none to turn reminders off.
          </p>
          <div className="chip-grid">
            {REMINDER_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                className={`chip${(settings.reminderOffsets ?? []).includes(value) ? ' chip-on' : ''}`}
                aria-pressed={(settings.reminderOffsets ?? []).includes(value)}
                onClick={() => void toggleOffset('reminderOffsets', value)}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="filter-hint">
            {notifBlocked
              ? 'Notifications are blocked for this site — allow them in your browser settings.'
              : (settings.reminderOffsets ?? []).length === 0
                ? 'Reminders are off.'
                : `Notifying ${(settings.reminderOffsets ?? []).map((m) => (m >= 60 ? `${m / 60}h` : `${m}m`)).join(', ')} before each session, while the app is open (or installed and running). For guaranteed alerts anywhere, subscribe to the calendar feed below and use your calendar app’s own reminders.`}
          </p>
        </section>

        <section className="filter-section">
          <h3>Travel times</h3>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={settings.locationEnabled ?? false}
              onChange={(e) => toggleLocation(e.target.checked)}
            />
            Use my location for travel times
          </label>
          <div className="chip-grid">
            {(
              [
                { value: 'walking', label: '🚶 Walking' },
                { value: 'transit', label: '🚌 Public transport' },
                { value: 'driving', label: '🚗 Driving' },
              ] as const
            ).map(({ value, label }) => (
              <button
                key={value}
                type="button"
                className={`chip${(settings.travelMode ?? 'walking') === value ? ' chip-on' : ''}`}
                aria-pressed={(settings.travelMode ?? 'walking') === value}
                onClick={() => onUpdateSettings({ travelMode: value })}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="filter-hint">
            Shows an estimated journey from where you are to each session's UCL building, on the
            timetable cards and in session details (rooms are matched against the Bloomsbury
            campus). Estimates are approximate — the Directions link gives the exact route. Your
            location never leaves this device.
          </p>
        </section>

        <section className="filter-section">
          <h3>Leave alerts</h3>
          <p className="filter-hint">
            Notifies you when it's time to set off: session start minus your live travel estimate,
            with the head start you pick (e.g. "10 min" alerts 10 minutes before you need to leave).
          </p>
          {settings.locationEnabled ? (
            <div className="chip-grid">
              {(
                [
                  { value: 0, label: 'When it’s time to leave' },
                  { value: 5, label: '5 min head start' },
                  { value: 10, label: '10 min' },
                  { value: 15, label: '15 min' },
                  { value: 30, label: '30 min' },
                ] as const
              ).map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  className={`chip${(settings.leaveAlertOffsets ?? []).includes(value) ? ' chip-on' : ''}`}
                  aria-pressed={(settings.leaveAlertOffsets ?? []).includes(value)}
                  onClick={() => void toggleOffset('leaveAlertOffsets', value)}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : (
            <p className="filter-hint">Enable travel times above first — leave alerts need your location.</p>
          )}
          {settings.locationEnabled && (settings.leaveAlertOffsets ?? []).length === 0 && (
            <p className="filter-hint">Leave alerts are off.</p>
          )}
        </section>

        {pastSessions.length > 0 && (
          <section className="filter-section">
            <h3>Attendance</h3>
            <p className="filter-hint">
              {attendedCount} of {pastSessions.length} past sessions marked attended (
              {Math.round((attendedCount / pastSessions.length) * 100)}%).
            </p>
            {subjectRows.length > 0 && (
              <ul className="attendance-list">
                {subjectRows.map(([subject, { attended, total }]) => (
                  <li key={subject}>
                    <span className="attendance-subject">{subject}</span>
                    <span className="attendance-count">
                      {attended}/{total}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" className="btn-secondary" onClick={downloadAttendanceCSV}>
              Export attendance CSV
            </button>
          </section>
        )}

        <section className="filter-section">
          <h3>Calendar export</h3>
          <p className="filter-hint">
            Downloads your filtered timetable ({exportSessions.length} sessions
            {keyDates.length > 0 ? ` + ${keyDates.length} key dates` : ''}) as an .ics file you can
            import into Google, Apple or Outlook calendars. Key dates export as all-day 📌 events.
          </p>
          <button
            type="button"
            className="btn-secondary"
            disabled={exportSessions.length === 0 && keyDates.length === 0}
            onClick={() => downloadICS([...exportSessions, ...keyDates], 'My Timetable')}
          >
            Download .ics file
          </button>
        </section>

        <section className="filter-section">
          <h3>Backup</h3>
          <p className="filter-hint">
            Everything lives on this device only. Export a backup (timetables, filters, notes,
            attendance) and import it on a new device or after clearing browser data.
          </p>
          <div className="btn-row">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => downloadFile('my-timetable-backup.json', exportBackup(), 'application/json')}
            >
              Export backup
            </button>
            <button type="button" className="btn-secondary" onClick={() => importInput.current?.click()}>
              Import backup
            </button>
            <input
              ref={importInput}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleImportFile(file)
                e.target.value = ''
              }}
            />
          </div>
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
                  <button type="button" className="btn-secondary" onClick={() => copy(feedUrl, 'feed')}>
                    {copied === 'feed' ? 'Copied!' : 'Copy feed URL'}
                  </button>
                </>
              )}
            </>
          )}
        </section>

        <section className="filter-section">
          <h3>Support this app</h3>
          <p className="filter-hint">
            My Timetable is free and runs on free hosting. If it saves you time, you can buy the
            developer a coffee.
          </p>
          <a
            className="btn-secondary btn-link kofi-link"
            href="https://ko-fi.com/awsaqib"
            target="_blank"
            rel="noopener noreferrer"
          >
            ☕ Support on Ko-fi ↗
          </a>
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

import { useState } from 'react'
import type { FormEvent } from 'react'
import { deriveOptions } from '../lib/filters'
import { fetchGvizTable } from '../lib/gviz'
import { parseTimetable } from '../lib/parseTimetable'
import { parseSheetUrl } from '../lib/sheetUrl'
import { sessionInMembership } from '../../shared/membership.js'
import type { Session } from '../types'
import { activeCourse } from '../lib/course'
import { IconBell, IconDownload, IconPin, IconRefresh, IconSchedule, IconSchool } from './ui'

export interface SetupResult {
  url: string
  sheetId: string
  gid: string | null
  name: string
  mySpecialisms: string[]
  myGroups: string[]
  sessions: Session[]
}

interface Props {
  defaultName: string
  onComplete: (result: SetupResult) => void
  onDemo: () => void
  onCancel?: () => void
}

const FEATURES: { icon: JSX.Element; title: string; text: string }[] = [
  { icon: <IconRefresh />, title: 'Always up to date', text: 'Reads the sheet directly — edits appear on the next refresh, no re-import.' },
  { icon: <IconSchedule size={20} />, title: 'Day, week & month views', text: 'A clean agenda with your filters, clash warnings and free-slot finder.' },
  { icon: <IconBell />, title: 'Smart reminders', text: 'Session, deadline and “time to leave” alerts — even with the app closed.' },
  { icon: <IconPin size={20} />, title: 'Live travel times', text: 'TfL routes, departures and disruption warnings to every session.' },
  { icon: <IconSchool />, title: 'Placement-aware', text: 'School-experience blocks, day counting and directions to your school.' },
  { icon: <IconDownload />, title: 'Installs like an app', text: 'Install it for offline access to saved timetables. Optional online features use external services.' },
]

interface Draft {
  url: string
  sheetId: string
  gid: string | null
  sessions: Session[]
  warnings: string[]
}

/**
 * Onboarding (P4-09): Connect → Personalise → Preview. The sheet is validated
 * before anything is saved; Back never loses choices; the profile is created
 * only after a successful validated preview. A failed load can never replace
 * an existing profile. Optional permissions are not prerequisites — they live
 * in Settings after setup.
 */
export function SetupScreen({ defaultName, onComplete, onDemo, onCancel }: Props) {
  const [step, setStep] = useState<'connect' | 'personalise' | 'preview'>('connect')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [name, setName] = useState(defaultName)
  const [mySpecialisms, setMySpecialisms] = useState<string[]>([])
  const [myGroups, setMyGroups] = useState<string[]>([])
  const firstRun = !onCancel

  const todayISO = (() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })()

  async function handleConnect(e: FormEvent) {
    e.preventDefault()
    if (!url.trim() || busy) return
    const parsedUrl = parseSheetUrl(url.trim())
    // Validate the link shape EARLY, before any network request.
    if (!parsedUrl) {
      setError('That doesn’t look like a Google Sheets link. It should contain /spreadsheets/d/…')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const table = await fetchGvizTable(parsedUrl.sheetId, parsedUrl.gid)
      const result = parseTimetable(table)
      if (result.sessions.length === 0) {
        setError(
          'That tab loaded but no timetable rows were recognised. Open the sheet on the timetable tab you want (the URL then contains its gid) and paste that link.'
        )
        return
      }
      setDraft({
        url: url.trim(),
        sheetId: parsedUrl.sheetId,
        gid: parsedUrl.gid,
        sessions: result.sessions,
        warnings: result.warnings,
      })
      setStep('personalise')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong loading that sheet.')
    } finally {
      setBusy(false)
    }
  }

  const toggle = (list: string[], value: string, set: (v: string[]) => void) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value])

  if (step !== 'connect' && draft) {
    const options = deriveOptions(draft.sessions)
    const membership = {
      specialisms: mySpecialisms,
      groups: myGroups,
    }
    const mine = draft.sessions.filter((s) => sessionInMembership(s, membership))
    const upcoming = mine.filter((s) => s.dateISO >= todayISO).slice(0, 5)
    const excluded = draft.sessions.length - mine.length

    if (step === 'personalise') {
      return (
        <div className="setup">
          <div className="setup-card">
            <p className="setup-step">Step 2 of 3 · Personalise</p>
            <h1>Make it yours</h1>
            <p className="filter-hint">
              Course: {activeCourse().name} — switch course or import a shared template any time
              in Settings → My timetable → Course setup.
            </p>
            <label className="ui-field">
              <span className="ui-field-label">Timetable name</span>
              <input type="text" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
            </label>
            {options.specialisms.length > 0 && (
              <>
                <h3 className="subheading">Your specialisms</h3>
                <p className="filter-hint">Sessions for other specialisms are hidden. Pick none to keep them all.</p>
                <div className="chip-grid">
                  {options.specialisms.map((v) => (
                    <button
                      key={v}
                      type="button"
                      className={`chip${mySpecialisms.includes(v) ? ' chip-on' : ''}`}
                      aria-pressed={mySpecialisms.includes(v)}
                      onClick={() => toggle(mySpecialisms, v, setMySpecialisms)}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </>
            )}
            {options.groups.length > 1 && (
              <>
                <h3 className="subheading">Your group</h3>
                <p className="filter-hint">
                  Group lists and ranges like “1-10” are understood. Sessions with no group apply to everyone.
                </p>
                <div className="chip-grid">
                  {options.groups.map((v) => (
                    <button
                      key={v}
                      type="button"
                      className={`chip${myGroups.includes(v) ? ' chip-on' : ''}`}
                      aria-pressed={myGroups.includes(v)}
                      onClick={() => toggle(myGroups, v, setMyGroups)}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </>
            )}
            <p className="filter-hint">
              Deadlines, cohort notices and extra timetable tabs can be connected later — paste each tab's
              link under Settings → My timetable (tab discovery isn't possible with a public sheet link
              alone).
            </p>
            <div className="btn-row">
              <button type="button" className="btn-ghost" onClick={() => setStep('connect')}>
                ‹ Back
              </button>
              <button type="button" className="btn-primary" onClick={() => setStep('preview')}>
                Preview timetable
              </button>
            </div>
          </div>
        </div>
      )
    }

    return (
      <div className="setup">
        <div className="setup-card">
          <p className="setup-step">Step 3 of 3 · Preview</p>
          <h1>{name || 'My timetable'}</h1>
          <p className="setup-lead">
            {mine.length} session{mine.length === 1 ? '' : 's'} for you
            {excluded > 0 ? ` (${excluded} other-group/specialism rows hidden)` : ''}.
          </p>
          {upcoming.length > 0 ? (
            <ul className="setup-preview-list">
              {upcoming.map((s) => (
                <li key={s.id}>
                  <span className="setup-preview-when">
                    {s.dateISO.split('-').reverse().slice(0, 2).join('/')} {s.start}
                  </span>
                  <span className="setup-preview-title">{s.title}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="filter-hint">
              No upcoming sessions from today — past rows still import, and new sheet rows appear on refresh.
            </p>
          )}
          {draft.warnings.length > 0 && (
            <details className="setup-warnings">
              <summary>
                {draft.warnings.length} row{draft.warnings.length === 1 ? '' : 's'} need
                {draft.warnings.length === 1 ? 's' : ''} attention (skipped, not guessed)
              </summary>
              <ul>
                {draft.warnings.slice(0, 10).map((w, i) => (
                  <li key={i} className="filter-hint">
                    {w} Fix the sheet cell, or leave it — nothing is invented from an invalid value.
                  </li>
                ))}
                {draft.warnings.length > 10 && (
                  <li className="filter-hint">…and {draft.warnings.length - 10} more.</li>
                )}
              </ul>
            </details>
          )}
          <div className="btn-row">
            <button type="button" className="btn-ghost" onClick={() => setStep('personalise')}>
              ‹ Back
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() =>
                onComplete({
                  url: draft.url,
                  sheetId: draft.sheetId,
                  gid: draft.gid,
                  name: name.trim() || defaultName,
                  mySpecialisms,
                  myGroups,
                  sessions: draft.sessions,
                })
              }
            >
              Save this timetable
            </button>
          </div>
          <p className="filter-hint">Nothing is saved until you confirm here.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="setup">
      <div className="setup-card">
        {firstRun ? <p className="setup-step">Step 1 of 3 · Connect</p> : null}
        <h1>My Timetable</h1>
        {firstRun && (
          <p className="setup-tagline">
            Turn a supported public Google Sheets timetable into a fast, installable app — reminders, travel times
            and calendar sync included. Built for course cohorts.
          </p>
        )}
        <p className="setup-lead">
          Paste the link to your timetable Google Sheet. Open the sheet on the tab you want (e.g.{' '}
          <em>Group 2 Timetable</em>) and copy the URL from the address bar — it remembers which tab
          you chose.
        </p>
        <form onSubmit={handleConnect}>
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
            {busy ? 'Checking the sheet…' : 'Connect timetable'}
          </button>
        </form>
        {error && <p className="setup-error">{error}</p>}
        <p className="setup-note">
          The sheet must be shared as <strong>“anyone with the link can view”</strong> — the app reads it
          directly and stores the URL on this device (included if you enable encrypted sync). Notifications
          and location are optional and asked for later, never required for setup.
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
                Support the app
              </a>
            </p>
          </>
        )}
      </div>
    </div>
  )
}

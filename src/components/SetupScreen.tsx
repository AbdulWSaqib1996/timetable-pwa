import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { deriveOptions } from '../lib/filters'
import { fetchGvizTable } from '../lib/gviz'
import { parseTimetable } from '../lib/parseTimetable'
import { parseSheetUrl } from '../lib/sheetUrl'
import { geocodeAddress } from '../lib/geocode'
import { sessionInMembership } from '../../shared/membership.js'
import type { Session, Settings } from '../types'
import { activeCourse } from '../lib/course'
import { USER_GUIDE_HTML, USER_GUIDE_PDF } from '../lib/guide'
import { IconBell, IconCalendar, IconCheck, IconDownload, IconPin, IconRefresh, IconSchedule, IconSchool } from './ui'

/** Optional per-profile choices made during guided setup; merged into the new profile's settings. */
export type SetupExtras = Pick<
  Settings,
  | 'reminderOffsets'
  | 'locationEnabled'
  | 'travelMode'
  | 'homeAddress'
  | 'homeLat'
  | 'homeLng'
  | 'keyDatesUrl'
  | 'keyDatesSheetId'
  | 'keyDatesGid'
  | 'keyDateReminderDays'
>

export interface SetupResult {
  url: string
  sheetId: string
  gid: string | null
  name: string
  mySpecialisms: string[]
  myGroups: string[]
  sessions: Session[]
  extras: SetupExtras
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

const LINK_STEPS = [
  'Open your timetable in Google Sheets.',
  'Click the tab at the bottom with your timetable (e.g. “Group 2 Timetable”).',
  'Share → General access → “Anyone with the link” can view.',
  'Copy the whole address from the browser bar and paste it below.',
]

const REMINDER_OPTIONS = [
  { value: 5, label: '5 min' },
  { value: 10, label: '10 min' },
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hour' },
  { value: 120, label: '2 hours' },
]

const KEY_DATE_REMINDER_OPTIONS = [
  { value: 7, label: '7 days before' },
  { value: 3, label: '3 days before' },
  { value: 1, label: '1 day before' },
]

const TRAVEL_MODES: { value: NonNullable<Settings['travelMode']>; label: string }[] = [
  { value: 'walking', label: 'Walking' },
  { value: 'transit', label: 'Public transport' },
  { value: 'driving', label: 'Driving' },
]

type Step = 'welcome' | 'connect' | 'sessions' | 'reminders' | 'travel' | 'deadlines' | 'review'

const STEPS: { id: Exclude<Step, 'welcome'>; label: string }[] = [
  { id: 'connect', label: 'Connect' },
  { id: 'sessions', label: 'Your sessions' },
  { id: 'reminders', label: 'Reminders' },
  { id: 'travel', label: 'Travel' },
  { id: 'deadlines', label: 'Deadlines' },
  { id: 'review', label: 'Review' },
]

interface Draft {
  url: string
  sheetId: string
  gid: string | null
  sessions: Session[]
  warnings: string[]
}

/** What the pasted text looks like, before any network request. */
function linkStatus(text: string): { tone: 'ok' | 'warn' | 'none'; message: string } | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const parsed = parseSheetUrl(trimmed)
  if (!parsed) return { tone: 'warn', message: 'Not a Google Sheets link yet — it should contain /spreadsheets/d/…' }
  if (parsed.gid == null)
    return {
      tone: 'none',
      message: 'Sheet recognised, but no tab is chosen, so the first tab will be used. To pick a tab, open it and copy the link again.',
    }
  return { tone: 'ok', message: 'Google Sheet and tab recognised — ready to connect.' }
}

const toggleIn = <T,>(list: T[], value: T): T[] => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value])

// Clipboard reading needs a secure context and isn't offered by every browser.
const canPaste = typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * Guided onboarding (Pass 91): Welcome → Connect → Your sessions →
 * Reminders → Travel → Deadlines → Review. The sheet is validated before
 * anything is saved; Back never loses choices; every step after “Your
 * sessions” is optional (Skip) and can be changed later in Settings. The
 * profile is created only on “Save this timetable”; a failed load can never
 * replace an existing profile (P4-09).
 */
export function SetupScreen({ defaultName, onComplete, onDemo, onCancel }: Props) {
  const firstRun = !onCancel
  const [step, setStep] = useState<Step>(firstRun ? 'welcome' : 'connect')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [name, setName] = useState(defaultName)
  const [mySpecialisms, setMySpecialisms] = useState<string[]>([])
  const [myGroups, setMyGroups] = useState<string[]>([])
  const [ticked, setTicked] = useState<number[]>([])
  // Optional extras
  const [reminders, setReminders] = useState<number[]>([])
  const [notifState, setNotifState] = useState<NotificationPermission | 'unsupported'>(() =>
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
  )
  const [travelMode, setTravelMode] = useState<NonNullable<Settings['travelMode']>>('walking')
  const [locationOn, setLocationOn] = useState(false)
  const [homeAddr, setHomeAddr] = useState('')
  const [home, setHome] = useState<{ address: string; lat?: number; lng?: number } | null>(null)
  const [homeStatus, setHomeStatus] = useState<'working' | 'ok' | 'fail' | null>(null)
  const [keyDatesUrl, setKeyDatesUrl] = useState('')
  const [keyDateDays, setKeyDateDays] = useState<number[]>([7, 1])

  const headingRef = useRef<HTMLHeadingElement | null>(null)
  const firstRender = useRef(true)
  useEffect(() => {
    // Move focus to the new step's heading so keyboard and screen-reader users follow along.
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    headingRef.current?.focus()
    window.scrollTo?.({ top: 0 })
  }, [step])

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
      setStep('sessions')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong loading that sheet.')
    } finally {
      setBusy(false)
    }
  }

  async function pasteLink(set: (v: string) => void) {
    try {
      const text = await navigator.clipboard.readText()
      if (text) set(text.trim())
    } catch {
      /* clipboard read refused or unsupported — the field still accepts a normal paste */
    }
  }

  async function toggleReminder(mins: number) {
    const next = toggleIn(reminders, mins).sort((a, b) => a - b)
    setReminders(next)
    // Ask for permission while the learner is looking at the choice (a user gesture).
    if (next.length > 0 && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      setNotifState(await Notification.requestPermission())
    }
  }

  function toggleLocationChoice(enabled: boolean) {
    setLocationOn(enabled)
    if (enabled && 'geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        () => {},
        () => {}
      )
    }
  }

  function findHome() {
    const address = homeAddr.trim()
    if (!address) {
      setHome(null)
      setHomeStatus(null)
      return
    }
    setHomeStatus('working')
    void geocodeAddress(address).then((located) => {
      setHome({ address, lat: located?.lat, lng: located?.lng })
      setHomeStatus(located ? 'ok' : 'fail')
    })
  }

  const keyDatesParsed = keyDatesUrl.trim() ? parseSheetUrl(keyDatesUrl.trim()) : null
  const keyDatesInvalid = !!keyDatesUrl.trim() && !keyDatesParsed

  function buildExtras(): SetupExtras {
    const extras: SetupExtras = { travelMode }
    if (reminders.length > 0) extras.reminderOffsets = reminders
    if (locationOn) extras.locationEnabled = true
    // A typed address that was never looked up is still kept; the journey home locates it later.
    const address = home?.address ?? homeAddr.trim()
    if (address) {
      extras.homeAddress = address
      if (home?.address === address && home.lat != null && home.lng != null) {
        extras.homeLat = home.lat
        extras.homeLng = home.lng
      }
    }
    if (keyDatesParsed) {
      extras.keyDatesUrl = keyDatesUrl.trim()
      extras.keyDatesSheetId = keyDatesParsed.sheetId
      extras.keyDatesGid = keyDatesParsed.gid
      if (keyDateDays.length > 0) extras.keyDateReminderDays = keyDateDays
    }
    return extras
  }

  // ---- shared chrome -------------------------------------------------------

  const stepIndex = STEPS.findIndex((s) => s.id === step)
  const progress =
    stepIndex >= 0 ? (
      <div className="guided-progress">
        <p className="setup-step">
          Step {stepIndex + 1} of {STEPS.length} · {STEPS[stepIndex].label}
        </p>
        <div
          className="guided-bar"
          role="progressbar"
          aria-label="Setup progress"
          aria-valuemin={1}
          aria-valuemax={STEPS.length}
          aria-valuenow={stepIndex + 1}
        >
          <span style={{ width: `${((stepIndex + 1) / STEPS.length) * 100}%` }} />
        </div>
        <ol className="guided-steps" aria-label="Setup steps">
          {STEPS.map((s, i) => (
            <li
              key={s.id}
              className={i === stepIndex ? 'is-current' : i < stepIndex ? 'is-done' : undefined}
              aria-current={i === stepIndex ? 'step' : undefined}
            >
              {i < stepIndex ? <IconCheck size={12} /> : null}
              {s.label}
            </li>
          ))}
        </ol>
      </div>
    ) : null

  const card = (children: ReactNode) => (
    <div className="setup">
      <div className="setup-card guided-card">
        {progress}
        {children}
      </div>
    </div>
  )

  const optionalNav = (back: Step, next: Step, hasChoice: boolean) => (
    <div className="guided-nav">
      <button type="button" className="btn-ghost" onClick={() => setStep(back)}>
        ‹ Back
      </button>
      <button type="button" className={hasChoice ? 'btn-primary' : 'btn-secondary'} onClick={() => setStep(next)}>
        {hasChoice ? 'Continue' : 'Skip for now'}
      </button>
    </div>
  )

  // ---- Welcome -------------------------------------------------------------

  if (step === 'welcome') {
    return (
      <div className="setup">
        <div className="setup-card guided-card">
          <h1 ref={headingRef} tabIndex={-1}>
            My Timetable
          </h1>
          <p className="setup-tagline">
            Turn a supported public Google Sheets timetable into a fast, installable app — reminders, travel times
            and calendar sync included. Built for course cohorts.
          </p>
          <p className="setup-lead">
            We’ll set it up together in a few short steps: connect your sheet, pick the sessions that are yours,
            then optionally choose reminders, travel and deadlines. You can skip anything optional and change it
            later in Settings.
          </p>
          <ol className="guided-overview">
            {STEPS.map((s, i) => (
              <li key={s.id}>
                <span className="guided-overview-num" aria-hidden="true">
                  {i + 1}
                </span>
                {s.label}
                {i >= 2 && i < STEPS.length - 1 ? <span className="guided-optional">optional</span> : null}
              </li>
            ))}
          </ol>
          <button type="button" className="btn-primary guided-wide" onClick={() => setStep('connect')}>
            Let’s get started
          </button>
          <button type="button" className="btn-ghost guided-wide" onClick={onDemo}>
            Or try it with demo data
          </button>
          <p className="setup-footer setup-guide">
            Prefer to read first? See the{' '}
            <a href={USER_GUIDE_HTML} target="_blank" rel="noopener">
              illustrated user guide
            </a>{' '}
            (or{' '}
            <a href={USER_GUIDE_PDF} target="_blank" rel="noopener" download>
              download the PDF
            </a>
            ).
          </p>
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
            Got a share link from a coursemate instead? Just open it — everything configures itself. ·{' '}
            <a href="https://ko-fi.com/awsaqib" target="_blank" rel="noopener noreferrer">
              Support the app
            </a>
          </p>
        </div>
      </div>
    )
  }

  // ---- Connect -------------------------------------------------------------

  if (step === 'connect' || !draft) {
    const status = linkStatus(url)
    return card(
      <>
        <h1 ref={headingRef} tabIndex={-1}>
          Connect your timetable
        </h1>
        <p className="setup-lead">Paste the link to the Google Sheet your course shares with you.</p>
        <details className="guided-help" open={firstRun}>
          <summary>How do I get the link?</summary>
          <p className="filter-hint">Tick each step as you go:</p>
          <ul className="guided-checklist">
            {LINK_STEPS.map((text, i) => (
              <li key={i}>
                <label>
                  <input
                    type="checkbox"
                    checked={ticked.includes(i)}
                    onChange={() => setTicked(toggleIn(ticked, i))}
                  />
                  <span>{text}</span>
                </label>
              </li>
            ))}
          </ul>
        </details>
        <form onSubmit={handleConnect}>
          <label className="ui-field">
            <span className="ui-field-label">Timetable link</span>
            <span className="guided-input-row">
              <input
                type="url"
                inputMode="url"
                placeholder="https://docs.google.com/spreadsheets/d/…/edit#gid=…"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value)
                  setError(null)
                }}
                disabled={busy}
                aria-describedby="connect-status"
                required
              />
              {canPaste ? (
                <button type="button" className="btn-secondary guided-paste" onClick={() => void pasteLink(setUrl)} disabled={busy}>
                  Paste
                </button>
              ) : null}
            </span>
          </label>
          <p id="connect-status" className={`guided-status${status ? ` is-${status.tone}` : ''}`} aria-live="polite">
            {status ? (
              <>
                {status.tone === 'ok' ? <IconCheck size={14} /> : null} {status.message}
              </>
            ) : null}
          </p>
          <button type="submit" className="btn-primary" disabled={busy || !url.trim()}>
            {busy ? 'Checking the sheet…' : 'Connect timetable'}
          </button>
        </form>
        {error && (
          <div className="setup-error" role="alert">
            <p>{error}</p>
            <p>Most often the sheet isn’t shared yet: in Google Sheets choose Share → “Anyone with the link” → Viewer, then try again.</p>
          </div>
        )}
        <p className="setup-note">
          The app reads the sheet directly and stores the link on this device (included if you enable encrypted
          sync). Notifications and location are optional, and are only asked for if you choose them.
        </p>
        <div className="guided-nav">
          {firstRun ? (
            <button type="button" className="btn-ghost" onClick={() => setStep('welcome')} disabled={busy}>
              ‹ Back
            </button>
          ) : (
            <button type="button" className="btn-ghost" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
          )}
          <button type="button" className="btn-ghost" onClick={onDemo} disabled={busy}>
            Try demo data instead
          </button>
        </div>
      </>
    )
  }

  // ---- Steps that need the loaded sheet ------------------------------------

  const options = deriveOptions(draft.sessions)
  const membership = { specialisms: mySpecialisms, groups: myGroups }
  const mine = draft.sessions.filter((s) => sessionInMembership(s, membership))
  const upcoming = mine.filter((s) => s.dateISO >= todayISO).slice(0, 5)
  const excluded = draft.sessions.length - mine.length
  const hasChoices = options.specialisms.length > 0 || options.groups.length > 1

  const previewList = (limit: number) =>
    upcoming.length > 0 ? (
      <ul className="setup-preview-list">
        {upcoming.slice(0, limit).map((s) => (
          <li key={s.id}>
            <span className="setup-preview-when">
              {s.dateISO.split('-').reverse().slice(0, 2).join('/')} {s.start}
            </span>
            <span className="setup-preview-title">{s.title}</span>
          </li>
        ))}
      </ul>
    ) : (
      <p className="filter-hint">No upcoming sessions from today — past rows still import, and new sheet rows appear on refresh.</p>
    )

  if (step === 'sessions') {
    return card(
      <>
        <h1 ref={headingRef} tabIndex={-1}>
          Which sessions are yours?
        </h1>
        <p className="guided-success">
          <IconCheck size={14} /> Connected — {plural(draft.sessions.length, 'session')} found.
        </p>
        <p className="filter-hint">
          Course: {activeCourse().name} — switch course or import a shared template any time in Settings → My
          timetable → Course setup.
        </p>
        {!hasChoices && (
          <p className="setup-lead">Everyone on this timetable sees every session, so there is nothing to choose here.</p>
        )}
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
                  onClick={() => setMySpecialisms(toggleIn(mySpecialisms, v))}
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
            <p className="filter-hint">Group lists and ranges like “1-10” are understood. Sessions with no group apply to everyone.</p>
            <div className="chip-grid">
              {options.groups.map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`chip${myGroups.includes(v) ? ' chip-on' : ''}`}
                  aria-pressed={myGroups.includes(v)}
                  onClick={() => setMyGroups(toggleIn(myGroups, v))}
                >
                  {v}
                </button>
              ))}
            </div>
          </>
        )}
        <div className="guided-live" aria-live="polite">
          <p>
            <strong>{plural(mine.length, 'session')} for you</strong>
            {excluded > 0 ? ` · ${excluded} other-group/specialism rows hidden` : ''}
          </p>
          <p className="filter-hint">Coming up:</p>
          {previewList(3)}
        </div>
        <div className="guided-nav">
          <button type="button" className="btn-ghost" onClick={() => setStep('connect')}>
            ‹ Back
          </button>
          <button type="button" className="btn-primary" onClick={() => setStep('reminders')}>
            Continue
          </button>
        </div>
      </>
    )
  }

  if (step === 'reminders') {
    return card(
      <>
        <h1 ref={headingRef} tabIndex={-1}>
          Get a nudge before sessions?
        </h1>
        <p className="setup-lead">
          Choose when to be reminded before each session. Pick one or more, or skip — you can change this any time
          in Settings → Reminders.
        </p>
        <div className="chip-grid">
          {REMINDER_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              className={`chip${reminders.includes(value) ? ' chip-on' : ''}`}
              aria-pressed={reminders.includes(value)}
              onClick={() => void toggleReminder(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="filter-hint guided-status" aria-live="polite">
          {reminders.length === 0
            ? 'Tip: 15 minutes suits most people.'
            : notifState === 'granted'
              ? `Reminders ${reminders.map((m) => (m >= 60 ? `${m / 60} h` : `${m} min`)).join(' and ')} before each session.`
              : notifState === 'denied'
                ? 'Notifications are blocked for this site — allow them in your browser settings for reminders to appear.'
                : notifState === 'unsupported'
                  ? 'This browser can’t show notifications. Installing the app to your home screen usually fixes this.'
                  : 'Your browser will ask to allow notifications.'}
        </p>
        <p className="filter-hint">
          Reminders appear while the app is open. After setup, “Enable background push” in the Finish setting up
          list lets them arrive with the app closed.
        </p>
        {optionalNav('sessions', 'travel', reminders.length > 0)}
      </>
    )
  }

  if (step === 'travel') {
    const hasTravel = locationOn || !!homeAddr.trim() || travelMode !== 'walking'
    return card(
      <>
        <h1 ref={headingRef} tabIndex={-1}>
          How do you get there?
        </h1>
        <p className="setup-lead">Used for travel times, “time to leave” alerts and the journey home.</p>
        <h3 className="subheading">Usually I travel by</h3>
        <div className="chip-grid">
          {TRAVEL_MODES.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              className={`chip${travelMode === value ? ' chip-on' : ''}`}
              aria-pressed={travelMode === value}
              onClick={() => setTravelMode(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="toggle-row">
          <input type="checkbox" checked={locationOn} onChange={(e) => toggleLocationChoice(e.target.checked)} />
          Use my location for travel times
        </label>
        <p className="filter-hint">Your browser will ask first. Location is used on this device to plan routes.</p>
        <label className="ui-field">
          <span className="ui-field-label">Home address or postcode (optional)</span>
          <span className="guided-input-row">
            <input
              type="text"
              autoComplete="street-address"
              value={homeAddr}
              maxLength={160}
              onChange={(e) => {
                setHomeAddr(e.target.value)
                setHomeStatus(null)
              }}
              placeholder="e.g. NW1 2AB"
            />
            <button
              type="button"
              className="btn-secondary guided-paste"
              onClick={findHome}
              disabled={!homeAddr.trim() || homeStatus === 'working'}
            >
              Find
            </button>
          </span>
        </label>
        <p className={`guided-status${homeStatus === 'ok' ? ' is-ok' : homeStatus === 'fail' ? ' is-warn' : ''}`} aria-live="polite">
          {homeStatus === 'working'
            ? 'Looking up the address…'
            : homeStatus === 'ok'
              ? '✓ Address found — the journey home will start here.'
              : homeStatus === 'fail'
                ? 'Couldn’t find that address. It is still saved; try a postcode, or fix it later in Settings → Travel.'
                : 'Looked up once with postcodes.io or OpenStreetMap; kept on this device.'}
        </p>
        {optionalNav('reminders', 'deadlines', hasTravel)}
      </>
    )
  }

  if (step === 'deadlines') {
    return card(
      <>
        <h1 ref={headingRef} tabIndex={-1}>
          Add your deadlines?
        </h1>
        <p className="setup-lead">
          If your course has a tab of key dates (assignment deadlines, submissions), paste that tab’s link to see
          them in the app and get reminders. Not sure? Skip it — you can add it later in Settings → Key dates.
        </p>
        <label className="ui-field">
          <span className="ui-field-label">Key dates tab link (optional)</span>
          <span className="guided-input-row">
            <input
              type="url"
              inputMode="url"
              placeholder="https://docs.google.com/spreadsheets/d/…#gid=…"
              value={keyDatesUrl}
              onChange={(e) => setKeyDatesUrl(e.target.value)}
              aria-describedby="keydates-status"
            />
            {canPaste ? (
              <button type="button" className="btn-secondary guided-paste" onClick={() => void pasteLink(setKeyDatesUrl)}>
                Paste
              </button>
            ) : null}
          </span>
        </label>
        <p id="keydates-status" className={`guided-status${keyDatesParsed ? ' is-ok' : keyDatesInvalid ? ' is-warn' : ''}`} aria-live="polite">
          {keyDatesParsed
            ? keyDatesParsed.sheetId === draft.sheetId && keyDatesParsed.gid === draft.gid
              ? 'That is the same tab as your timetable — open the key dates tab and copy its link instead.'
              : '✓ Key dates tab recognised.'
            : keyDatesInvalid
              ? 'Not a Google Sheets link yet — it should contain /spreadsheets/d/…'
              : null}
        </p>
        {keyDatesParsed && (
          <>
            <h3 className="subheading">Remind me</h3>
            <div className="chip-grid">
              {KEY_DATE_REMINDER_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  className={`chip${keyDateDays.includes(value) ? ' chip-on' : ''}`}
                  aria-pressed={keyDateDays.includes(value)}
                  onClick={() => setKeyDateDays(toggleIn(keyDateDays, value))}
                >
                  {label}
                </button>
              ))}
            </div>
          </>
        )}
        {optionalNav('travel', 'review', !!keyDatesParsed)}
      </>
    )
  }

  // ---- Review ----------------------------------------------------------------

  const extras = buildExtras()
  const mode = TRAVEL_MODES.find((m) => m.value === travelMode)?.label ?? 'Walking'
  const summary: { label: string; value: string; go: Step }[] = [
    {
      label: 'Sessions',
      value:
        `${plural(mine.length, 'session')}` +
        (mySpecialisms.length ? ` · ${mySpecialisms.join(', ')}` : '') +
        (myGroups.length ? ` · group ${myGroups.join(', ')}` : ''),
      go: 'sessions',
    },
    {
      label: 'Reminders',
      value: reminders.length ? reminders.map((m) => (m >= 60 ? `${m / 60} h` : `${m} min`)).join(', ') + ' before' : 'Off',
      go: 'reminders',
    },
    {
      label: 'Travel',
      value: [mode, locationOn ? 'location on' : null, extras.homeAddress ? `home: ${extras.homeAddress}` : null].filter(Boolean).join(' · '),
      go: 'travel',
    },
    {
      label: 'Deadlines',
      value: extras.keyDatesSheetId
        ? `Connected${keyDateDays.length ? ` · remind ${[...keyDateDays].sort((a, b) => b - a).join('/')} days before` : ''}`
        : 'Not connected',
      go: 'deadlines',
    },
  ]

  return card(
    <>
      <h1 ref={headingRef} tabIndex={-1}>
        Ready to go
      </h1>
      <label className="ui-field">
        <span className="ui-field-label">Timetable name</span>
        <input type="text" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
      </label>
      <ul className="guided-summary">
        {summary.map((row) => (
          <li key={row.label}>
            <span className="guided-summary-main">
              <span className="guided-summary-label">{row.label}</span>
              <span>{row.value}</span>
            </span>
            <button type="button" className="btn-ghost guided-change" onClick={() => setStep(row.go)} aria-label={`Change ${row.label.toLowerCase()}`}>
              Change
            </button>
          </li>
        ))}
      </ul>
      <p className="filter-hint">
        <IconCalendar size={14} /> Coming up for you:
      </p>
      {previewList(5)}
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
            {draft.warnings.length > 10 && <li className="filter-hint">…and {draft.warnings.length - 10} more.</li>}
          </ul>
        </details>
      )}
      <div className="guided-nav">
        <button type="button" className="btn-ghost" onClick={() => setStep('deadlines')}>
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
              extras,
            })
          }
        >
          Save this timetable
        </button>
      </div>
      <p className="filter-hint">Nothing is saved until you confirm here. Everything can be changed later in Settings.</p>
    </>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { StatsError, fetchLegacyStats, fetchV2Stats } from './lib/client'
import type { LegacyStats, StatsFailure, StatsV2 } from './lib/client'
import { useAdminSession } from './lib/session'
import { StatePanel, StatusStrip } from './components/bits'
import { Overview } from './pages/Overview'
import { Adoption } from './pages/Adoption'
import { DataAccess, Releases, Reliability, Returning } from './pages/others'

const SECTIONS = [
  { id: 'overview', label: 'Overview', icon: '📈' },
  { id: 'adoption', label: 'Feature adoption', icon: '🧩' },
  { id: 'returning', label: 'Return visits', icon: '🔁' },
  { id: 'reliability', label: 'Reliability', icon: '🛡️' },
  { id: 'releases', label: 'Releases', icon: '🏷️' },
  { id: 'access', label: 'Data & access', icon: '🔐' },
] as const

type SectionId = (typeof SECTIONS)[number]['id']

const sectionFromHash = (): SectionId => {
  const h = window.location.hash.replace(/^#\/?/, '')
  return (SECTIONS.find((s) => s.id === h)?.id ?? 'overview') as SectionId
}

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; legacy: LegacyStats; v2: StatsV2 | null }
  | { status: 'error'; failure: StatsFailure }

/**
 * Admin workspace (A3): six destinations behind an in-memory session.
 * Sections live in the URL hash (Back/Forward restores them; a direct link
 * shows the locked state first because the key never persists). Every
 * response is generation-checked — nothing loaded before a Lock can render
 * after it.
 */
export function AdminApp() {
  const session = useAdminSession()
  const [section, setSection] = useState<SectionId>(sectionFromHash)
  const [data, setData] = useState<LoadState>({ status: 'idle' })
  const [theme, setTheme] = useState<string>(() => {
    try {
      return localStorage.getItem('tt.admin.theme') ?? 'system'
    } catch {
      return 'system'
    }
  })
  const keyInput = useRef<HTMLInputElement>(null)
  const [reveal, setReveal] = useState(false)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem('tt.admin.theme', theme)
    } catch {
      /* non-essential preference */
    }
  }, [theme])

  useEffect(() => {
    const onHash = () => setSection(sectionFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const load = useCallback(
    async (key: string) => {
      // Capture the LIVE generation — the render-time snapshot predates the
      // unlock that triggered this load and would mark every response stale.
      const gen = session.currentGeneration()
      session.controllerRef.current?.abort()
      const controller = new AbortController()
      session.controllerRef.current = controller
      setData({ status: 'loading' })
      let legacy: LegacyStats
      try {
        legacy = await fetchLegacyStats(key, 31, controller.signal)
      } catch (err) {
        if (!session.isCurrent(gen)) return
        const failure: StatsFailure = err instanceof StatsError ? err.failure : { kind: 'network' }
        if (failure.kind === 'unauthorized') {
          session.lock('Access expired or the key is wrong — unlock again.')
          setData({ status: 'idle' })
        } else if (failure.kind === 'config') {
          session.lock('The worker has no stats key configured (configuration unavailable). This is a server setup state, not an empty dataset.')
          setData({ status: 'idle' })
        } else {
          setData({ status: 'error', failure })
        }
        return
      }
      // v2 is additive: its absence (aggregate not yet published) must not
      // block the legacy view — it renders as an explicit state instead.
      let v2: StatsV2 | null = null
      try {
        v2 = await fetchV2Stats(key, controller.signal)
      } catch {
        v2 = null
      }
      if (!session.isCurrent(gen)) return
      setData({ status: 'ready', legacy, v2 })
    },
    [session]
  )

  const unlock = (e: React.FormEvent) => {
    e.preventDefault()
    const key = keyInput.current?.value.trim()
    if (!key) return
    if (keyInput.current) keyInput.current.value = ''
    setReveal(false)
    session.unlock(key)
    void load(key)
  }

  const lock = useCallback(
    (reason?: string) => {
      session.lock(reason)
      setData({ status: 'idle' })
    },
    [session]
  )

  // Any interaction while unlocked resets the 15-minute idle lock.
  useEffect(() => {
    if (session.locked) return
    const onActivity = () => session.touch()
    window.addEventListener('pointerdown', onActivity)
    window.addEventListener('keydown', onActivity)
    return () => {
      window.removeEventListener('pointerdown', onActivity)
      window.removeEventListener('keydown', onActivity)
    }
  }, [session.locked, session])

  const themeButton = (
    <button
      type="button"
      onClick={() => setTheme(theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system')}
      aria-label={`Theme: ${theme}. Activate to change.`}
    >
      {theme === 'system' ? '🖥 System' : theme === 'light' ? '☀️ Light' : '🌙 Dark'}
    </button>
  )

  if (session.locked) {
    return (
      <main className="lock-wrap">
        <form className="card lock-card" onSubmit={unlock}>
          <h1>My Timetable — Admin workspace</h1>
          <p className="support">
            Aggregate usage from your own push worker. Anonymous browser tokens, no third parties,
            all dates UTC.
          </p>
          {session.lockReason && <p className="form-error" role="alert">{session.lockReason}</p>}
          <label className="field-label" htmlFor="owner-key">
            Owner key
          </label>
          <div className="key-row">
            <input
              id="owner-key"
              ref={keyInput}
              type={reveal ? 'text' : 'password'}
              autoComplete="off"
              placeholder="Stats key"
              autoFocus
            />
            <button type="button" onClick={() => setReveal((v) => !v)} aria-pressed={reveal} aria-label="Show key while typing">
              {reveal ? '🙈 Hide' : '👁 Show'}
            </button>
          </div>
          <p className="support">
            Held in memory for this tab only and sent to your worker on each request — locking or
            reloading forgets it.
          </p>
          <div className="row" style={{ marginTop: 12 }}>
            <button type="submit" className="btn-primary">
              Unlock
            </button>
            {themeButton}
          </div>
        </form>
      </main>
    )
  }

  const nav = (
    <nav aria-label="Admin sections">
      {SECTIONS.map((s) => (
        <a key={s.id} href={`#${s.id}`} aria-current={section === s.id ? 'page' : undefined}>
          <span className="nav-icon" aria-hidden="true">
            {s.icon}
          </span>
          {s.label}
        </a>
      ))}
    </nav>
  )

  const body = () => {
    if (data.status === 'loading' || data.status === 'idle') {
      return <StatePanel title="Loading aggregates…">Fetching the published snapshots from your worker.</StatePanel>
    }
    if (data.status === 'error') {
      const f = data.failure
      return (
        <>
          <StatePanel tone="error" title={
            f.kind === 'rate'
              ? `Rate limited — wait ${f.retryAfterS}s, then try again.`
              : f.kind === 'invalid'
                ? 'The stats response was unusable (unexpected shape).'
                : 'Could not reach the stats server.'
          }>
            The last loaded figures were discarded rather than shown stale without a label.
          </StatePanel>
          <button type="button" className="btn-primary" onClick={() => session.key && void load(session.key)}>
            Try again
          </button>
        </>
      )
    }
    const { legacy, v2 } = data
    switch (section) {
      case 'overview':
        return <Overview legacy={legacy} v2={v2} />
      case 'adoption':
        return <Adoption legacy={legacy} v2={v2} />
      case 'returning':
        return <Returning legacy={legacy} v2={v2} />
      case 'reliability':
        return <Reliability />
      case 'releases':
        return <Releases legacy={legacy} v2={v2} />
      case 'access':
        return <DataAccess legacy={legacy} v2={v2} onLock={() => lock()} />
    }
  }

  const current = SECTIONS.find((s) => s.id === section)!
  return (
    <div className="admin-shell">
      <header className="admin-mobile-head">
        <div className="admin-brand">
          My Timetable <span className="sub">Admin workspace</span>
        </div>
        <label htmlFor="section-picker">Section</label>
        <select id="section-picker" value={section} onChange={(e) => (window.location.hash = `#${e.target.value}`)}>
          {SECTIONS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </header>
      <aside className="admin-rail">
        <div className="admin-brand">
          My Timetable <span className="sub">Admin workspace</span>
        </div>
        {nav}
      </aside>
      <main className="admin-main">
        <div className="admin-topbar">
          <h1>{current.label}</h1>
          {themeButton}
          <button type="button" onClick={() => lock()}>
            🔒 Lock
          </button>
        </div>
        {data.status === 'ready' && (
          <StatusStrip
            legacy={data.legacy}
            v2={data.v2}
            refreshing={false}
            onRefresh={() => session.key && void load(session.key)}
          />
        )}
        {body()}
      </main>
    </div>
  )
}

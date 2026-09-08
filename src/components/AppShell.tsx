import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Route } from '../lib/router'
import { activeCourse } from '../lib/course'
import { IconPGCE, IconSchedule, IconSettings, IconTasks, IconToday } from './ui'

interface Props {
  route: Route
  onNavigate: (route: Route) => void
  /** full-page details replace the bottom navigation on small screens */
  hideNav?: boolean
  /** active profile name shown in the sidebar */
  profileName?: string
  children: ReactNode
}

const destinations = (): { route: Route; label: string; icon: (props: { size?: number }) => ReactNode }[] => [
  { route: { name: 'today' }, label: 'Today', icon: IconToday },
  { route: { name: 'schedule' }, label: 'Schedule', icon: IconSchedule },
  { route: { name: 'tasks' }, label: 'Tasks', icon: IconTasks },
  // A course without the PGCE file feature (P7-01) drops the destination —
  // the shell itself stays exactly the Phase 4 shell.
  ...(activeCourse().features.pgceFile
    ? [{ route: { name: 'pgce' } as Route, label: 'PGCE file', icon: IconPGCE }]
    : []),
]

/** Identity of the page being shown — a change moves focus to its heading. */
function routeIdentity(route: Route): string {
  switch (route.name) {
    case 'settings':
      return `settings/${route.section ?? ''}`
    case 'session':
      return `session/${route.key}`
    default:
      return route.name
  }
}

/**
 * Four-destination shell (P4-01/§5.2): labelled bottom navigation on phones,
 * a sidebar from 1024px. Today · Schedule · Tasks · PGCE file are fixed
 * product language; Settings stays reachable from every destination (page
 * headers on mobile, the sidebar footer on desktop). R3 / TT-19: the nav
 * grid follows the real destination count, a skip link precedes it, and a
 * route change focuses the new page heading unless the page already placed
 * focus itself (e.g. a settings anchor).
 */
export function AppShell({ route, onNavigate, hideNav, profileName, children }: Props) {
  // Render exactly one navigation variant so assistive tech (and tests) see a
  // single Main navigation landmark.
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 1024px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const onChange = (e: MediaQueryListEvent) => setWide(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  const mainRef = useRef<HTMLElement | null>(null)
  const firstRender = useRef(true)
  const [announce, setAnnounce] = useState('')
  const identity = routeIdentity(route)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    const main = mainRef.current
    const heading = main?.querySelector<HTMLElement>('h1')
    if (!main || !heading) return
    const active = document.activeElement
    const pageTookFocus = !!active && active !== document.body && main.contains(active)
    if (!pageTookFocus) heading.focus()
    setAnnounce(heading.textContent?.trim() ?? '')
  }, [identity])

  const isActive = (dest: Route) => dest.name === route.name
  const dests = destinations()
  const nav = (variant: 'bottom' | 'side') => (
    <nav
      className={variant === 'bottom' ? 'bottom-nav' : 'side-nav'}
      aria-label="Main"
      style={variant === 'bottom' ? ({ '--nav-count': dests.length } as React.CSSProperties) : undefined}
    >
      {dests.map(({ route: dest, label, icon: Icon }) => (
        <button
          key={dest.name}
          type="button"
          className={`nav-item${isActive(dest) ? ' nav-item-on' : ''}`}
          aria-current={isActive(dest) ? 'page' : undefined}
          onClick={() => onNavigate(dest)}
        >
          <Icon size={variant === 'bottom' ? 24 : 20} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  )
  return (
    <div className={`shell${hideNav ? ' shell--no-nav' : ''}`}>
      {/* The hash router owns location.hash, so the skip link focuses the
          main landmark directly instead of navigating to a fragment. */}
      <a
        className="skip-link"
        href="#main-content"
        onClick={(e) => {
          e.preventDefault()
          mainRef.current?.focus()
        }}
      >
        Skip to content
      </a>
      {wide && (
        <aside className="shell-sidebar">
          <div className="shell-brand">
            <span className="shell-app-name">My Timetable</span>
            {profileName && (
              <span className="shell-profile" title={profileName}>
                {profileName}
              </span>
            )}
          </div>
          {nav('side')}
          <button
            type="button"
            className={`nav-item shell-settings${route.name === 'settings' ? ' nav-item-on' : ''}`}
            aria-current={route.name === 'settings' ? 'page' : undefined}
            onClick={() => onNavigate({ name: 'settings' })}
          >
            <IconSettings size={20} />
            <span>Settings</span>
          </button>
        </aside>
      )}
      <main className="shell-main" id="main-content" tabIndex={-1} ref={mainRef}>
        {children}
      </main>
      <div className="visually-hidden" role="status" aria-live="polite">
        {announce}
      </div>
      {!wide && !hideNav && nav('bottom')}
    </div>
  )
}

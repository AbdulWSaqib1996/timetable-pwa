import { useEffect, useState } from 'react'
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

/**
 * Four-destination shell (P4-01/§5.2): labelled bottom navigation on phones,
 * a sidebar from 1024px. Today · Schedule · Tasks · PGCE file are fixed
 * product language; Settings stays reachable from every destination (page
 * headers on mobile, the sidebar footer on desktop).
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
  const isActive = (dest: Route) => dest.name === route.name
  const nav = (variant: 'bottom' | 'side') => (
    <nav className={variant === 'bottom' ? 'bottom-nav' : 'side-nav'} aria-label="Main">
      {destinations().map(({ route: dest, label, icon: Icon }) => (
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
      {wide && (
        <aside className="shell-sidebar">
          <div className="shell-brand">
            <span className="shell-app-name">My Timetable</span>
            {profileName && <span className="shell-profile">{profileName}</span>}
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
      <main className="shell-main">{children}</main>
      {!wide && !hideNav && nav('bottom')}
    </div>
  )
}

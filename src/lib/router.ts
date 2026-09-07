import { useEffect, useState } from 'react'

/**
 * Hash-based routing for the Phase 4 shell (works identically under both
 * hosting base paths; `#setup=` share links are consumed by initStore before
 * the router ever sees them). Top-level destinations plus full-page details.
 */
export type Route =
  | { name: 'today' }
  | { name: 'schedule' }
  | { name: 'tasks' }
  | { name: 'pgce' }
  | { name: 'settings'; section?: string }
  | { name: 'session'; key: string }
  | { name: 'homeJourney' }
  | { name: 'placement' }

export const TOP_LEVEL: Route['name'][] = ['today', 'schedule', 'tasks', 'pgce']

export function routeHash(route: Route): string {
  switch (route.name) {
    case 'today':
      return '#/today'
    case 'schedule':
      return '#/schedule'
    case 'tasks':
      return '#/tasks'
    case 'pgce':
      return '#/pgce'
    case 'settings':
      return route.section ? `#/settings/${route.section}` : '#/settings'
    case 'session':
      return `#/session/${encodeURIComponent(route.key)}`
    case 'homeJourney':
      return '#/home'
    case 'placement':
      return '#/placement'
  }
}

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/')
  switch (parts[0]) {
    case 'schedule':
      return { name: 'schedule' }
    case 'tasks':
      return { name: 'tasks' }
    case 'pgce':
      return { name: 'pgce' }
    case 'settings':
      return { name: 'settings', section: parts[1] || undefined }
    case 'session':
      return parts[1] ? { name: 'session', key: decodeURIComponent(parts[1]) } : { name: 'today' }
    case 'home':
      return { name: 'homeJourney' }
    case 'placement':
      return { name: 'placement' }
    default:
      return { name: 'today' }
  }
}

/**
 * Current route + navigation. `navigate` pushes a history entry (so the
 * browser Back button walks detail → caller); `replace: true` swaps in place.
 * Back from a detail restores the caller because only the hash changes —
 * top-level scroll positions are per-page (the pages remount, and the
 * Schedule keeps its own anchors).
 */
export function useRoute(): [Route, (route: Route, opts?: { replace?: boolean }) => void] {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))
  useEffect(() => {
    const onHash = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const navigate = (next: Route, opts?: { replace?: boolean }) => {
    const hash = routeHash(next)
    if (hash === window.location.hash) return
    if (opts?.replace) {
      history.replaceState(null, '', hash)
      setRoute(next)
    } else {
      window.location.hash = hash
    }
  }
  return [route, navigate]
}

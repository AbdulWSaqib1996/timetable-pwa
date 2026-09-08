import { useEffect, useState } from 'react'
import { noteHistoryPop, noteInternalNavigation, parseRouteSafe } from './navigationState'

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
  /** untrusted hash that could not be opened (R1 / TT-08) */
  | { name: 'invalid'; reason: 'malformed' | 'oversized' | 'unknown' }

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
    case 'invalid':
      return '#/today'
  }
}

/** Safe parse (never throws): malformed/oversized/unknown → an invalid route. */
export function parseRoute(hash: string): Route {
  const parsed = parseRouteSafe(hash)
  return parsed.ok ? parsed.route : { name: 'invalid', reason: parsed.reason }
}

/** A notice attached to an otherwise-valid parse (e.g. unknown settings section). */
export function parseRouteNotice(hash: string): string | null {
  const parsed = parseRouteSafe(hash)
  return parsed.ok ? (parsed.notice ?? null) : null
}

/**
 * Current route + navigation. `navigate` pushes a history entry (so the
 * browser Back button walks detail → caller); `replace: true` swaps in place.
 * Back from a detail restores the caller because only the hash changes —
 * top-level scroll positions are per-page (the pages remount, and the
 * Schedule keeps its own anchors).
 */
export function useRoute(): [Route, (route: Route, opts?: { replace?: boolean }) => void, string | null] {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))
  const [notice, setNotice] = useState<string | null>(() => parseRouteNotice(window.location.hash))
  useEffect(() => {
    const onHash = () => {
      setRoute(parseRoute(window.location.hash))
      setNotice(parseRouteNotice(window.location.hash))
    }
    // Back/Forward consume one internal entry (R1 / TT-08 return context).
    const onPop = () => noteHistoryPop()
    window.addEventListener('hashchange', onHash)
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('hashchange', onHash)
      window.removeEventListener('popstate', onPop)
    }
  }, [])
  const navigate = (next: Route, opts?: { replace?: boolean }) => {
    const hash = routeHash(next)
    if (hash === window.location.hash) return
    if (opts?.replace) {
      history.replaceState(null, '', hash)
      setRoute(next)
      setNotice(null)
    } else {
      noteInternalNavigation()
      window.location.hash = hash
    }
  }
  return [route, navigate, notice]
}

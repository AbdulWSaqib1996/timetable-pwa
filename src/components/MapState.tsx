import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * Map load state (R2 / TT-16). Raster tiles fail silently and a pin on blank
 * space looks like a map with no geography. The maps report every tile's
 * load/error; this wrapper turns that into ONE honest status — loading,
 * ok, partial ("Some map tiles unavailable") or failed ("Map could not
 * load") — with a Retry that re-requests once, never a loop, and a single
 * screen-reader announcement rather than one per tile.
 */

export type TileStatus = 'loading' | 'ok' | 'partial' | 'failed'

export interface TileTracker {
  status: TileStatus
  /** bump to re-request every tile once */
  nonce: number
  onLoad: () => void
  onError: () => void
  retry: () => void
}

const REQUEST_WINDOW_MS = 8000

export function useTileStatus(total: number): TileTracker {
  const [nonce, setNonce] = useState(0)
  const [counts, setCounts] = useState({ loaded: 0, failed: 0 })
  const [timedOut, setTimedOut] = useState(false)
  const settled = counts.loaded + counts.failed
  const totalRef = useRef(total)
  totalRef.current = total

  useEffect(() => {
    setCounts({ loaded: 0, failed: 0 })
    setTimedOut(false)
    const t = setTimeout(() => setTimedOut(true), REQUEST_WINDOW_MS)
    return () => clearTimeout(t)
  }, [nonce, total])

  const onLoad = useCallback(() => setCounts((c) => ({ ...c, loaded: c.loaded + 1 })), [])
  const onError = useCallback(() => setCounts((c) => ({ ...c, failed: c.failed + 1 })), [])
  const retry = useCallback(() => setNonce((n) => n + 1), [])

  let status: TileStatus
  if (total === 0) status = 'failed'
  else if (settled < total && !timedOut) status = counts.failed > 0 && counts.loaded === 0 && settled === total ? 'failed' : 'loading'
  else if (counts.loaded === 0) status = 'failed'
  else if (counts.failed > 0 || settled < total) status = 'partial'
  else status = 'ok'

  return { status, nonce, onLoad, onError, retry }
}

interface Props {
  tracker: TileTracker
  /** readable address shown when the map cannot stand in for geography */
  address?: string | null
  children: ReactNode
}

export function MapState({ tracker, address, children }: Props) {
  const { status, retry } = tracker
  const message =
    status === 'failed'
      ? typeof navigator !== 'undefined' && navigator.onLine === false
        ? 'Map unavailable offline'
        : 'Map could not load'
      : status === 'partial'
        ? 'Some map tiles unavailable'
        : status === 'loading'
          ? 'Loading map…'
          : ''
  return (
    <div className={`map-state map-state-${status}`}>
      {status !== 'failed' && children}
      {status === 'failed' && (
        <div className="map-fallback ui-card" aria-hidden="false">
          <p className="filter-hint">
            {message}
            {address ? ` — ${address}` : ''}
          </p>
          <button type="button" className="btn-secondary" onClick={retry}>
            Retry map
          </button>
        </div>
      )}
      {status === 'partial' && (
        <p className="filter-hint map-partial-note">
          {message}{' '}
          <button type="button" className="travel-link" onClick={retry}>
            Retry
          </button>
        </p>
      )}
      {/* One announcement per status change — never per tile. */}
      <span className="visually-hidden" role="status" aria-live="polite">
        {message}
      </span>
    </div>
  )
}

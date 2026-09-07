import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Admin session (A3 / ADM-02): the owner key lives in REACT STATE only —
 * never persisted, gone on reload. Locking (manual, 401, or 15 minutes of
 * inactivity) bumps a generation and aborts in-flight requests so a late
 * response can never repopulate a locked screen. Idle locking is a local
 * privacy safeguard, not server-side credential expiry.
 */

export const IDLE_LOCK_MS = 15 * 60_000

export interface AdminSession {
  key: string | null
  locked: boolean
  /** why the lock screen is showing (shown to the user) */
  lockReason: string | null
  generation: number
  unlock: (key: string) => void
  lock: (reason?: string) => void
  /** register user activity (resets the idle timer) */
  touch: () => void
  /** the LIVE generation at call time (render snapshots go stale) */
  currentGeneration: () => number
  /** true while `gen` is still the live generation */
  isCurrent: (gen: number) => boolean
  /** abort signal holder for in-flight loads */
  controllerRef: React.MutableRefObject<AbortController | null>
}

export function useAdminSession(): AdminSession {
  const [key, setKey] = useState<string | null>(null)
  const [lockReason, setLockReason] = useState<string | null>(null)
  const genRef = useRef(0)
  const [, forceRender] = useState(0)
  const controllerRef = useRef<AbortController | null>(null)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const lock = useCallback((reason?: string) => {
    genRef.current++
    controllerRef.current?.abort()
    controllerRef.current = null
    setKey(null)
    setLockReason(reason ?? null)
    if (idleTimer.current) clearTimeout(idleTimer.current)
    forceRender((n) => n + 1)
  }, [])

  const touch = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => lock('Locked after 15 minutes of inactivity.'), IDLE_LOCK_MS)
  }, [lock])

  const unlock = useCallback(
    (k: string) => {
      genRef.current++
      setKey(k)
      setLockReason(null)
      touch()
      forceRender((n) => n + 1)
    },
    [touch]
  )

  useEffect(
    () => () => {
      if (idleTimer.current) clearTimeout(idleTimer.current)
      controllerRef.current?.abort()
    },
    []
  )

  return {
    key,
    locked: key === null,
    lockReason,
    generation: genRef.current,
    unlock,
    lock,
    touch,
    currentGeneration: () => genRef.current,
    isCurrent: (gen) => gen === genRef.current,
    controllerRef,
  }
}

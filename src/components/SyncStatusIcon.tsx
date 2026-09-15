import { useEffect, useRef, useState } from 'react'
import { SYNC_STATUS_EVENT, getSyncStatusDetail, loadSyncState, pushSync } from '../lib/sync'
import { loadStore } from '../lib/storage'
import { DEFAULT_PUSH_BASE } from '../lib/config'

/**
 * Sync status as a small header control (owner request, 16 September 2026).
 * A routine "Synced" used to take a full-width banner above every page on
 * every exchange; it is now this icon, and the message only appears when the
 * icon is pressed. Problems still reach the user: a failure or a waiting
 * change tints the icon, adds a dot, says so in the icon's accessible name
 * and is announced once through a polite live region — routine success is
 * never announced.
 */

type State = 'off' | 'busy' | 'ok' | 'waiting' | 'failed'

/** The shared refresh glyph, inlined so the header (ui.tsx) can own this component without an import cycle. */
const SyncGlyph = () => (
  <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 5v5h-5" />
    <path d="M19.4 13a7.6 7.6 0 1 1-1.6-6.3L20 9" />
  </svg>
)

const stateOf = (message: string, failed: boolean, busy: boolean, configured: boolean): State => {
  if (failed) return 'failed'
  if (busy || message.startsWith('Syncing…')) return 'busy'
  if (message.startsWith('Changes saved on this device') || message.includes('Close the open panel')) return 'waiting'
  if (message.startsWith('Synced')) return 'ok'
  return configured ? 'ok' : 'off'
}
const hhmm = (at: number) => new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

export function SyncStatusIcon() {
  const [detail, setDetail] = useState(getSyncStatusDetail)
  const [configured, setConfigured] = useState(() => loadSyncState() !== null)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const update = () => {
      setDetail(getSyncStatusDetail())
      setConfigured(loadSyncState() !== null)
    }
    window.addEventListener(SYNC_STATUS_EVENT, update)
    return () => window.removeEventListener(SYNC_STATUS_EVENT, update)
  }, [])
  useEffect(() => {
    if (!open) return
    const onPointer = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    return () => document.removeEventListener('mousedown', onPointer)
  }, [open])

  const state = stateOf(detail.message, detail.failed, detail.busy, configured)
  // Nothing to show on a device that has never set sync up.
  if (state === 'off' && !detail.message) return null
  const summary =
    state === 'failed'
      ? 'Sync failed'
      : state === 'busy'
        ? 'Syncing…'
        : state === 'waiting'
          ? 'Sync waiting'
          : detail.at
            ? `Synced ${hhmm(detail.at)}`
            : 'Sync on'
  const needsAttention = state === 'failed' || state === 'waiting'

  return (
    <div className="sync-chip-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`btn-icon sync-chip sync-chip--${state}`}
        aria-label={`Sync status: ${summary}`}
        title={`Sync status: ${summary}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <SyncGlyph />
        {needsAttention && <span className="attention-dot" aria-hidden="true" />}
      </button>
      {/* Only problems are announced — a successful sync is silent by design. */}
      <p className="visually-hidden" role="status">{needsAttention ? summary : ''}</p>
      {open && (
        <div className="sync-pop" aria-label="Sync status">
          <p className="sync-pop-state">{summary}</p>
          <p className="filter-hint">{detail.message || (configured ? 'Sync is set up on this device. Changes exchange in the background.' : 'Sync is not set up on this device.')}</p>
          {state === 'failed' && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                const sync = loadSyncState()
                const store = loadStore()
                setOpen(false)
                if (sync) void pushSync(store?.profiles.find((p) => p.id === store.activeId)?.settings.pushServerBase ?? DEFAULT_PUSH_BASE, sync.code).catch(() => {})
              }}
            >
              Retry sync
            </button>
          )}
        </div>
      )}
    </div>
  )
}

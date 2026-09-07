import { useEffect, useState } from 'react'
import { getSyncStatus, SYNC_STATUS_EVENT, loadSyncState, pushSync } from '../lib/sync'
import { loadStore } from '../lib/storage'
import { DEFAULT_PUSH_BASE } from '../lib/config'
export function SyncNotice() {
  const [status,setStatus] = useState(getSyncStatus)
  useEffect(() => { const update = () => setStatus(getSyncStatus()); window.addEventListener(SYNC_STATUS_EVENT,update); return () => window.removeEventListener(SYNC_STATUS_EVENT,update) },[])
  if (!status) return null
  return <div className="backup-banner" role="status"><p>{status}</p>{status.startsWith('Sync failed') && <button className="btn-secondary" onClick={() => { const state = loadSyncState(); const store = loadStore(); if (state) void pushSync(store?.profiles.find(p => p.id === store.activeId)?.settings.pushServerBase ?? DEFAULT_PUSH_BASE,state.code).catch(() => {}) }}>Retry sync</button>}</div>
}

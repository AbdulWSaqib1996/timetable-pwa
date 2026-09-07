import React from 'react'
import { createRoot } from 'react-dom/client'
import { AdminApp } from './AdminApp'
import './admin.css'

// ADM-02 migration (kept from A1): earlier dashboards persisted the key and a
// stats snapshot in localStorage. Purged on every load, never written again.
try {
  localStorage.removeItem('tt.statskey')
  localStorage.removeItem('tt.statscache')
} catch {
  /* storage unavailable */
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AdminApp />
  </React.StrictMode>
)

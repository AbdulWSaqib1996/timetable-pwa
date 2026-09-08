import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { recoverInterruptedRestore } from './lib/recovery'
import { ErrorBoundary } from './components/ErrorBoundary'

window.addEventListener('storage', event => { if (event.key === 'timetable.restore-pending.v1') { const root = document.getElementById('root')!; if (event.newValue) root.setAttribute('inert',''); else { root.removeAttribute('inert'); window.dispatchEvent(new Event('timetable-sync-applied')) } } })
async function start() {
await recoverInterruptedRestore()
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)

}
void start().catch((error) => {
 const root = document.getElementById('root')!
 root.textContent = 'Your data needs recovery before editing. ' + String(error) + ' Close other timetable tabs, free storage if needed, then reload to retry. Do not clear browser data.'
})

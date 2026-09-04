import { useRegisterSW } from 'virtual:pwa-register/react'

/**
 * Service-worker registration + periodic-background-sync. Updates now apply
 * automatically (registerType 'autoUpdate'), so the old "new version available"
 * toast only remains as a fallback for the rare case a refresh is still needed.
 */
export function UpdateToast() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      void registerPeriodicSync(registration)
      // Installed PWAs resume rather than relaunch, so the browser's own SW
      // update check can lag for hours — check on every resume (and hourly)
      // so auto-update actually reaches phones promptly.
      if (registration) {
        const check = () => void registration.update().catch(() => {})
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') check()
        })
        setInterval(check, 3600_000)
      }
    },
  })

  if (!needRefresh) return null
  return (
    <div className="update-toast" role="status">
      <span>A new version is available.</span>
      <button type="button" onClick={() => void updateServiceWorker(true)}>
        Refresh
      </button>
    </div>
  )
}

async function registerPeriodicSync(registration: ServiceWorkerRegistration | undefined) {
  if (!registration || !('periodicSync' in registration)) return
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (registration as any).periodicSync.register('timetable-refresh', {
      minInterval: 6 * 3600 * 1000,
    })
  } catch {
    /* permission not granted or unsupported — app still refreshes on open */
  }
}

import { useRegisterSW } from 'virtual:pwa-register/react'

/** "New version available" prompt + periodic-background-sync registration. */
export function UpdateToast() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      void registerPeriodicSync(registration)
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

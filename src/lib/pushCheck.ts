/**
 * Push self-check: one screenful that answers "why didn't I get a notification?"
 * Each row is a pass/fail with a human detail; nothing here changes any state.
 */

export interface CheckRow {
  label: string
  ok: boolean
  detail?: string
}

/** Last push received on this device, recorded by sw-push.js into IndexedDB. */
function readLastPushAt(): Promise<number | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open('timetable-push', 1)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('meta')) req.result.createObjectStore('meta')
      }
      req.onsuccess = () => {
        const db = req.result
        try {
          const get = db.transaction('meta', 'readonly').objectStore('meta').get('lastPushAt')
          get.onsuccess = () => {
            db.close()
            resolve(typeof get.result === 'number' ? get.result : null)
          }
          get.onerror = () => {
            db.close()
            resolve(null)
          }
        } catch {
          db.close()
          resolve(null)
        }
      }
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

function ago(at: number): string {
  const mins = Math.round((Date.now() - at) / 60000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export async function runPushSelfCheck(base: string): Promise<CheckRow[]> {
  const rows: CheckRow[] = []

  const supported = 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined'
  rows.push({
    label: 'Browser supports background push',
    ok: supported,
    detail: supported ? undefined : 'This browser can’t receive Web Push (on iOS, add the app to your Home Screen first).',
  })
  if (!supported) return rows

  const perm = Notification.permission
  rows.push({
    label: 'Notification permission',
    ok: perm === 'granted',
    detail:
      perm === 'granted' ? 'granted' : perm === 'denied' ? 'blocked — allow notifications for this site in browser settings' : 'not asked yet — tap Enable above',
  })

  let reg: ServiceWorkerRegistration | null = null
  try {
    reg = (await navigator.serviceWorker.getRegistration()) ?? null
  } catch {
    /* ignore */
  }
  rows.push({
    label: 'Service worker installed',
    ok: !!reg?.active,
    detail: reg?.active ? undefined : 'reload the app once (or reinstall it) to register the service worker',
  })

  let sub: PushSubscription | null = null
  if (reg) {
    try {
      sub = await reg.pushManager.getSubscription()
    } catch {
      /* ignore */
    }
  }
  rows.push({
    label: 'Push subscription on this device',
    ok: !!sub,
    detail: sub ? `via ${new URL(sub.endpoint).hostname}` : 'none — tap Enable above to subscribe',
  })

  const started = Date.now()
  let vapidOk = false
  try {
    const res = await fetch(`${base.replace(/\/+$/, '')}/vapid`)
    vapidOk = res.ok && !!((await res.json()) as { publicKey?: string }).publicKey
  } catch {
    /* unreachable */
  }
  rows.push({
    label: 'Push server reachable',
    ok: vapidOk,
    detail: vapidOk ? `responded in ${Date.now() - started}ms` : 'couldn’t reach the worker — check the URL above',
  })

  const lastPush = await readLastPushAt()
  rows.push({
    label: 'Last push received here',
    ok: lastPush !== null,
    detail: lastPush !== null ? ago(lastPush) : 'never — send a test push below to confirm delivery',
  })

  return rows
}

/** Test only the subscription currently installed in this browser. */
export async function sendTestPush(base: string): Promise<string> {
  try {
    if (!('serviceWorker' in navigator)) return 'Background push is unavailable in this browser.'
    const reg = await navigator.serviceWorker.getRegistration()
    const subscription = await reg?.pushManager.getSubscription()
    if (!subscription) return 'Enable background push on this device before sending a test.'
    // Never fall back to /test: older workers broadcast that endpoint to everyone.
    const res = await fetch(`${base.replace(/\/+$/, '')}/test-device`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subscription: subscription.toJSON() }),
    })
    if (res.status === 404 || res.status === 410) return 'The push server needs an update before device-only tests are available.'
    if (res.status === 429) return 'A test ran recently for this device — try again in a few minutes.'
    if (res.status === 403) return 'Enable background push again on this device, then retry the test.'
    if (!res.ok) return 'The push server could not deliver the test. Try enabling background push again.'
    const result = (await res.json()) as { ok?: boolean; sent?: number }
    return result.ok && result.sent === 1
      ? 'Test sent to this device — it should arrive within seconds.'
      : 'The push server did not confirm a device-only test.'
  } catch {
    return 'Could not reach background push. Check your connection and try again.'
  }
}

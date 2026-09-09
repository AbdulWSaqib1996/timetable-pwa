/**
 * Background push + notification actions.
 * Reminder notifications (those carrying a session `key`) get "✓ Attended" and
 * "⏰ Snooze 10m" buttons. Attended is delivered to an open app window, or queued
 * in IndexedDB for the next launch. Snooze re-delivers via the push worker's cron
 * when push is configured, else via an open window's timer.
 */

const ACTIONS = [
  { action: 'attended', title: '✓ Attended' },
  { action: 'snooze', title: '⏰ Snooze 10m' },
]

// End-of-session attendance prompts (tag "att-…") ask attended-or-absent instead.
const ACTIONS_ATTENDANCE = [
  { action: 'attended', title: '✓ Attended' },
  { action: 'absent', title: '✗ Absent' },
]

// Deadlines/tasks (kind "task" or tag "task-…") never offer "Attended".
const ACTIONS_TASK = [
  { action: 'open', title: '📂 Open task' },
  { action: 'done', title: '✓ Mark done' },
  { action: 'snooze', title: '⏰ Snooze 10m' },
]

function actionsFor(data, tag) {
  if (!data.key) return []
  if (data.kind === 'task' || String(tag || '').startsWith('task-')) return ACTIONS_TASK
  if (data.kind === 'attendance' || String(tag || '').startsWith('att-')) return ACTIONS_ATTENDANCE
  return ACTIONS
}

// Web Share Target: photos shared into the app POST here; park them in IndexedDB
// and bounce to the app, which attaches them to the current session.
function storeSharedPhotos(files) {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open('timetable-share', 1)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('photos')) {
          req.result.createObjectStore('photos', { autoIncrement: true })
        }
      }
      req.onsuccess = () => {
        const db = req.result
        try {
          const tx = db.transaction('photos', 'readwrite')
          for (const file of files) tx.objectStore('photos').add({ blob: file, at: Date.now() })
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => {
            db.close()
            resolve()
          }
        } catch {
          db.close()
          resolve()
        }
      }
      req.onerror = () => resolve()
    } catch {
      resolve()
    }
  })
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'POST') return
  const url = new URL(event.request.url)
  if (!url.pathname.endsWith('/share-photo')) return
  event.respondWith(
    (async () => {
      try {
        const form = await event.request.formData()
        const files = form.getAll('photos').filter((f) => f && f.size > 0)
        await storeSharedPhotos(files)
      } catch {
        /* fall through to the app either way */
      }
      return Response.redirect('./?share=photo', 303)
    })()
  )
})

// Record when a push last arrived, so the Settings self-check can show it.
function recordPushReceived() {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open('timetable-push', 1)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('meta')) req.result.createObjectStore('meta')
      }
      req.onsuccess = () => {
        const db = req.result
        try {
          const tx = db.transaction('meta', 'readwrite')
          tx.objectStore('meta').put(Date.now(), 'lastPushAt')
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => {
            db.close()
            resolve()
          }
        } catch {
          db.close()
          resolve()
        }
      }
      req.onerror = () => resolve()
    } catch {
      resolve()
    }
  })
}

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    /* payloadless push */
  }
  const title = data.title || 'My Timetable'
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, {
        body: data.body || 'You have a timetable update.',
        icon: 'icon-192.png',
        badge: 'icon-192.png',
        tag: data.tag || undefined,
        // Versioned owner payload (P3-05): profileId + stable key + kind route
        // the tap/action back to the right profile.
        data: {
          v: 2,
          url: data.url || './',
          key: data.key,
          kind: data.kind,
          profileId: data.profileId,
          snoozeUrl: data.snoozeUrl,
        },
        actions: actionsFor(data, data.tag),
      }),
      recordPushReceived(),
    ])
  )
})

function queuePendingAction(action, data) {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open('timetable-actions', 1)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('pending')) {
          req.result.createObjectStore('pending', { autoIncrement: true })
        }
      }
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction('pending', 'readwrite')
        tx.objectStore('pending').add({
          v: 2,
          action,
          key: data.key,
          profileId: data.profileId,
          kind: data.kind,
          id: (self.crypto && self.crypto.randomUUID && self.crypto.randomUUID()) || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          at: Date.now(),
        })
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => {
          db.close()
          resolve()
        }
      }
      req.onerror = () => resolve()
    } catch {
      resolve()
    }
  })
}

self.addEventListener('notificationclick', (event) => {
  const data = event.notification.data || {}
  event.notification.close()

  if ((event.action === 'attended' || event.action === 'absent' || event.action === 'done') && data.key) {
    const action = event.action
    event.waitUntil(
      (async () => {
        const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true })
        if (windows.length > 0) {
          windows[0].postMessage({
            type: 'timetable-action',
            action,
            key: data.key,
            profileId: data.profileId,
            kind: data.kind,
          })
        } else {
          await queuePendingAction(action, data)
        }
      })()
    )
    return
  }

  if (event.action === 'snooze' && data.key) {
    const title = event.notification.title
    const body = event.notification.body
    event.waitUntil(
      (async () => {
        // Preferred: the push worker re-delivers on its cron, even with the app closed.
        try {
          const sub = await self.registration.pushManager.getSubscription()
          if (data.snoozeUrl && sub) {
            const res = await fetch(data.snoozeUrl.replace(/\/+$/, '') + '/snooze', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                endpoint: sub.endpoint,
                title,
                body,
                key: data.key,
                fireAt: Date.now() + 10 * 60000,
              }),
            })
            if (res.ok) return
          }
        } catch {
          /* fall through */
        }
        // Fallback: an open app window re-notifies after 10 minutes.
        const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true })
        if (windows.length > 0) {
          windows[0].postMessage({
            type: 'timetable-action',
            action: 'snooze',
            key: data.key,
            title,
            body,
            profileId: data.profileId,
            kind: data.kind,
          })
        }
      })()
    )
    return
  }

  // Body tap (or explicit Open action): route to the OWNING profile's event.
  event.waitUntil(
    (async () => {
      const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true })
      if (data.key) {
        if (windows.length > 0) {
          windows[0].postMessage({ type: 'timetable-open', key: data.key, profileId: data.profileId, kind: data.kind })
        } else {
          await queuePendingAction('open', data)
        }
      }
      for (const client of windows) {
        if ('focus' in client) return client.focus()
      }
      return clients.openWindow(data.url || './')
    })()
  )
})

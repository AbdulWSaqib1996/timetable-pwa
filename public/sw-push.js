/** Background push: display notifications sent by the push worker (workers/push). */
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    /* payloadless push */
  }
  const title = data.title || 'My Timetable'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || 'You have a timetable update.',
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      data: { url: data.url || './' },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) return client.focus()
      }
      return clients.openWindow((event.notification.data && event.notification.data.url) || './')
    })
  )
})

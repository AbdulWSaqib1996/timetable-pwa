/**
 * Periodic Background Sync handler (Chrome, installed PWAs): re-fetches every sheet
 * request already in the gviz-data runtime cache so the data is fresh before the app
 * is next opened. Registered from the app with tag "timetable-refresh".
 */
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'timetable-refresh') {
    event.waitUntil(refreshGvizCache())
  }
})

async function refreshGvizCache() {
  try {
    const cache = await caches.open('gviz-data')
    const requests = await cache.keys()
    await Promise.all(
      requests.map(async (request) => {
        try {
          const response = await fetch(request)
          if (response.ok) await cache.put(request, response)
        } catch {
          /* offline — keep the existing cached copy */
        }
      })
    )
  } catch {
    /* cache unavailable */
  }
}

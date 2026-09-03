/**
 * Photos shared into the PWA (Web Share Target) are parked in IndexedDB by the
 * service worker's POST handler; the app collects them on next launch and
 * attaches them to the current session.
 */

const DB_NAME = 'timetable-share'
const STORE = 'photos'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { autoIncrement: true })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function getAndClearSharedPhotos(): Promise<Blob[]> {
  try {
    const db = await openDb()
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      const get = store.getAll()
      get.onsuccess = () => {
        const blobs = (get.result as { blob: Blob }[]).map((r) => r.blob).filter((b) => b && b.size > 0)
        store.clear()
        tx.oncomplete = () => {
          db.close()
          resolve(blobs)
        }
        tx.onerror = () => {
          db.close()
          resolve(blobs)
        }
      }
      get.onerror = () => {
        db.close()
        resolve([])
      }
    })
  } catch {
    return []
  }
}

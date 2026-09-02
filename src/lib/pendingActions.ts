/**
 * Actions taken on notifications while no app window was open (the service worker
 * queues them in IndexedDB); the app drains this queue on startup.
 */

export interface PendingAction {
  action: string
  key: string
  at: number
}

const DB_NAME = 'timetable-actions'
const STORE = 'pending'

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

export async function drainPendingActions(): Promise<PendingAction[]> {
  try {
    const db = await openDb()
    return await new Promise<PendingAction[]>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      const getAll = store.getAll()
      getAll.onsuccess = () => {
        const items = (getAll.result as PendingAction[]) ?? []
        store.clear()
        tx.oncomplete = () => {
          db.close()
          resolve(items)
        }
        tx.onerror = () => {
          db.close()
          resolve(items)
        }
      }
      getAll.onerror = () => {
        db.close()
        resolve([])
      }
    })
  } catch {
    return []
  }
}

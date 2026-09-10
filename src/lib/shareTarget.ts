/**
 * Photos shared into the PWA (Web Share Target) are parked in IndexedDB by
 * the service worker's POST handler. This is a durable INBOX (FA-05): items
 * are read without clearing, the person confirms the destination, and each
 * item is removed only after its photo write succeeded. Nothing here
 * discards a shared image on its own.
 */

const DB_NAME = 'timetable-share'
const STORE = 'photos'

export interface SharedPhoto {
  id: number
  blob: Blob
  at: number
}

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

/** Pending shared photos, oldest first. Never clears. */
export async function listSharedPhotos(): Promise<SharedPhoto[]> {
  try {
    const db = await openDb()
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readonly')
      const store = tx.objectStore(STORE)
      const keys = store.getAllKeys()
      const vals = store.getAll()
      tx.oncomplete = () => {
        const ks = (keys.result as number[]) ?? []
        const vs = (vals.result as { blob: Blob; at?: number }[]) ?? []
        db.close()
        resolve(
          ks
            .map((id, i) => ({ id, blob: vs[i]?.blob, at: vs[i]?.at ?? 0 }))
            .filter((r): r is SharedPhoto => !!r.blob && r.blob.size > 0)
            .sort((a, b) => a.at - b.at)
        )
      }
      tx.onerror = () => {
        db.close()
        resolve([])
      }
    })
  } catch {
    return []
  }
}

/** Acknowledge ONE item after its photo write succeeded (or on explicit discard). */
export async function removeSharedPhoto(id: number): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error)
    }
  })
}

/** @deprecated destructive dequeue — kept for one release for callers not yet migrated. */
export async function getAndClearSharedPhotos(): Promise<Blob[]> {
  const items = await listSharedPhotos()
  for (const item of items) await removeSharedPhoto(item.id).catch(() => {})
  return items.map((i) => i.blob)
}

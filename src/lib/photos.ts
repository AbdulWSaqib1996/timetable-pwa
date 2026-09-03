/**
 * Photo notes: images attached to sessions (whiteboard snaps, handouts), stored
 * locally in IndexedDB, downscaled on save, and included in backups.
 */

export interface StoredPhoto {
  id: number
  /** `${profileId}|${sessionKey}` */
  owner: string
  blob: Blob
  at: number
}

const DB_NAME = 'timetable-photos'
const STORE = 'photos'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
      store.createIndex('owner', 'owner')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode)
        const req = run(t.objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
        t.oncomplete = () => db.close()
      })
  )
}

const owner = (pid: string, sessionKey: string) => `${pid}|${sessionKey}`

/** Downscale to ≤1600px JPEG so photos stay a few hundred KB each. */
export async function compressImage(file: File | Blob, maxDim = 1600, quality = 0.8): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    return blob ?? file
  } catch {
    return file
  }
}

export async function addPhoto(pid: string, sessionKey: string, blob: Blob): Promise<void> {
  await tx('readwrite', (store) => store.add({ owner: owner(pid, sessionKey), blob, at: Date.now() }))
}

export async function getPhotos(pid: string, sessionKey: string): Promise<StoredPhoto[]> {
  try {
    const db = await openDb()
    return await new Promise((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).index('owner').getAll(owner(pid, sessionKey))
      req.onsuccess = () => {
        db.close()
        resolve((req.result as StoredPhoto[]) ?? [])
      }
      req.onerror = () => {
        db.close()
        resolve([])
      }
    })
  } catch {
    return []
  }
}

export async function deletePhoto(id: number): Promise<void> {
  await tx('readwrite', (store) => store.delete(id))
}

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })

/** All photos as data URLs, for the JSON backup. */
export async function exportPhotos(): Promise<{ owner: string; at: number; data: string }[]> {
  try {
    const db = await openDb()
    const all: StoredPhoto[] = await new Promise((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).getAll()
      req.onsuccess = () => {
        db.close()
        resolve((req.result as StoredPhoto[]) ?? [])
      }
      req.onerror = () => {
        db.close()
        resolve([])
      }
    })
    const out = []
    for (const p of all) out.push({ owner: p.owner, at: p.at, data: await blobToDataUrl(p.blob) })
    return out
  } catch {
    return []
  }
}

export async function importPhotos(items: { owner: string; at: number; data: string }[]): Promise<void> {
  for (const item of items) {
    try {
      const blob = await (await fetch(item.data)).blob()
      await tx('readwrite', (store) => store.add({ owner: item.owner, blob, at: item.at }))
    } catch {
      /* skip a bad entry */
    }
  }
}

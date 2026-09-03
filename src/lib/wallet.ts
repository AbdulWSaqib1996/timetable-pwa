/**
 * Document wallet: PDFs and files the course keeps asking for (safeguarding
 * certificate, DBS, lesson-plan template, policies), stored locally in
 * IndexedDB per profile and included in backups. 10MB per file cap.
 */

export interface WalletFile {
  id: number
  owner: string
  name: string
  type: string
  size: number
  blob: Blob
  at: number
}

export const WALLET_FILE_CAP = 10 * 1024 * 1024

const DB_NAME = 'timetable-wallet'
const STORE = 'files'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        const store = req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
        store.createIndex('owner', 'owner')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function addWalletFile(owner: string, file: File): Promise<void> {
  if (file.size > WALLET_FILE_CAP) throw new Error('That file is over the 10MB wallet limit.')
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).add({ owner, name: file.name, type: file.type, size: file.size, blob: file, at: Date.now() })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

export async function getWalletFiles(owner: string): Promise<WalletFile[]> {
  const db = await openDb()
  const files = await new Promise<WalletFile[]>((resolve) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).index('owner').getAll(owner)
    req.onsuccess = () => resolve((req.result as WalletFile[]).sort((a, b) => b.at - a.at))
    req.onerror = () => resolve([])
  })
  db.close()
  return files
}

export async function deleteWalletFile(id: number): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
  db.close()
}

/* ---------- backup integration (base64, like photos) ---------- */

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export interface WalletExport {
  owner: string
  name: string
  type: string
  at: number
  data: string
}

export async function exportWallet(): Promise<WalletExport[]> {
  const db = await openDb()
  const all = await new Promise<WalletFile[]>((resolve) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll()
    req.onsuccess = () => resolve(req.result as WalletFile[])
    req.onerror = () => resolve([])
  })
  db.close()
  const out: WalletExport[] = []
  for (const f of all) {
    out.push({ owner: f.owner, name: f.name, type: f.type, at: f.at, data: await blobToBase64(f.blob) })
  }
  return out
}

export async function importWallet(files: WalletExport[]): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    for (const f of files) {
      try {
        const bytes = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0))
        store.add({ owner: f.owner, name: f.name, type: f.type, size: bytes.length, blob: new Blob([bytes], { type: f.type }), at: f.at })
      } catch {
        /* skip a corrupt entry */
      }
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
  db.close()
}

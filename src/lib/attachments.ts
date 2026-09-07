/** Commit-aware access to the existing attachment databases. */
export type AttachmentKind = 'photos' | 'wallet'
export interface Attachment {
  id: number
  uid?: string
  owner: string
  blob: Blob
  at: number
  name?: string
  type?: string
  size?: number
}
const config = (kind: AttachmentKind) => kind === 'photos'
  ? { db: 'timetable-photos', store: 'photos' } : { db: 'timetable-wallet', store: 'files' }
async function open(kind: AttachmentKind): Promise<IDBDatabase> {
  const { db, store } = config(kind)
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(db, 1)
    request.onupgradeneeded = () => {
      const records = request.result.createObjectStore(store, { keyPath: 'id', autoIncrement: true })
      records.createIndex('owner', 'owner')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Close other timetable tabs and retry.'))
  })
}
export async function attachmentTransaction<T>(kind: AttachmentKind, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  const db = await open(kind)
  return new Promise((resolve, reject) => {
    const tx = db.transaction(config(kind).store, mode)
    let result: T
    tx.oncomplete = () => { db.close(); resolve(result) }
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error ?? new Error('Attachment transaction failed.')) }
    try {
      const request = run(tx.objectStore(config(kind).store))
      if (request) request.onsuccess = () => { result = request.result }
    } catch (error) { tx.abort(); reject(error) }
  })
}
export const readAttachments = (kind: AttachmentKind) => attachmentTransaction<Attachment[]>(kind, 'readonly', store => store.getAll())
export const replaceAttachments = (kind: AttachmentKind, items: Attachment[]) => attachmentTransaction<void>(kind, 'readwrite', store => {
  store.clear()
  for (const item of items) store.put(item)
})
let queue: Promise<unknown> = Promise.resolve()
export async function withDataLock<T>(work: () => Promise<T>): Promise<T> {
  if (navigator.locks) return navigator.locks.request('timetable-data-write', work)
  const next = queue.then(work, work)
  queue = next.catch(() => {})
  return next
}
export function addAttachment(kind: AttachmentKind, item: Omit<Attachment, 'id'>): Promise<void> {
  return withDataLock(async () => {
    if (localStorage.getItem('timetable.restore-pending.v1')) throw new Error('Restore is in progress.')
    await attachmentTransaction(kind, 'readwrite', store => store.add({ ...item, uid: crypto.randomUUID() }))
  })
}
export function removeAttachment(kind: AttachmentKind, id: number): Promise<void> {
  return withDataLock(async () => {
    if (localStorage.getItem('timetable.restore-pending.v1')) throw new Error('Restore is in progress.')
    await attachmentTransaction(kind, 'readwrite', store => store.delete(id))
  })
}
export async function attachmentUid(item: Omit<Attachment, 'id'>): Promise<string> {
  if (item.uid) return item.uid
  const header = new TextEncoder().encode(JSON.stringify([item.owner, item.at, item.name ?? '', item.type ?? item.blob.type]))
  const body = new Uint8Array(await item.blob.arrayBuffer())
  const bytes = new Uint8Array(header.length + body.length)
  bytes.set(header); bytes.set(body, header.length)
  return 'legacy-' + [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('')
}
export function decodeBase64(data: string, type: string): Blob {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) throw new Error('Invalid attachment encoding.')
  return new Blob([Uint8Array.from(atob(data), c => c.charCodeAt(0))], { type })
}
export function blobDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

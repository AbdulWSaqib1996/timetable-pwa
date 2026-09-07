import { readAttachments, replaceAttachments, withDataLock, type Attachment } from './attachments'
import { requireSavedData } from './persistence'

const FLAG = 'timetable.restore-pending.v1'
interface Journal { metadata: Record<string, string | null>; photos: Attachment[]; wallet: Attachment[] }
async function journal(mode: IDBTransactionMode, value?: Journal | null): Promise<Journal | undefined> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('timetable-recovery', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('journal')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return new Promise((resolve, reject) => {
    const tx = db.transaction('journal', mode)
    const store = tx.objectStore('journal')
    const req = value === undefined ? store.get('pending') : value === null ? store.delete('pending') : store.put(value, 'pending')
    tx.oncomplete = () => { db.close(); resolve(value === undefined ? req.result : undefined) }
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error ?? new Error('Recovery journal failed.')) }
  })
}
function writeMetadata(data: Journal['metadata']) {
  for (const [key, value] of Object.entries(data)) {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  }
}
async function rollback(before: Journal) {
  await replaceAttachments('photos', before.photos)
  await replaceAttachments('wallet', before.wallet)
  writeMetadata(before.metadata)
  await journal('readwrite', null)
  localStorage.removeItem(FLAG)
}
export async function recoverInterruptedRestore(): Promise<void> {
  await withDataLock(async () => {
    const before = await journal('readonly')
    if (before) await rollback(before)
    else localStorage.removeItem(FLAG)
  })
}
/** Durable undo journal precedes all writes. On failure or next startup, restore the entire prior state. */
export async function restoreWithRecovery(prepare: () => Promise<{ metadata: Journal['metadata']; photos?: Attachment[]; wallet?: Attachment[] }>): Promise<void> {
  requireSavedData()
  await withDataLock(async () => {
    if (await journal('readonly')) throw new Error('An interrupted restore needs recovery. Reload before continuing.')
    localStorage.setItem(FLAG, '1')
    document.getElementById('root')?.setAttribute('inert','')
    let prepared = false
    try {
    const next = await prepare()
    const before: Journal = { metadata: {}, photos: await readAttachments('photos'), wallet: await readAttachments('wallet') }
    for (const key of Object.keys(next.metadata)) before.metadata[key] = localStorage.getItem(key)
    await journal('readwrite', before)
    prepared = true
    try {
      localStorage.setItem(FLAG, '1')
      if (next.photos) await replaceAttachments('photos', next.photos)
      if (next.wallet) await replaceAttachments('wallet', next.wallet)
      writeMetadata(next.metadata)
      await journal('readwrite', null)
      localStorage.removeItem(FLAG)
    } catch (error) {
      try { await rollback(before) } catch {
        throw new Error('Restore was interrupted. Keep this browser data: reload to retry recovery before editing.')
      }
      throw error
    }
    } finally {
      if (!prepared) localStorage.removeItem(FLAG)
      if (!localStorage.getItem(FLAG)) document.getElementById('root')?.removeAttribute('inert')
    }
  })
}

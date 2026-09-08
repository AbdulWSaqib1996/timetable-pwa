import { groupPendingActions } from '../../shared/actions.js'
import { loadAdminFile, saveAdminFile } from './admin'
import { loadMeta, loadStore, saveMeta } from './storage'
import { localTodayISO } from './filters'

/**
 * Actions taken on notifications while no app window was open (the service worker
 * queues them in IndexedDB). The app applies them on startup — each action to its
 * OWNING profile, removed from the queue only after a durable successful apply,
 * so a failed save is retried on the next launch instead of being lost.
 */

export interface PendingAction {
  v?: number
  action: string
  key: string
  profileId?: string
  kind?: string
  id?: string
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

async function readEntries(): Promise<{ dbKey: IDBValidKey; item: PendingAction }[]> {
  const db = await openDb()
  try {
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readonly')
      const store = tx.objectStore(STORE)
      const keysReq = store.getAllKeys()
      const valsReq = store.getAll()
      tx.oncomplete = () => {
        const keys = (keysReq.result as IDBValidKey[]) ?? []
        const vals = (valsReq.result as PendingAction[]) ?? []
        resolve(keys.map((dbKey, i) => ({ dbKey, item: vals[i] })))
      }
      tx.onerror = () => resolve([])
    })
  } finally {
    db.close()
  }
}

async function removeEntries(dbKeys: IDBValidKey[]): Promise<void> {
  if (dbKeys.length === 0) return
  const db = await openDb()
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      for (const k of dbKeys) store.delete(k)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
  } finally {
    db.close()
  }
}

export interface AppliedActions {
  /** profiles whose saved metadata changed */
  changedProfiles: Set<string>
  /** "open this event" requests, oldest first */
  open: { profileId: string; key: string; kind: string }[]
}

/**
 * Apply queued notification actions to their owning profiles. Marks update
 * that profile's saved metadata directly (whether or not it is active);
 * queue entries are deleted only after the metadata write succeeded.
 */
export async function applyPendingNotificationActions(): Promise<AppliedActions> {
  const result: AppliedActions = { changedProfiles: new Set(), open: [] }
  let entries: { dbKey: IDBValidKey; item: PendingAction }[]
  try {
    entries = await readEntries()
  } catch {
    return result
  }
  if (entries.length === 0) return result
  const profileIds = loadStore()?.profiles.map((p) => p.id) ?? []
  const { apply, open, dropped } = groupPendingActions(entries.map((e) => e.item), profileIds)
  const done: IDBValidKey[] = []
  const keyFor = (item: PendingAction) =>
    entries.find((e) => e.item === item || (item.id && e.item?.id === item.id))?.dbKey
  for (const [pid, actions] of apply) {
    try {
      // Personal-task actions update the task RECORD, not session metadata.
      const taskActions = actions.filter((a) => a.key.startsWith('task:'))
      if (taskActions.length > 0) {
        const admin = loadAdminFile(pid)
        let tasks = admin.tasks
        for (const a of taskActions) {
          const id = a.key.slice('task:'.length)
          tasks = tasks.map((t) =>
            t.id === id && a.action === 'done' && t.status !== 'done'
              ? { ...t, status: 'done' as const, completedISO: localTodayISO(), at: Date.now() }
              : t
          )
        }
        if (tasks !== admin.tasks) saveAdminFile(pid, { ...admin, tasks })
        result.changedProfiles.add(pid)
        for (const a of taskActions) {
          const k = keyFor(a)
          if (k !== undefined) done.push(k)
        }
      }
      const metaActions = actions.filter((a) => !a.key.startsWith('task:'))
      const meta = loadMeta(pid)
      const next = { ...meta }
      for (const a of metaActions) {
        const at = Math.max(Date.now(), (next[a.key]?.at ?? 0) + 1)
        if (a.action === 'done') next[a.key] = { ...next[a.key], deleted: undefined, status: 'done', at }
        else
          next[a.key] = {
            ...next[a.key],
            deleted: undefined,
            attended: a.action === 'attended',
            absent: a.action === 'absent',
            at,
          }
      }
      if (metaActions.length > 0) {
        saveMeta(pid, next)
        result.changedProfiles.add(pid)
      }
      for (const a of metaActions) {
        const k = keyFor(a)
        if (k !== undefined) done.push(k)
      }
    } catch {
      // Persistence failed — keep these queue entries for the next launch.
    }
  }
  // Open requests are handed to the UI; their queue entries are consumed now
  // (opening is best-effort, not durable state).
  result.open = open
  for (const o of open) {
    const entry = entries.find((e) => e.item?.action === 'open' && e.item.key === o.key)
    if (entry) done.push(entry.dbKey)
  }
  // Unattributable legacy/multi-profile actions are removed too — with a
  // console note — rather than re-examined forever. They are never applied
  // to a profile that may not own them.
  for (const d of dropped) {
    const entry = entries.find((e) => e.item === d)
    if (entry) done.push(entry.dbKey)
    if (d) console.warn('Dropped unattributable notification action', d.action, d.key)
  }
  await removeEntries(done)
  return result
}

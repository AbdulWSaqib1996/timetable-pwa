/**
 * Storage adapters for the telemetry queue (A2). The queue core
 * (shared/telemetry-queue.js) computes pure mutations over the full row map;
 * an adapter applies one mutation ATOMICALLY. IndexedDB gives real
 * transactionality across tabs; when it is unavailable the queue degrades to
 * a bounded in-memory map (telemetry is best-effort — the timetable itself
 * must never be interrupted).
 */

export interface QueueMutation {
  set?: [string, unknown][]
  del?: string[]
  result?: unknown
}

export interface QueueAdapter {
  /** Read every row, run `fn` synchronously, apply its writes atomically. */
  mutate<T>(fn: (rows: Map<string, unknown>) => QueueMutation & { result?: T }): Promise<T | undefined>
}

const DB_NAME = 'timetable.telemetry.v1'
const STORE = 'kv'

export function memoryAdapter(): QueueAdapter {
  const rows = new Map<string, unknown>()
  return {
    async mutate(fn) {
      const m = fn(new Map(rows))
      for (const [k, v] of m.set ?? []) rows.set(k, v)
      for (const k of m.del ?? []) rows.delete(k)
      if (rows.size > 500) rows.clear() // bounded fallback, never grows unchecked
      return m.result as never
    },
  }
}

export function idbAdapter(): QueueAdapter {
  let dbPromise: Promise<IDBDatabase> | null = null
  const open = () => {
    dbPromise ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
      req.onblocked = () => reject(new Error('blocked'))
    })
    return dbPromise
  }
  return {
    async mutate(fn) {
      const db = await open()
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite')
        const store = tx.objectStore(STORE)
        const keysReq = store.getAllKeys()
        const valsReq = store.getAll()
        let result: unknown
        valsReq.onsuccess = () => {
          // Both getAll requests resolve in order within the transaction; run
          // the pure mutation synchronously so the tx cannot auto-commit
          // under us, then apply its writes in the SAME transaction.
          const rows = new Map<string, unknown>()
          const keys = keysReq.result as string[]
          keys.forEach((k, i) => rows.set(k, valsReq.result[i]))
          const m = fn(rows)
          result = m.result
          for (const [k, v] of m.set ?? []) store.put(v, k)
          for (const k of m.del ?? []) store.delete(k)
        }
        tx.oncomplete = () => resolve(result as never)
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error ?? new Error('aborted'))
      })
    },
  }
}

/** IDB when possible, bounded memory otherwise — never throws at call sites. */
export function defaultAdapter(): QueueAdapter {
  try {
    if (typeof indexedDB !== 'undefined') {
      const idb = idbAdapter()
      const memory = memoryAdapter()
      let broken = false
      return {
        async mutate(fn) {
          if (broken) return memory.mutate(fn)
          try {
            return await idb.mutate(fn)
          } catch {
            // Private windows / denied storage: fall back permanently for
            // this session rather than retry-hammering a dead database.
            broken = true
            return memory.mutate(fn)
          }
        },
      }
    }
  } catch {
    /* fall through */
  }
  return memoryAdapter()
}

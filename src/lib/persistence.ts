/** Shared save failures and a retry queue. A failed write is never called saved. */
const pending = new Map<string, string | null>()
let failure = ''
export const PERSISTENCE_EVENT = 'timetable-persistence'
export const DATA_CHANGED_EVENT = 'timetable-data-changed'
export function hasPendingSaves(): boolean { return pending.size > 0 }
export function dismissPersistenceFailure(): void { if (!pending.size) { failure = ''; window.dispatchEvent(new Event(PERSISTENCE_EVENT)) } }
export function persistenceFailure(): string { return failure }
export function reportPersistenceFailure(message: string): void {
  failure = message
  window.dispatchEvent(new Event(PERSISTENCE_EVENT))
}
export function persistValue(key: string, value: string | null): boolean {
  try {
    if (localStorage.getItem('timetable.restore-pending.v1')) { reportPersistenceFailure('Recovery is in progress. Reload before editing.'); return false }
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
    const retried = pending.delete(key)
    if (retried && !pending.size) failure = ''
    window.dispatchEvent(new Event(PERSISTENCE_EVENT))
    if (/^timetable\.(store\.v2|meta\.v2\.|admin\.v1\.)/.test(key)) window.dispatchEvent(new Event(DATA_CHANGED_EVENT))
    return true
  } catch (error) {
    pending.set(key, value)
    reportPersistenceFailure(error instanceof Error ? error.message : 'Device storage is unavailable.')
    return false
  }
}
export function persistJSON(key: string, value: unknown): boolean {
  return persistValue(key, JSON.stringify(value))
}
export function retryPersistence(): boolean {
  for (const [key, value] of [...pending]) if (!persistValue(key, value)) return false
  return true
}
export function requireSavedData(): void {
  if (!retryPersistence()) throw new Error('Some changes could not be saved. Free device storage and retry before backing up.')
}

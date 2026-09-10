/**
 * The unlocked backup passphrase lives here, in memory, for the session only
 * (R5b): never localStorage, never sync, never the service worker. Closing
 * the tab forgets it; automatic backups stop until it is entered again.
 */
let unlocked: string | null = null
const listeners = new Set<() => void>()

export function unlockedPassphrase(): string | null {
  return unlocked
}
export function setUnlockedPassphrase(value: string | null): void {
  unlocked = value
  for (const l of listeners) l()
}
export function onPassphraseChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

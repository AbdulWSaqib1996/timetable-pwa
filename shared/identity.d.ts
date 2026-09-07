import type { Session } from '../src/types'
export function legacyKey(s: Session): string
export function eventKey(s: Session): string
export function reconcileEvents(fresh: Session[], cached?: Session[]): Session[]

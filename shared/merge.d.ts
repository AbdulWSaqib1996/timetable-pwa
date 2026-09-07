import type { ProfileStore, Settings } from '../src/types'
import type { AdminFile } from '../src/lib/admin'
export function canonical(value: unknown): string
export function newer<T extends { at?: number; deleted?: boolean }>(a: T | undefined, b: T): T
export function mergeRecords<T extends { at?: number; deleted?: boolean }>(a: Record<string,T>, b: Record<string,T>): Record<string,T>
export function mergeAdmin(a: AdminFile,b: AdminFile): AdminFile
export const deviceSettings: string[]
export function syncSettings(settings: Settings): Settings
export function mergeStores(a: ProfileStore,b: ProfileStore): ProfileStore

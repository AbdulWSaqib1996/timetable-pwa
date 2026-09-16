export const MENTOR_ATTACHMENT_TTL_MS: number
export function attachmentExpiry(sharedAt: number, now: number): { expiresAt: number; expired: boolean; daysLeft: number }
export interface FileRef { kind: 'pack' | 'project-draft' | 'project-receipt' | 'project-feedback' | 'homework-resource' | 'placement-resource'; id: string; title: string; name?: string }
export function referencedUids(admin: any): Map<string, FileRef[]>
export function relinkUid<T>(admin: T, fromUid: string, toUid: string, now: number): T
export interface FileRow {
  uid: string
  name: string
  kind: 'photo' | 'wallet' | 'missing'
  size: number | null
  present: boolean
  backedUp: { at: number } | null
  shares: { packId: string; title: string; revision: number; sharedAt: number; expiresAt: number; expired: boolean; daysLeft: number }[]
  refs: FileRef[]
}
export function fileRows(input: { files: { uid: string; name: string; kind: 'photo' | 'wallet'; size?: number }[]; admin: any; history: any[]; now: number }): FileRow[]
export function syncSummary(input: { enabled: boolean; lastAt?: number | null; failed?: boolean; busy?: boolean; records: { at?: number }[]; now: number }): { state: 'off' | 'failed' | 'working' | 'pending' | 'confirmed' | 'never'; pending: number; lastAt: number | null; ageMs?: number | null }
export function backupSummaryState(input: { history: any[]; profileId: string; records: { at?: number }[]; now: number }): { state: 'never' | 'stale' | 'covered'; lastAt: number | null; files: number | null; editsSince: number; ageDays?: number }
export function shareSummary(admin: any, now: number): { shared: number; expired: number; unshared: number; lastAt: number | null; packs: { id: string; title: string; revision: number; sharedAt: number; mentors: number; files: number; expiresAt: number; expired: boolean; daysLeft: number }[] }
export function restoreReferencedMissing(backupAdminByProfile: Record<string, any> | undefined, backupUids: Set<string>, localUids: Set<string>): { count: number; uids: string[] }
export function buildRecoveryGuide(input: { generatedAt: number; profiles: { name: string; records: number; adminRecords: number; photos: number; documents: number }[]; sync: { enabled: boolean }; backup: { lastAt: number | null; files: number | null }; mentors: { enabled: boolean; packsShared: number }; appUrl?: string }): string

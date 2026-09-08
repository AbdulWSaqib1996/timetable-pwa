export const FIND_PAGE_SIZE: number

export interface FindOwnerInput {
  ownerType: string
  ownerId: string
  rev: string | number
  contentRev?: string | number
  title?: string
  date?: string
  time?: string
  kind?: string
  text?: string
  content?: string
  meta?: Record<string, string> | null
}

export interface FindEntry {
  key: string
  profileId: string
  ownerType: string
  ownerId: string
  rev: string | number
  contentRev: string | number
  title: string
  date: string
  time: string
  kind: string
  text: string
  content: string
  rawContent: string
  meta: Record<string, string> | null
}

export interface FindIndex {
  profileId: string
  byKey: Map<string, FindEntry>
  entries: FindEntry[]
  size: number
}

export interface FindHit {
  key: string
  ownerType: string
  ownerId: string
  kind: string
  title: string
  date: string
  time: string
  snippet: string
  matchedIn: 'text' | 'content'
  meta: Record<string, string> | null
}

export function normalizeText(value: unknown): string
export function findKey(profileId: string, ownerType: string, ownerId: string): string
export function buildFindIndex(profileId: string, owners: FindOwnerInput[], prev?: FindIndex | null): FindIndex
export function searchFindIndex(
  index: FindIndex | null,
  query: string,
  options?: { includeContent?: boolean; limit?: number; offset?: number; types?: string[] | null; todayISO?: string }
): { results: FindHit[]; total: number; tokens: string[] }

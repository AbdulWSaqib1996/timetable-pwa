export interface GroupExpression {
  all: boolean
  empty: boolean
  tokens: string[]
  unknown: string[]
}
export interface Membership {
  specialisms?: string[]
  groups?: string[]
}
export function parseGroupExpression(raw: string | null | undefined): GroupExpression
export function groupMatches(raw: string | null | undefined, myGroups: string[] | undefined): boolean
export function expandGroupOptions(rawList: (string | null | undefined)[]): string[]
export function sessionInMembership(
  s: { specialismName?: string; groups?: string },
  membership: Membership
): boolean
export function filterSessionsForMembership<T extends { specialismName?: string; groups?: string }>(
  sessions: T[],
  config: { spec?: string[]; groups?: string[] } | null | undefined
): T[]

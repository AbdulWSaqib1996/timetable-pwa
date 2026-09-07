import type { Session } from '../types'
import { toMinutes } from './format'

/**
 * Study groups: share a short code; each member publishes their free slots
 * (times only — no session details) to the push worker's KV, and everyone
 * sees the intersection.
 */

export interface FreeSlot {
  /** yyyy-mm-dd */
  d: string
  /** minutes from midnight */
  from: number
  to: number
}

export interface GroupMember {
  /** stable id (P3-07); may be absent from very old servers */
  memberId?: string
  name: string
  at: number
  slots: FreeSlot[]
}

/** Device-held membership capability — proves this device owns its member record. */
export interface GroupCredentials {
  memberId?: string
  token?: string
}

const DAY_START = 9 * 60
const DAY_END = 17 * 60
const MIN_GAP = 45

function addDaysISO(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split('-').map(Number)
  const date = new Date(y, m - 1, d + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Free slots (09:00–17:00, weekdays, ≥45 min) for the next `days` days. */
export function computeFreeSlots(sessions: Session[], todayISO: string, days = 7): FreeSlot[] {
  const out: FreeSlot[] = []
  for (let i = 0; i < days; i++) {
    const dateISO = addDaysISO(todayISO, i)
    const [y, m, d] = dateISO.split('-').map(Number)
    const dow = new Date(y, m - 1, d).getDay()
    if (dow === 0 || dow === 6) continue
    const busy = sessions
      .filter((s) => s.dateISO === dateISO && !s.isKeyDate && !s.isSelfStudy && !s.isFreeTime && toMinutes(s.start) !== null)
      .map((s) => {
        const from = toMinutes(s.start)!
        return { from, to: toMinutes(s.end) ?? from + 60 }
      })
      .sort((a, b) => a.from - b.from)
    let cursor = DAY_START
    for (const b of busy) {
      if (b.from - cursor >= MIN_GAP) out.push({ d: dateISO, from: cursor, to: Math.min(b.from, DAY_END) })
      cursor = Math.max(cursor, b.to)
      if (cursor >= DAY_END) break
    }
    if (DAY_END - cursor >= MIN_GAP) out.push({ d: dateISO, from: cursor, to: DAY_END })
  }
  return out.slice(0, 100)
}

/** Slots where every member is free for at least 30 minutes. */
export function intersectSlots(memberSlots: FreeSlot[][]): FreeSlot[] {
  if (memberSlots.length === 0) return []
  let common = memberSlots[0]
  for (const next of memberSlots.slice(1)) {
    const merged: FreeSlot[] = []
    for (const a of common) {
      for (const b of next) {
        if (a.d !== b.d) continue
        const from = Math.max(a.from, b.from)
        const to = Math.min(a.to, b.to)
        if (to - from >= 30) merged.push({ d: a.d, from, to })
      }
    }
    common = merged
  }
  return common.sort((a, b) => (a.d + String(a.from).padStart(4, '0')).localeCompare(b.d + String(b.from).padStart(4, '0')))
}

export const fmtSlotTime = (mins: number) =>
  `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`

const trim = (base: string) => base.replace(/\/+$/, '')

export async function createGroup(
  base: string,
  name: string,
  slots: FreeSlot[]
): Promise<{ code: string } & GroupCredentials> {
  const res = await fetch(`${trim(base)}/group`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, slots, wantCredentials: true }),
  })
  if (!res.ok) throw new Error('Could not create the group.')
  const json = (await res.json()) as { code?: string; memberId?: string; token?: string }
  if (!json.code) throw new Error('The server returned no code.')
  return { code: json.code, memberId: json.memberId, token: json.token }
}

export async function joinGroup(
  base: string,
  code: string,
  name: string,
  slots: FreeSlot[],
  creds?: GroupCredentials
): Promise<GroupCredentials> {
  const res = await fetch(`${trim(base)}/group/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, name, slots, wantCredentials: true, ...creds }),
  })
  if (res.status === 404) throw new Error('No group with that code.')
  if (res.status === 403) {
    const { error } = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(error ?? 'Your membership on this device is out of date — rejoin with the code.')
  }
  if (!res.ok) throw new Error('Could not join the group.')
  const json = (await res.json()) as { memberId?: string; token?: string }
  return { memberId: json.memberId ?? creds?.memberId, token: json.token ?? creds?.token }
}

export async function fetchGroup(base: string, code: string): Promise<GroupMember[]> {
  const res = await fetch(`${trim(base)}/group?code=${encodeURIComponent(code)}`)
  if (res.status === 404) throw new Error('This group no longer exists.')
  if (!res.ok) throw new Error('Could not load the group.')
  const json = (await res.json()) as { members?: GroupMember[] }
  return json.members ?? []
}

export async function leaveGroup(
  base: string,
  code: string,
  name: string,
  creds?: GroupCredentials
): Promise<void> {
  await fetch(`${trim(base)}/group/leave`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, name, ...creds }),
  }).catch(() => {})
}

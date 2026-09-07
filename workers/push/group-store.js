/**
 * Study-group Durable Object (P3-07): one strongly consistent object per group
 * code. Members have a stable id plus a device-held capability token — display
 * names stay editable and same-name members remain distinct. Join/update/leave
 * run inside storage transactions; KV read-merge-put is gone. Legacy name-keyed
 * members (created by older clients, or imported from the old KV record) keep
 * working, addressed by name only among themselves.
 */

const GROUP_TTL_MS = 21 * 86_400_000
const MAX_MEMBERS = 12
const MAX_SLOTS = 120

export const cleanSlots = (slots) =>
  Array.isArray(slots)
    ? slots
        .filter(
          (s) =>
            s &&
            typeof s.d === 'string' &&
            /^\d{4}-\d{2}-\d{2}$/.test(s.d) &&
            Number.isInteger(s.from) &&
            Number.isInteger(s.to) &&
            s.from >= 0 &&
            s.to > s.from &&
            s.to <= 1440
        )
        .map((s) => ({ d: s.d, from: s.from, to: s.to }))
        .slice(0, MAX_SLOTS)
    : []

export const cleanName = (n) => String(n ?? '').trim().slice(0, 24)

const hex = (bytes) =>
  [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('')

const json = (obj, status = 200) => Response.json(obj, { status })

const constantEquals = (a, b) => {
  const left = String(a ?? '')
  const right = String(b ?? '')
  if (left.length !== right.length) return false
  let mismatch = 0
  for (let i = 0; i < left.length; i++) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i)
  return mismatch === 0
}

export class GroupStore {
  constructor(state, env) {
    this.state = state
    this.env = env
  }

  async fetch(request) {
    const url = new URL(request.url)
    const code = String(url.searchParams.get('code') ?? '')
    if (!/^[A-Z2-9]{4,8}$/.test(code)) return json({ error: 'invalid code' }, 400)

    // One-time import of the old KV record; the KV copy is left untouched.
    await this.state.blockConcurrencyWhile(async () => {
      if (await this.state.storage.get('initialized')) return
      const legacy = await this.env.PUSH.get(`grp:${code}`, 'json').catch(() => null)
      await this.state.storage.transaction(async (tx) => {
        if (legacy?.members && typeof legacy.members === 'object') {
          const members = {}
          for (const [name, m] of Object.entries(legacy.members)) {
            members[`m${hex(4)}`] = {
              name: cleanName(name),
              slots: cleanSlots(m?.slots),
              at: Number(m?.at) || Date.now(),
              nameKeyed: true,
            }
          }
          await tx.put('group', {
            createdAt: Number(legacy.createdAt) || Date.now(),
            expiresAt: Date.now() + GROUP_TTL_MS,
            members,
          })
        }
        await tx.put('initialized', true)
      })
    })

    let body = null
    if (request.method === 'POST') body = await request.json().catch(() => null)

    if (request.method === 'GET' && url.pathname === '/group') {
      return this.state.storage.transaction(async (tx) => {
        const group = await this.liveGroup(tx)
        if (!group) return json({ error: 'unknown group' }, 404)
        return json({
          members: Object.entries(group.members).map(([memberId, m]) => ({
            memberId,
            name: m.name,
            at: m.at,
            slots: m.slots,
          })),
        })
      })
    }

    if (request.method === 'POST' && url.pathname === '/group') {
      const name = cleanName(body?.name)
      if (!name) return json({ error: 'missing name' }, 400)
      return this.state.storage.transaction(async (tx) => {
        if (await this.liveGroup(tx)) return json({ error: 'exists' }, 409)
        const memberId = `m${hex(4)}`
        const token = body?.wantCredentials ? hex(16) : undefined
        await tx.put('group', {
          createdAt: Date.now(),
          expiresAt: Date.now() + GROUP_TTL_MS,
          members: {
            [memberId]: { name, slots: cleanSlots(body?.slots), at: Date.now(), token, nameKeyed: !token },
          },
        })
        return json({ ok: true, memberId, token })
      })
    }

    if (request.method === 'POST' && url.pathname === '/group/join') {
      const name = cleanName(body?.name)
      if (!name) return json({ error: 'invalid request' }, 400)
      return this.state.storage.transaction(async (tx) => {
        const group = await this.liveGroup(tx)
        if (!group) return json({ error: 'unknown group' }, 404)
        const slots = cleanSlots(body?.slots)
        const now = Date.now()
        let memberId = typeof body?.memberId === 'string' ? body.memberId : undefined
        let token
        if (memberId) {
          // Capability path: id + token must match; a stale update is refused,
          // not silently applied to someone else's record.
          const member = group.members[memberId]
          if (!member || !member.token || !constantEquals(member.token, body?.token)) {
            return json({ error: 'membership out of date — rejoin with the group code' }, 403)
          }
          token = member.token
          group.members[memberId] = { ...member, name, slots, at: now }
        } else {
          // No credentials: only NAME-KEYED members (old clients / imported
          // records) may be updated by display name — never a token holder.
          const existing = Object.entries(group.members).find(([, m]) => m.nameKeyed && m.name === name)
          if (existing) {
            memberId = existing[0]
            token = body?.wantCredentials ? hex(16) : undefined
            group.members[memberId] = {
              ...existing[1],
              name,
              slots,
              at: now,
              ...(token ? { token, nameKeyed: false } : {}),
            }
          } else {
            if (Object.keys(group.members).length >= MAX_MEMBERS) return json({ error: 'group is full' }, 403)
            memberId = `m${hex(4)}`
            token = body?.wantCredentials ? hex(16) : undefined
            group.members[memberId] = { name, slots, at: now, token, nameKeyed: !token }
          }
        }
        group.expiresAt = now + GROUP_TTL_MS
        await tx.put('group', group)
        return json({ ok: true, memberId, token })
      })
    }

    if (request.method === 'POST' && url.pathname === '/group/leave') {
      return this.state.storage.transaction(async (tx) => {
        const group = await this.liveGroup(tx)
        if (!group) return json({ ok: true })
        const memberId = typeof body?.memberId === 'string' ? body.memberId : undefined
        if (memberId) {
          const member = group.members[memberId]
          if (!member || !member.token || !constantEquals(member.token, body?.token)) {
            return json({ error: 'membership out of date' }, 403)
          }
          delete group.members[memberId]
        } else {
          const name = cleanName(body?.name)
          const entry = Object.entries(group.members).find(([, m]) => m.nameKeyed && m.name === name)
          if (entry) delete group.members[entry[0]]
        }
        if (Object.keys(group.members).length === 0) await tx.delete('group')
        else await tx.put('group', group)
        return json({ ok: true })
      })
    }

    return json({ error: 'not found' }, 404)
  }

  /** The stored group, honouring expiry (expired groups vanish). */
  async liveGroup(tx) {
    const group = await tx.get('group')
    if (!group) return null
    if (group.expiresAt && group.expiresAt < Date.now()) {
      await tx.delete('group')
      return null
    }
    return group
  }
}

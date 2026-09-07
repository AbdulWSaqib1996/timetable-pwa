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
const MAX_PROPOSALS = 20

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

/** IANA-shaped timezone string or undefined — never free text. */
export const cleanTz = (tz) =>
  typeof tz === 'string' && /^[A-Za-z][A-Za-z0-9_+\-/]{1,39}$/.test(tz) ? tz : undefined

const cleanSlot = (s) => cleanSlots([s])[0]

const todayISOUTC = () => new Date().toISOString().slice(0, 10)

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
        // Proposals for past days are pruned — nobody should accept yesterday.
        const today = todayISOUTC()
        let pruned = false
        for (const [id, p] of Object.entries(group.proposals ?? {})) {
          if (p.slot.d < today) {
            delete group.proposals[id]
            pruned = true
          }
        }
        if (pruned) await tx.put('group', group)
        return json({
          members: Object.entries(group.members).map(([memberId, m]) => ({
            memberId,
            name: m.name,
            at: m.at,
            slots: m.slots,
            ...(m.tz ? { tz: m.tz } : {}),
          })),
          proposals: Object.values(group.proposals ?? {}).sort((a, b) => a.at - b.at),
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
            [memberId]: { name, slots: cleanSlots(body?.slots), at: Date.now(), token, nameKeyed: !token, tz: cleanTz(body?.tz) },
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
          group.members[memberId] = { ...member, name, slots, at: now, tz: cleanTz(body?.tz) ?? member.tz }
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
              tz: cleanTz(body?.tz) ?? existing[1].tz,
              ...(token ? { token, nameKeyed: false } : {}),
            }
          } else {
            if (Object.keys(group.members).length >= MAX_MEMBERS) return json({ error: 'group is full' }, 403)
            memberId = `m${hex(4)}`
            token = body?.wantCredentials ? hex(16) : undefined
            group.members[memberId] = { name, slots, at: now, token, nameKeyed: !token, tz: cleanTz(body?.tz) }
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
        let memberId = typeof body?.memberId === 'string' ? body.memberId : undefined
        if (memberId) {
          const member = group.members[memberId]
          if (!member || !member.token || !constantEquals(member.token, body?.token)) {
            return json({ error: 'membership out of date' }, 403)
          }
          delete group.members[memberId]
        } else {
          const name = cleanName(body?.name)
          const entry = Object.entries(group.members).find(([, m]) => m.nameKeyed && m.name === name)
          if (entry) {
            memberId = entry[0]
            delete group.members[entry[0]]
          }
        }
        // A departed member leaves no ghost votes: their proposals are
        // withdrawn and their responses removed from everyone else's.
        if (memberId && group.proposals) {
          for (const p of Object.values(group.proposals)) {
            delete p.responses[memberId]
            if (p.by === memberId && p.status === 'open') {
              p.status = 'withdrawn'
              p.rev += 1
            }
          }
        }
        if (Object.keys(group.members).length === 0) await tx.delete('group')
        else await tx.put('group', group)
        return json({ ok: true })
      })
    }

    /* ---- meeting proposals (P6-05): capability-gated, revision-checked ---- */

    if (request.method === 'POST' && url.pathname === '/group/propose') {
      const slot = body?.slot ? cleanSlot(body.slot) : undefined
      if (!slot) return json({ error: 'invalid slot' }, 400)
      return this.state.storage.transaction(async (tx) => {
        const group = await this.liveGroup(tx)
        if (!group) return json({ error: 'unknown group' }, 404)
        const member = typeof body?.memberId === 'string' ? group.members[body.memberId] : undefined
        if (!member || !member.token || !constantEquals(member.token, body?.token)) {
          return json({ error: 'membership out of date — rejoin with the group code' }, 403)
        }
        group.proposals ??= {}
        const open = Object.values(group.proposals).filter((p) => p.status === 'open')
        if (open.length >= MAX_PROPOSALS) return json({ error: 'too many open proposals' }, 403)
        const id = `p${hex(4)}`
        // Participants = the members at proposal time; the proposer has
        // implicitly said yes. Interval only — no title or free text is
        // accepted or stored.
        const proposal = {
          id,
          rev: 1,
          by: body.memberId,
          slot,
          status: 'open',
          participants: Object.keys(group.members),
          responses: { [body.memberId]: 'yes' },
          at: Date.now(),
        }
        group.proposals[id] = proposal
        await tx.put('group', group)
        return json({ ok: true, proposal })
      })
    }

    if (request.method === 'POST' && url.pathname === '/group/proposal/respond') {
      const action = body?.action
      if (!['yes', 'no', 'withdraw'].includes(action)) return json({ error: 'invalid action' }, 400)
      return this.state.storage.transaction(async (tx) => {
        const group = await this.liveGroup(tx)
        if (!group) return json({ error: 'unknown group' }, 404)
        const member = typeof body?.memberId === 'string' ? group.members[body.memberId] : undefined
        if (!member || !member.token || !constantEquals(member.token, body?.token)) {
          return json({ error: 'membership out of date — rejoin with the group code' }, 403)
        }
        const proposal = group.proposals?.[String(body?.proposalId ?? '')]
        if (!proposal) return json({ error: 'unknown proposal' }, 404)
        // Simultaneous edits: the second writer's revision no longer matches
        // and is refused with the current state, never silently merged.
        if (Number(body?.rev) !== proposal.rev) {
          return json({ error: 'proposal changed — reload', proposal }, 409)
        }
        if (action === 'withdraw') {
          if (proposal.by !== body.memberId) return json({ error: 'only the proposer can withdraw' }, 403)
          proposal.status = 'withdrawn'
        } else {
          if (proposal.status !== 'open') return json({ error: 'proposal is closed', proposal }, 409)
          proposal.responses[body.memberId] = action
        }
        proposal.rev += 1
        await tx.put('group', group)
        return json({ ok: true, proposal })
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

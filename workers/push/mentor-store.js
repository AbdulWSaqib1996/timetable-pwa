import {
  MENTOR_ATTACHMENTS_PER_PACK,
  MENTOR_ATTACHMENT_MAX_BYTES,
  MENTOR_ATTACHMENT_TTL_S,
  MENTOR_FEEDBACK_MAX,
  MENTOR_INVITE_TTL_MS,
  MENTOR_MIN_PASSPHRASE,
  MENTOR_PACK_TEXT_MAX,
  MENTOR_SESSION_TTL_MS,
  attestationString,
  cleanName,
  cleanText,
  constantEquals,
  hashPassphrase,
  hmacHex,
  isHex,
  isInviteCode,
  isOwnerToken,
  isRecordId,
  isSpaceId,
  randomHex,
  randomInviteCode,
  sha256Hex,
} from '../../shared/mentor.js'

/**
 * MentorStore (G4; sharing semantics reworked in Pass 77 / audit B02): one
 * Durable Object per learner space. Owner routes need the owner token; mentor
 * routes need a live session. Invitations are single use and expire;
 * revocation removes every session at once and hides every pack from that
 * mentor.
 *
 * A share is the COMPLETE REPLACEMENT of a pack's portal content: `{revision,
 * text, mentorIds, attachments}`. Revisions are per pack and monotonic: a
 * repeat of the current revision is a no-op replay (retry safe), anything
 * else out of order is refused with 409 so the learner reviews again.
 * Ciphertext is written to KV under versioned keys
 * (`matt:<space>:<pack>:<revision>:<attachment>`) BEFORE the manifest is
 * committed in this object's storage; a failed upload or commit leaves the
 * previous manifest valid, and old revisions' blobs simply age out on their
 * TTL. Mentor routes serve the committed manifest only. Feedback is signed
 * with a worker-wide HMAC key kept in KV (`mentor-signing-key`, minted once).
 *
 * Pass 78 (audit B08/B10): the owner can CLOSE the space (`closedAt`, a
 * recoverable flag — every mentor route is refused with 403 while it is set,
 * nothing is deleted, `/mentor/reopen` clears it) and UNSHARE one pack
 * (idempotent: the pack's recipients become none, its attachments are dropped
 * from the manifest, its revision advances so a stale client share is refused;
 * copies already downloaded are, by nature, not recalled).
 */

const json = (obj, status = 200) => Response.json(obj, { status })
const now = () => Date.now()

export class MentorStore {
  constructor(state, env) {
    this.state = state
    this.env = env
  }

  async signingKey() {
    let key = await this.env.PUSH.get('mentor-signing-key')
    if (!key || !isHex(key, 64)) {
      key = randomHex(32)
      await this.env.PUSH.put('mentor-signing-key', key)
    }
    return key
  }

  async ownerOk(body) {
    const owner = await this.state.storage.get('owner')
    if (!owner || !isOwnerToken(body.ownerToken)) return false
    return constantEquals(await sha256Hex(body.ownerToken), owner.tokenHash)
  }

  async mentorFromSession(body) {
    if (!isHex(body.session, 48)) return null
    const owner = await this.state.storage.get('owner')
    if (owner?.closedAt) return null
    const session = await this.state.storage.get(`session:${body.session}`)
    if (!session || session.expiresAt < now()) return null
    const mentor = await this.state.storage.get(`mentor:${session.mentorId}`)
    if (!mentor || mentor.revokedAt) return null
    return mentor
  }

  async fetch(request) {
    const url = new URL(request.url)
    const space = String(url.searchParams.get('space') ?? '')
    if (!isSpaceId(space)) return json({ error: 'invalid space' }, 400)
    if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405)
    let body
    try {
      body = await request.json()
    } catch {
      return json({ error: 'invalid request' }, 400)
    }
    if (!body || typeof body !== 'object') return json({ error: 'invalid request' }, 400)
    const path = url.pathname

    // Defence in depth: this object serves exactly one space id.
    const bound = await this.state.storage.get('owner')
    if (bound && bound.spaceId && bound.spaceId !== space) return json({ error: 'unknown space' }, 404)

    /* ---------- routes that touch KV run outside the storage transaction ---------- */
    if (path === '/mentor/share') return this.share(space, body)
    if (path === '/mentor/attachment') return this.attachment(body)

    const newSession = async (tx, mentor) => {
      const sid = randomHex(24)
      const expiresAt = now() + MENTOR_SESSION_TTL_MS
      await tx.put(`session:${sid}`, { mentorId: mentor.id, expiresAt })
      await tx.put(`mentor:${mentor.id}`, { ...mentor, sessions: [...(mentor.sessions ?? []), sid].slice(-10), lastSeenAt: now() })
      return { session: sid, expiresAt }
    }
    const ownerOk = async (tx) => {
      const owner = await tx.get('owner')
      if (!owner || !isOwnerToken(body.ownerToken)) return false
      return constantEquals(await sha256Hex(body.ownerToken), owner.tokenHash)
    }
    const closed = async (tx) => !!(await tx.get('owner'))?.closedAt
    const mentorFromSession = async (tx) => {
      if (!isHex(body.session, 48)) return null
      if (await closed(tx)) return null
      const session = await tx.get(`session:${body.session}`)
      if (!session || session.expiresAt < now()) return null
      const mentor = await tx.get(`mentor:${session.mentorId}`)
      if (!mentor || mentor.revokedAt) return null
      return mentor
    }

    return this.state.storage.transaction(async (tx) => {
      /* ---------- owner routes ---------- */
      if (path === '/mentor/space') {
        if (!isOwnerToken(body.ownerToken)) return json({ error: 'invalid request' }, 400)
        const existing = await tx.get('owner')
        const tokenHash = await sha256Hex(body.ownerToken)
        if (existing) return constantEquals(existing.tokenHash, tokenHash) ? json({ ok: true, createdAt: existing.createdAt }) : json({ error: 'space belongs to another device' }, 403)
        await tx.put('owner', { tokenHash, spaceId: space, createdAt: now() })
        return json({ ok: true, createdAt: now() })
      }
      if (path === '/mentor/invite') {
        if (!(await ownerOk(tx))) return json({ error: 'unauthorized' }, 403)
        const code = randomInviteCode()
        const secret = randomHex(16)
        const expiresAt = now() + MENTOR_INVITE_TTL_MS
        const label = cleanName(body.label)
        await tx.put(`invite:${code}`, { secretHash: await sha256Hex(secret), label, createdAt: now(), expiresAt })
        const invites = (await tx.get('invites')) ?? []
        await tx.put('invites', [...invites, code].slice(-50))
        return json({ code, secret, expiresAt, label })
      }
      if (path === '/mentor/revoke') {
        if (!(await ownerOk(tx))) return json({ error: 'unauthorized' }, 403)
        if (!isRecordId(body.mentorId)) return json({ error: 'invalid request' }, 400)
        const mentor = await tx.get(`mentor:${body.mentorId}`)
        if (!mentor) return json({ error: 'unknown mentor' }, 404)
        for (const sid of mentor.sessions ?? []) await tx.delete(`session:${sid}`)
        await tx.put(`mentor:${mentor.id}`, { ...mentor, sessions: [], revokedAt: now() })
        return json({ ok: true, revokedAt: now() })
      }
      if (path === '/mentor/close' || path === '/mentor/reopen') {
        if (!(await ownerOk(tx))) return json({ error: 'unauthorized' }, 403)
        const owner = await tx.get('owner')
        const closedAt = path === '/mentor/close' ? owner.closedAt ?? now() : null
        await tx.put('owner', { ...owner, closedAt })
        if (closedAt) for (const id of (await tx.get('mentors')) ?? []) {
          // Live sessions end now; mentor records, packs and feedback stay for a reopen.
          const m = await tx.get(`mentor:${id}`)
          if (!m) continue
          for (const sid of m.sessions ?? []) await tx.delete(`session:${sid}`)
          await tx.put(`mentor:${id}`, { ...m, sessions: [] })
        }
        return json({ ok: true, closedAt })
      }
      if (path === '/mentor/unshare') {
        if (!(await ownerOk(tx))) return json({ error: 'unauthorized' }, 403)
        if (!isRecordId(body.packId)) return json({ error: 'invalid request' }, 400)
        const p = await tx.get(`pack:${body.packId}`)
        if (!p) return json({ ok: true, revision: 0, unshared: false })
        if (p.mentorIds.length === 0 && p.attachments.length === 0) return json({ ok: true, revision: p.revision, unsharedAt: p.unsharedAt ?? null, unshared: true, replayed: true })
        const rec = { ...p, revision: p.revision + 1, mentorIds: [], attachments: [], unsharedAt: now() }
        await tx.put(`pack:${p.id}`, rec)
        return json({ ok: true, revision: rec.revision, unsharedAt: rec.unsharedAt, unshared: true })
      }
      if (path === '/mentor/mentors') {
        if (!(await ownerOk(tx))) return json({ error: 'unauthorized' }, 403)
        const owner = await tx.get('owner')
        const ids = (await tx.get('mentors')) ?? []
        const mentors = []
        for (const id of ids) {
          const m = await tx.get(`mentor:${id}`)
          if (m) mentors.push({ id: m.id, name: m.name, createdAt: m.createdAt, revokedAt: m.revokedAt ?? null, lastSeenAt: m.lastSeenAt ?? null })
        }
        const invites = []
        for (const code of (await tx.get('invites')) ?? []) {
          const inv = await tx.get(`invite:${code}`)
          if (inv && !inv.usedBy && inv.expiresAt > now()) invites.push({ code, label: inv.label, expiresAt: inv.expiresAt })
        }
        const packIds = (await tx.get('packs')) ?? []
        const packs = []
        for (const id of packIds) {
          const p = await tx.get(`pack:${id}`)
          // E05: the portal stops serving a share's attachments after the KV TTL — the client shows that date rather than guessing.
          if (p) packs.push({ id: p.id, title: p.title, revision: p.revision, sharedAt: p.sharedAt, mentorIds: p.mentorIds, attachments: p.attachments.length, unsharedAt: p.unsharedAt ?? null, attachmentsExpireAt: p.attachments.length ? p.sharedAt + MENTOR_ATTACHMENT_TTL_S * 1000 : null })
        }
        return json({ mentors, invites, packs, closedAt: owner?.closedAt ?? null })
      }
      if (path === '/mentor/inbox') {
        if (!(await ownerOk(tx))) return json({ error: 'unauthorized' }, 403)
        const since = Number.isFinite(body.since) ? body.since : 0
        const ids = (await tx.get('feedback')) ?? []
        const items = []
        for (const id of ids) {
          const f = await tx.get(`feedback:${id}`)
          if (f && f.at > since) items.push(f)
        }
        return json({ feedback: items })
      }
      if (path === '/mentor/verify') {
        if (!(await ownerOk(tx))) return json({ error: 'unauthorized' }, 403)
        const a = body.attestation
        if (!a || typeof a !== 'object' || typeof body.text !== 'string' || a.spaceId !== space) return json({ valid: false })
        const sig = await hmacHex(await this.signingKey(), attestationString(a, body.text))
        return json({ valid: constantEquals(sig, a.sig) })
      }

      /* ---------- mentor routes ---------- */
      if (path === '/mentor/join' || path === '/mentor/login') {
        if (await closed(tx)) return json({ error: 'access is not active' }, 403)
      }
      if (path === '/mentor/join') {
        if (!isInviteCode(body.code) || !isHex(body.secret, 32)) return json({ error: 'invalid invitation' }, 400)
        const invite = await tx.get(`invite:${body.code}`)
        if (!invite || invite.usedBy || invite.expiresAt < now() || !constantEquals(await sha256Hex(body.secret), invite.secretHash)) return json({ error: 'invitation not valid' }, 403)
        const name = cleanName(body.name)
        const passphrase = typeof body.passphrase === 'string' ? body.passphrase : ''
        if (!name || passphrase.length < MENTOR_MIN_PASSPHRASE) return json({ error: `name and a passphrase of at least ${MENTOR_MIN_PASSPHRASE} characters are needed` }, 400)
        const salt = randomHex(16)
        const mentor = { id: `mt${randomHex(6)}`, name, salt, passHash: await hashPassphrase(passphrase, salt), createdAt: now(), inviteCode: body.code, sessions: [] }
        await tx.put(`mentor:${mentor.id}`, mentor)
        await tx.put(`invite:${body.code}`, { ...invite, usedBy: mentor.id, usedAt: now() })
        const ids = (await tx.get('mentors')) ?? []
        await tx.put('mentors', [...ids, mentor.id])
        const { session, expiresAt } = await newSession(tx, mentor)
        return json({ mentorId: mentor.id, name, session, expiresAt })
      }
      if (path === '/mentor/login') {
        if (!isRecordId(body.mentorId) || typeof body.passphrase !== 'string') return json({ error: 'invalid request' }, 400)
        const mentor = await tx.get(`mentor:${body.mentorId}`)
        if (!mentor || mentor.revokedAt) return json({ error: 'access is not active' }, 403)
        if (!constantEquals(await hashPassphrase(body.passphrase, mentor.salt), mentor.passHash)) return json({ error: 'wrong passphrase' }, 403)
        const { session, expiresAt } = await newSession(tx, mentor)
        return json({ mentorId: mentor.id, name: mentor.name, session, expiresAt })
      }
      if (path === '/mentor/packs') {
        if (await closed(tx)) return json({ error: 'access is not active' }, 403)
        const mentor = await mentorFromSession(tx)
        if (!mentor) return json({ error: 'sign in again' }, 401)
        const packIds = (await tx.get('packs')) ?? []
        const packs = []
        for (const id of packIds) {
          const p = await tx.get(`pack:${id}`)
          if (p && p.mentorIds.includes(mentor.id)) packs.push({ id: p.id, title: p.title, revision: p.revision, text: p.text, sharedAt: p.sharedAt, attachments: p.attachments.map((a) => ({ id: a.id, name: a.name, size: a.size })) })
        }
        const feedbackIds = (await tx.get('feedback')) ?? []
        const mine = []
        for (const id of feedbackIds) {
          const f = await tx.get(`feedback:${id}`)
          if (f && f.mentorId === mentor.id) mine.push({ feedbackId: f.feedbackId, packId: f.packId, text: f.text, at: f.at })
        }
        return json({ mentor: { id: mentor.id, name: mentor.name }, packs, feedback: mine })
      }
      if (path === '/mentor/feedback') {
        if (await closed(tx)) return json({ error: 'access is not active' }, 403)
        const mentor = await mentorFromSession(tx)
        if (!mentor) return json({ error: 'sign in again' }, 401)
        const p = isRecordId(body.packId) ? await tx.get(`pack:${body.packId}`) : null
        if (!p || !p.mentorIds.includes(mentor.id)) return json({ error: 'not shared with you' }, 404)
        const text = cleanText(body.text, MENTOR_FEEDBACK_MAX).trim()
        if (!text) return json({ error: 'feedback is empty' }, 400)
        // Idempotent by the client's own id, so a retry after an uncertain outcome never duplicates.
        const clientId = isRecordId(body.clientId) ? body.clientId : null
        if (clientId) {
          const prior = await tx.get(`feedback-client:${clientId}`)
          if (prior) {
            const f = await tx.get(`feedback:${prior}`)
            if (f) return json({ feedbackId: f.feedbackId, at: f.at, sig: f.sig, replayed: true })
          }
        }
        const feedbackId = `fb${randomHex(6)}`
        const at = now()
        const attestation = { spaceId: space, mentorId: mentor.id, mentorName: mentor.name, feedbackId, at }
        const sig = await hmacHex(await this.signingKey(), attestationString(attestation, text))
        const rec = { ...attestation, sig, packId: p.id, packTitle: p.title, packRevision: p.revision, text }
        await tx.put(`feedback:${feedbackId}`, rec)
        if (clientId) await tx.put(`feedback-client:${clientId}`, feedbackId)
        const ids = (await tx.get('feedback')) ?? []
        await tx.put('feedback', [...ids, feedbackId].slice(-500))
        return json({ feedbackId, at, sig })
      }
      return json({ error: 'not found' }, 404)
    })
  }

  /** B02: validate the whole manifest, upload ciphertext under versioned keys, then commit atomically. */
  async share(space, body) {
    if (!(await this.ownerOk(body))) return json({ error: 'unauthorized' }, 403)
    const pack = body.pack
    if (!pack || !isRecordId(pack.id) || typeof pack.title !== 'string' || !pack.title.trim() || typeof pack.text !== 'string' || pack.text.length > MENTOR_PACK_TEXT_MAX) return json({ error: 'invalid pack' }, 400)
    if (!Number.isInteger(body.revision) || body.revision < 1) return json({ error: 'invalid revision' }, 400)
    const mentorIds = Array.isArray(body.mentorIds) ? [...new Set(body.mentorIds.filter(isRecordId))] : []
    for (const id of mentorIds) {
      const m = await this.state.storage.get(`mentor:${id}`)
      if (!m || m.revokedAt) return json({ error: 'a chosen mentor is not active' }, 400)
    }
    const incoming = Array.isArray(body.attachments) ? body.attachments : []
    if (incoming.length > MENTOR_ATTACHMENTS_PER_PACK) return json({ error: `at most ${MENTOR_ATTACHMENTS_PER_PACK} attachments per pack` }, 400)
    const seen = new Set()
    for (const a of incoming) {
      if (!a || !isRecordId(a.id) || seen.has(a.id) || typeof a.name !== 'string' || !isHex(a.key, 64) || typeof a.iv !== 'string' || typeof a.data !== 'string' || !Number.isFinite(a.size) || a.size > MENTOR_ATTACHMENT_MAX_BYTES || a.data.length > MENTOR_ATTACHMENT_MAX_BYTES * 1.4) return json({ error: 'invalid attachment' }, 400)
      seen.add(a.id)
    }
    const existing = await this.state.storage.get(`pack:${pack.id}`)
    const current = existing?.revision ?? 0
    if (body.revision === current && existing) {
      // A replay is the SAME manifest again (retry after an uncertain outcome). The same
      // revision number with different content — e.g. a client that missed an unshare —
      // is stale and must be reviewed again (B10).
      const sameIds = (a, b) => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i])
      const same = existing.text === pack.text && sameIds(existing.mentorIds, mentorIds) && sameIds(existing.attachments.map((x) => x.id), incoming.map((x) => x.id))
      if (same) return json({ ok: true, replayed: true, packId: pack.id, revision: existing.revision, sharedAt: existing.sharedAt, attachments: existing.attachments.length })
      return json({ error: 'stale share — the pack changed; review and share again', revision: current }, 409)
    }
    if (body.revision !== current + 1) return json({ error: 'stale share — the pack changed; review and share again', revision: current }, 409)
    // 1. Upload every blob under a key that names this revision; nothing served yet.
    const attachments = []
    for (const a of incoming) {
      const kvKey = `matt:${space}:${pack.id}:${body.revision}:${a.id}`
      try {
        await this.env.PUSH.put(kvKey, JSON.stringify({ iv: a.iv, data: a.data }), { expirationTtl: MENTOR_ATTACHMENT_TTL_S })
      } catch {
        return json({ error: 'upload failed — the previous share is unchanged' }, 502)
      }
      attachments.push({ id: a.id, name: cleanName(a.name) || 'file', size: a.size, key: a.key, kvKey })
    }
    // 2. Commit the manifest; the transaction is the only thing mentors read.
    const rec = { id: pack.id, title: cleanName(pack.title) || 'Review pack', revision: body.revision, text: pack.text, sharedAt: now(), mentorIds, attachments }
    try {
      await this.state.storage.transaction(async (tx) => {
        const latest = await tx.get(`pack:${pack.id}`)
        if ((latest?.revision ?? 0) !== current) throw new Error('concurrent')
        await tx.put(`pack:${pack.id}`, rec)
        const packIds = (await tx.get('packs')) ?? []
        if (!packIds.includes(pack.id)) await tx.put('packs', [...packIds, pack.id].slice(-100))
      })
    } catch {
      return json({ error: 'stale share — the pack changed; review and share again', revision: current }, 409)
    }
    return json({ ok: true, packId: pack.id, revision: rec.revision, sharedAt: rec.sharedAt, attachments: rec.attachments.length })
  }

  async attachment(body) {
    if ((await this.state.storage.get('owner'))?.closedAt) return json({ error: 'access is not active' }, 403)
    const mentor = await this.mentorFromSession(body)
    if (!mentor) return json({ error: 'sign in again' }, 401)
    const p = isRecordId(body.packId) ? await this.state.storage.get(`pack:${body.packId}`) : null
    if (!p || !p.mentorIds.includes(mentor.id)) return json({ error: 'not shared with you' }, 404)
    const a = p.attachments.find((x) => x.id === body.attachmentId)
    if (!a) return json({ error: 'unknown attachment' }, 404)
    const blob = await this.env.PUSH.get(a.kvKey, 'json')
    if (!blob) return json({ error: 'attachment expired' }, 410)
    return json({ name: a.name, size: a.size, key: a.key, iv: blob.iv, data: blob.data, revision: p.revision })
  }
}

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
 * MentorStore (G4): one Durable Object per learner space. Owner routes need
 * the owner token; mentor routes need a live session. Invitations are single
 * use and expire; revocation removes every session at once and hides every
 * pack from that mentor. Attachments are stored ENCRYPTED in KV (the learner's
 * device encrypted them; the per-attachment key lives in this object, so only
 * an authenticated mentor of the space can obtain both). Feedback is signed
 * with a worker-wide HMAC key kept in KV (`mentor-signing-key`, minted once).
 * Nothing here touches the learner's own records; the learner's app decides
 * what to store from the inbox.
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

    const ownerOk = async (tx) => {
      const owner = await tx.get('owner')
      if (!owner || !isOwnerToken(body.ownerToken)) return false
      return constantEquals(await sha256Hex(body.ownerToken), owner.tokenHash)
    }
    const mentorFromSession = async (tx) => {
      if (!isHex(body.session, 48)) return null
      const session = await tx.get(`session:${body.session}`)
      if (!session || session.expiresAt < now()) return null
      const mentor = await tx.get(`mentor:${session.mentorId}`)
      if (!mentor || mentor.revokedAt) return null
      return mentor
    }
    const newSession = async (tx, mentor) => {
      const sid = randomHex(24)
      const expiresAt = now() + MENTOR_SESSION_TTL_MS
      await tx.put(`session:${sid}`, { mentorId: mentor.id, expiresAt })
      await tx.put(`mentor:${mentor.id}`, { ...mentor, sessions: [...(mentor.sessions ?? []), sid].slice(-10), lastSeenAt: now() })
      return { session: sid, expiresAt }
    }

    return this.state.storage.transaction(async (tx) => {
      // Defence in depth: this object serves exactly one space id (the router already
      // maps each id to its own object); a request for another id is unknown here.
      const bound = await tx.get('owner')
      if (bound && bound.spaceId && bound.spaceId !== space) return json({ error: 'unknown space' }, 404)
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
      if (path === '/mentor/mentors') {
        if (!(await ownerOk(tx))) return json({ error: 'unauthorized' }, 403)
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
          if (p) packs.push({ id: p.id, title: p.title, sharedAt: p.sharedAt, mentorIds: p.mentorIds, attachments: p.attachments.length })
        }
        return json({ mentors, invites, packs })
      }
      if (path === '/mentor/share') {
        if (!(await ownerOk(tx))) return json({ error: 'unauthorized' }, 403)
        const pack = body.pack
        if (!pack || !isRecordId(pack.id) || typeof pack.title !== 'string' || !pack.title.trim() || typeof pack.text !== 'string' || pack.text.length > MENTOR_PACK_TEXT_MAX) return json({ error: 'invalid pack' }, 400)
        const mentorIds = Array.isArray(body.mentorIds) ? body.mentorIds.filter(isRecordId) : []
        for (const id of mentorIds) {
          const m = await tx.get(`mentor:${id}`)
          if (!m || m.revokedAt) return json({ error: 'a chosen mentor is not active' }, 400)
        }
        const incoming = Array.isArray(body.attachments) ? body.attachments : []
        if (incoming.length > MENTOR_ATTACHMENTS_PER_PACK) return json({ error: 'too many attachments' }, 400)
        const attachments = []
        for (const a of incoming) {
          if (!a || !isRecordId(a.id) || typeof a.name !== 'string' || !isHex(a.key, 64) || typeof a.iv !== 'string' || typeof a.data !== 'string' || !Number.isFinite(a.size) || a.size > MENTOR_ATTACHMENT_MAX_BYTES || a.data.length > MENTOR_ATTACHMENT_MAX_BYTES * 1.4) return json({ error: 'invalid attachment' }, 400)
          const kvKey = `matt:${space}:${pack.id}:${a.id}`
          await this.env.PUSH.put(kvKey, JSON.stringify({ iv: a.iv, data: a.data }), { expirationTtl: MENTOR_ATTACHMENT_TTL_S })
          attachments.push({ id: a.id, name: cleanName(a.name) || 'file', size: a.size, key: a.key, kvKey })
        }
        const existing = await tx.get(`pack:${pack.id}`)
        const rec = { id: pack.id, title: cleanName(pack.title) || 'Review pack', text: pack.text, sharedAt: now(), mentorIds, attachments: existing ? [...existing.attachments, ...attachments] : attachments }
        await tx.put(`pack:${pack.id}`, rec)
        const packIds = (await tx.get('packs')) ?? []
        if (!packIds.includes(pack.id)) await tx.put('packs', [...packIds, pack.id].slice(-100))
        return json({ ok: true, packId: pack.id, sharedAt: rec.sharedAt, attachments: rec.attachments.length })
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
        const mentor = await mentorFromSession(tx)
        if (!mentor) return json({ error: 'sign in again' }, 401)
        const packIds = (await tx.get('packs')) ?? []
        const packs = []
        for (const id of packIds) {
          const p = await tx.get(`pack:${id}`)
          if (p && p.mentorIds.includes(mentor.id)) packs.push({ id: p.id, title: p.title, text: p.text, sharedAt: p.sharedAt, attachments: p.attachments.map((a) => ({ id: a.id, name: a.name, size: a.size })) })
        }
        const feedbackIds = (await tx.get('feedback')) ?? []
        const mine = []
        for (const id of feedbackIds) {
          const f = await tx.get(`feedback:${id}`)
          if (f && f.mentorId === mentor.id) mine.push({ feedbackId: f.feedbackId, packId: f.packId, text: f.text, at: f.at })
        }
        return json({ mentor: { id: mentor.id, name: mentor.name }, packs, feedback: mine })
      }
      if (path === '/mentor/attachment') {
        const mentor = await mentorFromSession(tx)
        if (!mentor) return json({ error: 'sign in again' }, 401)
        const p = isRecordId(body.packId) ? await tx.get(`pack:${body.packId}`) : null
        if (!p || !p.mentorIds.includes(mentor.id)) return json({ error: 'not shared with you' }, 404)
        const a = p.attachments.find((x) => x.id === body.attachmentId)
        if (!a) return json({ error: 'unknown attachment' }, 404)
        const blob = await this.env.PUSH.get(a.kvKey, 'json')
        if (!blob) return json({ error: 'attachment expired' }, 410)
        return json({ name: a.name, size: a.size, key: a.key, iv: blob.iv, data: blob.data })
      }
      if (path === '/mentor/feedback') {
        const mentor = await mentorFromSession(tx)
        if (!mentor) return json({ error: 'sign in again' }, 401)
        const p = isRecordId(body.packId) ? await tx.get(`pack:${body.packId}`) : null
        if (!p || !p.mentorIds.includes(mentor.id)) return json({ error: 'not shared with you' }, 404)
        const text = cleanText(body.text, MENTOR_FEEDBACK_MAX).trim()
        if (!text) return json({ error: 'feedback is empty' }, 400)
        const feedbackId = `fb${randomHex(6)}`
        const at = now()
        const attestation = { spaceId: space, mentorId: mentor.id, mentorName: mentor.name, feedbackId, at }
        const sig = await hmacHex(await this.signingKey(), attestationString(attestation, text))
        const rec = { ...attestation, sig, packId: p.id, packTitle: p.title, text }
        await tx.put(`feedback:${feedbackId}`, rec)
        const ids = (await tx.get('feedback')) ?? []
        await tx.put('feedback', [...ids, feedbackId].slice(-500))
        return json({ feedbackId, at, sig })
      }
      return json({ error: 'not found' }, 404)
    })
  }
}

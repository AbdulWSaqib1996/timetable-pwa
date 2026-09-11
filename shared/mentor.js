/**
 * G4 — mentor portal contracts and crypto (runtime-neutral: browser, worker,
 * node ≥ 20 all expose WebCrypto as `globalThis.crypto`).
 *
 * The learner owns a "space" (a random id plus an owner token held on their
 * devices). They mint single-use invitations; a mentor joins one with a name
 * and a passphrase and gets an account scoped to that space only. The learner
 * shares review packs (the same text the app previews) with chosen mentors;
 * attachments are encrypted on the learner's device with a per-attachment key
 * before they leave it. A mentor's feedback is signed by the worker
 * (HMAC-SHA-256 over an attestation string); the learner's app stores it as a
 * `reviewer-authenticated` observation carrying that attestation, which the
 * worker can verify on request. Nothing here is a judgement engine: feedback
 * is text with an author and a time.
 */

export const MENTOR_INVITE_TTL_MS = 7 * 24 * 60 * 60_000
export const MENTOR_SESSION_TTL_MS = 30 * 24 * 60 * 60_000
export const MENTOR_ATTACHMENT_MAX_BYTES = 2 * 1024 * 1024
export const MENTOR_ATTACHMENTS_PER_PACK = 5
export const MENTOR_PACK_TEXT_MAX = 60_000
export const MENTOR_FEEDBACK_MAX = 8_000
export const MENTOR_MIN_PASSPHRASE = 8
export const MENTOR_ATTACHMENT_TTL_S = 60 * 24 * 60 * 60

export const isSpaceId = (v) => typeof v === 'string' && /^[0-9a-f]{24}$/.test(v)
export const isOwnerToken = (v) => typeof v === 'string' && /^[0-9a-f]{48}$/.test(v)
export const isInviteCode = (v) => typeof v === 'string' && /^[A-Z2-9]{8}$/.test(v)
export const isHex = (v, n) => typeof v === 'string' && new RegExp(`^[0-9a-f]{${n}}$`).test(v)
export const isRecordId = (v) => typeof v === 'string' && /^[\w-]{1,64}$/.test(v)

const enc = new TextEncoder()
const dec = new TextDecoder()

export function randomHex(bytes) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function randomInviteCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  let code = ''
  for (const b of crypto.getRandomValues(new Uint8Array(8))) code += chars[b % chars.length]
  return code
}

const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
const fromHex = (hex) => new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)))

export function bytesToBase64(bytes) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
export function base64ToBytes(b64) {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

export async function sha256Hex(text) {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(text)))
}

export async function hmacHex(keyHex, text) {
  const key = await crypto.subtle.importKey('raw', fromHex(keyHex), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(text)))
}

export function constantEquals(a, b) {
  const left = String(a ?? '')
  const right = String(b ?? '')
  if (left.length !== right.length) return false
  let mismatch = 0
  for (let i = 0; i < left.length; i++) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i)
  return mismatch === 0
}

/** PBKDF2-SHA-256, 100k iterations → hex. Salt is per mentor. */
export async function hashPassphrase(passphrase, saltHex) {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations: 100_000 }, base, 256)
  return toHex(bits)
}

/** AES-256-GCM with a raw hex key: { iv, data } as base64. */
export async function encryptBytes(bytes, keyHex) {
  const key = await crypto.subtle.importKey('raw', fromHex(keyHex), { name: 'AES-GCM' }, false, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes))
  return { iv: bytesToBase64(iv), data: bytesToBase64(data) }
}

export async function decryptBytes({ iv, data }, keyHex) {
  const key = await crypto.subtle.importKey('raw', fromHex(keyHex), { name: 'AES-GCM' }, false, ['decrypt'])
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(iv) }, key, base64ToBytes(data)))
}

export const encryptText = async (text, keyHex) => encryptBytes(enc.encode(text), keyHex)
export const decryptText = async (blob, keyHex) => dec.decode(await decryptBytes(blob, keyHex))

/** What the worker signs for a piece of feedback. */
export const attestationString = (a, text) => `${a.spaceId}|${a.mentorId}|${a.feedbackId}|${a.at}|${text}`

/** Shape of the attestation an observation must carry to be reviewer-authenticated. */
export function validAttestation(a) {
  return !!a && typeof a === 'object' && isSpaceId(a.spaceId) && isRecordId(a.mentorId) && isRecordId(a.feedbackId) && Number.isFinite(a.at) && isHex(a.sig, 64) && typeof a.mentorName === 'string' && a.mentorName.length <= 60
}

export const cleanName = (n) => String(n ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
export const cleanText = (t, max) => (typeof t === 'string' ? t.slice(0, max) : '')

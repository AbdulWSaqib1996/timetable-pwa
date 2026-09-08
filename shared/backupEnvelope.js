/**
 * Portable encrypted backup envelope (R5a / NF-05), runtime-neutral over
 * WebCrypto (browser `crypto.subtle`, Node ≥ 20 `globalThis.crypto`).
 *
 * Format v1 — one JSON document:
 *   {
 *     format: 'my-timetable-encrypted-backup', version: 1,
 *     kdf:    { name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt: <base64 16 bytes> },
 *     cipher: { name: 'AES-GCM', keyBits: 256, iv: <base64 12 bytes>, tagBits: 128 },
 *     compression: 'gzip' | 'none',
 *     createdAt: <ISO 8601>,
 *     payload: <base64 ciphertext incl. GCM tag>
 *   }
 *
 * Key = PBKDF2-HMAC-SHA-256(passphrase, salt, iterations) → AES-256-GCM.
 * Additional authenticated data (AAD) = "format|v<version>|<iterations>|<salt>|<compression>",
 * so tampering with the parameters fails authentication exactly like a wrong
 * passphrase. Plaintext = the plain backup JSON (UTF-8), gzip-compressed
 * first when the runtime offers CompressionStream. The same passphrase and
 * envelope open on any device — nothing device-specific enters the key.
 *
 * Wrong-passphrase behaviour: GCM authentication fails; the result is
 * { ok: false, reason: 'wrong-passphrase-or-corrupt' }. Wrong passphrase and
 * corruption are deliberately indistinguishable. There is NO recovery
 * without the passphrase — it is never stored, and it is unrelated to the
 * sync code or any provider credential.
 */

export const ENVELOPE_FORMAT = 'my-timetable-encrypted-backup'
export const ENVELOPE_VERSION = 1
export const KDF_ITERATIONS = 600_000
export const MIN_PASSPHRASE_LENGTH = 12

const subtle = () => globalThis.crypto?.subtle
const utf8 = (s) => new TextEncoder().encode(s)

export function bytesToBase64(bytes) {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

export function base64ToBytes(b64) {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function deriveKey(passphrase, salt, iterations) {
  const material = await subtle().importKey('raw', utf8(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveKey'])
  return subtle().deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

const aadFor = (version, iterations, saltB64, compression) => utf8(`${ENVELOPE_FORMAT}|v${version}|${iterations}|${saltB64}|${compression}`)

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream)
  return new Uint8Array(await new Response(out).arrayBuffer())
}

/** Is this text an envelope (any version)? Never throws. */
export function isEnvelope(text) {
  try {
    const doc = JSON.parse(text)
    return !!doc && typeof doc === 'object' && doc.format === ENVELOPE_FORMAT
  } catch {
    return false
  }
}

/**
 * Seal plain backup JSON with a passphrase. `opts` exist for test vectors
 * (fixed salt/iv, fewer iterations, no compression) — production callers
 * pass none and get fresh random salt and IV every time.
 */
export async function sealBackup(plaintext, passphrase, opts = {}) {
  if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(`Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`)
  }
  const iterations = opts.iterations ?? KDF_ITERATIONS
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16))
  const iv = opts.iv ?? crypto.getRandomValues(new Uint8Array(12))
  const wantGzip = opts.compression !== 'none' && typeof CompressionStream !== 'undefined'
  const compression = wantGzip ? 'gzip' : 'none'
  const body = wantGzip ? await pipe(utf8(plaintext), new CompressionStream('gzip')) : utf8(plaintext)
  const saltB64 = bytesToBase64(salt)
  const key = await deriveKey(passphrase, salt, iterations)
  const ciphertext = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: aadFor(ENVELOPE_VERSION, iterations, saltB64, compression), tagLength: 128 }, key, body)
  return JSON.stringify({
    format: ENVELOPE_FORMAT,
    version: ENVELOPE_VERSION,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: saltB64 },
    cipher: { name: 'AES-GCM', keyBits: 256, iv: bytesToBase64(iv), tagBits: 128 },
    compression,
    createdAt: opts.createdAt ?? new Date().toISOString(),
    payload: bytesToBase64(new Uint8Array(ciphertext)),
  })
}

/**
 * Open an envelope. Returns { ok: true, plaintext } or { ok: false, reason }
 * with reason one of 'not-an-envelope' | 'unsupported-version' | 'malformed'
 * | 'wrong-passphrase-or-corrupt'. Never throws on bad input.
 */
export async function openBackup(text, passphrase) {
  let doc
  try {
    doc = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'not-an-envelope' }
  }
  if (!doc || typeof doc !== 'object' || doc.format !== ENVELOPE_FORMAT) return { ok: false, reason: 'not-an-envelope' }
  if (doc.version !== ENVELOPE_VERSION) return { ok: false, reason: 'unsupported-version' }
  const k = doc.kdf
  const c = doc.cipher
  if (
    !k || k.name !== 'PBKDF2' || k.hash !== 'SHA-256' || !Number.isInteger(k.iterations) || k.iterations < 1 || k.iterations > 10_000_000 ||
    typeof k.salt !== 'string' || !c || c.name !== 'AES-GCM' || c.keyBits !== 256 || typeof c.iv !== 'string' || c.tagBits !== 128 ||
    !['gzip', 'none'].includes(doc.compression) || typeof doc.payload !== 'string'
  ) {
    return { ok: false, reason: 'malformed' }
  }
  let salt, iv, payload
  try {
    salt = base64ToBytes(k.salt)
    iv = base64ToBytes(c.iv)
    payload = base64ToBytes(doc.payload)
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (salt.length < 8 || iv.length !== 12) return { ok: false, reason: 'malformed' }
  if (doc.compression === 'gzip' && typeof DecompressionStream === 'undefined') return { ok: false, reason: 'malformed' }
  try {
    const key = await deriveKey(String(passphrase ?? ''), salt, k.iterations)
    const plain = new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv, additionalData: aadFor(doc.version, k.iterations, k.salt, doc.compression), tagLength: 128 }, key, payload))
    const bytes = doc.compression === 'gzip' ? await pipe(plain, new DecompressionStream('gzip')) : plain
    return { ok: true, plaintext: new TextDecoder().decode(bytes), createdAt: typeof doc.createdAt === 'string' ? doc.createdAt : null }
  } catch {
    return { ok: false, reason: 'wrong-passphrase-or-corrupt' }
  }
}

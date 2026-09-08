import test from 'node:test'
import assert from 'node:assert/strict'
import { ENVELOPE_FORMAT, ENVELOPE_VERSION, KDF_ITERATIONS, MIN_PASSPHRASE_LENGTH, base64ToBytes, bytesToBase64, isEnvelope, openBackup, sealBackup } from '../../shared/backupEnvelope.js'

const PASS = 'correct horse battery staple'
const BACKUP = JSON.stringify({ version: 4, store: { activeId: 'p1', profiles: [{ id: 'p1', name: 'Test', settings: { demo: true, sheetId: '' } }] }, meta: { p1: { k: { note: 'hello' } } } })

// Fixed-parameter vector: same passphrase, salt, IV and plaintext → identical
// bytes on every runtime. Regenerate ONLY with a deliberate format change.
const VECTOR = {
  salt: base64ToBytes('AAECAwQFBgcICQoLDA0ODw=='),
  iv: base64ToBytes('AAECAwQFBgcICQoL'),
  iterations: 1000,
  plaintext: '{"version":4,"hello":"world"}',
  passphrase: 'vector passphrase 1234',
  payload: 'trW8kUDxsnJzZKfhR4yDsFJWBK39VTs3nQK6U1kkcjJSW8T5Alu58uUW5Pag',
}

test('envelope constants and document shape', async () => {
  const sealed = await sealBackup(BACKUP, PASS)
  const doc = JSON.parse(sealed)
  assert.equal(doc.format, ENVELOPE_FORMAT)
  assert.equal(doc.version, ENVELOPE_VERSION)
  assert.deepEqual(Object.keys(doc.kdf), ['name', 'hash', 'iterations', 'salt'])
  assert.equal(doc.kdf.iterations, KDF_ITERATIONS)
  assert.equal(doc.cipher.name, 'AES-GCM')
  assert.equal(doc.cipher.keyBits, 256)
  assert.equal(base64ToBytes(doc.cipher.iv).length, 12)
  assert.equal(base64ToBytes(doc.kdf.salt).length, 16)
  assert.equal(doc.compression, 'gzip')
  assert.ok(isEnvelope(sealed))
  assert.ok(!isEnvelope(BACKUP))
  assert.ok(!isEnvelope('not json'))
  // The plain JSON never appears in the sealed document.
  assert.ok(!sealed.includes('hello'))
})

test('round trip: right passphrase opens; wrong passphrase, tampering and parameter edits all fail closed', async () => {
  const sealed = await sealBackup(BACKUP, PASS, { iterations: 2000 })
  const ok = await openBackup(sealed, PASS)
  assert.equal(ok.ok, true)
  assert.equal(ok.plaintext, BACKUP)
  assert.equal((await openBackup(sealed, 'wrong passphrase 123')).reason, 'wrong-passphrase-or-corrupt')
  // Flip one ciphertext byte.
  const doc = JSON.parse(sealed)
  const bytes = base64ToBytes(doc.payload)
  bytes[5] ^= 0x01
  assert.equal((await openBackup(JSON.stringify({ ...doc, payload: bytesToBase64(bytes) }), PASS)).reason, 'wrong-passphrase-or-corrupt')
  // Changing a bound parameter (iterations) breaks the AAD, not just the key.
  assert.equal((await openBackup(JSON.stringify({ ...doc, kdf: { ...doc.kdf, iterations: 2001 } }), PASS)).reason, 'wrong-passphrase-or-corrupt')
  assert.equal((await openBackup(JSON.stringify({ ...doc, compression: 'none' }), PASS)).reason, 'wrong-passphrase-or-corrupt')
  assert.equal((await openBackup(JSON.stringify({ ...doc, version: 2 }), PASS)).reason, 'unsupported-version')
  assert.equal((await openBackup(JSON.stringify({ ...doc, cipher: { ...doc.cipher, iv: 'AAAA' } }), PASS)).reason, 'malformed')
  assert.equal((await openBackup(BACKUP, PASS)).reason, 'not-an-envelope')
  assert.equal((await openBackup('garbage', PASS)).reason, 'not-an-envelope')
})

test('passphrase policy: shorter than the minimum is refused before any key derivation', async () => {
  await assert.rejects(() => sealBackup(BACKUP, 'short'), new RegExp(`at least ${MIN_PASSPHRASE_LENGTH}`))
})

test('test vector: fixed salt/IV/iterations produce the documented ciphertext and open again', async () => {
  const sealed = await sealBackup(VECTOR.plaintext, VECTOR.passphrase, { salt: VECTOR.salt, iv: VECTOR.iv, iterations: VECTOR.iterations, compression: 'none', createdAt: '2026-09-08T00:00:00.000Z' })
  const doc = JSON.parse(sealed)
  assert.equal(doc.payload, VECTOR.payload)
  const opened = await openBackup(sealed, VECTOR.passphrase)
  assert.equal(opened.ok, true)
  assert.equal(opened.plaintext, VECTOR.plaintext)
  // Unicode passphrases are NFKC-normalised so composed/decomposed forms agree across devices.
  const composed = await sealBackup(VECTOR.plaintext, 'café passphrase 12', { salt: VECTOR.salt, iv: VECTOR.iv, iterations: 100, compression: 'none' })
  const decomposed = await openBackup(composed, 'café passphrase 12')
  assert.equal(decomposed.ok, true)
})

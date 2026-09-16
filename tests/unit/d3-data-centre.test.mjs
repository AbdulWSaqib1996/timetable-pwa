import test from 'node:test'
import assert from 'node:assert/strict'
import { MENTOR_ATTACHMENT_TTL_MS, attachmentExpiry, backupSummaryState, buildRecoveryGuide, fileRows, referencedUids, relinkUid, restoreReferencedMissing, shareSummary, syncSummary } from '../../shared/dataCentre.js'
import { MentorStore } from '../../workers/push/mentor-store.js'
import { encryptText, randomHex } from '../../shared/mentor.js'

/**
 * Audit D3 (Pass 85) — E05 data & sharing centre: every state comes from a
 * confirmed result (an acknowledged sync time, a recorded generation with its
 * file identities, an acknowledged share), never from an attempt; a
 * records-only export never claims files; expired portal copies are named;
 * references survive by uid and can be relinked; a restore preview names
 * referenced files that are in neither the backup nor the device; the
 * recovery guide carries no secret; the worker names the portal expiry.
 */

const NOW = Date.parse('2026-09-16T12:00:00Z')
const day = 86400000
const admin = () => ({
  reviewPacks: [
    { id: 'pk1', title: 'Autumn pack', state: 'draft', createdISO: '2026-09-01', items: [], attachments: [{ id: '', uid: 'u-obs', name: 'obs.pdf', state: 'local-only' }], sharing: { revision: 2, sharedAt: NOW - 10 * day, mentorIds: ['m1'], attachmentUids: ['u-obs'], textHash: 'h' }, at: 1 },
    { id: 'pk2', title: 'Old pack', state: 'discussed', createdISO: '2026-06-01', items: [], attachments: [{ id: '', uid: 'u-old', name: 'old.pdf', state: 'local-only' }], sharing: { revision: 1, sharedAt: NOW - 70 * day, mentorIds: ['m1'], attachmentUids: ['u-old'], textHash: 'h' }, at: 1 },
    { id: 'pk3', title: 'Unshared', state: 'draft', createdISO: '2026-09-01', items: [], sharing: { revision: 1, sharedAt: NOW - 5 * day, mentorIds: ['m1'], attachmentUids: [], textHash: 'h', unsharedAt: NOW - day }, at: 1 },
  ],
  projects: [{ id: 'p1', title: 'Assignment 1', status: 'submitted', drafts: [{ id: 'd1', kind: 'wallet', uid: 'u-draft', label: 'Draft 1', at: 1 }], submissions: [{ id: 's1', submittedAt: 1, channel: 'Turnitin', receiptUid: 'u-receipt' }], at: 1 }],
})

test('sync and backup states come from confirmed results only; a records-only generation never claims files', () => {
  const records = [{ at: NOW - 3 * day }, { at: NOW - day }, { at: NOW - 3600000 }]
  assert.equal(syncSummary({ enabled: false, records, now: NOW }).state, 'off')
  const s = syncSummary({ enabled: true, lastAt: NOW - 2 * day, records, now: NOW })
  assert.equal(s.state, 'pending')
  assert.equal(s.pending, 2, 'records edited after the acknowledged time are pending')
  assert.equal(syncSummary({ enabled: true, lastAt: NOW, records, now: NOW }).state, 'confirmed')
  assert.equal(syncSummary({ enabled: true, lastAt: NOW, failed: true, records, now: NOW }).state, 'failed')
  assert.equal(syncSummary({ enabled: true, lastAt: null, records, now: NOW }).state, 'never', 'switched on is not confirmed')

  assert.equal(backupSummaryState({ history: [], profileId: 'fx', records, now: NOW }).state, 'never')
  const textOnly = backupSummaryState({ history: [{ at: NOW - 2 * day, profiles: ['fx'], all: false, kind: 'file', files: false, attachments: [] }], profileId: 'fx', records, now: NOW })
  assert.equal(textOnly.files, 0, 'a records-only export never claims files')
  assert.equal(textOnly.state, 'stale', 'records edited since the generation')
  const full = backupSummaryState({ history: [{ at: NOW, profiles: [], all: true, kind: 'file', files: true, attachments: ['u-obs', 'u-draft'] }], profileId: 'fx', records, now: NOW })
  assert.equal(full.state, 'covered')
  assert.equal(full.files, 2)
  assert.equal(backupSummaryState({ history: [{ at: NOW - day, profiles: ['other'], all: false, kind: 'file', files: true }], profileId: 'fx', records, now: NOW }).state, 'never', 'a scoped backup of another timetable does not cover this one')
})

test('shares come from acknowledged summaries; expired portal copies are named; unshared packs do not count', () => {
  const sh = shareSummary(admin(), NOW)
  assert.equal(sh.shared, 2)
  assert.equal(sh.unshared, 1)
  assert.equal(sh.expired, 1, 'the 70-day-old share has expired portal copies')
  const old = sh.packs.find((p) => p.id === 'pk2')
  assert.equal(old.expired, true)
  assert.equal(old.expiresAt, NOW - 70 * day + MENTOR_ATTACHMENT_TTL_MS)
  assert.equal(attachmentExpiry(NOW - 10 * day, NOW).daysLeft, 50)
})

test('file rows: bytes-in-backup by uid, share revision and expiry per file, and a referenced file that is not here is missing', () => {
  const files = [{ uid: 'u-obs', name: 'obs.pdf', kind: 'wallet', size: 10 }, { uid: 'u-draft', name: 'draft.docx', kind: 'wallet', size: 20 }, { uid: 'u-photo', name: 'Photo', kind: 'photo', size: 5 }]
  const history = [{ at: NOW - day, profiles: [], all: true, kind: 'file', files: true, attachments: ['u-obs'] }]
  const rows = fileRows({ files, admin: admin(), history, now: NOW })
  const by = (uid) => rows.find((r) => r.uid === uid)
  assert.ok(by('u-obs').backedUp && by('u-draft').backedUp === null, 'only the uid the generation listed is backed up')
  assert.deepEqual(by('u-obs').shares.map((s) => [s.title, s.revision, s.expired]), [['Autumn pack', 2, false]])
  assert.equal(by('u-draft').refs[0].kind, 'project-draft')
  const missing = rows.filter((r) => !r.present).map((r) => r.uid).sort()
  assert.deepEqual(missing, ['u-old', 'u-receipt'], 'referenced but absent files are listed as missing')
  assert.equal(by('u-old').shares[0].expired, true)
  // References are by uid: relinking rewrites every reference and nothing else.
  const relinked = relinkUid(admin(), 'u-receipt', 'u-draft', NOW)
  assert.equal(relinked.projects[0].submissions[0].receiptUid, 'u-draft')
  assert.equal(relinked.projects[0].at, NOW)
  assert.equal(relinked.reviewPacks[0].at, 1, 'untouched packs keep their edit time')
  assert.equal(referencedUids(relinked).has('u-receipt'), false)
  const same = admin()
  assert.equal(relinkUid(same, 'u-receipt', 'u-receipt', NOW), same, 'same uid is a no-op (identity preserved)')
})

test('restore preview: referenced files in neither the backup nor the device are counted by uid, so remapped local ids never matter', () => {
  const backupAdmin = { fx: admin() }
  const inBackup = new Set(['u-obs'])
  const onDevice = new Set(['u-draft'])
  const r = restoreReferencedMissing(backupAdmin, inBackup, onDevice)
  assert.deepEqual(r.uids.sort(), ['u-old', 'u-receipt'])
  assert.equal(restoreReferencedMissing(backupAdmin, new Set(['u-obs', 'u-old', 'u-receipt', 'u-draft']), new Set()).count, 0)
})

test('the recovery guide is plain language and carries no code, token or key', () => {
  const secrets = { code: 'SYNC-ABCD-1234', token: randomHex(24), key: randomHex(32) }
  const text = buildRecoveryGuide({
    generatedAt: NOW,
    profiles: [{ name: 'My timetable', records: 12, adminRecords: 40, photos: 3, documents: 2 }],
    sync: { enabled: true, code: secrets.code },
    backup: { lastAt: NOW - day, files: 5 },
    mentors: { enabled: true, packsShared: 2, ownerToken: secrets.token },
    appUrl: 'https://pgce-timetable.vercel.app/',
  })
  for (const v of Object.values(secrets)) assert.equal(text.includes(v), false, 'no secret appears')
  assert.match(text, /RECOVERY GUIDE/)
  assert.match(text, /12 session records, 40 PGCE records, 3 photos, 2 documents/)
  assert.match(text, /Sync between devices is ON/)
  assert.match(text, /including 5 files/)
  assert.match(text, /2 review packs currently shared/)
  assert.match(text, /contains no codes, tokens or keys/)
  const textOnly = buildRecoveryGuide({ generatedAt: NOW, profiles: [], sync: { enabled: false }, backup: { lastAt: NOW, files: 0 }, mentors: { enabled: false, packsShared: 0 } })
  assert.match(textOnly, /records only \(no photos or documents\)/)
})

// --- worker: the listing names when a share's portal copies expire ---
function makeStore() {
  const records = new Map()
  const kv = new Map()
  let chain = Promise.resolve()
  const tx = { get: async (k) => records.get(k), put: async (k, v) => { records.set(k, v) }, delete: async (k) => { records.delete(k) } }
  const serial = (work) => { const next = chain.then(work); chain = next.catch(() => {}); return next }
  const storage = { ...tx, transaction: (work) => serial(() => work(tx)) }
  const env = { PUSH: { get: async (k, type) => (type === 'json' ? JSON.parse(kv.get(k) ?? 'null') : kv.get(k) ?? null), put: async (k, v) => { kv.set(k, v) }, delete: async () => { throw new Error('must not delete KV') } } }
  return new MentorStore({ storage, blockConcurrencyWhile: (w) => w() }, env)
}
const SPACE = randomHex(12)
const OWNER = randomHex(24)
const call = async (store, path, body) => {
  const res = await store.fetch(new Request(`https://push.test${path}?space=${SPACE}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }))
  return { status: res.status, body: await res.json() }
}

test('worker: /mentor/mentors names attachmentsExpireAt for a share with files and null for a text-only share', async () => {
  const store = makeStore()
  assert.equal((await call(store, '/mentor/space', { ownerToken: OWNER })).status, 200)
  const inv = (await call(store, '/mentor/invite', { ownerToken: OWNER })).body
  const m = (await call(store, '/mentor/join', { code: inv.code, secret: inv.secret, name: 'A Mentor', passphrase: 'correct horse battery' })).body
  const key = randomHex(32)
  const blob = await encryptText('hello', key)
  const withFile = await call(store, '/mentor/share', { ownerToken: OWNER, revision: 1, pack: { id: 'pk1', title: 'Pack', text: 'T' }, mentorIds: [m.mentorId], attachments: [{ id: 'a1', name: 'a.txt', size: 5, key, iv: blob.iv, data: blob.data }] })
  assert.equal(withFile.status, 200)
  const textOnly = await call(store, '/mentor/share', { ownerToken: OWNER, revision: 1, pack: { id: 'pk2', title: 'Text', text: 'T' }, mentorIds: [m.mentorId], attachments: [] })
  assert.equal(textOnly.status, 200)
  const listing = (await call(store, '/mentor/mentors', { ownerToken: OWNER })).body
  const p1 = listing.packs.find((p) => p.id === 'pk1')
  const p2 = listing.packs.find((p) => p.id === 'pk2')
  assert.equal(p1.attachmentsExpireAt, p1.sharedAt + MENTOR_ATTACHMENT_TTL_MS)
  assert.equal(p2.attachmentsExpireAt, null)
})

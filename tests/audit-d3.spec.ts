import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'
import fs from 'node:fs'

/**
 * Audit D3 (Pass 85) — E05 data & sharing centre in the browser: four states
 * from confirmed results, a per-file table (bytes in a generated backup, share
 * revision, portal expiry), a referenced-but-absent file listed as missing
 * and relinked by uid, a recovery guide without secrets, a records-only
 * generation that never claims files, and a restore preview that names
 * referenced files the backup does not carry.
 */

test.use({ timezoneId: 'Europe/London' })

const NOW = Date.parse('2026-09-16T12:00:00Z')
const day = 86400000
const OWNER_TOKEN = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
const SYNC_CODE = 'ZZZZ-1234-QQQQ'
const admin = () => ({
  reflections: [], targets: [], meetings: [], observations: [], lessons: [], audits: [], tasks: [], exceptions: [], plans: [], commitments: [], placements: [], schools: [], programmes: [], packs: [], requirements: [], milestones: [], cycles: [], preps: [], goals: [], resources: [], readings: [], contacts: [], questions: [], protected: [], supportNotes: [], examples: [], experience: [], reviews: [], homework: [],
  reviewPacks: [
    { id: 'pk1', title: 'Autumn pack', state: 'draft', createdISO: '2026-09-01', items: [], attachments: [{ id: '', uid: 'u-obs', name: 'obs.pdf', state: 'local-only' }], sharing: { revision: 2, sharedAt: NOW - 10 * day, mentorIds: ['m1'], attachmentUids: ['u-obs'], textHash: 'h' }, at: 1 },
    { id: 'pk2', title: 'Old pack', state: 'discussed', createdISO: '2026-06-01', items: [], attachments: [{ id: '', uid: 'u-old', name: 'old.pdf', state: 'missing' }], sharing: { revision: 1, sharedAt: NOW - 70 * day, mentorIds: ['m1'], attachmentUids: ['u-old'], textHash: 'h' }, at: 1 },
  ],
  projects: [{ id: 'p1', title: 'Assignment 1', status: 'submitted', submissions: [{ id: 's1', submittedAt: NOW - 3 * day, channel: 'Turnitin', receiptUid: 'u-receipt' }], at: NOW - 3 * day }],
})

async function seed(page: Page, opts: { files?: boolean | null; history?: boolean } = {}) {
  await page.clock.install({ time: new Date(NOW) })
  await page.addInitScript(
    ({ admin, NOW, day, files, history, OWNER_TOKEN, SYNC_CODE }) => {
      localStorage.setItem('timetable.whatsnew.v1', '99')
      if (localStorage.getItem('timetable.store.v2')) return
      localStorage.setItem('timetable.store.v2', JSON.stringify({ activeId: 'fx', profiles: [{ id: 'fx', name: 'My timetable', settings: { demo: false, sheetId: 'FIXTURESHEET-FIXTURESHEET-FIXTURESHEET-0001', gid: null, specialismsChosen: true, checklistDismissed: true, usagePing: false, mentorSpaceId: 'abcdef123456', mentorOwnerToken: OWNER_TOKEN } }] }))
      localStorage.setItem('timetable.cache.v2.fx', JSON.stringify({ fetchedAt: Date.now(), sessions: [] }))
      localStorage.setItem('timetable.admin.v1.fx', JSON.stringify(admin))
      localStorage.setItem('timetable.meta.v2.fx', JSON.stringify({ '2026-09-16|09:00|maths 1': { attended: true, at: NOW - 3600000 }, '2026-09-15|09:00|maths 1': { attended: true, at: NOW - day }, '2026-09-14|09:00|maths 1': { attended: true, at: NOW - 5 * day } }))
      localStorage.setItem('timetable.sync.v1', JSON.stringify({ code: SYNC_CODE, lastAt: NOW - 2 * day }))
      if (history) localStorage.setItem('timetable.backup.v1', JSON.stringify({ lastBackupAt: NOW - day, history: [{ at: NOW - day, profiles: ['fx'], all: true, kind: 'file', files, attachments: files ? ['u-obs'] : [] }] }))
    },
    { admin: admin(), NOW, day, files: opts.files ?? true, history: opts.history ?? true, OWNER_TOKEN, SYNC_CODE }
  )
  await page.setViewportSize({ width: 390, height: 844 })
}
const seedWallet = (page: Page, entries: { uid: string; name: string }[]) =>
  page.evaluate(
    (entries) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('timetable-wallet', 1)
        req.onupgradeneeded = () => {
          const s = req.result.createObjectStore('files', { keyPath: 'id', autoIncrement: true })
          s.createIndex('owner', 'owner')
        }
        req.onsuccess = () => {
          const tx = req.result.transaction('files', 'readwrite')
          for (const e of entries) tx.objectStore('files').put({ owner: 'fx', name: e.name, type: 'application/pdf', size: 3, blob: new Blob(['abc'], { type: 'application/pdf' }), at: Date.now(), uid: e.uid })
          tx.oncomplete = () => { req.result.close(); resolve() }
          tx.onerror = () => reject(tx.error)
        }
        req.onerror = () => reject(req.error)
      }),
    entries
  )
const adminOf = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('timetable.admin.v1.fx') ?? '{}'))

test('E05: four confirmed states, the per-file table, a missing referenced file relinked by uid, and a recovery guide without secrets', async ({ page }) => {
  await seed(page)
  await page.goto('./#/today')
  await seedWallet(page, [{ uid: 'u-obs', name: 'obs.pdf' }, { uid: 'u-spare', name: 'spare.pdf' }])
  await page.goto('./#/settings/data')
  const cards = page.getByRole('list', { name: 'Data and sharing status' })
  await expect(cards.getByRole('listitem')).toHaveCount(4)
  const card = (title: string) => cards.getByRole('listitem').filter({ hasText: title })
  await expect(card('On this device')).toContainText('3 session records · 3 PGCE records · 2 files')
  // The test network is isolated, so the sync attempt on load fails — and the card says so, still naming the last CONFIRMED time.
  await expect(card('Synced to my devices')).toContainText(/Last attempt failed · last confirmed 14 Sept|2 records edited since the last confirmed sync \(14 Sept/)
  await expect(card('Backed up')).toContainText('records and 1 file')
  await expect(card('Backed up')).toContainText('1 record edited since')
  await expect(card('Backed up')).toContainText('only you can confirm the file was kept')
  await expect(card('Shared with mentors')).toContainText('2 packs shared')
  await expect(card('Shared with mentors')).toContainText('1 with portal copies expired')
  await page.getByRole('button', { name: 'Review details' }).click()
  const table = page.getByRole('table', { name: 'Files and records' })
  const row = (name: string) => table.getByRole('row').filter({ hasText: name })
  await expect(row('obs.pdf')).toContainText('yes — generated')
  await expect(row('obs.pdf')).toContainText('“Autumn pack” v2')
  await expect(row('obs.pdf')).toContainText('until 5 Nov 2026')
  await expect(row('spare.pdf')).toContainText('no generated backup contains it')
  await expect(row('spare.pdf')).toContainText('not shared')
  await expect(row('old.pdf')).toContainText('missing on this device')
  await expect(row('old.pdf')).toContainText('expired 6 Sept 2026')
  await expect(row('receipt (Turnitin)')).toContainText('missing on this device')
  await expect(row('receipt (Turnitin)')).toContainText('submission receipt “Assignment 1”')
  // Relink the receipt to a file that is here: the record's uid changes, nothing else does.
  const missing = page.getByRole('list', { name: 'Missing files' })
  await expect(missing.getByRole('listitem')).toHaveCount(2)
  await missing.getByRole('combobox', { name: 'Relink: receipt (Turnitin)' }).selectOption('u-spare')
  await missing.getByRole('listitem').filter({ hasText: 'receipt (Turnitin)' }).getByRole('button', { name: 'Relink' }).click()
  await expect(missing.getByRole('listitem')).toHaveCount(1)
  const a = await adminOf(page)
  expect(a.projects[0].submissions[0].receiptUid).toBe('u-spare')
  expect(a.reviewPacks[0].attachments[0].uid).toBe('u-obs')
  await expect(row('spare.pdf')).toContainText('submission receipt “Assignment 1”')
  // Shared packs name their portal expiry from the acknowledged share time.
  const shared = page.getByRole('list', { name: 'Shared packs' })
  await expect(shared.getByRole('listitem').filter({ hasText: 'Old pack' })).toContainText('portal copies expired 6 Sept 2026')
  await expect(shared.getByRole('listitem').filter({ hasText: 'Autumn pack' })).toContainText('portal copies until 5 Nov 2026')
  // The recovery guide names what exists and how to get it back, and carries no secret.
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download recovery guide' }).click()
  const download = await downloadPromise
  const text = fs.readFileSync((await download.path())!, 'utf8')
  expect(text).toContain('RECOVERY GUIDE')
  expect(text).toContain('Sync between devices is ON')
  expect(text).toContain('2 review packs currently shared')
  expect(text).not.toContain(OWNER_TOKEN)
  expect(text).not.toContain(SYNC_CODE)
  expect(text).not.toContain('abcdef123456')
})

test('E05: a records-only generation never claims files; a restore preview names referenced files the backup does not carry', async ({ page }) => {
  await seed(page, { files: false })
  await page.goto('./#/today')
  await seedWallet(page, [{ uid: 'u-obs', name: 'obs.pdf' }])
  await page.goto('./#/settings/data')
  const cards = page.getByRole('list', { name: 'Data and sharing status' })
  await expect(cards.getByRole('listitem').filter({ hasText: 'Backed up' })).toContainText('records only, no files')
  await page.getByRole('button', { name: 'Review details' }).click()
  await expect(page.getByRole('table', { name: 'Files and records' }).getByRole('row').filter({ hasText: 'obs.pdf' })).toContainText('no generated backup contains it')
  // A backup whose records refer to a file it does not carry — and this device does not have — is named before anything changes.
  const backup = {
    version: 4,
    exportedAt: new Date(NOW - day).toISOString(),
    store: { activeId: 'fx', profiles: [{ id: 'fx', name: 'My timetable', settings: { demo: false, sheetId: 'FIXTURESHEET-FIXTURESHEET-FIXTURESHEET-0001', gid: null } }] },
    meta: { fx: {} },
    admin: { fx: { ...admin(), projects: [{ id: 'p9', title: 'Enquiry', status: 'submitted', submissions: [{ id: 's9', submittedAt: 1, channel: 'Email', receiptUid: 'u-ghost' }], at: 1 }] } },
    cache: {},
    changes: {},
    photos: [],
    wallet: [],
  }
  await page.getByRole('button', { name: 'Restore from backup…' }).click()
  await page.locator('input[type="file"][accept*="json"]').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) })
  const sheet = page.getByRole('dialog', { name: 'Restore backup' })
  const impact = sheet.getByRole('list', { name: 'What restoring will do' })
  // pk2's old.pdf and the ghost receipt are referenced by the backup's records; obs.pdf is here.
  await expect(impact).toContainText('2 referenced files are in neither this backup nor this device')
  await expect(sheet.getByRole('button', { name: 'Restore', exact: true })).toBeEnabled()
  await sheet.getByRole('button', { name: 'Cancel' }).click()
  const a = await adminOf(page)
  expect(a.projects).toHaveLength(1)
})

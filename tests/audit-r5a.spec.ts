import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

/**
 * R5a regressions (Pass 54a): data-health centre with truthful states
 * (NF-05), scoped + passphrase-sealed backup with preview and a restore
 * flow that fails closed (NF-05 envelope), evidence review queue and binder
 * selections with an exact-output preview (NF-08). Synthetic profiles;
 * every network host is blocked.
 */

const DEMO = { demo: true, sheetId: '', gid: null, specialismsChosen: true, checklistDismissed: true, usagePing: false }
const EMPTY_ADMIN = { reflections: [], targets: [], observations: [], lessons: [], audits: [], tasks: [], exceptions: [], plans: [], commitments: [], meetings: [] }

type Seed = {
  profiles: { id: string; name: string; settings: Record<string, unknown> }[]
  admin?: Record<string, Record<string, unknown>>
  meta?: Record<string, Record<string, unknown>>
  extra?: Record<string, string>
  noStorageEstimate?: boolean
}

async function seed(page: Page, { profiles, admin = {}, meta = {}, extra = {}, noStorageEstimate = false }: Seed) {
  await page.clock.install({ time: new Date('2026-09-07T07:05:00Z') })
  await page.addInitScript(
    ({ profiles, admin, meta, extra, noStorageEstimate }) => {
      localStorage.setItem('timetable.whatsnew.v1', '99')
      if (noStorageEstimate) Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true })
      if (localStorage.getItem('timetable.store.v2')) return
      localStorage.setItem('timetable.store.v2', JSON.stringify({ activeId: profiles[0].id, profiles }))
      for (const [id, file] of Object.entries(admin)) localStorage.setItem(`timetable.admin.v1.${id}`, JSON.stringify(file))
      for (const [id, m] of Object.entries(meta)) localStorage.setItem(`timetable.meta.v2.${id}`, JSON.stringify(m))
      for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, v)
    },
    { profiles, admin, meta, extra, noStorageEstimate }
  )
  await page.setViewportSize({ width: 390, height: 900 })
}

const ENGLISH = '2026-09-07|11:30|english 1'
const MATHS = '2026-09-07|14:30|maths 1'

test('NF-08: review queue lists untagged, uncaptioned and flagged records; selections preview exactly what a binder will contain and never delete evidence', async ({ page }) => {
  await seed(page, {
    profiles: [{ id: 'a', name: 'Profile A', settings: DEMO }],
    admin: { a: { ...EMPTY_ADMIN, reflections: [{ id: 'r1', weekISO: '2026-08-31', wentWell: 'Phonics carousel worked', challenges: '', focus: '', standards: ['TS3'], at: 1 }] } },
    meta: {
      a: {
        [ENGLISH]: { note: 'Untagged note about questioning', at: 1 },
        [MATHS]: { note: 'Tagged maths note', standards: ['TS1'], photos: 1, reviewLater: true, at: 1 },
      },
    },
  })
  await page.goto('./#/pgce')
  await page.getByRole('button', { name: 'Evidence journal' }).click()
  const journal = page.getByRole('dialog', { name: 'Evidence journal' })
  await expect(journal.locator('.journal-list li')).toHaveCount(3)
  // Queue = the untagged English note + the flagged Maths note; the tagged reflection is not in it.
  await journal.getByRole('button', { name: /^Review queue \(2\)/ }).click()
  await expect(journal.locator('.journal-list li')).toHaveCount(2)
  await expect(journal.getByText('Organisational only', { exact: false })).toBeVisible()
  await expect(journal.locator('.journal-list li', { hasText: 'English 1' })).toContainText('Untagged')
  await expect(journal.locator('.journal-list li', { hasText: 'Maths 1' })).toContainText('Review later')
  await expect(journal.locator('.journal-list li', { hasText: 'Maths 1' })).toContainText('1 elsewhere')
  // Flag/unflag writes only the review flag on the canonical record.
  await journal.locator('.journal-list li', { hasText: 'English 1' }).getByRole('button', { name: 'Review later' }).click()
  let meta = await page.evaluate(() => JSON.parse(localStorage.getItem('timetable.meta.v2.a')!))
  expect(meta[ENGLISH].reviewLater).toBe(true)
  expect(meta[ENGLISH].note).toBe('Untagged note about questioning')
  await journal.locator('.journal-list li', { hasText: 'Maths 1' }).getByRole('button', { name: 'Clear “Review later”' }).click()
  meta = await page.evaluate(() => JSON.parse(localStorage.getItem('timetable.meta.v2.a')!))
  expect(meta[MATHS].reviewLater).toBeUndefined()
  expect(meta[MATHS].standards).toEqual(['TS1'])
  // Maths left the queue once unflagged (organisational state, nothing deleted): leave the queue view to select both.
  await expect(journal.locator('.journal-list li')).toHaveCount(1)
  await journal.getByRole('button', { name: /^Review queue \(1\)/ }).click()
  await expect(journal.locator('.journal-list li')).toHaveCount(3)
  // Select both for the binder: the preview states the exact contents, distinguishing unavailable photos from none.
  await journal.getByRole('checkbox', { name: 'Select “English 1” for the binder' }).check()
  await journal.getByRole('checkbox', { name: 'Select “Maths 1” for the binder' }).check()
  await expect(journal.getByText('2 selected for the binder')).toBeVisible()
  await journal.getByRole('button', { name: 'Binder from selection (2)' }).click()
  const preview = page.getByRole('dialog', { name: 'Binder preview' })
  await expect(preview.getByText(/From your selection: 2 records/)).toBeVisible()
  const contents = preview.getByRole('list', { name: 'Binder contents' })
  await expect(contents).toContainText('Evidence records2')
  await expect(contents).toContainText('1 unavailable on this device — labelled as missing in the output')
  await expect(preview.getByLabel('Include photo captions')).toBeChecked()
  await expect(preview.getByLabel('Include observer names on observation records')).toBeChecked()
  await expect(preview.getByText(/Wallet documents and home\/location details are never part of the binder/)).toBeVisible()
  await preview.getByRole('button', { name: 'Cancel' }).click()
  // Clearing the selection deletes nothing; generation never mutated a record.
  await journal.getByRole('button', { name: 'Clear selection' }).click()
  await expect(journal.locator('.journal-list li')).toHaveCount(3)
  meta = await page.evaluate(() => JSON.parse(localStorage.getItem('timetable.meta.v2.a')!))
  expect(meta[MATHS].note).toBe('Tagged maths note')
  expect(meta[MATHS].photos).toBe(1)
})

test('NF-05: the data-health centre shows separate truthful states, including an unavailable storage estimate and recoverable drafts', async ({ page }) => {
  const draft = { version: 1, profileId: 'a', recordKind: 'task', recordId: 'draft1', baseRevision: 0, savedAt: Date.now(), value: { title: 'Half-written task' } }
  await seed(page, {
    profiles: [{ id: 'a', name: 'Profile A', settings: DEMO }],
    extra: { 'timetable.draft.v1.task.draft1.a': JSON.stringify(draft), 'timetable.backup.v1': JSON.stringify({ lastBackupAt: Date.parse('2026-09-01T10:00:00Z') }) },
    noStorageEstimate: true,
  })
  await page.goto('./#/settings/data')
  const health = page.getByRole('list', { name: 'Data health' })
  await expect(health).toContainText('all changes written to this device')
  await expect(health).toContainText('off (this device only)')
  await expect(health).toContainText('0 photos, 0 documents on this device only — not part of sync')
  await expect(health).toContainText(/Last backup generated.*1 Sept.*only you can confirm the file was kept/)
  await expect(health).toContainText('1 unsaved draft kept on this device')
  await expect(health).toContainText('Storage estimate unavailable')
  await expect(page.getByText(/safely backed up/i)).toHaveCount(0)
})

test('NF-05: scoped export keeps owner ids, the passphrase envelope round-trips, a wrong passphrase fails closed, and restore previews before committing', async ({ page }) => {
  test.setTimeout(120_000)
  await seed(page, {
    profiles: [
      { id: 'a', name: 'Profile A', settings: DEMO },
      { id: 'b', name: 'Profile B', settings: DEMO },
    ],
    admin: {
      a: { ...EMPTY_ADMIN, tasks: [{ id: 't1', title: 'Only in A', dueISO: '2026-09-30', status: 'todo', at: 1 }] },
      b: { ...EMPTY_ADMIN, tasks: [{ id: 't2', title: 'Only in B', dueISO: '2026-09-30', status: 'todo', at: 1 }] },
    },
  })
  await page.goto('./#/settings/data')
  await page.getByRole('button', { name: 'Back up… (preview first)' }).click()
  const sheet = page.getByRole('dialog', { name: 'Back up' })
  const contents = sheet.getByRole('list', { name: 'Backup contents' })
  await expect(contents.getByRole('listitem')).toHaveCount(2)
  await sheet.getByRole('button', { name: /^Only “Profile A”/ }).click()
  await expect(contents.getByRole('listitem')).toHaveCount(1)
  await expect(contents).toContainText('Profile A')
  await expect(contents).toContainText('1 PGCE/task record')
  // Plain scoped backup: only profile A, owner ids intact, honest status.
  const plainDownload = page.waitForEvent('download')
  await sheet.getByRole('button', { name: 'Generate backup' }).click()
  const plainPath = await (await plainDownload).path()
  const plain = JSON.parse(readFileSync(plainPath!, 'utf8'))
  expect(plain.store.profiles.map((p: { id: string }) => p.id)).toEqual(['a'])
  expect(plain.store.activeId).toBe('a')
  expect(Object.keys(plain.admin)).toEqual(['a'])
  await expect(sheet.getByText(/Backup generated: my-timetable-backup-2026-09-07-Profile_A\.json/)).toBeVisible()
  await expect(sheet.getByText(/only safe once you can see the file where you saved it/)).toBeVisible()
  await expect(page.getByText(/safely backed up/i)).toHaveCount(0)
  // Encrypted: policy first, then a sealed envelope that never contains the plain text.
  await sheet.getByLabel('Encrypt with a passphrase (portable encrypted backup)').check()
  await sheet.getByLabel('Passphrase', { exact: true }).fill('short')
  await sheet.getByLabel('Repeat passphrase').fill('short')
  await sheet.getByRole('button', { name: 'Generate again' }).click()
  await expect(sheet.getByRole('alert')).toContainText('at least 12 characters')
  await sheet.getByLabel('Passphrase', { exact: true }).fill('correct horse battery staple')
  await sheet.getByLabel('Repeat passphrase').fill('correct horse battery staple')
  const encDownload = page.waitForEvent('download')
  await sheet.getByRole('button', { name: 'Generate again' }).click()
  const encPath = await (await encDownload).path()
  const sealedText = readFileSync(encPath!, 'utf8')
  const sealed = JSON.parse(sealedText)
  expect(sealed.format).toBe('my-timetable-encrypted-backup')
  expect(sealed.version).toBe(1)
  expect(sealed.kdf.iterations).toBe(600000)
  expect(sealedText).not.toContain('Only in A')
  await expect(sheet.getByText(/encrypted\. It is only safe once/)).toBeVisible()
  await sheet.getByRole('button', { name: 'Done' }).click()

  // Change profile A locally, then restore the sealed file: wrong passphrase changes nothing.
  await page.evaluate(() => {
    const admin = JSON.parse(localStorage.getItem('timetable.admin.v1.a')!)
    admin.tasks = []
    localStorage.setItem('timetable.admin.v1.a', JSON.stringify(admin))
  })
  await page.locator('#backup input[type="file"]').setInputFiles({ name: 'backup.encrypted.json', mimeType: 'application/json', buffer: Buffer.from(sealedText) })
  const restore = page.getByRole('dialog', { name: 'Restore backup' })
  await expect(restore.getByText(/This backup is encrypted/)).toBeVisible()
  await restore.getByLabel('Passphrase').fill('wrong passphrase 123')
  await restore.getByRole('button', { name: 'Unlock' }).click()
  await expect(restore.getByRole('alert')).toContainText('either the passphrase is wrong or the file is corrupt. Nothing on this device changed.')
  expect((await page.evaluate(() => JSON.parse(localStorage.getItem('timetable.admin.v1.a')!))).tasks).toEqual([])
  // Right passphrase: preview first, then Restore; profile B is untouched.
  await restore.getByLabel('Passphrase').fill('correct horse battery staple')
  await restore.getByRole('button', { name: 'Unlock' }).click()
  const restoreContents = restore.getByRole('list', { name: 'Backup contents' })
  await expect(restoreContents.getByRole('listitem')).toHaveCount(1)
  await expect(restoreContents).toContainText('Profile A')
  await expect(restore.getByText(/other timetables on this device stay as they are/)).toBeVisible()
  // Restore commits through the recovery journal and reloads the app: wait for
  // that navigation to finish before reading storage (a poll during the reload
  // races the destroyed execution context).
  const reloaded = page.waitForEvent('load')
  await restore.getByRole('button', { name: 'Restore', exact: true }).click()
  await reloaded
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  expect((await page.evaluate(() => JSON.parse(localStorage.getItem('timetable.admin.v1.a')!))).tasks.map((t: { title: string }) => t.title)).toEqual(['Only in A'])
  const b = await page.evaluate(() => JSON.parse(localStorage.getItem('timetable.admin.v1.b')!))
  expect(b.tasks.map((t: { title: string }) => t.title)).toEqual(['Only in B'])
  const store = await page.evaluate(() => JSON.parse(localStorage.getItem('timetable.store.v2')!))
  expect(store.profiles.map((p: { id: string }) => p.id).sort()).toEqual(['a', 'b'])
})

test('NF-08: a session detail can flag a record for review; the flag survives with the note', async ({ page }) => {
  await seed(page, {
    profiles: [{ id: 'a', name: 'Profile A', settings: DEMO }],
    meta: { a: { [ENGLISH]: { note: 'Keep me', at: 1 } } },
  })
  await page.goto('./#/schedule')
  await page.locator('.day-list .session-card', { hasText: 'English 1' }).click()
  await expect(page.locator('.detail-page')).toBeVisible()
  await page.getByRole('button', { name: 'Review later' }).click()
  await expect(page.getByRole('button', { name: '✓ Flagged: review later' })).toHaveAttribute('aria-pressed', 'true')
  const meta = await page.evaluate(() => JSON.parse(localStorage.getItem('timetable.meta.v2.a')!))
  expect(meta[ENGLISH].reviewLater).toBe(true)
  expect(meta[ENGLISH].note).toBe('Keep me')
})

test('attendance percentage is shown again, always next to its honest denominator (Settings and Term stats)', async ({ page }) => {
  await seed(page, { profiles: [{ id: 'a', name: 'Profile A', settings: DEMO }] })
  await page.goto('./#/settings/data')
  // V3: the analysis relocated to Term stats; Data & devices keeps a one-tap link to it.
  await expect(page.locator('#attendance-analysis')).toContainText('now live in Term stats')
  await expect(page.locator('#data-health').getByText(/^\d+%$/)).toHaveCount(0)
  await page.getByRole('button', { name: 'Term stats' }).click()
  const stats = page.getByRole('dialog')
  await expect(stats.getByText(/^\d+%$/).first()).toBeVisible()
  await expect(stats.getByText(/attended — \d+ of \d+ eligible completed sessions/).first()).toBeVisible()
  await expect(stats.getByText(/\d+% attended — \d+ of \d+ eligible completed sessions; \d+ absent, \d+ unrecorded\./)).toBeVisible()
  await expect(stats.getByRole('list', { name: 'Attendance by subject' })).toBeVisible()
  await expect(stats.getByRole('button', { name: 'Export attendance CSV' })).toBeVisible()
})

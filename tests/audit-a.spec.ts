import { expect, test } from './fixtures'
import type { Page, Route } from '@playwright/test'

/**
 * Audit Batch A (Pass 77) — positive regression tests for B01, B03 and B04
 * (B02 is covered on the worker by tests/unit/mentor-store.test.mjs):
 *  - B01: editing state belongs to one pack; switching packs carries nothing,
 *         and a share body can only contain the current pack's own files;
 *  - B03: pack attachments resolve by stable wallet identity, a numeric id
 *         alone is "Missing — choose the original file", relink fixes it;
 *  - B04: the session detail, the Schedule school-day card and Today read the
 *         canonical placement setup; editing SE2's school changes only SE2.
 */

test.use({ timezoneId: 'Europe/London' })

const session = (id: string, title: string, dateISO: string, day: string) => ({ id, title, day, dateISO, start: '08:30', end: '15:30', room: '', groups: '', tutor: '', subject: '', isSpecialism: false, isSelfStudy: false, isOptional: false })
const SESSIONS = [session('a1', 'School Experience SE1a', '2026-09-14', 'Mon'), session('c1', 'School Experience SE2', '2026-09-15', 'Tue'), session('d1', 'School Experience SE3', '2026-09-16', 'Wed')]
const base = () => ({
  reflections: [], targets: [], meetings: [], observations: [], audits: [], tasks: [], exceptions: [], plans: [], commitments: [], programmes: [], packs: [], requirements: [], milestones: [], cycles: [], preps: [], goals: [], resources: [], projects: [], readings: [], contacts: [], questions: [], protected: [], supportNotes: [], examples: [], experience: [], reviews: [],
  lessons: [{ id: 'l1', dateISO: '2026-09-14', classGroup: 'Y2', subject: 'Maths — number bonds', evaluation: 'Went well', standards: ['TS4'], at: 10 }],
  placements: [
    { id: 'pl-se1', code: 'SE1', schoolLocationId: 'sch-1', startISO: '2026-09-07', endISO: '2026-12-11', mappedBlockTags: ['SE1A'], mentorName: 'A Mentor', at: 10 },
    { id: 'pl-se2', code: 'SE2', schoolLocationId: 'sch-2', startISO: '2027-02-01', endISO: '2027-03-26', mappedBlockTags: ['SE2'], mentorName: 'B Mentor', at: 10 },
    { id: 'pl-se3', code: 'SE3', schoolLocationId: 'sch-3', mappedBlockTags: ['SE3'], at: 10 },
  ],
  schools: [
    { id: 'sch-1', name: 'Riverside Primary', address: '1 River Lane', lat: 51.53, lng: -0.11, confirmedAt: 5, at: 10 },
    { id: 'sch-2', name: 'Meadow Park Primary', address: '4 Meadow Way', lat: 51.52, lng: -0.09, confirmedAt: 5, at: 10 },
    { id: 'sch-3', name: 'Hillside Academy', address: '9 Hill Road', at: 10 },
  ],
  reviewPacks: [
    { id: 'kA', title: 'Pack A', state: 'draft', createdISO: '2026-09-14', items: [], attachments: [], at: 1 },
    { id: 'kB', title: 'Pack B', state: 'draft', createdISO: '2026-09-14', items: [], attachments: [], at: 1 },
  ],
})

async function seed(page: Page, admin: Record<string, unknown> = base(), settings: Record<string, unknown> = {}) {
  await page.clock.install({ time: new Date('2026-09-14T06:05:00Z') })
  await page.addInitScript(
    ({ SESSIONS, admin, settings }) => {
      localStorage.setItem('timetable.whatsnew.v1', '99')
      if (localStorage.getItem('timetable.store.v2')) return
      localStorage.setItem('timetable.store.v2', JSON.stringify({ activeId: 'fx', profiles: [{ id: 'fx', name: 'My timetable', settings: { demo: false, sheetId: 'FIXTURESHEET-FIXTURESHEET-FIXTURESHEET-0001', gid: null, specialismsChosen: true, checklistDismissed: true, usagePing: false, ...settings } }] }))
      localStorage.setItem('timetable.cache.v2.fx', JSON.stringify({ fetchedAt: Date.now(), sessions: SESSIONS }))
      localStorage.setItem('timetable.admin.v1.fx', JSON.stringify(admin))
    },
    { SESSIONS, admin, settings }
  )
  await page.setViewportSize({ width: 390, height: 844 })
}
const admin = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('timetable.admin.v1.fx') ?? '{}'))

/** Put two files in the wallet through the app's own IndexedDB store, returning their stable uids. */
async function addWalletFiles(page: Page) {
  await page.goto('./#/today')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('timetable-wallet', 1)
      req.onupgradeneeded = () => { const st = req.result.createObjectStore('files', { keyPath: 'id', autoIncrement: true }); st.createIndex('owner', 'owner') }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const put = (name: string, text: string) => new Promise<{ uid: string; name: string }>((resolve, reject) => {
      const uid = crypto.randomUUID()
      const tx = db.transaction('files', 'readwrite')
      tx.objectStore('files').add({ uid, owner: 'fx', blob: new Blob([text], { type: 'text/plain' }), at: Date.now(), name, type: 'text/plain', size: text.length })
      tx.oncomplete = () => resolve({ uid, name })
      tx.onerror = () => reject(tx.error)
    })
    const a = await put('Private A.txt', 'Private A bytes')
    const b = await put('Private B.txt', 'Private B bytes')
    db.close()
    return [a, b]
  })
}

test('B01 + B03: a share can only carry the current pack’s own resolved files; picks and recipients never cross packs; a numeric-only reference is missing until relinked', async ({ page, context }) => {
  const sent: Record<string, unknown>[] = []
  await context.route('**/mentor/**', (route: Route) => {
    const path = new URL(route.request().url()).pathname
    const body = route.request().postDataJSON() as Record<string, unknown>
    if (path === '/mentor/mentors') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ mentors: [{ id: 'mt0123456789ab', name: 'Synthetic mentor', createdAt: 1, revokedAt: null, lastSeenAt: null }], packs: [], invites: [] }) })
    if (path === '/mentor/share') { sent.push(body); return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, packId: body.packId, revision: body.revision, sharedAt: 1, attachments: (body.attachments as unknown[]).length }) }) }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })
  await seed(page, base(), { mentorSpaceId: 'a'.repeat(24), mentorOwnerToken: 'b'.repeat(48) })
  const wallet = await addWalletFiles(page)
  expect(wallet.every((w) => typeof w.uid === 'string' && w.uid.length > 10)).toBe(true)
  // Pack A takes Private A (by stable uid); a lesson is picked but NOT pinned; a mentor is ticked.
  await page.goto('./#/pgce')
  await page.getByRole('button', { name: /^Review packs/ }).click()
  const sheet = page.getByRole('dialog', { name: 'Review packs' })
  await sheet.getByRole('button', { name: /Pack A/ }).click()
  await sheet.getByRole('list', { name: 'Attachments', exact: true }).getByRole('checkbox', { name: /^Private A\.txt/ }).check()
  await sheet.getByRole('checkbox', { name: /Lesson · .*number bonds/ }).check()
  // Pass 79 (U02): recipients and the pack's own files live in the People step.
  await sheet.getByRole('tab', { name: 'People' }).click()
  await sheet.getByRole('checkbox', { name: 'Synthetic mentor' }).check()
  await sheet.getByRole('list', { name: 'Attachments to share' }).getByRole('checkbox', { name: /^Private A\.txt/ }).check()
  let file = await admin(page)
  const aRef = file.reviewPacks.find((p: { id: string }) => p.id === 'kA').attachments[0]
  expect(aRef.uid).toBe(wallet[0].uid)
  expect(aRef.id).toBe('')
  // Switch to Pack B: nothing carried over — no pick, no recipient, no file, and Pin adds nothing to A.
  await sheet.getByRole('button', { name: /Pack B/ }).click()
  await expect(sheet.getByRole('tab', { name: 'Content' })).toHaveAttribute('aria-selected', 'true')
  await expect(sheet.getByRole('checkbox', { name: /Lesson · .*number bonds/ })).not.toBeChecked()
  await expect(sheet.getByRole('button', { name: /Pin selection \(0\)/ })).toBeDisabled()
  await sheet.getByRole('tab', { name: 'People' }).click()
  await expect(sheet.getByRole('checkbox', { name: 'Synthetic mentor' })).not.toBeChecked()
  await expect(sheet.getByRole('list', { name: 'Attachments to share' })).toHaveCount(0)
  await sheet.getByRole('checkbox', { name: 'Synthetic mentor' }).check()
  await sheet.getByRole('button', { name: 'Review share' }).click()
  await expect(sheet.getByLabel('Check and share')).toContainText('Version 1 to 1 mentor (Synthetic mentor), 0 files')
  await sheet.getByRole('button', { name: 'Share this version' }).click()
  await expect(sheet.getByRole('status')).toContainText('Shared version 1')
  expect(sent).toHaveLength(1)
  expect((sent[0].pack as { id: string }).id).toBe('kB')
  expect(sent[0].attachments).toEqual([])
  expect(sent[0].revision).toBe(1)
  file = await admin(page)
  expect(file.reviewPacks.find((p: { id: string }) => p.id === 'kA').items).toHaveLength(0)
  expect(file.reviewPacks.find((p: { id: string }) => p.id === 'kB').sharing).toMatchObject({ revision: 1, mentorIds: ['mt0123456789ab'], attachmentUids: [] })
  // Back to Pack A: its own draft is still there; sharing sends exactly its file under the stable-uid-derived id.
  await sheet.getByRole('button', { name: /Pack A/ }).click()
  await expect(sheet.getByRole('checkbox', { name: 'Synthetic mentor' })).toBeChecked()
  await sheet.getByRole('button', { name: 'Review share' }).click()
  await expect(sheet.getByLabel('Check and share')).toContainText('Files added: Private A.txt')
  await sheet.getByRole('button', { name: 'Share this version' }).click()
  await expect(sheet.getByRole('status')).toContainText('and 1 file')
  const shareA = sent[1]
  expect((shareA.pack as { id: string }).id).toBe('kA')
  const att = (shareA.attachments as { id: string; name: string; data: string; key: string }[])
  expect(att).toHaveLength(1)
  expect(att[0].name).toBe('Private A.txt')
  expect(att[0].id).toMatch(/^[0-9a-f]{32}$/)
  expect(att[0].data).not.toContain('Private A bytes')
  // B03: a legacy reference by numeric id alone is missing until relinked; then it resolves by uid.
  await sheet.getByRole('button', { name: 'Close' }).click()
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('timetable.admin.v1.fx')!)
    raw.reviewPacks[1].attachments = [{ id: '1', name: 'Private A.txt', state: 'local-only' }]
    localStorage.setItem('timetable.admin.v1.fx', JSON.stringify(raw))
  })
  // Pass 79 (U05): closing the packs goes Back to the landing; reopening is by its URL.
  await expect(page).toHaveURL(/#\/pgce$/)
  await page.reload()
  await page.getByRole('button', { name: /^Review packs/ }).click()
  await sheet.getByRole('button', { name: /Pack B/ }).click()
  const legacyRow = sheet.getByRole('list', { name: 'Attachments', exact: true }).getByRole('listitem').filter({ hasText: 'Missing — choose the original file' })
  await expect(legacyRow).toHaveCount(1)
  await sheet.getByRole('tab', { name: 'People' }).click()
  await expect(sheet.getByRole('list', { name: 'Attachments to share' })).toHaveCount(0)
  await sheet.getByRole('tab', { name: 'Content' }).click()
  await legacyRow.getByRole('combobox', { name: /Relink/ }).selectOption({ label: 'Private B.txt (1 KB)' })
  await legacyRow.getByRole('button', { name: 'Relink' }).click()
  file = await admin(page)
  expect(file.reviewPacks.find((p: { id: string }) => p.id === 'kB').attachments[0]).toMatchObject({ uid: wallet[1].uid, name: 'Private B.txt' })
  await expect(sheet.getByRole('list', { name: 'Attachments', exact: true })).toContainText('On this device only')
})

test('B04: session detail, Schedule school-day card and Today read the canonical setup; editing SE2’s school changes SE2 everywhere and nothing in SE1/SE3', async ({ page, context }) => {
  await context.route('**/api.postcodes.io/**', (route: Route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 200, result: { latitude: 51.5, longitude: -0.12 } }) }))
  // A stale legacy entry for SE2 must NOT win over the canonical record; SE3 (no pin) keeps its canonical name.
  await seed(page, base(), { placements: { SE2: { school: 'Old Name Primary', lat: 1, lng: 1 } } })
  await page.goto('./#/schedule')
  await page.getByRole('option', { name: /Tuesday 15 September/ }).click()
  await expect(page.locator('.placement-day')).toContainText('Meadow Park Primary')
  await page.locator('.placement-day').click()
  const details = page.getByLabel('Placement details')
  await expect(details).toContainText('Meadow Park Primary')
  await expect(details).toContainText('B Mentor')
  await expect(details).toContainText('From your placement setup')
  await expect(page.getByPlaceholder('School name')).toHaveCount(0)
  const before = await admin(page)
  // Edit SE2's school through the canonical flow from the session detail.
  await details.getByRole('button', { name: 'Edit placement setup' }).click()
  const flow = page.getByRole('dialog', { name: 'Set up SE2' })
  await flow.getByLabel('School name').fill('Meadow Park Academy')
  await flow.getByLabel('Address').fill('5 Meadow Way, E1 6AA')
  // The school already has a pin, so the control reads 'Locate again'; a new address needs a fresh confirmation.
  await flow.getByRole('button', { name: /Locate (on map|again)/ }).click()
  await flow.getByRole('button', { name: 'Confirm this pin' }).click()
  await flow.getByRole('button', { name: 'Next' }).click()
  await flow.getByRole('button', { name: 'Next' }).click()
  await flow.getByRole('button', { name: 'Next' }).click()
  await flow.getByRole('button', { name: 'Save placement' }).click()
  const after = await admin(page)
  expect(JSON.stringify(after.placements.filter((p: { code: string }) => p.code !== 'SE2'))).toBe(JSON.stringify(before.placements.filter((p: { code: string }) => p.code !== 'SE2')))
  expect(JSON.stringify(after.schools.filter((s: { id: string }) => s.id !== 'sch-2'))).toBe(JSON.stringify(before.schools.filter((s: { id: string }) => s.id !== 'sch-2')))
  expect(after.schools.find((s: { id: string }) => s.id === 'sch-2')).toMatchObject({ name: 'Meadow Park Academy', lat: 51.5, lng: -0.12 })
  // Every consumer follows: detail card, Schedule card, chooser, the travel tab's destination; the legacy map is untouched and ignored.
  await expect(details).toContainText('Meadow Park Academy')
  await page.getByRole('tab', { name: 'Travel & map' }).click()
  await expect(page.getByLabel('Travel and map')).toContainText('5 Meadow Way')
  await page.goto('./#/schedule')
  await page.getByRole('option', { name: /Tuesday 15 September/ }).click()
  await expect(page.locator('.placement-day')).toContainText('Meadow Park Academy')
  await page.getByRole('option', { name: /Monday 14 September/ }).click()
  await expect(page.locator('.placement-day')).toContainText('Riverside Primary')
  await page.goto('./#/placement')
  await expect(page.getByRole('list', { name: 'Your placements' })).toContainText('SE2 · Meadow Park Academy')
  const settings = await page.evaluate(() => JSON.parse(localStorage.getItem('timetable.store.v2')!).profiles[0].settings)
  expect(settings.placements.SE2.school).toBe('Old Name Primary')
  // A block no placement claims still shows its legacy details, marked as such, with a way to set it up.
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('timetable.store.v2')!)
    raw.profiles[0].settings.placements.SE3 = { school: 'Legacy Hill School' }
    localStorage.setItem('timetable.store.v2', JSON.stringify(raw))
    const a = JSON.parse(localStorage.getItem('timetable.admin.v1.fx')!)
    a.placements = a.placements.filter((p: { code: string }) => p.code !== 'SE3')
    localStorage.setItem('timetable.admin.v1.fx', JSON.stringify(a))
  })
  await page.reload()
  await page.goto('./#/schedule')
  await page.getByRole('option', { name: /Wednesday 16 September/ }).click()
  await expect(page.locator('.placement-day')).toContainText('Legacy Hill School')
  await page.locator('.placement-day').click()
  await expect(page.getByPlaceholder('School name')).toHaveValue('Legacy Hill School')
  await expect(page.getByText('From the timetable only — set up the placement to confirm the school and use it everywhere.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Set up placement' })).toBeVisible()
})

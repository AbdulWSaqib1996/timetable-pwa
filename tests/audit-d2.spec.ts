import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'

/**
 * Audit D2 (Pass 84) — E02 weekly review and E03 assignment workspace in the
 * browser: this week / next week / a diff of study blocks accepted as a batch,
 * accepted twice never duplicated, undone as one batch, recalculated and
 * labelled after a timetable change; an assignment whose deadline change adds
 * no pin, a versioned outline, drafts, a learner-recorded submission with a
 * receipt kept by its document identity (missing when the file goes), a
 * resubmission that appends, and tasks that stay open.
 */

test.use({ timezoneId: 'Europe/London' })

const session = (id: string, title: string, dateISO: string, day: string, start = '09:00', end = '15:00') => ({
  id, title, day, dateISO, start, end, room: '', groups: '', tutor: '', subject: '', isSpecialism: false, isSelfStudy: false, isOptional: false,
})
// Wednesday 16 September: next week is 21–27 September, with school Mon–Wed.
const SESSIONS = [session('n1', 'School Experience SE1a', '2026-09-21', 'Mon'), session('n2', 'School Experience SE1a', '2026-09-22', 'Tue'), session('n3', 'School Experience SE1a', '2026-09-23', 'Wed')]
const KEYDATES = [
  { ...session('kd1', 'Assignment 1 hand-in', '2026-11-20', 'Fri', '12:00', '12:00'), isKeyDate: true, sourceKey: 'keydates', sourceId: 'A1', eventKey: 'event:keydates:A1' },
  { ...session('kd2', 'Assignment 2 hand-in', '2026-12-04', 'Fri', '12:00', '12:00'), isKeyDate: true, sourceKey: 'keydates', sourceId: 'A2', eventKey: 'event:keydates:A2' },
]
const base = () => ({
  reflections: [], targets: [], meetings: [], observations: [], lessons: [], audits: [], exceptions: [], commitments: [], placements: [], schools: [], programmes: [], packs: [], requirements: [], milestones: [], cycles: [], preps: [], goals: [], resources: [], readings: [], contacts: [], questions: [], protected: [], supportNotes: [], examples: [], reviewPacks: [], experience: [], reviews: [], homework: [],
  tasks: [{ id: 't1', title: 'Essay', dueISO: '2026-09-30', status: 'todo', at: 1 }, { id: 'm1', title: 'Outline done', dueISO: '2026-10-01', status: 'todo', projectId: 'p1', at: 1 }],
  plans: [{ id: 'a', parentId: 't1', kind: 'subtask', title: 'Outline', effortMins: 120, at: 1 }, { id: 'b', parentId: 't1', kind: 'subtask', title: 'Draft', effortMins: 120, at: 1 }],
  projects: [{ id: 'p1', title: 'Assignment 1 — Reflective account', status: 'draft', deadlineRef: 'event:keydates:A1', words: 3000, at: 1 }],
})

async function seed(page: Page, admin: Record<string, unknown> = base()) {
  await page.clock.install({ time: new Date('2026-09-16T06:05:00Z') })
  await page.addInitScript(
    ({ SESSIONS, KEYDATES, admin }) => {
      localStorage.setItem('timetable.whatsnew.v1', '99')
      if (localStorage.getItem('timetable.store.v2')) return
      localStorage.setItem('timetable.store.v2', JSON.stringify({ activeId: 'fx', profiles: [{ id: 'fx', name: 'My timetable', settings: { demo: false, sheetId: 'FIXTURESHEET-FIXTURESHEET-FIXTURESHEET-0001', gid: null, keyDatesSheetId: 'FIXTURESHEET-FIXTURESHEET-FIXTURESHEET-0001', keyDatesGid: '7', specialismsChosen: true, checklistDismissed: true, usagePing: false, arrivalBufferMins: 20 } }] }))
      localStorage.setItem('timetable.cache.v2.fx', JSON.stringify({ fetchedAt: Date.now(), sessions: SESSIONS, keyDates: KEYDATES }))
      localStorage.setItem('timetable.admin.v1.fx', JSON.stringify(admin))
    },
    { SESSIONS, KEYDATES, admin }
  )
  await page.setViewportSize({ width: 390, height: 844 })
}
const admin = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('timetable.admin.v1.fx') ?? '{}'))
async function openMenu(page: Page, item: RegExp | string) {
  await page.goto('./#/pgce')
  await page.getByRole('button', { name: item }).click()
}
/** Put one document in the wallet with a known stable identity, the way a backup restore would. */
const seedWallet = (page: Page, uid: string, name: string) =>
  page.evaluate(
    ({ uid, name }) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('timetable-wallet', 1)
        req.onupgradeneeded = () => {
          const s = req.result.createObjectStore('files', { keyPath: 'id', autoIncrement: true })
          s.createIndex('owner', 'owner')
        }
        req.onsuccess = () => {
          const tx = req.result.transaction('files', 'readwrite')
          tx.objectStore('files').put({ owner: 'fx', name, type: 'application/pdf', size: 3, blob: new Blob(['abc'], { type: 'application/pdf' }), at: Date.now(), uid })
          tx.oncomplete = () => { req.result.close(); resolve() }
          tx.onerror = () => reject(tx.error)
        }
        req.onerror = () => reject(req.error)
      }),
    { uid, name }
  )
const clearWallet = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('timetable-wallet', 1)
        req.onsuccess = () => {
          const tx = req.result.transaction('files', 'readwrite')
          tx.objectStore('files').clear()
          tx.oncomplete = () => { req.result.close(); resolve() }
          tx.onerror = () => reject(tx.error)
        }
        req.onerror = () => reject(req.error)
      })
  )

test('E02: weekly review — fixed time names placement travel, changes accepted as a batch, never twice, undone as one batch, recalculated after a timetable change', async ({ page }) => {
  await seed(page)
  await openMenu(page, 'Workload & support')
  const sheet = page.getByRole('dialog', { name: 'Workload & support' })
  await sheet.getByRole('tab', { name: 'Weekly review' }).click()
  await expect(sheet.getByLabel('This week')).toContainText('2 tasks')
  await expect(sheet.getByLabel('This week')).toContainText('0 m in 0 blocks')
  const fixed = sheet.getByRole('list', { name: 'Fixed commitments next week' })
  await expect(fixed).toContainText('Travel to school (assumed 20 min)')
  await expect(fixed).toContainText('School Experience SE1a')
  const changes = sheet.getByRole('list', { name: 'Proposed changes' })
  const proposed = await changes.getByRole('listitem').count()
  expect(proposed).toBeGreaterThan(0)
  await expect(changes.locator('[data-kind="added"]')).toHaveCount(proposed)
  await expect(sheet).toContainText(/Essay/)
  // Untick one, accept the rest as a batch.
  await changes.getByRole('checkbox').last().uncheck()
  await sheet.getByRole('button', { name: new RegExp(`Accept ${proposed - 1} of ${proposed} change`) }).click()
  let file = await admin(page)
  const blocks = file.plans.filter((p: { kind: string }) => p.kind === 'block')
  expect(blocks).toHaveLength(proposed - 1)
  for (const b of blocks) expect(b.dateISO >= '2026-09-21' && b.dateISO <= '2026-09-27').toBe(true)
  expect(file.weeklyReviews).toHaveLength(1)
  expect(file.weeklyReviews[0].batches).toHaveLength(1)
  expect(file.weeklyReviews[0].weekISO).toBe('2026-09-14')
  // The accepted ones are now untouched; only the one left out remains actionable — accepting again adds nothing twice.
  await expect(changes.locator('[data-kind="untouched"]')).toHaveCount(proposed - 1)
  await expect(sheet.getByRole('button', { name: /Accept 1 of 1 change/ })).toBeVisible()
  await sheet.getByRole('button', { name: /Accept 1 of 1 change/ }).click()
  file = await admin(page)
  expect(file.plans.filter((p: { kind: string }) => p.kind === 'block')).toHaveLength(proposed)
  await expect(sheet.getByRole('button', { name: /Accept 0 of 0 change/ })).toBeDisabled()
  // Undo reverses only the last batch (the single block), leaving the first batch in place.
  await sheet.getByRole('button', { name: 'Undo last accepted batch (1)' }).click()
  file = await admin(page)
  expect(file.plans.filter((p: { kind: string }) => p.kind === 'block')).toHaveLength(proposed - 1)
  expect(file.weeklyReviews[0].batches).toHaveLength(1)
  // The reflection is the learner's, saved on blur.
  await sheet.getByLabel('Weekly reflection').fill('Too much on Tuesday')
  await sheet.getByLabel('Weekly reflection').blur()
  file = await admin(page)
  expect(file.weeklyReviews[0].reflection).toBe('Too much on Tuesday')
  // A timetable change (a new session next week) is a different basis: the review says so and the diff is recalculated.
  await sheet.getByRole('button', { name: 'Close' }).click()
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('timetable.cache.v2.fx')!)
    raw.sessions.push({ id: 'n4', title: 'Maths 1', day: 'Thu', dateISO: '2026-09-24', start: '09:00', end: '17:00', room: 'B12', groups: '', tutor: '', subject: '', isSpecialism: false, isSelfStudy: false, isOptional: false })
    localStorage.setItem('timetable.cache.v2.fx', JSON.stringify(raw))
  })
  await page.reload()
  await openMenu(page, 'Workload & support')
  await sheet.getByRole('tab', { name: 'Weekly review' }).click()
  await expect(sheet.getByRole('status')).toContainText('Your timetable or commitments changed since you last accepted proposals')
  await expect(fixed).toContainText('Maths 1')
  await expect(sheet).not.toContainText(/wellbeing score|QTS score|streak/i)
})

test('E03: assignment workspace — deadline change adds no pin, versioned outline, drafts, a learner-recorded submission with a receipt by uid, resubmission history, tasks untouched', async ({ page }) => {
  await seed(page)
  await page.goto('./#/today')
  await seedWallet(page, 'uid-receipt-1', 'turnitin-receipt.pdf')
  await openMenu(page, /^Academic work/)
  const sheet = page.getByRole('dialog', { name: 'Academic work' })
  const summary = sheet.getByLabel('Assignment summary')
  await expect(summary).toContainText('20 Nov 2026 12:00 · Assignment 1 hand-in (from your key dates)')
  await expect(summary).toContainText('3000 target (yours)')
  await expect(summary).toContainText('Outline done · due 1 Oct 2026')
  // Change the deadline to the other key date: the summary follows; the Schedule keeps exactly one pin per key date.
  await sheet.getByRole('combobox', { name: 'Change deadline' }).selectOption('event:keydates:A2')
  await expect(summary).toContainText('4 Dec 2026 12:00 · Assignment 2 hand-in')
  let file = await admin(page)
  expect(file.projects[0].deadlineRef).toBe('event:keydates:A2')
  expect(file.tasks).toHaveLength(2)
  // Outline: versioned.
  await sheet.getByLabel('Outline section').fill('Introduction')
  await sheet.getByRole('button', { name: 'Add section' }).click()
  await sheet.getByLabel('Outline section').fill('Analysis')
  await sheet.getByRole('button', { name: 'Add section' }).click()
  await sheet.getByRole('checkbox', { name: 'Section drafted: Introduction' }).check()
  await expect(sheet).toContainText('revision 3')
  await expect(summary).toContainText('Stage')
  // A draft by link, and a draft by wallet document.
  await sheet.getByRole('combobox', { name: 'Draft kind' }).selectOption('link')
  await sheet.getByLabel('Draft link').fill('https://docs.example/draft-1')
  await sheet.getByLabel('Draft label').fill('Draft 1')
  await sheet.getByRole('button', { name: 'Add draft' }).click()
  await sheet.getByRole('combobox', { name: 'Draft kind' }).selectOption('wallet')
  await sheet.getByRole('combobox', { name: 'Draft document' }).selectOption('uid-receipt-1')
  await sheet.getByLabel('Draft label').fill('Draft 2 (file)')
  await sheet.getByRole('button', { name: 'Add draft' }).click()
  await expect(sheet.getByRole('list', { name: 'Drafts' })).toContainText('In your wallet')
  // Record a submission with the receipt: learner-recorded, status follows, tasks stay open.
  await sheet.getByRole('combobox', { name: 'Submission channel' }).selectOption('Turnitin')
  await sheet.getByRole('combobox', { name: 'Receipt document' }).selectOption('uid-receipt-1')
  await sheet.getByLabel('Submission note').fill('ref 4471')
  await expect(sheet.getByRole('button', { name: 'Record submission' })).toBeDisabled()
  await sheet.getByLabel('I made this submission myself').check()
  await sheet.getByRole('button', { name: 'Record submission' }).click()
  const history = sheet.getByRole('list', { name: 'Submission history' })
  await expect(history).toContainText('Submitted')
  await expect(history).toContainText('Turnitin · ref 4471')
  await expect(history).toContainText('receipt: turnitin-receipt.pdf')
  await expect(summary).toContainText('1 recorded by you — not institution-verified')
  file = await admin(page)
  expect(file.projects[0].status).toBe('submitted')
  expect(file.projects[0].submissions[0]).toMatchObject({ channel: 'Turnitin', receiptUid: 'uid-receipt-1', note: 'ref 4471' })
  expect(file.tasks.every((t: { status: string }) => t.status === 'todo')).toBe(true)
  // Resubmission appends rather than replacing.
  await sheet.getByLabel('Submission note').fill('resubmitted after feedback')
  await sheet.getByLabel('I made this submission myself').check()
  await sheet.getByRole('button', { name: 'Record resubmission' }).click()
  await expect(history.getByRole('listitem')).toHaveCount(2)
  await expect(history).toContainText('Resubmitted (2)')
  file = await admin(page)
  expect(file.projects[0].submissions).toHaveLength(2)
  expect(file.projects[0].submissions[0].receiptUid).toBe('uid-receipt-1')
  // Feedback reference and a source, in the learner's words.
  await sheet.getByLabel('Feedback reference text').fill('Deepen the analysis')
  await sheet.getByLabel('Feedback source').fill('tutor, 1 Dec')
  await sheet.getByRole('button', { name: 'Add feedback' }).click()
  await sheet.getByLabel('Source title').fill('Teaching reading')
  await sheet.getByLabel('Source author').fill('Author (2020)')
  await sheet.getByRole('button', { name: 'Add source' }).click()
  await expect(summary).toContainText('1 listed')
  await expect(sheet).not.toContainText(/generated citation/i)
  // The receipt file goes from this device: the record keeps its uid and the history says the file is missing.
  await sheet.getByRole('button', { name: 'Close' }).click()
  await clearWallet(page)
  await page.reload()
  await openMenu(page, /^Academic work/)
  await expect(sheet.getByRole('list', { name: 'Submission history' })).toContainText('receipt: missing on this device')
  file = await admin(page)
  expect(file.projects[0].submissions[0].receiptUid).toBe('uid-receipt-1')
})

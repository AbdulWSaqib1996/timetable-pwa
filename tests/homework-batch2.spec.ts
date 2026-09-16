import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'

/**
 * Placement review Batch 2 (Pass 87) — the homework lifecycle in the browser:
 * two same-title records stay separate (HW-01); a record is edited, rescheduled,
 * removed and restored on the same id (HW-02); a moved due session is a
 * question — Follow or Keep — never a split date (HW-03); session-only
 * homework keeps its source and due links, with a fallback when the source
 * leaves the timetable (HW-04); validation instead of truncation, a searchable
 * chooser, a kept due target, and a draft that survives a reload (HW-05).
 */

test.use({ timezoneId: 'Europe/London' })

const session = (id: string, title: string, dateISO: string, day: string, start: string, end: string, extra: Record<string, unknown> = {}) => ({
  id, title, day, dateISO, start, end, room: 'B12', groups: '1', tutor: 'A Tutor', subject: title, isSpecialism: false, isSelfStudy: false, isOptional: false, eventKey: `event:${id}`, ...extra,
})
const SESSIONS = [
  session('m1', 'Maths 1', '2026-09-15', 'Tue', '09:00', '11:00'),
  session('m2', 'Maths 2', '2026-09-22', 'Tue', '09:00', '11:00'),
  session('m3', 'Maths 3', '2026-09-29', 'Tue', '09:00', '11:00'),
  session('e1', 'English 1', '2026-09-23', 'Wed', '13:00', '15:00', { tutor: 'Dr Lee' }),
  session('d1', 'Portfolio submission', '2026-09-24', 'Thu', '08:00', '08:00'),
]
const base = () => ({
  reflections: [], targets: [], meetings: [], observations: [], audits: [], exceptions: [], plans: [], commitments: [], placements: [], schools: [], programmes: [], packs: [], requirements: [], milestones: [], cycles: [], preps: [], goals: [], resources: [], projects: [], readings: [], contacts: [], questions: [], protected: [], supportNotes: [], examples: [], reviewPacks: [], experience: [], reviews: [], homework: [], lessons: [], tasks: [],
})

async function seed(page: Page, admin: Record<string, unknown> = base(), meta: Record<string, unknown> = {}) {
  await page.clock.install({ time: new Date('2026-09-15T06:05:00Z') })
  await page.addInitScript(
    ({ SESSIONS, admin, meta }) => {
      localStorage.setItem('timetable.whatsnew.v1', '99')
      if (localStorage.getItem('timetable.store.v2')) return
      localStorage.setItem('timetable.store.v2', JSON.stringify({ activeId: 'fx', profiles: [{ id: 'fx', name: 'My timetable', settings: { demo: false, sheetId: 'FIXTURESHEET-FIXTURESHEET-FIXTURESHEET-0001', gid: null, specialismsChosen: true, checklistDismissed: true, usagePing: false } }] }))
      localStorage.setItem('timetable.cache.v2.fx', JSON.stringify({ fetchedAt: Date.now(), sessions: SESSIONS }))
      localStorage.setItem('timetable.admin.v1.fx', JSON.stringify(admin))
      localStorage.setItem('timetable.meta.v2.fx', JSON.stringify(meta))
    },
    { SESSIONS, admin, meta }
  )
  await page.setViewportSize({ width: 390, height: 844 })
}
const admin = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('timetable.admin.v1.fx') ?? '{}'))
async function openSource(page: Page) {
  await page.goto('./#/schedule')
  await page.getByRole('option', { name: /Tuesday 15 September/ }).click()
  await page.locator('.day-list .session-card').filter({ hasText: 'Maths 1' }).click()
  return page.getByRole('group', { name: 'Homework set in this session' })
}
async function add(page: Page, panel: ReturnType<Page['getByRole']>, title: string, details = '') {
  await panel.getByLabel('Homework', { exact: true }).fill(title)
  if (details) await panel.getByLabel('Details (optional)').fill(details)
  const due = panel.getByRole('combobox', { name: 'Due in', exact: true })
  await due.selectOption((await due.locator('optgroup[label="Later occurrences of this lesson"] option').first().getAttribute('value'))!)
  await panel.getByRole('button', { name: 'Add homework' }).click()
}
const moveMaths2 = (page: Page) =>
  page.evaluate(() => {
    const c = JSON.parse(localStorage.getItem('timetable.cache.v2.fx')!)
    const t = c.sessions.find((s: { id: string }) => s.id === 'm2')
    t.dateISO = '2026-09-23'
    t.day = 'Wed'
    localStorage.setItem('timetable.cache.v2.fx', JSON.stringify(c))
  })

test('HW-01: two same-title homework records stay separate everywhere; completing one leaves the other open', async ({ page }) => {
  await seed(page)
  const panel = await openSource(page)
  await add(page, panel, 'Read chapter 3', 'Pages 10–20')
  await add(page, panel, 'Read chapter 3', 'Bring two questions')
  expect((await admin(page)).homework).toHaveLength(2)
  await expect(panel.getByRole('list', { name: 'Homework set' }).getByRole('checkbox')).toHaveCount(2)
  await expect(panel.getByRole('list', { name: 'Homework set' })).toContainText('Pages 10–20')
  await page.goto('./#/tasks')
  const cards = page.locator('.task-card').filter({ hasText: 'Read chapter 3' })
  await expect(cards).toHaveCount(2)
  await page.getByRole('combobox', { name: 'Status for Homework: Read chapter 3' }).first().selectOption('done')
  const a = await admin(page)
  expect(a.homework.filter((h: { status: string }) => h.status === 'done')).toHaveLength(1)
  expect(a.homework.filter((h: { status: string }) => h.status === 'todo')).toHaveLength(1)
  // Both remain on the due session too.
  await page.goto('./#/schedule')
  await page.getByRole('button', { name: 'Next week' }).click()
  await page.getByRole('option', { name: /Tuesday 22 September/ }).click()
  await page.locator('.day-list .session-card').filter({ hasText: 'Maths 2' }).click()
  await expect(page.getByRole('list', { name: 'Homework due' }).getByRole('checkbox')).toHaveCount(2)
})

test('HW-02: edit, reschedule, remove and undo on the same record — from its own page', async ({ page }) => {
  await seed(page)
  const panel = await openSource(page)
  await add(page, panel, 'Read chapter 3', 'Pages 10–20')
  const id = (await admin(page)).homework[0].id
  await panel.getByRole('button', { name: 'Open homework: Read chapter 3' }).click()
  await expect(page).toHaveURL(new RegExp(`#/homework/${id}$`))
  await expect(page.getByRole('heading', { name: 'Read chapter 3' })).toBeVisible()
  await expect(page.getByText('Pages 10–20')).toBeVisible()
  await expect(page.getByText('Maths 1 · Tue, 15 Sept 2026 09:00')).toBeVisible()
  await expect(page.locator('[data-due-state="current"]')).toContainText('Maths 2 · Tue, 22 Sept 2026')
  // Edit the words.
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByLabel('Homework', { exact: true }).fill('Read chapters 3 and 4')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Read chapters 3 and 4' })).toBeVisible()
  // Reschedule to Maths 3 — same id, status untouched.
  await page.getByRole('button', { name: 'In progress' }).click()
  await page.getByRole('button', { name: 'Change due session or date' }).click()
  const due = page.getByRole('combobox', { name: 'Due in', exact: true })
  await due.selectOption((await due.locator('option').filter({ hasText: 'Maths 3' }).getAttribute('value'))!)
  await page.getByRole('button', { name: 'Use this' }).click()
  await expect(page.locator('[data-due-state="current"]')).toContainText('Maths 3 · Tue, 29 Sept 2026')
  await expect(page.getByRole('list', { name: 'Due history' })).toContainText('Rescheduled: Tue, 22 Sept 2026 → Tue, 29 Sept 2026')
  let a = await admin(page)
  expect(a.homework).toHaveLength(1)
  expect(a.homework[0]).toMatchObject({ id, title: 'Read chapters 3 and 4', status: 'doing', dueISO: '2026-09-29', dueMode: 'session' })
  // Every surface reads the same record after a reload.
  await page.reload()
  await page.goto('./#/tasks')
  await expect(page.locator('.task-card').filter({ hasText: 'Read chapters 3 and 4' })).toContainText('Tue, 29 Sept 2026')
  await page.locator('.task-card').filter({ hasText: 'Read chapters 3 and 4' }).getByRole('button').first().click()
  await expect(page).toHaveURL(new RegExp(`#/homework/${id}$`))
  // Remove, then put it back.
  await page.getByRole('button', { name: 'Remove this homework' }).click()
  await expect(page).toHaveURL(/#\/tasks$/)
  await expect(page.getByText('Removed homework “Read chapters 3 and 4”.')).toBeVisible()
  expect((await admin(page)).homework).toHaveLength(0)
  await page.getByRole('button', { name: 'Undo' }).click()
  a = await admin(page)
  expect(a.homework).toHaveLength(1)
  expect(a.homework[0]).toMatchObject({ id, status: 'doing', dueISO: '2026-09-29' })
  await expect(page.locator('.task-card').filter({ hasText: 'Read chapters 3 and 4' })).toHaveCount(1)
})

test('HW-03: a moved due session is a question, never a split date — Follow moves the deadline, Keep fixes it', async ({ page }) => {
  await seed(page)
  const panel = await openSource(page)
  await add(page, panel, 'Read chapter 3')
  await add(page, panel, 'Times tables')
  await moveMaths2(page)
  await page.reload()
  // Tasks keeps the confirmed date and flags the change; the panel row says so too.
  await page.goto('./#/tasks')
  const card = page.locator('.task-card').filter({ hasText: 'Read chapter 3' })
  await expect(card).toContainText('Tue, 22 Sept 2026')
  await expect(card).toContainText('Needs review')
  const again = await openSource(page)
  await expect(again.getByRole('list', { name: 'Homework set' }).getByRole('listitem').filter({ hasText: 'Read chapter 3' })).toContainText('needs review')
  // The moved session still lists the homework as due in it (by reference), with the same flag on its page.
  await again.getByRole('button', { name: 'Open homework: Read chapter 3' }).click()
  const change = page.getByRole('group', { name: 'Due session changed' })
  await expect(change).toContainText('Maths 2 moved: Tue, 22 Sept 2026 09:00 → Wed, 23 Sept 2026 09:00')
  await change.getByRole('button', { name: 'Follow this session' }).click()
  await expect(page.locator('[data-due-state="current"]')).toContainText('Maths 2 · Wed, 23 Sept 2026')
  await expect(page.getByRole('list', { name: 'Due history' })).toContainText('Followed the session: Tue, 22 Sept 2026 → Wed, 23 Sept 2026')
  let a = await admin(page)
  expect(a.homework.find((h: { title: string }) => h.title === 'Read chapter 3')).toMatchObject({ dueISO: '2026-09-23', dueMode: 'session' })
  // The other one keeps its original date and stops following the session.
  await page.goto('./#/tasks')
  await page.locator('.task-card').filter({ hasText: 'Times tables' }).getByRole('button').first().click()
  await page.getByRole('group', { name: 'Due session changed' }).getByRole('button', { name: 'Keep the original date' }).click()
  await expect(page.locator('[data-due-state="fixed"]')).toContainText('Tue, 22 Sept 2026')
  a = await admin(page)
  expect(a.homework.find((h: { title: string }) => h.title === 'Times tables')).toMatchObject({ dueISO: '2026-09-22', dueMode: 'date' })
  await page.goto('./#/tasks')
  await expect(page.locator('.task-card').filter({ hasText: 'Read chapter 3' })).toContainText('Wed, 23 Sept 2026')
  await expect(page.locator('.task-card').filter({ hasText: 'Times tables' })).toContainText('Tue, 22 Sept 2026')
  await expect(page.locator('.task-card').filter({ hasText: 'Needs review' })).toHaveCount(0)
})

test('HW-04: session-only homework keeps source and due links, and names a source that left the timetable', async ({ page }) => {
  await seed(page)
  const panel = await openSource(page)
  await add(page, panel, 'Read chapter 3')
  await page.goto('./#/tasks')
  await page.locator('.task-card').filter({ hasText: 'Read chapter 3' }).getByRole('button').first().click()
  await page.getByRole('button', { name: 'Open source session' }).click()
  await expect(page.getByRole('heading', { name: /Maths 1/ })).toBeVisible()
  await page.goBack()
  await page.getByRole('button', { name: 'Open due session' }).click()
  await expect(page.getByRole('heading', { name: /Maths 2/ })).toBeVisible()
  // The source leaves the timetable: the homework stays, and says where it came from.
  await page.evaluate(() => {
    const c = JSON.parse(localStorage.getItem('timetable.cache.v2.fx')!)
    c.sessions = c.sessions.filter((s: { id: string }) => s.id !== 'm1')
    localStorage.setItem('timetable.cache.v2.fx', JSON.stringify(c))
  })
  await page.reload()
  await page.goto('./#/tasks')
  await page.locator('.task-card').filter({ hasText: 'Read chapter 3' }).getByRole('button').first().click()
  await expect(page.getByText('Source no longer in timetable')).toBeVisible()
  await expect(page.getByText('Maths 1 · Tue, 15 Sept 2026')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open source session' })).toHaveCount(0)
  expect((await admin(page)).homework).toHaveLength(1)
})

test('HW-05: validation instead of truncation, a searchable chooser that excludes deadline rows, a kept due target, and a draft that survives a reload', async ({ page }) => {
  await seed(page, base(), { 'event:d1': { deadlineOnly: true, at: 1 } })
  const panel = await openSource(page)
  await panel.getByLabel('Homework', { exact: true }).fill('x'.repeat(201))
  await expect(panel.getByText('201/200')).toBeVisible()
  await expect(panel.getByRole('alert')).toContainText('1 characters over the 200-character limit')
  await expect(panel.getByRole('button', { name: 'Add homework' })).toBeDisabled()
  await panel.getByLabel('Homework', { exact: true }).fill('Read chapter 3')
  // The chooser searches the whole timetable and never offers a row marked as a deadline.
  const due = panel.getByRole('combobox', { name: 'Due in', exact: true })
  await expect(due.locator('option').filter({ hasText: 'Portfolio submission' })).toHaveCount(0)
  await expect(due.locator('option').filter({ hasText: 'English 1 · Wed 23 Sept 13:00 · Dr Lee · group 1' })).toHaveCount(1)
  await panel.getByLabel('Homework set in this session search').fill('Lee')
  await expect(due.locator('option').filter({ hasText: 'Maths' })).toHaveCount(0)
  await expect(due.locator('option').filter({ hasText: 'English 1' })).toHaveCount(1)
  await panel.getByLabel('Homework set in this session search').fill('')
  // Keep the due target for the next item, on request.
  await due.selectOption((await due.locator('optgroup[label="Later occurrences of this lesson"] option').first().getAttribute('value'))!)
  await panel.getByRole('checkbox', { name: 'Use this due session for the next item too' }).check()
  await panel.getByRole('button', { name: 'Add homework' }).click()
  await expect(due).not.toHaveValue('')
  await panel.getByLabel('Homework', { exact: true }).fill('Times tables')
  await panel.getByRole('button', { name: 'Add homework' }).click()
  await panel.getByRole('checkbox', { name: 'Use this due session for the next item too' }).uncheck()
  await panel.getByLabel('Homework', { exact: true }).fill('Spelling list')
  await panel.getByLabel('Details (optional)').fill('Ten words')
  await panel.getByRole('button', { name: 'Add homework' }).click()
  await expect(due).toHaveValue('')
  expect((await admin(page)).homework.map((h: { dueTitle: string }) => h.dueTitle)).toEqual(['Maths 2', 'Maths 2', 'Maths 2'])
  // A typed-but-not-added item is a draft for THIS source: it survives a reload and never leaks to another session.
  await panel.getByLabel('Homework', { exact: true }).fill('Half-written homework')
  await page.reload()
  const back = await openSource(page)
  await expect(back.getByLabel('Homework', { exact: true })).toHaveValue('Half-written homework')
  await expect(back.getByRole('status').filter({ hasText: 'Draft from' })).toBeVisible()
  await page.goto('./#/schedule')
  await page.getByRole('button', { name: 'Next week' }).click()
  await page.getByRole('option', { name: /Wednesday 23 September/ }).click()
  await page.locator('.day-list .session-card').filter({ hasText: 'English 1' }).click()
  await expect(page.getByRole('group', { name: 'Homework set in this session' }).getByLabel('Homework', { exact: true })).toHaveValue('')
})

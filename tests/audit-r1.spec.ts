import { expect, test } from './fixtures'
import type { Browser, Page } from '@playwright/test'

/**
 * R1 regressions (Pass 50), adapted from the audit's observation scenarios
 * with expectations flipped to the corrected behaviour. Synthetic profile
 * and records only; the clock is frozen at 2026-09-07T08:15:00Z (09:15 in
 * the London course zone).
 */

const ADMIN = {
  reflections: [], targets: [], observations: [], lessons: [], audits: [], meetings: [], exceptions: [], plans: [],
  tasks: [
    { id: 'done', title: 'Submitted assignment', dueISO: '2026-09-05', status: 'done', completedISO: '2026-09-04', at: 1 },
    { id: 'weekend', title: 'Saturday deadline', dueISO: '2026-09-12', status: 'todo', at: 1 },
    { id: 'm1', title: 'Monday deadline one', dueISO: '2026-09-14', status: 'todo', at: 1 },
    { id: 'm2', title: 'Monday deadline two', dueISO: '2026-09-14', status: 'todo', at: 1 },
    { id: 'm3', title: 'Monday deadline three', dueISO: '2026-09-14', status: 'todo', at: 1 },
  ],
  commitments: [
    { id: 'dentist', title: 'Personal appointment audit', dateISO: '2026-09-07', startTime: '17:00', endTime: '18:00', kind: 'appointment', busy: true, at: 1 },
    { id: 'clash', title: 'Simultaneous appointment audit', dateISO: '2026-09-07', startTime: '09:00', endTime: '10:00', kind: 'appointment', busy: true, at: 1 },
  ],
}

async function seed(page: Page, opts: { width?: number } = {}) {
  await page.clock.install({ time: new Date('2026-09-07T08:15:00Z') })
  await page.addInitScript((admin) => {
    localStorage.setItem('timetable.whatsnew.v1', '99')
    if (localStorage.getItem('timetable.store.v2')) return
    localStorage.setItem(
      'timetable.store.v2',
      JSON.stringify({
        activeId: 'audit',
        profiles: [{ id: 'audit', name: 'Synthetic audit timetable', settings: { demo: true, sheetId: '', gid: null, specialismsChosen: true, checklistDismissed: true, usagePing: false, theme: 'light', travelMode: 'transit', homeLat: 51.55, homeLng: -0.1, homeAddress: 'Synthetic home' } }],
      })
    )
    localStorage.setItem('timetable.admin.v1.audit', JSON.stringify(admin))
  }, ADMIN)
  await page.setViewportSize({ width: opts.width ?? 390, height: 900 })
}

test('TT-01/02/04: desktop calendar has real width and shows personal events and weekend deadlines', async ({ page }) => {
  await seed(page, { width: 1440 })
  await page.goto('./#/schedule')
  const grid = page.locator('.week-grid')
  await expect(grid).toBeVisible()
  // POSITIVE width assertion, not just "no overflow": 1440 − 200 rail − 2×24 padding ≈ 1192.
  const width = await grid.evaluate((el) => el.getBoundingClientRect().width)
  expect(width).toBeGreaterThan(1100)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
  // The 17:00 personal appointment is in the desktop Week grid…
  await expect(page.getByText('Personal appointment audit', { exact: true })).toBeVisible()
  // …and a Saturday-only deadline forces its weekend column.
  // (12 Sep is in the week of 7 Sep — same grid; pins render as "📌 <title>".)
  await expect(page.locator('.week-keydate', { hasText: 'Saturday deadline' })).toBeVisible()
  // Selecting an event opens the 320px panel at ≥1280; the grid keeps ≥800px.
  await page.getByText('Personal appointment audit', { exact: true }).click()
  await expect(page.locator('.session-panel')).toBeVisible()
  expect(await grid.evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(800)
})

test('TT-04: three same-day deadlines expose all three through an accessible "+1 more"', async ({ page }) => {
  await seed(page, { width: 1440 })
  await page.goto('./#/schedule')
  // Move to the week of 14 Sep.
  await page.locator('.week-view').getByRole('button', { name: /next week/i }).click()
  const more = page.getByRole('button', { name: /1 more deadlines on 2026-09-14/ })
  await expect(more).toBeVisible()
  const third = page.locator('.week-keydate[title="Monday deadline three"]')
  await expect(third).toHaveCount(0)
  await more.focus()
  await page.keyboard.press('Enter')
  await expect(third).toBeVisible()
})

test('TT-03: schedule search finds a personal appointment and states its scope', async ({ page }) => {
  await seed(page)
  await page.goto('./#/schedule')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await page.getByLabel('Search sessions').fill('Personal appointment audit')
  await expect(page.getByText('All dates; display filters not applied.')).toBeVisible()
  await expect(page.getByText('No sessions match “Personal appointment audit”.')).toHaveCount(0)
  await expect(page.getByText('Personal appointment audit', { exact: true })).toBeVisible()
})

test('TT-05: London and New York devices agree on the course clock at the same instant', async ({ browser }) => {
  const labels: Record<string, string> = {}
  for (const zone of ['Europe/London', 'America/New_York']) {
    const context = await (browser as Browser).newContext({ timezoneId: zone, serviceWorkers: 'block' })
    await context.route('**/*', (r) => (['127.0.0.1', 'localhost'].includes(new URL(r.request().url()).hostname) ? r.continue() : r.abort()))
    const p = await context.newPage()
    await seed(p)
    await p.goto('./#/today')
    await expect(p.locator('.today-hero-label')).toBeVisible()
    labels[zone] = await p.locator('.today-hero-label').innerText()
    if (zone === 'America/New_York') await expect(p.getByText(/course time 09:15/)).toBeVisible()
    await context.close()
  }
  expect(labels['Europe/London']).toMatch(/^now/i)
  expect(labels['America/New_York']).toBe(labels['Europe/London'])
})

test('TT-06: a simultaneous personal appointment is reachable on Today with a clash count', async ({ page }) => {
  await seed(page)
  await page.goto('./#/today')
  await expect(page.locator('.today-hero-label')).toContainText('Now')
  const alsoNow = page.getByLabel('Also now')
  await expect(alsoNow.getByText('Simultaneous appointment audit', { exact: true })).toBeVisible()
  await expect(alsoNow.getByText(/2 at the same time/)).toBeVisible()
  // Exactly once on the page.
  await expect(page.getByText('Simultaneous appointment audit', { exact: true })).toHaveCount(1)
})

test('TT-07: a new personal-event draft is recoverable after reload under the same record id', async ({ page }) => {
  await seed(page)
  await page.goto('./#/schedule')
  await page.getByRole('button', { name: 'Add a personal event on this day' }).click()
  await page.getByLabel('Title', { exact: true }).fill('Recover this unsaved event')
  await expect(page.getByText('Draft saved on this device.')).toBeVisible()
  const before = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('timetable.draft.v1.commitment')))
  expect(before.length).toBe(1)
  const draftId = before[0].split('.')[4]
  await page.reload()
  await page.getByRole('button', { name: 'Add a personal event on this day' }).click()
  await page.getByRole('button', { name: 'Continue draft', exact: true }).click()
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Recover this unsaved event')
  await page.getByRole('button', { name: /^Save/ }).click()
  const ids = await page.evaluate(() => JSON.parse(localStorage.getItem('timetable.admin.v1.audit')!).commitments.map((c: { id: string }) => c.id))
  expect(ids).toContain(draftId)
  expect(ids.filter((id: string) => id === draftId).length).toBe(1)
})

test('TT-08: malformed and unknown links never blank the app; unknown settings sections land on the index', async ({ page }) => {
  await seed(page)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('./#/session/%E0%A4%A')
  await expect(page.getByRole('heading', { name: 'This link could not be opened' })).toBeVisible()
  await page.locator('.page-invalid-link').getByRole('button', { name: 'Today', exact: true }).click()
  await expect(page.locator('.today-hero-label')).toBeVisible()
  await page.goto('./#/no-such-page')
  await expect(page.getByRole('heading', { name: 'This link could not be opened' })).toBeVisible()
  await page.goto('./#/settings/not-a-category')
  await expect(page.getByText(/That settings section does not exist/)).toBeVisible()
  expect(errors).toEqual([])
})

test('TT-09: completed tasks say Completed, never overdue, and the status control is explicit', async ({ page }) => {
  await seed(page)
  await page.goto('./#/tasks')
  await page.locator('.completed-tasks summary').click()
  const completed = page.locator('.completed-tasks')
  await expect(completed.getByText('Completed', { exact: true })).toBeVisible()
  await expect(completed.getByText(/overdue/)).toHaveCount(0)
  await expect(completed.getByText(/Completed .*4.*· due/)).toBeVisible()
  await expect(page.getByLabel('Status for Saturday deadline')).toBeVisible()
  await expect(page.getByText(/Tap the status to cycle/)).toHaveCount(0)
})

test('TT-10: an impossible study block cannot be saved; the error names the field', async ({ page }) => {
  await seed(page)
  await page.goto('./#/tasks')
  await page.locator('.keydate-row', { hasText: 'Saturday deadline' }).click()
  await page.getByRole('combobox', { name: 'Type', exact: true }).selectOption('block')
  await page.getByLabel('Add to plan', { exact: true }).fill('Invalid interval')
  await page.getByLabel('Starts', { exact: true }).fill('18:00')
  await page.getByLabel('Ends', { exact: true }).fill('17:00')
  await page.getByRole('button', { name: 'Add block' }).click()
  await expect(page.getByRole('alert')).toContainText(/end after it starts|real date/)
  const plans = await page.evaluate(() => JSON.parse(localStorage.getItem('timetable.admin.v1.audit')!).plans)
  expect(plans.length).toBe(0)
})

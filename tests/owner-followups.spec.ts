import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'

/**
 * Owner follow-ups, 16 September 2026:
 *  1. sync state is a small header control, never a banner above the page —
 *     a routine "Synced" must not interrupt, while a failure still shows and
 *     offers Retry;
 *  2. a placement that has been set up stays openable and editable from the
 *     PGCE file, and the other placements stay listed there.
 */

test.use({ timezoneId: 'Europe/London' })

const session = (id: string, title: string, dateISO: string, day: string) => ({ id, title, day, dateISO, start: '08:30', end: '15:30', room: '', groups: '', tutor: '', subject: title, isSpecialism: false, isSelfStudy: false, isOptional: false })
const SESSIONS = [session('a1', 'School Experience SE1a', '2026-09-16', 'Wed')]
const base = () => ({
  reflections: [], targets: [], meetings: [], observations: [], audits: [], tasks: [], exceptions: [], plans: [], commitments: [], programmes: [], packs: [], requirements: [], milestones: [], cycles: [], preps: [], goals: [], resources: [], projects: [], readings: [], contacts: [], questions: [], protected: [], supportNotes: [], examples: [], reviewPacks: [], experience: [], reviews: [], homework: [], lessons: [],
  placements: [
    { id: 'pl-se1', code: 'SE1', schoolLocationId: 'sch-1', startISO: '2026-09-07', endISO: '2026-12-11', mappedBlockTags: ['SE1A'], mentorName: 'A Mentor', at: 10 },
    { id: 'pl-se2', code: 'SE2', schoolLocationId: 'sch-2', startISO: '2027-02-01', endISO: '2027-03-26', mappedBlockTags: ['SE2'], at: 10 },
  ],
  schools: [
    { id: 'sch-1', name: 'Riverside Primary', address: '1 River Lane', lat: 51.53, lng: -0.11, confirmedAt: 5, at: 10 },
    { id: 'sch-2', name: 'Meadow Park Primary', address: '4 Meadow Way', at: 10 },
  ],
})

async function seed(page: Page, opts: { sync?: boolean; admin?: Record<string, unknown> } = {}) {
  await page.clock.install({ time: new Date('2026-09-16T06:05:00Z') })
  await page.addInitScript(
    ({ SESSIONS, admin, sync }) => {
      localStorage.setItem('timetable.whatsnew.v1', '99')
      if (localStorage.getItem('timetable.store.v2')) return
      localStorage.setItem('timetable.store.v2', JSON.stringify({ activeId: 'fx', profiles: [{ id: 'fx', name: 'My timetable', settings: { demo: false, sheetId: 'FIXTURESHEET-FIXTURESHEET-FIXTURESHEET-0001', gid: null, specialismsChosen: true, checklistDismissed: true, usagePing: false } }] }))
      localStorage.setItem('timetable.cache.v2.fx', JSON.stringify({ fetchedAt: Date.now(), sessions: SESSIONS }))
      localStorage.setItem('timetable.admin.v1.fx', JSON.stringify(admin))
      if (sync) localStorage.setItem('timetable.sync.v1', JSON.stringify({ code: 'SYNCCODE-TEST-0001', lastAt: 0 }))
    },
    { SESSIONS, admin: opts.admin ?? base(), sync: !!opts.sync }
  )
  await page.setViewportSize({ width: 390, height: 844 })
}

test('sync is a header status control, not a banner: nothing interrupts the page, and a failure is still reachable with Retry', async ({ page }) => {
  // Without sync set up there is no sync control at all.
  await seed(page)
  await page.goto('./#/today')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Sync status/ })).toHaveCount(0)
  await expect(page.locator('.backup-banner')).toHaveCount(0)

  // With sync set up, the state lives in the page header instead.
  await page.evaluate(() => localStorage.setItem('timetable.sync.v1', JSON.stringify({ code: 'SYNCCODE-TEST-0001', lastAt: 0 })))
  await page.goto('./#/settings/data')
  const chip = page.getByRole('button', { name: /^Sync status/ })
  await expect(chip).toBeVisible()
  await expect(chip).toHaveAttribute('aria-label', 'Sync status: Sync on')
  // A real exchange cannot reach the server in tests, so it fails — and the failure
  // shows on the control rather than as a banner.
  await page.getByRole('button', { name: 'Sync now' }).click()
  await expect(chip).toHaveAttribute('aria-label', /Sync failed/, { timeout: 30_000 })
  // The message is behind the control, and Retry with it.
  await chip.click()
  const pop = page.getByLabel('Sync status', { exact: true })
  await expect(pop).toContainText('Sync failed')
  await expect(pop.getByRole('button', { name: 'Retry sync' })).toBeVisible()
  await chip.click()
  await expect(pop).toHaveCount(0)
  // It is a small control in the page header, and nothing interrupts the page:
  // no banner and no status text of its own on an ordinary screen.
  const box = await chip.boundingBox()
  expect(box!.height).toBeGreaterThanOrEqual(44)
  expect(box!.width).toBeLessThan(80)
  expect(box!.y).toBeLessThan(200)
  for (const route of ['today', 'schedule', 'tasks', 'pgce']) {
    await page.goto(`./#/${route}`)
    await expect(page.getByRole('button', { name: /^Sync status/ })).toHaveAttribute('aria-label', /Sync failed/)
    await expect(page.locator('.backup-banner')).toHaveCount(0)
    await expect(page.getByText(/^Sync failed:/)).toHaveCount(0)
  }
  // Settings → Data & devices still reports it in the data-health list, as before.
  await page.goto('./#/settings/data')
  await expect(page.getByText(/^Sync failed:/)).toHaveCount(1)
})

test('a placement that is set up stays openable and editable from the PGCE file, and the others stay listed', async ({ page }) => {
  await seed(page)
  await page.goto('./#/pgce')
  const card = page.locator('.pgce-active')
  await expect(card).toContainText('SE1')
  await expect(card).toContainText('Riverside Primary')
  await expect(card).toContainText('Ready to plan')
  // Open and edit are both offered for a placement that is ready.
  await expect(card.getByRole('button', { name: 'Open SE1' })).toBeVisible()
  await expect(card.getByRole('button', { name: 'Edit SE1 setup' })).toBeVisible()
  await expect(card.getByRole('button', { name: 'To school' })).toBeVisible()
  await expect(card.getByRole('button', { name: 'All placements' })).toBeVisible()
  // The other placements are still listed here — setting SE1 up hides nothing.
  const others = card.getByRole('list', { name: 'Your other placements' })
  await expect(others.getByRole('button', { name: /^SE2 · Meadow Park Primary/ })).toBeVisible()
  await expect(others.getByRole('button', { name: /^SE3 · Not set up/ })).toBeVisible()
  // Edit opens SE1's own setup flow on its school details, already filled in.
  await card.getByRole('button', { name: 'Edit SE1 setup' }).click()
  const flow = page.getByRole('dialog', { name: 'Set up SE1' })
  await expect(flow).toBeVisible()
  await expect(flow.getByLabel('School name')).toHaveValue('Riverside Primary')
  await expect(flow.getByLabel('Address')).toHaveValue('1 River Lane')
  await flow.getByRole('button', { name: 'Cancel' }).click()
  await expect(flow).toHaveCount(0)
  // Open goes to the placement's own workspace.
  await card.getByRole('button', { name: 'Open SE1' }).click()
  await expect(page).toHaveURL(/#\/placement\/pl-se1$/)
  await expect(page.getByRole('heading', { level: 1, name: 'SE1 · Riverside Primary' })).toBeVisible()
  // SE2 opens its workspace straight from the landing too.
  await page.goto('./#/pgce')
  await card.getByRole('list', { name: 'Your other placements' }).getByRole('button', { name: /^SE2/ }).click()
  await expect(page).toHaveURL(/#\/placement\/pl-se2$/)
})

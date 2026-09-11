import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'
import { mockStats } from './admin-fixtures'

/**
 * V4 (Pass 61) — PGCE workspace and admin analytics from the visual audit.
 * PGCE: empty and populated fixtures, identity tiles, destination-named
 * links, count badges from real records, desktop two-column, editors within
 * two steps. Admin: navy rail with line icons, headline cards from the same
 * fixture, separate v2 card with its warning, mobile stacking and section
 * picker, chart affordances retained. Admin contracts are untouched.
 */

test.use({ timezoneId: 'Europe/London' })

const EMPTY_ADMIN = { reflections: [], targets: [], observations: [], lessons: [], audits: [], exceptions: [], plans: [], commitments: [], meetings: [], tasks: [] }

async function seed(page: Page, opts: { admin?: Record<string, unknown>; width?: number } = {}) {
  await page.clock.install({ time: new Date('2026-09-07T07:05:00Z') })
  await page.addInitScript(
    ({ admin }) => {
      localStorage.setItem('timetable.whatsnew.v1', '99')
      if (localStorage.getItem('timetable.store.v2')) return
      localStorage.setItem('timetable.store.v2', JSON.stringify({ activeId: 'd', profiles: [{ id: 'd', name: 'Demo learner', settings: { demo: true, sheetId: '', gid: null, specialismsChosen: true, checklistDismissed: true, usagePing: false } }] }))
      localStorage.setItem('timetable.admin.v1.d', JSON.stringify(admin))
    },
    { admin: opts.admin ?? EMPTY_ADMIN }
  )
  await page.setViewportSize({ width: opts.width ?? 390, height: 844 })
}

test('PGCE (empty): four identity tiles, one primary per card, no "View all", Set up placement, no invented percentages, privacy line', async ({ page }) => {
  await seed(page)
  await page.goto('./#/pgce')
  // G1a: five section cards and tiles; the Placements card holds one primary per SE card.
  const cards = page.locator('.pgce-section')
  await expect(cards).toHaveCount(5)
  await expect(page.locator('.pgce-tile')).toHaveCount(5)
  for (let i = 1; i < 5; i++) await expect(cards.nth(i).locator('.btn-primary')).toHaveCount(1)
  await expect(cards.nth(0).locator('.placement-card .btn-primary')).toHaveCount(3)
  await expect(page.getByRole('button', { name: /View all/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Set up SE1' })).toBeVisible()
  await expect(page.locator('.pgce-count')).toHaveCount(0) // no counts invented from nothing
  await expect(page.getByText(/%/)).toHaveCount(0)
  await expect(page.getByText(/stay private on this device/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Term stats & attendance' })).toBeVisible()
})

test('PGCE (populated): count badges come from real records, Open placement by state, desktop two-column, every editor within two steps', async ({ page }) => {
  await seed(page, {
    width: 1280,
    admin: {
      ...EMPTY_ADMIN,
      reflections: [{ id: 'r1', weekISO: '2026-08-31', wentWell: 'x', challenges: '', focus: '', standards: [], at: 1 }],
      targets: [
        { id: 't1', text: 'Questioning', standards: [], setISO: '2026-09-01', status: 'open', at: 1 },
        { id: 't2', text: 'Pace', standards: [], setISO: '2026-09-01', status: 'met', at: 1 },
      ],
      meetings: [{ id: 'm1', dateISO: '2026-09-04', discussed: 'x', at: 1, actions: [{ id: 'a1', text: 'Read policy', done: false }] }],
    },
  })
  await page.goto('./#/pgce')
  const cards = page.locator('.pgce-section')
  await expect(cards).toHaveCount(5)
  // Two columns at 1280: the Placements card spans the row; the next two cards share one.
  const a = await cards.nth(1).boundingBox()
  const b = await cards.nth(2).boundingBox()
  expect(Math.abs(a!.y - b!.y)).toBeLessThan(4)
  expect(b!.x).toBeGreaterThan(a!.x + a!.width - 1)
  await expect(cards.filter({ hasText: 'Evidence' }).locator('.pgce-count')).toHaveText('1 record')
  await expect(cards.filter({ hasText: 'Development' }).locator('.pgce-count')).toHaveText('3 records')
  await expect(cards.filter({ hasText: 'Development' })).toContainText('1 open target · 1 mentor action to tick off')
  // Placement primaries follow real state (G1a): nothing set up → "Set up SE1/SE2/SE3", no logged-days badge invented.
  const placementCard = cards.filter({ hasText: 'Placements' }).first()
  await expect(placementCard.getByRole('button', { name: /^Set up SE[123]$/ })).toHaveCount(3)
  await expect(placementCard.locator('.pgce-count')).toHaveCount(0)
  // Editors within two purposeful steps: menu → Targets opens the admin sheet on Targets.
  await page.getByRole('button', { name: /Add or open a record/ }).click()
  await page.getByRole('menuitem', { name: /^Targets \(2\)/ }).click()
  await expect(page.getByRole('dialog')).toContainText('Questioning')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Weekly reflections (1)' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
})

test('Admin: navy rail with line icons and every section + Lock retained; headline cards keep the fixture values; separate v2 card warns; no emoji controls', async ({ page, context }) => {
  await mockStats(context)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('./analytics.html')
  await page.getByLabel('Owner key').fill('test-key')
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.getByText('Active tokens — last 7 days')).toBeVisible()
  const rail = page.locator('.admin-rail')
  await expect(rail.getByRole('link')).toHaveCount(6)
  for (const name of ['Overview', 'Feature adoption', 'Return visits', 'Reliability', 'Releases', 'Data & access']) {
    await expect(rail.getByRole('link', { name })).toBeVisible()
  }
  await expect(rail.locator('nav svg')).toHaveCount(6)
  await expect(rail.getByRole('button', { name: 'Lock workspace' })).toBeVisible()
  const railBg = await rail.evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(railBg).toBe('rgb(27, 36, 56)')
  await expect(page.getByText('Two measurement sources are in use.')).toBeVisible()
  await expect(page.getByText('Legacy dataset')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'New event dataset' })).toBeVisible()
  await expect(page.getByText(/Do not compare directly with the legacy total above/)).toBeVisible()
  await expect(page.getByText('UTC reporting')).toBeVisible()
  await expect(page.getByText('Today is partial')).toBeVisible()
  await expect(page.getByRole('button', { name: 'View data table' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Review reliability' })).toBeVisible()
  // No emoji-only controls anywhere in the workspace.
  const emoji = await page.evaluate(() => {
    const re = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u
    return [...document.querySelectorAll('button, a')].filter((b) => re.test(b.textContent || '')).map((b) => b.textContent!.trim())
  })
  expect(emoji).toEqual([])
  // No reporting-window picker pretends to move fixed-window metrics.
  await expect(page.locator('input[type=date], select[name=window]')).toHaveCount(0)
})

test('Admin mobile: stacked headline cards, the labelled section picker and the topbar Lock; chart keyboard navigation still works', async ({ page, context }) => {
  await mockStats(context)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./analytics.html')
  await page.getByLabel('Owner key').fill('test-key')
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.getByText('Active tokens — last 7 days')).toBeVisible()
  await expect(page.locator('.admin-rail')).toBeHidden()
  await expect(page.getByLabel('Section', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Lock workspace' })).toBeVisible()
  const kpis = page.locator('.kpis .kpi')
  await expect(kpis).toHaveCount(3)
  const first = await kpis.nth(0).boundingBox()
  const second = await kpis.nth(1).boundingBox()
  expect(second!.y).toBeGreaterThan(first!.y + first!.height - 1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
  const plot = page.getByRole('application', { name: /Daily active tokens chart/ })
  await plot.focus()
  await page.keyboard.press('Home')
  await expect(page.locator('.chart-readout')).not.toContainText('No day selected')
})

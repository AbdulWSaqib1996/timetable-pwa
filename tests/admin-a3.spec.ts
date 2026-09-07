import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'
import { mockStats } from './admin-fixtures'

/**
 * A3 shell coverage (Pass 47): responsive layout without page overflow,
 * hash sections with Back/Forward, theme cycling, idle auto-lock, keyboard
 * chart navigation, sortable adoption table, honest not-collected states and
 * a definition-carrying CSV export. All worker traffic is mocked.
 */

async function unlock(page: Page) {
  await page.goto('./analytics.html')
  await page.getByLabel('Owner key').fill('test-key')
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.getByText('Active tokens — last 7 days')).toBeVisible()
}

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

test('no page-wide horizontal overflow at 320/390/768/1440 across every section', async ({ page, context }) => {
  await mockStats(context)
  await unlock(page)
  for (const [w, h] of [[320, 700], [390, 844], [768, 1024], [1440, 900]] as const) {
    await page.setViewportSize({ width: w, height: h })
    for (const section of ['overview', 'adoption', 'returning', 'reliability', 'releases', 'access']) {
      await page.goto(`./analytics.html#${section}`)
      await page.waitForTimeout(50)
      expect(await overflow(page), `${section} overflows at ${w}px`).toBeLessThanOrEqual(0)
    }
  }
})

test('sections live in the hash: Back/Forward restores them; a direct link shows the locked state first', async ({ page, context }) => {
  await mockStats(context)
  // Direct deep link: locked first (the key never persists), then lands there.
  await page.goto('./analytics.html#adoption')
  await expect(page.getByLabel('Owner key')).toBeVisible()
  await page.getByLabel('Owner key').fill('test-key')
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.getByRole('heading', { name: 'Feature adoption' })).toBeVisible()
  // Navigate via the rail, then walk history.
  await page.getByRole('link', { name: 'Return visits' }).click()
  await expect(page.getByRole('heading', { name: 'Return visits' })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('heading', { name: 'Feature adoption' })).toBeVisible()
  await page.goForward()
  await expect(page.getByRole('heading', { name: 'Return visits' })).toBeVisible()
  // Mobile gets a labelled section picker instead of the rail.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByLabel('Section', { exact: true }).selectOption('releases')
  await expect(page.getByRole('heading', { name: 'Releases' })).toBeVisible()
})

test('theme cycles System → Light → Dark and persists as a non-sensitive preference', async ({ page, context }) => {
  await mockStats(context)
  await unlock(page)
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme)
  expect(await theme()).toBe('system')
  await page.getByRole('button', { name: /Theme: system/ }).click()
  expect(await theme()).toBe('light')
  await page.getByRole('button', { name: /Theme: light/ }).click()
  expect(await theme()).toBe('dark')
  await page.reload()
  expect(await theme()).toBe('dark')
  expect(await page.evaluate(() => localStorage.getItem('tt.admin.theme'))).toBe('dark')
})

test('15 minutes of inactivity locks the workspace and clears every figure', async ({ page, context }) => {
  await mockStats(context)
  await page.clock.install()
  await unlock(page)
  await page.clock.fastForward('16:00')
  await expect(page.getByText('Locked after 15 minutes of inactivity.')).toBeVisible()
  await expect(page.getByText('Active tokens — last 7 days')).toHaveCount(0)
  await expect(page.getByLabel('Owner key')).toBeVisible()
})

test('chart is one keyboard navigator: arrows read days; the table alternative exists', async ({ page, context }) => {
  await mockStats(context)
  await unlock(page)
  const plot = page.locator('.chart-plot')
  await plot.focus()
  const readout = page.locator('.chart-readout')
  await expect(readout).toContainText('today, partial')
  await page.keyboard.press('ArrowLeft')
  await expect(readout).not.toContainText('today, partial')
  await page.keyboard.press('End')
  await expect(readout).toContainText('today, partial')
  // There is exactly ONE tab stop for the plot, not one per bar.
  expect(await page.locator('.chart-bars [tabindex]').count()).toBe(0)
  await page.getByRole('button', { name: 'View data table' }).click()
  await expect(page.getByRole('table', { name: /Daily values/ })).toBeVisible()
})

test('adoption table: sortable with aria-sort, searchable, and never fakes a zero for uncollected events', async ({ page, context }) => {
  await mockStats(context)
  await unlock(page)
  await page.goto('./analytics.html#adoption')
  // Not-collected v2 events show a badge and dashes, never 0%.
  const tasksRow = page.getByRole('row', { name: /Task created/ })
  await expect(tasksRow.getByText('Not collected')).toBeVisible()
  await expect(tasksRow.getByText('0%')).toHaveCount(0)
  // Default sort: measured tokens descending — Session details first.
  const firstRow = page.locator('tbody tr').first()
  await expect(firstRow).toContainText('Session details')
  // Sort by name announces itself and reorders.
  await page.getByRole('button', { name: /^Feature/ }).click()
  await expect(page.locator('th[aria-sort="ascending"]')).toHaveCount(1)
  await expect(page.locator('tbody tr').first()).not.toContainText('Session details')
  // Search filters the local catalogue only.
  await page.getByLabel('Search features').fill('photo')
  await expect(page.getByRole('row', { name: /Photo add attempt/ })).toBeVisible()
  await expect(page.getByRole('row', { name: /Session details/ })).toHaveCount(0)
})

test('CSV export carries definitions and denominators, neutralises formulas and contains no secrets', async ({ page, context }) => {
  await mockStats(context)
  await unlock(page)
  await page.goto('./analytics.html#access')
  const downloadP = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download CSV' }).click()
  const download = await downloadP
  const text = await (await import('node:fs/promises')).readFile(await download.path(), 'utf8')
  expect(text).toContain('period_from')
  expect(text).toContain('schema_version')
  expect(text).toContain('distinct tokens, fixed last 7 UTC days')
  expect(text).toContain('standalone_today')
  expect(text).not.toContain('test-key')
  // Every value cell that could start a formula is neutralised.
  for (const line of text.split('\r\n').slice(4)) {
    expect(line).not.toMatch(/^[=+@]/)
    for (const cell of line.split(',')) expect(cell).not.toMatch(/^[=+@]/)
  }
})

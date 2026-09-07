import { expect, test } from './fixtures'

/**
 * Phase 3 browser coverage: the single date-selection model across
 * Day/Week/Month (P3-03) and the membership-preserving Clear filters (P3-01),
 * exercised on the built app with the demo timetable.
 */

async function openDemo(page: import('@playwright/test').Page) {
  await page.goto('./')
  await page.getByRole('button', { name: /demo data/i }).click()
  const picker = page.getByRole('dialog', { name: /specialisms/i })
  if (await picker.isVisible({ timeout: 3000 }).catch(() => false)) {
    await picker.getByRole('button').last().click()
  }
  await page.getByRole('button', { name: 'Schedule' }).click()
  await expect(page.locator('.session-card').first()).toBeVisible()
}

test('week and month navigation share one selected date and survive view switches', async ({ page }) => {
  await openDemo(page)

  // Week view renders and navigates.
  await page.getByRole('tab', { name: 'Week' }).click()
  await expect(page.locator('.week-nav')).toBeVisible()
  const weekLabel = () => page.locator('.week-label').innerText()
  const thisWeek = await weekLabel()
  await page.getByRole('button', { name: 'Next week' }).click()
  const nextWeek = await weekLabel()
  expect(nextWeek).not.toEqual(thisWeek)

  // Switching to Month keeps the navigated (selected) date — the month view
  // opens on the same anchor, and switching back to Week preserves it.
  await page.getByRole('tab', { name: 'Month' }).click()
  await expect(page.locator('.month-grid')).toBeVisible()
  await page.getByRole('tab', { name: 'Week' }).click()
  expect(await weekLabel()).toEqual(nextWeek)

  // Back to this week via the label resets the shared selection.
  await page.locator('.week-label').click()
  expect(await weekLabel()).toEqual(thisWeek)

  // Month: previous month then a day pick lands the day list on that date.
  await page.getByRole('tab', { name: 'Month' }).click()
  await page.getByRole('button', { name: 'Next month' }).click()
  const dayCell = page.locator('.month-cell.has-sessions').first()
  if (await dayCell.isVisible({ timeout: 1000 }).catch(() => false)) {
    await dayCell.click()
    await expect(page.locator('.agenda')).toBeVisible()
  }
})

test('clearing filters keeps group/specialism membership', async ({ page }) => {
  await openDemo(page)
  await page.getByRole('button', { name: /^Filters/ }).click()
  const sheet = page.getByRole('dialog', { name: 'Filters' })
  await expect(sheet).toBeVisible()

  // Choose a specialism (membership) if the demo offers one.
  const membershipChip = sheet.locator('.filter-section', { hasText: 'membership' }).locator('.chip').first()
  const hasMembership = await membershipChip.isVisible({ timeout: 1000 }).catch(() => false)
  if (hasMembership) await membershipChip.click()

  // Narrow the display (self-study off), then clear display filters.
  await sheet.getByLabel(/Show self-study blocks/i).uncheck()
  await sheet.getByRole('button', { name: 'Clear display filters' }).click()

  // Display narrowing is gone…
  await expect(sheet.getByLabel(/Show self-study blocks/i)).toBeChecked()
  // …but membership survives the clear.
  if (hasMembership) await expect(membershipChip).toHaveClass(/chip-on/)
})

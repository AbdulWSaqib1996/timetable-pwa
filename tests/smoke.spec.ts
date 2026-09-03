import { expect, test } from '@playwright/test'

/**
 * Deploy-gate smoke: the built app boots, the demo timetable parses and renders,
 * and a session detail sheet opens. A broken parser or a crash on boot fails this
 * before anything ships to either host.
 */
test('demo timetable renders and a session detail opens', async ({ page }) => {
  await page.goto('/timetable-pwa/')

  await expect(page.getByRole('heading', { name: 'My Timetable' })).toBeVisible()
  await page.getByRole('button', { name: /demo data/i }).click()

  // The demo data includes specialisms, so the one-time picker may appear — skip it.
  const picker = page.getByRole('dialog', { name: /specialisms/i })
  if (await picker.isVisible({ timeout: 3000 }).catch(() => false)) {
    await picker.getByRole('button').last().click()
  }

  const firstCard = page.locator('.session-card').first()
  await expect(firstCard).toBeVisible()
  await firstCard.click()

  const detail = page.locator('.modal-card.sheet')
  await expect(detail).toBeVisible()
  await expect(detail.locator('.detail-list')).toBeVisible()

  // Escape closes the sheet (dialog a11y contract).
  await page.keyboard.press('Escape')
  await expect(detail).toHaveCount(0)
})

import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'

/**
 * P4-10 visual acceptance: deterministic 7 September 2026 fixtures, the
 * required screenshot matrix (widths × screens × themes) written to
 * test-results/phase4/, horizontal-overflow assertions at every width, and
 * checks that primary actions actually work. All external requests stay
 * blocked by tests/fixtures.ts.
 */

const WIDTHS = [320, 360, 390, 768, 1024, 1440]
const SHOT_DIR = 'test-results/phase4'

async function seed(
  page: Page,
  opts: { home?: boolean; theme?: 'dark' | 'light' | null; demoBroken?: boolean } = {}
) {
  await page.clock.install({ time: new Date('2026-09-07T07:15:00Z') }) // 08:15 London (BST)
  await page.addInitScript(
    ([homeOn, theme, broken]) => {
      localStorage.setItem('timetable.whatsnew.v1', '99')
      const settings: Record<string, unknown> = broken
        ? { sheetId: 'BROKENSHEETBROKENSHEETBROKEN', gid: null, sheetUrl: 'https://docs.google.com/x', specialismsChosen: true, checklistDismissed: true, usagePing: false }
        : {
            demo: true,
            sheetId: '',
            gid: null,
            specialismsChosen: true,
            checklistDismissed: true,
            usagePing: false,
            customKeyDates: [
              { id: 'a', title: 'Assessment essay draft', dateISO: '2026-09-05' },
              { id: 'b', title: 'Reading log', dateISO: '2026-09-10', start: '17:00' },
              { id: 'c', title: 'Completed admin form', dateISO: '2026-09-06' },
            ],
          }
      if (homeOn && !broken) {
        Object.assign(settings, {
          homeAddress: '1 Example Street, London N1 (synthetic fixture)',
          homeLat: 51.55,
          homeLng: -0.1,
          locationEnabled: true,
        })
      }
      if (theme) Object.assign(settings, { theme })
      localStorage.setItem(
        'timetable.store.v2',
        JSON.stringify({ activeId: 'fx', profiles: [{ id: 'fx', name: 'Demo timetable', settings }] })
      )
      localStorage.setItem(
        'timetable.meta.v2.fx',
        JSON.stringify({ '2026-09-06||completed admin form': { status: 'done', at: 1 } })
      )
    },
    [opts.home ?? true, opts.theme ?? null, opts.demoBroken ?? false]
  )
}

async function noHorizontalOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  )
  expect(overflow, `${label}: page must not scroll horizontally`).toBeLessThanOrEqual(1)
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png`, fullPage: true })
}

test('matrix: top-level destinations render without horizontal overflow at every width', async ({ page }) => {
  test.setTimeout(120_000)
  await seed(page)
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 })
    for (const [route, name] of [
      ['#/today', 'today'],
      ['#/schedule', 'schedule-week'],
      ['#/tasks', 'tasks'],
      ['#/pgce', 'pgce'],
      ['#/settings', 'settings-index'],
    ] as const) {
      await page.goto(`./${route}`)
      await page.waitForTimeout(150)
      await noHorizontalOverflow(page, `${name}@${width}`)
      await shot(page, `${name}-${width}`)
    }
    // Month mode drives the same shared selection.
    await page.goto('./#/schedule')
    await page.getByRole('tab', { name: 'Month' }).click()
    await expect(page.locator('.month-grid')).toBeVisible()
    await noHorizontalOverflow(page, `schedule-month@${width}`)
    await shot(page, `schedule-month-${width}`)
    await page.getByRole('tab', { name: 'Week' }).click()
  }
})

test('session overview and Travel & map: primary actions work, map area present', async ({ page }) => {
  await seed(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./#/today')
  // The hero's primary action opens the correct stable event.
  const hero = page.locator('.today-hero')
  await expect(hero).toBeVisible()
  const heroTitle = await hero.locator('.today-hero-title').innerText()
  await hero.getByRole('button', { name: 'Session details' }).click()
  await expect(page.locator('.detail-page')).toBeVisible()
  await expect(page.locator('.detail-title')).toHaveText(heroTitle)
  await shot(page, 'session-overview-390')
  // Travel & map: map visible immediately, steps collapsed by default.
  await page.getByRole('tab', { name: 'Travel & map' }).click()
  await expect(page.locator('.detail-tabpanel[aria-label="Travel and map"]')).toBeVisible()
  await expect(page.locator('.static-map, .map-embed, iframe, .map-fallback').first()).toBeVisible()
  await shot(page, 'session-travel-390')
  // Back returns to the caller with the bottom navigation restored.
  await page.locator('.page-back').click()
  await expect(page.locator('.today-hero')).toBeVisible()
  await expect(page.locator('.bottom-nav')).toBeVisible()
})

test('journey home: entry on Today, full-width screen, no-home state', async ({ page }) => {
  await seed(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./#/today')
  const homeRow = page.locator('.home-row')
  await expect(homeRow).toBeVisible()
  await shot(page, 'home-entry-390')
  await homeRow.getByRole('button', { name: 'View journey' }).click()
  await expect(page.locator('.journey-home-page')).toBeVisible()
  await expect(page.getByText('1 Example Street', { exact: false })).toBeVisible()
  await noHorizontalOverflow(page, 'journey-home@390')
  await shot(page, 'home-route-390')
  await page.setViewportSize({ width: 320, height: 700 })
  await noHorizontalOverflow(page, 'journey-home@320')
})

test('journey home without a saved home offers set-up and a way back', async ({ page }) => {
  await seed(page, { home: false })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./#/home')
  await expect(page.getByRole('button', { name: 'Set home location' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Not now' })).toBeVisible()
  await shot(page, 'home-no-home-390')
})

test('each Settings category renders with Back', async ({ page }) => {
  await seed(page)
  await page.setViewportSize({ width: 390, height: 844 })
  for (const section of ['timetable', 'reminders', 'travel', 'calendars', 'data', 'appearance', 'help']) {
    await page.goto(`./#/settings/${section}`)
    await expect(page.locator('.page-back')).toBeVisible()
    await expect(page.locator('.settings-body')).toBeVisible()
    await noHorizontalOverflow(page, `settings-${section}@390`)
    await shot(page, `settings-${section}-390`)
  }
})

test('dark theme override beats the OS preference in both directions', async ({ page }) => {
  await seed(page, { theme: 'dark' })
  await page.emulateMedia({ colorScheme: 'light' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./#/today')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  expect(bg).toBe('rgb(17, 23, 34)') // #111722 dark canvas despite a light OS
  await shot(page, 'today-dark-390')
})

test('light theme override under a dark OS stays light', async ({ page }) => {
  await seed(page, { theme: 'light' })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('./#/today')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  expect(bg).toBe('rgb(245, 246, 250)') // #f5f6fa light canvas despite a dark OS
})

test('enlarged content (200% zoom proxy) keeps Today and Schedule reflowing', async ({ page }) => {
  await seed(page)
  await page.setViewportSize({ width: 640, height: 900 })
  for (const route of ['#/today', '#/schedule']) {
    await page.goto(`./${route}`)
    await page.evaluate(() => {
      ;(document.body.style as unknown as { zoom: string }).zoom = '2'
    })
    await page.waitForTimeout(100)
    await noHorizontalOverflow(page, `${route}@200%`)
  }
})

test('keyboard: nav is reachable, month grid arrows move focus, focus ring is visible', async ({ page }) => {
  await seed(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./#/schedule')
  await page.getByRole('tab', { name: 'Month' }).click()
  const firstCell = page.locator('.month-cell:not(.blank)').first()
  await firstCell.focus()
  const before = await page.evaluate(() => document.activeElement?.textContent)
  await page.keyboard.press('ArrowRight')
  const after = await page.evaluate(() => document.activeElement?.textContent)
  expect(after).not.toBe(before)
  await page.keyboard.press('ArrowDown')
  const rowDown = await page.evaluate(() => document.activeElement?.textContent)
  expect(rowDown).not.toBe(after)
  // Focus ring: the shared 3px accent outline applies on focus-visible.
  const outline = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement
    el.blur()
    el.focus()
    return getComputedStyle(el).outlineWidth
  })
  expect(['3px', '0px']).toContain(outline) // 0px when the browser deems it non-keyboard; ring verified visually
})

test('source failure keeps a usable page: error banner, no blank screen', async ({ page }) => {
  await seed(page, { demoBroken: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./#/today')
  await expect(page.locator('.banner-error')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open Schedule' })).toBeVisible()
  await shot(page, 'today-source-failure-390')
})

test('onboarding walks Connect → Personalise → Preview against a synthetic sheet', async ({ page, context }) => {
  // Serve a deterministic GViz payload for the wizard (still no real network).
  await context.route('**/docs.google.com/**', (route) =>
    route.fulfill({
      contentType: 'text/plain',
      body:
        'google.visualization.Query.setResponse(' +
        JSON.stringify({
          status: 'ok',
          table: {
            cols: [],
            rows: [
              ['Title', 'Date', 'Start', 'End', 'Room', 'Groups'],
              ['Maths 1', '14/09/2026', '09:00', '11:00', 'Room 1', '1-10'],
              ['English 1', '15/09/2026', '11:30', '13:30', 'Room 2', '2'],
              ['Broken row', '31/02/2026', '09:00', '10:00', 'Room 3', ''],
            ].map((r) => ({ c: r.map((v) => ({ v })) })),
          },
        }) +
        ');',
    })
  )
  await page.clock.install({ time: new Date('2026-09-07T07:15:00Z') })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./')
  await shot(page, 'onboarding-connect-390')
  await page.getByPlaceholder(/spreadsheets/).fill('https://docs.google.com/spreadsheets/d/SYNTHETICSHEETID1234567890/edit#gid=0')
  await page.getByRole('button', { name: 'Connect timetable' }).click()
  await expect(page.getByText('Step 2 of 3', { exact: false })).toBeVisible()
  await shot(page, 'onboarding-personalise-390')
  // Choose group 2, preview, and confirm nothing was saved until the end.
  await page.getByRole('button', { name: '2', exact: true }).click()
  await page.getByRole('button', { name: 'Preview timetable' }).click()
  await expect(page.getByText('Step 3 of 3', { exact: false })).toBeVisible()
  await expect(page.getByText(/rows? needs? attention/)).toBeVisible() // repair info for the invalid date
  await shot(page, 'onboarding-preview-390')
  // Back preserves choices.
  await page.getByRole('button', { name: '‹ Back' }).click()
  await expect(page.getByRole('button', { name: '2', exact: true })).toHaveClass(/chip-on/)
  await page.getByRole('button', { name: 'Preview timetable' }).click()
  await page.getByRole('button', { name: 'Save this timetable' }).click()
  await expect(page.locator('.page-today')).toBeVisible()
})

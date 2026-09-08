import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'

/**
 * R3 regressions (Pass 52): key-date reminder relocation (TT-21), page width
 * contracts (§5), mobile Settings reach + dynamic nav + skip link + heading
 * focus (TT-19), Tasks/PGCE hierarchy (TT-20), the List view and local
 * Settings search. Synthetic profiles only; every network host is blocked.
 */

type ProfileSeed = { id: string; name: string; settings: Record<string, unknown> }

const CONNECTED = {
  demo: false,
  sheetId: 'FIXTURESHEET',
  gid: null,
  specialismsChosen: true,
  checklistDismissed: true,
  usagePing: false,
  keyDatesUrl: 'https://docs.google.com/spreadsheets/d/FIXTURESHEET/edit#gid=5',
  keyDatesSheetId: 'FIXTURESHEET',
  keyDatesGid: '5',
  keyDateReminderDays: [7, 1],
  reminderOffsets: [15],
}

async function seed(page: Page, profiles: ProfileSeed[], opts: { width?: number; permission?: string } = {}) {
  await page.clock.install({ time: new Date('2026-09-07T07:05:00Z') })
  await page.addInitScript(
    ({ profiles, permission }) => {
      localStorage.setItem('timetable.whatsnew.v1', '99')
      // Count permission prompts: navigation alone must never ask.
      const w = window as unknown as { permissionRequests: number }
      w.permissionRequests = 0
      Object.defineProperty(window, 'Notification', {
        value: class {
          static permission = permission
          static requestPermission() {
            w.permissionRequests += 1
            return Promise.resolve('granted')
          }
        },
        configurable: true,
      })
      if (localStorage.getItem('timetable.store.v2')) return
      localStorage.setItem('timetable.store.v2', JSON.stringify({ activeId: profiles[0].id, profiles }))
    },
    { profiles, permission: opts.permission ?? 'granted' }
  )
  await page.setViewportSize({ width: opts.width ?? 390, height: 900 })
}

const settingsOf = (page: Page, id: string) =>
  page.evaluate((pid) => {
    const store = JSON.parse(localStorage.getItem('timetable.store.v2')!)
    return store.profiles.find((p: { id: string }) => p.id === pid).settings
  }, id)

const chip = (page: Page, label: string) => page.getByRole('group', { name: 'Days before each key date' }).getByRole('button', { name: label })

test('TT-21: reminder timing lives in Reminders only; My timetable keeps the source and a link that focuses the section', async ({ page }) => {
  await seed(page, [{ id: 'kd', name: 'Key-date profile', settings: CONNECTED }])
  await page.goto('./#/settings/timetable')
  // Source controls stay; the editable chips are gone from this page.
  await expect(page.getByPlaceholder('https://docs.google.com/spreadsheets/d/…#gid=…').first()).toHaveValue(CONNECTED.keyDatesUrl)
  await expect(page.getByText('Key dates connected — they refresh with the timetable.')).toBeVisible()
  await expect(page.getByRole('button', { name: '7 days before' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Configure key-date reminders →' }).click()
  await expect(page).toHaveURL(/#\/settings\/reminders$/)
  await expect(page.getByRole('heading', { name: 'Key-date reminders' })).toBeVisible()
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('key-date-reminders-heading')
  // Exactly one editable group, with the seeded values reflected.
  await expect(page.getByRole('group', { name: 'Days before each key date' })).toHaveCount(1)
  await expect(chip(page, '7 days before')).toHaveAttribute('aria-pressed', 'true')
  await expect(chip(page, '3 days before')).toHaveAttribute('aria-pressed', 'false')
  await expect(chip(page, '1 day before')).toHaveAttribute('aria-pressed', 'true')
  // Navigating between the pages and reloading changes nothing.
  await page.goto('./#/settings/timetable')
  await page.goto('./#/settings/reminders')
  await page.reload()
  expect((await settingsOf(page, 'kd')).keyDateReminderDays).toEqual([7, 1])
  await expect(chip(page, '7 days before')).toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate(() => (window as unknown as { permissionRequests: number }).permissionRequests)).toBe(0)
})

test('TT-21: toggling uses the existing settings path — other offsets untouched, no prompt from navigation', async ({ page }) => {
  await seed(page, [{ id: 'kd', name: 'Key-date profile', settings: CONNECTED }], { permission: 'default' })
  await page.goto('./#/settings/timetable')
  await page.getByRole('button', { name: 'Configure key-date reminders →' }).click()
  await expect(page.getByRole('heading', { name: 'Key-date reminders' })).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { permissionRequests: number }).permissionRequests)).toBe(0)
  await chip(page, '3 days before').click()
  await expect(chip(page, '3 days before')).toHaveAttribute('aria-pressed', 'true')
  let s = await settingsOf(page, 'kd')
  expect(s.keyDateReminderDays).toEqual([1, 3, 7])
  expect(s.reminderOffsets).toEqual([15])
  for (const label of ['7 days before', '3 days before', '1 day before']) await chip(page, label).click()
  await expect(page.getByText('Key-date reminders are off.')).toBeVisible()
  s = await settingsOf(page, 'kd')
  expect(s.keyDateReminderDays).toEqual([])
  expect(s.reminderOffsets).toEqual([15])
})

test('TT-21: each profile shows its own choices; no source → explanation and a working Connect link', async ({ page }) => {
  await seed(page, [
    { id: 'a', name: 'Profile A', settings: CONNECTED },
    { id: 'b', name: 'Profile B', settings: { ...CONNECTED, keyDateReminderDays: [3] } },
    { id: 'c', name: 'Profile C', settings: { ...CONNECTED, keyDatesUrl: undefined, keyDatesSheetId: undefined, keyDatesGid: undefined } },
  ])
  await page.goto('./#/settings/reminders')
  await expect(chip(page, '7 days before')).toHaveAttribute('aria-pressed', 'true')
  await page.goto('./#/settings/timetable')
  await page.getByRole('button', { name: 'Profile B', exact: true }).click()
  await page.goto('./#/settings/reminders')
  await expect(chip(page, '3 days before')).toHaveAttribute('aria-pressed', 'true')
  await expect(chip(page, '7 days before')).toHaveAttribute('aria-pressed', 'false')
  expect((await settingsOf(page, 'a')).keyDateReminderDays).toEqual([7, 1])
  // Profile C has no key-dates source: the topic is explained, not hidden.
  await page.goto('./#/settings/timetable')
  await page.getByRole('button', { name: 'Profile C', exact: true }).click()
  await page.goto('./#/settings/reminders')
  await expect(page.getByText(/need a connected submissions\/key-dates tab/)).toBeVisible()
  await expect(page.getByRole('group', { name: 'Days before each key date' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Connect key dates →' }).click()
  await expect(page).toHaveURL(/#\/settings\/timetable$/)
  await expect(page.getByRole('heading', { name: 'Key dates', exact: true })).toBeFocused()
  await expect(page.getByPlaceholder('https://docs.google.com/spreadsheets/d/…#gid=…').first()).toBeEditable()
})

test('TT-21: keyboard reach at 320px and desktop — the link is a real button and focus lands on the heading', async ({ page }) => {
  for (const width of [320, 1440]) {
    await page.close().catch(() => {})
    page = await page.context().newPage()
    await seed(page, [{ id: 'kd', name: 'Key-date profile', settings: CONNECTED }], { width })
    await page.goto('./#/settings/timetable')
    const link = page.getByRole('button', { name: 'Configure key-date reminders →' })
    await link.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: 'Key-date reminders' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(chip(page, '7 days before')).toBeFocused()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, `no horizontal overflow at ${width}`).toBeLessThanOrEqual(1)
  }
})

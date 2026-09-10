import { expect, test } from './fixtures'

/**
 * Pass 58 — the owner withdrew the cloud backup providers (Google Drive,
 * iCloud). Data & devices keeps exactly the standard file Back up / Restore
 * and device sync; nothing may mention a cloud provider, and no Google
 * script or endpoint may be requested.
 */

const DEMO = { demo: true, sheetId: '', gid: null, specialismsChosen: true, checklistDismissed: true, usagePing: false }

test('Data & devices offers only the standard Back up / Restore and sync — no cloud provider cards, copy or requests', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (r) => requests.push(r.url()))
  await page.addInitScript((DEMO) => {
    localStorage.setItem('timetable.whatsnew.v1', '99')
    localStorage.setItem('timetable.store.v2', JSON.stringify({ activeId: 'd', profiles: [{ id: 'd', name: 'Demo learner', settings: DEMO }] }))
    // A pre-Pass-58 settings row with the old bookkeeping must not resurrect anything.
    localStorage.setItem('timetable.backup.v1', JSON.stringify({ lastBackupAt: Date.now(), history: [{ at: Date.now(), profiles: ['d'], all: true, kind: 'cloud' }] }))
  }, DEMO)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./#/settings/data')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.locator('#backup')).toBeVisible()
  await expect(page.locator('#sync')).toBeVisible()
  await expect(page.locator('#cloud-backups')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: /cloud backups/i })).toHaveCount(0)
  await expect(page.getByText(/google drive|icloud|reconnect to back up|session passphrase/i)).toHaveCount(0)
  await expect(page.getByRole('button', { name: /back up/i }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /restore/i }).first()).toBeVisible()
  // Old history entries are still readable, just no longer labelled as cloud.
  await expect(page.getByText(/Backup coverage by timetable/)).toBeVisible()
  await expect(page.getByText(/\(cloud\)/)).toHaveCount(0)
  expect(requests.filter((u) => /accounts\.google\.com|googleapis\.com/.test(u))).toEqual([])
  // Settings search no longer knows the removed section.
  await page.goto('./#/settings')
  const search = page.getByRole('searchbox').or(page.getByPlaceholder(/search settings/i)).first()
  await search.fill('google drive')
  await expect(page.getByText(/cloud backups/i)).toHaveCount(0)
})

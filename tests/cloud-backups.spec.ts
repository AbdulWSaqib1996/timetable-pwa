import { expect, test } from './fixtures'
import type { Page, Route } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { isEnvelope, openBackup } from '../shared/backupEnvelope.js'

/**
 * R5b / NF-09 — Google Drive app-data backups and the iCloud Drive file path.
 * Google Identity Services and the Drive API are stubbed in-page/in-route with
 * synthetic content only; nothing reaches Google. Covers: missing
 * configuration, sign-in cancel/success/expiry, upload → verify → list,
 * verification failure discarding the object, restore through the preview,
 * retention touching only this installation, disconnect keeping snapshots,
 * iCloud download fallback + restore from file, and the daily automatic mode.
 */

const DEMO = { demo: true, sheetId: '', gid: null, specialismsChosen: true, checklistDismissed: true, usagePing: false, groupToken: 'device-secret-token', groupMemberId: 'm1' }
const PASS = 'correct horse battery staple'
const INSTALL = 'a1b2c3d4e5f60718a1b2c3d4e5f60718'

type File = { id: string; name: string; appProperties: Record<string, string>; body: string; createdTime: string }

function driveMock() {
  const state = { files: [] as File[], uploads: 0, corruptNextDownload: false, failNextAuth: false, seq: 0 }
  const handler = async (route: Route) => {
    const url = new URL(route.request().url())
    const host = url.hostname
    if (['127.0.0.1', 'localhost'].includes(host)) return route.continue()
    if (host !== 'www.googleapis.com') return route.abort()
    if (state.failNextAuth) {
      state.failNextAuth = false
      return route.fulfill({ status: 401, json: { error: 'expired' } })
    }
    const m = route.request().method()
    const path = url.pathname
    if (m === 'POST' && path.startsWith('/upload/drive/v3/files')) {
      state.uploads++
      const raw = route.request().postData() ?? ''
      const boundary = raw.split('\r\n')[0]
      const parts = raw.split(boundary).filter((p) => p.includes('\r\n\r\n'))
      const metadata = JSON.parse(parts[0].split('\r\n\r\n')[1].trim())
      const body = parts[1].split('\r\n\r\n')[1].replace(/\r\n$/, '')
      const file: File = { id: `f${++state.seq}`, name: metadata.name, appProperties: metadata.appProperties, body, createdTime: new Date().toISOString() }
      state.files.push(file)
      return route.fulfill({ json: { id: file.id, name: file.name, size: String(body.length), createdTime: file.createdTime, appProperties: file.appProperties } })
    }
    if (m === 'GET' && path === '/drive/v3/files') {
      return route.fulfill({ json: { files: state.files.map((f) => ({ id: f.id, name: f.name, size: String(f.body.length), createdTime: f.createdTime, appProperties: f.appProperties })) } })
    }
    const idMatch = path.match(/^\/drive\/v3\/files\/([^/]+)$/)
    if (idMatch) {
      const file = state.files.find((f) => f.id === decodeURIComponent(idMatch[1]))
      if (!file) return route.fulfill({ status: 404, json: { error: 'not found' } })
      if (m === 'GET' && url.searchParams.get('alt') === 'media') {
        if (state.corruptNextDownload) {
          state.corruptNextDownload = false
          return route.fulfill({ body: file.body.slice(0, -5) + 'XXXXX', contentType: 'application/json' })
        }
        return route.fulfill({ body: file.body, contentType: 'application/json' })
      }
      if (m === 'PATCH') {
        const patch = route.request().postDataJSON() as { appProperties?: Record<string, string> }
        file.appProperties = { ...file.appProperties, ...(patch.appProperties ?? {}) }
        return route.fulfill({ json: { id: file.id, appProperties: file.appProperties } })
      }
      if (m === 'DELETE') {
        state.files = state.files.filter((f) => f.id !== file.id)
        return route.fulfill({ status: 204, body: '' })
      }
    }
    return route.fulfill({ status: 400, json: { error: `unexpected ${m} ${path}` } })
  }
  return { state, handler }
}

async function seed(page: Page, opts: { configured?: boolean; gis?: 'ok' | 'cancel' | 'noscope'; settings?: Record<string, unknown>; installation?: string; noShare?: boolean } = {}) {
  await page.clock.install({ time: new Date('2026-09-07T07:05:00Z') })
  await page.addInitScript(
    ({ configured, gis, settings, installation }) => {
      localStorage.setItem('timetable.whatsnew.v1', '99')
      localStorage.setItem('timetable.dev.google-client-id', configured ? 'test-client.apps.googleusercontent.com' : 'off')
      localStorage.setItem('timetable.installation.v1', installation)
      // navigator.share is absent in headless Chromium already; keep it that way explicitly.
      Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
      // Google Identity Services stub: a token client that answers synchronously.
      const oauth2 = {
        initTokenClient(cfg: { callback: (r: Record<string, unknown>) => void; error_callback?: (e: { type: string }) => void }) {
          return {
            callback: cfg.callback,
            requestAccessToken() {
              if (gis === 'cancel') return cfg.error_callback?.({ type: 'popup_closed' })
              if (gis === 'noscope') return cfg.callback({ access_token: 'tok', expires_in: 3600, scope: 'openid' })
              cfg.callback({ access_token: 'tok-1', expires_in: 3600, scope: 'https://www.googleapis.com/auth/drive.appdata' })
            },
          }
        },
        hasGrantedAllScopes(r: { scope?: string }, ...scopes: string[]) {
          return scopes.every((s) => (r.scope ?? '').includes(s))
        },
        revoke(_t: string, done?: () => void) {
          ;(window as unknown as { revoked: number }).revoked = ((window as unknown as { revoked: number }).revoked ?? 0) + 1
          done?.()
        },
      }
      ;(window as unknown as { google: unknown }).google = { accounts: { oauth2 } }
      if (localStorage.getItem('timetable.store.v2')) return
      localStorage.setItem('timetable.store.v2', JSON.stringify({ activeId: 'd', profiles: [{ id: 'd', name: 'Demo learner', settings }] }))
      localStorage.setItem('timetable.meta.v2.d', JSON.stringify({ '2026-09-07|14:30|maths 1': { note: 'Keep this note', at: 1 } }))
    },
    { configured: opts.configured ?? true, gis: opts.gis ?? 'ok', settings: { ...DEMO, ...(opts.settings ?? {}) }, installation: opts.installation ?? INSTALL }
  )
  await page.setViewportSize({ width: 390, height: 900 })
}

const section = (page: Page) => page.locator('#cloud-backups')
const googleCard = (page: Page) => section(page).locator('.cloud-card').first()
const icloudCard = (page: Page) => section(page).locator('.cloud-card').nth(1)

async function connectAndUnlock(page: Page) {
  await page.goto('./#/settings/data')
  await googleCard(page).getByRole('button', { name: 'Connect Google Drive' }).click()
  await expect(googleCard(page)).toContainText('connected this session')
  await section(page).getByLabel('Backup passphrase').fill(PASS)
  await section(page).getByRole('button', { name: 'Unlock' }).click()
  await expect(section(page).getByText(/Unlocked for this session/)).toBeVisible()
}

test('not configured: the Google card explains itself and cannot connect; iCloud file path still works', async ({ page, context }) => {
  await context.route('**/*', driveMock().handler)
  await seed(page, { configured: false })
  await page.goto('./#/settings/data')
  await expect(googleCard(page)).toContainText('not configured for this build')
  await expect(googleCard(page).getByRole('button', { name: 'Connect Google Drive' })).toBeDisabled()
  await expect(icloudCard(page).getByRole('button', { name: 'Save to iCloud Drive' })).toBeDisabled() // no passphrase yet
})

test('sign-in cancelled or missing scope are usable states; nothing is stored', async ({ page, context }) => {
  await context.route('**/*', driveMock().handler)
  await seed(page, { gis: 'cancel' })
  await page.goto('./#/settings/data')
  await googleCard(page).getByRole('button', { name: 'Connect Google Drive' }).click()
  await expect(googleCard(page).getByRole('alert')).toContainText('Sign-in was cancelled')
  await expect(googleCard(page)).toContainText('not connected')
  await page.close()
  const page2 = await context.newPage()
  await seed(page2, { gis: 'noscope' })
  await page2.goto('./#/settings/data')
  await googleCard(page2).getByRole('button', { name: 'Connect Google Drive' }).click()
  await expect(googleCard(page2).getByRole('alert')).toContainText('app-data permission was not granted')
  const stored = await page2.evaluate(() => Object.entries(localStorage).map(([k, v]) => `${k}=${v}`).join('\n'))
  expect(stored).not.toContain('tok-1')
  expect(stored).not.toContain('access_token')
})

test('Google: back up → verify → list; the archive excludes device credentials; verification failure discards the object; expiry asks to reconnect; disconnect keeps snapshots', async ({ page, context }) => {
  test.setTimeout(120_000)
  const drive = driveMock()
  await context.route('**/*', drive.handler)
  await seed(page)
  await connectAndUnlock(page)
  await googleCard(page).getByRole('button', { name: 'Back up now' }).click()
  await expect(googleCard(page).getByRole('status')).toContainText('Backup complete and verified')
  expect(drive.state.files).toHaveLength(1)
  const f = drive.state.files[0]
  expect(f.name).toMatch(/^mt-[0-9a-f]{24}-\d{4}-\d{2}-\d{2}T/)
  expect(f.name).not.toContain('Demo')
  expect(f.appProperties.installationId).toBe(INSTALL)
  expect(f.appProperties.verified).toBe('1')
  expect(f.appProperties.sha256).toHaveLength(64)
  expect(isEnvelope(f.body)).toBe(true)
  const opened = await openBackup(f.body, PASS)
  expect(opened.ok).toBe(true)
  const plain = (opened as { plaintext: string }).plaintext
  expect(plain).toContain('Demo learner')
  expect(plain).toContain('Keep this note')
  expect(plain).not.toContain('device-secret-token')
  expect(plain).not.toContain('groupMemberId')
  await expect(googleCard(page).getByRole('list', { name: 'Snapshots in Google Drive' }).getByRole('listitem')).toHaveCount(1)
  await expect(googleCard(page)).toContainText('(this device)')
  await expect(googleCard(page)).toContainText('verified')
  const s1 = await page.evaluate(() => JSON.parse(localStorage.getItem('timetable.store.v2')!).profiles[0].settings.cloudBackups)
  expect(s1.google.lastBackupAt).toBeGreaterThan(0)
  // No token anywhere in storage.
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('tok-1')

  // Verification failure: the read-back differs → error, object discarded, last backup unchanged.
  drive.state.corruptNextDownload = true
  await googleCard(page).getByRole('button', { name: 'Back up now' }).click()
  await expect(googleCard(page).getByRole('alert')).toContainText('did not read back intact')
  expect(drive.state.files).toHaveLength(1)
  const s2 = await page.evaluate(() => JSON.parse(localStorage.getItem('timetable.store.v2')!).profiles[0].settings.cloudBackups)
  expect(s2.google.lastBackupAt).toBe(s1.google.lastBackupAt)

  // Expiry (401) → "Reconnect to back up"; no popup opened on its own.
  drive.state.failNextAuth = true
  await googleCard(page).getByRole('button', { name: 'Refresh list' }).click()
  await expect(googleCard(page)).toContainText('sign-in expired')
  await expect(googleCard(page).getByRole('button', { name: 'Reconnect to back up' })).toBeVisible()
  await googleCard(page).getByRole('button', { name: 'Reconnect to back up' }).click()
  await expect(googleCard(page)).toContainText('connected this session')

  // Disconnect revokes the token but never deletes snapshots.
  await googleCard(page).getByRole('button', { name: 'Disconnect (keeps snapshots)' }).click()
  await expect(googleCard(page)).toContainText('not connected')
  expect(drive.state.files).toHaveLength(1)
  expect(await page.evaluate(() => (window as unknown as { revoked: number }).revoked)).toBe(1)
})

test('Google: restore goes through the preview and recovery journal; a wrong passphrase never commits', async ({ page, context }) => {
  test.setTimeout(120_000)
  const drive = driveMock()
  await context.route('**/*', drive.handler)
  await seed(page)
  await connectAndUnlock(page)
  await googleCard(page).getByRole('button', { name: 'Back up now' }).click()
  await expect(googleCard(page).getByRole('status')).toContainText('Backup complete')
  // Lose the note locally, then restore the snapshot.
  await page.evaluate(() => localStorage.setItem('timetable.meta.v2.d', JSON.stringify({})))
  await googleCard(page).getByRole('button', { name: 'Restore…' }).click()
  const restore = page.getByRole('dialog', { name: 'Restore backup' })
  await expect(restore.getByRole('list', { name: 'Backup contents' })).toContainText('Demo learner')
  const reloaded = page.waitForEvent('load')
  await restore.getByRole('button', { name: 'Restore', exact: true }).click()
  await reloaded
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  const meta = await page.evaluate(() => JSON.parse(localStorage.getItem('timetable.meta.v2.d')!))
  expect(meta['2026-09-07|14:30|maths 1'].note).toBe('Keep this note')
  const cb = await page.evaluate(() => JSON.parse(localStorage.getItem('timetable.store.v2')!).profiles[0].settings.cloudBackups)
  expect(cb.google.restores).toHaveLength(1)
  // After reload the session key is gone: a restore asks for the passphrase and a wrong one changes nothing.
  await page.goto('./#/settings/data')
  await googleCard(page).getByRole('button', { name: 'Connect Google Drive' }).click()
  await page.evaluate(() => localStorage.setItem('timetable.meta.v2.d', JSON.stringify({})))
  await googleCard(page).getByRole('button', { name: 'Restore…' }).click()
  await restore.getByLabel('Passphrase').fill('wrong passphrase 123')
  await restore.getByRole('button', { name: 'Unlock' }).click()
  await expect(restore.getByRole('alert')).toContainText('Nothing on this device changed')
  expect(await page.evaluate(() => localStorage.getItem('timetable.meta.v2.d'))).toBe('{}')
})

test('retention prunes only this installation beyond ten; other devices’ snapshots stay', async ({ page, context }) => {
  test.setTimeout(120_000)
  const drive = driveMock()
  await context.route('**/*', drive.handler)
  const props = (i: number, installation: string) => ({ backupId: `b${i}`, formatVersion: '1', installationId: installation, scopeId: 'all', createdAt: new Date(2026, 7, 1 + i).toISOString(), size: '10', sha256: 'x'.repeat(64), profileCount: '1', recordCount: '1', attachmentCount: '0', deviceLabel: 'Old device', appVersion: 'v', verified: '1' })
  for (let i = 0; i < 12; i++) drive.state.files.push({ id: `mine${i}`, name: `mt-b${i}.json`, appProperties: props(i, INSTALL), body: 'old', createdTime: new Date(2026, 7, 1 + i).toISOString() })
  for (let i = 0; i < 2; i++) drive.state.files.push({ id: `other${i}`, name: `mt-o${i}.json`, appProperties: props(50 + i, 'ffffffffffffffffffffffffffffffff'), body: 'old', createdTime: new Date(2026, 7, 20 + i).toISOString() })
  await seed(page)
  await connectAndUnlock(page)
  await googleCard(page).getByLabel(/Keep only this device/).check()
  await googleCard(page).getByRole('button', { name: 'Back up now' }).click()
  await expect(googleCard(page).getByRole('status')).toContainText(/older snapshots? from this device removed/)
  const mine = drive.state.files.filter((f) => f.appProperties.installationId === INSTALL)
  const others = drive.state.files.filter((f) => f.appProperties.installationId !== INSTALL)
  expect(mine).toHaveLength(10)
  expect(others).toHaveLength(2)
  // The newest (just uploaded) survived; the oldest went.
  expect(mine.some((f) => f.id.startsWith('f'))).toBe(true)
  expect(mine.some((f) => f.id === 'mine0')).toBe(false)
  // Only this device's snapshots offer Delete.
  const rows = googleCard(page).getByRole('list', { name: 'Snapshots in Google Drive' }).getByRole('listitem')
  await expect(rows).toHaveCount(12)
  await expect(googleCard(page).getByRole('button', { name: /^Delete snapshot/ })).toHaveCount(10)
})

test('iCloud Drive: no share support → download of the sealed file, honest wording, and restore from that file', async ({ page, context }) => {
  test.setTimeout(120_000)
  await context.route('**/*', driveMock().handler)
  await seed(page)
  await page.goto('./#/settings/data')
  await expect(icloudCard(page)).toContainText('download only on this browser')
  await section(page).getByLabel('Backup passphrase').fill(PASS)
  await section(page).getByRole('button', { name: 'Unlock' }).click()
  const download = page.waitForEvent('download')
  await icloudCard(page).getByRole('button', { name: 'Save to iCloud Drive' }).click()
  const path = await (await download).path()
  const text = readFileSync(path!, 'utf8')
  expect(isEnvelope(text)).toBe(true)
  await expect(icloudCard(page).getByRole('status')).toContainText('not a confirmed cloud backup')
  await expect(icloudCard(page)).toContainText('Last file export:')
  await expect(icloudCard(page)).toContainText('downloaded')
  const cb = await page.evaluate(() => JSON.parse(localStorage.getItem('timetable.store.v2')!).profiles[0].settings.cloudBackups)
  expect(cb.icloud.lastOutcome).toBe('downloaded')
  expect(cb.google?.lastBackupAt).toBeUndefined()
  // Restore from the picked file through the same preview (passphrase pre-unlocked this session).
  await page.evaluate(() => localStorage.setItem('timetable.meta.v2.d', JSON.stringify({})))
  await icloudCard(page).locator('input[type="file"]').setInputFiles({ name: 'from-icloud.json', mimeType: 'application/json', buffer: Buffer.from(text) })
  const restore = page.getByRole('dialog', { name: 'Restore backup' })
  await expect(restore.getByRole('list', { name: 'Backup contents' })).toContainText('Demo learner')
  const reloaded = page.waitForEvent('load')
  await restore.getByRole('button', { name: 'Restore', exact: true }).click()
  await reloaded
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  expect((await page.evaluate(() => JSON.parse(localStorage.getItem('timetable.meta.v2.d')!)))['2026-09-07|14:30|maths 1'].note).toBe('Keep this note')
})

test('automatic mode: one snapshot per day after a change, only while connected and unlocked; never without them', async ({ page, context }) => {
  test.setTimeout(120_000)
  const drive = driveMock()
  await context.route('**/*', drive.handler)
  await seed(page)
  await connectAndUnlock(page)
  await googleCard(page).getByLabel(/Back up when I use the app/).check()
  expect(drive.state.uploads).toBe(0)
  // A data change → 30 s debounce → one upload.
  await page.goto('./#/schedule')
  await page.locator('.day-list .session-card', { hasText: 'Maths 1' }).click()
  await page.getByRole('button', { name: '✓ Attended' }).click()
  await page.clock.runFor(31_000)
  await expect.poll(() => drive.state.uploads, { timeout: 15_000 }).toBe(1)
  // A second change within 24 h does not upload again.
  await page.getByRole('button', { name: '✗ Absent' }).click()
  await page.clock.runFor(31_000)
  await page.waitForTimeout(500)
  expect(drive.state.uploads).toBe(1)
  // After a reload the session key and token are gone: no automatic upload, and nothing pops up.
  await page.reload()
  await page.goto('./#/schedule')
  await page.locator('.day-list .session-card', { hasText: 'Maths 1' }).click()
  await page.getByRole('button', { name: '✓ Attended' }).click()
  await page.clock.runFor(31_000)
  await page.waitForTimeout(500)
  expect(drive.state.uploads).toBe(1)
})

import { expect, test } from './fixtures'
import type { Page, Route } from '@playwright/test'

/**
 * Audit Batch B (Pass 78) — positive regression tests for B05, B06, B08 and
 * B10 (B07 is covered by tests/unit/route-url.test.mjs plus the journey specs;
 * B09 by tests/keydate-dedupe.spec.ts; the worker side of B08/B10 by
 * tests/unit/mentor-store.test.mjs):
 *  - B05: the portal's failure matrix — 503, connection loss, 401, 403, 410
 *         and a decryption failure each name what happened, leave a named
 *         Retry and never a permanently disabled control; a failed send keeps
 *         the draft and the retry reuses the same client id; a response that
 *         lands after sign-out is discarded;
 *  - B06: an error loading mentors or reading the wallet is shown as an error
 *         with Retry — never as "no mentor yet" or "no wallet files";
 *  - B08: pausing on this device keeps the credential; the paused device can
 *         still revoke; End mentor access previews its impact, closes the
 *         space and can be reopened;
 *  - B10: Delete local pack shows the share summary, asks first and offers
 *         Undo; Unshare calls the owner-authorised route and records it;
 *         reflection deletion asks first and offers Undo.
 */

test.use({ timezoneId: 'Europe/London' })

const SPACE = 'a'.repeat(24)
const OWNER = 'b'.repeat(48)
const MENTOR_A = 'mt0123456789ab'
const MENTOR_B = 'mt0123456789cd'
const SESSION = 'c'.repeat(48)
const SESSION_STORAGE_KEY = 'timetable.mentor.session.v1'

type Mode = 'ok' | 'abort' | 'slow' | 'garbage' | number
/** A switchable stand-in for the worker's mentor routes: one mode per path, every call recorded. */
function fakeService() {
  const modes: Record<string, Mode> = {}
  const calls: { path: string; body: Record<string, unknown> }[] = []
  const state = { revokedA: false, closedAt: null as number | null, unshared: false }
  const handler = async (route: Route) => {
    const path = new URL(route.request().url()).pathname
    const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>
    calls.push({ path, body })
    const reply = (status: number, obj: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(obj) })
    const mode = modes[path] ?? 'ok'
    if (mode === 'abort') return route.abort('connectionfailed')
    if (typeof mode === 'number') return reply(mode, { error: mode === 403 ? 'access is not active' : mode === 401 ? 'sign in again' : mode === 410 ? 'attachment expired' : 'service unavailable' })
    if (mode === 'slow') await new Promise((r) => setTimeout(r, 1500))
    const mentors = [
      { id: MENTOR_A, name: 'Synthetic mentor', createdAt: 1, revokedAt: state.revokedA ? 2 : null, lastSeenAt: null },
      { id: MENTOR_B, name: 'Second mentor', createdAt: 1, revokedAt: null, lastSeenAt: null },
    ]
    if (path === '/mentor/login') return reply(200, { mentorId: body.mentorId, name: 'Synthetic mentor', session: SESSION, expiresAt: 0 })
    if (path === '/mentor/packs') return reply(200, { mentor: { id: MENTOR_A, name: 'Synthetic mentor' }, packs: [{ id: 'k1', title: 'Progress review 1', text: 'PACK TEXT', sharedAt: 1, attachments: [{ id: 'att1', name: 'plan.pdf', size: 2048 }] }], feedback: [] })
    if (path === '/mentor/feedback') return reply(200, { feedbackId: 'fb0123456789ab', at: Date.now(), sig: 'f'.repeat(64) })
    if (path === '/mentor/attachment') return reply(200, mode === 'garbage' ? { name: 'plan.pdf', key: 'a'.repeat(64), iv: 'not-base64!!', data: 'not-base64!!' } : { name: 'plan.pdf', key: 'a'.repeat(64), iv: 'AAAAAAAAAAAAAAAA', data: 'AAAA' })
    if (path === '/mentor/mentors') return reply(200, { mentors, invites: [], packs: [{ id: 'k1', title: 'Progress review 1', sharedAt: 1, mentorIds: state.unshared ? [] : [MENTOR_A], attachments: 0 }], closedAt: state.closedAt })
    if (path === '/mentor/revoke') { state.revokedA = true; return reply(200, { ok: true, revokedAt: 2 }) }
    if (path === '/mentor/close') { state.closedAt = 5; return reply(200, { ok: true, closedAt: 5 }) }
    if (path === '/mentor/reopen') { state.closedAt = null; return reply(200, { ok: true, closedAt: null }) }
    if (path === '/mentor/unshare') { state.unshared = true; return reply(200, { ok: true, revision: 2, unsharedAt: 7, unshared: true }) }
    if (path === '/mentor/share') return reply(200, { ok: true, packId: (body.pack as { id: string }).id, revision: body.revision, sharedAt: 1, attachments: 0 })
    return reply(404, { error: 'not found' })
  }
  return { handler, modes, calls, state }
}

const base = () => ({
  targets: [], meetings: [], observations: [], audits: [], tasks: [], exceptions: [], plans: [], commitments: [], placements: [], schools: [], programmes: [], packs: [], requirements: [], milestones: [], cycles: [], preps: [], goals: [], resources: [], projects: [], readings: [], contacts: [], questions: [], protected: [], supportNotes: [], examples: [], experience: [], reviews: [], lessons: [],
  reflections: [{ id: 'r1', weekISO: '2026-09-14', wentWell: 'Clear modelling', challenges: '', focus: 'Wait time', standards: ['TS4'], at: 10 }],
  reviewPacks: [{ id: 'k1', title: 'Progress review 1', state: 'draft', createdISO: '2026-09-14', items: [], attachments: [], sharing: { revision: 1, sharedAt: 1, mentorIds: [MENTOR_A], attachmentUids: [], textHash: 'abc' }, at: 1 }],
})

async function seed(page: Page, settings: Record<string, unknown> = { mentorSpaceId: SPACE, mentorOwnerToken: OWNER }, admin: Record<string, unknown> = base()) {
  await page.clock.install({ time: new Date('2026-09-14T06:05:00Z') })
  await page.addInitScript(
    ({ admin, settings }) => {
      localStorage.setItem('timetable.whatsnew.v1', '99')
      if (localStorage.getItem('timetable.store.v2')) return
      localStorage.setItem('timetable.store.v2', JSON.stringify({ activeId: 'fx', profiles: [{ id: 'fx', name: 'My timetable', settings: { demo: false, sheetId: 'FIXTURESHEET-FIXTURESHEET-FIXTURESHEET-0001', gid: null, specialismsChosen: true, checklistDismissed: true, usagePing: false, ...settings } }] }))
      localStorage.setItem('timetable.cache.v2.fx', JSON.stringify({ fetchedAt: Date.now(), sessions: [] }))
      localStorage.setItem('timetable.admin.v1.fx', JSON.stringify(admin))
    },
    { admin, settings }
  )
  await page.setViewportSize({ width: 390, height: 844 })
}
const admin = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('timetable.admin.v1.fx') ?? '{}'))
const settingsOf = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('timetable.store.v2')!).profiles[0].settings)

test('B05: the portal names each failure, keeps a named Retry and the draft, reuses the client id on retry, and discards a response that lands after sign-out', async ({ page, context }) => {
  const svc = fakeService()
  await context.route('**/mentor/**', svc.handler)
  await page.setViewportSize({ width: 390, height: 844 })
  // Sign-in against a failing service: the alert says what happened and the control is not stuck disabled.
  svc.modes['/mentor/login'] = 503
  await page.goto(`./mentor.html#/space/${SPACE}/${MENTOR_A}`)
  await page.getByLabel(/Passphrase/).fill('correct horse battery')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('alert')).toContainText('status 503')
  const retrySignIn = page.getByRole('button', { name: 'Retry sign in' })
  await expect(retrySignIn).toBeEnabled()
  await expect(page.getByLabel(/Passphrase/)).toHaveValue('correct horse battery')
  // Connection loss while loading packs after a successful sign-in: connection wording, Retry works.
  svc.modes['/mentor/login'] = 'ok'
  svc.modes['/mentor/packs'] = 'abort'
  await retrySignIn.click()
  await expect(page.getByText('Signed in as')).toContainText('Synthetic mentor')
  await expect(page.getByRole('alert')).toContainText('Could not reach the mentor service')
  svc.modes['/mentor/packs'] = 'ok'
  await page.getByRole('alert').getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByRole('list', { name: 'Shared packs' })).toContainText('Progress review 1')
  await expect(page.getByRole('alert')).toHaveCount(0)
  // A failed send keeps the draft; the retry carries the SAME client id; success uses the agreed copy.
  await page.getByRole('button', { name: /Progress review 1/ }).click()
  svc.modes['/mentor/feedback'] = 503
  await page.getByLabel('Feedback: Progress review 1').fill('Strong modelling; extend the wait time.')
  await page.getByRole('button', { name: 'Send feedback' }).click()
  await expect(page.getByRole('alert')).toContainText('status 503')
  await expect(page.getByLabel('Feedback: Progress review 1')).toHaveValue('Strong modelling; extend the wait time.')
  svc.modes['/mentor/feedback'] = 'ok'
  await page.getByRole('button', { name: 'Retry send' }).click()
  await expect(page.locator('.mentor-notice')).toContainText('Feedback saved. The learner can collect it in their app.')
  await expect(page.getByLabel('Feedback: Progress review 1')).toHaveValue('')
  const sends = svc.calls.filter((c) => c.path === '/mentor/feedback')
  expect(sends).toHaveLength(2)
  expect(sends[0].body.clientId).toMatch(/^cl[0-9a-f]{12}$/)
  expect(sends[1].body.clientId).toBe(sends[0].body.clientId)
  // Attachments: an expired blob and an undecryptable blob are two different messages, both retryable.
  svc.modes['/mentor/attachment'] = 410
  await page.getByRole('list', { name: 'Attachments' }).getByRole('button', { name: 'plan.pdf' }).click()
  await expect(page.getByRole('alert')).toContainText('expired on the server')
  svc.modes['/mentor/attachment'] = 'garbage'
  await page.getByRole('alert').getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByRole('alert')).toContainText('could not be decrypted')
  await expect(page.getByRole('list', { name: 'Attachments' }).getByRole('button', { name: 'plan.pdf' })).toBeEnabled()
  // 403 on load = access ended (session kept, Retry offered); 401 = expired (back to sign-in).
  svc.modes['/mentor/packs'] = 403
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('Your access to this learner has been ended.')
  await expect(page.getByText('Signed in as')).toBeVisible()
  svc.modes['/mentor/packs'] = 401
  await page.getByRole('alert').getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByRole('alert')).toContainText('Your session has expired — sign in again.')
  await expect(page.getByRole('button', { name: /Sign in/ })).toBeVisible()
  expect(await page.evaluate((k) => sessionStorage.getItem(k), SESSION_STORAGE_KEY)).toBeNull()
  // A slow load that lands after Sign out is discarded: no packs appear for a signed-out mentor.
  svc.modes['/mentor/packs'] = 'slow'
  await page.getByLabel(/Passphrase/).fill('correct horse battery')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Signed in as')).toBeVisible()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await page.waitForTimeout(2200)
  await expect(page.getByRole('button', { name: /Sign in/ })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Shared packs' })).toHaveCount(0)
})

test('B06: a failed mentor list and a blocked wallet are errors with Retry — never "no mentor yet" or "no wallet files"', async ({ page, context }) => {
  const svc = fakeService()
  await context.route('**/mentor/**', svc.handler)
  svc.modes['/mentor/mentors'] = 503
  await seed(page)
  // Wallet storage denied: IndexedDB refuses to open the wallet database (the app's own store is untouched).
  await page.addInitScript(() => {
    const real = indexedDB.open.bind(indexedDB)
    indexedDB.open = ((name: string, version?: number) => {
      if (name === 'timetable-wallet') throw new Error('blocked')
      return real(name, version)
    }) as typeof indexedDB.open
  })
  await page.goto('./#/settings/data')
  const section = page.locator('#mentor-access')
  await section.getByText('Manage shared access', { exact: true }).click()
  await expect(section.getByRole('alert')).toContainText('status 503')
  await expect(section).not.toContainText('No mentor has joined yet.')
  svc.modes['/mentor/mentors'] = 'ok'
  await section.getByRole('alert').getByRole('button', { name: 'Retry' }).click()
  await expect(section.getByRole('list', { name: 'Mentors' })).toContainText('Synthetic mentor')
  svc.modes['/mentor/mentors'] = 503
  await page.goto('./#/pgce')
  await page.getByRole('button', { name: /^Review packs/ }).click()
  const sheet = page.getByRole('dialog', { name: 'Review packs' })
  await sheet.getByRole('button', { name: /Progress review 1/ }).click()
  const walletAlert = sheet.getByRole('alert').filter({ hasText: 'Could not read your wallet' })
  await expect(walletAlert).toBeVisible()
  await expect(sheet).not.toContainText('No wallet files on this device.')
  await expect(walletAlert.getByRole('button', { name: 'Retry' })).toBeVisible()
  const mentorAlert = sheet.getByRole('alert').filter({ hasText: 'status 503' })
  await expect(mentorAlert).toBeVisible()
  await expect(sheet).not.toContainText('No active mentor yet')
  svc.modes['/mentor/mentors'] = 'ok'
  await mentorAlert.getByRole('button', { name: 'Retry' }).click()
  await expect(sheet.getByRole('checkbox', { name: 'Synthetic mentor' })).toBeVisible()
})

test('B08: pausing on this device keeps the credential and can still revoke; End mentor access previews, closes and reopens', async ({ page, context }) => {
  const svc = fakeService()
  await context.route('**/mentor/**', svc.handler)
  await seed(page)
  await page.goto('./#/settings/data')
  const section = page.locator('#mentor-access')
  await expect(section.locator('.badge')).toHaveText('On')
  await section.getByRole('button', { name: 'Pause on this device' }).click()
  await expect(section.locator('.badge')).toHaveText('Paused here')
  let s = await settingsOf(page)
  expect(s.mentorAccessPaused).toBe(true)
  expect(s.mentorSpaceId).toBe(SPACE)
  expect(s.mentorOwnerToken).toBe(OWNER)
  await expect(section.getByRole('button', { name: 'Create invitation link' })).toHaveCount(0)
  // The sole (paused) device can still end a mentor's access.
  await section.getByText('Manage shared access', { exact: true }).click()
  const mentors = section.getByRole('list', { name: 'Mentors' })
  await mentors.getByRole('listitem').filter({ hasText: 'Synthetic mentor' }).getByRole('button', { name: 'End access' }).click()
  await expect(mentors.getByRole('listitem').filter({ hasText: 'Synthetic mentor' })).toContainText('Access ended')
  expect(svc.calls.filter((c) => c.path === '/mentor/revoke').map((c) => c.body.mentorId)).toEqual([MENTOR_A])
  // Paused, the Review packs sheet does not offer sharing but says why.
  await page.goto('./#/pgce')
  await page.getByRole('button', { name: /^Review packs/ }).click()
  const sheet = page.getByRole('dialog', { name: 'Review packs' })
  await sheet.getByRole('button', { name: /Progress review 1/ }).click()
  await expect(sheet).toContainText('Mentor access is paused on this device')
  await expect(sheet.getByRole('button', { name: 'Review share' })).toHaveCount(0)
  await sheet.getByRole('button', { name: 'Close' }).click()
  // Resume, then end mentor access for everyone with an impact preview.
  await page.goto('./#/settings/data')
  await section.getByRole('button', { name: 'Resume on this device' }).click()
  await expect(section.locator('.badge')).toHaveText('On')
  s = await settingsOf(page)
  expect(s.mentorAccessPaused).toBe(false)
  await expect(section.getByRole('button', { name: 'Create invitation link' })).toBeVisible()
  await section.getByText('Manage shared access', { exact: true }).click()
  await section.getByRole('button', { name: 'End mentor access', exact: true }).click()
  const preview = section.getByLabel('End mentor access')
  await expect(preview).toContainText('signs out 1 active mentor and takes 1 shared pack out of reach')
  await expect(preview).toContainText('Nothing is deleted')
  await preview.getByRole('button', { name: 'End mentor access now' }).click()
  await expect(section.locator('.badge')).toHaveText('Ended')
  expect(svc.calls.filter((c) => c.path === '/mentor/close')).toHaveLength(1)
  expect(svc.calls.filter((c) => c.path === '/mentor/close')[0].body.ownerToken).toBe(OWNER)
  s = await settingsOf(page)
  expect(s.mentorSpaceId).toBe(SPACE)
  await section.getByRole('button', { name: 'Reopen mentor access' }).click()
  await expect(section.locator('.badge')).toHaveText('On')
  expect(svc.calls.filter((c) => c.path === '/mentor/reopen')).toHaveLength(1)
})

test('B10: Delete local pack shows the share summary and asks first with Undo; Unshare records the owner-authorised call; reflection deletion asks first with Undo', async ({ page, context }) => {
  const svc = fakeService()
  await context.route('**/mentor/**', svc.handler)
  await seed(page)
  await page.goto('./#/pgce')
  await page.getByRole('button', { name: /^Review packs/ }).click()
  const sheet = page.getByRole('dialog', { name: 'Review packs' })
  await sheet.getByRole('button', { name: /Progress review 1/ }).click()
  // The delete confirmation names the live share and points at Unshare.
  await sheet.getByRole('button', { name: 'Delete local pack' }).click()
  const confirm = sheet.getByLabel('Confirm pack deletion')
  await expect(confirm).toContainText('still shared (version 1) with 1 mentor')
  await expect(confirm).toContainText('use Unshare for that')
  await confirm.getByRole('button', { name: 'Keep' }).click()
  await expect(confirm).toHaveCount(0)
  // Unshare: reviewed, owner-authorised, recorded on the pack, and honest about downloaded copies.
  await sheet.getByRole('button', { name: 'Unshare from mentors' }).click()
  await expect(sheet.getByLabel('Confirm unshare')).toContainText('Copies already downloaded are not recalled')
  await sheet.getByLabel('Confirm unshare').getByRole('button', { name: 'Unshare now' }).click()
  await expect(sheet.getByRole('status')).toContainText('Unshared. Mentors can no longer open this pack')
  const un = svc.calls.filter((c) => c.path === '/mentor/unshare')
  expect(un).toHaveLength(1)
  expect(un[0].body).toMatchObject({ spaceId: SPACE, ownerToken: OWNER, packId: 'k1' })
  let file = await admin(page)
  expect(file.reviewPacks[0].sharing).toMatchObject({ revision: 2, mentorIds: [], attachmentUids: [], unsharedAt: 7 })
  await expect(sheet).toContainText('Not shared with anyone at the moment')
  await expect(sheet.getByRole('button', { name: 'Unshare from mentors' })).toHaveCount(0)
  // Delete now says it is not shared; deletion is undoable.
  await sheet.getByRole('button', { name: 'Delete local pack' }).click()
  await expect(sheet.getByLabel('Confirm pack deletion')).toContainText('not shared with anyone at the moment')
  await sheet.getByLabel('Confirm pack deletion').getByRole('button', { name: 'Delete pack' }).click()
  await expect(sheet.getByRole('list', { name: 'Packs' })).toHaveCount(0)
  expect((await admin(page)).reviewPacks).toHaveLength(0)
  await sheet.locator('.status-message').getByRole('button', { name: 'Undo' }).click()
  await expect(sheet.getByRole('list', { name: 'Packs' })).toContainText('Progress review 1')
  file = await admin(page)
  expect(file.reviewPacks).toHaveLength(1)
  expect(file.reviewPacks[0].at).toBeGreaterThan(1)
  await sheet.getByRole('button', { name: 'Close' }).click()
  // Reflections: confirm, then Undo, through the PGCE file.
  await page.getByRole('button', { name: /^Weekly reflections/ }).click()
  const fileSheet = page.getByRole('dialog', { name: 'My PGCE file' })
  await fileSheet.getByRole('button', { name: 'Delete reflection' }).click()
  await expect(fileSheet.getByLabel('Confirm deletion')).toContainText('Delete the reflection for w/c 14 Sept?')
  await fileSheet.getByLabel('Confirm deletion').getByRole('button', { name: 'Delete reflection' }).click()
  expect((await admin(page)).reflections).toHaveLength(0)
  await fileSheet.locator('.status-message').getByRole('button', { name: 'Undo' }).click()
  await expect(fileSheet).toContainText('Clear modelling')
  expect((await admin(page)).reflections).toHaveLength(1)
})

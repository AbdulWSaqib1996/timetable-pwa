import { expect, test } from './fixtures'
import type { Page, Route } from '@playwright/test'
import { createHmac, createHash, randomBytes } from 'node:crypto'

/**
 * G4 (Pass 73) — the mentor portal end to end against an in-test stand-in
 * for the worker's mentor routes (the real Durable Object is covered by
 * tests/unit/mentor-store.test.mjs). Learner side: turn on mentor access,
 * mint an invitation link, share a pack (text identical to the preview),
 * pull signed feedback as reviewer-authenticated observations that cannot be
 * edited, end a mentor's access. Portal side: join with the link, see only the
 * shared pack, send feedback, sign out and back in, be refused once revoked.
 */

test.use({ timezoneId: 'Europe/London' })

/** A tiny protocol-compatible mentor service kept in the test process. */
function fakeMentorService() {
  const spaces = new Map<string, { tokenHash: string; invites: Map<string, { secretHash: string; used?: boolean }>; mentors: Map<string, { name: string; passphrase: string; revoked?: boolean; sessions: Set<string> }>; packs: Map<string, { title: string; text: string; mentorIds: string[]; attachments: { id: string; name: string; size: number }[] }>; feedback: { spaceId: string; mentorId: string; mentorName: string; feedbackId: string; at: number; sig: string; packId: string; packTitle: string; text: string }[] }>()
  const key = randomBytes(32).toString('hex')
  const sha = (s: string) => createHash('sha256').update(s).digest('hex')
  const calls: { path: string; body: Record<string, unknown> }[] = []
  const handler = async (route: Route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>
    calls.push({ path, body })
    const reply = (status: number, obj: unknown) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(obj) })
    const spaceId = String(body.spaceId ?? '')
    const space = spaces.get(spaceId)
    const owner = () => space && sha(String(body.ownerToken)) === space.tokenHash
    const mentorOf = () => { if (!space) return null; for (const [id, m] of space.mentors) if (!m.revoked && m.sessions.has(String(body.session))) return { id, ...m }; return null }
    if (path === '/mentor/space') { if (!space) spaces.set(spaceId, { tokenHash: sha(String(body.ownerToken)), invites: new Map(), mentors: new Map(), packs: new Map(), feedback: [] }); return reply(200, { ok: true }) }
    if (!space) return reply(400, { error: 'invalid request' })
    if (path === '/mentor/invite') { if (!owner()) return reply(403, { error: 'unauthorized' }); const code = 'ABCDEFGH'.slice(0, 7) + String(space.invites.size + 2); const secret = randomBytes(16).toString('hex'); space.invites.set(code, { secretHash: sha(secret) }); return reply(200, { code, secret, expiresAt: Date.now() + 7 * 86400000, label: body.label }) }
    if (path === '/mentor/mentors') { if (!owner()) return reply(403, { error: 'unauthorized' }); return reply(200, { mentors: [...space.mentors].map(([id, m]) => ({ id, name: m.name, createdAt: 1, revokedAt: m.revoked ? 2 : null, lastSeenAt: null })), invites: [...space.invites].filter(([, i]) => !i.used).map(([code]) => ({ code, label: '', expiresAt: 0 })), packs: [...space.packs].map(([id, p]) => ({ id, title: p.title, sharedAt: 1, mentorIds: p.mentorIds, attachments: p.attachments.length })) }) }
    if (path === '/mentor/revoke') { if (!owner()) return reply(403, { error: 'unauthorized' }); const m = space.mentors.get(String(body.mentorId)); if (!m) return reply(404, {}); m.revoked = true; m.sessions.clear(); return reply(200, { ok: true }) }
    if (path === '/mentor/share') { if (!owner()) return reply(403, { error: 'unauthorized' }); const pack = body.pack as { id: string; title: string; text: string }; const atts = (body.attachments as { id: string; name: string; size: number; key: string; iv: string; data: string }[]) ?? []; space.packs.set(pack.id, { title: pack.title, text: pack.text, mentorIds: body.mentorIds as string[], attachments: atts.map((a) => ({ id: a.id, name: a.name, size: a.size })) }); return reply(200, { ok: true, packId: pack.id, sharedAt: Date.now(), attachments: atts.length }) }
    if (path === '/mentor/inbox') { if (!owner()) return reply(403, { error: 'unauthorized' }); return reply(200, { feedback: space.feedback.filter((f) => f.at > Number(body.since ?? 0)) }) }
    if (path === '/mentor/join') { const inv = space.invites.get(String(body.code)); if (!inv || inv.used || sha(String(body.secret)) !== inv.secretHash) return reply(403, { error: 'invitation not valid' }); if (String(body.passphrase).length < 8) return reply(400, { error: 'passphrase too short' }); inv.used = true; const id = 'mt' + randomBytes(6).toString('hex'); const session = randomBytes(24).toString('hex'); space.mentors.set(id, { name: String(body.name).trim(), passphrase: String(body.passphrase), sessions: new Set([session]) }); return reply(200, { mentorId: id, name: String(body.name).trim(), session, expiresAt: 0 }) }
    if (path === '/mentor/login') { const m = space.mentors.get(String(body.mentorId)); if (!m || m.revoked) return reply(403, { error: 'access is not active' }); if (m.passphrase !== body.passphrase) return reply(403, { error: 'wrong passphrase' }); const session = randomBytes(24).toString('hex'); m.sessions.add(session); return reply(200, { mentorId: body.mentorId, name: m.name, session, expiresAt: 0 }) }
    const mentor = mentorOf()
    if (!mentor) return reply(401, { error: 'sign in again' })
    if (path === '/mentor/packs') return reply(200, { mentor: { id: mentor.id, name: mentor.name }, packs: [...space.packs].filter(([, p]) => p.mentorIds.includes(mentor.id)).map(([id, p]) => ({ id, title: p.title, text: p.text, sharedAt: 1, attachments: p.attachments })), feedback: space.feedback.filter((f) => f.mentorId === mentor.id).map((f) => ({ feedbackId: f.feedbackId, packId: f.packId, text: f.text, at: f.at })) })
    if (path === '/mentor/feedback') { const p = space.packs.get(String(body.packId)); if (!p || !p.mentorIds.includes(mentor.id)) return reply(404, { error: 'not shared with you' }); const feedbackId = 'fb' + randomBytes(6).toString('hex'); const at = Date.now(); const text = String(body.text); const sig = createHmac('sha256', Buffer.from(key, 'hex')).update(`${spaceId}|${mentor.id}|${feedbackId}|${at}|${text}`).digest('hex'); space.feedback.push({ spaceId, mentorId: mentor.id, mentorName: mentor.name, feedbackId, at, sig, packId: String(body.packId), packTitle: p.title, text }); return reply(200, { feedbackId, at, sig }) }
    return reply(404, { error: 'not found' })
  }
  return { handler, spaces, calls }
}

const base = () => ({
  reflections: [], targets: [], meetings: [], observations: [], audits: [], tasks: [], exceptions: [], plans: [], commitments: [], placements: [], schools: [], programmes: [], packs: [], requirements: [], milestones: [], cycles: [], preps: [], goals: [], resources: [], projects: [], readings: [], contacts: [], questions: [], protected: [], supportNotes: [], examples: [], experience: [], reviews: [],
  lessons: [{ id: 'l1', dateISO: '2026-09-14', classGroup: 'Y2', subject: 'Maths — number bonds', evaluation: 'Went well', standards: ['TS4'], at: 10 }],
  reviewPacks: [{ id: 'k1', title: 'Progress review 1', state: 'draft', createdISO: '2026-09-14', items: [{ kind: 'lesson', id: 'l1', revision: 10, snapshot: JSON.stringify({ id: 'l1', dateISO: '2026-09-14', subject: 'Maths — number bonds', evaluation: 'Went well', standards: ['TS4'], at: 10 }), caption: 'My clearest modelling' }], attachments: [], at: 1 }],
})

async function seed(page: Page) {
  await page.clock.install({ time: new Date('2026-09-14T06:05:00Z') })
  await page.addInitScript((admin) => {
    localStorage.setItem('timetable.whatsnew.v1', '99')
    if (localStorage.getItem('timetable.store.v2')) return
    localStorage.setItem('timetable.store.v2', JSON.stringify({ activeId: 'fx', profiles: [{ id: 'fx', name: 'My timetable', settings: { demo: false, sheetId: 'FIXTURESHEET-FIXTURESHEET-FIXTURESHEET-0001', gid: null, specialismsChosen: true, checklistDismissed: true, usagePing: false } }] }))
    localStorage.setItem('timetable.cache.v2.fx', JSON.stringify({ fetchedAt: Date.now(), sessions: [] }))
    localStorage.setItem('timetable.admin.v1.fx', JSON.stringify(admin))
  }, base())
  await page.setViewportSize({ width: 390, height: 844 })
}
const admin = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('timetable.admin.v1.fx') ?? '{}'))
const settings = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('timetable.store.v2')!).profiles[0].settings)

test('learner and mentor, end to end: invite → join → share exactly the preview → signed feedback becomes read-only reviewer-authenticated → access ended', async ({ page, context }) => {
  const svc = fakeMentorService()
  await context.route('**/mentor/**', svc.handler)
  await seed(page)
  // 1. Learner turns mentor access on and mints an invitation.
  await page.goto('./#/settings/data')
  const section = page.locator('#mentor-access')
  await section.getByRole('button', { name: 'Turn on mentor access' }).click()
  await expect(section).toContainText('No mentor has joined yet.')
  const s1 = await settings(page)
  expect(s1.mentorSpaceId).toMatch(/^[0-9a-f]{24}$/)
  expect(s1.mentorOwnerToken).toMatch(/^[0-9a-f]{48}$/)
  await section.getByLabel('Invitation label').fill('school mentor')
  await section.getByRole('button', { name: 'Create invitation link' }).click()
  const link = (await section.getByLabel('Invitation link').textContent())!.trim()
  expect(link).toMatch(new RegExp(`mentor\\.html#/join/${s1.mentorSpaceId}/[A-Z2-9]{8}/[0-9a-f]{32}$`))
  await expect(section).toContainText('works once')
  // 2. The mentor opens the link in the portal, joins, and sees nothing yet.
  const portal = await context.newPage()
  await portal.goto(link.replace(/^https?:\/\/[^/]+/, ''))
  await expect(portal.getByRole('heading', { level: 1, name: 'Mentor portal' })).toBeVisible()
  await portal.getByLabel('Your name').fill('A Mentor')
  await portal.getByLabel(/Passphrase/).fill('correct horse battery')
  await portal.getByRole('button', { name: 'Join' }).click()
  await expect(portal.getByText('Signed in as')).toContainText('A Mentor')
  await expect(portal.getByText('Nothing has been shared with you yet.')).toBeVisible()
  // 3. Learner shares the pack; the mentor receives exactly the preview text.
  await page.reload()
  await page.goto('./#/pgce')
  await page.getByRole('button', { name: /^Review packs/ }).click()
  const sheet = page.getByRole('dialog', { name: 'Review packs' })
  await sheet.getByRole('button', { name: /Progress review 1/ }).click()
  const preview = (await sheet.getByLabel('Pack preview').textContent())!
  await sheet.getByRole('checkbox', { name: 'A Mentor' }).check()
  await sheet.getByRole('button', { name: 'Share pack' }).click()
  await expect(sheet.getByRole('status')).toContainText('Shared with 1 mentor')
  const shared = svc.calls.find((c) => c.path === '/mentor/share')!
  expect((shared.body.pack as { text: string }).text).toBe(preview)
  // The portal keeps its session for the tab: a reload lists the newly shared pack.
  await portal.reload()
  await portal.getByRole('button', { name: /Progress review 1/ }).click()
  await expect(portal.getByLabel('Pack text: Progress review 1')).toHaveText(preview)
  await expect(portal.getByLabel('Pack text: Progress review 1')).toContainText('Caption: My clearest modelling')
  // 4. Mentor sends feedback; the learner pulls it as reviewer-authenticated, read-only.
  await portal.getByLabel('Feedback: Progress review 1').fill('Strong modelling; extend the wait time after questions.')
  await portal.getByRole('button', { name: 'Send feedback' }).click()
  await expect(portal.getByRole('status')).toContainText('Feedback sent')
  await expect(portal.getByRole('list', { name: 'Your feedback' })).toContainText('extend the wait time')
  await sheet.getByRole('button', { name: 'Check for feedback' }).click()
  await expect(sheet.getByRole('status')).toContainText('1 new feedback record added (reviewer-authenticated)')
  const file = await admin(page)
  const obs = file.observations[0]
  expect(obs).toMatchObject({ sourceType: 'reviewer-authenticated', observer: 'A Mentor', subject: 'Progress review 1', development: 'Strong modelling; extend the wait time after questions.' })
  expect(obs.attestation).toMatchObject({ spaceId: s1.mentorSpaceId, mentorName: 'A Mentor' })
  expect(obs.attestation.sig).toMatch(/^[0-9a-f]{64}$/)
  // Pulling again adds nothing twice.
  await sheet.getByRole('button', { name: 'Check for feedback' }).click()
  await expect(sheet.getByRole('status')).toContainText('No new feedback.')
  expect((await admin(page)).observations).toHaveLength(1)
  await sheet.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('button', { name: /Add or open a record/ }).click()
  await page.getByRole('menuitem', { name: /^Observations/ }).click()
  const obsSheet = page.getByRole('dialog')
  await expect(obsSheet).toContainText('Reviewer-authenticated · A Mentor')
  await expect(obsSheet.getByRole('button', { name: 'Edit observation' })).toHaveCount(0)
  await expect(obsSheet.getByRole('button', { name: 'Delete observation' })).toHaveCount(1)
  await obsSheet.getByRole('button', { name: 'Close' }).first().click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  // 5. Learner ends the mentor's access: the portal is refused.
  await page.goto('./#/settings/data')
  await expect(section.getByRole('list', { name: 'Mentors' })).toContainText('A Mentor')
  await section.getByRole('button', { name: 'End access' }).click()
  await expect(section.getByRole('list', { name: 'Mentors' })).toContainText('Access ended')
  await portal.reload()
  await expect(portal.getByText('Your session has ended — sign in again.')).toBeVisible()
  await portal.getByLabel(/Passphrase/).fill('correct horse battery')
  await portal.getByRole('button', { name: 'Sign in' }).click()
  await expect(portal.getByRole('alert')).toContainText('Your access to this learner has been ended.')
  // 6. The invitation cannot be reused.
  const again = await context.newPage()
  await again.goto(link.replace(/^https?:\/\/[^/]+/, ''))
  await again.getByLabel('Your name').fill('Someone else')
  await again.getByLabel(/Passphrase/).fill('another passphrase')
  await again.getByRole('button', { name: 'Join' }).click()
  await expect(again.getByRole('alert')).toContainText('invitation not valid')
})

test('the portal without an invitation shows nothing, and the learner app never sends the owner token to a mentor route', async ({ page, context }) => {
  const svc = fakeMentorService()
  await context.route('**/mentor/**', svc.handler)
  await seed(page)
  await page.goto('./mentor.html')
  await expect(page.getByText('Open the invitation link the trainee sent you.')).toBeVisible()
  await page.goto('./#/settings/data')
  await page.locator('#mentor-access').getByRole('button', { name: 'Turn on mentor access' }).click()
  await expect(page.locator('#mentor-access')).toContainText('No mentor has joined yet.')
  const mentorRoutes = ['/mentor/join', '/mentor/login', '/mentor/packs', '/mentor/attachment', '/mentor/feedback']
  expect(svc.calls.filter((c) => mentorRoutes.includes(c.path))).toHaveLength(0)
  expect(svc.calls.every((c) => !('session' in c.body))).toBe(true)
})

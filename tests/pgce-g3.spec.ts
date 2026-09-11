import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'

/**
 * G3 (Pass 72) — evidence examples over referenced records, review packs
 * that pin snapshots (old pack readable after the source edits, missing
 * attachments shown, export text == preview), the experience ledger by layer
 * with no double counting and comparisons only against confirmed
 * requirements, review records and a handover pack without private notes.
 */

test.use({ timezoneId: 'Europe/London' })

const session = (id: string, title: string, dateISO: string, day: string) => ({ id, title, day, dateISO, start: '08:30', end: '15:30', room: '', groups: '', tutor: '', subject: '', isSpecialism: false, isSelfStudy: false, isOptional: false })
const SESSIONS = [session('a1', 'School Experience SE1a', '2026-09-14', 'Mon'), session('a2', 'School Experience SE1a', '2026-09-15', 'Tue')]
const base = () => ({
  reflections: [{ id: 'r1', weekISO: '2026-09-07', wentWell: 'Routines', challenges: '', focus: '', standards: [], at: 1 }], targets: [], meetings: [{ id: 'm1', dateISO: '2026-09-14', discussed: 'Targets', actions: [], at: 1 }],
  observations: [{ id: 'o1', dateISO: '2026-09-14', observer: 'A Mentor', subject: 'Maths', focus: '', strengths: 'Clear modelling', development: 'Wait time', sourceType: 'learner-entered', at: 1 }],
  lessons: [{ id: 'l1', dateISO: '2026-09-14', classGroup: 'Y2', subject: 'Maths — number bonds', evaluation: 'Went well', standards: ['TS4'], at: 10 }],
  audits: [], tasks: [], exceptions: [], plans: [], commitments: [],
  placements: [{ id: 'pl-se1', code: 'SE1', schoolLocationId: 'sch-1', startISO: '2026-09-07', endISO: '2026-12-11', mappedBlockTags: ['SE1A'], mentorName: 'A Mentor', mentorContact: 'mentor@school.example', at: 10 }],
  schools: [{ id: 'sch-1', name: 'Riverside Primary', address: '1 River Lane', lat: 51.53, lng: -0.11, confirmedAt: 5, at: 10 }],
  programmes: [], packs: [], requirements: [{ id: 'pk:days', packId: 'pk', section: 'School experience', title: 'Assessed school days', plannedValue: '120 days', verification: 'unconfirmed', at: 1 }], milestones: [], cycles: [], preps: [],
  goals: [], resources: [], projects: [], readings: [], contacts: [{ id: 'c1', name: 'Wellbeing adviser', contact: 'wb@uni.example', at: 1 }], questions: [], protected: [], supportNotes: [{ id: 'agenda', text: 'PRIVATE agenda', at: 1 }],
  examples: [], reviewPacks: [], experience: [], reviews: [],
})

async function seed(page: Page, admin: Record<string, unknown> = base()) {
  await page.clock.install({ time: new Date('2026-09-14T06:05:00Z') })
  await page.addInitScript(
    ({ SESSIONS, admin }) => {
      localStorage.setItem('timetable.whatsnew.v1', '99')
      if (localStorage.getItem('timetable.store.v2')) return
      localStorage.setItem('timetable.store.v2', JSON.stringify({ activeId: 'fx', profiles: [{ id: 'fx', name: 'My timetable', settings: { demo: false, sheetId: 'FIXTURESHEET-FIXTURESHEET-FIXTURESHEET-0001', gid: null, specialismsChosen: true, checklistDismissed: true, usagePing: false } }] }))
      localStorage.setItem('timetable.cache.v2.fx', JSON.stringify({ fetchedAt: Date.now(), sessions: SESSIONS }))
      localStorage.setItem('timetable.admin.v1.fx', JSON.stringify(admin))
    },
    { SESSIONS, admin }
  )
  await page.setViewportSize({ width: 390, height: 844 })
}
const admin = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('timetable.admin.v1.fx') ?? '{}'))

test('evidence examples reference records without copying; ITTECF, Teachers’ Standards and Part Two stay separate; removing an example keeps the lesson', async ({ page }) => {
  await seed(page)
  await page.goto('./#/pgce')
  await page.getByRole('button', { name: /^Evidence examples/ }).click()
  const sheet = page.getByRole('dialog', { name: 'Evidence examples' })
  await sheet.getByLabel('Example title').fill('Cold-calling in number bonds')
  await sheet.getByRole('combobox', { name: 'Example context' }).selectOption('practice-cycle')
  await sheet.getByRole('checkbox', { name: /Lesson · .*number bonds/ }).check()
  await sheet.getByRole('checkbox', { name: /Feedback · .*A Mentor/ }).check()
  await sheet.getByLabel('What I changed next').fill('Wait five seconds before taking an answer.')
  await sheet.getByRole('button', { name: 'Classroom practice', exact: true }).click()
  await sheet.getByRole('button', { name: 'TS4', exact: true }).click()
  await sheet.getByRole('button', { name: 'Personal and professional conduct in school' }).click()
  await sheet.getByRole('button', { name: 'Add example' }).click()
  // A second example over the same lesson: reference, not a copy.
  await sheet.getByLabel('Example title').fill('Same lesson, curriculum angle')
  await sheet.getByRole('checkbox', { name: /Lesson · .*number bonds/ }).check()
  await sheet.getByRole('button', { name: 'Add example' }).click()
  let file = await admin(page)
  expect(file.examples).toHaveLength(2)
  expect(file.examples[0]).toMatchObject({ context: 'practice-cycle', ittecf: ['classroom-practice'], standards: ['TS4'], partTwo: ['conduct-in-school'], narrative: { changedNext: 'Wait five seconds before taking an answer.' } })
  expect(file.examples[0].refs).toEqual([{ entityType: 'lesson', entityId: 'l1' }, { entityType: 'observation', entityId: 'o1' }])
  expect(JSON.stringify(file.examples)).not.toContain('Went well')
  await expect(sheet).not.toContainText(/score/i)
  await sheet.getByRole('button', { name: 'Remove example (source records stay)' }).first().click()
  file = await admin(page)
  expect(file.examples).toHaveLength(1)
  expect(file.lessons[0]).toMatchObject({ id: 'l1', evaluation: 'Went well' })
})

test('review pack: pins snapshots, stays readable after the source edits, shows missing attachments, export text equals the preview', async ({ page }) => {
  await seed(page)
  await page.goto('./#/pgce')
  await page.getByRole('button', { name: /^Review packs/ }).click()
  const sheet = page.getByRole('dialog', { name: 'Review packs' })
  await sheet.getByLabel('Pack title').fill('Progress review 1')
  await sheet.getByRole('button', { name: 'Create pack' }).click()
  await sheet.getByRole('checkbox', { name: /Lesson · .*number bonds/ }).check()
  await sheet.getByRole('checkbox', { name: /Feedback · .*A Mentor/ }).check()
  await sheet.getByRole('button', { name: /Pin selection \(2\)/ }).click()
  await sheet.getByLabel('Caption: lesson l1').fill('My clearest modelling')
  await expect(sheet.getByLabel('Pack preview')).toContainText('Evaluation: Went well')
  await expect(sheet.getByLabel('Pack preview')).toContainText('Provenance: Entered by you')
  await expect(sheet.getByLabel('Pack preview')).toContainText('Caption: My clearest modelling')
  let file = await admin(page)
  expect(file.reviewPacks[0].items.map((i: { kind: string; revision: number }) => [i.kind, i.revision])).toEqual([['lesson', 10], ['observation', 1]])
  // Edit the source lesson afterwards: the pack keeps the pinned version and says so.
  await sheet.getByRole('button', { name: 'Close' }).click()
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('timetable.admin.v1.fx')!)
    raw.lessons[0] = { ...raw.lessons[0], evaluation: 'Rewritten later', at: Date.now() }
    localStorage.setItem('timetable.admin.v1.fx', JSON.stringify(raw))
  })
  await page.reload()
  await page.getByRole('button', { name: /^Review packs/ }).click()
  await sheet.getByRole('button', { name: /Progress review 1/ }).click()
  await expect(sheet).toContainText('source changed since pinned — the pack keeps the pinned version')
  await expect(sheet.getByLabel('Pack preview')).toContainText('Evaluation: Went well')
  await expect(sheet.getByLabel('Pack preview')).not.toContainText('Rewritten later')
  // A pinned attachment that is not on this device is shown as missing (packs never carry file bytes).
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('timetable.admin.v1.fx')!)
    raw.reviewPacks[0].attachments = [{ id: '424242', name: 'lesson-plan.pdf', state: 'local-only' }]
    localStorage.setItem('timetable.admin.v1.fx', JSON.stringify(raw))
  })
  await page.reload()
  await page.getByRole('button', { name: /^Review packs/ }).click()
  await sheet.getByRole('button', { name: /Progress review 1/ }).click()
  await expect(sheet.getByRole('list', { name: 'Attachments' })).toContainText('Missing on this device')
  await expect(sheet.getByLabel('Pack preview')).toContainText('lesson-plan.pdf — missing on this device')
  // Export == preview, byte for byte.
  const preview = await sheet.getByLabel('Pack preview').textContent()
  const [download] = await Promise.all([page.waitForEvent('download'), sheet.getByRole('button', { name: 'Export this text' }).click()])
  const path = await download.path()
  const exported = await page.evaluate(async (p) => p, path)
  const fs = await import('node:fs/promises')
  expect(await fs.readFile(exported!, 'utf8')).toBe(preview)
  // Selected → Draft → Discussed is the learner's marking.
  await sheet.getByRole('button', { name: 'Mark as draft' }).click()
  await sheet.getByLabel('Discussed on').fill('2026-12-11')
  await sheet.getByRole('button', { name: 'Mark as discussed' }).click()
  file = await admin(page)
  expect(file.reviewPacks[0]).toMatchObject({ state: 'discussed', discussedISO: '2026-12-11' })
})

test('experience ledger: layers apart, no double count, no inferred duration, timetable ticks shown from the existing placement code, comparison only against a confirmed requirement, export names sources', async ({ page }) => {
  await seed(page)
  await page.goto('./#/pgce')
  await page.getByRole('button', { name: /^Experience ledger/ }).click()
  const sheet = page.getByRole('dialog', { name: 'Experience ledger' })
  await expect(sheet.getByLabel('Timetable and attendance')).toContainText('2 planned school days · 0 whole-day ticks · 0 minute corrections')
  await sheet.getByLabel('Entry type').selectOption('teaching')
  await sheet.getByLabel('Duration (minutes, optional)').fill('60')
  await sheet.getByRole('combobox', { name: 'Source record' }).selectOption('l1')
  await sheet.getByRole('button', { name: 'Add entry' }).click()
  await sheet.getByLabel('Entry type').selectOption('mentor-meeting')
  await sheet.getByRole('button', { name: 'Add entry' }).click()
  // The same date/type/layer/source again is refused.
  await sheet.getByLabel('Entry type').selectOption('teaching')
  await sheet.getByRole('combobox', { name: 'Source record' }).selectOption('l1')
  await sheet.getByRole('button', { name: 'Add entry' }).click()
  await expect(sheet.getByRole('alert')).toContainText('not counted twice')
  // A provider outcome needs its source; a different layer is not a double count.
  await sheet.getByLabel('Entry layer').selectOption('provider-outcome-reference')
  await sheet.getByRole('button', { name: 'Add entry' }).click()
  await expect(sheet.getByRole('alert')).toContainText('needs its source')
  await sheet.getByLabel('Provider source').fill('Provider portal, 14 Sep')
  await sheet.getByRole('button', { name: 'Add entry' }).click()
  const summary = sheet.getByLabel('Ledger summary')
  await expect(summary).toContainText('Logged by you')
  await expect(summary).toContainText('Teaching 1 (60 min entered)')
  await expect(summary).toContainText('Mentor meeting 1 (1 untimed)')
  await expect(summary).toContainText('Provider outcome (referenced)')
  const file = await admin(page)
  expect(file.experience).toHaveLength(3)
  expect(file.experience.find((e: { type: string; layer: string }) => e.type === 'mentor-meeting').durationMins).toBeUndefined()
  // No confirmed requirement → total without a deficit; confirm it → "x of 120".
  await expect(sheet).toContainText('No confirmed numeric requirement yet — 1 logged day recorded, no deficit shown.')
  await sheet.getByRole('button', { name: 'Close' }).click()
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('timetable.admin.v1.fx')!)
    raw.requirements[0] = { ...raw.requirements[0], verification: 'confirmed', confirmedSource: 'Handbook p.4', at: Date.now() }
    localStorage.setItem('timetable.admin.v1.fx', JSON.stringify(raw))
  })
  await page.reload()
  await page.getByRole('button', { name: /^Experience ledger/ }).click()
  await sheet.getByRole('combobox', { name: 'Compare against' }).selectOption({ index: 1 })
  await expect(sheet.getByLabel('Comparison')).toHaveText('1 of 120 (Assessed school days, confirmed by you from Handbook p.4)')
  await expect(sheet).not.toContainText(/short|deficit shown|behind/i)
  const [download] = await Promise.all([page.waitForEvent('download'), sheet.getByRole('button', { name: 'Export for a provider conversation' }).click()])
  const fs = await import('node:fs/promises')
  const text = await fs.readFile((await download.path())!, 'utf8')
  expect(text).toContain('LEARNER-LOGGED (source: entered by the learner)')
  expect(text).toContain('PROVIDER-OUTCOME-REFERENCE (source: a provider outcome the learner referenced)')
  expect(text).toContain('1 of 120 (Assessed school days, confirmed by you from Handbook p.4)')
})

test('reviews: a provider judgement needs its source; the handover pack leaves out private notes, contacts and identifiers', async ({ page }) => {
  const a = base()
  ;(a as { examples: unknown[] }).examples = [{ id: 'e1', title: 'Cold-calling', context: 'practice-cycle', refs: [], ittecf: ['classroom-practice'], standards: ['TS4'], partTwo: [], narrative: { changedNext: 'Wait longer' }, at: 1 }]
  await seed(page, a)
  await page.goto('./#/pgce')
  await page.getByRole('button', { name: /Add or open a record/ }).click()
  await page.getByRole('menuitem', { name: /^Reviews & handover/ }).click()
  const sheet = page.getByRole('dialog', { name: 'Reviews & handover' })
  await sheet.getByLabel('Review date').fill('2026-12-11')
  await sheet.getByLabel('Participants').fill('A Mentor, tutor')
  await sheet.getByLabel('Review focus').fill('Progress review 1')
  await sheet.getByLabel('Private notes').fill('PRIVATE: felt nervous')
  await sheet.getByLabel('Provider judgement').fill('On track')
  await expect(sheet.getByRole('button', { name: 'Save review' })).toBeDisabled()
  await sheet.getByLabel('Judgement source').fill('tutor, 11 Dec')
  await sheet.getByLabel('Next steps').fill('Plan two sequences')
  await sheet.getByRole('button', { name: 'Save review' }).click()
  await expect(sheet.getByRole('list', { name: 'Reviews' })).toContainText('Provider view (source: tutor, 11 Dec): On track')
  await expect(sheet.getByRole('list', { name: 'Reviews' })).toContainText('Private notes kept (not in any export)')
  await sheet.getByRole('button', { name: 'Preview handover pack' }).click()
  const preview = await sheet.getByLabel('Handover preview').textContent()
  expect(preview).toContain('Cold-calling [practice-cycle]')
  expect(preview).toContain('PLACEMENT SE1 — Riverside Primary')
  expect(preview).toContain('Next steps: Plan two sequences')
  expect(preview).not.toContain('felt nervous')
  expect(preview).not.toMatch(/mentor@school|wb@uni|1 River Lane|A Mentor|PRIVATE agenda|Wellbeing adviser/)
  expect(preview).toContain('has not been sent to, or received by, any induction body')
  const [download] = await Promise.all([page.waitForEvent('download'), sheet.getByRole('button', { name: 'Export handover text' }).click()])
  const fs = await import('node:fs/promises')
  expect(await fs.readFile((await download.path())!, 'utf8')).toBe(preview)
  const file = await admin(page)
  expect(file.reviews[0]).toMatchObject({ dateISO: '2026-12-11', learnerNotes: 'PRIVATE: felt nervous', providerJudgement: { text: 'On track', source: 'tutor, 11 Dec' } })
  // Nothing in an academic result or a review can set QTS: there is no such field anywhere in the file.
  expect(JSON.stringify(file)).not.toMatch(/qts.*(awarded|granted|true)/i)
})

test('What’s new lists the latest release once and keeps the history in Settings → Help', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('timetable.store.v2', JSON.stringify({ activeId: 'd', profiles: [{ id: 'd', name: 'Demo learner', settings: { demo: true, sheetId: '', gid: null, specialismsChosen: true, checklistDismissed: true, usagePing: false } }] }))
    localStorage.setItem('timetable.whatsnew.v1', '6')
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./#/today')
  await expect(page.getByText(/Placements SE1, SE2 and SE3/)).toBeVisible()
  await page.goto('./#/settings/help')
  await expect(page.getByText('PGCE file: placements, lessons, knowledge, workload, evidence')).toBeVisible()
  await expect(page.getByText('History, journey home, PGCE file, digest')).toBeVisible()
})

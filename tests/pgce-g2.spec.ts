import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'

/**
 * G2 (Pass 71) — subject knowledge (PG-04), academic workspace (PG-05) and
 * workload & support (PG-08) on a real profile: goals with self-rated
 * confidence, shared resources and an audit brought in as "previously marked
 * secure by you"; a project whose deadline references a key date, status
 * moved only on the learner's confirmation, milestones as tasks, reading
 * notes by kind; workload proposals that respect protected time, accept as
 * plan blocks, do not duplicate, recompute on a deadline change and undo.
 */

test.use({ timezoneId: 'Europe/London' })

const session = (id: string, title: string, dateISO: string, day: string, start = '09:00', end = '15:00') => ({
  id, title, day, dateISO, start, end, room: '', groups: '', tutor: '', subject: '', isSpecialism: false, isSelfStudy: false, isOptional: false,
})
const SESSIONS = [session('a1', 'School Experience SE1a', '2026-09-14', 'Mon'), session('a2', 'School Experience SE1a', '2026-09-15', 'Tue')]
const KEYDATES = [{ ...session('kd1', 'Assignment 1 hand-in', '2026-11-20', 'Fri', '12:00', '12:00'), isKeyDate: true, sourceKey: 'keydates' }]
const base = () => ({
  reflections: [], targets: [], meetings: [], observations: [], lessons: [{ id: 'l1', dateISO: '2026-09-16', classGroup: 'Y2', subject: 'Fractions', evaluation: '', standards: [], at: 1 }], audits: [{ id: 'au1', subject: 'Phonics phases', stage: 'secure', note: 'from the audit', dateISO: '2026-05-01', at: 1 }],
  tasks: [{ id: 't1', title: 'Essay', dueISO: '2026-09-16', status: 'todo', at: 1 }, { id: 't2', title: 'Reading', dueISO: '2026-09-20', status: 'todo', at: 1 }],
  exceptions: [], plans: [{ id: 'a', parentId: 't1', kind: 'subtask', title: 'Outline', effortMins: 120, at: 1 }, { id: 'b', parentId: 't1', kind: 'subtask', title: 'Draft', effortMins: 180, at: 1 }], commitments: [],
  placements: [], schools: [], programmes: [], packs: [], requirements: [{ id: 'pk:frac', packId: 'pk', section: 'Curriculum: maths', title: 'Fractions as division', verification: 'unconfirmed', at: 1 }], milestones: [], cycles: [], preps: [],
  goals: [], resources: [], projects: [], readings: [], contacts: [], questions: [], protected: [], supportNotes: [],
})

async function seed(page: Page, admin: Record<string, unknown> = base()) {
  await page.clock.install({ time: new Date('2026-09-14T06:05:00Z') })
  await page.addInitScript(
    ({ SESSIONS, KEYDATES, admin }) => {
      localStorage.setItem('timetable.whatsnew.v1', '99')
      if (localStorage.getItem('timetable.store.v2')) return
      localStorage.setItem('timetable.store.v2', JSON.stringify({ activeId: 'fx', profiles: [{ id: 'fx', name: 'My timetable', settings: { demo: false, sheetId: 'FIXTURESHEET-FIXTURESHEET-FIXTURESHEET-0001', gid: null, keyDatesSheetId: 'FIXTURESHEET-FIXTURESHEET-FIXTURESHEET-0001', keyDatesGid: '7', specialismsChosen: true, checklistDismissed: true, usagePing: false } }] }))
      localStorage.setItem('timetable.cache.v2.fx', JSON.stringify({ fetchedAt: Date.now(), sessions: SESSIONS, keyDates: KEYDATES }))
      localStorage.setItem('timetable.admin.v1.fx', JSON.stringify(admin))
    },
    { SESSIONS, KEYDATES, admin }
  )
  await page.setViewportSize({ width: 390, height: 844 })
}
const admin = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('timetable.admin.v1.fx') ?? '{}'))
async function openMenu(page: Page, item: RegExp) {
  await page.goto('./#/pgce')
  await page.getByRole('button', { name: /Add or open a record/ }).click()
  await page.getByRole('menuitem', { name: item }).click()
}

test('subject knowledge: goal from the pack topic list, self-rated confidence, shared resource, application lesson, audit → "previously marked secure by you"', async ({ page }) => {
  await seed(page)
  await openMenu(page, /^Subject knowledge/)
  const sheet = page.getByRole('dialog', { name: 'Subject knowledge' })
  await expect(sheet.locator('#knowledge-topics option')).toHaveAttribute('value', 'Fractions as division')
  await sheet.getByLabel('Topic').fill('Fractions as division')
  await sheet.getByLabel('Your question').fill('Why does 3/4 equal 3 ÷ 4?')
  await sheet.getByRole('button', { name: 'Add goal' }).click()
  const goal = sheet.getByRole('list', { name: 'Knowledge goals' }).getByRole('listitem').filter({ hasText: 'Fractions as division' })
  await expect(goal).toContainText('No confidence rating yet')
  await goal.getByRole('combobox', { name: 'Confidence: Fractions as division' }).selectOption('2')
  await goal.getByRole('button', { name: 'Rate' }).click()
  await expect(goal).toContainText('Self-rated 2/5 (a little) on 14 Sept 2026')
  await goal.getByRole('combobox', { name: 'Apply in lesson: Fractions as division' }).selectOption('l1')
  await goal.getByLabel('Next review: Fractions as division').fill('2026-09-28')
  await goal.getByLabel('New resource title: Fractions as division').fill('NCETM spine')
  await goal.getByLabel('New resource link: Fractions as division').fill('https://example.org/spine')
  await goal.getByRole('button', { name: 'Add resource' }).click()
  await expect(goal.getByRole('list', { name: 'Resources: Fractions as division' })).toContainText('NCETM spine')
  // The audit entry can become a goal that says what it was, never mastery.
  await sheet.getByRole('button', { name: 'Make a goal' }).click()
  const legacy = sheet.getByRole('list', { name: 'Knowledge goals' }).getByRole('listitem').filter({ hasText: 'Phonics phases' })
  await expect(legacy).toContainText('Previously marked secure by you (1 May 2026)')
  await expect(sheet).not.toContainText(/master/i)
  // One resource serves many goals: link the same resource to the legacy goal.
  await legacy.getByRole('combobox', { name: 'Link resource: Phonics phases' }).selectOption({ label: 'NCETM spine' })
  const file = await admin(page)
  expect(file.resources).toHaveLength(1)
  const g = file.goals.find((x: { topic: string }) => x.topic === 'Fractions as division')
  expect(g).toMatchObject({ state: 'open', strand: 'breadth', lessonRef: 'l1', nextReviewISO: '2026-09-28', resourceRefs: [file.resources[0].id] })
  expect(g.confidence).toEqual([{ dateISO: '2026-09-14', level: 2 }])
  expect(file.goals.find((x: { topic: string }) => x.topic === 'Phonics phases')).toMatchObject({ legacyAuditId: 'au1', resourceRefs: [file.resources[0].id] })
})

test('academic work: deadline references a key date, status moves only on confirmation, milestones are tasks, reading notes keep their kind and source', async ({ page }) => {
  await seed(page)
  await openMenu(page, /^Academic work/)
  const sheet = page.getByRole('dialog', { name: 'Academic work' })
  await sheet.getByLabel('Project title').fill('Assignment 1 — Reflective account')
  await sheet.getByRole('combobox', { name: 'Deadline (key date)' }).selectOption({ index: 1 })
  await sheet.getByRole('button', { name: 'Add project' }).click()
  await expect(sheet).toContainText('Deadline: 20 Nov 2026 12:00 · Assignment 1 hand-in (from your key dates)')
  await sheet.getByLabel('Words', { exact: true }).fill('3000')
  await sheet.getByRole('button', { name: 'Ready to submit' }).click()
  await expect(sheet.getByRole('button', { name: 'Mark submitted' })).toBeDisabled()
  await sheet.getByLabel('I submitted this myself').check()
  await sheet.getByRole('button', { name: 'Mark submitted' }).click()
  await expect(sheet).toContainText('Submitted 14 Sept 2026 — recorded on your confirmation.')
  await sheet.getByLabel('Feedback text').fill('Clear structure; deepen the analysis.')
  await sheet.getByLabel('Source', { exact: true }).fill('tutor email, 1 Dec')
  await sheet.getByRole('button', { name: 'Record feedback' }).click()
  await sheet.getByLabel('Result text').fill('Pass')
  await sheet.getByLabel('Source', { exact: true }).fill('portal, 15 Dec')
  await sheet.getByRole('button', { name: 'Record result' }).click()
  await expect(sheet).toContainText('Result (portal, 15 Dec): Pass — recorded by you from that source; nothing here awards anything.')
  await sheet.getByLabel('Milestone title').fill('Outline done')
  await sheet.getByLabel('Milestone due').fill('2026-10-01')
  await sheet.getByRole('button', { name: 'Add milestone' }).click()
  await sheet.getByRole('combobox', { name: 'Note kind' }).selectOption('quotation')
  await sheet.getByLabel('Note source').fill('Author (2020)')
  await sheet.getByLabel('Page').fill('12')
  await sheet.getByLabel('Note text').fill('Fractions are numbers')
  await sheet.getByRole('button', { name: 'Add note' }).click()
  await expect(sheet.getByRole('list', { name: 'Reading notes' })).toContainText('“Fractions are numbers” — Author (2020), p.12')
  await sheet.getByLabel('Consent').fill('Letters to parents sent 1 Oct')
  const file = await admin(page)
  const p = file.projects[0]
  expect(p).toMatchObject({ status: 'result', words: 3000, submittedISO: '2026-09-14', feedback: { text: 'Clear structure; deepen the analysis.', source: 'tutor email, 1 Dec' }, result: { text: 'Pass', source: 'portal, 15 Dec' }, enquiry: { consent: 'Letters to parents sent 1 Oct' } })
  expect(p.deadlineRef).toBeTruthy()
  expect(p.deadlineISO).toBeUndefined()
  expect(file.tasks.find((t: { title: string }) => t.title === 'Outline done')).toMatchObject({ projectId: p.id, dueISO: '2026-10-01', status: 'todo' })
  expect(file.readings[0]).toMatchObject({ projectId: p.id, kind: 'quotation', source: 'Author (2020)', page: '12' })
  // The milestone is an ordinary task: it shows on Tasks.
  await sheet.getByRole('button', { name: 'Close' }).click()
  await page.goto('./#/tasks')
  await expect(page.getByText('Outline done')).toBeVisible()
})

test('workload: protected time never filled, gap reported, accept adds plan blocks (no duplicates on re-run), deadline change recomputes without accepting, undo restores', async ({ page }) => {
  await seed(page)
  await openMenu(page, 'Workload & support')
  const sheet = page.getByRole('dialog', { name: 'Workload & support' })
  await sheet.getByRole('tab', { name: /Protected time/ }).click()
  await sheet.getByRole('combobox', { name: 'Weekday' }).selectOption('1')
  await sheet.getByLabel('Protected from').fill('16:00')
  await sheet.getByLabel('Protected until').fill('20:00')
  await sheet.getByLabel('Protected label').fill('Family')
  await sheet.getByRole('button', { name: 'Add protected time' }).click()
  await expect(sheet.getByRole('list', { name: 'Protected windows' })).toContainText('Mon 16:00–20:00 · Family')
  await sheet.getByRole('tab', { name: 'Next two weeks' }).click()
  const summary = sheet.getByLabel('Workload summary')
  await expect(summary).toContainText('5 h across 2 open tasks')
  await expect(sheet).toContainText('No estimate, so unknown (not counted): Reading')
  await expect(sheet).toContainText('protected time kept free')
  const proposals = sheet.getByRole('list', { name: 'Proposed blocks' })
  await expect(proposals.getByRole('listitem').first()).toContainText('Essay')
  const rows = await proposals.getByRole('listitem').allTextContents()
  for (const r of rows) {
    if (r.includes('Mon 14')) expect(/1[6-9]:\d\d–|–(1[7-9]|20):\d\d/.test(r) && !/08:\d\d–08:45|15:15/.test(r)).toBe(false)
    expect(r).toMatch(/Essay/)
  }
  await sheet.getByRole('button', { name: /Accept \d+ proposals?/ }).click()
  let file = await admin(page)
  const blocks = file.plans.filter((p: { kind: string; parentId: string }) => p.kind === 'block' && p.parentId === 't1')
  expect(blocks.length).toBe(rows.length)
  expect(blocks.reduce((n: number, b: { effortMins: number }) => n + b.effortMins, 0)).toBe(300)
  for (const b of blocks) expect(b.dateISO <= '2026-09-16').toBe(true)
  // Re-run: nothing more to propose, the same blocks are not scheduled twice.
  await expect(summary).toContainText('Nothing unallocated')
  await expect(sheet).toContainText('Nothing to propose')
  await expect(sheet.getByRole('button', { name: /Undo last accept/ })).toBeVisible()
  // The blocks are ordinary plan blocks on the Schedule.
  await sheet.getByRole('button', { name: 'Close' }).click()
  await page.goto('./#/schedule')
  await expect(page.locator('.day-list')).toContainText('Essay')
  // Undo restores the previous plans exactly.
  await openMenu(page, 'Workload & support')
  await sheet.getByRole('button', { name: /Undo last accept/ }).click()
  file = await admin(page)
  expect(file.plans.map((p: { id: string }) => p.id).sort()).toEqual(['a', 'b'])
  await expect(sheet.getByRole('list', { name: 'Proposed blocks' }).getByRole('listitem')).toHaveCount(rows.length)
  // A deadline change recomputes; nothing is accepted by itself.
  await sheet.getByRole('button', { name: 'Close' }).click()
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('timetable.admin.v1.fx')!)
    raw.tasks = raw.tasks.map((t: { id: string; dueISO: string }) => (t.id === 't1' ? { ...t, dueISO: '2026-09-14', at: Date.now() } : t))
    localStorage.setItem('timetable.admin.v1.fx', JSON.stringify(raw))
  })
  await page.reload()
  await openMenu(page, 'Workload & support')
  await expect(summary).toContainText('unallocated — not enough free time before the due dates')
  const today = await sheet.getByRole('list', { name: 'Proposed blocks' }).getByRole('listitem').allTextContents()
  expect(today.every((r) => r.includes('Mon 14'))).toBe(true)
  expect((await admin(page)).plans.filter((p: { kind: string }) => p.kind === 'block')).toHaveLength(0)
  // Support: contacts, private agenda, unanswered question — no score anywhere.
  await sheet.getByRole('tab', { name: 'Support' }).click()
  await sheet.getByLabel('Contact name').fill('A Tutor')
  await sheet.getByLabel('Contact role').fill('academic tutor')
  await sheet.getByRole('button', { name: 'Add', exact: true }).click()
  await sheet.getByLabel('Support agenda').fill('Workload in November')
  await sheet.getByLabel('Question', { exact: true }).fill('Which referencing style?')
  await sheet.getByRole('button', { name: 'Add question' }).click()
  await sheet.getByLabel('Answer: Which referencing style?').fill('Harvard')
  await sheet.getByRole('button', { name: 'Mark answered' }).click()
  await expect(sheet.getByRole('list', { name: 'Course questions' })).toContainText('Answered')
  await expect(sheet).not.toContainText(/score|streak/i)
  file = await admin(page)
  expect(file.contacts[0]).toMatchObject({ name: 'A Tutor', role: 'academic tutor' })
  expect(file.supportNotes[0]).toMatchObject({ id: 'agenda', text: 'Workload in November' })
  expect(file.questions[0]).toMatchObject({ text: 'Which referencing style?', answered: true, answer: 'Harvard' })
})

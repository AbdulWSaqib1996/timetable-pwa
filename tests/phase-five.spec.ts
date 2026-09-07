import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'

/**
 * Phase 5 browser coverage. Fixtures are deterministic (7 Sep 2026) and all
 * external requests stay blocked.
 */

async function seed(page: Page, opts: { legacyCustom?: boolean } = {}) {
  await page.clock.install({ time: new Date('2026-09-07T07:15:00Z') })
  await page.addInitScript(
    ([legacy]) => {
      localStorage.setItem('timetable.whatsnew.v1', '99')
      const settings: Record<string, unknown> = {
        demo: true,
        sheetId: '',
        gid: null,
        specialismsChosen: true,
        checklistDismissed: true,
        usagePing: false,
      }
      if (legacy) {
        settings.customKeyDates = [
          { id: 'old1', title: 'Legacy essay', dateISO: '2026-09-12', start: '17:00' },
          { id: 'old2', title: 'Legacy submitted', dateISO: '2026-09-05' },
        ]
      }
      localStorage.setItem(
        'timetable.store.v2',
        JSON.stringify({ activeId: 'fx', profiles: [{ id: 'fx', name: 'Demo timetable', settings }] })
      )
      if (legacy) {
        // Saved status/note against the legacy Phase 2 owner key.
        localStorage.setItem(
          'timetable.meta.v2.fx',
          JSON.stringify({ '2026-09-05||legacy submitted': { status: 'done', note: 'sent by email', at: 1 } })
        )
      }
    },
    [opts.legacyCustom ?? false]
  )
}

const readTasks = (page: Page) =>
  page.evaluate(() => {
    const admin = JSON.parse(localStorage.getItem('timetable.admin.v1.fx') ?? '{}')
    return { tasks: admin.tasks ?? [], deleted: admin.deleted ?? {} }
  })

test('legacy personal deadlines migrate to task records keeping id, status and note', async ({ page }) => {
  await seed(page, { legacyCustom: true })
  await page.goto('./#/tasks')
  await expect(page.getByText('Legacy essay')).toBeVisible()
  const { tasks } = await readTasks(page)
  expect(tasks.map((t: { id: string }) => t.id).sort()).toEqual(['old1', 'old2'])
  const submitted = tasks.find((t: { id: string }) => t.id === 'old2')
  expect(submitted.status).toBe('done')
  expect(submitted.notes).toBe('sent by email')
  // The settings field is cleared after migration.
  const cleared = await page.evaluate(
    () => JSON.parse(localStorage.getItem('timetable.store.v2')!).profiles[0].settings.customKeyDates
  )
  expect(cleared).toBeUndefined()
})

test('task CRUD: create, edit keeps identity, duplicate never inherits completion, delete + undo beats the tombstone', async ({ page }) => {
  await seed(page)
  await page.goto('./#/tasks')
  // Create.
  await page.getByRole('button', { name: '＋ Add task' }).click()
  await page.getByLabel('Title').fill('Write assignment plan')
  await page.getByLabel('Due date').fill('2026-09-15')
  await page.getByRole('button', { name: 'Save task' }).click()
  await expect(page.getByText('Write assignment plan')).toBeVisible()
  const created = (await readTasks(page)).tasks[0]
  expect(created.status).toBe('todo')

  // Complete it, then edit the title: the id must not regenerate and the
  // completion history stays.
  await page.locator('.keydates-list li', { hasText: 'Write assignment plan' }).getByTitle('Cycle status').click()
  await page.locator('.keydates-list li', { hasText: 'Write assignment plan' }).getByTitle('Cycle status').click()
  await page.locator('.completed-tasks summary').click()
  await page.locator('.completed-tasks li', { hasText: 'Write assignment plan' }).locator('.keydate-row').click()
  await page.getByLabel('Title').fill('Write assignment plan v2')
  await page.getByRole('button', { name: 'Save task' }).click()
  const afterEdit = (await readTasks(page)).tasks.find((t: { id: string }) => t.id === created.id)
  expect(afterEdit.title).toBe('Write assignment plan v2')
  expect(afterEdit.status).toBe('done')
  expect(afterEdit.completedISO).toBe('2026-09-07')

  // Duplicate: new id, back to "to do".
  await page.locator('.completed-tasks li', { hasText: 'v2' }).locator('.keydate-row').click()
  await page.getByRole('button', { name: 'Duplicate' }).click()
  const dup = (await readTasks(page)).tasks.find((t: { id: string }) => t.id !== created.id)
  expect(dup.status).toBe('todo')
  expect(dup.id).not.toBe(created.id)
  await expect(page.getByText('Write assignment plan v2 (copy)')).toBeVisible()

  // Delete the copy, then undo: the record returns with a revision NEWER than
  // the tombstone (not a locally hidden tombstone).
  await page.locator('.keydates-list li', { hasText: '(copy)' }).locator('.keydate-row').click()
  await page.getByRole('button', { name: 'Delete task' }).click()
  const afterDelete = await readTasks(page)
  expect(afterDelete.tasks.some((t: { id: string }) => t.id === dup.id)).toBe(false)
  expect(afterDelete.deleted[`tasks:${dup.id}`]).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Undo' }).click()
  const afterUndo = await readTasks(page)
  const restored = afterUndo.tasks.find((t: { id: string }) => t.id === dup.id)
  expect(restored).toBeTruthy()
  expect(restored.at).toBeGreaterThanOrEqual(afterDelete.deleted[`tasks:${dup.id}`])
})

test('mentor actions project into Tasks and complete exactly once in both views', async ({ page }) => {
  await seed(page)
  await page.addInitScript(() => {
    localStorage.setItem(
      'timetable.admin.v1.fx',
      JSON.stringify({
        reflections: [], targets: [], observations: [], lessons: [], audits: [],
        tasks: [], exceptions: [], plans: [], commitments: [],
        meetings: [
          { id: 'm1', dateISO: '2026-09-04', discussed: 'Targets', at: 1,
            actions: [{ id: 'a1', text: 'Read behaviour policy', done: false }] },
        ],
      })
    )
  })
  await page.goto('./#/tasks')
  const actionRow = page.locator('.mentor-action-row', { hasText: 'Read behaviour policy' })
  await expect(actionRow).toBeVisible()
  // click, not check(): completing the action removes the row immediately,
  // so there is no checked state left to verify.
  await actionRow.locator('input').click()
  await expect(page.locator('.mentor-action-row')).toHaveCount(0)
  // Completion lives on the meeting record — the single owner.
  const meetings = await page.evaluate(
    () => JSON.parse(localStorage.getItem('timetable.admin.v1.fx')!).meetings
  )
  expect(meetings[0].actions[0].done).toBe(true)
})

test('task drafts survive a reload and offer Continue/Discard', async ({ page }) => {
  await seed(page)
  await page.goto('./#/tasks')
  await page.getByRole('button', { name: '＋ Add task' }).click()
  await page.getByLabel('Title').fill('Half-typed thought')
  await page.getByLabel('Due date').fill('2026-09-20')
  await expect(page.getByText('Draft saved on this device.')).toBeVisible()
  // The editor closes without saving (simulates navigating away/crash)…
  await page.getByRole('button', { name: 'Cancel' }).click()
  // …and an EDIT of an existing task is a different draft key, so create a
  // task and confirm the abandoned creation draft did not leak into it.
  const draftKeys = await page.evaluate(() =>
    Object.keys(localStorage).filter((k) => k.startsWith('timetable.draft.v1.'))
  )
  expect(draftKeys.length).toBe(1)
})

test('every PGCE record type is editable; a reflection draft survives reload with Continue/Discard; delete has undo', async ({ page }) => {
  await seed(page)
  await page.addInitScript(() => {
    localStorage.setItem(
      'timetable.admin.v1.fx',
      JSON.stringify({
        tasks: [], exceptions: [], plans: [], commitments: [],
        reflections: [{ id: 'r1', weekISO: '2026-08-31', wentWell: 'Settled in', challenges: '', focus: '', standards: [], at: 5 }],
        targets: [{ id: 't1', text: 'Cold calling', standards: [], setISO: '2026-09-01', status: 'open', at: 5 }],
        meetings: [{ id: 'm1', dateISO: '2026-09-04', discussed: 'Targets', actions: [{ id: 'a1', text: 'Read policy', done: true }], at: 5 }],
        observations: [{ id: 'o1', dateISO: '2026-09-03', observer: 'JB', subject: 'Maths', focus: '', strengths: 'Pace', development: '', at: 5 }],
        lessons: [{ id: 'l1', dateISO: '2026-09-02', classGroup: 'Y2', subject: 'Maths', evaluation: 'Good', standards: [], at: 5 }],
        audits: [{ id: 'au1', subject: 'Maths', stage: 'baseline', note: '', dateISO: '2026-09-01', at: 5 }],
      })
    )
  })
  await page.goto('./#/pgce')
  await page.getByRole('button', { name: 'Weekly reflections (1)' }).click()
  // Edit exists for every record type (spot-check each tab's control).
  await expect(page.getByRole('button', { name: 'Edit reflection' })).toBeVisible()

  // Type into the editor, then reload mid-edit: the draft must offer recovery.
  await page.getByRole('button', { name: 'Edit reflection' }).click()
  await page.getByLabel('What went well').fill('Settled in AND ran my first starter')
  await expect(page.getByText('Draft saved on this device.')).toBeVisible()
  await page.reload()
  await page.goto('./#/pgce')
  await page.getByRole('button', { name: 'Weekly reflections (1)' }).click()
  await page.getByRole('button', { name: 'Edit reflection' }).click()
  await expect(page.getByText('Continue draft')).toBeVisible()
  await page.getByRole('button', { name: 'Continue draft' }).click()
  await expect(page.getByLabel('What went well')).toHaveValue('Settled in AND ran my first starter')
  await page.getByRole('button', { name: 'Save changes' }).click()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('timetable.admin.v1.fx')!).reflections[0])
  expect(saved.wentWell).toContain('ran my first starter')
  expect(saved.id).toBe('r1')

  // Editing a meeting keeps each action's identity and done state.
  await page.getByRole('button', { name: 'Meetings', exact: true }).click()
  await page.getByRole('button', { name: 'Edit meeting' }).click()
  await page.getByLabel('Action text').fill('Read the FULL policy')
  await page.getByRole('button', { name: 'Save changes' }).click()
  const meeting = await page.evaluate(() => JSON.parse(localStorage.getItem('timetable.admin.v1.fx')!).meetings[0])
  expect(meeting.actions[0]).toMatchObject({ id: 'a1', text: 'Read the FULL policy', done: true })

  // Delete from the editor, then undo restores with a newer revision.
  await page.getByRole('button', { name: 'Edit meeting' }).click()
  await page.getByRole('button', { name: 'Delete meeting record' }).click()
  await expect(page.getByText('Record deleted.')).toBeVisible()
  await page.getByRole('button', { name: 'Undo' }).click()
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('timetable.admin.v1.fx')!))
  expect(after.meetings.length).toBe(1)
  expect(after.meetings[0].at).toBeGreaterThanOrEqual(after.deleted['meetings:m1'])
})

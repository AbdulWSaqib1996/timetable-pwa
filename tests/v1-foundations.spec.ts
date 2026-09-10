import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'

/**
 * V1 (Pass 57) — foundations from the visual audit: every ordinary control
 * at least 44 px tall, no ordinary text under 14 px (12–13 px only for the
 * named metadata classes), semantic status tokens instead of the legacy
 * pinks, one line-icon family for core controls, and the routine backup
 * prompt relocated from every page heading to Settings / Data & devices.
 * Measured on real screens with synthetic data — not snapshot assertions.
 */

const DEMO = { demo: true, sheetId: '', gid: null, specialismsChosen: true, checklistDismissed: true, usagePing: false, attendancePrompts: true }
const MATHS = '2026-09-07|14:30|maths 1'

async function seed(page: Page, opts: { profiles?: { id: string; name: string; settings?: Record<string, unknown> }[]; extra?: Record<string, string>; width?: number } = {}) {
  await page.clock.install({ time: new Date('2026-09-07T15:40:00Z') })
  await page.addInitScript(
    ({ profiles, extra }) => {
      localStorage.setItem('timetable.whatsnew.v1', '99')
      if (localStorage.getItem('timetable.store.v2')) return
      localStorage.setItem('timetable.store.v2', JSON.stringify({ activeId: profiles[0].id, profiles }))
      localStorage.setItem('timetable.meta.v2.' + profiles[0].id, JSON.stringify({ [`2026-09-07|14:30|maths 1`]: { note: 'x', at: 1 } }))
      localStorage.setItem(
        'timetable.admin.v1.' + profiles[0].id,
        JSON.stringify({ reflections: [], targets: [], observations: [], lessons: [], audits: [], exceptions: [], plans: [], commitments: [], meetings: [{ id: 'm1', dateISO: '2026-09-04', discussed: 'x', at: 1, actions: [{ id: 'a1', text: 'Read policy', done: false }] }], tasks: [{ id: 't1', title: 'Essay', dueISO: '2026-09-12', status: 'todo', at: 1 }] })
      )
      for (const [k, v] of Object.entries(extra ?? {})) localStorage.setItem(k, v)
    },
    { profiles: opts.profiles ?? [{ id: 'd', name: 'Demo learner', settings: DEMO }], extra: opts.extra ?? {} }
  )
  await page.setViewportSize({ width: opts.width ?? 390, height: 844 })
}

// Metadata classes the audit allows at 12–13 px (brief labels, dense calendar labels).
const METADATA = ['change-meta', 'kd-chip', 'badge', 'today-hero-label', 'week-strip-dow', 'week-strip-num', 'session-end', 'room-chip', 'free-gap', 'week-badge', 'bell-badge', 'search-count', 'filter-count', 'month-cell', 'week-event', 'chip-small', 'kd-status', 'nav-item', 'attention-dot', 'day-header', 'month-dow', 'month-keydate', 'plan-week-day', 'find-result-head', 'find-result-kind', 'find-result-date']

async function walk(page: Page) {
  return page.evaluate((metadata) => {
    const vis = (el: Element) => {
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'
    }
    const isMeta = (el: Element | null) => {
      for (let e = el; e; e = e.parentElement) if (metadata.some((c) => e.classList.contains(c))) return true
      return false
    }
    const controls = [...document.querySelectorAll('button, [role=tab], [role=option], [role=menuitem], select, a.travel-link, label.cloud-file-label, input[type=search], input[type=text], input[type=url], input[type=password]')]
      .filter(vis)
      .map((el) => ({ h: Math.round(el.getBoundingClientRect().height), w: Math.round(el.getBoundingClientRect().width), name: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40), cls: el.className.toString().slice(0, 40) }))
      .filter((c) => c.h < 44)
    const small: { fs: number; text: string; cls: string }[] = []
    const tiny: { fs: number; text: string; cls: string }[] = []
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    const seen = new Set<Element>()
    while (walker.nextNode()) {
      const n = walker.currentNode as Text
      const el = n.parentElement
      if (!n.textContent?.trim() || !el || seen.has(el) || !vis(el)) continue
      seen.add(el)
      const fs = parseFloat(getComputedStyle(el).fontSize)
      const rec = { fs, text: n.textContent.trim().slice(0, 30), cls: el.className.toString().slice(0, 40) }
      if (fs < 12) tiny.push(rec)
      else if (fs < 14 && !isMeta(el)) small.push(rec)
    }
    const pageColour = (sel: string) => {
      const el = document.querySelector(sel)
      return el ? getComputedStyle(el).color : null
    }
    return { controls, small, tiny, overdue: pageColour('.workload-line.heavy'), urgent: pageColour('.kd-chip.urgent') }
  }, METADATA)
}

const SCREENS = ['today', 'schedule', 'tasks', 'pgce', 'settings', 'settings/data', 'settings/reminders', 'settings/travel', 'find']

test('V-01/V-03: on every primary screen at 390px no ordinary control is under 44px and no ordinary text is under 14px', async ({ page }) => {
  test.setTimeout(120_000)
  await seed(page, { extra: { 'timetable.backup.v1': JSON.stringify({ history: [{ at: Date.now(), profiles: ['d'], all: true, kind: 'file' }] }) } })
  for (const route of SCREENS) {
    await page.goto(`./#/${route}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await page.waitForTimeout(200)
    const m = await walk(page)
    expect(m.controls, `${route}: controls under 44px → ${JSON.stringify(m.controls)}`).toEqual([])
    expect(m.small, `${route}: ordinary text under 14px → ${JSON.stringify(m.small)}`).toEqual([])
    expect(m.tiny, `${route}: text under 12px → ${JSON.stringify(m.tiny)}`).toEqual([])
  }
})

test('V-02: overdue and urgent states use the semantic tokens (dark red / amber), not the legacy pink, in both themes', async ({ page }) => {
  await seed(page, { extra: { 'timetable.admin.v1.d': JSON.stringify({ reflections: [], targets: [], observations: [], lessons: [], audits: [], exceptions: [], plans: [], commitments: [], meetings: [], tasks: [{ id: 'late', title: 'Overdue essay', dueISO: '2026-09-01', status: 'todo', at: 1 }, { id: 'soon', title: 'Soon essay', dueISO: '2026-09-09', status: 'todo', at: 1 }] }) } })
  await page.goto('./#/tasks')
  await expect(page.getByRole('region', { name: 'Overdue tasks' })).toBeVisible()
  const light = await walk(page)
  expect(light.overdue).toBe('rgb(159, 29, 29)') // --error-text #9f1d1d
  expect(light.urgent).toBe('rgb(134, 80, 0)') // --attention-text #865000
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.waitForTimeout(100)
  const dark = await walk(page)
  expect(dark.overdue).toBe('rgb(243, 184, 184)')
  expect(dark.urgent).toBe('rgb(245, 200, 106)')
  expect(dark.controls).toEqual([])
})

test('V-05: core controls carry line icons with visible labels or names — no emoji-only controls on the primary screens', async ({ page }) => {
  await seed(page)
  for (const route of SCREENS) {
    await page.goto(`./#/${route}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    const offenders = await page.evaluate(() => {
      const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u
      return [...document.querySelectorAll('button, [role=tab]')]
        .filter((b) => b.getBoundingClientRect().height > 0)
        .map((b) => ({ text: (b.textContent || '').trim(), label: b.getAttribute('aria-label') }))
        .filter((b) => emoji.test(b.text) && !b.label && b.text.replace(emoji, '').trim().length === 0)
    })
    expect(offenders, `${route}: emoji-only controls ${JSON.stringify(offenders)}`).toEqual([])
  }
  await page.goto('./#/schedule')
  await expect(page.getByRole('button', { name: 'Placements', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Placements' }).locator('svg')).toHaveCount(1)
  await page.goto('./#/tasks')
  await expect(page.getByRole('button', { name: 'Add task' }).locator('svg')).toHaveCount(1)
})

test('V-04: the routine backup prompt lives in Settings / Data & devices with an attention dot, not above every page heading; snoozing clears it for a week', async ({ page }) => {
  await seed(page)
  await page.goto('./#/today')
  await expect(page.locator('.backup-banner')).toHaveCount(0)
  const settings = page.getByRole('button', { name: /Settings — 1 item needs attention/ })
  await expect(settings).toBeVisible()
  await expect(settings.locator('.attention-dot')).toHaveCount(1)
  await page.goto('./#/schedule')
  await expect(page.locator('.backup-banner')).toHaveCount(0)
  await settings.click()
  await expect(page.getByText(/has not been backed up recently/)).toBeVisible()
  await page.getByRole('button', { name: 'Open Data & devices →' }).click()
  await expect(page.locator('#backup')).toContainText('a timetable has not been included in a backup recently')
  await page.getByRole('button', { name: 'remind me in a week' }).click()
  await page.goto('./#/today')
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /needs attention/ })).toHaveCount(0)
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('timetable.backup.v1')))!).lastNudgeAt).toBeGreaterThan(0)
})

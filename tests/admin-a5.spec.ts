import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'
import { mockStats, v2Fixture } from './admin-fixtures'

/**
 * A5 coverage (Pass 49): reliability sources with their own denominators and
 * thresholds, stale/incomplete pipelines that cannot look healthy, release
 * comparisons suppressed until compatible and large enough, and the
 * retention statement that names the dormant policy. Worker traffic mocked.
 */

async function unlockAt(page: Page, section: string) {
  await page.goto(`./analytics.html#${section}`)
  await page.getByLabel('Owner key').fill('test-key')
  await page.getByRole('button', { name: 'Unlock' }).click()
}

test('reliability: sources carry denominators and thresholds; a stale aggregate is an open issue, never healthy', async ({ page, context }) => {
  const staleV2 = () => ({ ...v2Fixture(), generatedAt: new Date(Date.now() - 45 * 60_000).toISOString() })
  await mockStats(context, { v2: () => ({ status: 200, body: staleV2() }) })
  await unlockAt(page, 'reliability')
  await expect(page.getByRole('heading', { name: 'Reliability' })).toBeVisible()
  await expect(page.getByText(/Stale aggregate: the v2 snapshot is 4[45] min old \(threshold 30 min\)/)).toBeVisible()
  await expect(page.getByText(/source: worker ingestion · 1\/144 attempts/)).toBeVisible()
  await expect(page.getByText(/alert above 2%/)).toBeVisible()
  await expect(page.getByText(/offline failures are unobserved, not zero/)).toBeVisible()
  await expect(page.getByRole('table', { name: /Reason counts per UTC day/ })).toBeVisible()
  // Never a green "healthy" service claim.
  await expect(page.getByText(/healthy/i)).toHaveCount(0)
})

test('reliability: below the denominator minimum the rate is suppressed instead of shown as 0%', async ({ page, context }) => {
  const thin = () => {
    const v = v2Fixture()
    v.reliability.lastCompleteDay = { ...v.reliability.lastCompleteDay, attempts: 12, refused: 0, ratePct: null, status: 'insufficient' }
    // Unknown build coverage is itself a legitimate open issue — clear it so
    // the "no issues" panel (and its honesty caveat) is what renders here.
    v.builds.list = v.builds.list.filter((b) => b.buildId !== 'unknown')
    return v
  }
  await mockStats(context, { v2: () => ({ status: 200, body: thin() }) })
  await unlockAt(page, 'reliability')
  await expect(page.getByText(/12\/100 attempts — below the denominator minimum, rate suppressed/)).toBeVisible()
  await expect(page.getByText('No open issues against the configured thresholds')).toBeVisible()
  await expect(page.getByText(/not a statement that every client is healthy/)).toBeVisible()
})

test('releases: latest-build attribution, Unknown kept visible, comparison only with enough eligible tokens', async ({ page, context }) => {
  await mockStats(context)
  await unlockAt(page, 'releases')
  const table = page.getByRole('table', { name: 'Builds by latest observed attribution' })
  await expect(table).toBeVisible()
  await expect(table.getByRole('row', { name: /7af3942/ })).toContainText('3.4 (24 tokens')
  await expect(table.getByRole('row', { name: /5c924c3/ })).toContainText('Comparison unavailable (4/20 eligible tokens)')
  await expect(table.getByRole('row', { name: /Unknown/ })).toContainText('Comparison unavailable')
  // No deltas, arrows or significance badges anywhere.
  await expect(page.getByText(/significan|▲|▼|\+\d+%/)).toHaveCount(0)
  // Legacy markers stay labelled as NOT build identities.
  await expect(page.getByText(/NOT build identities/)).toBeVisible()
})

test('data & access: retention names the dormant policy honestly and lists per-capability collection starts', async ({ page, context }) => {
  await mockStats(context)
  await unlockAt(page, 'access')
  await expect(page.getByText(/first-seen token ledger currently has NO expiry/)).toBeVisible()
  await expect(page.getByText(/A bounded policy is PROPOSED and not active/)).toBeVisible()
  await expect(page.getByText(/deletes at most 200 per run/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Collection start dates' })).toBeVisible()
  await expect(page.getByText(/Capability 2/)).toBeVisible()
})

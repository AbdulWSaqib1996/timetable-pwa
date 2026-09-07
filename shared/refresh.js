/**
 * Source-scoped refresh helpers (P3-02), shared so the merge policy is a pure,
 * unit-tested function: every configured source (main timetable, extra tabs,
 * key dates) resolves independently; a failed source keeps its last good rows
 * with an explicit stale label; a removed source's rows leave the live set
 * immediately; and a monotonic generation gate keeps a slow, older request
 * from publishing over a newer one.
 */

/** Every source this profile's settings configure, in a stable order. */
export function planSources(settings) {
  if (!settings || settings.demo || !settings.sheetId) return []
  const sources = [
    { id: 'main', kind: 'timetable', label: 'Timetable', sheetId: settings.sheetId, gid: settings.gid ?? null },
  ]
  for (const [i, tab] of (settings.extraTabs ?? []).entries()) {
    sources.push({
      id: `extra:${tab.sheetId}|${tab.gid ?? ''}`,
      kind: 'extra',
      label: `Extra tab ${i + 1}`,
      sheetId: tab.sheetId,
      gid: tab.gid ?? null,
    })
  }
  if (settings.keyDatesSheetId) {
    sources.push({
      id: 'keydates',
      kind: 'keydates',
      label: 'Key dates',
      sheetId: settings.keyDatesSheetId,
      gid: settings.keyDatesGid ?? null,
    })
  }
  return sources
}

export const sourceKeyOf = (src) => `${src.sheetId}|${src.gid ?? ''}`

/**
 * Combine per-source settled results with the previous cache.
 * `results` is keyed by source id: { ok, rows?, warnings?, error? }.
 * `prevRows` are the profile's previously cached rows (sessions + key dates);
 * rows without a sourceKey are treated as belonging to the main source.
 * Returns rows per source (fresh, or last-good on failure) plus a status row
 * per source. Rows from sources no longer in the plan are dropped here — past
 * days survive separately through history retention.
 */
export function resolveSourceResults(plan, results, prevRows = [], nowMs = Date.now()) {
  const mainKey = plan.length > 0 ? sourceKeyOf(plan[0]) : ''
  const prevBySource = new Map()
  for (const row of prevRows) {
    const key = row.sourceKey ?? mainKey
    if (!prevBySource.has(key)) prevBySource.set(key, [])
    prevBySource.get(key).push(row)
  }
  const bySource = new Map()
  const statuses = []
  const warnings = []
  for (const src of plan) {
    const result = results[src.id]
    const key = sourceKeyOf(src)
    if (result?.ok) {
      const rows = (result.rows ?? []).map((r) => ({ ...r, sourceKey: key }))
      bySource.set(src.id, rows)
      for (const w of result.warnings ?? []) warnings.push(src.kind === 'timetable' ? w : `${src.label}: ${w}`)
      statuses.push({ ...src, status: 'ok', warnings: result.warnings ?? [], lastAttemptAt: nowMs, lastSuccessAt: nowMs })
    } else {
      // A failed attempt never advances success time and never blanks the
      // schedule: keep the source's last good rows, labelled stale.
      const kept = prevBySource.get(key) ?? []
      bySource.set(src.id, kept)
      const error = result?.error ?? 'Did not load.'
      statuses.push({ ...src, status: kept.length > 0 ? 'stale' : 'error', error, warnings: [], lastAttemptAt: nowMs, lastSuccessAt: null })
      warnings.push(
        kept.length > 0
          ? `${src.label} didn’t load — showing its last saved rows.`
          : `${src.label} didn’t load: ${error}`
      )
    }
  }
  return { bySource, statuses, warnings }
}

/** Monotonic refresh generations: an older in-flight request can check whether
 *  it is still the latest before publishing anything. */
export function createGenerationGate() {
  let current = 0
  return {
    begin() {
      const gen = ++current
      return { gen, isCurrent: () => gen === current }
    },
    current: () => current,
  }
}

/**
 * Aggregate CSV export (A3 / spec §4.7): explicit period, UTC boundary,
 * generation/observed times, schema version and per-row definitions with
 * numerator/denominator/completeness. No tokens, headers, raw events or
 * secrets — rows are built from already-validated aggregate values only.
 */

export interface CsvRow {
  metric: string
  label: string
  definition: string
  value: number | string | null
  numerator?: number | null
  denominator?: number | null
  source: string
  completeness: string
}

export interface CsvMeta {
  periodFrom: string
  periodTo: string
  generatedAt: string
  observedThrough: string | null
  schemaVersion: number
  partial: boolean
}

/** Neutralise spreadsheet formula prefixes and escape per RFC 4180. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`
  return s
}

export function buildCsv(meta: CsvMeta, rows: CsvRow[]): string {
  const head = [
    `# My Timetable admin analytics export`,
    `# period_from,${meta.periodFrom},period_to,${meta.periodTo},timezone,UTC,includes_partial_today,${meta.partial}`,
    `# generated_at,${meta.generatedAt},observed_through,${meta.observedThrough ?? 'unknown'},schema_version,${meta.schemaVersion}`,
    ['metric', 'label', 'definition', 'value', 'numerator', 'denominator', 'source', 'completeness'].join(','),
  ]
  const body = rows.map((r) =>
    [r.metric, r.label, r.definition, r.value, r.numerator ?? '', r.denominator ?? '', r.source, r.completeness]
      .map(csvCell)
      .join(',')
  )
  return [...head, ...body].join('\r\n') + '\r\n'
}

export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

import { useMemo, useState } from 'react'
import { ACTION_CATALOGUE } from '../../../shared/analytics-contracts.js'
import type { StatsV2 } from '../lib/client'

type SortKey = 'tokens' | 'name' | 'share' | 'uses'

interface Row {
  id: string
  label: string
  semantics: string
  measurement: 'v2' | 'not-collected'
  tokens: number | null
  denominator: number | null
  share: number | null
  uses: number | null
  startedAt: string | null
}

/**
 * Feature adoption (§4.3): every catalogue event is a row — measured rows
 * carry numerator/denominator/share/uses, unmeasured ones say "Not
 * collected" instead of a fake 0%. Sortable (announced via aria-sort),
 * searchable over the local catalogue only.
 */
export function Adoption({ v2 }: { v2: StatsV2 }) {
  const [sort, setSort] = useState<SortKey>('tokens')
  const [dir, setDir] = useState<-1 | 1>(-1)
  const [query, setQuery] = useState('')

  const rows = useMemo<Row[]>(() => {
    const v2ByFeature = new Map((v2.features ?? []).map((f) => [f.id, f]))
    return Object.entries(ACTION_CATALOGUE).map(([id, def]) => {
      const v2f = v2ByFeature.get(id)
      // One dataset (16 Sep 2026): a feature is measured under v2 or it is not
      // collected — no legacy received-day counters stand in for it.
      if (v2f && v2f.measurement === 'available') {
        return {
          id,
          label: def.label,
          semantics: def.semantics,
          measurement: 'v2',
          tokens: v2f.adoption.numerator,
          denominator: v2f.adoption.denominator,
          share: v2f.adoption.value,
          uses: v2f.uses.value,
          startedAt: v2f.collectionStartedAt,
        }
      }
      return {
        id,
        label: def.label,
        semantics: def.semantics,
        measurement: 'not-collected',
        tokens: null,
        denominator: null,
        share: null,
        uses: null,
        startedAt: v2f?.collectionStartedAt ?? null,
      }
    })
  }, [v2])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q ? rows.filter((r) => r.label.toLowerCase().includes(q) || r.id.includes(q)) : rows
    const measured = filtered.filter((r) => r.measurement !== 'not-collected')
    const unmeasured = filtered.filter((r) => r.measurement === 'not-collected')
    const cmp = (a: Row, b: Row) => {
      if (sort === 'name') return dir * a.label.localeCompare(b.label)
      const va = (sort === 'tokens' ? a.tokens : sort === 'share' ? a.share : a.uses) ?? -1
      const vb = (sort === 'tokens' ? b.tokens : sort === 'share' ? b.share : b.uses) ?? -1
      return dir * (va - vb)
    }
    // Default order: measured first (spec) — a name sort spans everything.
    if (sort === 'name') return [...filtered].sort(cmp)
    return [...measured.sort(cmp), ...unmeasured.sort((a, b) => a.label.localeCompare(b.label))]
  }, [rows, sort, dir, query])

  const header = (key: SortKey, label: string) => (
    <th scope="col" aria-sort={sort === key ? (dir === -1 ? 'descending' : 'ascending') : 'none'}>
      <button
        type="button"
        onClick={() => {
          if (sort === key) setDir((d) => (d === -1 ? 1 : -1))
          else {
            setSort(key)
            setDir(key === 'name' ? 1 : -1)
          }
        }}
      >
        {label} {sort === key ? (dir === -1 ? '↓' : '↑') : ''}
      </button>
    </th>
  )

  return (
    <>
      <div className="toolbar">
        <input
          type="search"
          aria-label="Search features"
          placeholder="Search features…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="table-wrap">
        <table>
          <caption>
            Feature adoption — distinct tokens with a positive count in the fixed last 7 UTC days,
            counted under the v2 event contract. “Not collected” means no instrumentation exists
            yet, never zero use.
          </caption>
          <thead>
            <tr>
              {header('name', 'Feature')}
              <th scope="col">What a count proves</th>
              {header('tokens', 'Tokens')}
              {header('share', 'Share')}
              {header('uses', 'Uses')}
              <th scope="col">Coverage</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <th scope="row">{r.label}</th>
                <td className="support">{r.semantics === 'success' ? 'completed successfully' : r.semantics === 'view' ? 'screen opened' : 'action started'}</td>
                <td>{r.tokens === null ? '—' : `${r.tokens}/${r.denominator ?? '—'}`}</td>
                <td>
                  {r.share === null ? (
                    '—'
                  ) : (
                    <span className="row">
                      <span className="adoption-bar">
                        <span style={{ width: `${r.share}%` }} />
                      </span>
                      {r.share}%
                    </span>
                  )}
                </td>
                <td>{r.uses === null ? '—' : r.uses}</td>
                <td>
                  {r.measurement === 'v2' && <span className="badge ok">event-day{r.startedAt ? ` since ${r.startedAt}` : ''}</span>}
                  {r.measurement === 'not-collected' && <span className="badge accent">Not collected</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="support" style={{ marginTop: 10 }}>
        Attempt names (photo, exports) mean the action was started — they never prove a file saved
        or a printer printed. Planned events appear here the moment instrumentation ships, with
        their collection start date.
      </p>
    </>
  )
}

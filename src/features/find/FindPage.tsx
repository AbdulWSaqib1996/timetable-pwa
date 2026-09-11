import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { FIND_PAGE_SIZE, searchFindIndex } from '../../../shared/find.js'
import { IconSearch, IconShield, PageHeader } from '../../components/ui'
import type { FindIndexState } from '../../hooks/useFindIndex'

export interface FindResult {
  key: string
  ownerType: 'session' | 'personal' | 'task' | 'plan' | 'pgce' | 'document'
  ownerId: string
  kind: string
  title: string
  date: string
  time: string
  snippet: string
  matchedIn: 'text' | 'content'
  meta: Record<string, string> | null
}

interface Props {
  profileId: string
  profileName: string
  todayISO: string
  state: FindIndexState
  includeNotes: boolean
  onToggleNotes: (next: boolean) => void
  onOpen: (result: FindResult) => void
  onBack: () => void
}

const DEBOUNCE_MS = 200
const TYPES = ['session', 'personal', 'task', 'plan', 'pgce', 'document'] as const
const TYPE_LABEL: Record<FindResult['ownerType'], string> = {
  session: 'Timetable',
  personal: 'Personal',
  task: 'Task',
  plan: 'Work plan',
  pgce: 'PGCE file',
  document: 'Document',
}
const GROUP_LABEL: Record<FindResult['ownerType'], string> = {
  session: 'Timetable sessions',
  personal: 'Personal events',
  task: 'Tasks',
  plan: 'Work-plan items',
  pgce: 'PGCE records',
  document: 'Documents',
}

const contextKey = (profileId: string) => `timetable.find.${profileId}`

function formatDate(dateISO: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return dateISO
  const [y, m, d] = dateISO.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * "Find anything" (R4 / NF-01 → V3): one local search over sessions, personal
 * events, tasks, work-plan items, PGCE records and wallet file names. The
 * query is debounced, results are paged at 50 and grouped by record type in
 * relevance order (the best-ranked group first, so the first button is still
 * the best match), and the query/scope/page are kept per profile in
 * sessionStorage so Back returns to the same view. No request ever carries
 * query text or results; there is no recent-search history.
 */
export function FindPage({ profileId, profileName, todayISO, state, includeNotes, onToggleNotes, onOpen, onBack }: Props) {
  const [query, setQuery] = useState(() => {
    try {
      const raw = sessionStorage.getItem(contextKey(profileId))
      return raw ? (JSON.parse(raw) as { query?: string }).query ?? '' : ''
    } catch {
      return ''
    }
  })
  const [debounced, setDebounced] = useState(query)
  const [limit, setLimit] = useState(FIND_PAGE_SIZE)
  const [types, setTypes] = useState<FindResult['ownerType'][] | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  // Leaving the page with the keyboard up must not strand fixed elements (iOS).
  useEffect(() => () => (document.activeElement as HTMLElement | null)?.blur?.(), [])
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [query])
  useEffect(() => {
    setLimit(FIND_PAGE_SIZE)
  }, [debounced, types, includeNotes])
  useEffect(() => {
    try {
      sessionStorage.setItem(contextKey(profileId), JSON.stringify({ query }))
    } catch {
      /* best effort */
    }
  }, [profileId, query])

  const { results, total } = useMemo(() => {
    if (!state.index) return { results: [] as FindResult[], total: 0 }
    const out = searchFindIndex(state.index, debounced, { includeContent: includeNotes, limit, types, todayISO })
    return { results: out.results as FindResult[], total: out.total }
  }, [state.index, debounced, includeNotes, limit, types, todayISO])

  // Groups in the order their best result ranks — never a fixed type order
  // that would push the top match below a weaker one.
  const groups = useMemo(() => {
    const order: FindResult['ownerType'][] = []
    const byType = new Map<FindResult['ownerType'], FindResult[]>()
    for (const r of results) {
      if (!byType.has(r.ownerType)) {
        byType.set(r.ownerType, [])
        order.push(r.ownerType)
      }
      byType.get(r.ownerType)!.push(r)
    }
    return order.map((t) => ({ type: t, items: byType.get(t)! }))
  }, [results])

  const onListKey = (e: KeyboardEvent) => {
    const items = [...(listRef.current?.querySelectorAll<HTMLElement>('.find-result') ?? [])]
    const i = items.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      items[Math.min(items.length - 1, i + 1)]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (i <= 0) inputRef.current?.focus()
      else items[i - 1]?.focus()
    }
  }

  const q = debounced.trim()
  const activeTypes = types ?? [...TYPES]
  return (
    <div className="page page-find">
      <PageHeader title="Find anything" subtitle={`Search ${profileName} and your own records`} back={{ label: 'Back', onBack }} />
      <label className="ui-field-label find-label" htmlFor="find-input">
        Search
      </label>
      <div className="searchbar find-searchbar">
        <span className="find-search-icon" aria-hidden="true">
          <IconSearch />
        </span>
        <input
          id="find-input"
          ref={inputRef}
          type="search"
          aria-label="Find anything"
          placeholder="Sessions, events, tasks, PGCE records, documents…"
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              listRef.current?.querySelector<HTMLElement>('.find-result')?.focus()
            }
          }}
        />
      </div>
      <div className="find-scope">
        <div className="chip-grid find-scope-chips" role="group" aria-label="Record types">
          {TYPES.map((t) => {
            const on = activeTypes.includes(t)
            return (
              <button
                key={t}
                type="button"
                className={`chip${on ? ' chip-on' : ''}`}
                aria-pressed={on}
                onClick={() =>
                  setTypes((prev) => {
                    const current = prev ?? [...TYPES]
                    const next = current.includes(t) ? current.filter((x) => x !== t) : [...current, t]
                    return next.length === TYPES.length ? null : next
                  })
                }
              >
                {TYPE_LABEL[t]}
              </button>
            )
          })}
          {types !== null && (
            <button type="button" className="travel-link" onClick={() => setTypes(null)}>
              All types
            </button>
          )}
        </div>
        <label className="toggle-row">
          <input type="checkbox" checked={includeNotes} onChange={(e) => onToggleNotes(e.target.checked)} />
          Include my notes and captions
        </label>
        <p className="filter-hint find-indexed-note">
          <IconShield size={16} /> Titles, rooms, tutors, subjects and file names are searched on this device only
          {includeNotes ? ', plus your notes, captions and record text' : ''}. Nothing is sent anywhere, and nothing is remembered
          between searches. A document that is not on this device is never treated as empty — it just cannot be searched here.
        </p>
      </div>

      {state.pending ? (
        <p className="filter-hint" role="status">
          Loading your timetable — results will appear from the saved copy as soon as it is ready.
        </p>
      ) : !q ? (
        <div className="ui-card find-empty">
          <p className="find-empty-title">Find the right record</p>
          <p className="filter-hint">Try a session title, room, task name or a word from your notes. Use ↓ to move into the results and Enter to open one.</p>
        </div>
      ) : results.length === 0 ? (
        <p className="filter-hint" role="status">
          No results for “{q}”{includeNotes ? '' : ' — turn on notes and captions to search inside records'}.
        </p>
      ) : (
        <>
          <p className="filter-hint" role="status" aria-live="polite">
            {total} result{total === 1 ? '' : 's'} for “{q}”{total > results.length ? ` — showing ${results.length}` : ''}
          </p>
          <ul className="find-results" ref={listRef} onKeyDown={onListKey} aria-label="Search results">
            {groups.map((g) => (
              <li key={g.type} className="find-group">
                <h3 className="find-group-title">
                  {GROUP_LABEL[g.type]} <span className="find-group-count">({g.items.length})</span>
                </h3>
                <ul className="find-group-list">
                  {g.items.map((r) => (
                    <li key={r.key}>
                      <button type="button" className="find-result" onClick={() => onOpen(r)}>
                        <span className="find-result-head">
                          <span className="badge badge-personal">{TYPE_LABEL[r.ownerType]}</span>
                          <span className="find-result-kind">{r.kind}</span>
                          {r.date && (
                            <span className="find-result-date">
                              {formatDate(r.date)}
                              {r.time ? ` · ${r.time}` : ''}
                            </span>
                          )}
                        </span>
                        <span className="find-result-title">{r.title}</span>
                        {r.snippet && <span className="find-result-snippet">{r.snippet}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          {total > results.length && (
            <button type="button" className="btn-secondary" onClick={() => setLimit((l) => l + FIND_PAGE_SIZE)}>
              Show more ({total - results.length} more)
            </button>
          )}
        </>
      )}
    </div>
  )
}

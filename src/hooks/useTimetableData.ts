import { identityHistory } from '../lib/identity'
import { reconcileEvents } from '../../shared/identity.js'
import { createGenerationGate, planSources, resolveSourceResults, sourceKeyOf } from '../../shared/refresh.js'
import type { SourceStatus } from '../../shared/refresh.js'
import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_PUSH_BASE } from '../lib/config'
import { buildDemoSessions } from '../lib/demo'
import { diffSessions } from '../lib/diff'
import { localTodayISO, selectCourseSessions } from '../lib/filters'
import { fetchGvizTable } from '../lib/gviz'
import { historyRecovered, markHistoryRecovered, recoverHistory, retainHistory } from '../lib/history'
import { parseTimetable } from '../lib/parseTimetable'
import { applyPendingNotificationActions } from '../lib/pendingActions'
import { expandPlacementSpans } from '../lib/placementSpans'
import {
  loadCache,
  loadChanges,
  loadMeta,
  loadStore,
  saveCache,
  saveChanges,
} from '../lib/storage'
import type { MetaMap, ProfileEntry, Session, SessionChange, Settings } from '../types'

/** Short stable hash of a source key, used to scope extra-tab row ids to the
 *  source's identity rather than its position in the extraTabs array. */
function srcHash(key: string): string {
  let h = 5381
  for (const c of key) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0
  return h.toString(36)
}

/**
 * Everything about loading and caching the active profile's data: sessions,
 * key dates, change history and per-session meta. Owns the refresh cycle;
 * the App renders what comes out. Refreshes are source-scoped and race-safe:
 * each configured source settles independently (a failed source keeps its
 * last good rows with a stale label), and a refresh generation gate stops an
 * older in-flight request from publishing over a newer profile or config.
 */
export function useTimetableData(active: ProfileEntry | null) {
  const [sessions, setSessions] = useState<Session[] | null>(null)
  const [fetchedAt, setFetchedAt] = useState<number | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [metaMap, setMetaMap] = useState<MetaMap>({})
  const [metaProfileId, setMetaProfileId] = useState<string | null>(null)
  const [changes, setChanges] = useState<SessionChange[]>([])
  const [keyDates, setKeyDates] = useState<Session[]>([])
  // Sessions whose identity is ambiguous after a sheet edit — surfaced as their
  // own actionable notice, never mixed into fetch errors.
  const [identityReview, setIdentityReview] = useState<Session[]>([])
  // Per-source outcome of the latest refresh (ok / stale / error + times).
  const [sources, setSources] = useState<SourceStatus[]>([])
  const todayISO = localTodayISO()

  const gateRef = useRef(createGenerationGate())
  const abortRef = useRef<AbortController | null>(null)
  const lastAttemptRef = useRef(0)
  const lastStatusesRef = useRef<SourceStatus[]>([])
  const activeRef = useRef(active)
  activeRef.current = active

  const refresh = useCallback(
    async (s: Settings, pid: string) => {
      if (s.demo) {
        setSessions(buildDemoSessions())
        setFetchedAt(Date.now())
        setError(null)
        return
      }
      // Newer request wins: abort the previous one and take a fresh generation.
      const ticket = gateRef.current.begin()
      abortRef.current?.abort()
      const ctrl = new AbortController()
      abortRef.current = ctrl
      lastAttemptRef.current = Date.now()
      setRefreshing(true)
      try {
        const plan = planSources(s)
        if (plan.length === 0) return
        const prev = loadCache(pid)
        const settled = await Promise.all(
          plan.map(async (src) => {
            try {
              const table = await fetchGvizTable(src.sheetId, src.gid, ctrl.signal)
              const result = parseTimetable(table)
              return [src.id, { ok: true, rows: result.sessions as Session[], warnings: result.warnings }] as const
            } catch (err) {
              return [src.id, { ok: false, error: err instanceof Error ? err.message : 'Failed to refresh.' }] as const
            }
          })
        )
        // A stale request publishes nothing — not state, not cache.
        if (!ticket.isCurrent()) return
        const prevRows = [...(prev?.sessions ?? []), ...(prev?.keyDates ?? [])]
        const { bySource, statuses } = resolveSourceResults(plan, Object.fromEntries(settled), prevRows)
        // Carry each source's last success time forward across failed attempts.
        for (const st of statuses) {
          if (st.lastSuccessAt === null) {
            st.lastSuccessAt = lastStatusesRef.current.find((p) => p.id === st.id)?.lastSuccessAt ?? null
          }
        }
        lastStatusesRef.current = statuses
        setSources(statuses)
        const messages: string[] = []
        for (const st of statuses) {
          for (const w of st.warnings) messages.push(st.kind === 'timetable' ? w : `${st.label}: ${w}`)
          if (st.status === 'stale') messages.push(`${st.label} didn’t load — showing its last saved rows.`)
          if (st.status === 'error') messages.push(`${st.label} didn’t load: ${st.error ?? 'unknown error.'}`)
        }
        const main = statuses[0]
        if (main.status === 'error') {
          // Nothing usable for the main timetable and nothing cached for it:
          // report, but never blank a previously rendered timetable.
          setError(messages.join(' '))
          return
        }

        // Assemble the timetable rows (main + extra tabs), ids scoped by source identity.
        let parsed: Session[] = []
        for (const src of plan) {
          if (src.kind === 'keydates') continue
          const rows = bySource.get(src.id) ?? []
          parsed = parsed.concat(
            src.kind === 'extra' ? rows.map((x) => ({ ...x, id: x.id.startsWith('t') ? x.id : `t${srcHash(sourceKeyOf(src))}-${x.id}` })) : rows
          )
        }
        if ((s.extraTabs ?? []).length > 0) {
          const seen = new Set<string>()
          parsed = parsed.filter((x) => {
            const k = `${x.dateISO}|${x.start}|${x.title.toLowerCase()}|${x.room}`
            if (seen.has(k)) return false
            seen.add(k)
            return true
          })
          parsed.sort((a, b) => (a.dateISO + (a.start || '99')).localeCompare(b.dateISO + (b.start || '99')))
        }
        // The sheet drops past rows (rolling TODAY() filter) — keep the history
        // this app has already seen, and once per profile back-fill days lost
        // before retention existed from the push worker's snapshot.
        parsed = reconcileEvents(parsed, (prev?.identityHistory ?? prev?.sessions ?? []).filter((x) => !x.isKeyDate))
        parsed = retainHistory(parsed, prev?.sessions, todayISO)
        if (!historyRecovered(pid)) {
          const recovered = await recoverHistory(
            s.pushServerBase ?? DEFAULT_PUSH_BASE,
            s.sheetId,
            s.gid,
            parsed,
            todayISO
          )
          if (!ticket.isCurrent()) return
          if (recovered.length > 0) parsed = [...parsed, ...recovered]
          markHistoryRecovered(pid)
        }
        parsed.sort((a, b) => (a.dateISO + (a.start || '99')).localeCompare(b.dateISO + (b.start || '99')))
        parsed = expandPlacementSpans(parsed)
        if (prev) {
          // Diff the user's course membership view of old vs new (groups +
          // specialisms only — temporary display filters must not decide what
          // change alerts the user gets); synthetic placement days are excluded
          // so span expansion never floods the bell.
          const notSynthetic = (x: Session) => !x.id.startsWith('plc-')
          const newChanges = diffSessions(
            selectCourseSessions(prev.sessions.filter(notSynthetic), s),
            selectCourseSessions(parsed.filter(notSynthetic), s),
            todayISO
          )
          if (newChanges.length > 0) {
            const merged = [...newChanges, ...loadChanges(pid)]
            saveChanges(pid, merged)
            setChanges(merged.slice(0, 100))
          }
        }
        // Key dates resolve like any other source: stale rows survive a failed tab.
        let kd: Session[] | undefined
        if (s.keyDatesSheetId) {
          const kdStatus = statuses.find((st) => st.kind === 'keydates')
          if (kdStatus?.status === 'ok') {
            const rows = (bySource.get('keydates') ?? []).map((k) => ({
              ...k,
              id: k.id.startsWith('kd-') ? k.id : `kd-${k.id}`,
              isKeyDate: true as const,
            }))
            kd = reconcileEvents(rows, (prev?.identityHistory ?? prev?.keyDates ?? []).filter((x) => x.isKeyDate))
            // Past deadlines survive too, if that tab also rolls forward.
            kd = retainHistory(kd, prev?.keyDates, todayISO)
          } else {
            kd = prev?.keyDates
          }
        }
        // Final gate before commit: still the latest request, and the profile
        // must still exist (a refresh must never resurrect a deleted profile's
        // cache keys).
        if (!ticket.isCurrent()) return
        if (!loadStore()?.profiles.some((p) => p.id === pid)) return
        setSessions(parsed)
        setKeyDates(kd ?? [])
        const now = Date.now()
        setFetchedAt(now)
        setIdentityReview([...parsed, ...(kd ?? [])].filter((x) => x.identityCandidates?.length || x.identityWarning))
        setError(messages.join(' ') || null)
        saveCache(pid, {
          fetchedAt: now,
          sessions: parsed,
          keyDates: kd,
          identityHistory: identityHistory(
            prev?.identityHistory ?? [...(prev?.sessions ?? []), ...(prev?.keyDates ?? [])],
            [...parsed, ...(kd ?? [])]
          ),
        })
      } catch (err) {
        if (!ticket.isCurrent()) return
        setError(err instanceof Error ? err.message : 'Failed to refresh.')
      } finally {
        if (ticket.isCurrent()) setRefreshing(false)
      }
    },
    [todayISO]
  )

  // When the active profile changes (startup or switch): load its cache/meta/changes, then refresh.
  useEffect(() => {
    if (!active) return
    const cached = loadCache(active.id)
    setSessions(cached && !active.settings.demo ? cached.sessions : null)
    setFetchedAt(cached && !active.settings.demo ? cached.fetchedAt : null)
    setMetaMap(loadMeta(active.id))
    setMetaProfileId(active.id)
    setChanges(loadChanges(active.id))
    setKeyDates((cached?.keyDates ?? []).map((k) => ({ ...k, isKeyDate: true })))
    setIdentityReview(
      [...(cached?.sessions ?? []), ...(cached?.keyDates ?? [])].filter(
        (x) => x.identityCandidates?.length || x.identityWarning
      )
    )
    setSources([])
    lastStatusesRef.current = []
    // Apply notification actions queued while the app was closed — each to its
    // OWNING profile (P3-05), not whichever profile happens to be active.
    const pid = active.id
    void applyPendingNotificationActions().then((res) => {
      if (res.changedProfiles.has(pid)) setMetaMap(loadMeta(pid))
      for (const o of res.open) {
        window.dispatchEvent(new CustomEvent('timetable-open-request', { detail: o }))
      }
    })
    setError(null)
    void refresh(active.settings, active.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id])

  // Refetch when the key-dates tab or merged tabs change in Settings.
  const extraTabsKey = JSON.stringify(active?.settings.extraTabs ?? [])
  useEffect(() => {
    if (active && sessions !== null && (active.settings.keyDatesSheetId || (active.settings.extraTabs ?? []).length > 0)) {
      void refresh(active.settings, active.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.settings.keyDatesSheetId, active?.settings.keyDatesGid, extraTabsKey])

  // Revalidate on resume: installed PWAs mostly resume rather than relaunch, so
  // refresh when the tab becomes visible again — throttled to every 10 minutes,
  // and only while a profile is active. (No timers run while hidden.)
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastAttemptRef.current < 10 * 60_000) return
      const a = activeRef.current
      if (a && !a.settings.demo) void refresh(a.settings, a.id)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    identityReview,
    sessions,
    keyDates,
    fetchedAt,
    refreshing,
    error,
    sources,
    metaMap,
    metaReady: active !== null && metaProfileId === active.id,
    setMetaMap,
    changes,
    setChanges,
    refresh,
  }
}

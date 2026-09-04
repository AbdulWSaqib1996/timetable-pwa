import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_PUSH_BASE } from '../lib/config'
import { buildDemoSessions } from '../lib/demo'
import { diffSessions } from '../lib/diff'
import { applyFilters, localTodayISO } from '../lib/filters'
import { fetchGvizTable } from '../lib/gviz'
import { historyRecovered, markHistoryRecovered, recoverHistory, retainHistory } from '../lib/history'
import { parseTimetable } from '../lib/parseTimetable'
import { drainPendingActions } from '../lib/pendingActions'
import { expandPlacementSpans } from '../lib/placementSpans'
import {
  loadCache,
  loadChanges,
  loadMeta,
  saveCache,
  saveChanges,
  saveMeta,
} from '../lib/storage'
import type { MetaMap, ProfileEntry, Session, SessionChange, Settings } from '../types'

/**
 * Everything about loading and caching the active profile's data: sessions,
 * key dates, change history and per-session meta. Owns the refresh cycle;
 * the App renders what comes out.
 */
export function useTimetableData(active: ProfileEntry | null) {
  const [sessions, setSessions] = useState<Session[] | null>(null)
  const [fetchedAt, setFetchedAt] = useState<number | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [metaMap, setMetaMap] = useState<MetaMap>({})
  const [changes, setChanges] = useState<SessionChange[]>([])
  const [keyDates, setKeyDates] = useState<Session[]>([])
  const todayISO = localTodayISO()

  const refresh = useCallback(
    async (s: Settings, pid: string) => {
      if (s.demo) {
        setSessions(buildDemoSessions())
        setFetchedAt(Date.now())
        setError(null)
        return
      }
      setRefreshing(true)
      try {
        const table = await fetchGvizTable(s.sheetId, s.gid)
        let parsed = parseTimetable(table).sessions
        // Merge any extra tabs into the same timetable, deduplicating identical rows.
        for (const [i, tab] of (s.extraTabs ?? []).entries()) {
          try {
            const extra = await fetchGvizTable(tab.sheetId, tab.gid)
            parsed = parsed.concat(
              parseTimetable(extra).sessions.map((x) => ({ ...x, id: `t${i}-${x.id}` }))
            )
          } catch {
            /* a broken extra tab shouldn't take down the main timetable */
          }
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
        const prev = loadCache(pid)
        // The sheet drops past rows (rolling TODAY() filter) — keep the history
        // this app has already seen, and once per profile back-fill days lost
        // before retention existed from the push worker's snapshot.
        parsed = retainHistory(parsed, prev?.sessions, todayISO)
        if (!historyRecovered(pid)) {
          const recovered = await recoverHistory(
            s.pushServerBase ?? DEFAULT_PUSH_BASE,
            s.sheetId,
            s.gid,
            parsed,
            todayISO
          )
          if (recovered.length > 0) parsed = [...parsed, ...recovered]
          markHistoryRecovered(pid)
        }
        parsed.sort((a, b) => (a.dateISO + (a.start || '99')).localeCompare(b.dateISO + (b.start || '99')))
        parsed = expandPlacementSpans(parsed)
        if (prev) {
          // Diff the user's own view of old vs new (their specialism/group filters applied);
          // synthetic placement days are excluded so span expansion never floods the bell.
          const notSynthetic = (x: Session) => !x.id.startsWith('plc-')
          const newChanges = diffSessions(
            applyFilters(prev.sessions.filter(notSynthetic), s, todayISO, { ignoreDateRange: true }),
            applyFilters(parsed.filter(notSynthetic), s, todayISO, { ignoreDateRange: true }),
            todayISO
          )
          if (newChanges.length > 0) {
            const merged = [...newChanges, ...loadChanges(pid)]
            saveChanges(pid, merged)
            setChanges(merged.slice(0, 100))
          }
        }
        // Key dates live in a second tab; failures there never break the main timetable.
        let kd: Session[] | undefined
        if (s.keyDatesSheetId) {
          try {
            const kdTable = await fetchGvizTable(s.keyDatesSheetId, s.keyDatesGid ?? null)
            kd = parseTimetable(kdTable).sessions.map((k) => ({ ...k, id: `kd-${k.id}`, isKeyDate: true }))
            // Past deadlines survive too, if that tab also rolls forward.
            kd = retainHistory(kd, prev?.keyDates, todayISO)
          } catch {
            kd = prev?.keyDates
          }
        }
        setSessions(parsed)
        setKeyDates(kd ?? [])
        const now = Date.now()
        setFetchedAt(now)
        setError(null)
        saveCache(pid, { fetchedAt: now, sessions: parsed, keyDates: kd })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to refresh.')
      } finally {
        setRefreshing(false)
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
    setChanges(loadChanges(active.id))
    setKeyDates((cached?.keyDates ?? []).map((k) => ({ ...k, isKeyDate: true })))
    // Apply "✓ Attended"/"✗ Absent" taps made on notifications while the app was closed.
    const pid = active.id
    void drainPendingActions().then((actions) => {
      const marks = actions.filter((a) => (a.action === 'attended' || a.action === 'absent') && a.key)
      if (marks.length === 0) return
      setMetaMap((prev) => {
        const next = { ...prev }
        for (const { action, key } of marks) {
          next[key] = { ...next[key], attended: action === 'attended', absent: action === 'absent', at: Date.now() }
        }
        saveMeta(pid, next)
        return next
      })
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

  return {
    sessions,
    keyDates,
    fetchedAt,
    refreshing,
    error,
    metaMap,
    setMetaMap,
    changes,
    setChanges,
    refresh,
  }
}

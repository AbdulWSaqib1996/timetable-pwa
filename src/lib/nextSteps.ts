import { nextSteps as derive } from '../../shared/practice.js'
import type { NextStep } from '../../shared/practice.js'
import type { AdminFile } from './admin'

/** Dismiss/pin state for Today's next steps: per profile, on this device only
 *  (a dismissal hides a step for that day; a pin keeps it first). */
export interface NextStepPrefs { dismissed: { id: string; dateISO: string }[]; pinned: string[] }

const key = (pid: string) => `timetable.nextsteps.v1.${pid}`

export function loadNextStepPrefs(pid: string): NextStepPrefs {
  try {
    const raw = localStorage.getItem(key(pid))
    const parsed = raw ? (JSON.parse(raw) as Partial<NextStepPrefs>) : {}
    return { dismissed: parsed.dismissed ?? [], pinned: parsed.pinned ?? [] }
  } catch {
    return { dismissed: [], pinned: [] }
  }
}

export function saveNextStepPrefs(pid: string, prefs: NextStepPrefs): void {
  try {
    // Old dismissals fall away; only today's matter.
    localStorage.setItem(key(pid), JSON.stringify({ dismissed: prefs.dismissed.slice(-50), pinned: prefs.pinned.slice(-20) }))
  } catch {
    /* storage full or blocked: prefs are a convenience */
  }
}

export const deriveNextSteps = (admin: AdminFile, todayISO: string, prefs: NextStepPrefs): NextStep[] => derive(admin, todayISO, prefs)

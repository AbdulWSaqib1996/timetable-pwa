/** Bump the version whenever WHATSNEW changes; the app shows the list once per version. */
export const WHATSNEW_VERSION = 6

export const WHATSNEW: string[] = [
  '🕰 Past days are back — the app now keeps history the sheet deletes daily, so yesterday’s sessions and attendance stay put',
  '🏠 Head home — set your home address in Settings → Travel times and get a live journey-home card (time, TfL route, arrival ETA) as your last session ends',
  '🎓 My PGCE file — tap the cap in the top bar: reflections, targets, meetings, observations, lessons, audits, wallet and a full binder export',
  '📋 Friday admin digest push: what’s still outstanding before the weekend',
]

const KEY = 'timetable.whatsnew.v1'

export function shouldShowWhatsNew(): boolean {
  try {
    return parseInt(localStorage.getItem(KEY) ?? '0', 10) < WHATSNEW_VERSION
  } catch {
    return false
  }
}

export function dismissWhatsNew(): void {
  try {
    localStorage.setItem(KEY, String(WHATSNEW_VERSION))
  } catch {
    /* ignore */
  }
}

/** Bump the version whenever WHATSNEW changes; the app shows the list once per version. */
export const WHATSNEW_VERSION = 6

export const WHATSNEW: string[] = [
  '🕰 Past days are back — tap 🕰 next to Day/Week/Month to show history (the sheet deletes it daily; the app now keeps it, attendance included)',
  '🏠 Head home — set your home address in Settings → Travel times; a 🏠 pill in the header shows the live journey home (tap for route + arrival ETA) whenever you’re out',
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

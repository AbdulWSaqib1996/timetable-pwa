/** Bump the version whenever WHATSNEW changes; the app shows the list once per version. */
export const WHATSNEW_VERSION = 4

export const WHATSNEW: string[] = [
  '✗ Absence tracking — record absences (with a reason) alongside attendance',
  '📣 New cohort notices now arrive as push notifications too',
  '🏫 Week and month views now show placements (green) and term breaks',
  '📷 Share a photo straight into today’s session from your camera roll',
  '🌙 Quiet hours — silence all notifications overnight (Settings → Notifications)',
  '📲 Android/desktop get an Install button in Settings',
  '⚠ Settings warns when your calendar-feed URL needs re-copying',
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

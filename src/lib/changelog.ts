/** Bump the version whenever WHATSNEW changes; the app shows the list once per version. */
export const WHATSNEW_VERSION = 1

export const WHATSNEW: string[] = [
  '📌 Personal deadlines — add your own key dates alongside the official ones',
  '✓ Assignment status — mark deadlines in progress or submitted',
  '👥 Study groups — share a code with coursemates to find common free slots',
  '🏫 Placement days now render as one calm block',
  '🔔 Multiple alerts due at once arrive as a single notification',
  '⚠ You’ll be told if your timetable sheet stops loading',
  '📶 Journey info falls back to last-known data when offline',
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

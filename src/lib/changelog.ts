/** Bump the version whenever WHATSNEW changes; the app shows the list once per version. */
export const WHATSNEW_VERSION = 3

export const WHATSNEW: string[] = [
  '📆 Calendar feed now includes placement days, located at your school',
  '✓ “Did you attend?” prompt at each session’s end (turn on under Session reminders)',
  '🖨 Evidence journal prints to PDF with your photos included',
  '📅 Sunday-evening week-ahead push — with a warning when a placement starts',
  '🔄 Sync now merges notes from both devices and pulls when you return to the app',
  '📱 iPhone? Settings now walks you through installing before enabling push',
  '📣 Cohort notices — reps can broadcast from a tab in the same sheet',
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

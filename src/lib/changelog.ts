/** Bump the version whenever WHATSNEW changes; the app shows the list once per version. */
export const WHATSNEW_VERSION = 2

export const WHATSNEW: string[] = [
  '🏫 Placement day counter — tick “Attended” on school days to log them (set your required days in Settings)',
  '📔 Evidence journal — tag notes/photos TS1–TS8 and export the bundle',
  '🔄 Sync between devices — share a code to keep phone + laptop identical',
  '🩺 Push self-check — Settings answers “why didn’t I get a notification?”',
  '🏖 Term breaks now show as a labelled band instead of blank days',
  '🚌 Departure boards refresh live every 30 seconds',
  '🔔 Background alerts now cover placement days and route to your school',
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

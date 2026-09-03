/** Bump the version whenever WHATSNEW changes; the app shows the list once per version. */
export const WHATSNEW_VERSION = 5

export const WHATSNEW: string[] = [
  '🎓 My PGCE file — tap the cap in the top bar: your whole admin file in one place',
  '✍️ Weekly reflections, 🎯 mentor targets and ☐ meeting actions, all logged in seconds',
  '👀 Observation records (development points become targets) and 🍎 a lessons-taught log',
  '📚 Subject-knowledge audit tracker and 📎 a document wallet (DBS, certificates, templates)',
  '📊 Overview dashboard with evidence-gap warnings per Teachers’ Standard',
  '🖨 One-tap full binder export — the end-of-placement hand-in as a PDF',
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

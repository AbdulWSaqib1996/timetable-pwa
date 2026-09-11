/**
 * What's new. EVERY release pass adds an entry here and bumps WHATSNEW_VERSION
 * (AGENTS.md release runbook, owner instruction 11 Sep 2026). The app shows
 * the latest entry once per version; Settings → Help lists the history.
 */
export interface WhatsNewEntry { version: number; dateISO: string; title: string; items: string[] }

export const WHATSNEW_ENTRIES: WhatsNewEntry[] = [
  {
    version: 7,
    dateISO: '2026-09-11',
    title: 'PGCE file: placements, lessons, knowledge, workload, evidence',
    items: [
      'Placements SE1, SE2 and SE3 — set up each school with a confirmed map pin, mentor, dates and hours; To school and Back home journeys; a workspace per placement',
      'Lesson workbench — Plan → Rehearse → Teach → Review over one lesson; rehearsal blocks on your Schedule; next attempt without copying outcomes',
      'Practice focus and mentor preparation — one focus at a time; an agenda before the meeting, agreed actions on the meeting record after',
      'Today next steps — up to three, from dated work only; dismiss for today or pin',
      'Programme roadmap — your course profile, imported requirement packs you confirm yourself, milestones; no built-in day target',
      'Subject knowledge goals with your own confidence ratings; academic projects with deadlines from your key dates; workload proposals you accept or undo, with protected time and support notes',
      'Evidence examples over your records (ITTECF and Teachers’ Standards as separate references), review packs that pin what they show, an experience ledger by layer, review records and a first-post handover pack',
      'Bottom navigation stays put on iOS after the keyboard closes',
    ],
  },
  {
    version: 6,
    dateISO: '2026-09-03',
    title: 'History, journey home, PGCE file, digest',
    items: [
      'Past days are back — tap next to Day/Week/Month to show history (the sheet deletes it daily; the app now keeps it, attendance included)',
      'Head home — set your home address in Settings → Travel times; a pill in the header shows the live journey home (tap for route + arrival ETA) whenever you’re out',
      'My PGCE file — tap the cap in the top bar: reflections, targets, meetings, observations, lessons, audits, wallet and a full binder export',
      'Friday admin digest push: what’s still outstanding before the weekend',
    ],
  },
]

/** Bump the version whenever an entry is added; the app shows the latest entry once per version. */
export const WHATSNEW_VERSION = WHATSNEW_ENTRIES[0].version
/** The latest entry's items (shown once after an update). */
export const WHATSNEW: string[] = WHATSNEW_ENTRIES[0].items

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

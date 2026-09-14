/**
 * What's new. EVERY release pass adds an entry here and bumps WHATSNEW_VERSION
 * (AGENTS.md release runbook, owner instruction 11 Sep 2026). The app shows
 * the latest entry once per version; Settings → Help lists the history.
 */
export interface WhatsNewEntry { version: number; dateISO: string; title: string; items: string[] }

export const WHATSNEW_ENTRIES: WhatsNewEntry[] = [
  {
    version: 12,
    dateISO: '2026-09-14',
    title: 'Recover, pause and take back',
    items: [
      'Mentor portal: every action can be retried, drafts survive a failed send, and expired sessions, ended access and connection problems each say what happened',
      'Mentor access: pause it on one device without losing anything, or end it for every mentor with a preview of what changes — and reopen later',
      'Review packs: unshare a pack from all mentors, and deleting a pack or a reflection asks first and offers Undo',
      'Journeys: “Open planned route” starts from the origin you chose; “Navigate from my location” is its own button',
      'Key dates that share a title at different times or rooms now both show, marked as a group',
    ],
  },
  {
    version: 11,
    dateISO: '2026-09-13',
    title: 'Sharing you can check, one school record everywhere',
    items: [
      'Review packs: each pack keeps its own picks, recipients and files; sharing shows exactly what changes before you send, and a share replaces what the portal held',
      'Pack attachments are matched by the file itself, not a device number — a file this device cannot find says so and can be relinked',
      'School details come from your placement setup everywhere: session travel, the Schedule school-day card, Today and reminders; edit them in one place',
    ],
  },
  {
    version: 10,
    dateISO: '2026-09-13',
    title: 'Completed tasks are easy to find',
    items: [
      'Marking a task done opens the Completed section, scrolls it into view, highlights the task and offers Put it back',
    ],
  },
  {
    version: 9,
    dateISO: '2026-09-13',
    title: 'Key dates shown once, first on the day',
    items: [
      'A key date that appears more than once — a repeated sheet row, a task with the same title, or the same deadline on the timetable tab — now shows as one highlighted row',
      'On the Schedule, key dates lead their day instead of sitting among the sessions by time',
    ],
  },
  {
    version: 8,
    dateISO: '2026-09-11',
    title: 'Mentor portal',
    items: [
      'Invite a mentor or tutor to a portal where they see only the review packs you share (Settings → Data & devices → Mentor access)',
      'Share a review pack from the PGCE file, with attachments encrypted on your device before upload',
      'Their feedback arrives signed as reviewer-authenticated — shown with their name, never editable, and you can end anyone’s access at any time',
    ],
  },
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

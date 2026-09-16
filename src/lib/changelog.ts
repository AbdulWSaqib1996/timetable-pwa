/**
 * What's new. EVERY release pass adds an entry here and bumps WHATSNEW_VERSION
 * (AGENTS.md release runbook, owner instruction 11 Sep 2026). The app shows
 * the latest entry once per version; Settings → Help lists the history.
 */
export interface WhatsNewEntry { version: number; dateISO: string; title: string; items: string[] }

export const WHATSNEW_ENTRIES: WhatsNewEntry[] = [
  {
    version: 19,
    dateISO: '2026-09-16',
    title: 'One honest view of where your data is',
    items: [
      'Settings → Data & devices opens with a Data & sharing centre: On this device, Synced to my devices, Backed up and Shared with mentors — each from a confirmed result (a saved change, the server’s acknowledged sync time, a backup you generated here, a share the mentor service acknowledged), never from a button press',
      'Review details lists every photo and document: where it is, whether a backup generated here carried its bytes, which shared pack revision includes it and when the portal copy expires. A file a record refers to but this device does not have is listed as missing and can be relinked',
      'The restore preview now says which referenced files are in neither the backup nor this device before you restore; a records-only backup is never described as containing files',
      'Download a plain-language recovery guide to keep with your backup — it names what exists and how to get it back, and contains no code, token or key',
    ],
  },
  {
    version: 18,
    dateISO: '2026-09-16',
    title: 'A weekly review, and assignments from brief to feedback',
    items: [
      'Workload & support has a Weekly review: this week planned, logged and still open; next week fixed (sessions, placement travel, commitments, protected time) and free; and the planner’s proposals as a diff — moved, added, untouched, kept — that you accept one by one or as a batch. Undo reverses only that batch, the same proposals are never added twice, and a timetable change says why they were recalculated',
      'Academic work now carries the whole assignment: a summary (due date from your key dates, your word target, stage, sources, next task), a versioned outline, draft references (a wallet document or a link), a submission record you enter yourself with an optional receipt file — never institution-verified; a resubmission adds to the history — feedback references and your own source list',
      'Changing an assignment’s deadline updates its summary without adding a second pin to the Schedule; a receipt is kept by its stable document identity so it survives backup and restore, and says so when the file is missing on this device',
    ],
  },
  {
    version: 17,
    dateISO: '2026-09-16',
    title: 'Teaching cycles, preparing for your next placement, student rep meetings',
    items: [
      'Start a teaching cycle from any lesson: Plan → Teach → Feedback → Try next as one thread, with a compact timeline at the top of the lesson workbench saying what is missing and why. Feedback is attached by reference — one observation can inform several cycles — and the next attempt can sit on a different placement without changing the original lesson',
      'Prepare for SE2 or SE3 from the PGCE file: a checklist over School & travel, Teaching context, Mentor & access and Carry forward, with your outward and return journeys previewed before the first day. A tick goes stale if the school pin or what you share changes. Nothing is written to the placement you are leaving',
      'A placement can have its own return destination (temporary accommodation, say); Back home uses it and says so, with your home address as the labelled fallback',
      'Student Rep meetings are optional and never count towards attendance. They are hidden unless Settings → My timetable → Student rep says you are one',
    ],
  },
  {
    version: 16,
    dateISO: '2026-09-16',
    title: 'Deadlines behave like deadlines, and sessions know where they are',
    items: [
      'A timetable row that is really a deadline never shows an attendance register: if it matches a key date it opens as one, and any row can be marked “not a session I attend” — it then completes like a key date on Tasks and the Schedule',
      'Your first session of a day is a real session — a deadline is never counted as one, today or tomorrow',
      'A session whose room says something like “In School” takes its own address: set it on the session, locate it, and its travel, map and directions use that place. Every session keeps its own',
    ],
  },
  {
    version: 15,
    dateISO: '2026-09-16',
    title: 'Homework on any session, quieter sync, placements to hand',
    items: [
      'Open a session and record homework there, scheduled against a later occurrence of it — no need to open the lesson first',
      'Sync no longer takes a banner above the page: a small status control in the header shows it, and holds the message and Retry when something fails',
      'A placement you have set up stays on the PGCE file with Open and Edit, and your other placements are listed beside it',
    ],
  },
  {
    version: 14,
    dateISO: '2026-09-15',
    title: 'Homework, and key dates you tick off',
    items: [
      'Key dates are never marked attended — you mark them done. A completed key date stays on the schedule, shown as completed, and the tick is the same on Tasks and on the Schedule',
      'Lessons can record homework and schedule it against a later occurrence of that lesson: homework from Maths 1 can be due in Maths 2',
      'Homework shows on the session it is due in, on Tasks with its due date and on the Schedule — one tick anywhere marks it done everywhere',
    ],
  },
  {
    version: 13,
    dateISO: '2026-09-14',
    title: 'A PGCE file that starts where you left off',
    items: [
      'PGCE file: your active placement, one recommended next action with its reason, and four destinations — Lessons & practice, Mentor & feedback, Evidence & reviews, Academic work & programme; every record type has its own address you can bookmark or refresh',
      'Review packs: packs on the left, one pack on the right, in three steps — Content, People, Check & share — with a search over your records and a sharing state beside each pack',
      'Schedule on a phone: one toolbar (view, Filters with a count and Clear, Today), a school-day card with the school, its hours and where they come from, and To school / Back home',
      'Readability: 16px body text, 28px page titles, arrow keys on every tab strip, visible labels on every form, and reduced motion honoured; the mentor portal uses the same colours with accessible dark-mode buttons',
      'Deleting a record asks first and can be undone; each record editor shows its type, placement, date and whether it is saved',
    ],
  },
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

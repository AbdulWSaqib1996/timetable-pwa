# Phase 4 feature-preservation inventory (P4-01)

Every pre-Phase-4 control mapped to its destination in the new shell. A feature
counts as migrated only when it is reachable and functional in the new UI.
Status: ✅ reachable in the new shell now · 🔜 moves in the listed work item.

## Former top bar

| Feature | New home | Status |
|---|---|---|
| App title + "updated Xm ago" | Today header subtitle | ✅ |
| 🏠 Home pill + journey popover | Today "Journey home" row (P4-06 full screen) | ✅ (🔜 P4-06 screen) |
| 🎓 My PGCE file button | PGCE file destination (bottom nav / sidebar) | ✅ |
| 🔍 Search | Schedule header action | ✅ |
| 🔔 Changes bell + badge | Today header action (labelled) | ✅ |
| ↻ Refresh | Today header action | ✅ |
| ⚙ Settings | Today header action + sidebar footer | ✅ |
| Day/Week/Month segmented control | Schedule toolbar | ✅ (🔜 P4-03 Week/Month + day strip) |
| 🕰 history toggle | Schedule toolbar | ✅ |
| 🏫 placements-only toggle | Schedule toolbar | ✅ |
| Filters button + count | Schedule toolbar | ✅ |

## Former day view

| Feature | New home | Status |
|---|---|---|
| Now/Next card | Today hero (current/next + room + actions) | ✅ |
| Next-deadline strip | Today (unchanged `.keydate-strip`) | ✅ |
| Agenda with gaps/breaks/clashes | Schedule Day list (P4-03 selected-day list) | ✅ |
| TfL disruptions banner | Today banner (transit mode) | ✅ |
| ＋ add personal deadline FAB | Today FAB (🔜 P4-07 Tasks primary action) | ✅ |
| Placement progress line | Schedule day list placement blocks | ✅ |

## Sheets and flows

| Feature | New home | Status |
|---|---|---|
| Key dates sheet (statuses, ICS, cycle) | Tasks destination | ✅ (🔜 P4-07 page with Overdue/Upcoming/Completed) |
| Add deadline sheet | Tasks / Today FAB | ✅ |
| PGCE admin file (reflections, targets, meetings, observations, lessons, audits, wallet, binder) | PGCE file destination | ✅ (🔜 P4-07 four sections) |
| Stats sheet | Settings → term stats (🔜 P4-08 placement under PGCE/Settings) | ✅ |
| Evidence journal | Settings → journal (🔜 P4-07 Evidence & reflections) | ✅ |
| Study group sheet | Settings → study group | ✅ |
| Changes sheet | Bell on Today | ✅ |
| Filter sheet (membership + display + reminder participation) | Schedule → Filters | ✅ |
| Specialism picker | Unchanged (first-load dialog) | ✅ |
| Session detail (attendance, notes, photos, standards, travel, Moodle, calendar) | Card tap → detail (🔜 P4-05 full page + tabs) | ✅ |
| Settings sheet (all sections: sources/extra tabs/notices, reminders, travel & home, calendar feed/export, backup/import/sync, appearance, install, profiles, analytics opt-out, placement targets) | Settings surface (🔜 P4-08 seven focused pages) | ✅ |
| Setup screen + demo + share links (`#setup=`) | Unchanged (🔜 P4-09 Connect→Personalise→Preview) | ✅ |
| What's new banner | Today banner (🔜 P4-08 Help & privacy) | ✅ |
| Setup checklist, backup nudge, notices, identity review, sync/persistence notices | Shell banners above every destination | ✅ |
| Notification tap → owning profile/session | Unchanged (works over any destination) | ✅ |
| PWA shortcut `?view=keydates` | Opens Tasks surface | ✅ |
| Share-target photo intake | Unchanged | ✅ |

## Notification toggles / background features

All unchanged and reachable via Settings: push enable/test, reminder offsets,
leave alerts, key-date reminder days, attendance prompts, quiet hours, morning
briefing, change alerts, Friday digest, background leave alerts, usage ping
opt-out. (🔜 P4-08 groups them under a Reminders page.)

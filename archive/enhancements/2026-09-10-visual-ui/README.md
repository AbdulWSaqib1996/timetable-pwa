# Visual UI audit — archived package (10–11 September 2026)

This folder is the completed handoff for the visual UI audit of My Timetable. It was moved here from the repo root by V5 (PLAN.md Pass 67) once every batch had shipped and been verified. Relative links inside the package are unchanged: [VISUAL_UI_AUDIT.md](VISUAL_UI_AUDIT.md) (the audit), [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) (the batch plan with the functional preservation register), [GAP_AUDIT_2026-09-10.md](GAP_AUDIT_2026-09-10.md) (the owner-prompted full check after V4), `designs/` (mockups, `design.css`, `gallery.html`), `evidence/` (before/after captures, measurements, contrast calculations, the closing matrix under `evidence/matrix/`).

## Completed items

| ID | Finding | Batch / Pass | Result |
|---|---|---|---|
| B-01 | `snapshot.ts` cast | V0 / Pass 56 | Typed projection; the cloud module itself was later removed on the owner's instruction (Pass 58) |
| FA-01…FA-07 | Carry-forward defects from the project audit | V0 / Pass 56 | Fixed with tests (`v0-carry-forwards.spec.ts`) |
| V-01 | Dense 11–12px text | V1 / Pass 57 (+ V2–V4, gap closure) | 14px supporting text, 12–13px only on named metadata; measured on 14 screens (`v1-foundations.spec.ts`) |
| V-02 | Overdue contrast 3.45:1 | V1 / Pass 57 | Semantic tokens ≥ 4.5:1 in light and both dark blocks, computed from the CSS (`tokens.test.mjs`) |
| V-03 | Controls under 44px | V1 / Pass 57 | `--control-min: 44px` on every ordinary control; measured |
| V-04 | Routine backup prompt above headings | V1 / Pass 57 | Attention item on Settings with snooze; navigation test |
| V-05 | Emoji-only / unlabeled controls | V1 / Pass 57, gap closure / Pass 62 | One line-icon family; whole-app emoji scan (`gap-closure.spec.ts`) |
| V-06 | Travel mechanics before the action | V3 / Pass 60, fidelity / Pass 63 | Origin → destination → status → primary action; mockup order |
| V-07 | Data & devices mixed concerns | V3 / Pass 60 | Your data → Back up & restore → Sync → Storage & advanced; attendance analysis relocated to Term stats with a link |
| V-08 | Admin explanations compete with metrics | V4 / Pass 61 | Navy rail, single notice, tiled headline cards, separate v2 card |
| V-09 | Desktop overlap lanes | V2 / Pass 59 | Measured grouping below 100px with expansion + keyboard tests |
| V-10 | Equal-prominence actions | V2 / Pass 59, V4 / Pass 61 | One primary per card; destination-named links |
| Look and feel | Mockups' `design.css` language | Fidelity / Pass 63 | Cards, tiles, hero, tabs, tags, callouts, key/value rows, search box applied across the learner app |

## Verification

- Every batch ran `npm run validate` AND `VERCEL=1 npm run validate` (unit + browser suites on both hosting bases), CI on merge, and `./scripts/deploy.sh verify` on the live services. Final counts at V5: 162 unit and 146 browser tests.
- V5 (`tests/v5-matrix.spec.ts`): no horizontal overflow at 320/390/768/1024/1440px in light and dark across nine primary screens; reduced motion and 200% zoom at 390px; keyboard-only navigation with focus on the new page heading and focus return from dialogs; scroll reachability under the nav and FAB. The capture matrix is under `evidence/matrix/` (light/dark × five widths, plus session, travel and a 200% zoom sample).
- Functional preservation: the register in DEVELOPMENT_PLAN.md §1 was checked per batch; no control was removed. Two relocations (backup nudge, attendance analysis) carry navigation tests.
- Owner-driven follow-ups after V4 are recorded in GAP_AUDIT_2026-09-10.md and PLAN.md Passes 62–66.

## What stayed in place

Production source, the permanent tests (`tests/v0-carry-forwards`, `v1-foundations`, `v2-daily-use`, `v3-travel-settings`, `v4-pgce-admin`, `gap-closure`, `backup-only`, `nav-viewport`, `v5-matrix`, `tests/unit/tokens.test.mjs`), runbooks and PLAN.md. `evidence/visual-review.spec.ts` is the audit's own capture fixture, kept for reference only.

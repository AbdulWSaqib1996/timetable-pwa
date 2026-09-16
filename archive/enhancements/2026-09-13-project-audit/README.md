# Archived: project audit of 13 September 2026

Moved here from the repo root on 16 September 2026 once its last batch (D3) shipped, per the handoff's §7. Relative links inside the package are unchanged. The permanent records are the PLAN.md pass entries listed below; the permanent tests are under `tests/` (the audit's own probes stay in `evidence/`).

## Delivered

| Batch | IDs | Pass | Merge | Validation at release |
|---|---|---|---|---|
| A — correctness first | B01, B02, B03, B04 | Pass 77 | see PLAN.md Pass 77 | both gates green |
| B — recovery and control | B05, B06, B07, B08, B09, B10 | Pass 78 | see PLAN.md Pass 78 | both gates green |
| C — usability | U01, U02, U03, U04, U05 | Pass 79 | see PLAN.md Pass 79 | both gates green |
| D1 — connected teaching | E01, E04 (+ owner: student rep meetings) | Pass 83 | `ef7205e` (CI 35073228763) | 216 unit · 192 browser |
| D2 — academic and weekly flow | E02, E03 | Pass 84 | `ed77e15` (CI 35075615670) | 220 unit · 194 browser |
| D3 — data confidence | E05 | Pass 85 | `510a1bd` (CI 35077300646) | 226 unit · 196 browser |

Owner requests that arrived during the batches were shipped as Passes 80, 81 and 82 (key dates completed rather than attended; lesson homework; sync as a header control; placements openable after setup; deadline rows; per-session places; single analytics dataset) and are recorded in PLAN.md.

## Deferred or narrowed (recorded, not shipped)

- Display labels stay SE1/SE2/SE3 on screen (owner decision; the audit's P1/P2/P3 was not adopted).
- E01: threads and transitions are not yet listed in the Find index or the print binder (reachable from the PGCE file and All placements).
- E02: moves are offered only when a session or commitment overlaps an existing block; "logged" time is the blocks ticked done.
- E05: the app still cannot see whether a downloaded backup file was kept; every backup line says so. Cloud providers remain out (Pass 58 decision).
- Regression matrix items that need a physical device (real iOS Safari/PWA keyboard, installed lifecycle) were not certified by these passes.

The active backlog for follow-on work is [`placement-homework-audit-2026-09-15/DEVELOPMENT_PLAN.md`](../../../placement-homework-audit-2026-09-15/DEVELOPMENT_PLAN.md) at the repo root.

## Contents

- `CLAUDE_HANDOFF_AUDIT_2026-09-13.md` — the audit and handoff.
- `DEVELOPMENT_PLAN.md` — the phased plan with per-batch status notes and deviations.
- `visuals/` — before screenshots, three editable after concepts, PNG exports and the gallery.
- `evidence/` — the audit's probes and logs (not release gates).

# Placement and session-homework review — 15 September 2026 (delivered)

The owner's review [PLACEMENT_HOMEWORK_REVIEW_2026-09-15.md](PLACEMENT_HOMEWORK_REVIEW_2026-09-15.md) (baseline `3429667`) with its `evidence/` and `visuals/`, and the phased plan [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) that delivered it as four release passes. Moved here from the repo root per the review's §9 once the last accepted batch shipped (16 September 2026). Relative links inside the package are unchanged.

## Delivered

| Batch | IDs | Pass | Merge | CI run |
|---|---|---|---|---|
| 1 — placement correctness | PL-01, PL-02, PL-03, PL-04, PL-05, UX-02 | 86 | `c515da9` | 35080417115 |
| 2 — homework lifecycle | HW-01, HW-02, HW-03, HW-04, HW-05 | 87 | `6b8185f` | 35083652287 |
| 3 — visual and navigation | PL-06, UX-01, concepts A–F | 88 (+ addendum) | `df943f5`, `ab334af` | 35086178126, 35100393601 |
| 4 — connected learner workflows | NF-02, NF-03, NF-04, NF-05 remainder, NF-01 remainder | 89 | `9d4d1be` | 35120020857 |

Each pass has a full record in `PLAN.md` (what changed, the automated checks, the release evidence). Every pass ran both validation gates (`npm run validate` and `VERCEL=1 npm run validate`), deployed the Cloudflare workers first whenever `shared/` changed (Passes 86, 87, 89), and passed `deploy.sh verify` on the live site. NF-01's checklist and transition were largely delivered earlier as Pass 83 (E04 of the 13 September audit); Batch 4 added "not known yet" deferrals with a follow-up date and the resources item.

## Deferred (recorded, not built)

- **Placement-scoped record creation** — preselecting the placement on new reflections, targets, meetings and observations opened from a placement page. Deferred from Batch 3; the workspace still lists each placement's records by date range.
- **Resource sharing to mentors** — resources on homework and placements are learner-only until the existing sharing controls (review packs) cover them.
- **Preparation reminders** — the session preparation list is not notified; opt-in reminders stay in the backlog.
- **Provider, LMS or school integrations** — out of scope by the plan.

Owner notes: the review, its evidence and visuals were never committed (they are the owner's working files); only `DEVELOPMENT_PLAN.md` and this README are tracked. They were moved on disk with the package.

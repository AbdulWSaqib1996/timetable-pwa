# Admin analytics development plan (A1–A5 → Passes 45–49)

**Prepared:** 7 September 2026, against HEAD `9f9a654` (Phase 7 complete). **Governs:** how the phases in
[ADMIN_ANALYTICS_ENHANCEMENTS.md](ADMIN_ANALYTICS_ENHANCEMENTS.md) get implemented in this repository.
The specification stays the source of truth for behaviour; this plan sequences it, binds it to the
repo's release conventions, and records the decisions the spec left open. Decisions marked **Decided**
are defaults chosen for this plan — say so before the relevant phase to change one.

## 0. Baseline drift since the audit

The audit reviewed `4b22653` (Phase 5). Since then Phases 6–7 and the icon families landed. Verified
against current source before writing this plan:

- **All P0/P1 findings still present.** `/stats` fail-open when `statskey` is absent
  (`workers/push/worker.js:1268`), query-string credential, cached-stats-before-auth in
  `public/analytics.html`, and the `analytics.ts` snapshot→await→reset race are all unchanged.
- **New surfaces the catalogue must cover** (spec §7.4 said "reconcile with latest APIs"): Phase 6
  journey UI (`useJourney`, SessionDetail travel tab, JourneyHomePage), Phase 6 group proposals,
  Phase 7 course config and route maps. The A4 event catalogue below is updated accordingly.
- **Icons already done:** `public/analytics.html` and `analytics.webmanifest` now use the dedicated
  `public/admin/` icon family (Pass 44 release). A3 keeps this identity; no icon work in scope.
- **DO precedent exists:** `wrangler.toml` already carries `new_sqlite_classes` migrations
  (SyncStore, GroupStore). The A2 analytics coordinator follows the same pattern with a new
  `analytics-v1` migration tag and its own binding — never touching the existing ones.
- The push worker's `/ping` FEATURES whitelist and `trackUse` call sites in `App.tsx` are the
  legacy collection path A2 supersedes and A1 must keep readable.

## 1. Conventions binding every phase

Same discipline as the timetable phases (AGENTS.md + main handoff §9.3):

- One branch per phase (`admin-a1` … `admin-a5`), small commits per work item, merged to `main`.
- Gate: `npm run validate` AND `VERCEL=1 npm run validate` green; rebuild default layout after.
- PLAN.md §9.4 completion record per phase (Pass 45–49), including the spec's acceptance list for
  that phase, findings addressed by ID, and screenshots at 390px/1440px in both themes from
  synthetic fixtures.
- **Worker-first deployment** whenever `workers/` or `shared/` change; push over port-443 SSH;
  watch CI for the exact commit; `./scripts/deploy.sh verify`; record verbatim output + versions.
- Unit tests in `tests/unit/*.test.mjs` (fake KV / DO harness per `group-store.test.mjs`);
  browser tests in a new `tests/admin-*.spec.ts` with ALL worker requests mocked. Every reproduced
  audit defect gets a regression test that fails on the old behaviour first.
- Prohibitions carried from spec §11: no production data inspection, no real stats key in any test,
  no messaging users, no VAPID/namespace changes, no learner service-worker registration changes,
  KV cleanup only under reserved synthetic prefixes. Deployment happens per phase as part of that
  phase's release, matching how B/P phases shipped (this plan is the "subsequent phase
  instruction" §11 asks for, once the owner says to run a phase).

## 2. Phase plan

### A1 — Secure access + honest output (Pass 45) — worker + legacy page repair

Smallest phase; highest priority. No new UI framework — repair `public/analytics.html` in place.

**Worker (`workers/push/worker.js`):**
- ADM-01: `/stats` fails closed — absent/empty `statskey` → 503 `configuration unavailable`
  before any KV scan; wrong/missing credential → 401 before any scan.
- ADM-03: accept `Authorization: Bearer` (constant-time compare, reuse `constantEquals` pattern);
  add `Cache-Control: no-store` to every `/stats` response including errors; extend CORS preflight
  for the Authorization header on `/stats` only. **Decided:** keep `?key=` accepted for a
  14-day compatibility window (dated in the code comment + PLAN entry), then remove in A2's
  worker deploy; logs never include either form.
- ADM-09/10/11/12 aggregation: compute `activeLast7Days`/`activeLast30Days` independently of
  `days`; count only successfully-read schema-valid rows (missing reads → completeness metadata);
  `listAllKeys` cap → typed incomplete flag surfaced in the response, never silent partial totals;
  positive-only feature adoption; unknown setup ≠ false.
- ADM-16 (bounded part only): cap `/ping` body size via `boundedJSON` (exists), strict finite
  integer clamps. Full schema v2 waits for A2.

**Legacy page (`public/analytics.html`):**
- ADM-02: delete `tt.statskey`/`tt.statscache` on load (one-time migration), in-memory key +
  snapshot only, Lock button clears both and aborts in-flight fetches (AbortController +
  request-generation guard), 401 → locked state. No auto-render from cache before auth.
- ADM-04: fixed-height chart plot with explicit axes and text values (no %-height-in-indefinite
  parent), rendering nonzero/zero/constant series correctly.
- ADM-14/20 copy: "Tried it once" → "Observed on 1 day (this window)"; "Installs" → "Standalone
  reports"; truthful key copy ("sent to the worker on each request"); UTC period labels, partial-
  today badge, legacy received-counter caveat, first-seen-ledger retention statement.

**Tests:** unit — worker auth matrix (absent/empty/wrong/valid × query/header), no-scan-before-auth
(spy KV), window independence at days=1/7/30/31/62, null-row and cap fixtures, positive-only
adoption. Browser — `tests/admin-a1.spec.ts` against the static page with mocked worker: locked
state, unlock, lock-clears-everything, late-response-after-lock discarded, chart bars visibly
nonzero, no secret in any request URL after migration window copy.

**Deploy:** worker first, then page. Rollback keeps fail-closed + no-store unconditionally.

### A2 — Trustworthy collection + `/stats/v2` (Pass 46) — the deep phase

Largest phase; touches client, shared contracts and worker. Split into four commits:

1. **`shared/analytics-contracts.js`** (+`.d.ts`): versioned batch envelope validation (spec §7.1
   bounds: ≤16 KiB, ≤7 dated segments, counts 0–999, ≤32 event names/capability, date-skew rules),
   the action catalogue (§7.4 + Phase 6/7 additions below), and the `/stats/v2` response
   validators (§6 envelope — `Count`/`Ratio`/completeness/watermark). Runtime-neutral, unit-tested
   like `contracts.js`.
2. **Client queue (`src/lib/telemetry/`):** consent-gated collector (reads active-profile
   demo/opt-out on every call — fixes ADM-07), IndexedDB queue with UTC observed-date buckets
   (fixes ADM-08), immutable claimed batches with random IDs and transactional ack-by-ID (fixes
   ADM-05), tab lease with expiry (fixes ADM-06 client side), consent-generation guard, 7-day
   retention, bounded backoff, flush on open/resume/15-min-foreground/reconnect. **Decided:**
   a new small dedicated IDB database (`timetable.telemetry.v1`), NOT the record store; in-memory
   fallback when IDB is unavailable. Legacy undated pending counters are **discarded** at
   migration (spec-recommended), token identity preserved, v2 measurement-start date recorded.
3. **Analytics coordinator DO (`workers/push/analytics-store.js`):** new class + `analytics-v1`
   migration tag; transactional `(token, batchId)` dedupe (8-day + skew horizon), per-day bounded
   aggregates and distinct-token membership, ack only after durable commit, duplicates return the
   same ack without re-counting (fixes ADM-06 server side). Snapshot publication to an
   `astats:` KV prefix every 15 minutes (cron exists: `*/10` — **Decided:** reuse the existing
   scheduled handler, publishing on a 10-minute cadence to avoid a second cron trigger; stale
   threshold 30 min per spec). Failed publish keeps last snapshot + stale flag.
4. **`/stats/v2` endpoint:** Bearer-only, section allowlist (`overview|adoption|returning`
   initially), reads the published snapshot (fixes ADM-17), full envelope with
   `generatedAt`/`observedThrough`/completeness/source, documented 400/401/429/503 semantics.
   Remove `?key=` from `/stats` (end of A1's window) in the same worker deploy.

**Catalogue additions for current app** (attempt/success semantics per spec):
`view_today`, `view_schedule`, `view_tasks`, `view_pgce`, `session_detail_opened`,
`schedule_search_used`, `journey_session_opened`, `journey_home_opened`, `journey_planned`
(TfL plan rendered — Phase 6), `navigation_link_opened`, `task_created`, `task_completed`,
`pgce_record_saved`, `evidence_photo_saved`, `export_prepared`, `sync_outcome`,
`course_template_applied` (Phase 7, no template content). Wiring happens in A4; A2 only ships the
contract + transport so names are stable.

**Tests:** the spec §10 Queue + Ingestion + Aggregation rows verbatim — event-during-send survives,
replay idempotent, two-tab lease (including holder dying pre-ack), offline date preservation,
opt-out clears + generation-guards, oversized/invalid rejected pre-write, DO kill/restart keeps
acks idempotent (harness), legacy+v2 same-token union dedupe, failed publish keeps prior snapshot.

**Deploy:** worker (DO migration!) first, verify, then app. Rollback: v2 collection behind a config
flag; durable data retained; never restore unconditional counter reset.

### A3 — Responsive admin shell (Pass 47) — the visible rebuild

- **Vite MPA entry:** move the dashboard to `analytics.html` (root input) + `src/admin-analytics/`
  per spec §8 module layout; verify output lands at `/analytics.html` (Vercel) and
  `/timetable-pwa/analytics.html` (Pages) under BOTH base configs — this is the riskiest build
  change; do it first and gate on both `validate` runs plus manual dist inspection.
  `analytics.webmanifest` and admin icons stay as-is.
- Shell per spec §4.1/§5: six destinations (rail ≥1101px, section picker ≤767px), System/Light/
  Dark themes on the spec's token table (extracted to `src/styles/tokens.css` only if the diff
  against learner `index.css` tokens is clean — otherwise scoped admin tokens; visual-regression
  check on the learner app either way), in-memory session (`lib/session.ts`) with 15-min idle
  lock, labelled key field with reveal control, React text nodes only (no HTML strings).
- **Overview + Feature adoption** fully implemented against validated `/stats/v2`; the other four
  destinations ship as explicit "Not collected yet"/coming states — never sample data.
- Global period selector (62-day max), accessible chart+table pair (single keyboard navigator, not
  62 tab stops), CSV export per §4.7 (formula-prefix neutralisation, definitions included,
  disabled while locked), full state machine (loading/ready/empty/stale/error/401/429/503-config).
- **Tests:** browser spec at 320/390/768/1440px — no page-wide overflow, lock clears private
  state, Back/Forward restores section+filters, direct link shows locked state first, both dist
  layouts, keyboard chart navigation, dark/light/system. Learner suite must stay green untouched.

### A4 — Instrumentation + return analysis (Pass 48)

- Wire the A2 catalogue into the live app at the SUCCESS points (route effects for views —
  dedupe rerenders; task/record/photo persistence callbacks; journey UI opens; export-prepared
  after artifact generation). Every call goes through the consent gate; no gated call sites left
  (removes the old `trackUse` FEATURES path; `/ping` stays readable as legacy).
- Feature adoption page: capability-aware eligible denominators, eligible-coverage line,
  collection-start dates, attempt-vs-success labels ("Photo add attempt" vs `evidence_photo_saved`),
  unknown/zero/not-collected distinguished, sortable + announced, grouped by
  Schedule/Travel/Tasks/PGCE.
- Return visits page: Return frequency (1 / 2–4 / 5+ observed days, denominators, honest names)
  first; then weekly cohorts — UTC-Monday boundaries, exact-week returns, dash + "Not complete"
  for open weeks, "Small cohort" under 10, incomplete-collection cohorts labelled incomplete.
  No backfill from private records, ever.
- **Tests:** per-event tests beside the real actions (a saved task fires exactly one
  `task_created`; a failed save fires none; opted-out fires none); serialized-fixture privacy
  sweep (no titles/coords/IDs in any outgoing payload); cohort fixtures for week boundaries,
  partial weeks, small cohorts; missing instrumentation renders "Not collected", not 0%.

### A5 — Reliability, releases, retention + ops (Pass 49)

- Reliability page from worker-side acceptance/rejection reason counters + snapshot freshness
  (thresholds per spec §4.5: stale >30 min, alert >2% rejected over ≥100 attempts/24h, shown with
  their configured values; no notifications). Unobserved-offline caveat displayed.
- Releases page on immutable build ID + capability version (introduced in A2 envelopes):
  latest-observed-build attribution, Unknown category, comparisons only for complete equal
  periods with ≥20 eligible tokens, else "Comparison unavailable".
- Data & access page completed: glossary (spec §6 dictionary verbatim), retention statement,
  collection-start dates, export UX. **Retention decision — needs explicit owner sign-off before
  this phase:** adopt the proposed 180-day last-seen expiry for the first-seen ledger
  (prospective, renamed metrics, dated historical total retained separately). This is the one
  destructive-adjacent change in the whole plan; it ships only after a yes, as its own scoped,
  reviewable expiry job over analytics-owned prefixes.
- Ops: measure DO/KV usage against the account's actual limits, tune cadence/caps, installed-PWA
  checks at both bases (offline shows locked shell; no API/auth responses in any SW cache),
  update DEPLOYMENT.md/AGENTS.md admin sections in the same commit.

## 3. Sequencing, sizing and risk

| Phase | Pass | Size (relative) | Highest risk | Mitigation |
|---|---|---|---|---|
| A1 | 45 | S — 1 branch, ~2 worker + 1 page commits | Locking out the live dashboard | 14-day dual-auth window; deploy worker, verify `/stats` with header manually, then page |
| A2 | 46 | XL — 4 commits | DO migration + data-loss regressions | DO harness tests incl. crash/replay; collection behind flag; legacy `/ping` untouched |
| A3 | 47 | L — 3 commits | Vite MPA breaking either hosting base | Build change first + both-layout gates before any UI work |
| A4 | 48 | M — 2 commits | Privacy leaks via instrumentation | Fixture serialization sweep test; catalogue-only names |
| A5 | 49 | M — 3 commits | Retention semantics | Ships only after explicit owner yes; scoped expiry job |

Order is strict (each phase's "Depends on" per spec §9). A1 is deliberately shippable alone —
the spec's own rule: no polished charts on top of uncorrected data. A3 can start on v2 fixtures
while A2 finishes if parallelism is ever wanted, but the default is sequential passes like B0–P7.

## 4. Decisions recorded (change any before its phase)

1. **Auth window:** 14 days of dual query+header auth on `/stats`, removed in A2's deploy.
2. **Telemetry store:** new dedicated IDB DB; legacy undated queue discarded at migration.
3. **Snapshot cadence:** reuse the existing 10-minute cron (no second trigger); 30-min stale
   threshold.
4. **Tokens file:** extract shared `tokens.css` only if the learner diff is clean; else scoped
   admin tokens matching the spec table.
5. **Catalogue:** spec §7.4 plus `journey_planned` and `course_template_applied` for Phase 6/7.
6. **First-seen 180-day expiry:** deferred to A5 and gated on an explicit owner yes (§2, A5).
7. **Numbering:** admin phases record as PLAN.md Passes 45–49; A-numbers cross-referenced.

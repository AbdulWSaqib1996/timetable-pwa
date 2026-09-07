# Admin analytics: audit, redesign and implementation handoff

**Prepared:** 7 September 2026. **Status:** specification and synthetic design assets only; not implemented. **Developer:** Claude or another agent working in the shared timetable repository. **Scope:** the owner analytics application at `public/analytics.html`, its manifest, client collection and `/ping` / `/stats` worker contracts. This is separate from the learner-facing PGCE/AdminSheet feature.

## 1. Start here

Read this document before changing code. Open [the visual comparison gallery](admin-analytics-designs.html), then [the interactive prototype](mockup.html). The gallery contains actual screenshots of the current analytics page with intercepted synthetic responses, side-by-side desktop and mobile comparisons, dark-theme designs, and five proposed feature screens. The source of truth for implementation behaviour is this specification; the prototype is a styling and interaction reference, not production code.

The audit used local source, an in-memory KV fixture and a browser with intercepted network requests. No production statistics, credentials, subscriptions or personal records were inspected. No application code was changed by this handoff. The dashboard is currently dark-only and independent of the updated timetable shell. Its main usability problem is that it presents many figures without enough context about what they measure. Some figures can also be wrong because of collection and aggregation defects.

**Recommended sequence:** repair access and misleading output; make collection trustworthy; ship the matching responsive shell; add adoption and cohort analysis; add reliability, release coverage and operational hardening. Do not launch polished new charts on top of uncorrected data.

### Reviewed baseline and concurrent development

Evidence was captured against HEAD `4b22653af51f367d89806e6de06e7c92c48e1b8d`. Claude was progressing the main timetable phases during this review. [The audit manifest](evidence/audit-results.json) records SHA-256 hashes of the files actually inspected. Line numbers below refer to this reviewed source and may move. Re-read current source and `AGENTS.md` before implementing; preserve newer timetable changes. Do not apply a whole-file copy of an older App.tsx or worker.

Also read the repository's `TIMETABLE_PWA_REMAINING_PHASES_IMPLEMENTATION.md`, especially its design tokens, navigation, recovery and deployment guidance. The admin phases below are named **A1–A5** and do not renumber or restart the main timetable phases.

### Deliverables

| File | Purpose |
|---|---|
| `ADMIN_ANALYTICS_ENHANCEMENTS.md` | This implementation specification |
| `admin-analytics-designs.html` | Before/after gallery and new-feature navigation; open locally |
| `mockup.html` | Responsive interactive design; accepts `?page=adoption` or `?theme=dark` |
| `assets/before-desktop.png`, `assets/before-mobile.png` | Current UI, rendered from reviewed source with synthetic stats |
| `assets/after-desktop.png`, `assets/after-mobile.png` | Proposed overview at the same viewport sizes |
| `assets/after-desktop-dark.png`, `assets/after-mobile-dark.png` | Matching dark theme |
| `assets/after-adoption.png`, `after-returning.png`, `after-reliability.png`, `after-releases.png`, `after-access.png` | New/expanded feature designs |
| `assets/state-*.png` | Empty, stale, error and rate-limit design examples |
| `evidence/audit-results.json` | Reproductions, source hashes, reviewed commit |
| `evidence/design-checks.json` | Browser layout and interaction checks |
| `evidence/synthetic-stats.json` | Illustrative input used for legacy screenshots; not a production dataset |
| `evidence/analytics-before.html.txt` | Inert source reference; `.txt` prevents accidental execution against the live URL |

The prototype period selector has one illustrative option; export, refresh and reason-detail buttons explain intended behaviour instead of contacting a service. The lock form simulates unlocking with any value. These limitations must not be copied into production. Navigation, theme, chart-value selection, table navigation and state selection are interactive. There are no external fonts, analytics SDKs or runtime CDN dependencies in the design assets.

## 2. Existing architecture and strengths to preserve

The page is a static standalone HTML application. It reads `tt.statskey` and a ten-minute `tt.statscache` from localStorage, calls the push worker's `/stats?days=31&key=…`, and renders HTML strings. The worker stores an `aping:UTC-date:token` row for 90 days and an `adev:token` first-seen date without an expiry. The client creates a random browser token, accumulates counters in `timetable.usage.v1`, and sends at most one successful ping per UTC day through `src/lib/analytics.ts`.

Preserve the useful foundations: self-hosted aggregate reporting, no timetable content in telemetry, coarse feature names, bounded ordinary counters, optional usage reporting, support for installed PWAs resuming, and no dependency on a third-party analytics vendor. Preserve separate analytics access from the learner app. Do not introduce a student-level analytics browser, raw event feed containing student work, or remote editing of private records.

The existing worker already paginates KV lists using `listAllKeys`; do not re-report the old first-page-only defect as unfixed. A separate remaining issue is that its safety cap silently returns a partial list.

## 3. Audit findings and fix requirements

Priority meanings: **P0** access must fail safely before a release; **P1** security/privacy or materially misleading/lost data; **P2** usability, maintainability or conditional correctness. “Reproduced” means demonstrated locally with synthetic fixtures. “Source-confirmed” means a direct code path was inspected. “Risk” means a failure condition remains conditional; it is not a claim that production currently exhibits it.

| ID | Priority / evidence | Finding and impact | Required correction |
|---|---|---|---|
| ADM-01 | P0 · reproduced | `workers/push/worker.js:1263`: if KV has no `statskey`, `/stats` returns 200. The fixture confirmed this; production key presence was deliberately not checked. | Fail closed with a generic configuration-unavailable response when the key is absent or empty. Never scan analytics rows before authentication. Test missing, empty, wrong and valid credentials. |
| ADM-02 | P1 · reproduced | `public/analytics.html:64–91`: fresh cached stats render before any authorization request. Removing the stored key still produced 19 tiles and zero stats requests. No lock/logout exists. This is a local cached-data access defect, not a bypass of an otherwise configured worker key. | Remove legacy persistent credentials/cache during migration. Use in-memory credentials and snapshot. Lock clears both and aborts pending requests. Never restore private content while locked. |
| ADM-03 | P1 · source-confirmed | Credential is in the stats request query string and persistent localStorage; unlock copy says it “stays in this browser only”. URL logging can capture it; it is necessarily sent to the worker. JSON responses have no explicit `Cache-Control: no-store`. | Use `Authorization: Bearer …`, HTTPS, truthful copy and no-store on every stats response, including errors. Update CORS preflight for Authorization. Never log the header/key. See migration below. |
| ADM-04 | P1 · reproduced | `.bar` has no definite height while its children use percentage heights. Browser measurement found a 120px chart with 1px bars and zero-height segments despite nonzero data. | Use an explicit plot coordinate system or a definite-height container. Include axes, date labels and accessible values. Test nonzero, zero and constant series. |
| ADM-05 | P1 · reproduced | `analytics.ts:52–71` snapshots counters, awaits fetch, then deletes the entire usage store. A photo event recorded during that wait disappeared after successful send. | Transactional immutable batches with acknowledgement by batch ID; remove only the acknowledged batch. Never clear counters created after the send began. |
| ADM-06 | P1 · source-confirmed; worker overwrite reproduced | No single-flight/multi-tab claim protects daily ping. The worker unconditionally replaces the device/day row. Sending counts 5 then 1 leaves 1. Concurrent sends and retries can lose data. | Idempotent ingestion and atomic queue claims. Merge immutable accepted batches once, not last-write-wins rows. A module promise alone is insufficient for multiple tabs. |
| ADM-07 | P1 · source-confirmed | `App.tsx:313` suppresses sending for opt-out/demo, but `trackUse` effects and component calls remain ungated. The shared local counter store can later send events accumulated while opted out. Settings toggling does not clear the queue. | Gate every collection call and send. Clear pending telemetry on opt-out/demo transition, cancel retries, and use a collection generation guard around in-flight completion. Test profile changes. |
| ADM-08 | P1 · source-confirmed | Counters have no event date. Uses after the first daily ping travel with a later ping and are assigned the receipt date. Offline counters can span days. Opens count foreground resumes, not necessarily sessions. Daypart buckets use local device clocks while server dates are UTC. | Versioned event-day buckets; distinguish observed date from received timestamp. Name legacy usage as received counters. Never silently reclassify old data as event-day usage. |
| ADM-09 | P1 · reproduced | `/stats?days=1` also truncates the figures named `activeLast7Days` and `activeLast30Days`. Fixture returned 0 versus 1 with `days=31`. Current UI always requests 31; adding a range selector would expose this latent API defect. | Compute fixed windows independently or replace with explicitly named requested-period metrics. Tests must include 1, 7, 30, 31 and 62 days. |
| ADM-10 | P1 · reproduced | `daily.active` uses listed key count even if a subsequent KV read returns null. A disappearing row produced one active “other” token. | Count only successfully read, schema-valid observations. Treat missing/invalid reads as completeness metadata, not fabricated activity. |
| ADM-11 | P1 · reproduced | `listAllKeys(..., maxPages=50)` returns accumulated rows when page 50 is still incomplete. Fixture returned 50 rows without an error or completeness flag. Real relevance depends on data volume. | Add an analytics-specific complete scan result or throw a typed incomplete-scan error. Do not change shared push/sync semantics incidentally. Never publish partial numbers as complete totals. |
| ADM-12 | P2 · reproduced | Negative `u.photo` is clamped to zero but retained; stats counts that token as a feature adopter. Empty setup object becomes six false fields and contributes to the setup denominator. | Omit zero/nonpositive feature entries after validation. Distinguish unknown setup fields from false. Denominator must be flag-specific known observations. |
| ADM-13 | P1 · source-confirmed | The feature whitelist and several call sites reflect old sheets. Today/Schedule/Tasks/PGCE journeys, route-home actions and successful new record saves are not fully covered. Photo/export names overstate success: events fire before completion. | Shared versioned action catalogue, route-based view events and successful persistence events. Display unavailable coverage rather than 0. Preserve legacy attempt semantics. |
| ADM-14 | P2 · source-confirmed | “Tried it once” means observed on one day in this window, not lifetime trial or cohort retention. “Installs” are standalone-mode reports. Browser tokens are not people. `WHATSNEW_VERSION` is a release-note marker, not an immutable build identity. | Apply the metric dictionary below throughout headings, glossary, CSV and tooltips. Add actual build metadata for release analysis. |
| ADM-15 | P2 · source-confirmed | Initial localStorage read/save is outside error handling; there is no request timeout, response-schema validation, request cancellation or generation guard. Old responses can replace newer intent. Errors have no direct retry button and most empty sections disappear. | Explicit state machine and typed response validation. Safe storage access, AbortController, bounded timeout, visible retry and stale state. Superseded responses must not render. |
| ADM-16 | P2 · source-confirmed | `/ping` parses an unbounded JSON body. Version is only `Number(v) || 0`; schema shapes are loosely validated. Public self-reported IDs and per-isolate IP limits cannot guarantee genuine clients. A shared campus NAT may also hit the 6/minute cap. | Bounded parsing, strict finite integers/enums/array sizes, request schema version and compatible caps. Label self-reported data. Use abuse monitoring, not a secret embedded in public JavaScript. |
| ADM-17 | P2 · source-confirmed | Stats scans all first-seen keys, then daily keys, and awaits row reads serially. Every forced refresh repeats the work. Cost and latency grow with history, and daily rows can expire during a scan. | Measured budgets, bounded concurrency and published aggregate snapshots with explicit completeness/watermarks. Never solve it by dropping pages. |
| ADM-18 | P2 · observed UI | Dark-only, full-width long page, six initial tiles, small labels, hover-only chart values, no labelled key field, bottom-only refresh, weak empty/error states and no comparison controls. | Responsive shell and accessibility contract below. Baseline at 390px did **not** overflow horizontally; do not claim that bug. The issue is hierarchy and interaction. |
| ADM-19 | P2 · source-confirmed / lifecycle risk | Stats cache is unrelated to key, origin configuration, query or midnight. The manifest shares main app icons; analytics has no dedicated service-worker registration. Main Workbox precaches HTML. Installed/offline routing needs explicit verification. | Preserve the analytics URL and compatible manifest scope, test both deployment bases, keep secrets/API data out of SW caches, design an analytics identity without disturbing the timetable worker lifecycle. |
| ADM-20 | P2 · source-confirmed | UI mentions 90-day ping expiry but omits the permanent first-seen token ledger. “No personal data” descriptions overstate what persistent pseudonymous tokens establish. | Show accurate technical collection/retention descriptions. Adopt a bounded first-seen policy prospectively, with explicit change in semantics; no silent destructive migration. |

### Evidence interpretation

The current date and source hashes are captured in `evidence/audit-results.json`. Browser tests also verified no page-wide overflow at 390px in the legacy fixture. New designs were checked at 320, 390, 768 and 1440px for six sections with no page-wide overflow, and lock/unlock completed without browser script errors. This is design validation, not a production accessibility or security certification. Real Safari/installed-PWA behaviour remains a development acceptance requirement.

Do not infer an XSS exploit solely from the HTML-string renderer: many displayed labels are escaped and current server metrics are constrained. Replacing the renderer with normal React text nodes and response validation is still the correct hardening step. Do not claim push delivery, actual installs, unique users, causation or full offline failure visibility from the current data.

## 4. Product structure and screen specifications

### 4.1 Information architecture

Desktop navigation order: **Overview, Feature adoption, Return visits, Reliability, Releases, Data & access**. These are admin destinations, not replacements for learner Today/Schedule/Tasks/PGCE. Keep “My Timetable” branding and clearly identify “Admin workspace”. Use a labelled section picker on mobile rather than six cramped bottom tabs. The admin has more infrequent diagnostic destinations than the learner's four primary routes.

Keep the authenticated session local to this tab. Provide visible theme and Lock buttons on every unlocked screen. Navigation never reveals raw browser tokens. URL parameters may encode section and period, never keys or personal identifiers. Browser Back/Forward restores the admin section and filters; direct links first show the locked state.

### 4.2 Overview

Purpose: answer “How much observed activity is there, and can I interpret it?” Keep three primary metrics: active tokens in the selected period; active today, clearly partial; reported standalone today with numerator/denominator. The fixture shows 124 weekly active, 38 today and 24/38 standalone. These are the same legacy headline values as the before image, not fabricated growth.

Below: daily activity chart with new/returning segments, a contextual summary, top feature adoption and today’s setup coverage. Put 30-day activity and all-time legacy first-seen counts in secondary context. On initial legacy rollout use a fixed seven-day headline and a separately labelled 31-day chart, as shown. After range support ships, the primary period metric and chart follow the selector; today cards remain explicitly pinned to today. Do not leave unlabelled fixed-window cards under a global selector.

The status strip shows snapshot generation time, observed-through watermark, timezone, partial status and a direct Refresh control. “Generated now” does not prove that clients reported now. Never display a green “healthy” service status merely because one stats request succeeded. The green dot in the design denotes a loaded snapshot only.

Chart: meaningful y-axis from zero, 4–5 ticks, date labels at a density suitable for the width, new/returning legend, explicit partial-today mark. View data opens the same filtered values in an accessible table with export. Selecting a day by pointer/touch or keyboard shows date, active, new, returning and completeness. Use a single keyboard chart navigator or roving tabindex instead of 62 tab stops; the prototype’s per-bar buttons are only an interaction sketch. On narrow screens, preserve the chart and table alternative; never rely on hover tooltips.

### 4.3 Feature adoption

Each row includes human label, event definition, distinct tokens, eligible denominator, share, uses, coverage status and collection start date. Default sort: measured token count descending, followed by unmeasured planned features. Allow sort by name, share and uses; announce sorting to assistive technology. Search filters the local feature catalogue, never student content. Group optionally by Schedule, Travel, Tasks and PGCE without hiding zero or missing values.

Legacy row example: Session details, 92/124 active tokens, 74%, 384 received uses, eligibility unknown. New feature example: Tasks completed, Not collected, no percentage. New v2 row denominator is active tokens whose reported capability includes that event, not all active tokens. Show eligible coverage separately, e.g. 96/124 can report it; 48/96 used it. Do not invent that example as historical fact.

Photo legacy label must be “Photo add attempt”. Keep a distinct future `evidence_photo_saved` success event. Export attempt does not prove a file saved or a printer printed; use “Export prepared” after the app generated the artifact, not “Export completed”.

### 4.4 Return visits

First ship the existing data as **Return frequency**: observed on 1 day, 2–4 days or 5+ days in the stated window. Show a denominator and use “No observations” when it is zero. Do not call the one-day category “Tried it once”.

Then add weekly cohorts, Monday 00:00 UTC boundaries. Cohort membership is first observed week under the documented retained identity policy; week N return is at least one valid event-day observation in that exact subsequent calendar week. This is not rolling N-day retention or “returned at any later date”. Cells show percentage and numerator/denominator. Incomplete observation weeks display a dash and “Not complete”; small groups below 10 show “Small cohort” without a headline percentage. Label cohorts with incomplete original collection as incomplete, not zero. No invented backfill for events that were never recorded.

The mockup’s 10 August cohort of 40 with 22 returning in week 1 is illustrative new-feature data. It is separate from the legacy fixture. Keep a frequency panel beneath cohorts to explain the distinction.

### 4.5 Reliability

Separate sources: worker-observed telemetry acceptance, aggregation freshness/completeness, late client-reported coarse outcomes, and future background-reminder worker outcomes. Each card says its source and denominator. HTTP acceptance of a push by a service is not confirmed display or user receipt. Sync outcome reporting must contain only reason enums and counts, never encrypted blobs, codes, endpoints or document names.

Initial issue list includes stale aggregate, schema rejection increase, unknown build coverage and incomplete data. Drill-down is aggregate counts by reason and time period, never raw request samples. Threshold defaults: aggregate stale after 30 minutes for a 15-minute snapshot job; alert on >2% rejected attempts with at least 100 attempts over a completed 24 hours. These are initial tunable operational thresholds, not universal health claims. Show the configured threshold and suppress rate percentages below the denominator minimum. No automatic Slack/email notifications in this scope.

Do not turn unobserved offline failures into zero failures. A client that cannot report cannot contribute its failure telemetry until a later allowed send. Show that limitation near client-reported signals.

### 4.6 Releases

Add immutable build ID, human release label and analytics schema/capability version. Never use the “What’s new” integer as the sole build key. Each active token is attributed once to its latest observed build in the selected window; separately report build transitions if later needed. Unknown remains a visible category. Mixed-build day batches must retain their own build context before aggregation.

Show count, share, tracking coverage and first observed date. Compare only compatible metrics over equal complete periods and eligible populations. A new build without a complete period shows “Comparison unavailable”. Require at least 20 eligible tokens per comparison group for headline percentages/deltas, show sample sizes, and avoid statements that a release caused a change. No statistical significance badges in the initial version.

### 4.7 Data & access

Include metric glossary, current retention, data-quality limitations, collection start dates, export control, lock and session explanation. Credential input has a persistent label, clear error, Enter submission and an accessible reveal/hide control in production. No default “remember key”. The recommended MVP holds the key only in memory, requires re-unlock after reload and locks after 15 minutes of inactivity. Client inactivity locking is a local privacy safeguard, not server-side credential expiry or revocation.

On Lock: increment request generation, abort in-flight calls, clear key, stats, drill-down data, transient exports and any private state, then focus the owner-key field. On 401, do the same and announce expired/invalid access. On a 503 missing-server-key response, show configuration unavailable; never suggest the app is empty. Exclude private output from persisted history or session restoration.

Provide an aggregate CSV with explicit period, UTC boundary, generated time, observed-through time, schema version, metric definition, numerator, denominator, coverage and completeness. No tokens, headers, raw events or secrets. Escape CSV values correctly and neutralize spreadsheet formula prefixes in any configurable labels. Export exactly the current filters and disable export when locked or data is incomplete unless the file conspicuously identifies partial output.

## 5. Styling contract — match the timetable

Use the tokens already present in `src/index.css`; resolve against current main-branch tokens before extracting a shared file. Do not introduce a separate purple/teal dashboard brand or add gradients, heavy shadows and giant decorative charts. Match system fonts, restrained borders, card shapes and focus treatment. The prototype provides layout reference; these measurements and accessible semantics are normative.

| Token | Light | Dark |
|---|---|---|
| Background | `#f5f6fa` | `#111722` |
| Surface | `#ffffff` | `#1a2230` |
| Text | `#202940` | `#e9edf6` |
| Muted text | `#5b667b` | `#adb7cb` |
| Accent | `#3e51c7` | `#b1bcff` |
| Accent surface | `#eef0ff` | `#2a3557` |
| Text on accent | `#ffffff` | `#172041` |
| Border | `#dfe4ed` | `#354154` |
| Success | `#196c54` | `#99ddc6` |
| Danger | `#9f1d1d` | `#f3b8b8` |
| Danger surface | `#fdecea` | `#3a1f1f` |

Spacing scale: 4, 8, 12, 16, 20, 24px. Desktop main padding 28px vertically/32px horizontally; mobile 20px/16px. Cards 20px desktop, 16px mobile. Gaps 16px between cards and 20px between sections. Radius: controls 10px, badges 6px, cards 12px, enclosing comparison/design frames 14px. Borders 1px solid token. Avoid layout-shifting border changes on hover.

Typography: system stack `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`; body 15–16px/1.5, primary heading 30px desktop/26px mobile with 1.2 line-height, card heading 18px, metric 34px desktop/30px mobile, supporting text 13px, metadata 12px minimum. Use tabular numerals for numeric tables. Emphasis is weight 600–750, not all-uppercase body labels. Long labels wrap instead of truncating without an accessible full label.

Responsive rules:

- **≥1101px:** 224px fixed left rail; main content margin matches rail; main content maximum width 1536px. Three KPI columns. Chart/context ratio about 1.8:1, context minimum 270px. Two columns below.
- **768–1100px:** 192px rail, 24px main padding, chart/context stacks into one column, three KPI columns only while readable. Avoid fixed card heights.
- **≤767px:** rail becomes a compact top brand row and labelled full-width section selector; no fixed desktop rail. Main margin zero. KPI cards stack, with label/support left and value right. Remaining cards stack. Top actions remain visible in document flow. Account for safe-area insets in production.
- At 320px, 390px, 768px, 1024px and 1440px there must be no page-wide horizontal scrolling. Wide cohort/data tables may scroll inside a labelled region. Feature tables convert to readable labelled rows as shown; maintain actual accessible table semantics or an equivalent properly labelled list.

Theme choices: System, Light, Dark. Default to System, with an optional non-sensitive local preference. The prototype only toggles Light/Dark; add System for production. Reuse the timetable’s icon system rather than copying the prototype’s Unicode navigation symbols. Icons 18–20px and accompanied by labels. Minimum action target 44×44px; small chart marks require an accessible larger interaction alternative. A 3px accent focus ring with 3px offset must not be clipped. Respect reduced motion; no animated counting metrics. Use semantic landmarks, one H1, labelled selects, table captions and scoped headers. Toasts use a polite live region, errors appropriate alert semantics, and all modal/sheet interactions restore focus.

Check contrast in both themes: ordinary text 4.5:1, large text and essential non-text controls 3:1. Do not rely only on colour for chart series, warnings or cohort status. At 200% and 400% zoom, content must reflow and actions remain usable. The prototype’s chart and state controls are not a substitute for screen-reader testing.

## 6. Metric dictionary and API contract

### Metric semantics

| Metric | Definition / denominator | Missing or incomplete handling |
|---|---|---|
| Active tokens | Distinct random browser identities with a valid observation in the explicit event-date period; legacy uses receipt date | Unknown when snapshot incomplete; not zero |
| Active today | Same, current UTC date; always partial until day closes | Explicit partial badge |
| New tokens | First observed date under declared identity-retention policy falls in date/period | Unknown first-seen is separate; no inferred new count |
| Returning tokens | Active tokens with a known earlier first-seen date | Do not subtract unknown-first-seen into returning |
| Standalone share | Tokens reporting standalone mode / active tokens with known mode for that date | Show known-mode coverage; old boolean contract can use current known active rows |
| Feature adoption | Distinct eligible active tokens with positive valid event count / eligible active tokens | Unknown capabilities excluded and reported separately |
| Feature uses | Sum of deduplicated action counts by observed date and contract | Legacy received counters separately labelled |
| Setup adoption | Latest known true snapshot per token / tokens with a known value for that flag in scope | Unknown is not false; show coverage |
| Foreground observations | Mount/resume observations under documented debounce; not session duration | Never label as time spent or sessions |
| Return frequency | Distinct observed active days per token in period | Window must be stated |
| Cohort return | Tokens active in exact follow-on calendar week / complete first-seen cohort | Incomplete/small cohorts suppressed as specified |
| Release share | Latest observed build per active token / active tokens; unknown category retained | No double counting mixed-build tokens |
| Acceptance rate | Accepted worker request attempts / observed request attempts under a documented counting boundary | Say whether rejected pre-body/rate-limited attempts are included |

Fixed 7/30-day legacy cards include today and must say so. Period comparisons default to completed UTC days (e.g. 31 Aug–6 Sep versus 24–30 Aug) and never compare partial today to a completed day without an explicit equal-elapsed-time contract. No automatic “up/down” arrows until compatible periods and sufficient denominators exist. Percentages use one documented rounding rule; always expose counts. Do not sum rounded percentages to manufacture 100%.

### Proposed `/stats/v2` envelope

Introduce a versioned endpoint without breaking older clients during transition. Example shape, not sample production values:

```ts
type ObservationStatus = 'complete' | 'partial' | 'unavailable';
type Count = {
  value: number | null;
  status: ObservationStatus;
  definition: string;
};
type Ratio = Count & {
  numerator: number | null;
  denominator: number | null;
  eligibleCoverage: { eligible: number; active: number } | null;
};
type StatsV2 = {
  schemaVersion: 2;
  snapshotId: string;
  generatedAt: string;            // ISO UTC: aggregation ran
  observedThrough: string | null; // trustworthy collection watermark
  period: { from: string; to: string; timezone: 'UTC'; includesPartialToday: boolean };
  source: 'event-day-v2' | 'legacy-receipt-day' | 'mixed';
  completeness: {
    status: ObservationStatus;
    missingRows: number;
    invalidRows: number;
    scanComplete: boolean;
    reasons: string[];            // fixed safe reason codes
  };
  metrics: Record<string, Count | Ratio>;
  daily: Array<{ date: string; active: Count; new: Count; returning: Count }>;
  features: Array<{
    id: string; contractVersion: number; collectionStartedAt: string | null;
    measurement: 'available' | 'legacy' | 'not-collected';
    adoption: Ratio; uses: Count;
  }>;
};
```

Additional tabs can be endpoint sections or separate authenticated aggregate endpoints; do not force expensive reliability/cohort scans into every overview refresh. Prefer `section=overview|adoption|returning|reliability|releases` with a shared envelope and strict allowlist. Date range maximum 62 days initially. Reject invalid ISO dates, reversed ranges and future closed-period requests; return documented 400 errors rather than silently coercing an impossible request. Authentication failure returns 401; missing server configuration 503; rate limit 429 with `Retry-After`; incomplete aggregation 503 or a typed partial envelope that the UI visibly labels. No raw IDs are returned.

If the endpoint exposes a complete snapshot but the latest ingestion interval is still open, `scanComplete=true` and `includesPartialToday=true` can coexist. Data completeness and partial current time are different concepts. Response validation must enforce finite nonnegative integers for counts, finite 0–100 values for percentage ratios, numerator ≤ denominator, valid enum keys, date ordering and explicit nulls. Do not parse arbitrary backend strings as HTML.

## 7. Collection redesign and migration

### 7.1 Versioned, opt-out-safe client queue

Use the existing IndexedDB abstraction if suitable; otherwise add a small dedicated telemetry database. Do not put telemetry inside the encrypted user-record store or modify its sync contract. A local transaction records coarse counters by UTC observed date, build ID and capability version. Store no event text, route parameters, session identifiers, location or content. Each queue segment becomes an immutable batch with random batch ID when claimed for sending. New events go to a new pending segment. A successful response acknowledges exact IDs; delete those IDs only in a transaction.

A batch envelope contains `schemaVersion:2`, token, batch ID, observed UTC date, build ID, capability version, coarse platform, known standalone status, foreground count, allowed positive feature counts and known setup flags. Optional dayparts must use one explicitly documented timezone contract; initially omit them from v2 rather than pretend local-clock buckets are a UTC histogram. Keep six legacy buckets only in a clearly labelled legacy detail view.

Bound each payload to 16 KiB initially, at most seven dated segments per request, counts to finite integers 0–999 per allowed key, maximum 32 accepted event names per capability version, and offline queue retention to seven days. Reject impossible future dates; define permitted clock skew and a safe receive-date fallback flagged as uncertain. Expired queue items are discarded and contribute only a local coarse dropped-count diagnostic if collection remains enabled. No last-minute blocking send on page unload.

Collector API must take or read the **current active-profile consent context on every call**. Demo and explicit opt-out prohibit collection and transmission. On transition off, clear the entire telemetry queue for this browser, abort pending retries, increment a consent generation and prevent stale acknowledgements from marking the new generation as sent. An already transmitted request cannot be unsent; never claim otherwise. Re-enabling begins a fresh collection generation without resurrecting old counters. Opt-out in one active profile must not leak actions into a later opted-in profile. No profile ID is sent.

Flush on allowed app open/resume, after a coarse interval while foregrounded (initially 15 minutes when there is pending data), and on restored connectivity with bounded backoff/jitter. A background timer is not guaranteed on mobile; do not promise immediate delivery. Respect Retry-After and avoid tight loops on 401/4xx schema failures. Use a transactional lease with expiry for multi-tab sends; broadcast queue changes optionally. If IndexedDB is unavailable, use a bounded in-memory queue or disable telemetry; never interrupt timetable use. Test the lease holder closing before acknowledgement.

### 7.2 Atomic worker acceptance

Do not implement idempotence using a KV read-then-put check: eventual consistency does not make that atomic. Recommended implementation: a dedicated analytics Durable Object coordinator, isolated from existing SyncStore/GroupStore, accepts v2 batches and deduplicates `(token, batchId)` transactionally. For current small scale, a single coordinator can maintain bounded daily aggregates and distinct-token membership; measure throughput and document a later partitioning strategy before scaling. Avoid summing per-shard unique counts without a deduplication strategy.

Persist dedupe records at least as long as the maximum retry/queue acceptance horizon (initially eight days plus documented skew). Accepted batch acknowledgement is returned only after durable commit. A duplicate returns the same successful acknowledgement without incrementing counts. New batch on the same token/day adds counts exactly once and updates known latest setup/build context by observed order. Do not overwrite earlier counts. Bindings and migrations are new analytics-specific resources; never reuse/delete VAPID, subscription, sync or group keys.

Publish aggregate snapshots to a dedicated analytics namespace/storage prefix at a documented cadence (initially 15 minutes). Include source range, schema, completeness and watermark. The API reads the published aggregate after authentication, not the complete raw lifetime ledger on each refresh. Protect scheduled aggregation against overlapping runs and only replace the latest complete snapshot after a successful transaction/publish. Keep the last valid snapshot on a failed job and expose stale status. Measure actual provider limits and project budget before finalizing resource names/cadence; do not assume a historical free-tier quota.

### 7.3 Legacy compatibility

Deploy support for v2 before shipping the v2 collector. Keep `/ping` readable during a defined transition and label its data legacy. Use the existing token where possible so active-token union can deduplicate the same browser across legacy and v2. Keep counts by source contract; do not add received counters to event-day counts and call the result precise daily usage. Where the same token reports both contracts on the same day, v2 is authoritative for v2 action metrics; show legacy coverage separately. Document the cutoff and retain regression fixtures for old app builds.

Old undated pending counters cannot be faithfully assigned to previous days. On upgrade, either discard them with a documented migration or send them once as explicitly undated legacy counts. Recommended: discard the undated queue on the v2 migration, preserve token identity, and show the v2 measurement start date. Do not silently backdate it. Never backfill new Tasks/PGCE/travel events from private records.

For auth migration: worker first accepts Authorization and fails closed. A short compatibility window may also accept the old query credential on `/stats` only, with no-store and redacted logs. Updated admin immediately removes `tt.statskey`/`tt.statscache` and asks for a fresh unlock; do not copy credentials into a new persistent key. After verifying both host deployments and stale installed-admin behaviour, remove query authentication. On any rollback retain fail-closed behaviour and no-store; do not revive the insecure auth path as a convenience.

Retention: keep 90-day raw activity as the initial maximum, enforce queue/dedupe expiry, and propose a **180-day last-seen expiry for the first-seen ledger**. This changes “ever” semantics: after expiry/reappearance the identity is newly observed within retained history. Rename accordingly and do not claim lifetime uniques. Before implementation, document migration counts and affected analytics prefixes; expire only analytics-owned records under the agreed policy. Existing lifetime aggregate may be retained as a dated historical total if clearly labelled, never merged into new-policy exact uniques. All destructive cleanup must be scoped and separately reviewable under repository rules.

### 7.4 Shared event catalogue

Create one shared contract consumed by client, worker and admin labels. Event definitions include introduction capability, success/attempt meaning and eligibility rule. Initial additions:

| Event | Trigger | Exclusions |
|---|---|---|
| `view_today`, `view_schedule`, `view_tasks`, `view_pgce` | Actual route destination becomes visible; dedupe same-route rerenders | No query strings, record IDs or repeated render counts |
| `session_detail_opened` | Detail route displayed | No session title/date/location |
| `schedule_search_used` | First meaningful nonempty search in one open search interaction | No typed query or one event per keystroke |
| `journey_session_opened` | Outbound journey UI opened | No coordinates, place names or route |
| `journey_home_opened` | Homebound journey UI opened | No home address or session ID |
| `navigation_link_opened` | User activates external navigation link | No claim navigation completed/arrival occurred |
| `task_created`, `task_completed` | Successful local persistence of transition | No task text, deadlines or duplicate retry events |
| `pgce_record_saved` | Successful supported PGCE record save | Only a fixed coarse type enum if needed; never record text |
| `evidence_photo_saved` | Compression and local persistence both succeed | No image, caption, file name or student identity |
| `export_prepared` | Printable/downloadable artifact generated successfully | Not print completion or file-save confirmation |
| `sync_outcome` | Coarse success/failure after actual operation settles | No code, payload, endpoint or user ID |

Capabilities must reflect feature availability, not whether the user already configured/used it. Where eligibility genuinely requires configuration, declare that rule and show configuration coverage separately; do not inflate adoption by defining only users as eligible. Add event tests next to actual successful actions, not only a catalogue unit test. Reconcile with Claude's latest route and persistence APIs before wiring.

## 8. Implementation architecture

Recommended modules (adapt naming to current repository conventions):

```text
analytics.html                         # Vite HTML entry; preserves output analytics.html
src/admin-analytics/main.tsx
src/admin-analytics/AdminApp.tsx
src/admin-analytics/components/         # shell, cards, chart, metric table, state panels
src/admin-analytics/pages/              # six sections
src/admin-analytics/lib/client.ts       # authenticated fetch, timeout, schema checks
src/admin-analytics/lib/session.ts      # in-memory key/snapshot, lock lifecycle
src/admin-analytics/admin.css
src/styles/tokens.css                   # only if safely extracted from timetable styles
shared/analytics-contracts.js           # versioned wire validation + action catalogue
src/lib/telemetry/                      # consent gate, IDB queue, batch transport
workers/push/analytics/                 # coordinator, aggregation, authenticated stats
```

Use a Vite multi-page build instead of leaving a 200-line inline-script dashboard to grow indefinitely. Move the static public analytics entry deliberately so it does not collide with the root Vite input/output path. Preserve `/analytics.html` on Vercel and `/timetable-pwa/analytics.html` on GitHub Pages, and resolve assets/base paths using the existing build convention. Keep `analytics.webmanifest` with correct relative paths; no new router fallback should send the analytics URL to learner Today. Use query/hash sections initially to avoid hosting rewrites.

Reuse/extract design tokens with a visual regression check on the learner app. Do not import the entire learner global stylesheet if it brings unrelated navigation/layout rules into admin. Build small semantic components rather than inheriting learner-record dependencies. Do not bundle sync secrets, private timetable records or unnecessary learner feature code into the admin entry.

Use the existing fetch/config abstraction if it fits; never hard-code a test worker URL in shipped code. Resolve allowed production origins from repository deployment configuration. CORS is not authentication; an origin allowlist is supplementary. Keep Authorization allowed only where required without breaking public push endpoints. Separate analytics no-store headers from unrelated cacheable APIs.

## 9. Phased development plan

### A1 — Secure access and make the existing output honest

**Depends on:** current source review; no dependency on new charts or telemetry backend.

1. Fix ADM-01/02/03 with fail-closed worker auth, header support, no-store, in-memory admin key, explicit lock and safe legacy cache deletion. Add pending-request generation checks.
2. Fix ADM-04 chart geometry and replace “tried it once”, “installs” and inaccurate key copy. Surface UTC periods, partial today and legacy received-counter caveat.
3. Correct ADM-09/10/11/12 aggregation semantics: independent windows, valid-row counts, positive-only adoption and completeness on pagination limits. Keep unknown setup separate.
4. Add safe load/error/empty/retry handling and bounded parsing for ping without breaking legitimate legacy clients.

**Acceptance:** unauthorized/misconfigured stats never scan or render data; no secret in URLs/new persistent storage; a forced 401 after a loaded snapshot removes it; a response arriving after Lock cannot repopulate it; nonzero bars visibly render; short-range requests do not truncate named fixed windows; missing rows/capped scans are flagged; zero denominator shows unavailable. Compare actual before and repaired screenshots using the same fixture. Deploy worker before admin changes.

**Rollback:** retain auth and no-store fixes, revert only rendering changes if needed. Never restore fail-open behaviour.

### A2 — Reliable, consent-aware collection and aggregate contract

**Depends on:** A1 auth boundary; coordinate with main timetable feature work.

1. Implement shared v2 validation and explicit metric definitions.
2. Build consent-gated IndexedDB queue, immutable batches, lease, acknowledgement and retry rules. Fix lost in-flight events and cross-profile opt-out leakage.
3. Add atomic server deduplication, distinct-token accounting, event-date validation and source-contract separation. Configure isolated analytics resources/migrations.
4. Publish `/stats/v2` complete snapshots with watermark and source metadata. Introduce real build/capability IDs.
5. Perform the documented legacy queue/data migration and add measurement-start labels.

**Acceptance:** event during send survives; replay does not double count; two tabs cannot drop or multiply accepted usage; offline buckets preserve dates; opt-out clears pending collection and blocks future sends; invalid/oversized payloads fail before writes; legacy and v2 fixtures yield explicitly separate usage semantics. Kill/restart the local coordinator and verify committed acknowledgements remain idempotent. Resource usage measured against project constraints.

**Rollback:** disable v2 collection via a compatible release/config and retain durable data; old reader must not misinterpret v2 keys. Keep queue migration idempotent. Never roll back to unconditional counter reset.

### A3 — Matching responsive admin shell and core views

**Depends on:** A1; can develop with v2 fixtures while A2 completes, but release against a validated contract.

1. Add Vite admin entry, scoped shared tokens, six-destination navigation, system/light/dark theme, labelled auth and session lock.
2. Implement Overview and Feature adoption first; unimplemented destinations show explicit coming/not-collected states, never fake data.
3. Implement global period/filter state, accessible chart/table pair, CSV export and explicit empty/stale/error/429 states.
4. Test desktop/mobile/zoom, keyboard and screen-reader announcements, direct routes, Back/Forward and both deployment bases.

**Acceptance:** match the supplied hierarchy, dimensions and tokens, not just similar colours. No horizontal page overflow at listed widths; action targets/focus/contrast pass; data definitions appear in exports; all private state clears on lock. No metric changes merely because the theme or viewport changed. Learner timetable visual and functional checks remain green.

**Rollback:** preserve the analytics URL and auth service, ship a minimal compatible admin reader if necessary. Never point admin deep links at the learner shell.

### A4 — Feature coverage and real return analysis

**Depends on:** A2 stable collection; A3 shell.

1. Instrument new route/task/travel/PGCE successes using the shared catalogue and current main-app APIs.
2. Add capability-aware eligibility, unknown/zero/not-collected states, collection start dates and per-feature detail definitions.
3. Add return-frequency presentation and weekly cohort aggregation with complete-week eligibility, minimum cohort size and explicit identity-retention semantics.
4. Add compatible equal-period comparisons only after enough observations exist.

**Acceptance:** missing instrumentation cannot appear as 0% use; attempt/success names remain distinct; no private content in any outgoing fixture payload; exact-week cohort fixtures pass UTC Monday boundaries, partial weeks, old/new tokens and insufficient sample cases. No fabricated historical backfill. Visual rows fit long labels at 320px.

**Rollback:** hide affected aggregate sections behind honest unavailable states, retaining validated collection. Do not delete collected records to reset a chart.

### A5 — Reliability, release coverage and operational readiness

**Depends on:** A2–A4 contracts and complete observation windows where necessary.

1. Add aggregate worker reason counters and collection freshness diagnostics with known denominators; separately add coarse client/worker outcome sources where justified.
2. Implement Releases with immutable build metadata, latest-build attribution, unknown coverage and guarded comparisons.
3. Complete Data & access retention/glossary/export UX and scoped analytics-only expiry jobs. Document migration and recovery.
4. Tune snapshot cadence, rate limits and concurrency using load fixtures. Complete security, accessibility and installed-PWA checks.
5. Update deployment runbook, current PLAN entry and admin documentation in the same reviewed implementation commit. Do not change main service-worker registration strategy.

**Acceptance:** stale/incomplete pipelines cannot show healthy totals; counts from different sources never share an unexplained denominator; release comparisons are suppressed until compatible/large enough; retention touches only designated analytics data; installed analytics works at both host bases; current learner notifications/sync/PGCE flows still pass. No production test records or subscriptions are created.

**Rollback:** preserve last complete aggregate, disable new diagnostic sections/counters if needed, retain access fixes. Never delete KV records outside the feature's explicit synthetic/local test prefixes.

## 10. Verification matrix and completion criteria

Use existing `npm run test:unit`, build and Playwright conventions. Inspect repository scripts rather than inventing replacement deployment commands. Add focused tests for behavioural invariants; do not write assertions that merely duplicate markup structure.

| Area | Required cases |
|---|---|
| Authorization | Absent/empty/wrong/correct key; preflight Authorization; 401/503/429 headers; no scans before auth; no-store on success/errors |
| Session | Lock/reload/back navigation; late response after Lock; simultaneous refreshes; invalid cached legacy JSON; denied storage access; idle timeout; key input never persisted |
| Queue | Event during send; network failure; duplicate acknowledgement; lost acknowledgement then retry; two tabs; crash/lease expiry; quota/IDB unavailable; opt-out/demo/profile transitions |
| Ingestion | Unknown enum; negative/fractional/non-finite count; extra keys; oversized bytes; future/expired date; duplicate batch; two new batches same token/day; partial setup flags |
| Aggregation | Empty data; null row after list; multi-page list; cap exceeded; 1/7/30/31/62-day ranges; UTC midnight; first-seen unknown; mixed legacy/v2; failed publish keeps prior snapshot |
| Metrics | Positive-only adoption; eligible denominator; unknown setup; latest build attribution; cohort week boundaries; partial and small cohorts; comparable complete periods |
| Privacy | Serialized fixture contains no content/coordinates/record IDs; opt-out counters never reappear; export has no tokens; logs redact auth and payloads; cleanup isolated from vapid/sub/sync/group |
| UI | Ready/loading/empty/stale/error/unauthorized/rate-limited; long names; 0 and high counts; dark/light/system; keyboard table/plot; 200/400% zoom; safe areas |
| Hosting/PWA | Vercel root and GitHub base; direct analytics.html; manifest/install launch; offline locked shell; no API/auth SW cache; update from old installed page; timetable push/sync unaffected |

For implementation tests use a fake KV/coordinator and fixtures; never inspect a real stats key. Mock all worker requests in browser tests. Include a regression demonstrating each reproduced audit defect before its fix and the corrected expectation afterwards. For accessibility, add automated checks if the project has a suitable tool and manually inspect keyboard plus VoiceOver; no need to introduce a large dependency only for screenshots.

Definition of done for each phase: source changes narrowly scoped; relevant tests and build pass; changed UI captured at 390px and 1440px in both themes; metric definitions and API examples updated; no new uncaught errors; deployment order and rollback documented; screenshots use synthetic data. Follow `AGENTS.md` worker-first deployment rules when deployment is authorized. Do not deploy merely because this document exists.

## 11. Instructions to the implementing AI

Start with A1. Report which finding IDs are addressed, files changed, tests run and what remains unavailable. Preserve Claude’s current main timetable work and use its latest route/storage abstractions. Re-read file hashes as context, not as permission to reset files. Keep the visual gallery open as a reference; use the CSS tokens and responsive rules above, not approximate colours from screenshots.

Do not implement this handoff by shipping the mockup HTML: it has synthetic data, simulated unlock, simplified chart accessibility and illustrative controls. Build the real admin against authenticated validated aggregates. If an API cannot yet support a proposed card, show “Not collected” with its explanation. Do not insert sample numbers into a production dashboard, infer private events from existing user records or describe aggregate counts as people.

This handoff intentionally does not authorize production data inspection, messaging users, changing VAPID/namespace IDs, altering the timetable service-worker registration strategy, or implementing learner feature changes unrelated to telemetry. The requested result here is the audit/specification/design package; implementation requires the subsequent phase instruction.

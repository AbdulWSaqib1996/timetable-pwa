# Phase 1 isolated checks

Run `npm run validate` after installing dependencies and Chromium. For a root-path build,
run `VERCEL=1 npm run validate`. `npm run validate:ci` additionally installs Chromium.
Both host configurations call the same build → unit → browser gate and fail closed.

- Worker tests call the module directly with in-memory KV. Synthetic subscriptions A and B
  use fresh ECDH keys; network calls are stubbed. No production environment is bound.
- Tests reject missing/wrong credentials, registration replacement, untrusted destinations,
  oversized payloads and redirects. A device test cannot enumerate subscriptions or delete
  records. Successful delivery is decrypted using the recipient key; the VAPID signature
  and audience are verified. A cooldown for A does not prevent B's own test.
- Release tests run a copied driver with fake `gh`, `npm` and `npx` commands. They verify
  unique dispatch selection, failure/timeout handling and fail-closed gate stages.
- Browser tests use built-in/synthetic data, a fixed clock and blocked service workers.
  The shared fixture denies external service requests. The client-only push test stubs
  fetch and navigator; it checks that `/test` is never used, including against an old server.
- Deadline checks exercise the actual list, personal-only entry point, overdue summary and
  reminder loop, including completion after the initial render.

No real notification permission, cohort subscription, analytics record or KV write is
required. A browser smoke test validates demo rendering, not real Google Sheets parsing.

Before production release, run the gate on the intended commit and deploy the worker
first. Hosted runner compatibility and actual iOS/Android Web Push delivery still need
release verification. A real delivery check, if needed, must use a dedicated non-production
worker/KV and a test browser subscription only. Never send to cohort subscriptions.

The device test's KV cooldown is best-effort under cross-isolate/eventual consistency;
its essential guarantee is one explicitly authenticated target, never a broadcast.
Strict distributed abuse limits and broader worker endpoint ownership are Phase 3 work.

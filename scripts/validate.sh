#!/usr/bin/env bash
# Both hosting builds use this fail-closed validation gate.
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build
npm run test:unit
if [ "${1:-}" = "--skip-e2e" ]; then
  # Vercel's build image cannot launch Chromium (missing system libraries, no
  # root to add them) — build + unit tests gate here; the GitHub Actions run
  # for the same commit carries the full Playwright gate.
  echo "validate: browser e2e skipped on this host; covered by the Actions gate."
  exit 0
fi
if [ "${1:-}" = "--install-browser" ]; then
  npx playwright install chromium
fi
npm run test:e2e

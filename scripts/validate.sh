#!/usr/bin/env bash
# Both hosting builds use this fail-closed validation gate.
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build
npm run test:unit
if [ "${1:-}" = "--install-browser" ]; then
  npx playwright install chromium
fi
npm run test:e2e

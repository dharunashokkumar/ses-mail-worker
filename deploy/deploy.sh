#!/usr/bin/env bash
# Install, build, test and deploy this checkout. Run it on Linux, macOS or WSL: the
# worker build uses `cp -R`, which cmd.exe lacks. Wrangler must be logged in
# (`npx wrangler login`) or CLOUDFLARE_API_TOKEN must be set.
#
# Run it as a file (`bash deploy/deploy.sh`). Build steps get stdin closed because one
# of them reads it, which would swallow the rest of a script piped into bash.
set -euo pipefail
cd "$(dirname "$0")/.."

PNPM="npx --yes pnpm@10"

echo "=== install ==="
$PNPM install --frozen-lockfile < /dev/null

echo "=== build (dashboard + worker) ==="
$PNPM build < /dev/null

echo "=== worker tests ==="
(cd packages/worker && $PNPM test < /dev/null)

echo "=== deploy ==="
(cd deploy && ../node_modules/.bin/wrangler deploy < /dev/null)

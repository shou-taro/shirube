#!/usr/bin/env bash
# Build the SPA and bundle it into the API package, so a single process
# (uvx shirube) serves both the UI and the API on one origin.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Building the SPA..."
cd "$root/web"
npm ci
npm run build

echo "Bundling the SPA into the API package..."
rm -rf "$root/api/src/shirube/static"
cp -r "$root/web/dist" "$root/api/src/shirube/static"

echo "Done. Run: uv run --directory api shirube"

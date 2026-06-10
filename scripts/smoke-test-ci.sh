#!/usr/bin/env bash
#
# Minimal CI smoke helper for the Honch wizard build.
#
# This intentionally does not run a real install against a fixture project:
# the Honch wizard needs a live Honch bearer token and a target firmware/app
# project. The release smoke check here verifies that the compiled binary loads
# and exposes the Honch CLI surface.
set -euo pipefail

cd "$(dirname "$0")/.."

bun run build:ci
node ./dist/bin.js --help | grep -q "Install the Honch SDK into your project"
echo "Honch wizard CI smoke test passed."

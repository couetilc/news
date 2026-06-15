#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# Backward-compatible alias from the original one-off script.
if [ -n "${REPO:-}" ] && [ -z "${GH_REPO:-}" ]; then
  export GH_REPO="$REPO"
fi

exec .claude/skills/review-merged-prs/scripts/merged-prs-needing-review.sh "$@"

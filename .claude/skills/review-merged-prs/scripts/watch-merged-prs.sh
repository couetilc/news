#!/usr/bin/env bash
set -euo pipefail

interval="${INTERVAL:-60}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
detector="$script_dir/merged-prs-needing-review.sh"

usage() {
  cat <<'USAGE'
Usage: watch-merged-prs.sh [detector options]

Poll for merged PRs that still need a post-merge review (no agent-reviewed
label). Detector options are passed to merged-prs-needing-review.sh.

Environment:
  INTERVAL  Seconds between polls. Defaults to 60.
USAGE
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  "$detector" --help
  exit 0
fi

while true; do
  date -u +%Y-%m-%dT%H:%M:%SZ
  set +e
  "$detector" "$@"
  status=$?
  set -e

  if [ "$status" -eq 2 ]; then
    exit 2
  fi
  if [ "$status" -ne 0 ]; then
    echo "detector failed with exit $status" >&2
    exit "$status"
  fi
  sleep "$interval"
done

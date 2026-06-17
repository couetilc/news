#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
detector="$script_dir/merged-prs-needing-review.sh"

usage() {
  cat <<'USAGE'
Usage: watch-merged-prs.sh [detector options]

Watch for merged PRs that still need a post-merge review (no agent-reviewed
label). Polls quietly across turns and stays SILENT on stdout while nothing has
changed; prints the PR payload and exits 2 the moment a new merged PR appears.

Launch it through the harness background-task mechanism (the Bash tool with
run_in_background) so idle polls cost zero model turns and a new merge wakes the
agent exactly once with the PR number(s) to review. Re-launch it the same way
after each review batch to re-arm the watch. See SKILL.md "Watch mechanism".

Detector options are passed to merged-prs-needing-review.sh.

Environment:
  INTERVAL  Seconds between polls. Defaults to 60.
  WATCH_LOG If set, idle/diagnostic lines are appended here (never stdout).
USAGE
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  echo
  "$detector" --help
  exit 0
fi

exec "$script_dir/poll-detector.sh" "$detector" "$@"

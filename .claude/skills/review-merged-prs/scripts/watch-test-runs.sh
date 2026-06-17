#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
detector="$script_dir/test-runs-needing-review.sh"

usage() {
  cat <<'USAGE'
Usage: watch-test-runs.sh [detector options]

Watch for scheduled heavy-test runs (mutation / e2e / fuzz) that have completed
since the last reviewed run of the same kind. Polls quietly across turns and
stays SILENT on stdout while nothing has changed; prints the run payload and
exits 2 the moment a new reviewable run appears.

Launch it through the harness background-task mechanism (the Bash tool with
run_in_background) so idle polls cost zero model turns and a new heavy run wakes
the agent exactly once with the run id(s) to audit. Re-launch it the same way
after each audit batch (and after `--mark`) to re-arm. See SKILL.md "Watch
mechanism". Heavy workflows (#166/#77) must exist and emit runs first; until
then this stays silent.

Detector options are passed to test-runs-needing-review.sh.

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

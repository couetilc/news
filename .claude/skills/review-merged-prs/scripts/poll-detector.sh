#!/usr/bin/env bash
# Generic "poll a detector until it reports a delta" loop.
#
# Runs a detector command repeatedly, INTERVAL seconds apart, and stays SILENT
# on stdout while nothing has changed (the detector exits 0). The moment the
# detector reports a real delta (exit 2) this prints the detector's payload to
# stdout and exits 2 itself.
#
# Run it via the harness's background-task mechanism (the Bash tool with
# run_in_background): the harness re-invokes the agent only when a launched
# command *exits*. Because idle polls are absorbed by this loop's internal
# sleep and produce no stdout, an idle watch costs ZERO model turns; a delta
# exits 2 and wakes the agent exactly once with the payload to review. This is
# the canonical wake-on-change-only mechanism for the review-merged-prs watch.
#
# Usage: poll-detector.sh <detector-command> [detector-args...]
#
# Environment:
#   INTERVAL      Seconds between polls. Default 60.
#   MAX_FAILURES  Consecutive detector failures (exit != 0 and != 2) tolerated
#                 before giving up and waking the agent with the error. Default
#                 10. Transient failures (a gh/network blip) are logged and
#                 retried so a flaky poll never kills the watch.
#   WATCH_LOG     If set, idle/diagnostic lines are appended here (timestamped).
#                 Never written to stdout — stdout is reserved for the payload
#                 the agent wakes on.
set -uo pipefail

interval="${INTERVAL:-60}"
max_failures="${MAX_FAILURES:-10}"
log="${WATCH_LOG:-}"

usage() {
  cat <<'USAGE'
Usage: poll-detector.sh <detector-command> [detector-args...]

Poll a detector every INTERVAL seconds. Stay silent while it exits 0 (idle);
print its payload and exit 2 the moment it exits 2 (a real delta). Built to run
under the harness background-task mechanism so an idle watch costs zero model
turns and a delta wakes the agent exactly once.

Environment:
  INTERVAL      Seconds between polls. Default 60.
  MAX_FAILURES  Consecutive detector failures (exit not 0/2) tolerated before
                giving up and waking the agent with the error. Default 10.
  WATCH_LOG     If set, idle/diagnostic lines are appended here. Never stdout.
USAGE
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

if [ "$#" -lt 1 ]; then
  usage >&2
  exit 64
fi

note() {
  # Diagnostics go to the log file (or are dropped), never to stdout: stdout is
  # reserved for the exit-2 delta payload the agent wakes on.
  if [ -n "$log" ]; then
    printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >>"$log"
  fi
  return 0
}

failures=0
while true; do
  output="$("$@" 2>&1)"
  status=$?

  case "$status" in
    0)
      failures=0
      note "idle (detector exit 0)"
      ;;
    2)
      # Real delta: surface the payload and exit so the harness wakes the agent.
      printf '%s\n' "$output"
      exit 2
      ;;
    *)
      failures=$((failures + 1))
      note "detector failed (exit $status, $failures/$max_failures): $output"
      if [ "$failures" -ge "$max_failures" ]; then
        echo "watch: giving up after $failures consecutive detector failures (last exit $status):" >&2
        printf '%s\n' "$output" >&2
        exit "$status"
      fi
      ;;
  esac

  sleep "$interval"
done

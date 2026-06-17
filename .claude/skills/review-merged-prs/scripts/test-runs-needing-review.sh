#!/usr/bin/env bash
set -euo pipefail

# Detect scheduled heavy-test runs (mutation / e2e / fuzz) that still need an
# in-context audit, using a persisted "last-reviewed run id per kind" marker —
# the idempotency marker #227 calls for. Heavy runs can't carry a label the way
# merged PRs do, so the marker file is how a reviewed run is told from a new one.
#
# Deterministic delta contract (mirrors merged-prs-needing-review.sh):
#   - "kind" = a workflow (keyed by a slug of its workflowName). mutation, e2e,
#     and fuzz are separate workflows, so per-workflow markers ARE per-kind.
#   - A run "needs review" iff its databaseId is greater than the marker for its
#     kind (run ids are monotonic). Exit 2 when any kind has such a run, else 0.
#   - First sight of a kind (no marker yet) SEEDS the baseline: record the newest
#     completed run and stay silent. There is nothing to diff a first run
#     against (see #227's baseline->delta framework); the watch fires on the
#     NEXT completed run of that kind.
#   - After auditing run R of a kind, the agent bumps the marker with
#     `--mark R` (the analogue of `gh pr edit --add-label agent-reviewed`).
#
# Modes:
#   (default)      signal mode: seed missing baselines, exit 2 if any kind has a
#                  newer-than-marker completed run, else 0.
#   --mark RUN_ID  record RUN_ID as the last-reviewed run for its kind. Exit 0.
#   --json         read-only inspection (never seeds/mutates markers).

limit="${LIMIT:-100}"
repo="${GH_REPO:-}"
events="${WATCH_EVENTS:-schedule}"
match="${WATCH_MATCH:-mutation|stryker|e2e|playwright|fuzz}"
state_dir="${REVIEW_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/review-merged-prs}"
json_output=0
mark_id=""

usage() {
  cat <<'USAGE'
Usage: test-runs-needing-review.sh [options]
       test-runs-needing-review.sh --mark RUN_ID

List scheduled heavy-test workflow runs (mutation / e2e / fuzz) that have
completed since the last reviewed run of the same kind. Exit 0 when none,
2 when one or more need review.

Options:
  --repo OWNER/REPO   Target repo (default: current).
  --event LIST        Comma-separated run events that count as "heavy".
                      Default: schedule. (e.g. schedule,workflow_dispatch)
  --match REGEX       Case-insensitive regex over workflowName selecting heavy
                      workflows. Default: mutation|stryker|e2e|playwright|fuzz.
  --limit N           Completed runs to scan. Default 100.
  --state-dir DIR     Where last-reviewed-run markers live.
                      Default: $XDG_STATE_HOME/review-merged-prs.
  --mark RUN_ID       Record RUN_ID as reviewed for its kind, then exit.
  --json              Read-only JSON inspection; does not seed/mutate markers.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo) repo="$2"; shift 2 ;;
    --event) events="$2"; shift 2 ;;
    --match) match="$2"; shift 2 ;;
    --limit) limit="$2"; shift 2 ;;
    --state-dir) state_dir="$2"; shift 2 ;;
    --mark) mark_id="$2"; shift 2 ;;
    --json) json_output=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 64 ;;
  esac
done

for tool in gh jq; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "$tool is required" >&2
    exit 127
  fi
done

repo_args=()
if [ -n "$repo" ]; then
  repo_args=(--repo "$repo")
fi

slugify() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9' '-' \
    | sed -E 's/-+/-/g; s/^-//; s/-$//'
}

# --mark: derive the kind from the run's workflow and record the id.
if [ -n "$mark_id" ]; then
  run_json="$(gh run view "$mark_id" "${repo_args[@]}" --json databaseId,workflowName 2>/dev/null)" || {
    echo "could not look up run $mark_id" >&2
    exit 1
  }
  wf="$(jq -r '.workflowName' <<<"$run_json")"
  id="$(jq -r '.databaseId' <<<"$run_json")"
  slug="$(slugify "$wf")"
  mkdir -p "$state_dir"
  printf '%s\n' "$id" >"$state_dir/last-run-$slug"
  echo "Marked run $id ($wf) reviewed -> $state_dir/last-run-$slug"
  exit 0
fi

# Build the JSON array of event names to accept.
events_json="$(printf '%s' "$events" | jq -R 'split(",") | map(select(length > 0))')"

runs_json="$(
  gh run list "${repo_args[@]}" \
    --status completed \
    --limit "$limit" \
    --json databaseId,workflowName,conclusion,event,createdAt,url,displayTitle
)"

# Keep only completed heavy runs whose event is in the accepted set.
filtered="$(
  jq --arg match "$match" --argjson events "$events_json" '
    map(select((.event as $e | $events | index($e)) and (.workflowName | test($match; "i"))))
  ' <<<"$runs_json"
)"

# One marker per kind (= per workflowName).
mapfile -t workflows < <(jq -r '.[].workflowName' <<<"$filtered" | sort -u)

pending="[]"
kinds="[]"
for wf in "${workflows[@]}"; do
  [ -z "$wf" ] && continue
  group="$(jq --arg wf "$wf" 'map(select(.workflowName == $wf)) | sort_by(.databaseId)' <<<"$filtered")"
  newest_id="$(jq 'max_by(.databaseId).databaseId' <<<"$group")"
  slug="$(slugify "$wf")"
  marker="$state_dir/last-run-$slug"

  if [ -f "$marker" ]; then
    marker_id="$(cat "$marker")"
    new_runs="$(jq --argjson m "$marker_id" 'map(select(.databaseId > $m))' <<<"$group")"
  else
    marker_id="null"
    # No baseline yet: seed it in signal mode, report none. Stay read-only in
    # --json mode so inspection never has side effects.
    if [ "$json_output" -eq 0 ]; then
      mkdir -p "$state_dir"
      printf '%s\n' "$newest_id" >"$marker"
    fi
    new_runs="[]"
  fi

  pending="$(jq -n --argjson a "$pending" --argjson b "$new_runs" '$a + $b')"
  kinds="$(
    jq -n \
      --argjson k "$kinds" \
      --arg wf "$wf" \
      --arg slug "$slug" \
      --argjson last "$marker_id" \
      --argjson newest "$newest_id" \
      --argjson new "$new_runs" \
      '$k + [{workflowName: $wf, slug: $slug, lastReviewed: $last, newest: $newest, pending: ($new | map(.databaseId))}]'
  )"
done

pending="$(jq 'sort_by(.databaseId)' <<<"$pending")"
count="$(jq 'length' <<<"$pending")"

if [ "$json_output" -eq 1 ]; then
  jq -n --argjson count "$count" --argjson runs "$pending" --argjson kinds "$kinds" \
    '{count: $count, runs: $runs, kinds: $kinds}'
else
  if [ "$count" -eq 0 ]; then
    echo "No scheduled heavy-test runs need review."
  else
    echo "Scheduled heavy-test runs needing review:"
    jq -r '.[] | "Run \(.databaseId) [\(.workflowName)] \(.conclusion) at \(.createdAt)\n  \(.url)"' <<<"$pending"
    echo
    echo "Review prompt:"
    jq -r '.[] | "Audit run \(.databaseId) (\(.workflowName)) against the last reviewed run of the same kind (baseline->delta, attribute to merged PRs, suppress known-equivalent/flaky noise), file agent-review issues per finding, then run: test-runs-needing-review.sh --mark \(.databaseId)"' <<<"$pending"
  fi
fi

if [ "$count" -eq 0 ]; then
  exit 0
fi
exit 2

#!/usr/bin/env bash
set -euo pipefail

repo="${GH_REPO:-}"
label="${FINDING_LABEL:-agent-review}"
state="open"
json_output=0

usage() {
  cat <<'USAGE'
Usage: review-followups.sh [--repo OWNER/REPO] [--label NAME] [--state STATE] [--json]

List review finding-issues (label "agent-review" by default) so a follow-up
agent can pick them up. Defaults to open issues.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo)
      repo="$2"; shift 2 ;;
    --label)
      label="$2"; shift 2 ;;
    --state)
      state="$2"; shift 2 ;;
    --json)
      json_output=1; shift ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 64 ;;
  esac
done

if ! command -v gh >/dev/null 2>&1; then
  echo "gh is required" >&2
  exit 127
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required" >&2
  exit 127
fi

repo_args=()
if [ -n "$repo" ]; then
  repo_args=(--repo "$repo")
fi

issues_json="$(
  gh issue list "${repo_args[@]}" \
    --label "$label" \
    --state "$state" \
    --limit 100 \
    --json number,title,url,state
)"

if [ "$json_output" -eq 1 ]; then
  echo "$issues_json"
else
  count="$(jq 'length' <<<"$issues_json")"
  if [ "$count" -eq 0 ]; then
    echo "No ${state} '${label}' finding-issues."
  else
    jq -r '.[] | "#\(.number)\t\(.state)\t\(.title)\n  \(.url)"' <<<"$issues_json"
  fi
fi

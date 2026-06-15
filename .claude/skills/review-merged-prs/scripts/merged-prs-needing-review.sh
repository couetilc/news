#!/usr/bin/env bash
set -euo pipefail

limit="${LIMIT:-50}"
repo="${GH_REPO:-}"
label="${REVIEWED_LABEL:-agent-reviewed}"
json_output=0

usage() {
  cat <<'USAGE'
Usage: merged-prs-needing-review.sh [--limit N] [--repo OWNER/REPO] [--label NAME] [--json]

List merged GitHub PRs that do not yet carry the "agent-reviewed" label.
Exit 0 when none are found, 2 when one or more need review.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --limit)
      limit="$2"; shift 2 ;;
    --repo)
      repo="$2"; shift 2 ;;
    --label)
      label="$2"; shift 2 ;;
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

merged_json="$(
  gh pr list "${repo_args[@]}" \
    --state merged \
    --limit "$limit" \
    --json number,title,mergedAt,url,labels
)"

# A merged PR needs review when it does not carry the reviewed label.
# (`label` is a reserved word in jq, so bind the value as `$want`.)
needed="$(
  jq --arg want "$label" '
    map(select([.labels[].name] | index($want) | not))
    | sort_by(.mergedAt)
  ' <<<"$merged_json"
)"

count="$(jq 'length' <<<"$needed")"

if [ "$json_output" -eq 1 ]; then
  jq --argjson count "$count" '{count: $count, prs: .}' <<<"$needed"
else
  if [ "$count" -eq 0 ]; then
    echo "No merged PRs need review."
  else
    echo "Merged PRs needing in-context review:"
    jq -r '.[] | "PR #\(.number) merged at \(.mergedAt) - \(.title)\n  \(.url)"' <<<"$needed"
    echo
    echo "Review prompt:"
    jq -r '.[] | "Review PR #\(.number), file a agent-review issue per actionable finding, then run: gh pr edit \(.number) --add-label agent-reviewed"' <<<"$needed"
  fi
fi

if [ "$count" -eq 0 ]; then
  exit 0
fi
exit 2

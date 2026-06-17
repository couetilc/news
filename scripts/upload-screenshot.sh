#!/usr/bin/env bash
#
# upload-screenshot.sh — upload a visual-change PR screenshot to Cloudflare R2
# and print the public URL to embed in the PR body.
#
# This is the dev-only mechanism for attaching before/after screenshots to a
# visual-change PR (see the design-system skill, "Screenshots for visual
# changes"). It replaces the interim "commit PNGs under docs/screenshots/" path:
# binaries live in R2, not in main's git history; the PR body embeds a public
# R2 URL that GitHub renders inline.
#
# It is intentionally NOT a Worker binding: the Worker never serves these
# images, so this bucket is a dev artifact store, documented here and in
# .env.example — not declared in wrangler.jsonc (that rule is for Worker-bound
# resources). See the design-system skill for the full reasoning.
#
# Usage:
#   scripts/upload-screenshot.sh <issue-number> <before|after|name> <path-to-png>
#
# Example:
#   scripts/upload-screenshot.sh 263 before docs/screenshot.png
#   → uploads to key 263/before.png and prints its public URL.
#
# Requirements (HUMAN ACTIVATION — until done, this script is inert):
#   1. CLOUDFLARE_API_TOKEN with the "Workers R2 Storage: Edit" account scope
#      (wrangler reads it from .env natively; the agent container injects it).
#      See .env.example for the exact scope list.
#   2. An R2 bucket named by $R2_SCREENSHOTS_BUCKET (default: news-screenshots)
#      with its public-access domain enabled, so the printed URL renders inline.
#      Connor creates the bucket + enables public access (one-time, see the PR
#      that introduced this script).
#
# Configuration (override via environment variables):
#   R2_SCREENSHOTS_BUCKET   R2 bucket name             (default: news-screenshots)
#   R2_SCREENSHOTS_BASEURL  public base URL, no slash  (default: unset — see below)
#
# Public URL: by default this prints the r2.dev managed public domain URL, which
# Cloudflare assigns when you enable public access on the bucket. That hash is
# not known until the bucket exists, so set R2_SCREENSHOTS_BASEURL to it once
# Connor has it, e.g.:
#   export R2_SCREENSHOTS_BASEURL="https://pub-<hash>.r2.dev"
# (or a custom domain like https://screenshots.cuteteal.com). If unset, the
# script still uploads and prints a clearly-marked placeholder URL plus a hint.

set -euo pipefail

cd "$(dirname "$0")/.."

die() { printf 'upload-screenshot: %s\n' "$1" >&2; exit 1; }

[ "$#" -eq 3 ] || die "usage: scripts/upload-screenshot.sh <issue-number> <before|after|name> <path-to-png>"

issue="$1"
name="$2"
file="$3"

[ -f "$file" ] || die "file not found: $file"

bucket="${R2_SCREENSHOTS_BUCKET:-news-screenshots}"

# Key layout mirrors the old docs/screenshots/<issue>/<name>.png convention so
# the bucket stays browsable per issue. Strip any directory from $name and force
# a single .png extension.
key_name="$(basename "$name")"
key_name="${key_name%.png}"
key="${issue}/${key_name}.png"

echo "Uploading $file → r2://$bucket/$key (remote) ..." >&2
# --remote targets the real account bucket (not local persistence); wrangler
# authenticates with CLOUDFLARE_API_TOKEN from .env. content-type so GitHub and
# browsers render the object inline rather than downloading it.
npx wrangler r2 object put "$bucket/$key" \
  --file "$file" \
  --content-type "image/png" \
  --remote

# Print the public URL to embed. Markdown-ready on stdout; diagnostics on stderr.
if [ -n "${R2_SCREENSHOTS_BASEURL:-}" ]; then
  base="${R2_SCREENSHOTS_BASEURL%/}"
  echo "$base/$key"
else
  echo "Upload done, but R2_SCREENSHOTS_BASEURL is unset, so the public URL is" >&2
  echo "unknown. Set it to the bucket's r2.dev domain (or custom domain) once" >&2
  echo "public access is enabled, e.g.:" >&2
  echo "  export R2_SCREENSHOTS_BASEURL=\"https://pub-<hash>.r2.dev\"" >&2
  echo "Placeholder URL (replace <BASEURL>):" >&2
  echo "<BASEURL>/$key"
fi

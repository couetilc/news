#!/usr/bin/env bash
#
# upload-screenshot.sh — upload a visual-change PR screenshot to the public
# `news-cdn` R2 bucket and print the public URL to embed in the PR body.
#
# This is the mechanism for attaching before/after screenshots to a visual-change
# PR (see the design-system skill, "Screenshots for visual changes"): binaries
# live in R2, not in main's git history; the PR body embeds a public URL that
# GitHub's image proxy fetches and renders inline.
#
# Architecture: one PUBLIC bucket `news-cdn` (an r2_buckets binding `CDN` in
# wrangler.jsonc, auto-provisioned on `wrangler deploy`) served at the custom
# domain news-cdn.cuteteal.com via R2's NATIVE custom domain — CDN-cached, free
# egress, no Worker in the request path. PR screenshots live under the
# `pr-screenshots/<issue>/` prefix; user-facing assets share the bucket under
# other prefixes later.
#
# Usage:
#   scripts/upload-screenshot.sh <issue-number> <before|after|name> <path-to-png>
#
# Example:
#   scripts/upload-screenshot.sh 263 before docs/screenshot.png
#   → puts pr-screenshots/263/before.png and prints
#     https://news-cdn.cuteteal.com/pr-screenshots/263/before.png
#
# Requirements (ONE-TIME HUMAN ACTIVATION — until done, this script is inert):
#   1. CLOUDFLARE_API_TOKEN with R2 read/write + provisioning scope
#      ("Workers R2 Storage: Edit") in BOTH the local .env AND the GitHub
#      Actions repo secret. wrangler reads .env natively; the agent container
#      injects it. CI needs the scope too because the bucket auto-provisions on
#      the CI deploy. See .env.example for the full scope list.
#   2. After the first deploy auto-creates the `news-cdn` bucket, attach its
#      custom domain (NOT declarable in wrangler.jsonc — done via the CLI once):
#        npx wrangler r2 bucket domain add news-cdn \
#          --domain news-cdn.cuteteal.com \
#          --zone-id 1413a4570fa6e193d5f224ebb5220bb5
#      That provisions the DNS record + cert on the cuteteal.com zone, so the
#      printed https://news-cdn.cuteteal.com/... URLs resolve.
#
# Configuration (override via environment variables):
#   R2_CDN_BUCKET    R2 bucket name             (default: news-cdn)
#   R2_CDN_BASEURL   public base URL, no slash  (default: https://news-cdn.cuteteal.com)

set -euo pipefail

cd "$(dirname "$0")/.."

die() { printf 'upload-screenshot: %s\n' "$1" >&2; exit 1; }

[ "$#" -eq 3 ] || die "usage: scripts/upload-screenshot.sh <issue-number> <before|after|name> <path-to-png>"

issue="$1"
name="$2"
file="$3"

[ -f "$file" ] || die "file not found: $file"

bucket="${R2_CDN_BUCKET:-news-cdn}"
base="${R2_CDN_BASEURL:-https://news-cdn.cuteteal.com}"
base="${base%/}"

# Key layout: pr-screenshots/<issue>/<name>.png so the bucket stays browsable
# per issue under the PR-screenshots prefix. Strip any directory from $name and
# force a single .png extension.
key_name="$(basename "$name")"
key_name="${key_name%.png}"
key="pr-screenshots/${issue}/${key_name}.png"

echo "Uploading $file → r2://$bucket/$key (remote) ..." >&2
# --remote targets the real account bucket (not local persistence); wrangler
# authenticates with CLOUDFLARE_API_TOKEN from .env. content-type so GitHub's
# image proxy and browsers render the object inline rather than downloading it.
npx wrangler r2 object put "$bucket/$key" \
  --file "$file" \
  --content-type "image/png" \
  --remote

# Print the public URL to embed. Markdown-ready on stdout; diagnostics on stderr.
echo "$base/$key"

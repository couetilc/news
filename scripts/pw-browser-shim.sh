#!/usr/bin/env bash
#
# pw-browser-shim.sh — run the Playwright e2e suite on a surface whose
# preinstalled browser build doesn't match the @playwright/test pin (the
# claude.ai cloud VM).
#
# The cloud VM preinstalls Playwright browsers at
# PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers (with
# PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1), but that build lags the repo's
# @playwright/test pin, so `npm run test:e2e` fails with a missing-executable
# error — and `npx playwright install chromium` cannot fix it there because
# the Playwright browser CDN is egress-blocked under the environment's network
# policy. Minor version skew (an older headless shell under a newer client) is
# fine for these UI specs; CI installs the pinned browser properly and never
# uses this shim.
#
# What it does:
#   1. Derives the PINNED build revision from the installed
#      node_modules/playwright-core/browsers.json — nothing here hardcodes
#      build numbers, so the script survives the next version bump.
#   2. Finds the AVAILABLE build by globbing the preinstalled browsers dir
#      ($PLAYWRIGHT_BROWSERS_PATH, default /opt/pw-browsers).
#   3. If they already match (agent container; a host after `npx playwright
#      install chromium`): says so and exits 0 — run `npm run test:e2e`
#      directly.
#   4. Otherwise builds a symlink shim at node_modules/.cache/pw-browser-shim
#      mapping the pinned build's expected directory layout onto the installed
#      binaries. The INNER layout is arch-dependent and changed across builds
#      (see the per-platform executable-path table in playwright-core's
#      registry, bundled in lib/coreBundle.js): on linux-x64 newer builds use
#      chrome-headless-shell-linux64/chrome-headless-shell where older builds
#      used chrome-linux/headless_shell (linux-arm64 keeps the old names), so
#      the shim maps whichever layout is installed onto whichever is expected.
#   5. Probe-launches the shimmed headless shell to fail loudly if the mapping
#      (or Playwright's expected layout) ever drifts, then EXECS
#      `PLAYWRIGHT_BROWSERS_PATH=<shim> npm run test:e2e`, passing any script
#      arguments through to `playwright test`.
#
# Usage:
#   scripts/pw-browser-shim.sh                 # run the whole e2e suite
#   scripts/pw-browser-shim.sh --grep signup   # extra args go to playwright

set -euo pipefail

cd "$(dirname "$0")/.."

die() { printf 'pw-browser-shim: %s\n' "$1" >&2; exit 1; }
note() { printf 'pw-browser-shim: %s\n' "$1" >&2; }

[ -f node_modules/playwright-core/browsers.json ] \
  || die "node_modules/playwright-core/browsers.json not found — run npm ci first"

# Expected inner layout per architecture, from playwright-core's registry.
case "$(uname -m)" in
  x86_64)
    hs_inner="chrome-headless-shell-linux64" hs_bin="chrome-headless-shell"
    cr_inner="chrome-linux64" ;;
  aarch64 | arm64)
    hs_inner="chrome-linux" hs_bin="headless_shell"
    cr_inner="chrome-linux" ;;
  *) die "unsupported architecture: $(uname -m)" ;;
esac

# Pinned build revisions, derived from the installed @playwright/test.
rev_of() {
  node -p "require('./node_modules/playwright-core/browsers.json').browsers.find((b) => b.name === '$1').revision"
}
hs_rev="$(rev_of chromium-headless-shell)"
cr_rev="$(rev_of chromium)"
[[ "$hs_rev" =~ ^[0-9]+$ && "$cr_rev" =~ ^[0-9]+$ ]] \
  || die "could not derive pinned build revisions from browsers.json"

src="${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}"
[ -d "$src" ] \
  || die "no preinstalled Playwright browsers at $src — on a surface with browser-CDN access run: npx playwright install chromium"
src="$(cd "$src" && pwd)" # absolute, so the symlinks below resolve from anywhere

# Already matching? Then Playwright finds its executable without help.
if [ -x "$src/chromium_headless_shell-$hs_rev/$hs_inner/$hs_bin" ]; then
  note "installed build already matches the pin (chromium_headless_shell-$hs_rev) — no shim needed; run: npm run test:e2e"
  exit 0
fi

# Highest available headless-shell build under $src.
best="" best_rev=-1
for d in "$src"/chromium_headless_shell-*; do
  [ -d "$d" ] || continue
  rev="${d##*-}"
  [[ "$rev" =~ ^[0-9]+$ ]] || continue
  if ((rev > best_rev)); then best="$d" best_rev="$rev"; fi
done
[ -n "$best" ] || die "no chromium_headless_shell-<build> under $src to shim"

# Which inner layout does the installed build use?
if [ -x "$best/chrome-headless-shell-linux64/chrome-headless-shell" ]; then
  src_hs_inner="chrome-headless-shell-linux64" src_hs_bin="chrome-headless-shell"
elif [ -x "$best/chrome-linux/headless_shell" ]; then
  src_hs_inner="chrome-linux" src_hs_bin="headless_shell"
else
  die "unrecognized headless-shell layout under $best"
fi

shim="$PWD/node_modules/.cache/pw-browser-shim"
rm -rf "$shim"

note "shimming $(basename "$best") ($src_hs_inner/$src_hs_bin) as chromium_headless_shell-$hs_rev ($hs_inner/$hs_bin)"
dest="$shim/chromium_headless_shell-$hs_rev/$hs_inner"
mkdir -p "$dest"
for f in "$best/$src_hs_inner"/*; do
  ln -sfn "$f" "$dest/$(basename "$f")"
done
# The binary itself was renamed between layouts; the expected name must resolve.
[ -e "$dest/$hs_bin" ] || ln -sfn "$best/$src_hs_inner/$src_hs_bin" "$dest/$hs_bin"
touch "$shim/chromium_headless_shell-$hs_rev/INSTALLATION_COMPLETE" \
  "$shim/chromium_headless_shell-$hs_rev/DEPENDENCIES_VALIDATED"

# Full chromium, best-effort: the e2e suite launches the headless shell, this
# just keeps non-shell launches (headless: false, executablePath()) working.
for d in "$src"/chromium-*; do
  [ -d "$d" ] || continue
  [[ "$(basename "$d")" =~ ^chromium-[0-9]+$ ]] || continue # skip tip-of-tree etc.
  cr_src=""
  if [ -x "$d/chrome-linux64/chrome" ]; then
    cr_src="chrome-linux64"
  elif [ -x "$d/chrome-linux/chrome" ]; then
    cr_src="chrome-linux"
  fi
  [ -n "$cr_src" ] || continue
  cr_dest="$shim/chromium-$cr_rev/$cr_inner"
  mkdir -p "$cr_dest"
  for f in "$d/$cr_src"/*; do
    ln -sfn "$f" "$cr_dest/$(basename "$f")"
  done
  touch "$shim/chromium-$cr_rev/INSTALLATION_COMPLETE"
  break
done

# Anything else preinstalled (ffmpeg-<rev>, …) stays reachable as-is.
for d in "$src"/*; do
  case "$(basename "$d")" in chromium-* | chromium_headless_shell-*) continue ;; esac
  ln -sfn "$d" "$shim/$(basename "$d")"
done

note "probe-launching the shimmed headless shell"
if ! PLAYWRIGHT_BROWSERS_PATH="$shim" node -e '
  require("playwright-core").chromium.launch({ args: ["--no-sandbox"] })
    .then((b) => b.close())
    .catch((e) => { console.error(String((e && e.message) || e)); process.exit(1); });
'; then
  die "shim built at $shim but a probe launch failed (see above) — Playwright's expected layout may have changed; update the layout tables in this script against node_modules/playwright-core (registry executable-path table in lib/coreBundle.js)"
fi

note "running: PLAYWRIGHT_BROWSERS_PATH=$shim npm run test:e2e${*:+ -- $*}"
if [ "$#" -gt 0 ]; then
  exec env PLAYWRIGHT_BROWSERS_PATH="$shim" npm run test:e2e -- "$@"
fi
exec env PLAYWRIGHT_BROWSERS_PATH="$shim" npm run test:e2e

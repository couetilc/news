#!/bin/sh
# .agent/init.sh — project bootstrap, run INSIDE the container after the clone.
#
# USER-OWNED: `agent init` writes this once and never overwrites it. It runs as
# the non-root `node` user, so it CANNOT `apt install` — root/system deps belong
# in .agent/Dockerfile (the overlay). A failure here warns loudly but does NOT
# block the session.
#
# news keeps its app (Astro + Worker) at the repo root with a root-level
# package-lock.json, so install there. This replaces the old entrypoint's
# hardcoded root `npm ci`. The shared npm cache volume keeps it fast.
set -e

cd /workspace && npm ci

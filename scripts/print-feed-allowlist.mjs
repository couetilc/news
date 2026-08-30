#!/usr/bin/env node
// Print the feed-source hosts to paste into a claude.ai cloud environment's
// Custom "Allowed domains" list, so a cloud session can fetch live feeds while
// developing scrapers. Derived from src/ingest/sources.ts, so the list never
// drifts as sources are added or removed.
//
//   node scripts/print-feed-allowlist.mjs
//
// Notes:
//   - The claude.ai allowlist treats a leading `*.` as "every subdomain" and
//     does NOT include the apex, so this prints each exact host. Add
//     `*.<domain>` yourself in the UI if a source spreads across subdomains.
//   - In the environment dialog also tick "Also include default list of common
//     package managers" so npm/PyPI installs keep working.
//   - If the same environment is used for Cloudflare observability, add
//     `api.cloudflare.com` as well (see the observability backlog issue).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'src/ingest/sources.ts'), 'utf8');

const hosts = new Set();
for (const match of src.matchAll(/https:\/\/([a-z0-9.-]+)/gi)) {
  hosts.add(match[1].toLowerCase());
}

for (const host of [...hosts].sort()) console.log(host);

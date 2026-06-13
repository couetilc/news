/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

// Two projects, because two runtimes are genuinely needed:
//   • workers — ingest/db/parser logic + the worker entry, run inside workerd
//     (@cloudflare/vitest-pool-workers) so `cloudflare:workers` env and a real
//     local D1 resolve for real. See vitest.workers.config.ts.
//   • node — renders the .astro homepage through Astro's Container API, which
//     pulls in Astro's Vite plugins (xxhash-wasm) that can't run under the
//     worker pool. See vitest.node.config.ts.
// Istanbul coverage merges across both projects; V8 is unavailable in workerd
// (no node:inspector). The 100% line/branch gate over src/** still stands —
// every src file is exercised by one project or the other.
export default defineConfig({
	test: {
		projects: ['./vitest.workers.config.ts', './vitest.node.config.ts'],
		coverage: {
			provider: 'istanbul',
			include: ['src/**'],
			thresholds: {
				lines: 100,
				branches: 100,
			},
		},
	},
});

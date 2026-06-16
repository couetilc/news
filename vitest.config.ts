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
// (no node:inspector). The 100% statements/branches/functions/lines gate over
// src/** still stands — every src file is exercised by one project or the other.
export default defineConfig({
	test: {
		projects: ['./vitest.workers.config.ts', './vitest.node.config.ts'],
		coverage: {
			provider: 'istanbul',
			include: ['src/**'],
			// src/scripts/** are browser-only client enhancement modules pulled in via
			// Astro `<script>` imports (e.g. enhance-forms.ts, the ClientRouter-safe
			// async-feedback initializer, #155). Astro's client pipeline runs them in
			// the browser; the SSR/vitest module graph never imports or executes them
			// (the Container API emits the script tag without running its body), so
			// they can't be covered by the workerd/node pools. They are exercised by
			// the Playwright e2e (e2e/*.spec.ts) instead — exactly as the inline
			// <script> blocks they replace already were, per CLAUDE.md's testing
			// policy. Excluding them keeps the 100% gate honest for code the vitest
			// pools can actually execute; were they included, istanbul would report
			// them 0% (never imported) and red-fail the gate.
			exclude: ['src/scripts/**'],
			thresholds: {
				statements: 100,
				branches: 100,
				functions: 100,
				lines: 100,
			},
		},
	},
});

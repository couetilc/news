/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

// Plain node-environment vitest config used ONLY by Stryker mutation testing
// (stryker.config.json → vitest-runner). It is deliberately separate from the
// `npm test` path: it does NOT load the @cloudflare/vitest-pool-workers plugin,
// and it includes only the specs that exercise the pure-logic modules Stryker
// mutates (see stryker.config.json `mutate`). `npm test` keeps its two-project
// setup (workers + node) unchanged; this file is never referenced there.
//
// Why a separate config: Stryker's @stryker-mutator/vitest-runner re-runs vitest
// under instrumentation many times, and the workerd pool (which needs a live
// miniflare/D1 per file) is not a fit for that loop. So mutation testing is
// scoped to modules whose tests run in a plain node environment with zero
// Cloudflare/D1/workerd dependencies:
//   • src/lib/pagination.ts      ← test/pagination.test.ts
//   • src/lib/return-path.ts     ← test/return-path.test.ts
//   • src/ingest/parse/dates.ts  ← test/dates.test.ts
// These three are pure string/number logic; their specs import only `vitest`
// and the module under test (no `cloudflare:test`, no D1, no WebCrypto, no
// fixtures). Modules that genuinely require the workers pool (auth.ts's real
// workerd WebCrypto, users.ts's D1, the ingest run/db/validate paths) are out of
// mutation scope for now — see stryker.config.json for the rationale.
export default defineConfig({
	test: {
		name: 'stryker',
		environment: 'node',
		include: [
			'test/pagination.test.ts',
			'test/return-path.test.ts',
			'test/dates.test.ts',
		],
	},
});

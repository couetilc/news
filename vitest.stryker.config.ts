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
// scoped to the pure-logic modules whose tests run in a plain node environment
// with zero Cloudflare/D1/workerd dependencies (each spec → the module it
// mutates; kept in lockstep with `mutate` in stryker.config.json):
//   • src/lib/auth.ts                ← test/auth-validate.test.ts + test/auth-validate.prop.test.ts
//   • src/lib/deploy.ts              ← test/deploy.test.ts
//   • src/lib/pagination.ts          ← test/pagination.test.ts
//   • src/lib/return-path.ts         ← test/return-path.test.ts
//   • src/lib/log.ts                 ← test/log.test.ts
//   • src/lib/email.ts               ← test/email.test.ts (fetch is injected)
//   • src/ingest/validate.ts         ← test/validate.test.ts
//   • src/ingest/sources.ts          ← test/sources.test.ts
//   • src/ingest/parse/atom.ts       ← test/parse-atom.test.ts
//   • src/ingest/parse/rss20.ts      ← test/parse-rss20.test.ts
//   • src/ingest/parse/aws-whats-new.ts ← test/parse-aws-whats-new.test.ts
//   • src/ingest/parse/sec-edgar.ts  ← test/parse-sec-edgar.test.ts
//   • src/ingest/parse/ti-newsroom.ts ← test/parse-ti-newsroom.test.ts
//   • src/ingest/parse/count.ts      ← test/count.test.ts
//   • src/ingest/parse/dates.ts      ← test/dates.test.ts
// These specs import only `vitest`, the module under test, and (some) `?raw`
// feed fixtures — never `cloudflare:test`, D1, or WebCrypto — so they run here
// unchanged. Modules that genuinely require the workers pool (the D1 data layer:
// users.ts, auth-actions.ts, ingest run/db) or a page render (format/session),
// plus auth-crypto.ts (the Web Crypto shell — node-runnable but slow
// under 100k-iter PBKDF2 mutation, and crypto can't be meaningfully mutated;
// #228), are out of scope — see stryker.config.json for the rationale.
export default defineConfig({
	test: {
		name: 'stryker',
		environment: 'node',
		include: [
			'test/auth-validate.test.ts',
			'test/auth-validate.prop.test.ts',
			'test/deploy.test.ts',
			'test/pagination.test.ts',
			'test/return-path.test.ts',
			'test/log.test.ts',
			'test/email.test.ts',
			'test/validate.test.ts',
			'test/sources.test.ts',
			'test/parse-atom.test.ts',
			'test/parse-rss20.test.ts',
			'test/parse-aws-whats-new.test.ts',
			'test/parse-sec-edgar.test.ts',
			'test/parse-ti-newsroom.test.ts',
			'test/count.test.ts',
			'test/dates.test.ts',
		],
	},
});

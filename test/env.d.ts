import type { D1Migration } from '@cloudflare/vitest-pool-workers';

// The pool exposes the migrations read in vitest.config.ts as a binding so the
// setup file can apply them. Merge it into the generated Cloudflare.Env.
declare global {
	namespace Cloudflare {
		interface Env {
			TEST_MIGRATIONS: D1Migration[];
		}
	}
}

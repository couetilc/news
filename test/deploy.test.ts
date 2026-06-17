import { afterEach, describe, expect, it, vi } from 'vitest';
import { deployInfo } from '../src/lib/deploy';

// PURE-CORE unit tests for src/lib/deploy.ts. The deploy metadata is baked into
// the bundle at `astro build` via `vite.define`, which replaces the
// `__DEPLOY_*__` tokens with string literals; at runtime deploy.ts reads them
// through `typeof … !== 'undefined'` guards and falls back for local dev. This
// spec imports ONLY `vitest` and the module under test — no `.astro` render — so
// it runs in plain node and is in Stryker's mutation scope (vitest.stryker.config
// + stryker.config.json `mutate`, kept in lockstep). The status.astro render
// coverage lives in test/status.test.ts.
//
// Under the node vitest project (configFile:false) the `__DEPLOY_*__` tokens are
// never defined, so deploy.ts reads them off globalThis; stub them to drive the
// "present" branch deterministically.
const stubDeploy = (sha: string, ref: string, time: string) => {
	vi.stubGlobal('__DEPLOY_SHA__', sha);
	vi.stubGlobal('__DEPLOY_REF__', ref);
	vi.stubGlobal('__DEPLOY_TIME__', time);
};

describe('deployInfo', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('uses the injected SHA, ref, and build time when present', () => {
		stubDeploy('0123456789abcdef0123456789abcdef01234567', 'main', '2026-06-13T14:05:00.000Z');
		const info = deployInfo();
		expect(info.sha).toBe('0123456789abcdef0123456789abcdef01234567');
		// shortSha is exactly the first 7 chars of the SHA — not 6, not 8.
		expect(info.shortSha).toBe('0123456');
		expect(info.shortSha).toHaveLength(7);
		expect(info.ref).toBe('main');
		expect(info.time).toBe('2026-06-13T14:05:00.000Z');
		// A parseable ISO time renders as a human UTC stamp (not the raw value).
		expect(info.timeLabel).toBe('Jun 13, 2026 14:05 UTC');
		expect(info.timeLabel).not.toBe('2026-06-13T14:05:00.000Z');
		// Commit link points at the GitHub commit for the FULL SHA, not the short one.
		expect(info.commitUrl).toBe(
			'https://github.com/couetilc/news/commit/0123456789abcdef0123456789abcdef01234567',
		);
		// Observability link is the exact Cloudflare dashboard deep-link: account
		// id + worker name + the production/observability path.
		expect(info.observabilityUrl).toBe(
			'https://dash.cloudflare.com/dbaa50e60c18b19d483578c42d9bb3ee/workers/services/view/news/production/observability',
		);
	});

	it('preserves a distinct ref independently of the SHA', () => {
		// Guards against the ref/sha fields being swapped or aliased.
		stubDeploy('abcdef1234567890', 'release/v2', '2026-01-02T03:04:00.000Z');
		const info = deployInfo();
		expect(info.sha).toBe('abcdef1234567890');
		expect(info.ref).toBe('release/v2');
		expect(info.shortSha).toBe('abcdef1');
		// commitUrl embeds the SHA, not the ref.
		expect(info.commitUrl).toBe('https://github.com/couetilc/news/commit/abcdef1234567890');
	});

	it("shows a non-ISO build time verbatim (Date can't parse it)", () => {
		// A build time that Date.parse rejects is surfaced as-is, not coerced to a
		// stamp or to 'Invalid Date'.
		stubDeploy('0123456789abcdef', 'main', 'not-a-date');
		const info = deployInfo();
		expect(info.time).toBe('not-a-date');
		expect(info.timeLabel).toBe('not-a-date');
	});

	it('falls back to local-dev values when the build tokens are absent', () => {
		// No stubs: the typeof guards yield the fallbacks.
		const info = deployInfo();
		expect(info.sha).toBe('dev');
		// 'dev' is shorter than 7 chars, so shortSha is the whole string.
		expect(info.shortSha).toBe('dev');
		expect(info.ref).toBe('local');
		expect(info.time).toBe('unknown');
		// 'unknown' isn't a parseable date, so the label is shown verbatim.
		expect(info.timeLabel).toBe('unknown');
		expect(info.commitUrl).toBe('https://github.com/couetilc/news/commit/dev');
		// The observability deep-link is independent of the build tokens.
		expect(info.observabilityUrl).toBe(
			'https://dash.cloudflare.com/dbaa50e60c18b19d483578c42d9bb3ee/workers/services/view/news/production/observability',
		);
	});
});

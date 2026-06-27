// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// M2: keep Stryker's `mutate` scope self-maintaining (#229).
//
// Mutation testing (`npm run test:mutation`, advisory — see stryker.config.json)
// only mutates PURE-CORE modules whose specs run in plain node. The scope is
// hand-listed in two places (stryker.config.json `mutate` + the include in
// vitest.stryker.config.ts), so it can silently rot: a new pure module added
// without a spec, or a new workerd-glue module, drifts the scope without anyone
// noticing. This test partitions every src/lib + src/ingest source file by
// scanning for glue markers and asserts the partition matches the declared
// scope, so any drift red-fails `npm test` until it is classified.
//
// Runs in the NODE project (it reads sources + stryker.config.json off disk via
// node:fs; the workers pool can't). Adds nothing to mutation scope itself.

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

// Source roots Stryker draws its core glob from. Framework-fixed dirs
// (src/pages, src/middleware.ts, src/worker.ts, src/components, src/scripts) are
// out of scope by design and are not enumerated here.
const SOURCE_ROOTS = ['src/lib', 'src/ingest'] as const;

// workerd-runtime markers — a source touching any of these has behavior that
// depends on the worker runtime (D1/KV/cloudflare env/Web Crypto), so it's GLUE
// (imperative shell): tested in the workers pool, out of mutation scope.
const GLUE_MARKERS: RegExp[] = [
	/\bD1Database\b/,
	/cloudflare:workers/,
	/cloudflare:test/,
	/\bKVNamespace\b/,
	/crypto\.subtle\b/,
	/crypto\.getRandomValues\b/,
	/\bSESSION\b/,
	// env.<UPPERCASE binding> (e.g. env.AUTH_PEPPER) — a workerd binding read.
	// import.meta.env is Vite's build env, NOT a binding, so exclude it.
	/(?<!\.)\benv\.[A-Z][A-Z0-9_]*\b/,
];

// Modules with zero runtime code (interfaces/types only) — nothing to mutate,
// not glue, not core. Skipped, like *.d.ts files.
const TYPE_ONLY: string[] = ['src/ingest/types.ts'];

// GLUE-ALLOWLIST — must EXACTLY equal the marker-detected glue set. A new glue
// file then red-fails here until it's classified (it can't slip into `mutate`
// or be silently dropped). One reason per entry.
const GLUE_ALLOWLIST: Record<string, string> = {
	'src/lib/auth-actions.ts': 'D1 auth mutations (register/login over D1Database)',
	'src/lib/auth-crypto.ts': 'Web Crypto shell (crypto.subtle/getRandomValues PBKDF2)',
	'src/lib/session.ts': 'Astro Session over the SESSION KV + env.AUTH_* bindings',
	'src/lib/users.ts': 'D1 users data layer (D1Database queries)',
	'src/ingest/db.ts': 'D1 ingest data layer (D1Database upserts/reads)',
	'src/ingest/run.ts': 'ingest orchestrator holding the D1Database handle',
};

// CORE-WITHOUT-ISOLATED-TEST allowlist — PURE modules with no dedicated
// plain-node unit spec (covered only via .astro render tests, so not
// mutation-reachable yet). Every pure module must be in `mutate` OR here, so a
// forgotten new pure module red-fails. One reason per entry.
const CORE_WITHOUT_ISOLATED_TEST: Record<string, string> = {
	'src/lib/format.ts': 'no dedicated spec — covered only via .astro page renders',
	'src/lib/sources.ts': 'no dedicated spec — covered only via .astro page renders',
	'src/lib/pinned.ts': 'flat data registry — covered only via the .astro PinnedLinks render',
	// deploy.ts now has a dedicated plain-node spec (test/deploy.test.ts, split
	// out of status.test.ts in #236), so it's in `mutate` + the stryker include,
	// not here.
};

// MUTATE→SPEC lockstep map (#237). The testing skill documents that bringing a
// pure module into Stryker requires updating BOTH stryker.config.json `mutate`
// AND the include in vitest.stryker.config.ts in lockstep. The guards above
// enforce the source-classification side; this map closes the second half:
// every `mutate` source file lists the plain-node spec(s) that exercise it, and
// the test below asserts each appears in the Stryker vitest include. So a new
// `mutate` entry whose spec was never added to that include red-fails `npm
// test`. The map is also asserted EXHAUSTIVE over `mutate` (a `mutate` entry
// with no mapping is itself caught), so there's no silent gap. Spec paths are
// repo-relative, matching the include's own form.
const MUTATE_SPECS: Record<string, string[]> = {
	'src/lib/auth.ts': ['test/auth-validate.test.ts', 'test/auth-validate.prop.test.ts'],
	'src/lib/deploy.ts': ['test/deploy.test.ts'],
	'src/lib/pagination.ts': ['test/pagination.test.ts'],
	'src/lib/return-path.ts': ['test/return-path.test.ts'],
	'src/lib/log.ts': ['test/log.test.ts'],
	'src/lib/email.ts': ['test/email.test.ts'],
	'src/ingest/validate.ts': ['test/validate.test.ts'],
	'src/ingest/sources.ts': ['test/sources.test.ts'],
	'src/ingest/parse/atom.ts': ['test/parse-atom.test.ts'],
	'src/ingest/parse/rss20.ts': ['test/parse-rss20.test.ts'],
	'src/ingest/parse/aws-whats-new.ts': ['test/parse-aws-whats-new.test.ts'],
	'src/ingest/parse/sec-edgar.ts': ['test/parse-sec-edgar.test.ts'],
	'src/ingest/parse/ti-newsroom.ts': ['test/parse-ti-newsroom.test.ts'],
	'src/ingest/parse/jpm-eotm.ts': ['test/parse-jpm-eotm.test.ts'],
	'src/ingest/parse/entities.ts': ['test/parse-entities.test.ts'],
	'src/ingest/parse/count.ts': ['test/count.test.ts'],
	'src/ingest/parse/dates.ts': ['test/dates.test.ts'],
};

// Read the include list out of vitest.stryker.config.ts itself (its default
// export is a plain `defineConfig` object, so a dynamic import resolves it via
// vite's transform — no network, no regex). This is the same array Stryker's
// vitest-runner uses, so asserting against it tracks the real config, not a copy.
async function strykerVitestInclude(): Promise<string[]> {
	const mod = await import('../vitest.stryker.config.ts');
	const include = (mod.default as { test?: { include?: string[] } }).test?.include;
	if (!Array.isArray(include))
		throw new Error('vitest.stryker.config.ts test.include is not an array');
	return include;
}

function listSources(): string[] {
	const out: string[] = [];
	const walk = (absDir: string) => {
		for (const entry of readdirSync(absDir, { withFileTypes: true })) {
			const abs = join(absDir, entry.name);
			if (entry.isDirectory()) {
				walk(abs);
			} else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
				out.push(relative(repoRoot, abs).split('\\').join('/'));
			}
		}
	};
	for (const root of SOURCE_ROOTS) walk(join(repoRoot, root));
	return out.sort();
}

function isGlue(relPath: string): boolean {
	const src = readFileSync(join(repoRoot, relPath), 'utf8');
	return GLUE_MARKERS.some((re) => re.test(src));
}

function strykerMutateList(): string[] {
	const cfg = JSON.parse(readFileSync(join(repoRoot, 'stryker.config.json'), 'utf8'));
	return cfg.mutate as string[];
}

describe('Stryker mutate-scope is self-maintaining (#229)', () => {
	const allSources = listSources();
	const candidates = allSources.filter((p) => !TYPE_ONLY.includes(p));
	const glueSet = candidates.filter(isGlue).sort();
	const pureSet = candidates.filter((p) => !glueSet.includes(p)).sort();
	const mutate = strykerMutateList();

	it('enumerates the expected source files (guard against a moved root)', () => {
		// Sanity: the roots resolved and we found a non-trivial set including a
		// known core module and a known glue module.
		expect(allSources).toContain('src/lib/auth.ts');
		expect(allSources).toContain('src/ingest/parse/atom.ts');
		expect(allSources.length).toBeGreaterThan(15);
	});

	it('no file in `mutate` is glue', () => {
		const glueInMutate = mutate.filter((p) => glueSet.includes(p));
		expect(glueInMutate).toEqual([]);
	});

	it('every `mutate` entry exists and is a known source file', () => {
		const unknown = mutate.filter((p) => !allSources.includes(p));
		expect(unknown).toEqual([]);
	});

	it('the glue-allowlist EXACTLY equals the marker-detected glue set', () => {
		// A new glue file then red-fails until classified; a misclassified one is
		// caught here too. Update GLUE_ALLOWLIST (with a reason) to match.
		expect(Object.keys(GLUE_ALLOWLIST).sort()).toEqual(glueSet);
	});

	it('every pure module is in `mutate` or the core-without-isolated-test allowlist', () => {
		const accounted = new Set([...mutate, ...Object.keys(CORE_WITHOUT_ISOLATED_TEST)]);
		const unaccounted = pureSet.filter((p) => !accounted.has(p));
		// A forgotten new pure module red-fails: add it to stryker `mutate` +
		// vitest.stryker.config.ts `include`, or to CORE_WITHOUT_ISOLATED_TEST.
		expect(unaccounted).toEqual([]);
	});

	it('the two allowlists are disjoint and never overlap `mutate`', () => {
		const glueKeys = Object.keys(GLUE_ALLOWLIST);
		const coreKeys = Object.keys(CORE_WITHOUT_ISOLATED_TEST);
		expect(glueKeys.filter((p) => coreKeys.includes(p))).toEqual([]);
		expect(glueKeys.filter((p) => mutate.includes(p))).toEqual([]);
		expect(coreKeys.filter((p) => mutate.includes(p))).toEqual([]);
	});

	it('every allowlist entry carries a non-empty reason', () => {
		for (const reason of Object.values(GLUE_ALLOWLIST)) expect(reason.length).toBeGreaterThan(0);
		for (const reason of Object.values(CORE_WITHOUT_ISOLATED_TEST))
			expect(reason.length).toBeGreaterThan(0);
	});

	// #237: lockstep with the vitest.stryker.config.ts include list. The guards
	// above keep the SOURCE classification honest; these two keep the second
	// hand-listed half (the Stryker vitest include) from drifting out of sync.

	it('the MUTATE_SPECS map is exhaustive over `mutate` (no unmapped entry)', () => {
		// Every `mutate` entry must declare its spec(s); a new `mutate` entry with
		// no mapping red-fails here, so the include check below can't be silently
		// bypassed. Also asserts no stale mapping for a non-`mutate` module.
		expect(Object.keys(MUTATE_SPECS).sort()).toEqual([...mutate].sort());
	});

	it('every `mutate` module’s spec is in the vitest.stryker.config.ts include', async () => {
		const include = await strykerVitestInclude();
		const required = [...new Set(Object.values(MUTATE_SPECS).flat())].sort();
		const missing = required.filter((spec) => !include.includes(spec));
		// A pure module added to stryker `mutate` without its plain-node spec added
		// to vitest.stryker.config.ts `include` red-fails here — close the lockstep
		// gap the testing skill documents (#237). Add the spec to that include.
		expect(missing).toEqual([]);
	});
});

// Pins the user-facing source metadata registry (#326): sourceMeta() turns a
// stored source slug into the display name + Tailwind swatch class the reader
// sees on every article dateline and filter chip. A typo in slug, name, or
// swatch class silently falls back to the raw slug / neutral rule (deliberately
// never a crash), so the coverage gate alone would stay green — these tests pin
// the exact values instead.
//
// Plain-node spec: it imports only vitest, the module under test, and node:fs
// for the CSS-token cross-check. That makes src/lib/sources.ts
// mutation-reachable — it's listed in stryker.config.json `mutate` and this
// spec is in the vitest.stryker.config.ts include (lockstep enforced by
// test/stryker-scope.test.ts). It runs in the NODE project (node:fs; the
// workerd pool can't read the repo off disk).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sourceMeta } from '../src/lib/sources';

const repoFile = (rel: string): string =>
	readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

describe('sourceMeta', () => {
	it('maps eye-on-the-market to its registered display name and swatch (#326)', () => {
		// The exact pair the reader sees — not toBeDefined. A slug typo would fall
		// back to { name: 'eye-on-the-market', swatch: 'bg-muted' } and fail here.
		expect(sourceMeta('eye-on-the-market')).toEqual({
			name: 'Eye on the Market',
			swatch: 'bg-source-eotm',
		});
	});

	it('maps mistral to its registered display name and swatch (#339)', () => {
		// The exact pair the reader sees on the chip; a slug typo would fall back
		// to { name: 'mistral', swatch: 'bg-muted' } and fail here.
		expect(sourceMeta('mistral')).toEqual({
			name: 'Mistral',
			swatch: 'bg-source-mistral',
		});
	});

	it('maps openai to its registered display name and swatch (#337)', () => {
		// The exact pair the reader sees; a slug typo would fall back to
		// { name: 'openai', swatch: 'bg-muted' } and fail here.
		expect(sourceMeta('openai')).toEqual({
			name: 'OpenAI',
			swatch: 'bg-source-openai',
		});
	});

	it('maps other registered slugs to their exact display metadata', () => {
		// Per-slug pins (not exact-list equality) so sibling sources can land in
		// parallel without touching this test.
		expect(sourceMeta('cloudflare-blog')).toEqual({
			name: 'Cloudflare Blog',
			swatch: 'bg-source-cloudflare',
		});
		expect(sourceMeta('ti')).toEqual({ name: 'Texas Instruments', swatch: 'bg-source-ti' });
		expect(sourceMeta('thinking-machines')).toEqual({
			name: 'Thinking Machines',
			swatch: 'bg-source-thinking-machines',
		});
	});

	it('falls back to the raw slug and the neutral swatch for an unregistered source', () => {
		expect(sourceMeta('mystery-wire')).toEqual({ name: 'mystery-wire', swatch: 'bg-muted' });
		// Boundary: the empty slug still takes the graceful fallback, never a throw.
		expect(sourceMeta('')).toEqual({ name: '', swatch: 'bg-muted' });
	});

	it('every swatch literal in the registry has its --color-* token in global.css', () => {
		// Tailwind v4 derives `bg-source-eotm` from the `--color-source-eotm` theme
		// token in src/styles/global.css; with the token missing the class is
		// simply not generated and the swatch silently renders transparent. Scan
		// the registry's quoted swatch literals and require each token, so a new
		// source can't ship a swatch class without its color (self-maintaining —
		// future sources are checked automatically).
		const registrySource = repoFile('src/lib/sources.ts');
		const css = repoFile('src/styles/global.css');
		const swatches = [...new Set([...registrySource.matchAll(/'(bg-[a-z0-9-]+)'/g)].map((m) => m[1]))];
		// Sanity: the scan actually found the registry, including the entry under
		// test and the neutral fallback.
		expect(swatches).toContain('bg-source-eotm');
		expect(swatches).toContain('bg-muted');
		for (const swatch of swatches) {
			expect(css).toContain(`--color-${swatch.slice('bg-'.length)}:`);
		}
	});
});

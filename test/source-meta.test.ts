// Pins the user-facing source metadata registry (#326): sourceMeta() turns a
// stored source slug into the display name + identity-mark classes the reader
// sees on every article dateline and filter chip. A typo in slug, name, or
// mark class silently falls back to the raw slug / neutral muted mark
// (deliberately never a crash), so the coverage gate alone would stay green —
// these tests pin the exact values instead.
//
// The mark encodes the beat/shape/fill factor system (see src/styles/global.css
// for the rationale): hue class = beat, mark-diamond = open-weight AI sub-beat,
// fill class = the source within its beat. The pins below therefore also guard
// the factor ASSIGNMENTS — fills are never reshuffled, so a drive-by
// "cleanup" reordering them would fail here.
//
// Plain-node spec: it imports only vitest, the module under test, and node:fs
// for the CSS cross-check. That makes src/lib/sources.ts
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
	it('maps eye-on-the-market to its registered display name and mark (#326)', () => {
		// The exact pair the reader sees — not toBeDefined. A slug typo would fall
		// back to { name: 'eye-on-the-market', mark: 'mark-solid' } and fail here.
		expect(sourceMeta('eye-on-the-market')).toEqual({
			name: 'Eye on the Market',
			mark: 'mark-beat-markets mark-solid',
		});
	});

	it('maps mistral to its registered display name and mark (#339)', () => {
		// Open-weight AI sub-beat: the diamond shape is part of the contract.
		expect(sourceMeta('mistral')).toEqual({
			name: 'Mistral',
			mark: 'mark-beat-ai mark-solid mark-diamond',
		});
	});

	it('maps openai to its registered display name and mark (#337)', () => {
		// Frontier AI: teal beat, default square, hollow fill.
		expect(sourceMeta('openai')).toEqual({
			name: 'OpenAI',
			mark: 'mark-beat-ai mark-hollow',
		});
	});

	it('maps owenomics to its registered display name and mark (#333)', () => {
		expect(sourceMeta('owenomics')).toEqual({
			name: 'Owenomics',
			mark: 'mark-beat-markets mark-hollow',
		});
	});

	it('maps open-models to its registered display name and mark (#340)', () => {
		// The AI beat's aggregate backstop: open-weight diamond + the hatch fill
		// that marks composite feeds.
		expect(sourceMeta('open-models')).toEqual({
			name: 'Open Models',
			mark: 'mark-beat-ai mark-hatch mark-diamond',
		});
	});

	it('maps deepseek to its registered display name and mark (#340)', () => {
		expect(sourceMeta('deepseek')).toEqual({
			name: 'DeepSeek',
			mark: 'mark-beat-ai mark-hollow mark-diamond',
		});
	});

	it('maps cursor to its registered display name and mark (#335)', () => {
		// Classified by what the feed carries: an AI *product* wire sits on the
		// platform beat, keeping the AI desk to the labs themselves.
		expect(sourceMeta('cursor')).toEqual({
			name: 'Cursor',
			mark: 'mark-beat-platform mark-dots',
		});
	});

	it('maps the silicon beat to its five arrival-order fills', () => {
		// One beat pinned wholesale: same hue, five distinct fills — the
		// within-beat channel that survives grayscale. Arrival order (never
		// reshuffled): AMD solid, Qualcomm hollow, Intel half, NVIDIA hatch,
		// TI dots.
		expect(sourceMeta('amd')).toEqual({ name: 'AMD', mark: 'mark-beat-silicon mark-solid' });
		expect(sourceMeta('qualcomm')).toEqual({
			name: 'Qualcomm',
			mark: 'mark-beat-silicon mark-hollow',
		});
		expect(sourceMeta('intel')).toEqual({ name: 'Intel', mark: 'mark-beat-silicon mark-half' });
		expect(sourceMeta('nvidia')).toEqual({
			name: 'NVIDIA',
			mark: 'mark-beat-silicon mark-hatch',
		});
		expect(sourceMeta('ti')).toEqual({
			name: 'Texas Instruments',
			mark: 'mark-beat-silicon mark-dots',
		});
	});

	it('maps other registered slugs to their exact display metadata', () => {
		// Per-slug pins (not exact-list equality) so sibling sources can land in
		// parallel without touching this test.
		expect(sourceMeta('cloudflare-blog')).toEqual({
			name: 'Cloudflare Blog',
			mark: 'mark-beat-platform mark-solid',
		});
		expect(sourceMeta('thinking-machines')).toEqual({
			name: 'Thinking Machines',
			mark: 'mark-beat-ai mark-half',
		});
		expect(sourceMeta('elonlit')).toEqual({
			name: 'Elon Litman',
			mark: 'mark-beat-voices mark-solid',
		});
	});

	it('falls back to the raw slug and the neutral mark for an unregistered source', () => {
		// The bare fill class with no beat class: .mark's base --mark-c is the
		// neutral muted, so the fallback renders a muted solid square.
		expect(sourceMeta('mystery-wire')).toEqual({ name: 'mystery-wire', mark: 'mark-solid' });
		// Boundary: the empty slug still takes the graceful fallback, never a throw.
		expect(sourceMeta('')).toEqual({ name: '', mark: 'mark-solid' });
	});

	it('every mark class in the registry has its rule (and beat token) in global.css', () => {
		// The `.mark-*` classes are hand-authored component CSS in global.css —
		// with a rule missing the class silently does nothing and the mark
		// renders as an empty box. Scan the registry's quoted mark literals,
		// split them into classes, and require each rule; beat classes must also
		// have their `--color-beat-*` hue token, so a new beat can't ship a hue
		// class without its color (self-maintaining — future sources are checked
		// automatically).
		const registrySource = repoFile('src/lib/sources.ts');
		const css = repoFile('src/styles/global.css');
		const literals = [...registrySource.matchAll(/'(mark-[a-z0-9 -]+)'/g)].map((m) => m[1]);
		const classes = [...new Set(literals.flatMap((l) => l.split(' ')))];
		// Sanity: the scan actually found the registry, including a beat class,
		// a fill class, and the shape class.
		expect(classes).toContain('mark-beat-markets');
		expect(classes).toContain('mark-solid');
		expect(classes).toContain('mark-diamond');
		for (const cls of classes) {
			expect(css).toContain(`.${cls} {`);
			if (cls.startsWith('mark-beat-')) {
				expect(css).toContain(`--color-beat-${cls.slice('mark-beat-'.length)}:`);
			}
		}
	});
});

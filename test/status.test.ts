import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { afterEach, describe, expect, it, vi } from 'vitest';

import Status from '../src/pages/status.astro';

const render = async () => {
	const container = await AstroContainer.create();
	return container.renderToString(Status);
};

// The page bakes its values in via `vite.define` at build; under the node
// project those `__DEPLOY_*__` tokens are never defined, so deploy.ts reads them
// off globalThis. Stub them to drive the "present" branch deterministically.
// The direct deployInfo() unit assertions live in test/deploy.test.ts (a
// plain-node spec, so deploy.ts is mutation-reachable); this spec keeps only the
// status.astro render coverage.
const stubDeploy = (sha: string, ref: string, time: string) => {
	vi.stubGlobal('__DEPLOY_SHA__', sha);
	vi.stubGlobal('__DEPLOY_REF__', ref);
	vi.stubGlobal('__DEPLOY_TIME__', time);
};

describe('status page', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('renders the deploy SHA, ref, time, commit link, and dashboard link', async () => {
		stubDeploy('0123456789abcdef0123456789abcdef01234567', 'main', '2026-06-13T14:05:00.000Z');
		const html = await render();

		// Short SHA shown, full SHA in the commit link + title.
		expect(html).toContain('0123456');
		expect(html).toContain(
			'href="https://github.com/couetilc/news/commit/0123456789abcdef0123456789abcdef01234567"',
		);
		expect(html).toContain('title="0123456789abcdef0123456789abcdef01234567"');
		// Ref row (the no-link / no-time branch).
		expect(html).toContain('main');
		// Deploy time: machine datetime + human label.
		expect(html).toContain('datetime="2026-06-13T14:05:00.000Z"');
		expect(html).toContain('Jun 13, 2026 14:05 UTC');
		// Observability deep-link with account id + worker name.
		expect(html).toContain('dbaa50e60c18b19d483578c42d9bb3ee');
		expect(html).toContain('/news/production/observability');
		// On-brand chrome.
		expect(html).toMatch(/>\s*Status\s*</);
		// Interactive-affordance obligations (#136): both the commit link and the
		// observability link carry a resting underline plus the ink focus-visible
		// ring, so they read as links without hover and are keyboard-focusable.
		expect(html).toMatch(
			/href="https:\/\/github.com\/couetilc\/news\/commit\/[^"]*"[^>]*class="[^"]*\bunderline\b[^"]*focus-visible:outline-ink/,
		);
		expect(html).toMatch(
			/href="[^"]*\/news\/production\/observability[^"]*"[^>]*class="[^"]*\bunderline\b[^"]*focus-visible:outline-ink/,
		);
	});

	it('degrades gracefully with the local-dev fallbacks', async () => {
		const html = await render();
		expect(html).toContain('dev');
		expect(html).toContain('local');
		expect(html).toContain('unknown');
	});
});

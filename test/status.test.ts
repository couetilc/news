import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deployInfo } from '../src/lib/deploy';

import Status from '../src/pages/status.astro';

const render = async () => {
	const container = await AstroContainer.create();
	return container.renderToString(Status);
};

// The page bakes its values in via `vite.define` at build; under the node
// project those `__DEPLOY_*__` tokens are never defined, so deploy.ts reads them
// off globalThis. Stub them to drive the "present" branch deterministically.
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
		expect(info.shortSha).toBe('0123456');
		expect(info.ref).toBe('main');
		expect(info.time).toBe('2026-06-13T14:05:00.000Z');
		// ISO time renders as a human UTC stamp.
		expect(info.timeLabel).toBe('Jun 13, 2026 14:05 UTC');
		// Commit link points at the GitHub commit for the full SHA.
		expect(info.commitUrl).toBe(
			'https://github.com/couetilc/news/commit/0123456789abcdef0123456789abcdef01234567',
		);
		// Observability link carries the account id + worker name.
		expect(info.observabilityUrl).toContain('dbaa50e60c18b19d483578c42d9bb3ee');
		expect(info.observabilityUrl).toContain('/news/production/observability');
	});

	it('falls back to local-dev values when the build tokens are absent', () => {
		// No stubs: the typeof guards yield the fallbacks.
		const info = deployInfo();
		expect(info.sha).toBe('dev');
		expect(info.shortSha).toBe('dev');
		expect(info.ref).toBe('local');
		expect(info.time).toBe('unknown');
		// 'unknown' isn't a parseable date, so the label is shown verbatim.
		expect(info.timeLabel).toBe('unknown');
		expect(info.commitUrl).toBe('https://github.com/couetilc/news/commit/dev');
	});
});

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
	});

	it('degrades gracefully with the local-dev fallbacks', async () => {
		const html = await render();
		expect(html).toContain('dev');
		expect(html).toContain('local');
		expect(html).toContain('unknown');
	});
});

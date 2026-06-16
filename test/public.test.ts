import { describe, expect, it, vi } from 'vitest';
import { GET } from '../src/pages/public';

// /public was the standalone read-only feed (issue #49); as of #87 the homepage
// `/` is session-adaptive and serves that same feed to anonymous visitors, so
// /public is now just a permanent (301) redirect to `/`. The read-only feed
// markup itself is covered by the anonymous branch in test/index.test.ts.
// Driven the way /logout's test drives it: call the exported handler with a stub
// `redirect`, no server boot.
describe('GET /public legacy route (#87)', () => {
	it('permanently redirects to the session-adaptive homepage', () => {
		const redirect = vi.fn(
			(path: string, status: number) =>
				new Response(null, { status, headers: { Location: path } }),
		);
		const res = GET({ redirect } as never);
		expect(redirect).toHaveBeenCalledWith('/', 301);
		expect(res.status).toBe(301);
		expect(res.headers.get('Location')).toBe('/');
	});
});

import { test, expect } from '@playwright/test';

// Browser/request-cycle e2e for the in-voice cross-site rejection (issue #95).
//
// Why this exists outside `npm test`: the styled 403 is produced by the full
// request path — src/middleware.ts catches the forbidden cross-site form POST
// (Astro's built-in checkOrigin is OFF, reimplemented there) and `rewrite`s to
// src/pages/403.astro, which renders through the real Layout and sets the 403
// status. vitest covers the middleware decision and the page render separately
// (test/middleware.test.ts, test/error-pages.test.ts); this pins them together
// against the running worker, confirming the reader gets the newspaper-voice
// page rather than Astro's bare plaintext "Cross-site POST form submissions are
// forbidden" default.
//
// A real same-origin browser form POST always carries a matching Origin, so we
// can't trip the guard through a normal page interaction — we forge the
// cross-site shape with request.post (a non-matching Origin / no Origin), which
// is exactly the attacker/originless case the guard defends against.

const BARE_DEFAULT = 'Cross-site POST form submissions are forbidden';
const FORM = { email: 'connor@couetil.com', password: 'correct-horse-battery' };

test.describe('cross-site POST rejection in a real browser', () => {
	test('a forged cross-origin signup POST renders the in-voice 403', async ({ request }) => {
		const res = await request.post('/signup', {
			headers: { origin: 'https://evil.example' },
			form: FORM,
		});

		expect(res.status()).toBe(403);
		const body = await res.text();
		// The newspaper-voice page, NOT Astro's bare plaintext default.
		expect(body).not.toContain(BARE_DEFAULT);
		expect(body).toContain('403 · Forbidden');
		expect(body).toContain('role="alert"');
		// Rendered inside the shared Layout (masthead chrome).
		expect(body).toContain('All the feeds fit to print');
		expect(body).toContain('<title>Forbidden · News</title>');
	});

	test('an originless POST is rejected the same way', async ({ request }) => {
		// No Origin header at all — Astro (and our reimplementation) treats a
		// bodyless/originless cross-site write as forbidden too.
		const res = await request.post('/signup', {
			headers: { origin: '' },
			form: FORM,
		});
		expect(res.status()).toBe(403);
		expect(await res.text()).toContain('403 · Forbidden');
	});

	test('a same-origin POST is NOT rejected (the real signup path is unaffected)', async ({
		request,
		baseURL,
	}) => {
		// Sanity pin: with the matching Origin the guard lets the request through to
		// the signup route — it does not 403. (We don't assert account creation here;
		// e2e/auth-signup.spec.ts owns the full first-signup flow.)
		const res = await request.post('/signup', {
			headers: { origin: baseURL ?? 'http://127.0.0.1:4321' },
			form: FORM,
			maxRedirects: 0,
		});
		expect(res.status()).not.toBe(403);
	});
});

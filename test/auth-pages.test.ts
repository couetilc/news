import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { login, signup } from '../src/lib/auth-actions';

// The credential logic is covered against real D1 in the workers project; here
// we only check the page wiring — GET renders the form, a successful POST sets
// the session and 303s to '/', a failed POST re-renders with the inline error
// and a 400. So we mock the actions and assert the HTTP shape. readCredentials
// is NOT mocked (it's pure) so the page's form parsing runs for real.
vi.mock('../src/lib/auth-actions', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../src/lib/auth-actions')>();
	return { ...actual, signup: vi.fn(), login: vi.fn() };
});

import Signup from '../src/pages/signup.astro';
import Login from '../src/pages/login.astro';

const post = (fields: Record<string, string>) => {
	const body = new URLSearchParams(fields);
	return new Request('http://news.test/', {
		method: 'POST',
		body,
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
	});
};

const render = (component: Parameters<AstroContainer['renderToResponse']>[0], request?: Request) =>
	AstroContainer.create().then((c) => c.renderToResponse(component, request ? { request } : {}));

beforeEach(() => {
	vi.mocked(signup).mockReset();
	vi.mocked(login).mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe('signup page', () => {
	it('GET renders the empty create-account form', async () => {
		const res = await render(Signup);
		const html = await res.text();
		expect(res.status).toBe(200);
		expect(html).toContain('Create account');
		expect(html).toContain('name="email"');
		expect(html).toContain('name="password"');
		// Cross-link to login.
		expect(html).toContain('href="/login"');
		expect(signup).not.toHaveBeenCalled();
	});

	it('submit + alt link carry the interactive-affordance + async hooks (#133/#96)', async () => {
		// Submit button (action-button idiom): cursor-pointer + focus-visible ring
		// (#133) plus the busy-label hooks for the disable-on-submit enhancement (#96
		// — the client script swap is e2e-tested; the markup hooks are pinned here).
		const html = await (await render(Signup)).text();
		expect(html).toContain('data-auth-submit');
		expect(html).toContain('data-busy-label="Creating account…"');
		expect(html).toContain('cursor-pointer');
		expect(html).toContain('focus-visible:outline-ink');
		// Alt link reconciled to the text-link idiom (#133): rests in ink-soft with a
		// hairline underline (accent is interaction-only now), with the focus ring.
		expect(html).toContain('text-ink-soft underline');
		expect(html).toContain('hover:text-accent');
		// The alt link no longer rests in the accent color (accent is hover/focus).
		expect(html).not.toContain('class="text-accent underline"');
	});

	it('successful POST stores the session and 303-redirects to the homepage', async () => {
		vi.mocked(signup).mockResolvedValue({ ok: true, userId: 7 });
		const res = await render(Signup, post({ email: 'a@b.co', password: 'long-enough-pw' }));
		expect(res.status).toBe(303);
		expect(res.headers.get('Location')).toBe('/');
		// The page normalized + forwarded the submitted credentials. The DB arg is
		// the `cloudflare:workers` env.NEWS_DB, which the node stub leaves undefined
		// (the real D1 path is covered in the workers project); we assert the
		// credential + pepper + timestamp + allowlist args the page is responsible
		// for. The allowlist resolves to its default (AUTH_ALLOWED_EMAILS unset in
		// the node env stub), so connor@couetil.com is the only allowed signup.
		expect(signup).toHaveBeenCalledWith(
			undefined,
			'a@b.co',
			'long-enough-pw',
			'',
			expect.any(Number),
			['connor@couetil.com'],
		);
	});

	it('failed POST re-renders the form with a 400 and the inline error + kept email', async () => {
		vi.mocked(signup).mockResolvedValue({ ok: false, error: 'That email is already registered.' });
		const res = await render(Signup, post({ email: 'taken@b.co', password: 'long-enough-pw' }));
		expect(res.status).toBe(400);
		const html = await res.text();
		expect(html).toContain('That email is already registered.');
		// The typed email is preserved in the field so the reader needn't retype.
		expect(html).toContain('value="taken@b.co"');
	});
});

describe('login page', () => {
	it('GET renders the empty sign-in form', async () => {
		const res = await render(Login);
		const html = await res.text();
		expect(res.status).toBe(200);
		expect(html).toContain('Sign in');
		expect(html).toContain('href="/signup"');
		// The login submit carries the present-tense busy label for the #96 swap.
		expect(html).toContain('data-busy-label="Signing in…"');
		expect(login).not.toHaveBeenCalled();
	});

	it('successful POST 303-redirects to the homepage', async () => {
		vi.mocked(login).mockResolvedValue({ ok: true, userId: 3 });
		const res = await render(Login, post({ email: 'a@b.co', password: 'the-password' }));
		expect(res.status).toBe(303);
		expect(res.headers.get('Location')).toBe('/');
		expect(login).toHaveBeenCalledWith(undefined, 'a@b.co', 'the-password', '');
	});

	it('failed POST re-renders with a 400 and the generic error', async () => {
		vi.mocked(login).mockResolvedValue({ ok: false, error: 'Incorrect email or password.' });
		const res = await render(Login, post({ email: 'a@b.co', password: 'wrong' }));
		expect(res.status).toBe(400);
		expect(await res.text()).toContain('Incorrect email or password.');
	});
});

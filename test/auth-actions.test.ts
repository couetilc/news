import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { login, readCredentials, signup } from '../src/lib/auth-actions';
import { getAllowedEmails } from '../src/lib/session';
import * as users from '../src/lib/users';

// signup()/login() now hash with argon2id (issue #125), which costs ~1.6s per
// hash in this workerd pool. Several tests here do 2-3 hashes back-to-back, so
// raise the per-test timeout for the whole file above vitest's 5s default. The
// pure-validation tests (empty fields, bad email) finish in milliseconds and are
// unaffected — the timeout is only a ceiling.
vi.setConfig({ testTimeout: 30_000 });

const db = env.NEWS_DB;
const PEPPER = 'test-pepper';
// Most signup tests use an open allowlist so they exercise the OTHER branches
// (format, length, duplicate, race) without tripping the allowlist gate; the
// gate itself has its own describe block below. Real callers pass
// getAllowedEmails(env); this mirrors that for the email each test uses.
const OPEN = ['new@example.com', 'ok@example.com', 'taken@example.com', 'race@example.com'];

beforeEach(async () => {
	await db.prepare('DELETE FROM users').run();
	vi.restoreAllMocks();
});

describe('readCredentials', () => {
	it('normalizes the email and coerces missing fields to empty strings', () => {
		const form = new FormData();
		form.set('email', '  Foo@Example.COM ');
		form.set('password', 'hunter2-long');
		expect(readCredentials(form)).toEqual({ email: 'foo@example.com', password: 'hunter2-long' });

		// Absent fields don't crash — they become ''.
		expect(readCredentials(new FormData())).toEqual({ email: '', password: '' });
	});
});

describe('signup', () => {
	it('creates an account and returns its user id', async () => {
		const result = await signup(db, 'new@example.com', 'a-good-password', PEPPER, 1000, OPEN);
		expect(result).toEqual({ ok: true, userId: expect.any(Number) });
	});

	it('rejects an invalid email without touching the DB', async () => {
		const result = await signup(db, 'not-an-email', 'a-good-password', PEPPER, 1000, OPEN);
		expect(result).toEqual({ ok: false, error: expect.stringContaining('valid email') });
	});

	it('rejects a too-short password', async () => {
		const result = await signup(db, 'ok@example.com', 'short', PEPPER, 1000, OPEN);
		expect(result).toEqual({ ok: false, error: expect.stringContaining('8 characters') });
	});

	it('rejects an email that is already registered (pre-insert check)', async () => {
		await signup(db, 'taken@example.com', 'a-good-password', PEPPER, 1000, OPEN);
		const again = await signup(db, 'taken@example.com', 'another-password', PEPPER, 2000, OPEN);
		expect(again).toEqual({ ok: false, error: expect.stringContaining('already registered') });
	});

	it('catches a UNIQUE violation that races past the pre-insert check', async () => {
		// The TOCTOU window: findUserByEmail saw nothing, but the row exists by the
		// time INSERT runs. We reproduce it deterministically by seeding the row,
		// then forcing the pre-insert SELECT to report "not found" so signup falls
		// through to createUser — whose INSERT then hits the real UNIQUE constraint
		// and throws, exercising signup's try/catch.
		await users.createUser(db, 'race@example.com', 'pbkdf2$1$x$y', 500);
		vi.spyOn(users, 'findUserByEmail').mockResolvedValueOnce(null);
		const result = await signup(db, 'race@example.com', 'a-good-password', PEPPER, 1000, OPEN);
		expect(result).toEqual({ ok: false, error: expect.stringContaining('already registered') });
	});
});

describe('signup allowlist (issue #76)', () => {
	// The membership test runs against the value the real route would pass:
	// getAllowedEmails(env), so these tests cover the default-vs-configured
	// resolution AND signup's enforcement of it end to end.
	it('allows an email on the default (unset) allowlist — connor only', async () => {
		const allowed = getAllowedEmails({}); // unset → ['connor@couetil.com']
		const result = await signup(db, 'connor@couetil.com', 'a-good-password', PEPPER, 1000, allowed);
		expect(result).toEqual({ ok: true, userId: expect.any(Number) });
	});

	it('rejects a non-allowlisted email under the default and creates NO user row', async () => {
		const allowed = getAllowedEmails({});
		const result = await signup(db, 'stranger@example.com', 'a-good-password', PEPPER, 1000, allowed);
		// Generic error — identical to a malformed email, so allowlist membership
		// (and even the allowlist's existence) never leaks.
		expect(result).toEqual({ ok: false, error: 'Enter a valid email address.' });
		// No row was inserted: the gate fires before any createUser call.
		expect(await users.findUserByEmail(db, 'stranger@example.com')).toBeNull();
	});

	it('honors a configured multi-email allowlist (comma-separated, normalized)', async () => {
		// Mixed case + whitespace in the var resolves to normalized members.
		const allowed = getAllowedEmails({ AUTH_ALLOWED_EMAILS: 'Connor@Couetil.com, Team@Example.com ' });
		expect(allowed).toEqual(['connor@couetil.com', 'team@example.com']);
		const ok = await signup(db, 'team@example.com', 'a-good-password', PEPPER, 1000, allowed);
		expect(ok).toEqual({ ok: true, userId: expect.any(Number) });
		const blocked = await signup(db, 'nope@example.com', 'a-good-password', PEPPER, 2000, allowed);
		expect(blocked).toEqual({ ok: false, error: 'Enter a valid email address.' });
		expect(await users.findUserByEmail(db, 'nope@example.com')).toBeNull();
	});
});

describe('login', () => {
	it('round trip: signup then login with the same credentials succeeds', async () => {
		const created = await signup(db, 'round@example.com', 'round-trip-pass', PEPPER, 1000, [
			'round@example.com',
		]);
		expect(created.ok).toBe(true);
		const result = await login(db, 'round@example.com', 'round-trip-pass', PEPPER);
		expect(result).toEqual({ ok: true, userId: created.ok ? created.userId : -1 });
	});

	it('rejects a wrong password with the generic error', async () => {
		await signup(db, 'user@example.com', 'the-right-password', PEPPER, 1000, ['user@example.com']);
		const result = await login(db, 'user@example.com', 'the-wrong-password', PEPPER);
		expect(result).toEqual({ ok: false, error: 'Incorrect email or password.' });
	});

	it('rejects an unknown email with the same generic error (no user enumeration)', async () => {
		const result = await login(db, 'nobody@example.com', 'whatever-pass', PEPPER);
		expect(result).toEqual({ ok: false, error: 'Incorrect email or password.' });
	});

	it('rejects an empty email or password before any DB/crypto work', async () => {
		expect(await login(db, '', 'x', PEPPER)).toEqual({
			ok: false,
			error: 'Incorrect email or password.',
		});
		expect(await login(db, 'a@b.co', '', PEPPER)).toEqual({
			ok: false,
			error: 'Incorrect email or password.',
		});
	});

	it('verifies under the configured pepper: a different pepper fails', async () => {
		await signup(db, 'pep@example.com', 'pepper-test-pass', PEPPER, 1000, ['pep@example.com']);
		expect((await login(db, 'pep@example.com', 'pepper-test-pass', PEPPER)).ok).toBe(true);
		expect((await login(db, 'pep@example.com', 'pepper-test-pass', 'other-pepper')).ok).toBe(false);
	});
});

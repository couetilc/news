import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { login, readCredentials, signup } from '../src/lib/auth-actions';
import * as users from '../src/lib/users';

const db = env.NEWS_DB;
const PEPPER = 'test-pepper';

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
		const result = await signup(db, 'new@example.com', 'a-good-password', PEPPER, 1000);
		expect(result).toEqual({ ok: true, userId: expect.any(Number) });
	});

	it('rejects an invalid email without touching the DB', async () => {
		const result = await signup(db, 'not-an-email', 'a-good-password', PEPPER, 1000);
		expect(result).toEqual({ ok: false, error: expect.stringContaining('valid email') });
	});

	it('rejects a too-short password', async () => {
		const result = await signup(db, 'ok@example.com', 'short', PEPPER, 1000);
		expect(result).toEqual({ ok: false, error: expect.stringContaining('8 characters') });
	});

	it('rejects an email that is already registered (pre-insert check)', async () => {
		await signup(db, 'taken@example.com', 'a-good-password', PEPPER, 1000);
		const again = await signup(db, 'taken@example.com', 'another-password', PEPPER, 2000);
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
		const result = await signup(db, 'race@example.com', 'a-good-password', PEPPER, 1000);
		expect(result).toEqual({ ok: false, error: expect.stringContaining('already registered') });
	});
});

describe('login', () => {
	it('round trip: signup then login with the same credentials succeeds', async () => {
		const created = await signup(db, 'round@example.com', 'round-trip-pass', PEPPER, 1000);
		expect(created.ok).toBe(true);
		const result = await login(db, 'round@example.com', 'round-trip-pass', PEPPER);
		expect(result).toEqual({ ok: true, userId: created.ok ? created.userId : -1 });
	});

	it('rejects a wrong password with the generic error', async () => {
		await signup(db, 'user@example.com', 'the-right-password', PEPPER, 1000);
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
		await signup(db, 'pep@example.com', 'pepper-test-pass', PEPPER, 1000);
		expect((await login(db, 'pep@example.com', 'pepper-test-pass', PEPPER)).ok).toBe(true);
		expect((await login(db, 'pep@example.com', 'pepper-test-pass', 'other-pepper')).ok).toBe(false);
	});
});

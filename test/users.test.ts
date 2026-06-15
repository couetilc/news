import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { createUser, findUserByEmail } from '../src/lib/users';

const db = env.NEWS_DB;

beforeEach(async () => {
	await db.prepare('DELETE FROM users').run();
});

describe('user DB queries', () => {
	it('creates a user and returns the inserted row', async () => {
		const user = await createUser(db, 'a@example.com', 'pbkdf2$1$x$y', 1000);
		expect(user.id).toEqual(expect.any(Number));
		expect(user.email).toBe('a@example.com');
		expect(user.password_hash).toBe('pbkdf2$1$x$y');
		expect(user.created_at).toBe(1000);
	});

	it('finds a user by email, and returns null for an unknown email', async () => {
		await createUser(db, 'found@example.com', 'h', 1000);
		const found = await findUserByEmail(db, 'found@example.com');
		expect(found?.email).toBe('found@example.com');
		expect(await findUserByEmail(db, 'missing@example.com')).toBeNull();
	});

	it('enforces the UNIQUE email constraint', async () => {
		await createUser(db, 'dupe@example.com', 'h1', 1000);
		await expect(createUser(db, 'dupe@example.com', 'h2', 2000)).rejects.toThrow();
	});
});

// The signup/login flows, factored out of the .astro pages so the credential
// logic (validation → hash/verify → D1 → session) is exercised in the workers
// vitest project against a real local D1, not only through page rendering. The
// pages stay thin: parse the form, call one of these, then either redirect on
// success or re-render with the returned error and a 400.
//
// Each action returns a discriminated result instead of throwing or redirecting,
// so the page decides the HTTP shape and the same logic is unit-testable.

import { createUser, findUserByEmail } from './users';
import { hashPassword, isValidEmail, isValidPassword, normalizeEmail, verifyPassword } from './auth';

export type AuthResult =
	| { ok: true; userId: number }
	| { ok: false; error: string };

// Read the standard email/password pair off a submitted form, with the email
// normalized. Missing fields become empty strings so validation (not a crash)
// rejects them.
export function readCredentials(form: FormData): { email: string; password: string } {
	return {
		email: normalizeEmail(String(form.get('email') ?? '')),
		password: String(form.get('password') ?? ''),
	};
}

// Create an account. Validates input, rejects an already-registered email, and
// stores only a salted PBKDF2 hash. The duplicate-email check is best-effort
// before the insert; the UNIQUE constraint is the real guard, so a race that
// slips past the SELECT still surfaces here as a "taken" error rather than a 500.
export async function signup(
	db: D1Database,
	email: string,
	password: string,
	pepper: string,
	now: number,
): Promise<AuthResult> {
	if (!isValidEmail(email)) return { ok: false, error: 'Enter a valid email address.' };
	if (!isValidPassword(password)) {
		return { ok: false, error: 'Password must be at least 8 characters.' };
	}
	if (await findUserByEmail(db, email)) {
		return { ok: false, error: 'That email is already registered.' };
	}
	const passwordHash = await hashPassword(password, pepper);
	try {
		const user = await createUser(db, email, passwordHash, now);
		return { ok: true, userId: user.id };
	} catch {
		// UNIQUE violation from a concurrent signup of the same email.
		return { ok: false, error: 'That email is already registered.' };
	}
}

// Authenticate. A missing account and a wrong password return the SAME generic
// error so the form never reveals which emails are registered. Validation here
// only guards against obviously empty submits; we still run verifyPassword on a
// found user regardless, and on the not-found path we skip it (timing-wise the
// generic message and 400 are identical either way).
export async function login(
	db: D1Database,
	email: string,
	password: string,
	pepper: string,
): Promise<AuthResult> {
	const invalid: AuthResult = { ok: false, error: 'Incorrect email or password.' };
	if (!email || !password) return invalid;
	const user = await findUserByEmail(db, email);
	if (!user) return invalid;
	if (!(await verifyPassword(password, user.password_hash, pepper))) return invalid;
	return { ok: true, userId: user.id };
}

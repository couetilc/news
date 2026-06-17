// Auth PURE CORE — validation + record parsing (issues #40, #125, #187, #228).
//
// This module is the functional core of auth: no Web Crypto, no I/O, all pure.
// It holds the shared input validators (email/password) AND the parser for the
// stored password-record envelope. The Web Crypto SHELL (PBKDF2 derivation, the
// constant-time compare, hashPassword/verifyPassword) lives in ./auth-crypto.ts.
// The split (#228) keeps this branchy, high-value logic plain-node-testable and
// in Stryker's mutation scope, while the slow 100k-iteration PBKDF2 stays out of
// it.
//
// STORAGE FORMAT is a single self-describing string, so the work factor can be
// raised later (new signups get the new count) without a migration, and any
// record ever written stays verifiable against the count it was created with:
//   • pbkdf2$<iterations>$<salt-b64>$<hash-b64>        (single-pass — what we write)
//   • pbkdf2$<perPass>x<passes>$<salt-b64>$<hash-b64>  (chained — still verified)
// The chained shape multiplies the effective work factor within the 100k
// per-call cap by feeding one pass's output into the next; we no longer WRITE it,
// but verification still accepts it so no record is ever stranded. This parser
// validates the envelope (field count, algorithm tag, cost field) and returns a
// descriptor; it does NOT base64-decode the salt/hash — `atob` can throw on a
// corrupt record, which is the shell's fail-closed concern (#178).

export const PBKDF2_TAG = 'pbkdf2';

// A validated PBKDF2 record envelope. `perPass`/`passes` are positive integers
// (single-pass records collapse to passes === 1); saltB64/hashB64 are still raw
// base64 text — decoding them is the shell's job (atob may throw on a corrupt
// row, which fails closed there).
export interface Pbkdf2Record {
	tag: typeof PBKDF2_TAG;
	perPass: number;
	passes: number;
	saltB64: string;
	hashB64: string;
}

// Parse the cost field of a PBKDF2 record. It is either a plain iteration count
// (single-pass) or "<perPass>x<passes>" (chained). Returns the validated
// per-pass / passes pair, or null for any malformed cost (non-numeric,
// non-integer, or non-positive on either side) rather than throwing.
function parseCost(costText: string): { perPass: number; passes: number } | null {
	let perPass: number;
	let passes: number;
	if (costText.includes('x')) {
		const [perPassText, passesText] = costText.split('x');
		perPass = Number(perPassText);
		passes = Number(passesText);
	} else {
		perPass = Number(costText);
		passes = 1;
	}
	if (!Number.isInteger(perPass) || perPass <= 0) return null;
	if (!Number.isInteger(passes) || passes <= 0) return null;
	return { perPass, passes };
}

// Parse a stored "pbkdf2$<cost>$<salt>$<hash>" record into a validated
// descriptor, or null for any malformed envelope (wrong field count, unknown
// algorithm tag, or a bad cost field). PURE and TOTAL: it never throws and never
// base64-decodes — the salt/hash come back as raw base64 text for the shell to
// decode (where `atob` may throw, handled fail-closed; #178). This is the
// branchy, high-value validation the mutation suite targets.
export function parsePbkdf2Record(stored: string): Pbkdf2Record | null {
	const parts = stored.split('$');
	if (parts.length !== 4) return null;
	const [tag, costText, saltB64, hashB64] = parts;
	if (tag !== PBKDF2_TAG) return null;
	const cost = parseCost(costText);
	if (cost === null) return null;
	return { tag: PBKDF2_TAG, perPass: cost.perPass, passes: cost.passes, saltB64, hashB64 };
}

// Input validation, shared by /signup and /login so the rules live in one place.
// Deliberately conservative: a single broad email shape (one @, no spaces, a dot
// in the domain) and an 8-char password floor. Email is normalized (trim +
// lowercase) so "A@x.com" and "a@x.com " are the same account.
export const MIN_PASSWORD_LENGTH = 8;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
	return EMAIL_RE.test(email);
}

export function isValidPassword(password: string): boolean {
	return password.length >= MIN_PASSWORD_LENGTH;
}

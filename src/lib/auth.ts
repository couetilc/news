// Password hashing for Cloudflare Workers (issue #40).
//
// Workers have no native bcrypt/argon2 — only Web Crypto (`crypto.subtle`) is
// available at runtime. We use PBKDF2-HMAC-SHA-256, the password KDF that Web
// Crypto exposes directly, with:
//   • a per-user 16-byte random salt (crypto.getRandomValues) so identical
//     passwords get distinct hashes and precomputed/rainbow tables don't apply;
//   • the maximum iteration count Cloudflare Workers permits — 100,000. Workers
//     HARD-CAPS PBKDF2 at 100k (workerd#1346); request more and crypto.subtle
//     fails with "iteration counts above 100000 are not supported", which hung
//     every production signup (local workerd does NOT enforce the cap, so the
//     hermetic suite passed while prod was broken — see test/auth.test.ts).
//     100k is below OWASP's 2023 SHA-256 guidance (600k), so the PEPPER below is
//     the compensating control for that platform-imposed gap;
//   • an optional server-side PEPPER (a Worker secret, not in the DB) mixed into
//     the input, so a stolen database alone can't be brute-forced offline.
//
// Verification is CONSTANT-TIME: we recompute the hash with the stored salt and
// iterations, then compare the raw derived-key bytes with a constant-time
// equality (no early return on first mismatch), so an attacker can't time their
// way to the digest. We compare the binary hash, not the base64 text.
//
// CHAINED PBKDF2 (issue #125): one 100k-iteration pass is below OWASP's 2023
// SHA-256 guidance (600k) and we cannot raise the per-call iteration count past
// the Workers cap. So we CHAIN passes: run PBKDF2 PASSES times, each a full
// 100k-iteration pass, feeding one pass's derived bits in as the next pass's
// password input. Every individual deriveBits call stays at 100k (within the
// cap), but the attacker must do PASSES × 100k PBKDF2 work to test a guess — the
// effective work factor is PASSES × 100,000. With PASSES = 6 that is 600,000,
// matching OWASP's 2023 PBKDF2-SHA256 target while never exceeding the cap on
// any single call. (A single pass costs ~tens of ms on workerd; six is still
// well within a request budget and only runs at signup/login.)
//
// Storage format is a single self-describing string. Two shapes, both "pbkdf2":
//   • NEW (chained):  pbkdf2$<perPass>x<passes>$<salt-b64>$<hash-b64>
//                     e.g. pbkdf2$100000x6$<salt>$<hash>
//   • OLD (1 pass):   pbkdf2$<iterations>$<salt-b64>$<hash-b64>
//                     e.g. pbkdf2$100000$<salt>$<hash>  (pre-#125 hashes)
// The per-pass count, pass count, and salt all travel with each digest, so the
// work factor can be raised again later (new signups get the new shape) WITHOUT
// a migration, and old single-pass hashes still verify against exactly the
// parameters they were created with. A bare integer in the iterations field is
// parsed as a 1-pass chain, so every legacy `pbkdf2$<iter>$...` record verifies
// unchanged.

const ALGORITHM = 'pbkdf2';
// Cloudflare Workers hard-cap PBKDF2 at 100k iterations PER deriveBits call
// (workerd#1346); every pass runs at exactly this count, never above.
const ITERATIONS_PER_PASS = 100_000;
// Number of chained passes for new hashes. 6 × 100k = 600,000 effective
// iterations, meeting OWASP 2023 PBKDF2-SHA256 guidance within the per-call cap.
const PASSES = 6;
const SALT_BYTES = 16;
const HASH_BITS = 256; // SHA-256 output width

const encoder = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
	const binary = atob(b64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

// One PBKDF2 pass: derive HASH_BITS from `input` bytes with the given salt and
// iteration count. `iterations` is always <= the Workers per-call cap; callers
// enforce that. This is the only place crypto.subtle.deriveBits is invoked.
async function derivePass(
	input: Uint8Array,
	salt: Uint8Array,
	iterations: number,
): Promise<Uint8Array> {
	const keyMaterial = await crypto.subtle.importKey(
		'raw',
		input as BufferSource,
		'PBKDF2',
		false,
		['deriveBits'],
	);
	const bits = await crypto.subtle.deriveBits(
		{ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
		keyMaterial,
		HASH_BITS,
	);
	return new Uint8Array(bits);
}

// Derive the final key by CHAINING `passes` PBKDF2 passes over (pepper +
// password), each pass running `iterationsPerPass` iterations against the SAME
// salt. The first pass hashes the UTF-8 (pepper + password) bytes; each later
// pass hashes the previous pass's raw derived bytes. Effective work factor is
// passes × iterationsPerPass while every individual deriveBits call stays at
// iterationsPerPass (<= the Workers cap). A single pass reproduces the legacy
// behavior exactly, so old hashes verify byte-for-byte. The pepper is prepended
// to the password; absent a configured pepper it's the empty string (still
// secure, just without the extra DB-theft mitigation).
async function derive(
	password: string,
	salt: Uint8Array,
	iterationsPerPass: number,
	passes: number,
	pepper: string,
): Promise<Uint8Array> {
	// Seed the chain with the UTF-8 (pepper + password) bytes, then fold each
	// pass's output back in as the next pass's input. `passes` is always >= 1
	// (hashPassword uses PASSES; verify rejects a 0/negative pass count), so the
	// loop always runs and `output` is always assigned.
	let input = encoder.encode(pepper + password);
	let output = input;
	for (let pass = 0; pass < passes; pass++) {
		output = await derivePass(input, salt, iterationsPerPass);
		input = output;
	}
	return output;
}

// Compare two byte arrays in constant time: always walks every byte and ORs the
// differences, so timing doesn't leak how many leading bytes matched. Unequal
// lengths short-circuit to false (length isn't secret).
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
	return diff === 0;
}

// Parse the iterations field of a stored record into { iterationsPerPass, passes }.
// Accepts two shapes and returns null for anything malformed (so verify can
// reject without throwing):
//   • "<perPass>x<passes>"  — new chained format, e.g. "100000x6"
//   • "<iterations>"        — legacy single-pass format, e.g. "100000" → 1 pass
// Both numbers must be positive integers. The per-pass count is NOT bounded
// here against the Workers cap on verify: we must faithfully recompute whatever
// a legacy record stored. New hashes are produced at the capped value below.
function parseWorkFactor(
	field: string,
): { iterationsPerPass: number; passes: number } | null {
	const [perPassText, passesText, ...rest] = field.split('x');
	if (rest.length > 0) return null; // more than one "x" → malformed
	const iterationsPerPass = Number(perPassText);
	if (!Number.isInteger(iterationsPerPass) || iterationsPerPass <= 0) return null;
	// No "x" → legacy single-pass record.
	if (passesText === undefined) return { iterationsPerPass, passes: 1 };
	const passes = Number(passesText);
	if (!Number.isInteger(passes) || passes <= 0) return null;
	return { iterationsPerPass, passes };
}

// Hash a password for storage. Generates a fresh random salt each call and uses
// the chained scheme (PASSES × ITERATIONS_PER_PASS), recording both in the
// self-describing "<perPass>x<passes>" iterations field.
export async function hashPassword(password: string, pepper = ''): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
	const hash = await derive(password, salt, ITERATIONS_PER_PASS, PASSES, pepper);
	const workFactor = `${ITERATIONS_PER_PASS}x${PASSES}`;
	return `${ALGORITHM}$${workFactor}$${toBase64(salt)}$${toBase64(hash)}`;
}

// Verify a candidate password against a stored record. Handles BOTH the legacy
// single-pass "pbkdf2$<iter>$salt$hash" and the new chained
// "pbkdf2$<perPass>x<passes>$salt$hash" shapes — the work factor is read from
// the record itself, so old and new hashes both verify against exactly the
// parameters they were created with. Returns false for any malformed record
// rather than throwing, so a corrupt row can't crash login. Recomputes with the
// record's own salt/work-factor and does a constant-time compare of the raw
// hash bytes.
export async function verifyPassword(
	password: string,
	stored: string,
	pepper = '',
): Promise<boolean> {
	const parts = stored.split('$');
	if (parts.length !== 4) return false;
	const [algorithm, workFactorText, saltB64, hashB64] = parts;
	if (algorithm !== ALGORITHM) return false;
	const workFactor = parseWorkFactor(workFactorText);
	if (workFactor === null) return false;
	const salt = fromBase64(saltB64);
	const expected = fromBase64(hashB64);
	const actual = await derive(
		password,
		salt,
		workFactor.iterationsPerPass,
		workFactor.passes,
		pepper,
	);
	return timingSafeEqual(actual, expected);
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

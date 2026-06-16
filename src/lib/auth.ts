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
// Storage format is a single self-describing string:
//   pbkdf2$<iterations>$<salt-b64>$<hash-b64>
// The iteration count and salt travel with each digest, so the work factor can
// be raised later (new signups get the new count) without a migration, and old
// hashes still verify against the count they were created with.

const ALGORITHM = 'pbkdf2';
const ITERATIONS = 100_000; // Cloudflare Workers hard cap (workerd#1346) — see header
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

// Run PBKDF2 over (pepper + password) with the given salt/iterations, returning
// the raw derived-key bytes. The pepper is prepended to the password before
// derivation; absent a configured pepper it's the empty string (still secure,
// just without the extra DB-theft mitigation).
async function derive(
	password: string,
	salt: Uint8Array,
	iterations: number,
	pepper: string,
): Promise<Uint8Array> {
	const keyMaterial = await crypto.subtle.importKey(
		'raw',
		encoder.encode(pepper + password),
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

// Compare two byte arrays in constant time: always walks every byte and ORs the
// differences, so timing doesn't leak how many leading bytes matched. Unequal
// lengths short-circuit to false (length isn't secret).
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
	return diff === 0;
}

// Hash a password for storage. Generates a fresh random salt each call.
export async function hashPassword(password: string, pepper = ''): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
	const hash = await derive(password, salt, ITERATIONS, pepper);
	return `${ALGORITHM}$${ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

// Verify a candidate password against a stored "pbkdf2$iter$salt$hash" record.
// Returns false for any malformed record rather than throwing, so a corrupt row
// can't crash login. Recomputes with the record's own salt/iterations and does a
// constant-time compare of the raw hash bytes.
export async function verifyPassword(
	password: string,
	stored: string,
	pepper = '',
): Promise<boolean> {
	const parts = stored.split('$');
	if (parts.length !== 4) return false;
	const [algorithm, iterationsText, saltB64, hashB64] = parts;
	if (algorithm !== ALGORITHM) return false;
	const iterations = Number(iterationsText);
	if (!Number.isInteger(iterations) || iterations <= 0) return false;
	const salt = fromBase64(saltB64);
	const expected = fromBase64(hashB64);
	const actual = await derive(password, salt, iterations, pepper);
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

// Password hashing for Cloudflare Workers (issues #40, #125, #187).
//
// PBKDF2-HMAC-SHA-256 via Web Crypto, with a per-user random salt and an
// optional server-side PEPPER. This is the platform-appropriate KDF for
// workerd, and the choice is forced by hard runtime limits, not preference:
//   • Web Crypto exposes no bcrypt/argon2, only PBKDF2.
//   • A WASM argon2 (hash-wasm) is permanently blocked — workerd forbids runtime
//     `WebAssembly.compile()` (#160).
//   • A PURE-JS argon2id (`@noble/hashes`, #171) *runs*, but at OWASP-grade
//     params (m=19 MiB, t=3) it costs ~1.6s of CPU and **exceeded the production
//     Worker's CPU limit** — every prod signup 1102'd ("Worker exceeded resource
//     limits"). The local vitest workerd pool does NOT enforce that limit, so the
//     smoke test passed while prod broke — the same blind spot that hid the #123
//     iteration-cap hang. Native PBKDF2 is the only KDF that is both available
//     and affordable here (#187 reverted #171).
//
// WORK FACTOR: 100,000 iterations — the maximum a single `deriveBits` call
// permits on Workers (workerd HARD-CAPS PBKDF2 at 100k; #123). That's below
// OWASP's 2023 PBKDF2-SHA256 guidance (600k), so the PEPPER is the compensating
// control: a server-side secret (`AUTH_PEPPER`, a Worker secret, never in the DB)
// prepended to the password before derivation, so a stolen database ALONE can't
// be brute-forced offline at any iteration count. It is REQUIRED in production:
// getPepper (src/lib/session.ts) fails signup/login closed when AUTH_PEPPER is
// absent or empty (#189), so a prod deploy can't silently run unpeppered; only
// dev/test may use an empty pepper. This is exactly #125's design.
//
// VERIFY is CONSTANT-TIME: recompute the digest with the record's own salt and
// iteration count, then compare the raw bytes with a constant-time equality (no
// early return on first mismatch). We compare the binary hash, not base64 text.
//
// Storage format is a single self-describing string, so the work factor can be
// raised later (new signups get the new count) without a migration, and any
// record ever written stays verifiable against the count it was created with:
//   • pbkdf2$<iterations>$<salt-b64>$<hash-b64>        (single-pass — what we write)
//   • pbkdf2$<perPass>x<passes>$<salt-b64>$<hash-b64>  (chained — still verified)
// The chained shape multiplies the effective work factor within the 100k
// per-call cap by feeding one pass's output into the next; we no longer WRITE it,
// but verification still accepts it so no record is ever stranded.

const PBKDF2_TAG = 'pbkdf2';
const PBKDF2_ITERATIONS = 100_000; // Cloudflare Workers hard cap (workerd#1346)
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

// Run PBKDF2 over the given input for ONE pass at `iterations` (≤ the 100k cap).
async function pbkdf2Pass(
	input: Uint8Array,
	salt: Uint8Array,
	iterations: number,
): Promise<Uint8Array> {
	const keyMaterial = await crypto.subtle.importKey('raw', input as BufferSource, 'PBKDF2', false, [
		'deriveBits',
	]);
	const bits = await crypto.subtle.deriveBits(
		{ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
		keyMaterial,
		HASH_BITS,
	);
	return new Uint8Array(bits);
}

// PBKDF2 derivation over (pepper + password), supporting BOTH record shapes:
//   • single-pass:  one deriveBits call at `perPass` iterations (passes === 1);
//   • chained:      `passes` deriveBits calls of `perPass` iterations each,
//                   feeding one pass's output as the next pass's key material, to
//                   multiply the effective work factor within the 100k cap.
// `passes === 1` collapses to the single-pass case, so the same code derives
// what we write today and verifies the chained legacy shape. Returns the raw
// derived-key bytes. The pepper is prepended to the password before derivation.
async function derivePbkdf2(
	password: string,
	salt: Uint8Array,
	perPass: number,
	passes: number,
	pepper: string,
): Promise<Uint8Array> {
	let input = encoder.encode(pepper + password);
	let out = input;
	for (let i = 0; i < passes; i++) {
		out = await pbkdf2Pass(input, salt, perPass);
		input = out;
	}
	return out;
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

// Hash a password for storage. Generates a fresh random salt each call and
// records the iteration count in the envelope so it can be raised later without
// a migration. Single-pass PBKDF2 at the 100k cap; the pepper is the compensating
// control for the sub-OWASP count (see header).
export async function hashPassword(password: string, pepper = ''): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
	const hash = await derivePbkdf2(password, salt, PBKDF2_ITERATIONS, 1, pepper);
	return `${PBKDF2_TAG}$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

// Verify a candidate password against a stored PBKDF2 record. The cost field is
// either a plain iteration count (single-pass) or "<perPass>x<passes>" (chained).
// Returns false for malformed cost fields rather than throwing.
async function verifyPbkdf2(
	password: string,
	costText: string,
	saltB64: string,
	hashB64: string,
	pepper: string,
): Promise<boolean> {
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
	if (!Number.isInteger(perPass) || perPass <= 0) return false;
	if (!Number.isInteger(passes) || passes <= 0) return false;
	const salt = fromBase64(saltB64);
	const expected = fromBase64(hashB64);
	const actual = await derivePbkdf2(password, salt, perPass, passes, pepper);
	return timingSafeEqual(actual, expected);
}

// Verify a candidate password against a stored "pbkdf2$<cost>$<salt>$<hash>"
// record. Returns false for any malformed record (wrong field count, unknown
// tag, bad cost) rather than throwing.
//
// FAIL CLOSED (#178): even past the explicit field checks the verify path can
// THROW on a corrupt record — `atob()` raises on invalid base64. A stored record
// is never the candidate password, so any such throw means a malformed row, not a
// caller bug: catch it and report verification failure, so one corrupt row can't
// 500 a login instead of returning the generic invalid-credentials result.
export async function verifyPassword(
	password: string,
	stored: string,
	pepper = '',
): Promise<boolean> {
	const parts = stored.split('$');
	if (parts.length !== 4) return false;
	const [tag, costText, saltB64, hashB64] = parts;
	try {
		if (tag === PBKDF2_TAG) {
			return await verifyPbkdf2(password, costText, saltB64, hashB64, pepper);
		}
	} catch {
		return false;
	}
	return false;
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

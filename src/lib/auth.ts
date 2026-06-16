// Password hashing for Cloudflare Workers (issues #40, #125).
//
// NEW HASHES USE ARGON2ID — OWASP's #1 password KDF (memory-hard, GPU/ASIC-
// resistant), via `@noble/hashes` (MIT, cure53-audited, zero transitive deps,
// PURE JS). "Don't roll your own crypto": the derivation is the audited
// primitive; only the storage envelope and the constant-time verify are ours.
//
// Why a library, and why this one: Workers expose only Web Crypto at runtime,
// which has no bcrypt/argon2 and HARD-CAPS PBKDF2 at 100,000 iterations
// (workerd#1346) — below OWASP's 2023 PBKDF2-SHA256 guidance (600k) and, more
// importantly, not memory-hard. A WASM argon2 (hash-wasm) was tried and
// REJECTED: it calls `WebAssembly.compile()` at runtime, which workerd
// permanently forbids (#160). `@noble/hashes` is pure JS — no dynamic
// WASM/eval — so argon2id runs in workerd unmodified (proven in the `workers`
// vitest pool: test/noble-workerd-smoke.test.ts).
//
// PARAMS (OWASP-aligned, within the Worker ~128MB/CPU budget; single-user, so
// generous):
//   • memory m = 19456 KiB (19 MiB) — OWASP's second argon2id option;
//   • iterations t = 3;
//   • parallelism p = 1 (lanes; Workers are single-threaded anyway);
//   • output 32 bytes; per-hash 16-byte random salt.
// One hash costs ~1.6s in the local workerd vitest pool — acceptable login
// latency for a single-user tool. These params travel IN the stored record
// (self-describing), so they can be raised later for new signups without a
// migration — old hashes still verify against the params they were created with.
//
// PEPPER: an optional server-side secret (a Worker secret, never in the DB —
// `AUTH_PEPPER`) is prepended to the password before derivation, so a stolen
// database alone can't be brute-forced offline. Absent a configured pepper it's
// the empty string. Mixing is identical to the previous PBKDF2 scheme, so the
// pepper semantics are unchanged across the migration.
//
// VERIFY is CONSTANT-TIME: recompute the digest with the record's own salt and
// params, then compare the raw bytes with a constant-time equality (no early
// return on first mismatch). We compare the binary hash, not the base64 text.
//
// BACK-COMPAT: verification is dispatched on the record's leading tag, so legacy
// PBKDF2 records keep verifying byte-for-byte (no migration):
//   • argon2id$m=<KiB>,t=<iters>,p=<lanes>$<salt-b64>$<hash-b64>  (new)
//   • pbkdf2$<iterations>$<salt-b64>$<hash-b64>                   (legacy, single-pass)
//   • pbkdf2$<perPass>x<passes>$<salt-b64>$<hash-b64>             (legacy, chained)
// The users table is currently empty, but the self-describing contract is
// preserved so any record ever written stays verifiable.

import { argon2id } from '@noble/hashes/argon2.js';

const ARGON2ID_TAG = 'argon2id';
const PBKDF2_TAG = 'pbkdf2';

// Argon2id parameters for NEW hashes — see header.
const ARGON2_MEMORY_KIB = 19456; // 19 MiB
const ARGON2_ITERATIONS = 3;
const ARGON2_PARALLELISM = 1;
const ARGON2_HASH_BYTES = 32;

const SALT_BYTES = 16;
const PBKDF2_HASH_BITS = 256; // SHA-256 output width, for legacy verification

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

// Compute the argon2id digest of (pepper + password) with the given salt and
// cost params, returning the raw derived-key bytes. The pepper is prepended to
// the password exactly as the legacy PBKDF2 path did, so the pepper semantics
// carry over unchanged.
function deriveArgon2id(
	password: string,
	salt: Uint8Array,
	memoryKib: number,
	iterations: number,
	parallelism: number,
	hashBytes: number,
	pepper: string,
): Uint8Array {
	return argon2id(encoder.encode(pepper + password), salt, {
		m: memoryKib,
		t: iterations,
		p: parallelism,
		dkLen: hashBytes,
	});
}

// Run PBKDF2 over the given input for ONE pass — the legacy single-pass
// primitive, kept only to verify pre-argon2id records.
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
		PBKDF2_HASH_BITS,
	);
	return new Uint8Array(bits);
}

// Legacy PBKDF2 derivation, supporting BOTH historical record shapes:
//   • single-pass:  one deriveBits call at `perPass` iterations (passes === 1);
//   • chained:      `passes` deriveBits calls of `perPass` iterations each,
//                   feeding one pass's output as the next pass's key material,
//                   to multiply the effective work factor within the 100k cap.
// `passes === 1` collapses to the single-pass case, so the same code verifies
// both. Returns the raw derived-key bytes.
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

// Hash a password for storage with argon2id. Generates a fresh random salt each
// call and records the cost params in the envelope so they can be raised later
// without a migration.
export async function hashPassword(password: string, pepper = ''): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
	const hash = deriveArgon2id(
		password,
		salt,
		ARGON2_MEMORY_KIB,
		ARGON2_ITERATIONS,
		ARGON2_PARALLELISM,
		ARGON2_HASH_BYTES,
		pepper,
	);
	const params = `m=${ARGON2_MEMORY_KIB},t=${ARGON2_ITERATIONS},p=${ARGON2_PARALLELISM}`;
	return `${ARGON2ID_TAG}$${params}$${toBase64(salt)}$${toBase64(hash)}`;
}

// Verify a candidate password against an argon2id record:
//   argon2id$m=<KiB>,t=<iters>,p=<lanes>$<salt-b64>$<hash-b64>
// Returns false for any malformed record rather than throwing. Recomputes with
// the record's own salt + params, then constant-time-compares the raw bytes.
async function verifyArgon2id(
	password: string,
	paramText: string,
	saltB64: string,
	hashB64: string,
	pepper: string,
): Promise<boolean> {
	const params: Record<string, number> = {};
	for (const pair of paramText.split(',')) {
		const [key, value] = pair.split('=');
		const n = Number(value);
		if (!key || value === undefined || !Number.isInteger(n) || n <= 0) return false;
		params[key] = n;
	}
	const { m, t, p } = params;
	if (m === undefined || t === undefined || p === undefined) return false;
	const salt = fromBase64(saltB64);
	const expected = fromBase64(hashB64);
	const actual = deriveArgon2id(password, salt, m, t, p, expected.length, pepper);
	return timingSafeEqual(actual, expected);
}

// Verify a candidate password against a legacy PBKDF2 record. The cost field is
// either a plain iteration count (single-pass) or "<perPass>x<passes>" (chained
// PBKDF2). Returns false for malformed cost fields rather than throwing.
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

// Verify a candidate password against a stored record. The record is self-
// describing: the leading tag selects the scheme (argon2id for new hashes,
// pbkdf2 for legacy single-pass and chained records), so old and new hashes
// coexist with no migration. Returns false for any malformed record (wrong
// field count, unknown tag, bad params) rather than throwing, so a corrupt row
// can't crash login.
//
// FAIL CLOSED: the scheme helpers can still THROW on a corrupt record even past
// their explicit field checks — `atob()` raises on invalid base64, and argon2id()
// raises on positive-but-out-of-range params (e.g. m=1, below 8*p) or on an
// invalid dkLen driven by an empty/too-short decoded hash. A stored record is
// never the candidate password, so any such throw means a malformed row, not a
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
		if (tag === ARGON2ID_TAG) {
			return await verifyArgon2id(password, costText, saltB64, hashB64, pepper);
		}
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

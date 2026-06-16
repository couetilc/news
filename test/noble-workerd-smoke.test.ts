import { describe, expect, it } from 'vitest';
import { argon2id } from '@noble/hashes/argon2.js';

// Step 1 of #125's redo: PROVE @noble/hashes argon2id runs inside workerd.
//
// This file runs in the `workers` vitest pool (@cloudflare/vitest-pool-workers),
// i.e. inside real workerd — the same runtime as production. The prior pick,
// hash-wasm, FAILED here at WASM init because it calls WebAssembly.compile() at
// runtime, which workerd permanently forbids (CompileError: "Wasm code
// generation disallowed by embedder"; see #160). @noble/hashes is pure JS with
// no dynamic WASM/eval, so it should clear the bar — this test is the proof, not
// an assumption. If it ever red-fails at import/init, the dep is unusable in the
// Worker and the KDF work must stop.
describe('@noble/hashes argon2id runs in workerd', () => {
	it('computes and verifies an argon2id hash inside the worker pool', () => {
		const salt = crypto.getRandomValues(new Uint8Array(16));
		const opts = { t: 3, m: 19456, p: 1, dkLen: 32 } as const;

		const hash = argon2id('correct horse battery', salt, opts);
		expect(hash).toBeInstanceOf(Uint8Array);
		expect(hash.length).toBe(32);

		// Recompute with the same salt+params: argon2id is deterministic, so a
		// "verify" is just recomputation + comparison. This exercises the exact
		// shape our auth verify path relies on.
		const again = argon2id('correct horse battery', salt, opts);
		expect(Array.from(again)).toEqual(Array.from(hash));

		// A different password yields a different digest.
		const other = argon2id('wrong password', salt, opts);
		expect(Array.from(other)).not.toEqual(Array.from(hash));
		// Three argon2id calls at m=19456,t=3 cost a few seconds in workerd
		// (~1.6s each), so this test gets a generous timeout — see the auth suite.
	}, 30_000);
});

import { existsSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// e2e bootstrap (issue #257): guarantee the preview server has an AUTH_PEPPER.
//
// The suite now serves a BUILT worker via `astro preview` instead of `astro dev`
// (the dev server recompiled per request, the source of the run-to-run flake).
// But `astro preview` runs the *production* build (`import.meta.env.PROD === true`),
// and src/lib/session.ts `getPepper` FAILS CLOSED in production when AUTH_PEPPER is
// empty (#189) — so without a pepper every signup/login 500s and the whole suite
// fails. `astro dev` (PROD === false) sidestepped that, which is why dev "worked"
// without the secret.
//
// The Cloudflare adapter feeds Worker runtime vars to `astro preview` from
// `.dev.vars` (gitignored — absent in CI and in fresh container clones). So before
// the preview server starts we ensure `.dev.vars` defines AUTH_PEPPER:
//   • If `.dev.vars` is missing → write one with a throwaway test pepper.
//   • If it exists but has no AUTH_PEPPER line → append the test pepper.
//   • If it already sets AUTH_PEPPER → leave it untouched (respect a developer's
//     real local secret; never overwrite it).
// The value is a non-secret, test-only pepper: this DB is the local D1 the suite
// resets every run, never production. (The cookie the production build marks
// `Secure` is still accepted by Chromium over http://127.0.0.1 — localhost is a
// trustworthy origin — so no HTTPS is needed.)
const DEV_VARS = fileURLToPath(new URL('../.dev.vars', import.meta.url));
const TEST_PEPPER_LINE = 'AUTH_PEPPER=e2e-local-test-pepper';

if (!existsSync(DEV_VARS)) {
	writeFileSync(DEV_VARS, `${TEST_PEPPER_LINE}\n`);
	console.log('[e2e] wrote .dev.vars with a test AUTH_PEPPER for astro preview.');
} else {
	const current = readFileSync(DEV_VARS, 'utf8');
	// Match an AUTH_PEPPER assignment at the start of any line (ignoring leading
	// whitespace), so an existing real pepper is detected and preserved.
	if (/^\s*AUTH_PEPPER\s*=/m.test(current)) {
		console.log('[e2e] .dev.vars already sets AUTH_PEPPER — leaving it untouched.');
	} else {
		const prefix = current.length > 0 && !current.endsWith('\n') ? '\n' : '';
		appendFileSync(DEV_VARS, `${prefix}${TEST_PEPPER_LINE}\n`);
		console.log('[e2e] appended a test AUTH_PEPPER to existing .dev.vars for astro preview.');
	}
}

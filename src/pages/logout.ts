import type { APIRoute } from 'astro';

// Sign out (issue #40). A plain form POST → 303 redirect, mirroring
// /api/read so it works with JavaScript off: destroy() clears the session data
// and its cookie, then we send the reader to /login. POST-only (not GET) so a
// prefetch or a stray link can't log someone out. /logout is on the middleware
// public allowlist so it still works even after the session has lapsed.
export const POST: APIRoute = ({ session, redirect }) => {
	session?.destroy();
	return redirect('/login', 303);
};

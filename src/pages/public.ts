import type { APIRoute } from 'astro';

// /public was the standalone read-only feed (issue #49). As of #87 the homepage
// `/` is session-adaptive — it serves that same read-only feed to anonymous
// visitors — so /public is redundant. Keep it as a permanent (301) redirect to
// `/` rather than deleting it, so any external link or bookmark to /public still
// lands on the canonical public surface. It's still allowlisted in the
// middleware so the redirect is reachable while logged out; the read-only feed
// markup now lives only in src/pages/index.astro's anonymous branch.
//
// Modeled on /logout (a .ts route, not a redirect-only .astro page): doing the
// redirect from an exported handler keeps istanbul's coverage of the single
// statement deterministic, where a frontmatter-only .astro redirect reads as a
// half-covered file under the Container API.
export const GET: APIRoute = ({ redirect }) => redirect('/', 301);

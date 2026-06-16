import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { setItemRead } from '../../ingest/db';
import { log } from '../../lib/log';
import { safeReturnPath } from '../../lib/return-path';

// Toggle an item's read state from the digest's per-item button, then 303 back
// to the feed. This is a plain form POST + redirect (no JS): the newspaper has
// to work with scripting off, so the read/unread control is a real submit.
// The hidden `read` field carries the desired next state, computed from what
// the row currently shows — '1' to mark read, anything else to mark unread.
//
// The hidden `return` field carries the view the toggle was fired from (the
// active ?source filter + ?unread/?read cursors), so flipping an item lands the
// reader back on the SAME page instead of the unfiltered first page (#80). It's
// client-supplied, so safeReturnPath validates it (same-origin app-relative
// path, known params only) before it becomes the Location — never trusted raw.
export const POST: APIRoute = async ({ request, redirect, locals }) => {
	const form = await request.formData();
	const id = Number(form.get('id'));
	const readAt = form.get('read') === '1' ? Math.floor(Date.now() / 1000) : null;
	const target = safeReturnPath(form.get('return'));
	// Read state is per-user (issue #70): scope the write to the session user the
	// middleware put on locals, so a toggle only ever mutates the current user's
	// row. The auth guard gates this route, so locals.userId is set for every
	// request that gets here; `?? 0` is a typed fallback that can't match a real
	// user, never reached in practice.
	const userId = locals.userId ?? 0;
	// Reject a missing/non-integer id before touching the DB (#140). Real item
	// ids are positive INTEGER PRIMARY KEYs; a forged or stale POST carrying junk
	// (empty, NaN, a float, a negative) has nothing legitimate to toggle, so it's
	// a no-op that just redirects back — never a write. setItemRead also sources
	// its mark-read INSERT from `items WHERE id = ?` as a second guard, so even a
	// well-formed id for a nonexistent item inserts no orphan row.
	if (!Number.isInteger(id) || id <= 0) {
		log.info('read.reject', { userId, read: readAt !== null });
		return redirect(target, 303);
	}
	await setItemRead(env.NEWS_DB, userId, id, readAt);
	// The only request-path mutation worth a log line; page views are too
	// high-volume to log per-hit (see the cloudflare-observability skill).
	log.info('read.toggle', { userId, id, read: readAt !== null });
	return redirect(target, 303);
};

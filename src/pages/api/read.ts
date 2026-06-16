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
export const POST: APIRoute = async ({ request, redirect }) => {
	const form = await request.formData();
	const id = Number(form.get('id'));
	const readAt = form.get('read') === '1' ? Math.floor(Date.now() / 1000) : null;
	await setItemRead(env.NEWS_DB, id, readAt);
	// The only request-path mutation worth a log line; page views are too
	// high-volume to log per-hit (see the cloudflare-observability skill).
	log.info('read.toggle', { id, read: readAt !== null });
	return redirect(safeReturnPath(form.get('return')), 303);
};

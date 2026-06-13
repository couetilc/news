import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { setItemRead } from '../../ingest/db';

// Toggle an item's read state from the digest's per-item button, then 303 back
// to the feed. This is a plain form POST + redirect (no JS): the newspaper has
// to work with scripting off, so the read/unread control is a real submit.
// The hidden `read` field carries the desired next state, computed from what
// the row currently shows — '1' to mark read, anything else to mark unread.
export const POST: APIRoute = async ({ request, redirect }) => {
	const form = await request.formData();
	const id = Number(form.get('id'));
	const readAt = form.get('read') === '1' ? Math.floor(Date.now() / 1000) : null;
	await setItemRead(env.NEWS_DB, id, readAt);
	return redirect('/', 303);
};

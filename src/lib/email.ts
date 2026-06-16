// Transactional email via Resend (issue #88).
//
// Magic-link login and future notifications need to *send* mail from our
// verified domain. We POST to the Resend HTTP API
// (https://api.resend.com/emails) with the API key as a Bearer token. No SDK:
// workerd has `fetch` natively, the request is a single JSON POST, and staying
// dependency-free keeps the 100%-coverage / no-network test rules cheap.
//
// `fetch` is INJECTED (defaulting to the global) — mirroring src/ingest/run.ts's
// `fetchFn` — so the unit test mocks the network and `npm test` never sends a
// real email. The Resend API key is a Worker RUNTIME SECRET (`RESEND_API_KEY`
// in `.dev.vars` locally, `wrangler secret put RESEND_API_KEY` in production) —
// never in `.env`; it's passed in here rather than read off `import.meta.env` so
// the helper stays a pure function of its inputs.

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export interface SendEmailParams {
	// Recipient address. Resend also accepts an array; a single string covers the
	// single-user transactional case and keeps the contract small.
	to: string;
	subject: string;
	// Both bodies are supplied: `text` is the plain-text fallback and `html` the
	// rich version. Clients pick whichever they render.
	text: string;
	html: string;
}

export interface SendEmailDeps {
	apiKey: string;
	// The verified "From" address, e.g. "News <noreply@news.cuteteal.com>". Lives
	// with the caller (it depends on the verified sending domain), not hardcoded
	// here, so the helper doesn't bake in a domain that infra hasn't set up yet.
	from: string;
	// Injected so tests mock the network; defaults to the global fetch.
	fetchFn?: typeof fetch;
}

// Resend's success body is `{ id: "<uuid>" }`; we surface that id so callers can
// log/trace a send.
export interface SendEmailResult {
	id: string;
}

// Send one transactional email. Resolves with Resend's message id on success;
// throws on any non-2xx response (including Resend's error body in the message)
// so a failed send is never silently swallowed by the caller.
export async function sendEmail(
	deps: SendEmailDeps,
	params: SendEmailParams,
): Promise<SendEmailResult> {
	const { apiKey, from, fetchFn = fetch } = deps;
	const { to, subject, text, html } = params;

	const res = await fetchFn(RESEND_ENDPOINT, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ from, to, subject, text, html }),
	});

	if (!res.ok) {
		// Resend returns a JSON `{ name, message }` on errors; we surface the raw
		// body text so the thrown error is always informative regardless of shape.
		const detail = await res.text();
		throw new Error(`Resend send failed (${res.status}): ${detail}`);
	}

	const { id } = (await res.json()) as { id: string };
	return { id };
}
